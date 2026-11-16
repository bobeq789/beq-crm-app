// Chat im Demo-Modus: dieselben Regeln wie 30_chat.sql, nur im Browser.
// Kanäle offen (alle im Team) oder auf Einladung (Mitglieder und Admins), Gäste nur eingeladen in
// Kanäle. Gruppen und Direktnachrichten nur die Beteiligten, auch kein Admin.
import { uid } from '../lib/util.js'
import { dbError } from './rules.js'

export const CHAT_TABLES = ['chat_raeume', 'chat_mitglieder', 'chat_nachrichten', 'chat_gelesen', 'chat_reaktionen']
// Feste Zeichen für Reaktionen (wie die Prüfung in 32_chat_verlauf.sql)
export const REACTIONS = ['👍', '❤️', '😂', '🎉', '👀', '✅']

const low = (s) => String(s || '').trim().toLowerCase()
const now = () => new Date().toISOString()
const noRight = (text) => dbError('42501', text || 'permission denied')
const bad = (text) => dbError('meldung', text)

function roleOf(db, email) {
  const t = db.team_members.find((x) => low(x.email) === low(email) && x.active)
  return t ? t.role : null
}
const isTeam = (db, me) => ['admin', 'mitglied'].includes(roleOf(db, me))
const isAdminRole = (db, me) => roleOf(db, me) === 'admin'
const isMember = (db, raumId, me) => db.chat_mitglieder.some((m) => m.raum_id === raumId && m.email === low(me))

export function canSeeRoom(db, me, r) {
  if (!r) return false
  const role = roleOf(db, me)
  if (!role) return false
  if (r.art === 'kanal') {
    if (role !== 'gast' && (r.offen || role === 'admin')) return true
    return isMember(db, r.id, me)
  }
  return role !== 'gast' && isMember(db, r.id, me)
}

function room(db, me, id) {
  const r = db.chat_raeume.find((x) => x.id === id)
  if (!canSeeRoom(db, me, r)) throw noRight('Diesen Chat gibt es nicht.')
  return r
}

function checkPeople(db, emails, guestsAllowed) {
  const list = [...new Set((emails || []).map(low).filter(Boolean))]
  list.forEach((e) => {
    const role = roleOf(db, e)
    if (!role) throw bad('Mindestens eine Person ist nicht (mehr) im Team.')
    if (role === 'gast' && !guestsAllowed) throw bad('Gäste können nur in Kanäle eingeladen werden.')
  })
  return list
}

const mentionable = (db, list) => [...new Set((list || []).map(low))].filter((e) => roleOf(db, e)).slice(0, 50)

function addMembers(db, raum, emails, by) {
  emails.forEach((e) => {
    if (!db.chat_mitglieder.some((m) => m.raum_id === raum.id && m.email === e)) {
      db.chat_mitglieder.push({ raum_id: raum.id, email: e, art: raum.art, hinzugefuegt_von: by, created_at: now() })
    }
  })
}

// Wie chat_uebersicht(): sichtbare Räume mit Mitgliedern, ungelesen und Erwähnungen
export function chatOverview(db, me) {
  me = low(me)
  const self = db.team_members.find((t) => low(t.email) === me && t.active)
  return db.chat_raeume
    .filter((r) => canSeeRoom(db, me, r))
    .map((r) => {
      const mm = db.chat_mitglieder.find((m) => m.raum_id === r.id && m.email === me)
      const g = db.chat_gelesen.find((x) => x.raum_id === r.id && x.email === me)
      let start = null
      let strict = false
      if (g) {
        start = g.gelesen_bis
        strict = true
      } else if (mm) start = mm.created_at
      else if (r.art === 'kanal' && r.offen) start = [r.created_at, self ? self.created_at : r.created_at].sort().pop()
      // Antworten zählen nur, wenn sie einen betreffen (eigene Nachricht, selbst im Verlauf, erwähnt)
      const concernsMe = (n) =>
        !n.antwort_auf ||
        (n.erwaehnt || []).includes(me) ||
        db.chat_nachrichten.some((p) => p.id === n.antwort_auf && p.autor === me) ||
        db.chat_nachrichten.some((x) => x.antwort_auf === n.antwort_auf && x.autor === me)
      const unread = start
        ? db.chat_nachrichten.filter((n) => n.raum_id === r.id && n.autor !== me && !n.geloescht_at && (strict ? n.created_at > start : n.created_at >= start) && concernsMe(n))
        : []
      return {
        ...r,
        mitglied: !!mm,
        mitglieder: db.chat_mitglieder.filter((m) => m.raum_id === r.id).map((m) => m.email),
        ungelesen: unread.length,
        erwaehnt: unread.filter((n) => (n.erwaehnt || []).includes(me)).length,
        gelesen_bis: g ? g.gelesen_bis : null,
      }
    })
    .sort((a, b) => (b.letzte_at || b.created_at).localeCompare(a.letzte_at || a.created_at))
}

// Nachrichten eines Raums, neueste zuerst (vor: nur ältere als dieser Zeitpunkt)
export function chatMessages(db, me, raumId, before, limit) {
  room(db, me, raumId)
  return db.chat_nachrichten
    .filter((n) => n.raum_id === raumId && !n.antwort_auf && (!before || n.created_at < before))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit)
}

export function chatSend(db, me, { id, raum_id, text, erwaehnt, antwort_auf }) {
  me = low(me)
  const r = room(db, me, raum_id)
  if (r.archiviert) throw noRight('Der Kanal ist archiviert.')
  const t = String(text || '')
  if (!t.trim() || t.length > 4000) throw dbError('23514', 'check')
  let parent = null
  if (antwort_auf) {
    parent = db.chat_nachrichten.find((n) => n.id === antwort_auf)
    if (!parent || parent.raum_id !== raum_id) throw bad('Auf diese Nachricht lässt sich hier nicht antworten.')
    if (parent.antwort_auf) throw bad('Auf eine Antwort lässt sich nicht noch einmal antworten. Bitte im selben Verlauf schreiben.')
    if (parent.geloescht_at) throw bad('Diese Nachricht ist gelöscht.')
  }
  const msg = { id: id || uid(), raum_id, art: r.art, autor: me, text: t, erwaehnt: mentionable(db, erwaehnt), antwort_auf: antwort_auf || null, antworten: 0, letzte_antwort_at: null, created_at: now(), bearbeitet_at: null, geloescht_at: null }
  db.chat_nachrichten.push(msg)
  r.letzte_at = msg.created_at
  if (parent) {
    parent.antworten = (parent.antworten || 0) + 1
    parent.letzte_antwort_at = msg.created_at
  }
  return msg
}

// Antworten auf eine Nachricht, älteste zuerst
export function chatThread(db, me, parentId) {
  const parent = db.chat_nachrichten.find((n) => n.id === parentId)
  if (!parent) throw noRight('Diese Nachricht gibt es nicht.')
  room(db, me, parent.raum_id)
  return db.chat_nachrichten.filter((n) => n.antwort_auf === parentId).sort((a, b) => a.created_at.localeCompare(b.created_at))
}

// Reaktionen (aktive) zu diesen Nachrichten, nur aus sichtbaren Räumen
export function chatReactions(db, me, ids) {
  const set = new Set(ids)
  return db.chat_reaktionen.filter((x) => set.has(x.nachricht_id) && x.aktiv && canSeeRoom(db, me, db.chat_raeume.find((r) => r.id === x.raum_id)))
}

export function chatReact(db, me, nachrichtId, zeichen, aktiv) {
  me = low(me)
  const n = db.chat_nachrichten.find((x) => x.id === nachrichtId)
  const r = n && db.chat_raeume.find((x) => x.id === n.raum_id)
  if (!n || !canSeeRoom(db, me, r)) throw dbError('23503', 'Diese Nachricht gibt es nicht.')
  if (r.archiviert) throw noRight('Der Kanal ist archiviert.')
  if (!REACTIONS.includes(zeichen)) throw dbError('23514', 'check')
  if (n.geloescht_at) throw bad('Auf gelöschte Nachrichten lässt sich nicht reagieren.')
  const old = db.chat_reaktionen.find((x) => x.nachricht_id === nachrichtId && x.email === me && x.zeichen === zeichen)
  if (old) Object.assign(old, { aktiv: aktiv !== false, updated_at: now() })
  else db.chat_reaktionen.push({ nachricht_id: nachrichtId, email: me, zeichen, aktiv: aktiv !== false, raum_id: n.raum_id, art: n.art, created_at: now(), updated_at: now() })
}

// Suche: nur Nachrichten aus sichtbaren Räumen, ohne gelöschte, neueste zuerst
export function chatSearch(db, me, q, limit = 50) {
  const needle = String(q || '').trim().toLowerCase()
  if (needle.length < 2) return []
  return db.chat_nachrichten
    .filter((n) => !n.geloescht_at && n.text.toLowerCase().includes(needle) && canSeeRoom(db, me, db.chat_raeume.find((r) => r.id === n.raum_id)))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit)
}

export function chatEdit(db, me, id, patch) {
  me = low(me)
  const n = db.chat_nachrichten.find((x) => x.id === id)
  if (!n || n.autor !== me || !canSeeRoom(db, me, db.chat_raeume.find((r) => r.id === n.raum_id))) throw noRight()
  if (n.geloescht_at) throw noRight('Diese Nachricht ist gelöscht und lässt sich nicht mehr ändern.')
  if (patch.geloescht) {
    Object.assign(n, { text: '', erwaehnt: [], geloescht_at: now() })
  } else {
    const t = String(patch.text || '')
    if (!t.trim() || t.length > 4000) throw dbError('23514', 'check')
    Object.assign(n, { text: t, erwaehnt: mentionable(db, patch.erwaehnt), bearbeitet_at: now() })
  }
  return n
}

export function chatCreateChannel(db, me, { name, beschreibung, offen, mitglieder }) {
  me = low(me)
  if (!isTeam(db, me)) throw noRight('Kanäle legen nur Mitglieder des Teams an.')
  const n = String(name || '').trim()
  if (!n) throw bad('Bitte gib dem Kanal einen Namen.')
  if (n.length > 80) throw dbError('23514', 'check')
  if (db.chat_raeume.some((r) => r.art === 'kanal' && !r.archiviert && low(r.name) === low(n))) throw bad('Einen Kanal mit diesem Namen gibt es schon.')
  const people = checkPeople(db, [...(mitglieder || []), me], true)
  const r = { id: uid(), art: 'kanal', name: n, beschreibung: String(beschreibung || '').trim() || null, offen: offen !== false, project_id: null, direkt_schluessel: null, created_by: me, archiviert: false, letzte_at: null, created_at: now(), updated_at: now() }
  db.chat_raeume.push(r)
  addMembers(db, r, people, me)
  return r.id
}

export function chatDirect(db, me, email) {
  me = low(me)
  const du = low(email)
  if (!isTeam(db, me)) throw noRight('Direktnachrichten schreiben nur Mitglieder des Teams.')
  if (du === me) throw bad('Eine Direktnachricht an dich selbst gibt es nicht.')
  checkPeople(db, [du], false)
  const key = [me, du].sort().join(' ')
  const found = db.chat_raeume.find((r) => r.direkt_schluessel === key)
  if (found) return found.id
  const r = { id: uid(), art: 'direkt', name: null, beschreibung: null, offen: true, project_id: null, direkt_schluessel: key, created_by: me, archiviert: false, letzte_at: null, created_at: now(), updated_at: now() }
  db.chat_raeume.push(r)
  addMembers(db, r, [me, du], me)
  return r.id
}

export function chatCreateGroup(db, me, { mitglieder, name }) {
  me = low(me)
  if (!isTeam(db, me)) throw noRight('Gruppen legen nur Mitglieder des Teams an.')
  const people = checkPeople(db, [...(mitglieder || []), me], false)
  if (people.length < 2) throw bad('Bitte wähl mindestens eine Person aus.')
  if (people.length === 2) return chatDirect(db, me, people.find((e) => e !== me))
  const r = { id: uid(), art: 'gruppe', name: String(name || '').trim() || null, beschreibung: null, offen: true, project_id: null, direkt_schluessel: null, created_by: me, archiviert: false, letzte_at: null, created_at: now(), updated_at: now() }
  db.chat_raeume.push(r)
  addMembers(db, r, people, me)
  return r.id
}

export function chatAddMembers(db, me, raumId, emails) {
  me = low(me)
  const r = room(db, me, raumId)
  if (!isTeam(db, me)) throw noRight('Diesen Chat gibt es nicht oder du darfst dort niemanden hinzufügen.')
  if (r.art === 'direkt') throw bad('In eine Direktnachricht kommt niemand dazu. Leg dafür eine Gruppe an.')
  if (r.archiviert) throw bad('Der Kanal ist archiviert.')
  if (r.art === 'gruppe' && !isMember(db, r.id, me)) throw noRight('Nur wer in der Gruppe ist, fügt Personen hinzu.')
  addMembers(db, r, checkPeople(db, emails, r.art === 'kanal'), me)
}

export function chatRemoveMember(db, me, raumId, email) {
  me = low(me)
  const who = low(email)
  const r = room(db, me, raumId)
  if (r.art === 'direkt') throw bad('Aus einer Direktnachricht lässt sich niemand entfernen.')
  if (who !== me) {
    if (r.art !== 'kanal') throw noRight('In Gruppen kann jede Person nur sich selbst entfernen.')
    if (!isTeam(db, me) || !(r.created_by === me || isAdminRole(db, me))) throw noRight('Andere entfernt nur, wer den Kanal angelegt hat, oder ein Admin.')
  }
  db.chat_mitglieder = db.chat_mitglieder.filter((m) => !(m.raum_id === r.id && m.email === who))
  db.chat_gelesen = db.chat_gelesen.filter((g) => !(g.raum_id === r.id && g.email === who))
}

export function chatChangeRoom(db, me, raumId, patch) {
  me = low(me)
  const r = room(db, me, raumId)
  if (!isTeam(db, me)) throw noRight('Diesen Chat gibt es nicht oder du darfst ihn nicht ändern.')
  if (r.art === 'direkt') throw bad('Direktnachrichten haben keinen Namen.')
  if (r.art === 'gruppe') {
    if (!isMember(db, r.id, me)) throw noRight('Nur wer in der Gruppe ist, ändert ihren Namen.')
    if (patch.name !== undefined && patch.name !== null) r.name = String(patch.name).trim() || null
    r.updated_at = now()
    return
  }
  if (!(r.created_by === me || isAdminRole(db, me))) throw noRight('Den Kanal ändert, wer ihn angelegt hat, oder ein Admin.')
  const name = String(patch.name || '').trim() || r.name
  const archiviert = patch.archiviert ?? r.archiviert
  if (!archiviert && db.chat_raeume.some((x) => x.art === 'kanal' && !x.archiviert && x.id !== r.id && low(x.name) === low(name))) throw bad('Einen Kanal mit diesem Namen gibt es schon.')
  r.name = name
  if (patch.beschreibung !== undefined && patch.beschreibung !== null) r.beschreibung = String(patch.beschreibung).trim() || null
  if (patch.offen !== undefined && patch.offen !== null) r.offen = !!patch.offen
  r.archiviert = !!archiviert
  r.updated_at = now()
}

export function chatMarkRead(db, me, raumId, bis) {
  me = low(me)
  room(db, me, raumId)
  const t = [bis || now(), now()].sort()[0]
  const g = db.chat_gelesen.find((x) => x.raum_id === raumId && x.email === me)
  if (g) g.gelesen_bis = [g.gelesen_bis, t].sort().pop()
  else db.chat_gelesen.push({ raum_id: raumId, email: me, gelesen_bis: t })
}
