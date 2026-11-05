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

    async remove(table, id) {
      if (asGuest) throw notAllowed()
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
