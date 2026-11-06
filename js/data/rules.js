// Regeln, die in Supabase die Datenbank selbst übernimmt (Standardwerte, Trigger, Kaskaden, Grenzen für Gäste).
// Der Demo-Modus nutzt sie als „Datenbank“, die App nutzt sie, um Änderungen sofort anzuzeigen.
import { uid, nowIso } from '../lib/util.js'

export const TABLES = [
  'team_members',
  'projects',
  'stages',
  'organizations',
  'persons',
  'meetings',
  'meeting_persons',
  'cards',
  'card_shares',
  'notes',
  'events',
  'event_persons',
  'emails',
  'email_persons',
]

// Verlauf und „gesehen“: nicht beim Start geladen, sondern je Karte bzw. als Marken
export const EXTRA_TABLES = ['card_events', 'card_seen']

// Beim Start geladen, aber verzichtbar: fehlt die Tabelle (SQL-Datei noch nicht
// ausgeführt), bleibt die Liste einfach leer
export const OPTIONAL_TABLES = ['project_shares', 'products', 'deals', 'deal_items', 'mailboxes']

// Nur im Demo-Modus: Dateien an Aufgaben (in Supabase liegen sie im Storage, nicht in einer Tabelle)
export const DEMO_TABLES = ['files']

const WITH_UPDATED_AT = new Set(['projects', 'organizations', 'persons', 'meetings', 'cards', 'notes', 'events', 'products', 'deals'])
const WITH_CREATED_AT = new Set(['team_members', 'projects', 'stages', 'organizations', 'persons', 'meetings', 'cards', 'card_shares', 'project_shares', 'notes', 'emails', 'products', 'deals', 'deal_items'])

const DEFAULTS = {
  team_members: { role: 'mitglied', active: true, sales_team: null, team_lead: false },
  projects: { color: '#37BA98', sort: 0, archived: false },
  stages: { sort: 0, probability: null },
  organizations: { website: null, domain: null, address: null, industry: null, labels: [], external_id: null },
  persons: { org_id: null, position: null, emails: [], phones: [], linkedin_url: null, labels: [], external_id: null },
  meetings: {
    duration_min: null,
    project_id: null,
    summary: null,
    action_items: null,
    extra_names: [],
    source: 'manuell',
    external_id: null,
    created_by: null,
  },
  meeting_persons: {},
  cards: {
    description: null,
    person_id: null,
    org_id: null,
    assignee: null,
    priority: null,
    due_date: null,
    archived: false,
    meeting_id: null,
    external_id: null,
    created_by: null,
  },
  card_shares: { created_by: null },
  project_shares: { created_by: null },
  products: { price_cents: 0, places: 0, bonus_places: 0, active: true, sort: 0 },
  deals: { status: 'offen', value_cents: 0, probability: null, expected_close: null, closed_at: null, lost_reason: null, external_id: null, created_by: null },
  deal_items: { product_id: null, quantity: 1, unit_price_cents: 0, discount_percent: 0, places: 0, bonus_places: 0, sort: 0 },
  notes: { card_id: null, person_id: null, org_id: null, meeting_id: null, internal: false, author: null, external_id: null, mentions: [] },
  events: { all_day: false, attendees: [], location: null, meet_url: null, html_link: null, description: null, status: 'confirmed' },
  event_persons: {},
  emails: { to_emails: [], cc_emails: [], attachments: [] },
  email_persons: {},
}

// Neuer Datensatz mit allem, was die Datenbank selbst ergänzt
export function prepareInsert(table, row, me) {
  const now = nowIso()
  const r = { ...DEFAULTS[table], ...row }
  if (!r.id) r.id = uid()
  if (WITH_CREATED_AT.has(table) && !r.created_at) r.created_at = now
  if (WITH_UPDATED_AT.has(table)) r.updated_at = r.updated_at || now
  if ((table === 'cards' || table === 'meetings' || table === 'deals') && me) r.created_by = me
  if (table === 'deals') dealDates(r)
  if (table === 'cards' && !r.stage_changed_at) r.stage_changed_at = now
  if (table === 'notes' && me) r.author = me
  // Wer geteilt hat (Standardwert in 05_projekte_teilen.sql)
  if ((table === 'card_shares' || table === 'project_shares') && me && !r.created_by) r.created_by = me
  return r
}

// Geänderter Datensatz: updated_at, Spaltenwechsel, Autor bleibt
export function prepareUpdate(table, old, patch) {
  const r = { ...old, ...patch }
  if (WITH_UPDATED_AT.has(table)) r.updated_at = nowIso()
  if (table === 'cards' && 'stage_id' in patch && patch.stage_id !== old.stage_id) r.stage_changed_at = nowIso()
  if ('created_by' in old) r.created_by = old.created_by
  if (table === 'notes') r.author = old.author
  if (table === 'deals') dealDates(r)
  return r
}

// Deal: Abschlussdatum folgt dem Status (wie tg_deals_before() in 08_sales.sql)
function dealDates(r) {
  r.owner = String(r.owner || '').toLowerCase()
  if ((r.status === 'gewonnen' || r.status === 'verloren') && !r.closed_at) r.closed_at = nowIso().slice(0, 10)
  if (r.status === 'offen') r.closed_at = null
  if (r.status !== 'verloren') r.lost_reason = null
}

// Wert eines Deals aus seinen Produktzeilen (wie tg_deal_items_sum() in 08_sales.sql).
// Ohne Produktzeilen bleibt der eingegebene Wert.
export function itemTotal(item) {
  return Math.round((Number(item.quantity) * Number(item.unit_price_cents) * (100 - Number(item.discount_percent || 0))) / 100)
}
export function recalcDeal(db, dealId) {
  const items = (db.deal_items || []).filter((i) => i.deal_id === dealId)
  if (!items.length) return
  const value = items.reduce((sum, i) => sum + itemTotal(i), 0)
  db.deals = db.deals.map((d) => (d.id === dealId ? { ...d, value_cents: value } : d))
}

// Darf „me“ die Zahlen dieses Besitzers sehen? (wie can_see_sales() in 08_sales.sql)
export function canSeeSales(db, me, owner) {
  const self = db.team_members.find((t) => t.email.toLowerCase() === String(me).toLowerCase() && t.active)
  if (!self || self.role === 'gast') return false
  const o = String(owner || '').toLowerCase()
  if (self.role === 'admin' || o === self.email.toLowerCase()) return true
  if (!self.team_lead || !self.sales_team) return false
  return db.team_members.some((t) => t.email.toLowerCase() === o && t.sales_team === self.sales_team)
}

// Fehler wie aus der Datenbank, damit beide Wege gleich reagieren
export function dbError(code, message) {
  const e = new Error(message)
  e.code = code
  return e
}

// Prüfungen, die in Supabase Einschränkungen der Tabellen übernehmen
export function checkInsert(db, table, row) {
  if (table === 'stages' && row.kind === 'done' && db.stages.some((s) => s.project_id === row.project_id && s.kind === 'done')) {
    throw dbError('23505', 'stages_one_done_per_project')
  }
  if (table === 'notes' && !row.card_id && !row.person_id && !row.org_id && !row.meeting_id) {
    throw dbError('23514', 'notes_has_parent')
  }
  const pairs = { meeting_persons: ['meeting_id', 'person_id'], event_persons: ['event_id', 'person_id'], email_persons: ['email_id', 'person_id'] }
  if (pairs[table]) {
    const [a, b] = pairs[table]
    if (db[table].some((m) => m[a] === row[a] && m[b] === row[b])) throw dbError('23505', table + '_unique')
  }
  if (table === 'card_shares' && db.card_shares.some((s) => s.card_id === row.card_id && s.email.toLowerCase() === row.email.toLowerCase())) {
    throw dbError('23505', 'card_shares_unique')
  }
  if (table === 'project_shares' && db.project_shares.some((s) => s.project_id === row.project_id && s.email.toLowerCase() === row.email.toLowerCase())) {
    throw dbError('23505', 'project_shares_unique')
  }
}

export function checkDelete(db, table, id) {
  if (table === 'stages' && db.cards.some((c) => c.stage_id === id)) throw dbError('23503', 'cards_stage_id_fkey')
  if (table === 'projects' && db.cards.some((c) => c.project_id === id)) throw dbError('23503', 'cards_project_id_fkey')
}

// Aktives Teammitglied (admin oder mitglied), wie is_team_address() in 04_zustaendig.sql
export function isTeamAddress(db, address) {
  const a = String(address || '').toLowerCase()
  return db.team_members.some((t) => t.email.toLowerCase() === a && t.active && t.role !== 'gast')
}

// Gäste: an einer Karte nur Spalte (im selben Projekt), Dringlichkeit, Fälligkeit und
// Zuständig (sich selbst, ein Teammitglied oder niemand), wie 04_zustaendig.sql
export function checkGuestCardUpdate(db, old, patch, me) {
  const allowed = new Set(['stage_id', 'priority', 'due_date', 'assignee'])
  if (Object.keys(patch).some((k) => !allowed.has(k))) throw dbError('42501', 'guest_guard')
  if ('stage_id' in patch && !db.stages.some((s) => s.id === patch.stage_id && s.project_id === old.project_id)) {
    throw dbError('42501', 'guest_guard_stage')
  }
  const a = patch.assignee
  if ('assignee' in patch && a && a.toLowerCase() !== String(me).toLowerCase() && !isTeamAddress(db, a)) {
    throw dbError('42501', 'guest_guard_assignee')
  }
}

// Gast legt eine Aufgabe in einem ganz geteilten Projekt an (guest_insert in 05_projekte_teilen.sql)
export function checkGuestCardInsert(db, row, me) {
  const shared = db.project_shares.some((s) => s.project_id === row.project_id && s.email.toLowerCase() === String(me).toLowerCase())
  const stageOk = db.stages.some((s) => s.id === row.stage_id && s.project_id === row.project_id)
  const a = row.assignee
  const assigneeOk = !a || a.toLowerCase() === String(me).toLowerCase() || isTeamAddress(db, a)
  if (!shared || row.person_id || row.org_id || row.meeting_id || row.archived || !stageOk || !assigneeOk) {
    throw dbError('42501', 'new row violates row-level security policy')
  }
}

// Weist ein Teammitglied einem Gast zu, wird die Karte mit ihm geteilt (Trigger
// share_assignee in 04_zustaendig.sql). Gibt die neue Freigabe zurück oder null.
export function autoShareFor(db, old, card) {
  const a = String(card.assignee || '').toLowerCase()
  if (!a || (old && String(old.assignee || '').toLowerCase() === a)) return null
  const guest = db.team_members.some((t) => t.email.toLowerCase() === a && t.active && t.role === 'gast')
  if (!guest || db.card_shares.some((s) => s.card_id === card.id && s.email.toLowerCase() === a)) return null
  return { id: uid(), card_id: card.id, email: a, created_at: nowIso() }
}

// Letzte Zuweisung je Karte (wie last_handovers() in 04_zustaendig.sql)
export function lastHandovers(db) {
  const map = new Map()
  ;(db.card_events || []).forEach((e) => {
    if (e.kind !== 'zustaendig') return
    const prev = map.get(e.card_id)
    if (!prev || e.at > prev.at) map.set(e.card_id, { card_id: e.card_id, actor: (e.actor || '').toLowerCase(), at: e.at, assignee: e.detail || null })
  })
  return [...map.values()]
}

// Eine neue Notiz schiebt Aufgabe, Kontakt und Firma nach oben
export function afterInsert(db, table, row) {
  if (table !== 'notes') return
  const now = row.created_at || nowIso()
  const touch = (t, id) => {
    if (!id) return
    db[t] = db[t].map((x) => (x.id === id ? { ...x, updated_at: now } : x))
  }
  touch('cards', row.card_id)
  touch('persons', row.person_id)
  touch('organizations', row.org_id)
}

// Was beim Löschen mit abhängigen Einträgen passiert (wie in 01_schema.sql)
export function cascadeDelete(db, table, id) {
  const drop = (t, field) => {
    db[t] = db[t].filter((x) => x[field] !== id)
  }
  const unset = (t, field) => {
    db[t] = db[t].map((x) => (x[field] === id ? { ...x, [field]: null } : x))
  }
  if (table === 'projects') {
    drop('stages', 'project_id')
    if (db.project_shares) drop('project_shares', 'project_id')
    unset('meetings', 'project_id')
  }
  if (table === 'cards') {
    drop('notes', 'card_id')
    drop('card_shares', 'card_id')
    if (db.card_events) drop('card_events', 'card_id')
    if (db.card_seen) drop('card_seen', 'card_id')
    if (db.files) drop('files', 'card_id')
    if (db.deals) {
      const gone = new Set(db.deals.filter((d) => d.card_id === id).map((d) => d.id))
      db.deals = db.deals.filter((d) => d.card_id !== id)
      db.deal_items = db.deal_items.filter((i) => !gone.has(i.deal_id))
    }
  }
  if (table === 'deals' && db.deal_items) drop('deal_items', 'deal_id')
  if (table === 'products' && db.deal_items) unset('deal_items', 'product_id')
  if (table === 'persons') {
    drop('notes', 'person_id')
    drop('meeting_persons', 'person_id')
    drop('event_persons', 'person_id')
    drop('email_persons', 'person_id')
    unset('cards', 'person_id')
  }
  if (table === 'organizations') {
    drop('notes', 'org_id')
    unset('persons', 'org_id')
    unset('cards', 'org_id')
  }
  if (table === 'meetings') {
    drop('notes', 'meeting_id')
    drop('meeting_persons', 'meeting_id')
    unset('cards', 'meeting_id')
  }
  if (table === 'events') drop('event_persons', 'event_id')
  if (table === 'emails') drop('email_persons', 'email_id')
}

export function emptyDb() {
  return Object.fromEntries([...TABLES, ...OPTIONAL_TABLES, ...EXTRA_TABLES, ...DEMO_TABLES].map((t) => [t, []]))
}

// ------------------------------------------------------------
// Verlauf wie der Trigger in 03_verlauf.sql (für den Demo-Modus)
// ------------------------------------------------------------
function event(cardId, actor, kind, detail, at) {
  return { id: uid(), card_id: cardId, at: at || nowIso(), actor: actor || null, kind, detail: detail ?? null }
}

export function cardEventsFor(db, op, oldCard, card, actor) {
  const stageName = (id) => (db.stages.find((s) => s.id === id) || {}).name || ''
  const projectName = (id) => (db.projects.find((p) => p.id === id) || {}).name || ''
  if (op === 'insert') return [event(card.id, actor, 'angelegt', stageName(card.stage_id), card.created_at)]
  const out = []
  if (card.project_id !== oldCard.project_id) out.push(event(card.id, actor, 'projekt', projectName(card.project_id)))
  if (card.stage_id !== oldCard.stage_id) out.push(event(card.id, actor, 'spalte', stageName(card.stage_id)))
  if ((card.priority || null) !== (oldCard.priority || null)) out.push(event(card.id, actor, 'dringlichkeit', card.priority || ''))
  if ((card.due_date || null) !== (oldCard.due_date || null)) out.push(event(card.id, actor, 'faelligkeit', card.due_date || ''))
  if ((card.assignee || null) !== (oldCard.assignee || null)) out.push(event(card.id, actor, 'zustaendig', (card.assignee || '').toLowerCase()))
  if (card.title !== oldCard.title) out.push(event(card.id, actor, 'titel', card.title))
  if (!!card.archived !== !!oldCard.archived) out.push(event(card.id, actor, 'archiv', card.archived ? 'archiviert' : 'zurueckgeholt'))
  return out
}

// Neue Notiz bzw. geänderte Notiz (wie tg_note_events() in 06_erwaehnungen.sql):
// „notiz“ beim Anlegen, dazu je neue Erwähnung „erwaehnung“. „Nur intern“ schreibt nichts.
export function noteEventsFor(note, actor, old = null) {
  if (!note.card_id || note.internal) return []
  const list = old ? [] : [event(note.card_id, actor, 'notiz', null, note.created_at)]
  const before = old && !old.internal ? new Set(old.mentions || []) : new Set()
  ;(note.mentions || []).filter((m) => !before.has(m)).forEach((m) => list.push(event(note.card_id, actor, 'erwaehnung', m)))
  return list
}

// Erwähnungen bereinigen (wie tg_notes_mentions() in 06_erwaehnungen.sql): klein, ohne
// Doppelte, nur aktive Nutzer. Gäste erwähnen nur das Team und sich selbst. „Nur intern“ niemanden.
export function cleanMentions(db, note, me, asGuest) {
  if (note.internal || !note.card_id) return []
  const self = String(me || '').toLowerCase()
  const list = [...new Set((note.mentions || []).map((m) => String(m).trim().toLowerCase()))]
  return list
    .filter((m) => {
      const t = db.team_members.find((x) => x.email.toLowerCase() === m && x.active)
      return t && (!asGuest || t.role !== 'gast' || m === self)
    })
    .sort()
}

// Teammitglied erwähnt Gäste, die die Karte nicht sehen: Freigaben dafür (wie 06_erwaehnungen.sql)
export function mentionSharesFor(db, note, old = null) {
  if (!note.card_id || note.internal) return []
  const card = db.cards.find((c) => c.id === note.card_id)
  const before = old && !old.internal ? new Set(old.mentions || []) : new Set()
  return (note.mentions || [])
    .filter((m) => !before.has(m))
    .filter((m) => db.team_members.some((t) => t.email.toLowerCase() === m && t.active && t.role === 'gast'))
    .filter((m) => !db.card_shares.some((s) => s.card_id === note.card_id && s.email.toLowerCase() === m))
    .filter((m) => !(card && (db.project_shares || []).some((s) => s.project_id === card.project_id && s.email.toLowerCase() === m)))
    .map((m) => ({ id: uid(), card_id: note.card_id, email: m, created_by: null, created_at: nowIso() }))
}

// Karten mit Marke „Neu“ (wie my_card_flags() in 03_verlauf.sql)
export function cardFlags(db, email, teamSince) {
  const me = String(email || '').toLowerCase()
  const since = new Date(teamSince || Date.now())
  since.setHours(0, 0, 0, 0)
  const seen = new Map(db.card_seen.filter((s) => s.email === me).map((s) => [s.card_id, s.seen_at]))
  const flags = new Map()
  db.card_events.forEach((e) => {
    if (!e.actor || e.actor.toLowerCase() === me) return
    if (new Date(e.at) < since) return
    const s = seen.get(e.card_id)
    if (s && e.at <= s) return
    const f = flags.get(e.card_id) || { card_id: e.card_id, is_new: true, mentioned: false, last_change: e.at }
    if (e.kind === 'erwaehnung' && String(e.detail || '').toLowerCase() === me) f.mentioned = true
    if (e.at > f.last_change) f.last_change = e.at
    flags.set(e.card_id, f)
  })
  return [...flags.values()]
}

// Was ein Gast sehen darf (wie die Regeln in 01_schema.sql)
export function guestView(db, email) {
  const me = String(email || '').toLowerCase()
  const sharedProjects = new Set((db.project_shares || []).filter((s) => s.email.toLowerCase() === me).map((s) => s.project_id))
  const shared = new Set(db.card_shares.filter((s) => s.email.toLowerCase() === me).map((s) => s.card_id))
  db.cards.forEach((c) => sharedProjects.has(c.project_id) && shared.add(c.id))
  const cards = db.cards.filter((c) => shared.has(c.id))
  const projectIds = new Set([...cards.map((c) => c.project_id), ...sharedProjects])
  const personIds = new Set(cards.map((c) => c.person_id).filter(Boolean))
  const orgIds = new Set(cards.map((c) => c.org_id).filter(Boolean))
  const view = emptyDb()
  // Gäste sehen das Team und sich selbst, keine anderen Gäste (crm_users() in 04_zustaendig.sql)
  view.team_members = db.team_members.filter((t) => t.active && (t.role !== 'gast' || t.email.toLowerCase() === me)).map(({ email: e, name, role }) => ({ id: e, email: e, name, role, active: true }))
  view.projects = db.projects.filter((p) => projectIds.has(p.id))
  view.stages = db.stages.filter((s) => projectIds.has(s.project_id))
  view.persons = db.persons.filter((p) => personIds.has(p.id))
  view.organizations = db.organizations.filter((o) => orgIds.has(o.id))
  view.cards = cards
  view.card_shares = db.card_shares.filter((s) => s.email.toLowerCase() === me)
  view.project_shares = (db.project_shares || []).filter((s) => s.email.toLowerCase() === me)
  view.notes = db.notes.filter((n) => !n.internal && n.card_id && shared.has(n.card_id))
  view.card_events = (db.card_events || []).filter((e) => shared.has(e.card_id))
  view.card_seen = (db.card_seen || []).filter((x) => x.email === me)
  view.files = (db.files || []).filter((f) => shared.has(f.card_id))
  return view
}
