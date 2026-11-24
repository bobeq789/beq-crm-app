// Demo-Modus: Daten liegen nur in diesem Browser (localStorage). Gleiche Schnittstelle wie supabase.js.
// Mit ?demo&gast sieht man die App so, wie ein Gast sie sieht.
import { local, matches, uid } from '../lib/util.js'
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
  afterUpdate,
  activityEventsFor,
  waitingFollowUpFor,
  openAnswers,
  mailsWithoutReply,
  newInboxMails,
  mailSpurRows,
  closedDealMove,
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
  archiveOldDone,
  activityAreaSuggestion,
  subtaskEventsFor,
  isTeamAddress,
  touchCard,
} from './rules.js'
import * as chat from './chat_rules.js'

const KEY = 'beqcrm-demo-v3'
// Claude-Zugänge im Demo-Modus (nur in diesem Browser)
const CLAUDE_KEY = 'beqcrm-demo-claude'
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
  // Was in Supabase nachts der Zeitplan tut (24_archiv.sql), passiert hier beim Laden
  if (archiveOldDone(db)) save()
  const find = (table, id) => db[table].find((x) => x.id === id)
  // Karte einzeln geteilt oder ihr Projekt ganz geteilt
  const sharedWithMe = (cardId) => {
    if (db.card_shares.some((s) => s.card_id === cardId && s.email === me)) return true
    const card = db.cards.find((c) => c.id === cardId)
    return !!card && db.project_shares.some((s) => s.project_id === card.project_id && s.email === me)
  }
  const notAllowed = () => dbError('42501', 'permission denied')
  // Weitere Zuständige und Zuständige von Unteraufgaben nur aktive Teammitglieder (36_meine_pipeline.sql)
  const checkHolders = (row, old = null) => {
    const added = (row.mitzustaendig || []).filter((x) => !(old && (old.mitzustaendig || []).includes(x)))
    if (added.some((x) => !isTeamAddress(db, x))) throw dbError('23514', 'Weitere Zuständige können nur Teammitglieder sein.')
  }
  const checkSubtask = (row, old = null) => {
    if (row.zustaendig && (!old || row.zustaendig !== old.zustaendig) && !isTeamAddress(db, row.zustaendig)) {
      throw dbError('23514', 'Zuständig für eine Unteraufgabe können nur Teammitglieder sein.')
    }
    if (!old && db.unteraufgaben.filter((u) => u.card_id === row.card_id).length >= 100) throw dbError('23514', 'Höchstens 100 Unteraufgaben je Aufgabe.')
  }
  // Deal gewonnen oder verloren: Aufgabe nach „Erledigt“ (wie 28_deal_abschluss.sql), mit Verlauf
  const moveClosedDeal = (oldDeal, deal) => {
    const hit = closedDealMove(db, oldDeal, deal)
    if (!hit) return
    const moved = prepareUpdate('cards', hit.card, { stage_id: hit.stageId })
    db.cards = db.cards.map((c) => (c.id === moved.id ? moved : c))
    db.card_events.push(...cardEventsFor(db, 'update', hit.card, moved, me))
  }
  const isAdmin = () => db.team_members.some((t) => t.email === me && t.active && t.role === 'admin')
  // Wartespalte: Wiedervorlage wie tg_cards_wiedervorlage() in 19_aktivitaeten.sql
  const waitingFollowUp = (oldCard, card) => {
    const act = waitingFollowUpFor(db, oldCard, card, me)
    if (!act) return
    db.aktivitaeten = [...db.aktivitaeten, act]
    afterInsert(db, 'aktivitaeten', act)
    db.card_events.push(...activityEventsFor(act, me))
  }
  // Sales wie die Regeln in 08_sales.sql: Katalog ändern nur Admins, Deals nur, wer die Zahlen sehen darf
  const SALES = new Set(['products', 'deals', 'deal_items'])
  // Postfächer wie 10_postfaecher.sql und 26_super_admin.sql: anlegen nur über Google, Schalter
  // nur Besitzer oder Super-Admin
  const canManageMailbox = (box) => {
    const self = db.team_members.find((t) => t.email === me && t.active)
    return !!self && self.role !== 'gast' && (box.owner === me || (self.role === 'admin' && !!self.super_admin))
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
      const view = clone(asGuest ? guestView(db, me) : db)
      // Chat lädt die App getrennt (chatOverview, chatMessages), wie in Supabase
      chat.CHAT_TABLES.forEach((t) => (view[t] = []))
      return view
    },

    // ---------- Chat wie 30_chat.sql ----------
    // Jede Funktion arbeitet mit den Regeln aus chat_rules.js und speichert danach.
    async chatOverview() {
      return clone(chat.chatOverview(db, me))
    },
    async chatMessages(raumId, before = null, limit = 50) {
      return clone(chat.chatMessages(db, me, raumId, before, limit))
    },
    async chatSend(msg) {
      const row = chat.chatSend(db, me, msg)
      save()
      return clone(row)
    },
    // Mitteilungen aufs Handy gibt es im Demo-Modus nicht (kein Push-Dienst, kein Schlüssel)
    async pushKey() {
      return null
    },
    async pushDevices() {
      return []
    },
    async pushSave() {
      throw dbError('meldung', 'Im Demo-Modus gibt es keine Mitteilungen aufs Handy.')
    },
    async pushRemove() {},
    async pushTest() {
      return 0
    },
    // Dateien im Chat: Bilder als kleine Fassung im Browser, andere Dateien ohne Inhalt
    async chatUpload(path, file) {
      const data = /^image\/(jpeg|png|gif|webp)$/.test(file.type || '') ? await demoPreview(file) : null
      chat.chatUpload(db, me, { pfad: path, groesse: file.size, typ: file.type, data })
      save()
    },
    async chatFileUrls(paths) {
      return chat.chatFileUrls(db, me, paths)
    },
    async chatRemoveFiles(paths) {
      chat.chatRemoveFiles(db, me, paths)
      save()
    },
    async chatThread(parentId) {
      return clone(chat.chatThread(db, me, parentId))
    },
    async chatReactions(ids) {
      return clone(chat.chatReactions(db, me, ids))
    },
    async chatReact(id, zeichen, aktiv) {
      chat.chatReact(db, me, id, zeichen, aktiv)
      save()
    },
    async chatSearch(q) {
      return clone(chat.chatSearch(db, me, q))
    },
    async chatEdit(id, patch) {
      const row = chat.chatEdit(db, me, id, patch)
      save()
      return clone(row)
    },
    async chatCreateChannel(fields) {
      const id = chat.chatCreateChannel(db, me, fields)
      save()
      return id
    },
    async chatDirect(email) {
      const id = chat.chatDirect(db, me, email)
      save()
      return id
    },
    async chatCreateGroup(fields) {
      const id = chat.chatCreateGroup(db, me, fields)
      save()
      return id
    },
    async chatAddMembers(raumId, emails) {
      chat.chatAddMembers(db, me, raumId, emails)
      save()
    },
    async chatRemoveMember(raumId, email) {
      chat.chatRemoveMember(db, me, raumId, email)
      save()
    },
    async chatChangeRoom(raumId, patch) {
      chat.chatChangeRoom(db, me, raumId, patch)
      save()
    },
    async chatMarkRead(raumId, bis) {
      chat.chatMarkRead(db, me, raumId, bis)
      save()
    },
    // Sofort sichtbar: im Demo-Modus über einen zweiten Tab im selben Browser (storage-Ereignis).
    // Meldet nur „es gibt Neues“, die App holt dann selbst nach.
    chatSubscribe(onChange) {
      const fn = (e) => {
        if (e.key !== KEY) return
        db = loadDb()
        onChange({ type: 'sync' })
      }
      window.addEventListener('storage', fn)
      return () => window.removeEventListener('storage', fn)
    },

    // Ganzer Datensatz (im Demo-Modus ist ohnehin alles da)
    // Block aus dem alten CRM wie kontakt_altdaten (29_altcrm.sql): Gäste nie
    async fetchAltdaten(personId) {
      if (asGuest) return ''
      const row = (db.kontakt_altdaten || []).find((r) => r.person_id === personId)
      return row ? row.inhalt : ''
    },
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
        else if (table === 'unteraufgaben') throw notAllowed()
        else if (table === 'aktivitaeten') {
          // Gäste nur an Aufgaben, die sie sehen, nie ohne Aufgabe (19_aktivitaeten.sql)
          if (!r.card_id || r.person_id || r.org_id || !sharedWithMe(r.card_id)) throw notAllowed()
        } else {
          const ok = table === 'notes' && r.card_id && !r.internal && !r.person_id && !r.org_id && !r.meeting_id && sharedWithMe(r.card_id)
          if (!ok) throw notAllowed()
        }
      }
      checkInsert(db, table, r)
      checkSales(table, r)
      if (table === 'cards') checkHolders(r)
      if (table === 'unteraufgaben') {
        checkSubtask(r)
        if (!r.position) r.position = Math.max(0, ...db.unteraufgaben.filter((u) => u.card_id === r.card_id).map((u) => u.position || 0)) + 1
      }
      // Bereich wie tg_aktivitaeten_bereich() in 36_meine_pipeline.sql
      if (table === 'aktivitaeten' && !r.bereich) r.bereich = activityAreaSuggestion(db, r)
      if (table === 'deals' && db.deals.some((d) => d.card_id === r.card_id)) throw dbError('23505', 'deals_card_key')
      if (table === 'notes') r.mentions = cleanMentions(db, r, me, asGuest)
      db[table] = [...db[table], r]
      if (table === 'deal_items') recalcDeal(db, r.deal_id)
      afterInsert(db, table, r)
      // Verlauf wie die Trigger in der Datenbank
      if (table === 'cards') db.card_events.push(...cardEventsFor(db, 'insert', null, r, me))
      if (table === 'aktivitaeten') db.card_events.push(...activityEventsFor(r, me))
      if (table === 'unteraufgaben') db.card_events.push(...subtaskEventsFor('insert', r, me))
      if (table === 'cards') waitingFollowUp(null, r)
      if (table === 'deals') moveClosedDeal(null, r)
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
        else if (table === 'unteraufgaben' && sharedWithMe(old.card_id)) {
          // Gäste haken nur ab (36_meine_pipeline.sql)
          if (Object.keys(patch).some((k) => k !== 'erledigt_at' && k !== 'erledigt_von')) throw notAllowed()
        }
        else if (table === 'aktivitaeten' && old.card_id && sharedWithMe(old.card_id)) {
          if (['card_id', 'person_id', 'org_id'].some((k) => k in patch && patch[k] !== old[k])) throw notAllowed()
        }
        else if (table === 'notes' && old.author === me && !old.internal && sharedWithMe(old.card_id)) patch = { content: patch.content ?? old.content, mentions: patch.mentions ?? old.mentions }
        else throw notAllowed()
      }
      const r = prepareUpdate(table, old, patch, me)
      if (table === 'cards') checkHolders(r, old)
      if (table === 'unteraufgaben') checkSubtask(r, old)
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
      if (table === 'aktivitaeten') {
        afterUpdate(db, table, r)
        db.card_events.push(...activityEventsFor(r, me, old))
      }
      if (table === 'unteraufgaben') {
        afterUpdate(db, table, r)
        db.card_events.push(...subtaskEventsFor('update', r, me, old))
      }
      if (table === 'cards') waitingFollowUp(old, r)
      if (table === 'deals') moveClosedDeal(old, r)
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
      // Aktivitäten löschen nur die eigenen oder Admins (19_aktivitaeten.sql)
      if (table === 'aktivitaeten' && old && old.owner !== me && !isAdmin()) throw notAllowed()
      // Unteraufgaben: wer sie angelegt hat, die Hauptperson der Aufgabe oder Admins (36_meine_pipeline.sql)
      if (table === 'unteraufgaben' && old) {
        const card = find('cards', old.card_id)
        if (old.created_by !== me && !(card && card.assignee === me) && !isAdmin()) throw notAllowed()
        db.card_events.push(...subtaskEventsFor('delete', old, me))
        touchCard(db, old.card_id)
      }
      if (old) checkSales(table, old)
      db[table] = db[table].filter((x) => x.id !== id)
      cascadeDelete(db, table, id)
      if (table === 'deal_items' && old) recalcDeal(db, old.deal_id)
      save()
    },

    // ---------- Claude-Zugang (E1): Freigabe-Seite zum Ausprobieren ----------
    // ?demo&authorization_id=test zeigt eine Anfrage von Claude, …=fremd eine von einer fremden
    // Seite, …=abgelaufen eine abgelaufene, …=schon eine schon erlaubte. Freigaben liegen nur hier.
    async claudeDetails(id) {
      if (id === 'abgelaufen') throw dbError('404', 'authorization not found')
      if (id === 'schon') return { redirect_url: null }
      const fremd = id === 'fremd'
      return {
        authorization_id: id,
        redirect_uri: fremd ? 'https://werkzeug.example.com/callback' : 'https://claude.ai/api/mcp/auth_callback',
        client: { id: fremd ? 'demo-fremd' : 'demo-claude', name: fremd ? 'Werkzeug' : 'Claude' },
        scope: 'openid email profile',
      }
    },
    async claudeApprove(id, { clientId, clientName, redirectHost }) {
      if (asGuest) throw dbError('42501', 'Den Claude-Zugang gibt es nur für Mitglieder des Teams, nicht für Gäste.')
      const list = local.get(CLAUDE_KEY, []).filter((x) => x.client_id !== clientId)
      local.set(CLAUDE_KEY, [{ client_id: clientId, client_name: clientName, redirect_host: redirectHost, erteilt_at: new Date().toISOString() }, ...list])
      return null
    },
    async claudeDeny() {
      return null
    },
    async claudeGrants() {
      return local.get(CLAUDE_KEY, []).map((x) => ({ clientId: x.client_id, name: x.client_name }))
    },
    async claudeAccesses() {
      return asGuest ? [] : local.get(CLAUDE_KEY, [])
    },
    async claudeRevoke(clientId) {
      local.set(CLAUDE_KEY, local.get(CLAUDE_KEY, []).filter((x) => x.client_id !== clientId))
    },
    async claudeRevokeGrant(clientId) {
      local.set(CLAUDE_KEY, local.get(CLAUDE_KEY, []).filter((x) => x.client_id !== clientId))
    },

    // ---------- Follow-up wie 20_follow_up.sql (Gäste bekommen nichts) ----------
    async antwortenOffen() {
      return asGuest ? [] : clone(openAnswers(db, me))
    },
    async mailsOhneAntwort(days = 60) {
      return asGuest ? [] : clone(mailsWithoutReply(db, me, days))
    },
    async postfachNeu() {
      return asGuest ? [] : newInboxMails(db, me)
    },
    async postfachGesehen() {
      if (asGuest) return null
      const now = new Date().toISOString()
      const row = db.nutzer_gesehen.find((g) => g.person === me && g.bereich === 'postfach')
      const before = row ? row.at : null
      db.nutzer_gesehen = [...db.nutzer_gesehen.filter((g) => g !== row), { person: me, bereich: 'postfach', at: now }]
      save()
      return before
    },
    async dismissThread(mailbox, verlauf) {
      db.nachfass_aus = [...db.nachfass_aus.filter((n) => !(n.person === me && n.mailbox === mailbox && n.verlauf === verlauf)), { id: uid(), person: me, mailbox, verlauf, at: new Date().toISOString() }]
      save()
    },
    async undismissThread(mailbox, verlauf) {
      db.nachfass_aus = db.nachfass_aus.filter((n) => !(n.person === me && n.mailbox === mailbox && n.verlauf === verlauf))
      save()
    },
    async reloadEmails() {
      return clone(db.emails)
    },
    // Mail-Verfolgung wie meine_mail_spuren() (27_mail_spur.sql)
    async mailSpuren() {
      return asGuest ? [] : clone(mailSpurRows(db, me))
    },
    // Persönliche Einstellungen wie 21_nutzer_einstellungen.sql (Gäste haben keine)
    async loadPrefs() {
      if (asGuest) return {}
      const row = db.nutzer_einstellungen.find((r) => r.person === me)
      return row ? clone(row.werte) : {}
    },
    async savePrefs(email, werte) {
      if (asGuest) throw notAllowed()
      db.nutzer_einstellungen = [...db.nutzer_einstellungen.filter((r) => r.person !== me), { person: me, werte: clone(werte), updated_at: new Date().toISOString() }]
      save()
    },

    // Aktivitäten einer Aufgabe (nach dem Verschieben, die Datenbank kann eine anlegen)
    async fetchActivities(cardId) {
      if (asGuest && !sharedWithMe(cardId)) return []
      return clone(db.aktivitaeten.filter((a) => a.card_id === cardId))
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
        // Mail-Verfolgung: Spur ohne Ereignisse, Links aus dem eigenen Text (wie google-mail)
        if (payload.verfolgen === true) {
          const links = [...new Set(String(payload.text || '').match(/\bhttps?:\/\/[^\s<>"]*[^\s<>".,;:!?)\]'»“]/gi) || [])]
          db.mail_spuren.push({ id: crypto.randomUUID(), absender: me, mailbox: box.address, provider_id: 'demo-' + id, links, gesendet_at: now, ereignisse: [] })
        }
        save()
        return { ok: true, id, ...(payload.verfolgen === true ? { verfolgt: true } : {}) }
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
    // Weitere Kalender je Postfach wie 35_weitere_kalender.sql: nur eigene, Hauptkalender fest
    async mailboxCalendars() {
      const own = new Set(db.mailboxes.filter((b) => b.owner === me).map((b) => b.id))
      return clone((db.postfach_kalender || []).filter((k) => own.has(k.mailbox_id)))
    },
    async setMailboxCalendar(id, aktiv) {
      const k = (db.postfach_kalender || []).find((x) => x.id === id)
      const box = k && db.mailboxes.find((b) => b.id === k.mailbox_id)
      if (!k || !box || box.owner !== me || k.primaer) throw notAllowed()
      k.aktiv = !!aktiv
      const calId = box.address + '#' + k.google_id
      db.events = db.events.filter((e) => e.calendar_id !== calId)
      if (aktiv) {
        // Im Demo-Modus bringt ein eingeschalteter Kalender zwei erfundene Termine mit
        const owner = db.team_members.find((t) => t.email === box.owner)
        const name = `${k.name} (${owner ? owner.name : box.address})`
        const day = (n, h) => {
          const d = new Date()
          d.setDate(d.getDate() + n)
          d.setHours(h, 0, 0, 0)
          return d.toISOString()
        }
        ;[[1, 9, 'Teamrunde'], [3, 14, 'Abstimmung Woche']].forEach(([n, h, title]) =>
          db.events.push({ id: crypto.randomUUID(), calendar_id: calId, calendar_name: name, calendar_color: '#27836B', event_id: 'demo-' + crypto.randomUUID(), ical_uid: null, title, start_at: day(n, h), end_at: day(n, h + 1), all_day: false, location: null, meet_url: null, html_link: null, organizer: box.address, attendees: [box.address], description: null, status: 'confirmed', details: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        )
      }
      save()
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
      local.remove(CLAUDE_KEY)
      db = loadDb()
    },
  }
}

// Bild im Demo-Modus auf höchstens 640 Pixel verkleinern (als data-URL im Browser gespeichert)
async function demoPreview(file) {
  try {
    const url = URL.createObjectURL(file)
    const img = new Image()
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = reject
      img.src = url
    })
    const k = Math.min(1, 640 / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * k))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * k))
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
    URL.revokeObjectURL(url)
    return canvas.toDataURL('image/jpeg', 0.8)
  } catch {
    return null
  }
}
