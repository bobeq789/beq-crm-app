// Sprache der Oberfläche (Wunsch vom 26.11.2026): Deutsch oder Englisch, Standard Deutsch.
//
// Im Code bleibt der deutsche Text der Ausgangstext: t('Speichern') gibt auf Deutsch „Speichern“
// zurück, auf Englisch den Eintrag aus dem Wörterbuch (js/i18n/en-*.js). Fehlt ein Eintrag, steht
// der deutsche Text da, es geht also nie etwas kaputt. Platzhalter in geschweiften Klammern:
//   t('Noch {n} Deals', { n: 3 })  →  „Noch 3 Deals“ / „3 more deals“
// Einzahl und Mehrzahl als zwei Schlüssel: n === 1 ? t('1 Kontakt') : t('{n} Kontakte', { n })
//
// Woher die Sprache kommt (store.js ruft setLang()):
//   1. state.prefs.sprache (nutzer_einstellungen, je Person auf allen Geräten)
//   2. sonst local „beqcrm-sprache“ (Anmeldeseite, je Gerät)
//   3. sonst Deutsch
// Übersetzt wird nur, was die App selbst schreibt. Inhalte (Namen von Pipelines und Labels, Deals,
// Notizen, Mails, Meetings, Demo-Daten) bleiben, wie sie eingegeben wurden. Ausnahme: die fünf
// Standardspalten (stageLabel()), weil sie aus der App selbst stammen.
//
// Begriffe auf Englisch (verbindlich wie im Deutschen):
//   Deal = Deal, Pipeline = Pipeline, Wert und Status = Value and status, Aktivität = Activity,
//   Wiedervorlage = Follow-up, To-do = To-do, Anruf = Call, Termin = Meeting (Kalender: Event),
//   Kachel „Zu erledigen“ = To do, Übersicht = Overview, Postfach = Inbox, Kontakte = Contacts,
//   Firmen = Companies, Zuständig = Owner, weitere Zuständige = Co-owners, Label = Label,
//   Kanal = Channel, Direktnachricht = Direct message, Gruppe = Group, Gast = Guest,
//   Einstellungen = Settings, Archiv/archivieren = Archive.
import { EN } from './i18n/en.js'

let lang = 'de'

export const getLang = () => lang
export const isEnglish = () => lang === 'en'
// Locale für Datum, Zahlen und Sortierung
export const locale = () => (lang === 'en' ? 'en-GB' : 'de-DE')

export function setLang(value) {
  lang = value === 'en' ? 'en' : 'de'
  if (typeof document !== 'undefined') document.documentElement.lang = lang
}

export function t(de, vars) {
  let s = lang === 'en' && Object.prototype.hasOwnProperty.call(EN, de) ? EN[de] : de
  if (vars) s = String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m))
  return s
}

// Die fünf Standardspalten (01_schema.sql) auf Englisch, eigene Spaltennamen bleiben
const STAGES = { 'To-dos': 'To-dos', 'In Arbeit': 'In progress', 'Warte auf Rückmeldung': 'Waiting for reply', Später: 'Later', Erledigt: 'Done' }
export const stageLabel = (name) => (lang === 'en' && STAGES[name] ? STAGES[name] : name)
