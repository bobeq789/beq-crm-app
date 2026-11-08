// Demo-Modus: Daten liegen nur in diesem Browser (localStorage). Gleiche Schnittstelle wie supabase.js.
// Mit ?demo&gast sieht man die App so, wie ein Gast sie sieht.
import { local, matches } from '../lib/util.js'
import { buildSeed, DEMO_ME, DEMO_GUEST, DEMO_TEAM } from './seed.js'
import {
  prepareInsert,
  prepareUpdate,
  checkInsert,
  checkDelete,
  checkGuestCardUpdate,
  checkGuestCardInsert,
  autoShareFor,
  cleanMentions,
  mentionSharesFor,
  lastHandovers,
  recalcDeal,
  canSeeSales,
  afterInsert,
  cascadeDelete,
  guestView,
  dbError,
  TABLES,
  EXTRA_TABLES,
  OPTIONAL_TABLES,
  DEMO_TABLES,
  cardEventsFor,
  noteEventsFor,
  cardFlags,
} from './rules.js'

const KEY = 'beqcrm-demo-v3'
const clone = (x) => JSON.parse(JSON.stringify(x))

function loadDb() {
  const saved = local.get(KEY)
  if (saved && [...TABLES, ...OPTIONAL_TABLES, ...EXTRA_TABLES, ...DEMO_TABLES].every((t) => Array.isArray(saved[t]))) return saved
  const db = buildSeed()
  local.set(KEY, db)
  return db
}

export function createDemoApi({ asGuest = false } = {}) {
  let db = loadDb()
  const me = asGuest ? DEMO_GUEST : DEMO_ME
  const save = () => local.set(KEY, db)
  const find = (table, id) => db[table].find((x) => x.id === id)
  // Karte einzeln geteilt oder ihr Projekt ganz geteilt
  const sharedWithMe = (cardId) => {
    if (db.card_shares.some((s) => s.card_id === cardId && s.email === me)) return true
    const card = db.cards.find((c) => c.id === cardId)
    return !!card && db.project_shares.some((s) => s.project_id === card.project_id && s.email === me)
  }
  const notAllowed = () => dbError('42501', 'permission denied')
  // Sales wie die Regeln in 08_sales.sql: Katalog ändern nur Admins, Deals nur, wer die Zahlen sehen darf
  const SALES = new Set(['products', 'deals', 'deal_items'])
  // Postfächer wie 10_postfaecher.sql: anlegen nur über Google, Schalter nur Besitzer oder Admin
  const canManageMailbox = (box) => {
    const self = db.team_members.find((t) => t.email === me && t.active)
    return !!self && self.role !== 'gast' && (box.owner === me || self.role === 'admin')
  }
  const checkSales = (table, row) => {
    if (!SALES.has(table)) return
    const self = db.team_members.find((t) => t.email === me)
    if (table === 'products' && (!self || self.role !== 'admin')) throw notAllowed()
    const deal = table === 'deals' ? row : db.deals.find((d) => d.id === row.deal_id)
    if (table !== 'products' && (!deal || !canSeeSales(db, me, deal.owner))) throw notAllowed()
  }

  return {
    mode: 'demo',
    asGuest,

    // Anmeldung und zweiter Faktor gibt es im Demo-Modus nicht
    async getSession() {
      return { email: me }
    },
    onAuthChange() {},
    async signIn() {},
    async signOut() {},
    async resetPassword() {
      throw dbError('demo', 'Im Demo-Modus nicht verfügbar')
    },
    async updatePassword() {
      throw dbError('demo', 'Im Demo-Modus nicht verfügbar')
    },
    async myRole() {
      const m = db.team_members.find((t) => t.email === me && t.active)
      return m ? m.role : null
    },
    async adminName() {
      return DEMO_TEAM[0].name
    },
    async mfaStatus() {
      return { level: 'aal2', factors: [] }
    },

    async loadAll() {
      return clone(asGuest ? guestView(db, me) : db)
    },

    // Ganzer Datensatz (im Demo-Modus ist ohnehin alles da)
    async fetchRow(table, id) {
      const row = find(table, id)
      return row ? clone(row) : null
    },

    // Meetings, deren Zusammenfassung den Suchtext enthält
    async searchMeetingSummaries(q) {
      return db.meetings.filter((m) => matches(q, m.summary)).map((m) => m.id)
    },

    async insert(table, row) {
      if (table === 'mailboxes') throw notAllowed()
      const r = prepareInsert(table, row, me)
      if (asGuest) {
        if (table === 'cards') checkGuestCardInsert(db, r, me)
        else {
          const ok = table === 'notes' && r.card_id && !r.internal && !r.person_id && !r.org_id && !r.meeting_id && sharedWithMe(r.card_id)
          if (!ok) throw notAllowed()
        }
      }
      checkInsert(db, table, r)
      checkSales(table, r)
      if (table === 'deals' && db.deals.some((d) => d.card_id === r.card_id)) throw dbError('23505', 'deals_card_key')
      if (table === 'notes') r.mentions = cleanMentions(db, r, me, asGuest)
      db[table] = [...db[table], r]
      if (table === 'deal_items') recalcDeal(db, r.deal_id)
      afterInsert(db, table, r)
      // Verlauf wie die Trigger in der Datenbank
      if (table === 'cards') db.card_events.push(...cardEventsFor(db, 'insert', null, r, me))
      // Teammitglied weist einem Gast zu: automatisch teilen
      const share = table === 'cards' && !asGuest && autoShareFor(db, null, r)
      if (share) db.card_shares.push(share)
      if (table === 'notes') {
        db.card_events.push(...noteEventsFor(r, me))
        if (!asGuest) db.card_shares.push(...mentionSharesFor(db, r).map((s) => ({ ...s, created_by: me })))
      }
      save()
      return clone(r)
    },

    async update(table, id, patch) {
      const old = find(table, id)
      if (!old) throw dbError('PGRST116', 'not found')
      if (table === 'mailboxes') {
        if (asGuest || !canManageMailbox(old)) throw notAllowed()
        patch = Object.fromEntries(Object.entries(patch).filter(([k]) => k === 'sync_mail' || k === 'sync_calendar'))
      }
      if (asGuest) {
        if (table === 'cards' && sharedWithMe(id)) checkGuestCardUpdate(db, old, patch, me)
        else if (table === 'notes' && old.author === me && !old.internal && sharedWithMe(old.card_id)) patch = { content: patch.content ?? old.content, mentions: patch.mentions ?? old.mentions }
        else throw notAllowed()
      }
      const r = prepareUpdate(table, old, patch)
      checkSales(table, old)
      checkSales(table, r)
      if (table === 'notes') r.mentions = cleanMentions(db, r, me, asGuest)
      db[table] = db[table].map((x) => (x.id === id ? r : x))
      if (table === 'deal_items') recalcDeal(db, r.deal_id)
      if (table === 'notes') {
        db.card_events.push(...noteEventsFor(r, me, old))
        if (!asGuest) db.card_shares.push(...mentionSharesFor(db, r, old).map((s) => ({ ...s, created_by: me })))
      }
      if (table === 'cards') db.card_events.push(...cardEventsFor(db, 'update', old, r, me))
      const share = table === 'cards' && !asGuest && autoShareFor(db, old, r)
      if (share) db.card_shares.push(share)
      save()
      return clone(r)
    },

    // Aufgaben einer Spalte zählen, auch archivierte (B3)
    async countStageCards(stageId) {
      const list = db.cards.filter((c) => c.stage_id === stageId)
      return { total: list.length, archived: list.filter((c) => c.archived).length }
    },
    // Alle Aufgaben einer Spalte in eine andere, je Aufgabe mit Verlaufseintrag wie in der Datenbank
    async moveStageCards(fromId, toId) {
      const ids = db.cards.filter((c) => c.stage_id === fromId).map((c) => c.id)
      for (const id of ids) await this.update('cards', id, { stage_id: toId })
      return ids.length
    },
    async remove(table, id) {
      if (asGuest || table === 'mailboxes') throw notAllowed()
      checkDelete(db, table, id)
      const old = find(table, id)
      if (old) checkSales(table, old)
      db[table] = db[table].filter((x) => x.id !== id)
      cascadeDelete(db, table, id)
      if (table === 'deal_items' && old) recalcDeal(db, old.deal_id)
      save()
    },

    // Verlauf einer Karte, neueste oben (Gäste nur bei geteilten Karten)
    async cardEvents(cardId) {
      if (asGuest && !sharedWithMe(cardId)) return []
      return clone(db.card_events.filter((e) => e.card_id === cardId).sort((a, b) => b.at.localeCompare(a.at)))
    },
    // Karte als gesehen merken
    async markSeen(cardId) {
      const now = new Date().toISOString()
      const row = db.card_seen.find((x) => x.card_id === cardId && x.email === me)
      if (row) row.seen_at = now
      else db.card_seen.push({ card_id: cardId, email: me, seen_at: now })
      save()
    },
    // Marken „Neu“ (und später „@ dich“)
    async cardFlags() {
      const source = asGuest ? guestView(db, me) : db
      const self = db.team_members.find((t) => t.email === me)
      return cardFlags(source, me, self && self.created_at)
    },

    // Dateien: nur Name, Größe und Datum, ohne Inhalt. Hochladen wird nur im Browser vorgemerkt.
    async listFiles(cardId) {
      if (asGuest && !sharedWithMe(cardId)) return []
      return clone(db.files.filter((f) => f.card_id === cardId).sort((a, b) => b.created_at.localeCompare(a.created_at)))
    },
    async uploadFile(path, file) {
      const cardId = path.split('/')[1]
      if (!db.cards.some((c) => c.id === cardId) || (asGuest && !sharedWithMe(cardId))) throw notAllowed()
      db.files.push({ card_id: cardId, path, size: file.size, created_at: new Date().toISOString() })
      save()
    },
    async fileUrl() {
      throw dbError('demo', 'Im Demo-Modus haben Dateien keinen Inhalt.')
    },
    async removeFile(path) {
      if (asGuest) throw notAllowed()
      db.files = db.files.filter((f) => f.path !== path)
      save()
    },
    async logFile(cardId, name) {
      if (asGuest && !sharedWithMe(cardId)) throw notAllowed()
      db.card_events.push({ id: crypto.randomUUID(), card_id: cardId, at: new Date().toISOString(), actor: me, kind: 'datei', detail: name })
      save()
    },

    // Postfach verbinden: Google gibt es in der Demo nicht. Die Demo legt ein erfundenes
    // Postfach an und springt zurück wie nach der Zustimmung bei Google.
    async connectMailbox() {
      if (asGuest) throw dbError('meldung', 'Postfächer verbinden dürfen nur Teammitglieder.')
      const taken = new Set(db.mailboxes.filter((b) => b.status !== 'getrennt').map((b) => b.address))
      let n = 2
      while (taken.has(`postfach${n}@example.com`)) n++
      const address = `postfach${n}@example.com`
      const now = new Date().toISOString()
      const old = db.mailboxes.find((b) => b.address === address)
      const row = { id: old ? old.id : crypto.randomUUID(), address, owner: me, provider: 'google', sync_mail: true, sync_calendar: true, status: 'aktiv', last_sync_at: null, last_error: null, created_at: old ? old.created_at : now, updated_at: now }
      db.mailboxes = [...db.mailboxes.filter((b) => b.address !== address), row]
      save()
      return `${location.pathname}${location.search}#/einstellungen?postfach=ok&adresse=${encodeURIComponent(address)}&mail=1&kalender=1`
    },
    async disconnectMailbox(id, deleteData) {
      const box = find('mailboxes', id)
      if (!box || asGuest || !canManageMailbox(box)) throw notAllowed()
      db.mailboxes = db.mailboxes.map((b) => (b.id === id ? { ...b, status: 'getrennt', last_error: null, updated_at: new Date().toISOString() } : b))
      if (deleteData) {
        const mails = new Set(db.emails.filter((m) => m.mailbox.toLowerCase() === box.address).map((m) => m.id))
        const events = new Set(db.events.filter((e) => e.calendar_id.toLowerCase() === box.address).map((e) => e.id))
        db.emails = db.emails.filter((m) => !mails.has(m.id))
        db.email_persons = db.email_persons.filter((x) => !mails.has(x.email_id))
        db.events = db.events.filter((e) => !events.has(e.id))
        db.event_persons = db.event_persons.filter((x) => !events.has(x.event_id))
      }
      save()
    },

    // Postfach in der Demo: Senden legt eine Mail an, Löschen entfernt sie, Anhänge haben keinen Inhalt
    // Erfundene Signatur für den Demo-Modus
    async mailSignature(von) {
      const self = db.team_members.find((t) => t.email === me)
      return { vorhanden: true, text: `Viele Grüße\n${self ? self.name : ''}\nbeQ GmbH (Demo)\n${von}` }
    },
    async mailAction(action, payload) {
      if (asGuest) throw notAllowed()
      if (action === 'senden') {
        const box = db.mailboxes.find((b) => b.address === payload.von && b.owner === me && b.status === 'aktiv')
        if (!box) throw dbError('meldung', 'Senden geht nur aus deinen eigenen Postfächern.')
        const to = [].concat(payload.an || []).map((a) => String(a).trim().toLowerCase()).filter(Boolean)
        if (!to.length) throw dbError('meldung', 'Bitte mindestens eine Adresse eintragen.')
        const orig = payload.antwort_auf ? db.emails.find((m) => m.id === payload.antwort_auf) : null
        const self = db.team_members.find((t) => t.email === me)
        const id = crypto.randomUUID()
        const now = new Date().toISOString()
        const files = (payload.dateien || []).map((f, i) => ({ name: f.name, mime: f.mime, size: Math.floor((f.data || '').length * 0.75), part: String(i + 1) }))
        const sig = payload.signatur ? (await this.mailSignature(payload.von)).text : ''
        const body = [String(payload.text || '').replace(/\s+$/, ''), sig, String(payload.zitat || '').trim()].filter(Boolean).join('\n\n')
        db.emails.push({
          id, message_id: `<demo-${id}@example.com>`, thread_id: orig ? orig.thread_id : id, mailbox: box.address, provider_id: 'demo-' + id,
          direction: 'out', from_email: box.address, from_name: self ? self.name : box.address, to_emails: to,
          cc_emails: [].concat(payload.cc || []).map((a) => String(a).trim().toLowerCase()).filter(Boolean),
          subject: payload.betreff || '', sent_at: now, body, attachments: files.map((f) => f.name),
          attachment_list: files, snippet: body.slice(0, 140), labels: ['SENT'], mailboxes: [box.address], created_at: now,
        })
        for (const addr of to) {
          const person = db.persons.find((p) => (p.emails || []).map((e) => e.toLowerCase()).includes(addr))
          if (person) db.email_persons.push({ id: crypto.randomUUID(), email_id: id, person_id: person.id })
        }
        save()
        return { ok: true, id }
      }
      if (action === 'loeschen') {
        const mail = db.emails.find((m) => m.id === payload.email_id)
        if (!mail) return { ok: true }
        const box = db.mailboxes.find((b) => b.address === mail.mailbox && b.status === 'aktiv')
        if (!box || box.owner !== me) throw dbError('meldung', 'Löschen geht nur in deinen eigenen Postfächern.')
        db.emails = db.emails.filter((m) => m.id !== mail.id)
        db.email_persons = db.email_persons.filter((x) => x.email_id !== mail.id)
        save()
        return { ok: true }
      }
      throw dbError('meldung', 'Unbekannte Aktion.')
    },
    async mailAttachmentLink() {
      throw dbError('demo', 'Im Demo-Modus haben Anhänge keinen Inhalt.')
    },
    async syncNow() {
      const own = db.mailboxes.filter((b) => b.owner === me && b.status === 'aktiv')
      return { ok: true, postfaecher: own.length, ergebnis: own.map((b) => ({ adresse: b.address, termine: 0, mails: 0, mails_fertig: true, fehler: null })) }
    },

    // Gibt es zu dieser Aufgabe einen Deal, und wem gehört er? (ohne Werte)
    async cardDealOwner(cardId) {
      if (asGuest) return null
      const d = db.deals.find((x) => x.card_id === cardId)
      return d ? d.owner : null
    },

    // Letzte Zuweisung je Karte (für „Liegt bei anderen“)
    async handovers() {
      return clone(lastHandovers(asGuest ? guestView(db, me) : db))
    },
    // Freigaben einer Karte (nach automatischem Teilen neu laden)
    async cardShares(cardId) {
      const source = asGuest ? guestView(db, me) : db
      return clone(source.card_shares.filter((s) => s.card_id === cardId))
    },

    // Beispieldaten neu erzeugen
    reset() {
      local.remove(KEY)
      db = loadDb()
    },
  }
}
