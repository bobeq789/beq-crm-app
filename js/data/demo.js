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
  afterInsert,
  cascadeDelete,
  guestView,
  dbError,
  TABLES,
} from './rules.js'

const KEY = 'beqcrm-demo-v2'
const clone = (x) => JSON.parse(JSON.stringify(x))

function loadDb() {
  const saved = local.get(KEY)
  if (saved && TABLES.every((t) => Array.isArray(saved[t]))) return saved
  const db = buildSeed()
  local.set(KEY, db)
  return db
}

export function createDemoApi({ asGuest = false } = {}) {
  let db = loadDb()
  const me = asGuest ? DEMO_GUEST : DEMO_ME
  const save = () => local.set(KEY, db)
  const find = (table, id) => db[table].find((x) => x.id === id)
  const sharedWithMe = (cardId) => db.card_shares.some((s) => s.card_id === cardId && s.email === me)
  const notAllowed = () => dbError('42501', 'permission denied')

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
        const ok = table === 'notes' && r.card_id && !r.internal && !r.person_id && !r.org_id && !r.meeting_id && sharedWithMe(r.card_id)
        if (!ok) throw notAllowed()
      }
      checkInsert(db, table, r)
      db[table] = [...db[table], r]
      afterInsert(db, table, r)
      save()
      return clone(r)
    },

    async update(table, id, patch) {
      const old = find(table, id)
      if (!old) throw dbError('PGRST116', 'not found')
      if (asGuest) {
        if (table === 'cards' && sharedWithMe(id)) checkGuestCardUpdate(db, old, patch)
        else if (table === 'notes' && old.author === me && !old.internal && sharedWithMe(old.card_id)) patch = { content: patch.content ?? old.content }
        else throw notAllowed()
      }
      const r = prepareUpdate(table, old, patch)
      db[table] = db[table].map((x) => (x.id === id ? r : x))
      save()
      return clone(r)
    },

    async remove(table, id) {
      if (asGuest) throw notAllowed()
      checkDelete(db, table, id)
      db[table] = db[table].filter((x) => x.id !== id)
      cascadeDelete(db, table, id)
      save()
    },

    // Beispieldaten neu erzeugen
    reset() {
      local.remove(KEY)
      db = loadDb()
    },
  }
}
