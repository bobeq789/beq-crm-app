// Einstellungen aus Prompt 1. Hier ändern, wenn sich Vorgaben ändern.
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
    { value: 'todo', label: 'To-do' },
    { value: 'doing', label: 'In Arbeit' },
    { value: 'waiting', label: 'Wartet' },
    { value: 'later', label: 'Später' },
    { value: 'done', label: 'Erledigt' },
  ],
  priorities: [
    { value: 'hoch', label: 'Hoch' },
    { value: 'mittel', label: 'Mittel' },
    { value: 'niedrig', label: 'Niedrig' },
  ],
  labels: ['Pilotpartner', 'Infrastrukturpartner', 'Growth-Partner', 'Interessent', 'Dienstleister', 'Presse'],
  industries: ['Retail', 'Gesundheitswesen', 'Immobilien', 'Sonstige'],
  // Projektfarben nur aus der Palette der beQ Hub
  projectColors: [
    { value: '#37BA98', label: 'Grün' },
    { value: '#34495A', label: 'Navy 3' },
    { value: '#9AA7B0', label: 'Grau' },
    { value: '#27836B', label: 'Grün dunkel' },
    { value: '#BFEADF', label: 'Grün hell' },
    { value: '#5B6B75', label: 'Schiefer' },
  ],
  defaultProjectName: 'Allgemein',
}
