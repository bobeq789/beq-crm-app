// Zentraler Zustand der App: Daten, Anmeldung mit zweitem Faktor, Rolle, Meldungen, Dialoge, Farbschema.
// Änderungen erscheinen sofort und werden im Hintergrund gespeichert.
// Geht das Speichern schief, kommt eine Meldung und die Daten werden neu geladen.
import { useState, useEffect } from './lib/preact.js'
import { SETTINGS } from './settings.js'
import { uid, local, todayStr, addDays, fmtDate, firstName, initials, norm, safeFileName } from './lib/util.js'
import { prepareInsert, prepareUpdate, afterInsert, afterUpdate, cascadeDelete, emptyDb, recalcDeal } from './data/rules.js'
import { createDemoApi } from './data/demo.js'
import { createSupabaseApi } from './data/supabase.js'

const config = window.CRM_CONFIG || {}
const params = new URLSearchParams(location.search)
export const isDemo = !config.supabaseUrl || params.has('demo')
const demoAsGuest = isDemo && params.has('gast')

let api = null
const listeners = new Set()

export const state = {
  // loading, login, set-password, not-member, mfa-enroll, mfa-verify, claude, ready, error
  auth: 'loading',
  // Claude-Zugang (E1): Kennung der Anfrage von Claude, solange die Freigabe-Seite offen ist
  claudeRequest: null,
  authMessage: null,
  sessionEmail: null,
  me: null,
  role: null,
  adminName: null,
  mfaFactorId: null,
  db: emptyDb(),
  // Datensätze, deren lange Texte schon geladen sind
  full: { meetings: new Set(), emails: new Set() },
  // Marken je Karte: { is_new, mentioned, last_change } (aus dem Verlauf)
  flags: new Map(),
  // Letzte Zuweisung je Karte: card_id → { actor, at, assignee } (für „Liegt bei anderen“)
  handovers: new Map(),
  // Zählt hoch, wenn neue Verlaufseinträge ohne Kartenänderung dazukommen (zum Beispiel Dateien)
  historyTick: 0,
  // Follow-up (20_follow_up.sql), nur eigene Postfächer: „Antwort da“ je Aufgabe, neue Mails im
  // Posteingang, „Ohne Antwort“ (erst beim Öffnen des Reiters geladen), letzter Blick ins
  // Postfach vor diesem Öffnen (zum Hervorheben neuer Mails), Postfach gerade offen
  followUp: { answers: [], newMail: [], noReply: null, postfachPrev: null, postfachOpen: false },
  // Mail-Verfolgung (27_mail_spur.sql): je eigener verfolgter Mail die Zahlen, Schlüssel Postfach|Gmail-Kennung
  spuren: new Map(),
  // Persönliche Einstellungen auf allen Geräten (21_nutzer_einstellungen.sql): terminlink,
  // terminsatz, terminlinks je Postfach, kacheln (Anordnung der Übersicht)
  prefs: {},
  loadedAt: 0,
  toasts: [],
  dialog: null,
}

export const isGuest = () => state.role === 'gast'
export const isAdmin = () => state.role === 'admin'
// Super-Admin (26_super_admin.sql): als Einziger fremde Kalender und die Liste fremder Postfächer
export const isSuperAdmin = () => state.role === 'admin' && !!(state.me && state.me.super_admin)

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
  if (/beq\.com/i.test(msg)) return 'Konten gibt es nur für Adressen von beq.com. Gäste trägt ein Admin vorher im Team ein.'
  if (/already registered|already been registered/i.test(msg)) return 'Für diese Adresse gibt es schon ein Konto. Melde dich an oder nutze „Passwort vergessen?“.'
  if (/signups? not allowed|signup.*disabled/i.test(msg)) return 'Neue Konten sind in Supabase noch abgeschaltet. Bitte melde dich beim Admin.'
  if (/provider is not enabled|unsupported provider/i.test(msg)) return 'Die Anmeldung mit Google ist in Supabase noch nicht eingeschaltet. Bitte melde dich beim Admin.'
  if (/Email not confirmed/i.test(msg)) return 'Dein Konto ist noch nicht bestätigt. Bitte melde dich beim Admin.'
  if (/rate limit|too many/i.test(msg)) return 'Zu viele Versuche. Bitte warte ein paar Minuten.'
  if (/invalid.*(totp|code)|code.*invalid|otp/i.test(msg)) return 'Der Code stimmt nicht. Bitte nimm den aktuellen Code aus deiner App.'
  if (/should be different|same password/i.test(msg)) return 'Das neue Passwort muss sich vom alten unterscheiden.'
  if (/Password should be at least/i.test(msg)) return 'Das Passwort ist zu kurz.'
  if (/AAL2 required|aal2/i.test(msg)) return 'Dafür brauchst du den zweiten Faktor. Bitte melde dich neu an.'
  if (/JWT expired|session/i.test(msg)) return 'Deine Anmeldung ist abgelaufen. Bitte melde dich neu an.'
  if (/guest_guard_assignee|Gäste können nur sich selbst/i.test(msg)) return 'Als Gast kannst du nur dich, ein Teammitglied oder niemanden zuständig machen.'
  if (/guest_guard|Gäste dürfen/i.test(msg)) return 'Als Gast kannst du hier nur Spalte, Dringlichkeit, Fälligkeit und Zuständig ändern.'
  // Meldungen aus 25_claude_zugang.sql (Freigabe für Claude) sind schon für Menschen geschrieben
  if (/Claude-Zugang|Claude kann|zuerst mit dem zweiten Faktor|Kennung des Claude/i.test(msg)) return msg
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) return 'Keine Berechtigung für diese Änderung.'
  if (code === '23503') return 'Das geht nicht, weil noch Einträge daran hängen.'
  if (code === '23505') return 'Diesen Eintrag gibt es schon.'
  if (code === '23514') return 'Eine Angabe passt nicht. Bitte prüfen.'
  // Meldungen, die schon für Menschen geschrieben sind (Demo, Dienst „google-verbinden“)
  if (code === 'demo' || code === 'meldung') return msg
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
export function confirmDialog({ title, text, confirmLabel = 'OK', cancelLabel = 'Abbrechen', danger = false }) {
  return new Promise((resolve) => openDialog({ kind: 'confirm', title, text, confirmLabel, cancelLabel, danger, resolve }))
}
export function promptDialog({ title, label, value = '', confirmLabel = 'Speichern' }) {
  return new Promise((resolve) => openDialog({ kind: 'prompt', title, label, value, confirmLabel, resolve }))
}

// ------------------------------------------------------------
// Start und Anmeldung: Sitzung, Rolle, zweiter Faktor, Daten
// ------------------------------------------------------------
export async function boot() {
  state.claudeRequest = readClaudeRequest()
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
      state.authMessage = linkErrorText(api.linkError, api.linkErrorDescription)
      // Fehler aus der Adresse entfernen, damit er beim Neuladen nicht wiederkommt
      history.replaceState(null, '', location.pathname + '#/')
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
  state.sessionGoogle = !!session.google
  // Nach Google oder dem Bestätigungslink: Anmeldedaten aus der Adresse entfernen
  if (api.linkTokens && api.linkType !== 'recovery' && api.linkType !== 'invite') {
    history.replaceState(null, '', location.pathname + location.search + '#/')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }
  if (api.linkType === 'recovery' || api.linkType === 'invite') {
    state.auth = 'set-password'
    if (location.hash.includes('access_token')) history.replaceState(null, '', location.pathname + location.search + '#/')
    return emit()
  }
  await afterLogin(session.email)
}

// Verständliche Meldung, wenn Google oder ein Link aus einer Mail mit Fehler zurückkommt
function linkErrorText(code, description) {
  const d = String(description || '').replace(/\+/g, ' ')
  if (/beq\.com/i.test(d)) return 'Anmelden können sich nur Adressen von beq.com. Gäste trägt ein Admin vorher im Team ein.'
  if (/signups? not allowed|signup.*disabled/i.test(d)) return 'Neue Konten sind in Supabase noch abgeschaltet. Bitte melde dich beim Admin.'
  if (code === 'otp_expired' || /email link|expired/i.test(d)) return 'Der Link aus der Mail ist abgelaufen oder wurde schon benutzt. Bitte fordere einen neuen an oder melde dich beim Admin.'
  if (code === 'access_denied') return 'Du hast die Anmeldung bei Google abgebrochen.'
  return 'Die Anmeldung hat nicht geklappt. Bitte gleich noch einmal versuchen.'
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
    let role = await api.myRole()
    // beq.com-Adresse noch nicht im Team: jetzt beitreten (11_anmeldung_beq.sql)
    if (!role && /@beq\.com$/i.test(email || '') && api.joinTeam) role = await api.joinTeam()
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
    // Kommt die Person aus Claude, erst die Freigabe-Seite (mit zweitem Faktor, siehe oben)
    if (state.claudeRequest) {
      state.auth = 'claude'
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
  loadPrefs()
  startFollowUp()
  await autoConnectMailbox()
}

// ------------------------------------------------------------
// Claude-Zugang (E1, 25_claude_zugang.sql, Edge Function „crm-mcp“). Verbindet eine Person ihr
// Claude, schickt Supabase sie mit ?authorization_id=… auf diese Seite (Authentication, OAuth
// Server, Authorization Path). Die Kennung überlebt die Anmeldung, auch den Umweg über Google,
// in sessionStorage. Freigeben geht erst nach dem zweiten Faktor (afterLogin()).
// ------------------------------------------------------------
const CLAUDE_KEY = 'beqcrm-claude-anfrage'
// Supabase hängt die Kennung an die Website-Adresse. Doppelte Schrägstriche dabei glätten.
function readClaudeRequest() {
  try {
    const query = new URLSearchParams(location.search)
    const id = query.get('authorization_id')
    if (id) {
      sessionStorage.setItem(CLAUDE_KEY, JSON.stringify({ id, at: Date.now() }))
      query.delete('authorization_id')
      const rest = query.toString().replace(/=(&|$)/g, '$1')
      history.replaceState(null, '', location.pathname.replace(/\/{2,}/g, '/') + (rest ? '?' + rest : '') + (location.hash || '#/'))
    }
    const saved = JSON.parse(sessionStorage.getItem(CLAUDE_KEY) || 'null')
    // Supabase lässt eine Anfrage nur kurz offen, ältere gar nicht erst zeigen
    if (saved && saved.id && Date.now() - saved.at < 30 * 60000) return saved.id
    sessionStorage.removeItem(CLAUDE_KEY)
  } catch {
    // Ohne sessionStorage (privates Fenster mit strengen Regeln): Anfrage nur in dieser Adresse
  }
  return null
}
function clearClaudeRequest() {
  state.claudeRequest = null
  try {
    sessionStorage.removeItem(CLAUDE_KEY)
  } catch {
    // nichts zu tun
  }
}
// Freigabe-Seite verlassen, ohne zu Claude zurückzugehen: weiter ins CRM
export async function leaveClaudeConsent() {
  clearClaudeRequest()
  state.auth = 'loading'
  emit()
  try {
    await enterApp()
  } catch (err) {
    fail(err)
  }
}
// Zurück zu Claude (nach Erlauben oder Ablehnen). Ohne Adresse (Demo): ins CRM.
export function returnToClaude(url) {
  clearClaudeRequest()
  if (url) location.assign(url)
  else leaveClaudeConsent()
}
export const claudeDetails = (id) => api.claudeDetails(id)
export const claudeApprove = (id, info) => api.claudeApprove(id, info)
export const claudeDeny = (id) => api.claudeDeny(id)
export const claudeGrants = () => api.claudeGrants()
export const claudeAccesses = () => api.claudeAccesses()
export const claudeRevoke = (clientId) => api.claudeRevoke(clientId)
export const claudeRevokeGrant = (clientId) => api.claudeRevokeGrant(clientId)

// Erste Anmeldung mit Google (Entscheidung vom 06.11.2026, Variante B): gleich weiter zu
// Google, um das eigene Postfach zu verbinden. Google hat das Konto schon gewählt, es
// bleibt nur „Zulassen“. Einmal je Gerät und Adresse, wer ablehnt, wird nicht gedrängt.
async function autoConnectMailbox() {
  if (isDemo || !state.sessionGoogle || isGuest() || !api.connectMailbox) return
  const email = norm(state.sessionEmail)
  if (!/@beq\.com$/.test(email)) return
  // Schon verbunden, getrennt oder mit Fehler: nichts tun, das regelt die Kachel in den Einstellungen
  if ((state.db.mailboxes || []).some((b) => norm(b.address) === email)) return
  const key = 'beqcrm-postfach-auto-' + email
  if (local.get(key)) return
  local.set(key, new Date().toISOString())
  try {
    const url = await api.connectMailbox({ loginHint: email })
    toast('Einen Moment, Google fragt gleich nach deinem Postfach und Kalender.')
    setTimeout(() => {
      location.href = url
    }, 900)
  } catch {
    // Google noch nicht eingerichtet oder keine Verbindung: später unter „Postfächer und Kalender“
  }
}

// ------------------------------------------------------------
// Follow-up (Nachtrag „Follow-up“): „Antwort da“, „Ohne Antwort“, Zahlen in der Navigation.
// Harte Regel: nur Mails aus den eigenen aktiven Postfächern (Frage 14). Die offene App holt
// die Zahlen und „Antwort da“ alle 5 Minuten nach, ohne alles neu zu laden.
// ------------------------------------------------------------
let followUpTimer = null
function startFollowUp() {
  refreshFollowUp()
  if (!followUpTimer) followUpTimer = setInterval(refreshFollowUp, 5 * 60 * 1000)
}
export async function refreshFollowUp() {
  if (state.auth !== 'ready' || isGuest()) return
  const [answers, newMail, spuren] = await Promise.all([api.antwortenOffen(), api.postfachNeu(), api.mailSpuren()])
  state.followUp = { ...state.followUp, answers: answers || [], newMail: newMail || [] }
  state.spuren = new Map((spuren || []).map((r) => [norm(r.mailbox) + '|' + r.provider_id, r]))
  // Postfach gerade offen und Neues da: Liste still nachladen und wieder als gesehen merken.
  // Hervorgehoben bleibt alles seit dem Öffnen (postfachPrev ändert sich dabei nicht).
  if (state.followUp.postfachOpen && state.followUp.newMail.length) {
    await reloadEmailsQuietly()
    await api.postfachGesehen()
    state.followUp = { ...state.followUp, newMail: [] }
  }
  emit()
}
async function reloadEmailsQuietly() {
  const rows = await api.reloadEmails().catch(() => null)
  if (!rows) return
  // Schon geladene lange Texte (body) behalten
  const old = new Map(state.db.emails.map((m) => [m.id, m]))
  state.db = { ...state.db, emails: rows.map((r) => (state.full.emails.has(r.id) ? { ...old.get(r.id), ...r } : r)) }
}
// Postfach geöffnet: einmal „gesehen“ merken, erst danach auf neue Zahlen reagieren
export async function openedPostfach() {
  if (isGuest()) return
  state.followUp = { ...state.followUp, postfachOpen: true }
  const prev = await api.postfachGesehen()
  state.followUp = { ...state.followUp, postfachPrev: prev, newMail: [] }
  emit()
}
export function closedPostfach() {
  state.followUp = { ...state.followUp, postfachOpen: false }
}
// Neu seit dem letzten Blick: im eigenen Posteingang, nach dem letzten Öffnen geholt und
// höchstens einen Tag davor gesendet (wie postfach_neu())
export function isNewMail(m) {
  const prev = state.followUp.postfachPrev
  if (!prev || m.direction === 'out' || !(m.labels || []).includes('INBOX')) return false
  if (![m.mailbox, ...(m.mailboxes || [])].some((b) => isOwnMailbox(b))) return false
  const t = new Date(prev).getTime()
  return new Date(m.created_at).getTime() > t && new Date(m.sent_at).getTime() > t - 864e5
}
// „Antwort da“ einer Aufgabe. Ist die Aufgabe lokal schon neuer als die Antwort (Notiz, Spalte,
// Wiedervorlage verschoben), ist der Hinweis sofort weg, ohne auf die Datenbank zu warten.
export function answerFor(cardId) {
  const a = state.followUp.answers.find((x) => x.card_id === cardId)
  if (!a) return null
  const card = getCard(cardId)
  if (!card || card.archived || cardKind(card) !== 'waiting') return null
  if (new Date(card.updated_at).getTime() > new Date(a.sent_at).getTime()) return null
  return a
}
// „Ohne Antwort“: erst beim Öffnen des Reiters laden
export async function loadNoReply() {
  const rows = await api.mailsOhneAntwort(60)
  state.followUp = { ...state.followUp, noReply: rows || [] }
  emit()
  if (rows === null) toast('„Ohne Antwort“ ließ sich nicht laden. Bitte gleich noch einmal versuchen.', { error: true })
}
// „Braucht keine Antwort“: sofort ausblenden, mit „Rückgängig“
export async function dismissNoReply(item) {
  state.followUp = { ...state.followUp, noReply: (state.followUp.noReply || []).filter((x) => x !== item) }
  emit()
  try {
    await api.dismissThread(item.mailbox, item.verlauf)
  } catch (err) {
    toast(errorText(err), { error: true })
    return loadNoReply()
  }
  toast('Ausgeblendet. Schreibst du in diesem Verlauf wieder, kommt er nach 3 Tagen erneut.', {
    action: {
      label: 'Rückgängig',
      run: async () => {
        await api.undismissThread(item.mailbox, item.verlauf)
        loadNoReply()
      },
    },
  })
}

// ------------------------------------------------------------
// Persönliche Einstellungen (Nachträge „Terminlink“ und „Kacheln“): eine Zeile je Person in
// nutzer_einstellungen, gilt auf allen Geräten. Gespeichert wird immer das ganze JSON.
// ------------------------------------------------------------
export async function loadPrefs() {
  if (isGuest()) return
  state.prefs = (await api.loadPrefs()) || {}
  state.prefsLoaded = true
  emit()
}
export async function savePrefs(patch) {
  const before = state.prefs
  state.prefs = { ...state.prefs, ...patch }
  emit()
  try {
    await api.savePrefs(myEmail(), state.prefs)
    return true
  } catch (err) {
    state.prefs = before
    emit()
    toast('Die Einstellung ließ sich nicht speichern. ' + errorText(err), { error: true })
    return false
  }
}
// Terminlink für ein Absender-Postfach: eigener Link je Postfach, sonst der Standard
export const DEFAULT_TERMINSATZ = 'Hier können Sie direkt einen Termin mit mir buchen:'
export function terminLinkFor(address) {
  const per = state.prefs.terminlinks || {}
  return (address && per[norm(address)]) || state.prefs.terminlink || ''
}
export const terminSatz = () => (typeof state.prefs.terminsatz === 'string' ? state.prefs.terminsatz : DEFAULT_TERMINSATZ)
// „https://“ ergänzen, dann eine einfache Prüfung, ob es wie ein Link aussieht. null heißt: kein Link.
export function normalizeLink(raw) {
  let s = String(raw || '').trim()
  if (!s) return ''
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s.replace(/^\/+/, '')
  return /^https?:\/\/[^\s/?#.]+(\.[^\s/?#.]+)+([/?#]\S*)?$/i.test(s) ? s : null
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
    await loadFlags()
    state.full = { meetings: new Set(), emails: new Set() }
    if (isDemo) {
      // Im Demo-Modus ist alles schon vollständig
      state.db.meetings.forEach((m) => state.full.meetings.add(m.id))
      state.db.emails.forEach((m) => state.full.emails.add(m.id))
    }
    state.loadedAt = Date.now()
    emit()
    if (state.auth === 'ready') refreshFollowUp()
  } catch (err) {
    if (throwErrors) throw err
    toast(errorText(err), { error: true })
  }
}

// ------------------------------------------------------------
// Verlauf und Marke „Neu“
// ------------------------------------------------------------
export async function loadFlags() {
  // Ohne Verlauf (zum Beispiel 03_verlauf.sql oder 04_zustaendig.sql noch nicht ausgeführt)
  // gibt es einfach keine Marken und keine Liste „Liegt bei anderen“
  const [flags, handovers] = await Promise.all([api.cardFlags().catch(() => []), api.handovers().catch(() => [])])
  state.flags = new Map((flags || []).map((r) => [r.card_id, r]))
  state.handovers = new Map((handovers || []).map((r) => [r.card_id, r]))
}
export const isNew = (cardId) => !!(state.flags.get(cardId) || {}).is_new
// Jemand anderes als ich ist zuständig (dann zeigen Karten und Listen ein Kürzel)
export const assignedToOther = (card) => !!card.assignee && norm(card.assignee) !== norm(myEmail())
export const flagOf = (cardId) => state.flags.get(cardId) || null
export const lastHandover = (cardId) => state.handovers.get(cardId) || null
export const isMentioned = (cardId) => !!(state.flags.get(cardId) || {}).mentioned

// Öffnen einer Karte: „gesehen“ setzen. Klappt das nicht, still weitermachen.
export async function markCardSeen(cardId) {
  if (state.flags.has(cardId)) {
    state.flags.delete(cardId)
    emit()
  }
  try {
    await api.markSeen(cardId, myEmail())
  } catch {
    // nicht kritisch
  }
}

// Zuständig ändern. Bekommt ein Gast die Aufgabe von einem Teammitglied, teilt die
// Datenbank sie automatisch mit ihm (04_zustaendig.sql). Dann die Freigaben neu laden
// und Bescheid geben.
export async function assignCard(card, email) {
  const target = email ? norm(email) : null
  const guest = target && !isGuest() && state.db.team_members.find((t) => norm(t.email) === target && t.role === 'gast')
  const willShare = guest && !sharesOf(card.id).some((s) => norm(s.email) === target)
  state.handovers.set(card.id, { card_id: card.id, actor: norm(myEmail()), at: new Date().toISOString(), assignee: target })
  const saved = await update('cards', card.id, { assignee: email || null })
  if (saved && willShare) {
    await refreshCardShares(card.id)
    toast(`${guest.name} sieht diese Karte jetzt auch.`)
  }
  return saved
}

// Freigaben einer Karte neu laden (nach automatischem Teilen durch die Datenbank)
export async function refreshCardShares(cardId) {
  try {
    const rows = await api.cardShares(cardId)
    state.db = { ...state.db, card_shares: [...state.db.card_shares.filter((s) => s.card_id !== cardId), ...rows] }
    emit()
  } catch {
    // Freigabe kommt spätestens beim nächsten Laden
  }
}

// Sieht dieser Gast die Karte schon (einzeln oder über das ganze Projekt)?
export function guestSeesCard(card, email) {
  const e = norm(email)
  return (
    state.db.card_shares.some((s) => s.card_id === card.id && norm(s.email) === e) ||
    (state.db.project_shares || []).some((s) => s.project_id === card.project_id && norm(s.email) === e)
  )
}

// Notiz speichern bzw. ändern. Erwähnt ein Teammitglied einen Gast, der die Karte
// noch nicht sieht, teilt die Datenbank sie automatisch (06_erwaehnungen.sql).
export async function saveNote(fields, noteId = null) {
  const card = fields.card_id ? getCard(fields.card_id) : noteId ? getCard((state.db.notes.find((n) => n.id === noteId) || {}).card_id) : null
  const newGuests =
    card && !isGuest() && !fields.internal
      ? (fields.mentions || [])
          .map((m) => state.db.team_members.find((t) => norm(t.email) === norm(m) && t.role === 'gast' && t.active))
          .filter((g) => g && !guestSeesCard(card, g.email))
      : []
  const saved = noteId ? await update('notes', noteId, fields) : await insert('notes', fields)
  if (saved && newGuests.length) {
    await refreshCardShares(card.id)
    newGuests.forEach((g) => toast(`${g.name} sieht diese Karte jetzt auch.`))
  }
  return saved
}

// ------------------------------------------------------------
// Dateien an Aufgaben (07_dateien.sql): Bucket „dateien“, Pfad karten/<ID>/<Zeit>-<Name>
// ------------------------------------------------------------
export const MAX_FILE_BYTES = 25 * 1024 * 1024

export async function listCardFiles(cardId) {
  try {
    return await api.listFiles(cardId)
  } catch {
    return null
  }
}

// Hochladen, danach Verlaufseintrag. Gibt true zurück, wenn es geklappt hat.
export async function uploadCardFile(cardId, file) {
  if (file.size > MAX_FILE_BYTES) {
    toast(`„${file.name}“ ist größer als 25 MB und wurde nicht hochgeladen. Bitte verkleinern oder als Link in eine Notiz schreiben.`, { error: true })
    return false
  }
  const path = `karten/${cardId}/${Date.now()}-${safeFileName(file.name)}`
  try {
    await api.uploadFile(path, file)
  } catch (err) {
    toast(`„${file.name}“ ließ sich nicht hochladen. ${uploadErrorText(err)}`, { error: true })
    return false
  }
  try {
    await api.logFile(cardId, file.name)
    state.historyTick++
    emit()
  } catch {
    // Datei ist da, nur der Verlaufseintrag fehlt
  }
  return true
}

function uploadErrorText(err) {
  const msg = String((err && err.message) || '')
  if (/exceeded|too large|413/i.test(msg)) return 'Die Datei ist zu groß.'
  if (/row-level security|403|Unauthorized/i.test(msg)) return 'Dafür fehlt dir die Berechtigung.'
  if (/Bucket not found/i.test(msg)) return 'Der Speicher ist noch nicht eingerichtet (07_dateien.sql).'
  return errorText(err)
}

// Öffnen: das Fenster sofort beim Tippen öffnen und den Link erst danach hineinladen,
// sonst stoppt der Popup-Blocker auf dem iPhone das Fenster
export async function openCardFile(path) {
  if (isDemo) {
    toast('Im Demo-Modus haben Dateien keinen Inhalt.')
    return
  }
  const win = window.open('', '_blank')
  try {
    const url = await api.fileUrl(path)
    if (win) win.location.href = url
    else window.location.href = url
  } catch (err) {
    if (win) win.close()
    toast(`Die Datei ließ sich nicht öffnen. ${errorText(err)}`, { error: true })
  }
}

export async function deleteCardFile(path) {
  try {
    await api.removeFile(path)
    return true
  } catch (err) {
    toast(`Die Datei ließ sich nicht löschen. ${errorText(err)}`, { error: true })
    return false
  }
}

export async function fetchCardEvents(cardId) {
  try {
    return await api.cardEvents(cardId)
  } catch {
    return null
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

// ------------------------------------------------------------
// Postfächer und Kalender (10_postfaecher.sql)
// ------------------------------------------------------------
// Startet die Anmeldung bei Google. Google schickt danach zurück nach #/einstellungen?postfach=…
export async function connectMailbox() {
  try {
    const url = await api.connectMailbox()
    // Im Demo-Modus ändert sich nur der Teil hinter #, deshalb vorher neu laden
    if (isDemo) await reload()
    location.href = url
  } catch (err) {
    toast(errorText(err), { error: true })
  }
}

// Trennen, auf Wunsch mit den bisherigen Mails und Terminen aus diesem Postfach
export async function disconnectMailbox(box, deleteData = false) {
  try {
    await api.disconnectMailbox(box.id, deleteData)
    toast(deleteData ? `${box.address} ist getrennt, Mails und Termine daraus sind gelöscht.` : `${box.address} ist getrennt.`)
  } catch (err) {
    toast(errorText(err), { error: true })
  }
  await reload()
}

// ------------------------------------------------------------
// Postfach (14_postfach.sql, Dienste „google-mail“ und „google-abgleich“)
// ------------------------------------------------------------
// Eigene, aktiv verbundene Postfächer: nur daraus darf gesendet und gelöscht werden
export function myActiveMailboxes() {
  const me = norm(myEmail())
  return (state.db.mailboxes || []).filter((b) => norm(b.owner) === me && b.status === 'aktiv')
}
export const isOwnMailbox = (address) => myActiveMailboxes().some((b) => b.address === norm(address))

// Mail senden. payload: von, an, cc, bcc, betreff, text, antwort_auf, dateien [{ name, mime, data }],
// verfolgen (Mail-Verfolgung, standardmäßig aus)
export async function sendMail(payload) {
  try {
    const result = await api.mailAction('senden', payload)
    const notes = []
    if (result && result.ohne_signatur) notes.push('ohne Signatur, Google hat sie gerade nicht geliefert')
    if (result && result.verfolgt === false) notes.push('die Verfolgung ließ sich diesmal nicht einrichten')
    toast(notes.length ? `Mail gesendet, aber ${notes.join(', und ')}.` : payload.verfolgen ? 'Mail gesendet. Öffnen und Klicks siehst du an der Mail.' : 'Mail gesendet')
    await reload()
    return true
  } catch (err) {
    toast(errorText(err), { error: true })
    return false
  }
}

// Signatur aus Gmail je Postfach, einmal je Sitzung geladen. Nur Text für die Vorschau, die
// Signatur mit Formatierung holt der Dienst beim Senden selbst.
const signatures = new Map()
export async function mailSignature(von) {
  if (!von) return { status: 'keine', text: '' }
  if (signatures.has(von)) return signatures.get(von)
  try {
    const r = await api.mailSignature(von)
    const value = r && r.vorhanden ? { status: 'da', text: r.text } : { status: 'keine', text: '' }
    signatures.set(von, value)
    return value
  } catch (err) {
    return { status: 'fehler', text: errorText(err) }
  }
}

// Mail-Verfolgung einer Mail (nur eigene gesendete, nur für den Absender, 27_mail_spur.sql)
export function spurFor(mail) {
  if (!mail || mail.direction !== 'out' || !mail.provider_id) return null
  return state.spuren.get(norm(mail.mailbox) + '|' + mail.provider_id) || null
}

// Mail in den Papierkorb von Gmail und aus dem CRM
export async function deleteMail(mail) {
  try {
    await api.mailAction('loeschen', { email_id: mail.id })
    state.db = { ...state.db, emails: state.db.emails.filter((m) => m.id !== mail.id), email_persons: state.db.email_persons.filter((x) => x.email_id !== mail.id) }
    emit()
    toast('Mail gelöscht. Sie liegt 30 Tage im Papierkorb von Gmail.')
    return true
  } catch (err) {
    toast(errorText(err), { error: true })
    return false
  }
}

// Anhang holen: PDF, Bilder und Text im neuen Tab, alles andere herunterladen
// Anhänge öffnet jede Person nur aus ihren eigenen Postfächern (Frage 13, Entscheidung vom
// 07.11.2026: Nein). Die Mail muss in einem davon liegen, sonst steht nur der Dateiname da.
export function canOpenAttachments(mail) {
  const boxes = mail.mailboxes && mail.mailboxes.length ? mail.mailboxes : [mail.mailbox]
  return boxes.some((b) => isOwnMailbox(b))
}

// Im Browser öffnen nur diese Endungen, der Dienst liefert alles andere als Download
const INLINE_FILE = /\.(pdf|png|jpe?g|gif|webp|txt)$/i

export async function openMailAttachment(mail, attachment) {
  if (isDemo) {
    toast('Im Demo-Modus haben Anhänge keinen Inhalt.')
    return
  }
  // Wie openCardFile: Fenster sofort öffnen und den Link danach hineinladen, sonst blockt es das iPhone
  const win = INLINE_FILE.test(attachment.name || '') ? window.open('', '_blank') : null
  try {
    const { url } = await api.mailAttachmentLink(mail.id, attachment.part)
    if (win) {
      win.opener = null
      win.location.href = url
    } else {
      // Alles andere über einen kurz eingefügten Link, der Dienst schickt die Datei als Download
      const a = document.createElement('a')
      a.href = url
      a.rel = 'noopener noreferrer'
      document.body.appendChild(a)
      a.click()
      a.remove()
    }
  } catch (err) {
    if (win) win.close()
    toast(`Der Anhang ließ sich nicht öffnen. ${errorText(err)}`, { error: true })
  }
}

// Eigene Postfächer sofort abgleichen
export async function syncNow() {
  try {
    const result = await api.syncNow()
    const list = result.ergebnis || []
    const errors = list.filter((r) => r.fehler)
    const mails = list.reduce((n, r) => n + (r.mails || 0), 0)
    const pending = list.some((r) => r.mails_fertig === false)
    if (errors.length) toast(`Abgleich für ${errors.map((r) => r.adresse).join(', ')} hat nicht geklappt: ${errors[0].fehler}`, { error: true })
    else if (!list.length) toast('Du hast noch kein Postfach verbunden.')
    else toast(`Abgeglichen. ${mails === 1 ? '1 neue Mail' : mails + ' neue Mails'}${pending ? ', weitere folgen mit den nächsten Durchgängen' : ''}.`)
    await reload()
    return true
  } catch (err) {
    toast(errorText(err), { error: true })
    return false
  }
}

// Wie viele Mails und Termine im CRM aus diesem Postfach stammen
export function mailboxDataCounts(address) {
  const a = norm(address)
  return {
    mails: state.db.emails.filter((m) => norm(m.mailbox) === a).length,
    events: state.db.events.filter((e) => norm(e.calendar_id) === a).length,
  }
}

export async function signIn(email, password) {
  state.sessionGoogle = false
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
export const signInWithGoogle = () => api.signInWithGoogle()
export const signUp = (email, password) => api.signUp(email, password)
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
    // Neue Aufgabe direkt in einer Wartespalte: die Datenbank legt eine Wiedervorlage an
    if (table === 'cards' && cardKind(saved) === 'waiting') refreshCardActivities(saved.id)
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
  if (table === 'aktivitaeten') afterUpdate(state.db, table, state.db[table].find((x) => x.id === id))
  state.db = { ...state.db }
  emit()
  try {
    const saved = await api.update(table, id, patch)
    replaceRow(table, saved)
    emit()
    // Nach dem Verschieben die Aktivitäten nachladen, die Datenbank kann eine anlegen
    if (table === 'cards' && 'stage_id' in patch && patch.stage_id !== old.stage_id) refreshCardActivities(id)
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
// Alle Labels: zuerst die aus den Einstellungen, dann die von Kontakten, Firmen und Aufgaben (C7)
export function allLabels() {
  const set = new Set(SETTINGS.labels)
  state.db.persons.forEach((p) => (p.labels || []).forEach((l) => set.add(l)))
  state.db.organizations.forEach((o) => (o.labels || []).forEach((l) => set.add(l)))
  state.db.cards.forEach((c) => (c.labels || []).forEach((l) => set.add(l)))
  return [...set]
}
// Ganz geteilte Projekte (05_projekte_teilen.sql)
export function projectSharesOf(projectId) {
  return (state.db.project_shares || []).filter((s) => s.project_id === projectId)
}
// Für Gäste: die Projekte, die ganz mit mir geteilt sind
export function mySharedProjectIds() {
  const me = norm(myEmail())
  return new Set((state.db.project_shares || []).filter((s) => norm(s.email) === me).map((s) => s.project_id))
}
// ------------------------------------------------------------
// Sales (08_sales.sql)
// ------------------------------------------------------------
export function dealOf(cardId) {
  return (state.db.deals || []).find((d) => d.card_id === cardId) || null
}
export function dealItems(dealId) {
  return (state.db.deal_items || []).filter((i) => i.deal_id === dealId).sort((a, b) => a.sort - b.sort)
}
export function activeProducts() {
  return (state.db.products || []).filter((p) => p.active).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'de'))
}
// Wessen Zahlen darf ich sehen? Admins alle, Teamleads ihr Team, sonst nur die eigenen
export function salesPeople() {
  const me = state.db.team_members.find((t) => norm(t.email) === norm(myEmail()))
  if (!me || me.role === 'gast') return []
  const members = state.db.team_members.filter((t) => t.role !== 'gast')
  if (me.role === 'admin') return members
  if (me.team_lead && me.sales_team) return members.filter((t) => t.sales_team === me.sales_team)
  return [me]
}
// Besitzer eines Deals, den ich nicht sehen darf (ohne Werte)
export async function cardDealOwner(cardId) {
  try {
    return await api.cardDealOwner(cardId)
  } catch {
    return null
  }
}
// Produktzeilen ändern den Wert in der Datenbank. Hier sofort mitrechnen.
export function syncDealValue(dealId) {
  const db = { ...state.db }
  recalcDeal(db, dealId)
  state.db = db
  emit()
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

// ------------------------------------------------------------
// Aktivitäten (19_aktivitaeten.sql): geplante Schritte mit Datum an Aufgabe, Kontakt oder Firma.
// Wiedervorlagen sind Aktivitäten. Die Fälligkeit einer Aufgabe bleibt ihre Frist.
// ------------------------------------------------------------
export const ACTIVITY_KINDS = [
  { value: 'wiedervorlage', label: 'Wiedervorlage', icon: 'bell' },
  { value: 'anruf', label: 'Anruf', icon: 'phone' },
  { value: 'mail', label: 'Mail', icon: 'mail' },
  { value: 'termin', label: 'Termin', icon: 'calendar' },
  { value: 'aufgabe', label: 'Aufgabe', icon: 'check' },
]
export const activityKind = (art) => ACTIVITY_KINDS.find((k) => k.value === art) || ACTIVITY_KINDS[0]
export const activityText = (a) => a.titel || activityKind(a.art).label
// Früheste zuerst, ohne Uhrzeit nach denen mit Uhrzeit
export const activitySort = (a, b) =>
  a.faellig.localeCompare(b.faellig) || String(a.uhrzeit || '99').localeCompare(String(b.uhrzeit || '99')) || String(a.created_at).localeCompare(String(b.created_at))
export const allActivities = () => state.db.aktivitaeten || []
export const activitiesOfCard = (cardId) => allActivities().filter((a) => a.card_id === cardId)
export const openActivitiesOfCard = (cardId) => activitiesOfCard(cardId).filter((a) => !a.erledigt_at).sort(activitySort)
export const nextActivity = (cardId) => openActivitiesOfCard(cardId)[0] || null
// Kontakt: eigene und die seiner Aufgaben. Firma: eigene, die ihrer Aufgaben und ihrer Kontakte.
export function activitiesForPerson(personId) {
  const cards = new Set(state.db.cards.filter((c) => c.person_id === personId).map((c) => c.id))
  return allActivities().filter((a) => a.person_id === personId || (a.card_id && cards.has(a.card_id)))
}
export function activitiesForOrg(orgId) {
  const cards = new Set(state.db.cards.filter((c) => c.org_id === orgId).map((c) => c.id))
  const people = new Set(state.db.persons.filter((p) => p.org_id === orgId).map((p) => p.id))
  return allActivities().filter((a) => a.org_id === orgId || (a.card_id && cards.has(a.card_id)) || (a.person_id && people.has(a.person_id)))
}
// „Meine“: ich bin zuständig, oder niemand ist es und ich bin bei der Aufgabe zuständig (ohne
// Zuständige wie bei „Meine“ für Aufgaben: angelegt), ohne Aufgabe: ich habe sie angelegt
export function isMyActivity(a) {
  const me = norm(myEmail())
  if (a.zustaendig) return norm(a.zustaendig) === me
  const card = a.card_id ? getCard(a.card_id) : null
  if (card) return card.assignee ? norm(card.assignee) === me : norm(card.created_by || '') === me
  return norm(a.owner || '') === me
}
export const canDeleteActivity = (a) => !isGuest() && (isAdmin() || norm(a.owner || '') === norm(myEmail()))
export const createActivity = (fields) => insert('aktivitaeten', fields)
export async function completeActivity(a) {
  const saved = await update('aktivitaeten', a.id, { erledigt_at: new Date().toISOString(), erledigt_von: myEmail() })
  if (saved) toast(`${activityKind(a.art).label} erledigt`, { action: { label: 'Rückgängig', run: () => reopenActivity(a) } })
  return saved
}
export const reopenActivity = (a) => update('aktivitaeten', a.id, { erledigt_at: null })
export async function deleteActivity(a) {
  const ok = await confirmDialog({ title: 'Aktivität löschen?', text: `„${activityText(a)}“ ist danach weg. Erledigtes besser abhaken.`, confirmLabel: 'Löschen', danger: true })
  if (!ok) return false
  return remove('aktivitaeten', a.id)
}
// „Wieder vorlegen“: die offene Wiedervorlage der Aufgabe verschieben oder eine anlegen
export async function followUpIn(card, days) {
  const date = addDays(todayStr(), days)
  const open = openActivitiesOfCard(card.id).find((a) => a.art === 'wiedervorlage')
  const saved = open ? await update('aktivitaeten', open.id, { faellig: date }) : await createActivity({ card_id: card.id, art: 'wiedervorlage', faellig: date })
  if (saved) toast(`Wiedervorlage am ${fmtDate(date)}`)
  return saved
}
// Aktivitäten einer Aufgabe neu laden (die Datenbank legt in der Wartespalte selbst eine an)
export async function refreshCardActivities(cardId) {
  const rows = await api.fetchActivities(cardId)
  if (!rows) return
  state.db = { ...state.db, aktivitaeten: [...allActivities().filter((a) => a.card_id !== cardId), ...rows] }
  emit()
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

// ------------------------------------------------------------
// Spalten eines Boards: anlegen, verschieben, löschen
// ------------------------------------------------------------
// Reihenfolge der Spalten neu durchnummerieren (nur geänderte Zeilen speichern)
async function saveStageOrder(ids) {
  for (const [i, id] of ids.entries()) {
    const s = getStage(id)
    if (s && s.sort !== i + 1) await update('stages', id, { sort: i + 1 })
  }
}

// Neue Spalte an Stelle `at` (ab 0), nie hinter „Erledigt“. Ohne Angabe direkt vor „Erledigt“.
// Art immer „todo“, Wahrscheinlichkeit leer. Beides stellt man in den Projekt-Einstellungen ein.
export async function addStage(projectId, name, at = null) {
  const list = stagesOf(projectId)
  const doneIndex = list.findIndex((s) => s.kind === 'done')
  const last = doneIndex < 0 ? list.length : doneIndex
  const pos = at == null ? last : Math.max(0, Math.min(at, last))
  const ids = list.map((s) => s.id)
  // Platz schaffen und dabei alle Spalten sauber durchnummerieren (null ist der freie Platz)
  await saveStageOrder([...ids.slice(0, pos), null, ...ids.slice(pos)])
  const stage = await insert('stages', { project_id: projectId, name: name.trim(), kind: 'todo', sort: pos + 1 })
  if (stage) toast(`Spalte „${stage.name}“ angelegt`)
  return stage
}

// Darf die Spalte eine Stelle nach links (-1) oder rechts (+1)? „Erledigt“ bleibt immer hinten,
// keine Spalte lässt sich dahinter schieben.
export function canMoveStage(stageId, dir) {
  const stage = getStage(stageId)
  if (!stage || stage.kind === 'done') return false
  const list = stagesOf(stage.project_id)
  const j = list.findIndex((s) => s.id === stageId) + dir
  return j >= 0 && j < list.length && list[j].kind !== 'done'
}

// Spalte mit der Nachbarspalte tauschen, danach alle sauber durchnummerieren
export async function moveStage(stageId, dir) {
  if (!canMoveStage(stageId, dir)) return
  const stage = getStage(stageId)
  const ids = stagesOf(stage.project_id).map((s) => s.id)
  const i = ids.indexOf(stageId)
  ;[ids[i], ids[i + dir]] = [ids[i + dir], ids[i]]
  await saveStageOrder(ids)
}

// Ist das die einzige Spalte ihrer Art im Projekt? Dann landen Aufgaben, die eine Spalte dieser
// Art suchen (stageOfKind), danach in der ersten Spalte.
export function lastOfKindHint(stage) {
  if (!stage || stage.kind === 'done') return ''
  if (stagesOf(stage.project_id).filter((s) => s.kind === stage.kind).length > 1) return ''
  const label = (SETTINGS.stageKinds.find((k) => k.value === stage.kind) || {}).label || stage.kind
  const why = {
    todo: 'Neue Aufgaben aus der Schnellerfassung und aus „Aufs Board“ landen danach ohne Hinweis in der ersten Spalte.',
    waiting: 'Die Übersicht zeigt danach unter „Warte auf Rückmeldung“ nichts mehr aus diesem Projekt.',
  }[stage.kind] || 'Aufgaben, die aus anderen Projekten mit dieser Art hierher wandern, landen danach in der ersten Spalte.'
  return `„${stage.name}“ ist die letzte Spalte der Art „${label}“. ${why}`
}

// Alle Aufgaben einer Spalte, auch die im Archiv (aus den geladenen Daten, nur für Anzeigen)
export const cardsInStage = (stageId) => state.db.cards.filter((c) => c.stage_id === stageId)

// Aufgaben einer Spalte direkt in der Datenbank zählen, auch archivierte
export async function countStageCards(stageId) {
  try {
    return await api.countStageCards(stageId)
  } catch (err) {
    toast(`Die Aufgaben in der Spalte ließen sich nicht zählen. ${errorText(err)}`, { error: true })
    return null
  }
}

// Spalte löschen. Liegen Aufgaben darin (auch archivierte), wandern sie vorher in einem Schritt in
// die Zielspalte, je Aufgabe mit Verlaufseintrag. Schlägt das fehl, bleibt die Spalte stehen.
// „Erledigt“ bleibt immer, weil Übersicht und Sales daran hängen.
export async function deleteStage(stageId, targetId = null) {
  const stage = getStage(stageId)
  if (!stage || stage.kind === 'done') return false
  const counted = await countStageCards(stageId)
  if (!counted) return false
  let moved = 0
  if (counted.total) {
    const target = getStage(targetId)
    if (!target || target.project_id !== stage.project_id || target.id === stage.id) {
      toast('Bitte eine Spalte wählen, in die die Aufgaben kommen.', { error: true })
      return false
    }
    try {
      moved = await api.moveStageCards(stage.id, target.id)
    } catch (err) {
      await reload()
      toast(`Die Aufgaben ließen sich nicht verschieben, die Spalte „${stage.name}“ bleibt stehen. ${errorText(err)}`, { error: true })
      return false
    }
  }
  try {
    await api.remove('stages', stage.id)
  } catch (err) {
    await reload()
    const done = moved ? `${moved === 1 ? 'Die Aufgabe ist' : `Die ${moved} Aufgaben sind`} verschoben, aber die Spalte ließ sich nicht löschen.` : 'Die Spalte ließ sich nicht löschen.'
    toast(`${done} ${errorText(err)}`, { error: true })
    return false
  }
  await reload()
  toast(moved ? `Spalte gelöscht, ${moved === 1 ? '1 Aufgabe' : `${moved} Aufgaben`} verschoben.` : `Spalte „${stage.name}“ gelöscht.`)
  return true
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
