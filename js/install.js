// Das CRM als App auf dem Handy (Wunsch vom 26.11.2026): Vollbild ohne Adressleiste und auf dem
// iPhone die Voraussetzung für Mitteilungen.
//   Android, Chrome (und Edge, Samsung Internet): Der Browser meldet mit „beforeinstallprompt“, dass
//     sich das CRM installieren lässt. Wir halten das Ereignis fest und zeigen einen eigenen Knopf
//     „App installieren“. Ohne Ereignis (schon abgelehnt, anderer Browser) steht eine Anleitung da.
//   iPhone: Installieren geht nur über „Teilen“, „Zum Home-Bildschirm“. In Safari sitzt „Teilen“
//     unten in der Leiste, in Chrome rechts in der Adresszeile. Mitteilungen gibt es auf dem iPhone
//     nur in der App vom Home-Bildschirm, egal aus welchem Browser sie angelegt wurde.
// Muss früh geladen werden (main.js), sonst ist „beforeinstallprompt“ schon vorbei.
import { emit } from './store.js'
import { t } from './i18n.js'

let deferred = null
let installed = false

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e
    emit()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    installed = true
    emit()
  })
}

const ua = () => (typeof navigator !== 'undefined' ? navigator.userAgent : '')
export const isIos = () => /iPhone|iPad|iPod/.test(ua()) || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
export const isAndroid = () => /Android/.test(ua())
export const isPhone = () => isIos() || isAndroid()
// Chrome auf dem iPhone meldet sich als „CriOS“, Edge als „EdgiOS“, Firefox als „FxiOS“
export const iosBrowser = () => (/CriOS/.test(ua()) ? 'chrome' : /EdgiOS/.test(ua()) ? 'edge' : /FxiOS/.test(ua()) ? 'firefox' : 'safari')
export const isStandalone = () =>
  typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true)

export const canPromptInstall = () => !!deferred
export const justInstalled = () => installed

// Eigener Knopf: zeigt die Abfrage des Browsers. Gibt true zurück, wenn installiert wird.
export async function promptInstall() {
  if (!deferred) return false
  const e = deferred
  deferred = null
  emit()
  try {
    await e.prompt()
    const choice = await e.userChoice
    return choice && choice.outcome === 'accepted'
  } catch {
    return false
  }
}

// Anleitung in einem Satz, passend zu Handy und Browser
export function installHowTo() {
  if (isIos()) {
    const b = iosBrowser()
    if (b === 'chrome') return t('In Chrome rechts in der Adresszeile auf das Teilen-Symbol (Quadrat mit Pfeil) tippen, dann „Zum Home-Bildschirm“ und „Hinzufügen“.')
    if (b === 'edge') return t('In Edge unten auf das Menü (drei Striche) tippen, dann „Teilen“ und „Zum Home-Bildschirm“.')
    if (b === 'firefox') return t('In Firefox unten auf das Menü tippen, dann „Teilen“ und „Zum Home-Bildschirm“.')
    return t('In Safari unten auf „Teilen“ (Quadrat mit Pfeil) tippen, dann „Zum Home-Bildschirm“ und „Hinzufügen“.')
  }
  if (isAndroid()) return t('In Chrome oben rechts auf das Menü (drei Punkte) tippen, dann „App installieren“ oder „Zum Startbildschirm hinzufügen“.')
  return t('In Chrome oder Edge rechts in der Adresszeile auf das Symbol „App installieren“ klicken.')
}
