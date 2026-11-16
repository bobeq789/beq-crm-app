// Chat (Stufe B, 30_chat.sql): Zustand und Abläufe. Die Oberfläche steht in js/ui/chat.js.
// Räume (Kanäle, Gruppen, Direktnachrichten) mit Zahlen kommen aus chat_uebersicht(),
// Nachrichten seitenweise je Raum. Neue Nachrichten kommen sofort über Supabase Realtime
// (im Demo-Modus über einen zweiten Tab), dazu jede Minute ein Abgleich der Zahlen.
// Wer was sieht, regelt die Datenbank. Die App zeigt nur, was sie bekommt.
import { state, emit, toast, errorText, myEmail, memberName, getApi, confirmDialog } from './store.js'
import { uid, norm, firstName } from './lib/util.js'

const PAGE = 50
const api = () => getApi()

// Meldungen aus 30_chat.sql sind schon für Menschen geschrieben
export function chatErrorText(err) {
  const msg = String((err && err.message) || '')
  const code = err && err.code
  if (['22023', '23505', '42501', '23503', 'meldung'].includes(code) && /[a-zäöüß]{3} [a-zäöüß]/i.test(msg) && !/permission denied|row-level|violates/i.test(msg)) return msg
  if (code === '23514') return 'Die Nachricht ist leer oder zu lang (höchstens 4.000 Zeichen).'
  return errorText(err)
}

function setChat(patch) {
  state.chat = { ...state.chat, ...patch }
  emit()
}

// ------------------------------------------------------------
// Start, Abgleich, Realtime
// ------------------------------------------------------------
let unsubscribe = null
let timer = null
let refreshTimer = null
const onVisible = () => document.visibilityState === 'visible' && refreshChat()

export async function startChat() {
  await refreshChat()
  if (!state.chat.available) return
  if (!unsubscribe) unsubscribe = api().chatSubscribe(onRealtime)
  if (!timer) timer = setInterval(refreshChat, 60 * 1000)
  document.addEventListener('visibilitychange', onVisible)
}

export function stopChat() {
  if (unsubscribe) unsubscribe()
  unsubscribe = null
  clearInterval(timer)
  timer = null
  document.removeEventListener('visibilitychange', onVisible)
}

export async function refreshChat() {
  if (state.auth !== 'ready') return
  try {
    const rooms = await api().chatOverview()
    if (rooms === null) return setChat({ available: false, rooms: [] })
    setChat({ available: true, rooms })
  } catch {
    // Ohne Verbindung bleibt die alte Liste stehen, der nächste Abgleich holt nach
  }
}

// Mehrere Ereignisse kurz hintereinander: einmal nachladen
function scheduleRefresh(reloadActive = false) {
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(async () => {
    await refreshChat()
    if (reloadActive && state.chat.active) await loadMessages(state.chat.active, true)
  }, 250)
}

function onRealtime(ev) {
  if (ev.type !== 'message' || !ev.row || !ev.row.raum_id) return scheduleRefresh(true)
  const row = ev.row
  const known = state.chat.messages.get(row.raum_id)
  if (known) mergeMessages(row.raum_id, [row])
  if (state.chat.active === row.raum_id && document.visibilityState === 'visible') markRead(row.raum_id)
  scheduleRefresh(false)
}

// ------------------------------------------------------------
// Räume
// ------------------------------------------------------------
export const getRoom = (id) => state.chat.rooms.find((r) => r.id === id) || null

// Anzeigename: Kanal mit Namen, Direktnachricht mit der anderen Person, Gruppe mit Namen oder
// den Vornamen der Beteiligten
export function roomTitle(room) {
  if (!room) return ''
  const me = norm(myEmail())
  if (room.art === 'kanal') return room.name || '[Kanal]'
  if (room.art === 'direkt') {
    const other = (room.mitglieder || []).find((e) => norm(e) !== me)
    return other ? memberName(other) : 'Direktnachricht'
  }
  if (room.name) return room.name
  const others = (room.mitglieder || []).filter((e) => norm(e) !== me)
  return others.map((e) => firstName(memberName(e))).join(', ') || 'Gruppe'
}

// Zahl in der Navigation: ungelesene Nachrichten in Räumen, die nicht archiviert sind
export function unreadTotal() {
  return state.chat.rooms.reduce((n, r) => n + (r.archiviert ? 0 : r.ungelesen || 0), 0)
}

export async function createChannel(fields) {
  const id = await api().chatCreateChannel(fields)
  await refreshChat()
  return id
}
export async function openDirect(email) {
  const id = await api().chatDirect(email)
  await refreshChat()
  return id
}
export async function createGroup(fields) {
  const id = await api().chatCreateGroup(fields)
  await refreshChat()
  return id
}
export async function addMembers(raumId, emails) {
  await api().chatAddMembers(raumId, emails)
  await refreshChat()
}
export async function removeMember(raumId, email) {
  await api().chatRemoveMember(raumId, email)
  await refreshChat()
}
export async function changeRoom(raumId, patch) {
  await api().chatChangeRoom(raumId, patch)
  await refreshChat()
}

// ------------------------------------------------------------
// Nachrichten
// ------------------------------------------------------------
export function messagesOf(raumId) {
  return state.chat.messages.get(raumId) || { list: [], complete: false, loading: false, loaded: false }
}

function putMessages(raumId, entry) {
  const messages = new Map(state.chat.messages)
  messages.set(raumId, entry)
  setChat({ messages })
}

function mergeMessages(raumId, rows) {
  const cur = messagesOf(raumId)
  const byId = new Map(cur.list.map((m) => [m.id, m]))
  rows.forEach((r) => byId.set(r.id, { ...byId.get(r.id), ...r, pending: false, failed: false }))
  const list = [...byId.values()].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
  putMessages(raumId, { ...cur, list })
}

// Neueste Seite laden (quiet: ohne „lädt“, zum Beispiel nach einem Abgleich)
export async function loadMessages(raumId, quiet = false) {
  const cur = messagesOf(raumId)
  if (!quiet) putMessages(raumId, { ...cur, loading: true })
  try {
    const rows = await api().chatMessages(raumId, null, PAGE)
    const after = messagesOf(raumId)
    putMessages(raumId, { ...after, loading: false, loaded: true, complete: after.loaded ? after.complete : rows.length < PAGE })
    mergeMessages(raumId, rows)
  } catch (err) {
    putMessages(raumId, { ...messagesOf(raumId), loading: false })
    if (!quiet) toast(chatErrorText(err), { error: true })
  }
}

export async function loadOlder(raumId) {
  const cur = messagesOf(raumId)
  if (cur.complete || cur.loading || !cur.list.length) return
  putMessages(raumId, { ...cur, loading: true })
  try {
    const rows = await api().chatMessages(raumId, cur.list[0].created_at, PAGE)
    putMessages(raumId, { ...messagesOf(raumId), loading: false, complete: rows.length < PAGE })
    mergeMessages(raumId, rows)
  } catch (err) {
    putMessages(raumId, { ...messagesOf(raumId), loading: false })
    toast(chatErrorText(err), { error: true })
  }
}

export function setActiveRoom(raumId) {
  if (state.chat.active === raumId) return
  setChat({ active: raumId })
}

// Gelesen bis jetzt. Die Zahlen gehen sofort auf null, die Datenbank folgt im Hintergrund.
const readTimers = new Map()
export function markRead(raumId) {
  const room = getRoom(raumId)
  if (room && (room.ungelesen || room.erwaehnt)) {
    setChat({ rooms: state.chat.rooms.map((r) => (r.id === raumId ? { ...r, ungelesen: 0, erwaehnt: 0 } : r)) })
  }
  clearTimeout(readTimers.get(raumId))
  readTimers.set(
    raumId,
    setTimeout(() => api().chatMarkRead(raumId).catch(() => {}), 400)
  )
}

// Senden: erscheint sofort (blass, bis die Datenbank bestätigt)
export async function sendMessage(raumId, text, erwaehnt) {
  const id = uid()
  const draft = { id, raum_id: raumId, autor: norm(myEmail()), text, erwaehnt, created_at: new Date().toISOString(), bearbeitet_at: null, geloescht_at: null }
  const cur = messagesOf(raumId)
  putMessages(raumId, { ...cur, list: [...cur.list, { ...draft, pending: true }] })
  try {
    const row = await api().chatSend({ id, raum_id: raumId, text, erwaehnt })
    mergeMessages(raumId, [row])
    markRead(raumId)
    scheduleRefresh(false)
    return true
  } catch (err) {
    const after = messagesOf(raumId)
    putMessages(raumId, { ...after, list: after.list.map((m) => (m.id === id ? { ...m, pending: false, failed: true } : m)) })
    toast(chatErrorText(err), { error: true })
    return false
  }
}

// Nicht gesendete Nachricht aus der Liste nehmen (nur lokal, war nie in der Datenbank)
export function discardFailed(raumId, id) {
  const cur = messagesOf(raumId)
  putMessages(raumId, { ...cur, list: cur.list.filter((m) => m.id !== id) })
}

export async function editMessage(msg, text, erwaehnt) {
  try {
    const row = await api().chatEdit(msg.id, { text, erwaehnt })
    mergeMessages(msg.raum_id, [row])
    return true
  } catch (err) {
    toast(chatErrorText(err), { error: true })
    return false
  }
}

export async function deleteMessage(msg) {
  const ok = await confirmDialog({
    title: 'Nachricht löschen?',
    text: 'Der Text ist danach für alle weg. Im Verlauf steht „Nachricht gelöscht“.',
    confirmLabel: 'Löschen',
    danger: true,
  })
  if (!ok) return
  try {
    const row = await api().chatEdit(msg.id, { geloescht: true })
    mergeMessages(msg.raum_id, [row])
  } catch (err) {
    toast(chatErrorText(err), { error: true })
  }
}
