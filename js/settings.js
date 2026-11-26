// Einstellungen aus Prompt 1. Hier ändern, wenn sich Vorgaben ändern.
// Angezeigte Namen (label) sind Getter: Sie liefern immer die aktuelle Sprache (i18n.js).
// Werte, die in der Datenbank stehen (name der Standardspalten, labels, industries), bleiben deutsch.
import { t } from './i18n.js'

export const SETTINGS = {
  appName: 'beQ CRM',
  // Spalten, die jedes neue Projekt bekommt (Art in kind)
  defaultStages: [
    { name: 'To-dos', kind: 'todo' },
    { name: 'In Arbeit', kind: 'doing' },
    { name: 'Warte auf Rückmeldung', kind: 'waiting' },
    { name: 'Später', kind: 'later' },
    { name: 'Erledigt', kind: 'done' },
  ],
  stageKinds: [
    { value: 'todo', get label() { return t('To-do') } },
    { value: 'doing', get label() { return t('In Arbeit') } },
    { value: 'waiting', get label() { return t('Wartet') } },
    { value: 'later', get label() { return t('Später') } },
    { value: 'done', get label() { return t('Erledigt') } },
  ],
  priorities: [
    { value: 'hoch', get label() { return t('Hoch') } },
    { value: 'mittel', get label() { return t('Mittel') } },
    { value: 'niedrig', get label() { return t('Niedrig') } },
  ],
  labels: ['Pilotpartner', 'Infrastrukturpartner', 'Growth-Partner', 'Interessent', 'Dienstleister', 'Presse'],
  industries: ['Retail', 'Gesundheitswesen', 'Immobilien', 'Sonstige'],
  // Projektfarben nur aus der Palette der beQ Hub
  projectColors: [
    { value: '#37BA98', get label() { return t('Grün') } },
    { value: '#34495A', get label() { return t('Navy 3') } },
    { value: '#9AA7B0', get label() { return t('Grau') } },
    { value: '#27836B', get label() { return t('Grün dunkel') } },
    { value: '#BFEADF', get label() { return t('Grün hell') } },
    { value: '#5B6B75', get label() { return t('Schiefer') } },
  ],
  // Rückfall für neue Deals, wenn es keine eigene „Intern <Vorname>“ gibt (defaultProjectId() in store.js)
  defaultProjectName: 'Allgemein',
}
