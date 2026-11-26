// Mitteilungen aufs Handy (Stufe C Schritt 3, 34_chat_push.sql, Edge Function „chat-push“).
// Ein Gerät einschalten heißt: Erlaubnis im Browser holen, beim Push-Dienst des Browsers anmelden
// (mit dem öffentlichen Schlüssel aus push_schluessel()) und das Gerät in push_abos eintragen.
// Was ankommt, regeln die Einstellungen unter state.prefs.push (nutzer_einstellungen):
//   vorschau: 'text' (Name und Textanfang, Standard) oder 'name'
//   direkt, gruppen, erwaehnungen: an, solange nicht false
//   kanaele: Kanäle, die eingeschaltet sind (Standard keine), stumm: Gruppen und Direktnachrichten aus
// Angezeigt werden die Mitteilungen im Service Worker (sw.js).
import { state, emit, toast, errorText, getApi, isDemo, isGuest, savePrefs } from './store.js'

const api = () => getApi()

export function pushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext
}
// Gerät und Browser erkennen steht in install.js (dort auch „App installieren“)
import { isIos, isStandalone, installHowTo } from './install.js'
export { isIos, isStandalone }

// Kurzer Gerätename für die Liste („iPhone“, „Android“, „Mac“ …), ohne genaue Kennung
export function deviceName() {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iPad'
  if (/Android/.test(ua)) return 'Android'
  if (/Mac OS X/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows'
  if (/Linux/.test(ua)) return 'Linux'
  return 'Browser'
}

function keyBytes(b64) {
  let s = String(b64).replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4) s += '='
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
}

async function registration() {
  return navigator.serviceWorker.ready
}

// Ist dieses Gerät eingeschaltet? (Erlaubnis da und beim Push-Dienst angemeldet)
export async function currentSubscription() {
  if (!pushSupported() || isDemo) return null
  try {
    const reg = await registration()
    return await reg.pushManager.getSubscription()
  } catch {
    return null
  }
}

function setPush(patch) {
  state.push = { ...(state.push || {}), ...patch }
  emit()
}

// Stand für die Einstellungen: dieses Gerät und alle eigenen Geräte
export async function refreshPushState() {
  const sub = await currentSubscription()
  let devices = []
  try {
    devices = (await api().pushDevices()) || []
  } catch {
    devices = []
  }
  setPush({
    loaded: true,
    permission: pushSupported() ? Notification.permission : 'unsupported',
    here: !!(sub && devices.some((d) => d.endpoint === sub.endpoint)),
    devices,
  })
}

async function saveSubscription(sub) {
  const j = sub.toJSON()
  await api().pushSave({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, geraet: deviceName() })
}

export async function enablePush() {
  if (isDemo) return toast('Im Demo-Modus gibt es keine Mitteilungen aufs Handy.')
  if (!pushSupported()) return toast('Dieser Browser kann keine Mitteilungen empfangen.', { error: true })
  if (isIos() && !isStandalone()) {
    return toast('Auf dem iPhone geht das nur aus der App auf dem Home-Bildschirm. ' + installHowTo() + ' Dann das CRM von dort öffnen und hier einschalten.', { error: true })
  }
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    setPush({ permission })
    return toast('Mitteilungen sind im Browser nicht erlaubt. Erlaube sie in den Einstellungen des Browsers für diese Seite.', { error: true })
  }
  try {
    const key = await api().pushKey()
    if (!key) return toast('Mitteilungen sind im CRM noch nicht eingerichtet. Bitte gleich noch einmal versuchen.', { error: true })
    const reg = await registration()
    let sub = await reg.pushManager.getSubscription()
    // Anderer Schlüssel als beim letzten Mal: neu anmelden
    if (sub && sub.options && sub.options.applicationServerKey) {
      const old = new Uint8Array(sub.options.applicationServerKey)
      const now = keyBytes(key)
      if (old.length !== now.length || old.some((b, i) => b !== now[i])) {
        await sub.unsubscribe().catch(() => {})
        sub = null
      }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) })
    await saveSubscription(sub)
    await refreshPushState()
    toast('Mitteilungen sind auf diesem Gerät an.')
  } catch (err) {
    toast('Mitteilungen ließen sich nicht einschalten. ' + errorText(err), { error: true })
  }
}

export async function disablePush() {
  try {
    const sub = await currentSubscription()
    if (sub) {
      await api().pushRemove(sub.endpoint)
      await sub.unsubscribe().catch(() => {})
    }
    await refreshPushState()
    toast('Mitteilungen sind auf diesem Gerät aus.')
  } catch (err) {
    toast('Mitteilungen ließen sich nicht ausschalten. ' + errorText(err), { error: true })
  }
}

export async function sendTestPush() {
  if (isDemo) return toast('Im Demo-Modus gibt es keine Mitteilungen aufs Handy.')
  try {
    const n = await api().pushTest()
    toast(n ? `Testmitteilung ist unterwegs (an ${n === 1 ? 'ein Gerät' : n + ' Geräte'}).` : 'Auf keinem Gerät sind Mitteilungen an. Bitte erst einschalten.')
  } catch (err) {
    toast('Die Testmitteilung ließ sich nicht schicken. ' + errorText(err), { error: true })
  }
}

// Beim Start: Ist dieses Gerät angemeldet, Eintrag auffrischen (zum Beispiel nach neuer Anmeldung)
export async function syncPush() {
  if (isDemo || !pushSupported() || Notification.permission !== 'granted') return
  const sub = await currentSubscription()
  if (sub) await saveSubscription(sub).catch(() => {})
}

// ------------------------------------------------------------
// Einstellungen (auf allen Geräten gleich)
// ------------------------------------------------------------
export const pushPrefs = () => state.prefs.push || {}

export function savePushPrefs(patch) {
  return savePrefs({ push: { ...pushPrefs(), ...patch } })
}

// Kommt aus diesem Raum etwas? Kanäle nur eingeschaltet, Gruppen und Direktnachrichten bis „stumm“
export function roomPushOn(room) {
  const p = pushPrefs()
  if (room.art === 'kanal') return (p.kanaele || []).includes(room.id)
  return !(p.stumm || []).includes(room.id)
}

export function toggleRoomPush(room) {
  if (isGuest()) return
  const p = pushPrefs()
  const on = roomPushOn(room)
  const without = (list) => (list || []).filter((id) => id !== room.id)
  if (room.art === 'kanal') {
    return savePushPrefs({ kanaele: on ? without(p.kanaele) : [...without(p.kanaele), room.id] }).then((ok) => ok && toast(on ? 'Keine Mitteilungen mehr aus diesem Kanal.' : 'Mitteilungen aus diesem Kanal sind an.'))
  }
  return savePushPrefs({ stumm: on ? [...without(p.stumm), room.id] : without(p.stumm) }).then((ok) => ok && toast(on ? 'Stumm geschaltet. Aus diesem Chat kommen keine Mitteilungen mehr.' : 'Mitteilungen sind wieder an.'))
}
