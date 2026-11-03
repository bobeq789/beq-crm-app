// Zentraler Zustand der App: Daten, Anmeldung mit zweitem Faktor, Rolle, Meldungen, Dialoge, Farbschema.
// Änderungen erscheinen sofort und werden im Hintergrund gespeichert.
// Geht das Speichern schief, kommt eine Meldung und die Daten werden neu geladen.
import { useState, useEffect } from './lib/preact.js'
import { SETTINGS } from './settings.js'
import { uid, local, todayStr, firstName, initials, norm } from './lib/util.js'
import { prepareInsert, prepareUpdate, afterInsert, cascadeDelete, emptyDb } from './data/rules.js'
import { createDemoApi } from './data/demo.js'
import { createSupabaseApi } from './data/supabase.js'

const config = window.CRM_CONFIG || {}
const params = new URLSearchParams(location.search)
export const isDemo = !config.supabaseUrl || params.has('demo')
const demoAsGuest = isDemo && params.has('gast')

let api = null
const listeners = new Set()

export const state = {
  // loading, login, set-password, not-member, mfa-enroll, mfa-verify, ready, error
  auth: 'loading',
  authMessage: null,
  sessionEmail: null,
  me: null,
  role: null,
  adminName: null,
  mfaFactorId: null,
  db: emptyDb(),
  // Datensätze, deren lange Texte schon geladen sind
  full: { meetings: new Set(), emails: new Set() },
  loadedAt: 0,
  toasts: [],
  dialog: null,
}

export const isGuest = () => state.role === 'gast'
export const isAdmin = () => state.role === 'admin'

export function emit() {
  listeners.forEach((fn) => fn())
}

export function useStore() {
  const [, setTick] = useState(0)
  useEffect(() => {
    const fn = () => setTick((n) => n + 1)
    listeners.add(fn)
    // Falls sich vor dem Anmelden schon etwas geändert hat (Start läuft parallel)
    fn()
    return () => listeners.delete(fn)
  }, [])
  return state
}

// ------------------------------------------------------------
// Farbschema pro Gerät: auto, light, dark
// ------------------------------------------------------------
export const getTheme = () => local.get('beqcrm-theme', 'auto')
export function applyTheme() {
  const t = getTheme()
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t
  else delete document.documentElement.dataset.theme
  // Die Kopfleiste ist in beiden Schemata Navy, die Statusleiste passt dazu
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', '#0D1822')
}
export function setTheme(t) {
  local.set('beqcrm-theme', t)
  applyTheme()
  emit()
}
applyTheme()

// ------------------------------------------------------------
// Meldungen unten im Bild
// ------------------------------------------------------------
export function toast(text, opts = {}) {
  const t = { id: uid(), text, ...opts }
  state.toasts = [...state.toasts.filter((x) => !x.error || opts.error), t].slice(-3)
  emit()
  setTimeout(() => dismissToast(t.id), opts.duration || (opts.action ? 7000 : 4000))
}
export function dismissToast(id) {
  state.toasts = state.toasts.filter((t) => t.id !== id)
  emit()
}

// Verständliche Meldung statt technischem Code
export function errorText(err) {
  const msg = String((err && err.message) || err || '')
  const code = err && err.code
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) return 'Keine Verbindung. Bitte gleich noch einmal versuchen.'
  if (/Invalid login credentials/i.test(msg)) return 'E-Mail oder Passwort stimmt nicht.'
  if (/Email not confirmed/i.test(msg)) return 'Dein Konto ist noch nicht bestätigt. Bitte melde dich beim Admin.'
  if (/rate limit|too many/i.test(msg)) return 'Zu viele Versuche. Bitte warte ein paar Minuten.'
  if (/invalid.*(totp|code)|code.*invalid|otp/i.test(msg)) return 'Der Code stimmt nicht. Bitte nimm den aktuellen Code aus deiner App.'
  if (/should be different|same password/i.test(msg)) return 'Das neue Passwort muss sich vom alten unterscheiden.'
  if (/Password should be at least/i.test(msg)) return 'Das Passwort ist zu kurz.'
  if (/AAL2 required|aal2/i.test(msg)) return 'Dafür brauchst du den zweiten Faktor. Bitte melde dich neu an.'
  if (/JWT expired|session/i.test(msg)) return 'Deine Anmeldung ist abgelaufen. Bitte melde dich neu an.'
  if (/guest_guard|Gäste dürfen/i.test(msg)) return 'Als Gast kannst du hier nur Spalte, Dringlichkeit und Fälligkeit ändern.'
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) return 'Keine Berechtigung für diese Änderung.'
  if (code === '23503') return 'Das geht nicht, weil noch Einträge daran hängen.'
  if (code === '23505') return 'Diesen Eintrag gibt es schon.'
  if (code === '23514') return 'Eine Angabe passt nicht. Bitte prüfen.'
  if (code === 'demo') return msg
  return 'Das hat nicht geklappt. Bitte gleich noch einmal versuchen.'
}

// ------------------------------------------------------------
// Dialoge (Rückfrage, Eingabe, weitere Arten aus den Bereichen)
// ------------------------------------------------------------
export function openDialog(dialog) {
  state.dialog = dialog
  emit()
}
export function closeDialog() {
  state.dialog = null
  emit()
}
export function confirmDialog({ title, text, confirmLabel = 'OK', danger = false }) {
  return new Promise((resolve) => openDialog({ kind: 'confirm', title, text, confirmLabel, danger, resolve }))
}
export function promptDialog({ title, label, value = '', confirmLabel = 'Speichern' }) {
  return new Promise((resolve) => openDialog({ kind: 'prompt', title, label, value, confirmLabel, resolve }))
}

// ------------------------------------------------------------
// Start und Anmeldung: Sitzung, Rolle, zweiter Faktor, Daten
// ------------------------------------------------------------
export async function boot() {
  try {
    api = isDemo ? createDemoApi({ asGuest: demoAsGuest }) : await createSupabaseApi(config)
  } catch (err) {
    return fail(err)
  }
  if (api.mode === 'supabase') {
    api.onAuthChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        state.auth = 'set-password'
        emit()
      }
      if (event === 'SIGNED_OUT' && state.auth !== 'login') {
        resetSession()
        state.auth = 'login'
        emit()
      }
    })
    if (api.linkError) {
      state.authMessage = 'Der Link aus der Mail ist abgelaufen oder wurde schon benutzt. Bitte fordere einen neuen an oder melde dich beim Admin.'
    }
  }
  let session = null
  try {
    session = await api.getSession()
  } catch (err) {
    state.authMessage = errorText(err)
  }
  if (!session) {
    state.auth = 'login'
    return emit()
  }
  state.sessionEmail = session.email
  if (api.linkType === 'recovery' || api.linkType === 'invite') {
    state.auth = 'set-password'
    if (location.hash.includes('access_token')) history.replaceState(null, '', location.pathname + location.search + '#/')
    return emit()
  }
  await afterLogin(session.email)
}

function fail(err) {
  state.auth = 'error'
  state.authMessage = errorText(err)
  emit()
}

function resetSession() {
  state.me = null
  state.role = null
  state.mfaFactorId = null
  state.db = emptyDb()
  state.full = { meetings: new Set(), emails: new Set() }
}

// Nach Passwort: freigeschaltet? zweiter Faktor? Dann Daten laden.
export async function afterLogin(email) {
  state.sessionEmail = email
  state.auth = 'loading'
  emit()
  try {
    const role = await api.myRole()
    if (!role) {
      state.adminName = await api.adminName()
      state.auth = 'not-member'
      return emit()
    }
    state.role = role
    const mfa = await api.mfaStatus()
    if (mfa.level !== 'aal2') {
      if (mfa.factors.length) {
        state.mfaFactorId = mfa.factors[0].id
        state.auth = 'mfa-verify'
      } else {
        state.auth = 'mfa-enroll'
      }
      return emit()
    }
    await enterApp()
  } catch (err) {
    fail(err)
  }
}

async function enterApp() {
  await reload(true)
  const email = norm(state.sessionEmail)
  state.me = state.db.team_members.find((t) => norm(t.email) === email) || { email: state.sessionEmail, name: state.sessionEmail, role: state.role }
  state.auth = 'ready'
  emit()
}

// Zweiter Faktor: einrichten, prüfen, neu einrichten
export const mfaEnroll = () => api.mfaEnroll()
export async function mfaVerify(factorId, code) {
  await api.mfaVerify(factorId, code)
}
export async function mfaFinishLogin() {
  try {
    await enterApp()
  } catch (err) {
    fail(err)
  }
}
export const mfaRemoveOthers = (keepId) => api.mfaRemoveOthers(keepId)

export async function reload(throwErrors = false) {
  try {
    state.db = await api.loadAll(state.role)
    state.full = { meetings: new Set(), emails: new Set() }
    if (isDemo) {
      // Im Demo-Modus ist alles schon vollständig
      state.db.meetings.forEach((m) => state.full.meetings.add(m.id))
      state.db.emails.forEach((m) => state.full.emails.add(m.id))
    }
    state.loadedAt = Date.now()
    emit()
  } catch (err) {
    if (throwErrors) throw err
    toast(errorText(err), { error: true })
  }
}

// Lange Texte (Zusammenfassung, Mailtext) erst beim Öffnen laden
export async function ensureFull(table, id) {
  if (!id || state.full[table].has(id)) return
  try {
    const row = await api.fetchRow(table, id)
    if (row) {
      state.full[table].add(id)
      replaceRow(table, row)
      state.db = { ...state.db }
      emit()
    }
  } catch (err) {
    toast(errorText(err), { error: true })
  }
}
export const searchMeetingSummaries = (q) => api.searchMeetingSummaries(q)

export async function signIn(email, password) {
  await api.signIn(email, password)
  local.set('beqcrm-last-email', email)
  await afterLogin(email)
}
export async function signOut() {
  state.auth = 'login'
  resetSession()
  emit()
  await api.signOut()
}
export const resetPassword = (email) => api.resetPassword(email)
export const updatePassword = (pw) => api.updatePassword(pw)
export function resetDemo() {
  if (api && api.reset) {
    api.reset()
    reload()
  }
}

// Kommt man in die App zurück, Daten neu laden (Handy und Rechner zeigen denselben Stand)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.auth === 'ready' && Date.now() - state.loadedAt > 20000) reload()
})

// ------------------------------------------------------------
// Ändern: sofort anzeigen, im Hintergrund speichern
// ------------------------------------------------------------
async function failed(err) {
  toast(errorText(err), { error: true })
  await reload()
}

function replaceRow(table, row) {
  state.db[table] = state.db[table].map((x) => (x.id === row.id ? { ...x, ...row } : x))
}

export async function insert(table, row) {
  const db = { ...state.db }
  const r = prepareInsert(table, row, state.me && state.me.email)
  db[table] = [...db[table], r]
  afterInsert(db, table, r)
  state.db = db
  if (state.full[table]) state.full[table].add(r.id)
  emit()
  try {
    const saved = await api.insert(table, r)
    replaceRow(table, saved)
    emit()
    return saved
  } catch (err) {
    await failed(err)
    return null
  }
}

export async function update(table, id, patch) {
  const old = state.db[table].find((x) => x.id === id)
  if (!old) return null
  replaceRow(table, prepareUpdate(table, old, patch))
  state.db = { ...state.db }
  emit()
  try {
    const saved = await api.update(table, id, patch)
    replaceRow(table, saved)
    emit()
    return saved
  } catch (err) {
    await failed(err)
    return null
  }
}

export async function remove(table, id) {
  const db = { ...state.db }
  db[table] = db[table].filter((x) => x.id !== id)
  cascadeDelete(db, table, id)
  state.db = db
  emit()
  try {
    await api.remove(table, id)
    return true
  } catch (err) {
    await failed(err)
    return false
  }
}

// ------------------------------------------------------------
// Abfragen
// ------------------------------------------------------------
const byId = (table, id) => (id ? state.db[table].find((x) => x.id === id) : null)
export const getProject = (id) => byId('projects', id)
export const getStage = (id) => byId('stages', id)
export const getPerson = (id) => byId('persons', id)
export const getOrg = (id) => byId('organizations', id)
export const getMeeting = (id) => byId('meetings', id)
export const getCard = (id) => byId('cards', id)
export const getEvent = (id) => byId('events', id)

export function member(email) {
  if (!email) return null
  return state.db.team_members.find((t) => norm(t.email) === norm(email)) || null
}
export function memberName(email) {
  const m = member(email)
  return m ? m.name : email || ''
}
export function memberInitials(email) {
  return initials(memberName(email))
}
// Teammitglieder, die Aufgaben übernehmen können (ohne Gäste)
export function activeMembers() {
  return state.db.team_members.filter((t) => t.active && t.role !== 'gast').sort((a, b) => a.name.localeCompare(b.name, 'de'))
}
export function activeGuests() {
  return state.db.team_members.filter((t) => t.active && t.role === 'gast').sort((a, b) => a.name.localeCompare(b.name, 'de'))
}
export const myEmail = () => (state.me ? state.me.email : state.sessionEmail || '')

export function activeProjects() {
  return state.db.projects.filter((p) => !p.archived).sort((a, b) => a.sort - b.sort)
}
export function stagesOf(projectId) {
  return state.db.stages.filter((s) => s.project_id === projectId).sort((a, b) => a.sort - b.sort)
}
export function stageOfKind(projectId, kind) {
  const list = stagesOf(projectId)
  return list.find((s) => s.kind === kind) || list[0] || null
}
export function cardKind(card) {
  const s = getStage(card.stage_id)
  return s ? s.kind : 'todo'
}
export function defaultProjectId() {
  const list = activeProjects()
  const allgemein = list.find((p) => p.name === SETTINGS.defaultProjectName)
  return (allgemein || list[0] || {}).id || null
}
export function notesFor(field, id) {
  return state.db.notes.filter((n) => n[field] === id).sort((a, b) => b.created_at.localeCompare(a.created_at))
}
export function personsOfOrg(orgId) {
  return state.db.persons.filter((p) => p.org_id === orgId).sort((a, b) => a.name.localeCompare(b.name, 'de'))
}
export function personByEmail(email) {
  const e = norm(email)
  if (!e) return null
  return state.db.persons.find((p) => (p.emails || []).some((x) => norm(x) === e)) || null
}
export function meetingPersons(meetingId) {
  const ids = new Set(state.db.meeting_persons.filter((m) => m.meeting_id === meetingId).map((m) => m.person_id))
  return state.db.persons.filter((p) => ids.has(p.id))
}
export function meetingsOfPerson(personId) {
  const ids = new Set(state.db.meeting_persons.filter((m) => m.person_id === personId).map((m) => m.meeting_id))
  return state.db.meetings.filter((m) => ids.has(m.id)).sort((a, b) => b.held_at.localeCompare(a.held_at))
}
export function meetingsOfOrg(orgId) {
  const people = new Set(personsOfOrg(orgId).map((p) => p.id))
  const ids = new Set(state.db.meeting_persons.filter((m) => people.has(m.person_id)).map((m) => m.meeting_id))
  return state.db.meetings.filter((m) => ids.has(m.id)).sort((a, b) => b.held_at.localeCompare(a.held_at))
}
// Offene Aufgaben: nicht erledigt und nicht archiviert
export function isOpen(card) {
  return !card.archived && cardKind(card) !== 'done'
}
export function allLabels() {
  const set = new Set(SETTINGS.labels)
  state.db.persons.forEach((p) => (p.labels || []).forEach((l) => set.add(l)))
  state.db.organizations.forEach((o) => (o.labels || []).forEach((l) => set.add(l)))
  return [...set]
}
export function sharesOf(cardId) {
  return state.db.card_shares.filter((s) => s.card_id === cardId)
}

// Termine: Kalender, Zeitraum, Bezug zu Kontakten
export function calendars() {
  const map = new Map()
  state.db.events.forEach((e) => {
    if (!map.has(e.calendar_id)) map.set(e.calendar_id, { id: e.calendar_id, name: e.calendar_name || e.calendar_id, color: e.calendar_color || '#37BA98' })
  })
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'))
}
export function isMyEvent(ev) {
  const me = norm(myEmail())
  return norm(ev.calendar_id) === me || (ev.attendees || []).some((a) => norm(a) === me)
}
export function eventsOfPerson(personId) {
  const person = getPerson(personId)
  const mails = new Set((person ? person.emails : []).map(norm))
  const linked = new Set(state.db.event_persons.filter((x) => x.person_id === personId).map((x) => x.event_id))
  return state.db.events
    .filter((e) => e.status !== 'cancelled' && (linked.has(e.id) || (e.attendees || []).some((a) => mails.has(norm(a)))))
    .sort((a, b) => a.start_at.localeCompare(b.start_at))
}
// Meeting zur selben Zeit wie ein Termin (höchstens 30 Minuten auseinander)
export function meetingForEvent(ev) {
  const t = new Date(ev.start_at).getTime()
  return state.db.meetings.find((m) => Math.abs(new Date(m.held_at).getTime() - t) <= 30 * 60000) || null
}

// Mails zu einer Gruppe von Kontakten, jede Mail nur einmal, neueste zuerst
export function emailsOfPersons(personIds) {
  const ids = new Set(personIds)
  const mailIds = new Set(state.db.email_persons.filter((x) => ids.has(x.person_id)).map((x) => x.email_id))
  return state.db.emails.filter((m) => mailIds.has(m.id)).sort((a, b) => String(b.sent_at).localeCompare(String(a.sent_at)))
}

// ------------------------------------------------------------
// Häufige Aktionen
// ------------------------------------------------------------

// Aufgabe abhaken: in die Spalte „done“, mit Rückgängig
export async function completeCard(card) {
  const done = stageOfKind(card.project_id, 'done')
  if (!done || done.id === card.stage_id) return
  const before = card.stage_id
  await update('cards', card.id, { stage_id: done.id })
  toast(`„${card.title}“ erledigt`, {
    action: { label: 'Rückgängig', run: () => update('cards', card.id, { stage_id: before }) },
  })
}

export async function createCard(fields) {
  const projectId = fields.project_id || defaultProjectId()
  const stage = fields.stage_id ? getStage(fields.stage_id) : stageOfKind(projectId, fields.kind || 'todo')
  const row = { ...fields, project_id: projectId, stage_id: stage && stage.id }
  delete row.kind
  return insert('cards', row)
}

// Neues Projekt mit den Standardspalten
export async function createProject(name) {
  const sort = Math.max(0, ...state.db.projects.map((p) => p.sort)) + 1
  const used = new Set(state.db.projects.map((p) => p.color))
  const color = (SETTINGS.projectColors.find((c) => !used.has(c.value)) || SETTINGS.projectColors[0]).value
  const project = await insert('projects', { name, color, sort })
  if (!project) return null
  for (const [i, st] of SETTINGS.defaultStages.entries()) {
    await insert('stages', { project_id: project.id, name: st.name, kind: st.kind, sort: i + 1 })
  }
  return project
}

// Teammitglied zu einem Namen aus einem Action Item („Anna“ oder „Anna Berger“)
export function memberByName(name) {
  const n = norm(name)
  if (!n) return null
  const list = activeMembers()
  return list.find((m) => norm(m.name) === n) || list.find((m) => norm(firstName(m.name)) === n) || null
}

export function personByName(name, candidates) {
  const n = norm(name)
  if (!n) return null
  const list = candidates || state.db.persons
  return list.find((p) => norm(p.name) === n) || list.find((p) => norm(firstName(p.name)) === n) || null
}

export const today = () => todayStr()
