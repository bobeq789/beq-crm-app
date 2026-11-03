// Beispieldaten für den Demo-Modus. Alles erfunden: Namen, Firmen, Nummern, Adressen auf example.com.
// Datumsangaben sind relativ zu heute, damit die Demo immer überfällige und heutige Aufgaben zeigt.
import { SETTINGS } from '../settings.js'
import { uid, todayStr, addDays } from '../lib/util.js'
import { emptyDb } from './rules.js'

export const DEMO_TEAM = [
  { name: 'Anna Berger', email: 'anna.berger@example.com', role: 'admin' },
  { name: 'Jonas Keller', email: 'jonas.keller@example.com', role: 'mitglied' },
  { name: 'Mira Hoffmann', email: 'mira.hoffmann@example.com', role: 'mitglied' },
  { name: 'Paul Neumann', email: 'paul.neumann@example.com', role: 'gast' },
]
export const DEMO_ME = DEMO_TEAM[0].email
export const DEMO_GUEST = DEMO_TEAM[3].email

const A = DEMO_TEAM[0].email
const J = DEMO_TEAM[1].email
const M = DEMO_TEAM[2].email

// Zeitpunkt vor n Tagen (Uhrzeit fest)
function daysAgo(n, hour = 10, minute = 0) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}

export function buildSeed() {
  const db = emptyDb()
  const today = todayStr()
  const created = daysAgo(30)

  db.team_members = DEMO_TEAM.map((t) => ({ id: uid(), ...t, active: true, created_at: created }))

  // Projekte und Spalten aus den Einstellungen
  const projectDefs = [
    ['Partnervertrieb', '#37BA98'],
    ['Pilotkunden', '#34495A'],
    ['Events', '#27836B'],
    ['Allgemein', '#5B6B75'],
  ]
  const P = {}
  const S = {}
  projectDefs.forEach(([name, color], i) => {
    const id = uid()
    P[name] = id
    S[name] = {}
    db.projects.push({ id, name, color, sort: i + 1, archived: false, created_at: created, updated_at: created })
    SETTINGS.defaultStages.forEach((st, j) => {
      const sid = uid()
      S[name][st.kind] = sid
      db.stages.push({ id: sid, project_id: id, name: st.name, kind: st.kind, sort: j + 1, created_at: created })
    })
  })

  // Firmen
  const O = {}
  const orgs = [
    ['nordlicht', 'Nordlicht Handel GmbH', 'Retail', 'Hafenstraße 12, 20457 Hamburg', ['Pilotpartner']],
    ['sonnenberg', 'Kaufhaus Sonnenberg', 'Retail', 'Marktplatz 3, 70173 Stuttgart', ['Interessent']],
    ['auental', 'Klinikverbund Auental', 'Gesundheitswesen', 'Klinikweg 1, 34117 Kassel', ['Pilotpartner']],
    ['muehlbach', 'Pflegezentrum Am Mühlbach', 'Gesundheitswesen', 'Mühlbachweg 8, 79098 Freiburg', ['Interessent']],
    ['rheinblick', 'Wohnbau Rheinblick eG', 'Immobilien', 'Rheinufer 40, 50668 Köln', ['Infrastrukturpartner']],
    ['lindenau', 'Quartiersverwaltung Lindenau', 'Immobilien', 'Lindenauer Markt 5, 04177 Leipzig', ['Growth-Partner']],
    ['brandt', 'Netzwerk Technik Brandt', 'Sonstige', 'Werkstraße 7, 44137 Dortmund', ['Dienstleister']],
    ['lichtblick', 'Eventagentur Lichtblick', 'Sonstige', 'Kanalstraße 21, 10997 Berlin', ['Dienstleister']],
  ]
  orgs.forEach(([key, name, industry, address, labels], i) => {
    const id = uid()
    O[key] = id
    db.organizations.push({
      id,
      name,
      website: `https://${key}.example.com`,
      domain: `${key}.example.com`,
      address,
      industry,
      labels,
      external_id: null,
      created_at: daysAgo(40 - i),
      updated_at: daysAgo(10 - i),
    })
  })

  // Kontakte
  const C = {}
  const persons = [
    ['petra', 'Petra Lindner', 'nordlicht', 'Leiterin Filialbetrieb', ['+49 151 0000 0101', '+49 40 0000 0102'], ['Pilotpartner']],
    ['oliver', 'Oliver Franke', 'nordlicht', 'Leiter IT', ['+49 40 0000 0103'], []],
    ['julia', 'Julia Seidel', 'sonnenberg', 'Einkauf', ['+49 711 0000 0201'], ['Interessent']],
    ['sabine', 'Dr. Sabine Wolf', 'auental', 'Leiterin Digitalisierung', ['+49 561 0000 0301'], ['Pilotpartner']],
    ['markus', 'Markus Engel', 'auental', 'Technischer Leiter', ['+49 160 0000 0302'], []],
    ['stefan', 'Stefan Kraus', 'muehlbach', 'Hausleitung', ['+49 761 0000 0401'], ['Interessent']],
    ['sophie', 'Sophie Wagner', 'muehlbach', 'Pflegedienstleitung', [], []],
    ['laura', 'Laura Vogt', 'rheinblick', 'Vorständin', ['+49 221 0000 0501'], ['Infrastrukturpartner']],
    ['benedikt', 'Benedikt Haas', 'rheinblick', 'Projektleiter Modernisierung', ['+49 170 0000 0502'], []],
    ['nina', 'Nina Albrecht', 'lindenau', 'Quartiersmanagerin', ['+49 341 0000 0601'], ['Growth-Partner']],
    ['thomas', 'Thomas Brandt', 'brandt', 'Geschäftsführer', ['+49 231 0000 0701', '+49 172 0000 0702'], ['Dienstleister']],
    ['katrin', 'Katrin Roth', 'lichtblick', 'Projektleiterin', ['+49 30 0000 0801'], ['Dienstleister']],
    ['daniel', 'Daniel Ritter', null, 'Redakteur', ['+49 89 0000 0901'], ['Presse']],
  ]
  persons.forEach(([key, name, orgKey, position, phones, labels], i) => {
    const id = uid()
    C[key] = id
    const local = name.replace(/^Dr\.\s+/, '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/\s+/g, '.')
    db.persons.push({
      id,
      name,
      org_id: orgKey ? O[orgKey] : null,
      position,
      emails: [`${local}@example.com`],
      phones,
      linkedin_url: i % 3 === 0 ? `https://www.linkedin.com/in/${local.replace('.', '-')}-example` : null,
      labels,
      external_id: null,
      created_at: daysAgo(35 - i),
      updated_at: daysAgo(14 - i),
    })
  })

  // Meetings
  const MT = {}
  const meetings = [
    {
      key: 'auental',
      title: 'Pilotplanung Klinikverbund Auental',
      ago: 1,
      hour: 10,
      duration: 45,
      project: 'Pilotkunden',
      persons: ['sabine', 'markus'],
      extra: ['Emre Yilmaz'],
      summary:
        'Der Klinikverbund möchte den Pilot auf Station 3 starten. Die Haustechnik prüft die Stromversorgung an den vorgesehenen Montagepunkten.\n\nStichpunkte\n- Start frühestens in drei Wochen\n- Der Datenschutz braucht vorab die technische Beschreibung\n- Ansprechpartner vor Ort ist Markus Engel',
      actions:
        'Anna: Datenschutzunterlagen an Klinikverbund senden\nMarkus Engel: Montagepunkte auf Station 3 bestätigen\nJonas: Installationspartner für Kassel anfragen',
    },
    {
      key: 'rheinblick',
      title: 'Erstgespräch Wohnbau Rheinblick',
      ago: 3,
      hour: 14,
      duration: 60,
      project: 'Partnervertrieb',
      persons: ['laura', 'benedikt'],
      extra: [],
      summary:
        'Wohnbau Rheinblick plant die Modernisierung von rund 400 Wohnungen und sucht eine Lösung für das Monitoring im Bestand.\n\nStichpunkte\n- Interesse an einem Rahmenvertrag als Infrastrukturpartner\n- Entscheidung im Vorstand Anfang nächsten Monats\n- Preisblatt vorab gewünscht',
      actions: 'Anna: Preisblatt an Wohnbau Rheinblick schicken\nLaura Vogt: Rückmeldung zum Preisblatt von Wohnbau Rheinblick',
    },
    {
      key: 'brandt',
      title: 'Partnergespräch Netzwerk Technik Brandt',
      ago: 6,
      hour: 9,
      duration: 30,
      project: 'Partnervertrieb',
      persons: ['thomas'],
      extra: [],
      summary:
        'Netzwerk Technik Brandt kann Installationen in Nordrhein-Westfalen übernehmen. Erste Einsätze wären ab Dezember möglich.\n\nStichpunkte\n- Zwei Techniker stehen für Schulungen bereit\n- Rahmenvertrag als Entwurf erhalten',
      actions: 'Jonas: Rahmenvertrag mit Netzwerk Technik Brandt prüfen\nThomas Brandt: Referenzprojekte schicken',
    },
    {
      key: 'presse',
      title: 'Abstimmung Pressearbeit Pilotstart',
      ago: 9,
      hour: 11,
      duration: 30,
      project: 'Events',
      persons: ['daniel'],
      extra: ['Lena Hartmann'],
      summary:
        'Zum Pilotstart soll es eine kurze Pressemitteilung und Fotos von der Installation geben.\n\nStichpunkte\n- Freigabe durch den Pilotpartner nötig\n- Veröffentlichung nach der ersten Pilotwoche',
      actions: 'Mira: Pressemitteilung zum Pilotstart abstimmen\nMira: Fotos von der Installation organisieren',
    },
    {
      key: 'messe',
      title: 'Planung Fachmesse',
      ago: 14,
      hour: 15,
      duration: 50,
      project: 'Events',
      persons: ['katrin'],
      extra: [],
      summary:
        'Erste Planung für den Messeauftritt im Frühjahr. Die Agentur schlägt einen offenen Stand mit Demo-Ecke vor.\n\nStichpunkte\n- Standgröße etwa 24 Quadratmeter\n- Budgetrahmen bis Ende des Monats klären',
      actions: 'Jonas: Messestand für die Fachmesse im Frühjahr buchen\nKatrin Roth: Standentwurf schicken',
    },
    {
      key: 'team',
      title: 'Teamrunde Oktober',
      ago: 20,
      hour: 9,
      duration: 40,
      project: 'Allgemein',
      persons: [],
      extra: [],
      summary: 'Rückblick auf den Oktober und Planung der nächsten Wochen.\n\nStichpunkte\n- Neues CRM wird im November eingeführt\n- Teamtermin im Dezember',
      actions: 'Anna: CRM im Team vorstellen\nMira: Teamtermin für Dezember planen\nJonas: Ablage für Verträge aufräumen',
    },
  ]
  meetings.forEach((m) => {
    const id = uid()
    MT[m.key] = id
    const at = daysAgo(m.ago, m.hour)
    db.meetings.push({
      id,
      title: m.title,
      held_at: at,
      duration_min: m.duration,
      project_id: P[m.project],
      summary: m.summary,
      action_items: m.actions,
      extra_names: m.extra,
      source: 'manuell',
      external_id: null,
      created_by: A,
      created_at: at,
      updated_at: at,
    })
    m.persons.forEach((pk) => db.meeting_persons.push({ id: uid(), meeting_id: id, person_id: C[pk] }))
  })

  // Aufgaben: [Titel, Projekt, Art, Zuständig, Dringlichkeit, fällig in Tagen, Kontakt, Firma, Spaltenwechsel vor Tagen, Meeting]
  const cards = [
    ['Angebot Pilotinstallation an Nordlicht schicken', 'Partnervertrieb', 'todo', A, 'hoch', -2, 'petra', 'nordlicht', 5],
    ['Rahmenvertrag mit Netzwerk Technik Brandt prüfen', 'Partnervertrieb', 'doing', J, 'mittel', 3, 'thomas', 'brandt', 6, 'brandt'],
    ['Rückmeldung zum Preisblatt von Wohnbau Rheinblick', 'Partnervertrieb', 'waiting', A, null, null, 'laura', 'rheinblick', 3, 'rheinblick'],
    ['Partnerunterlagen überarbeiten', 'Partnervertrieb', 'todo', M, 'niedrig', 10, null, null, 8],
    ['Termin mit Quartiersverwaltung Lindenau vereinbaren', 'Partnervertrieb', 'todo', A, null, 0, 'nina', 'lindenau', 4],
    ['Schulung für Installationspartner planen', 'Partnervertrieb', 'later', J, null, null, null, 'brandt', 12],
    ['Referenzliste für Partner aktualisieren', 'Partnervertrieb', 'done', M, null, null, null, null, 3],
    ['Erstgespräch Kaufhaus Sonnenberg nachbereiten', 'Partnervertrieb', 'done', A, null, null, 'julia', 'sonnenberg', 8],
    ['Sensorplan für Station 3 abstimmen', 'Pilotkunden', 'doing', A, 'hoch', 1, 'markus', 'auental', 2],
    ['Datenschutzunterlagen an Klinikverbund senden', 'Pilotkunden', 'todo', A, 'hoch', 0, 'sabine', 'auental', 1, 'auental'],
    ['Freigabe der Hausleitung abwarten', 'Pilotkunden', 'waiting', J, null, null, 'stefan', 'muehlbach', 12],
    ['Messwerte aus der ersten Pilotwoche auswerten', 'Pilotkunden', 'todo', M, 'mittel', 4, null, 'nordlicht', 3],
    ['Installationstermin Filiale Hafenstraße bestätigen', 'Pilotkunden', 'waiting', A, null, null, 'oliver', 'nordlicht', 2],
    ['Abschlussbericht Pilot Nordlicht vorbereiten', 'Pilotkunden', 'later', A, 'niedrig', 21, null, 'nordlicht', 9],
    ['Zugangsdaten für das Dashboard einrichten', 'Pilotkunden', 'done', J, null, null, 'petra', 'nordlicht', 1],
    ['Feedbackbogen für Pflegekräfte entwerfen', 'Pilotkunden', 'todo', M, null, -1, 'sophie', 'muehlbach', 6],
    ['Messestand für die Fachmesse im Frühjahr buchen', 'Events', 'todo', J, 'hoch', 5, 'katrin', 'lichtblick', 14, 'messe'],
    ['Pressemitteilung zum Pilotstart abstimmen', 'Events', 'waiting', M, null, null, 'daniel', null, 4, 'presse'],
    ['Vortrag für das Partnerforum vorbereiten', 'Events', 'doing', A, 'mittel', 9, null, null, 5],
    ['Giveaways bestellen', 'Events', 'later', M, 'niedrig', null, null, null, 10],
    ['Rechnung der Eventagentur prüfen', 'Events', 'done', J, null, null, null, 'lichtblick', 5],
    ['Reisekostenabrechnung Oktober', 'Allgemein', 'todo', A, 'niedrig', 2, null, null, 2],
    ['Kontaktliste aus der Messe nachpflegen', 'Allgemein', 'todo', A, null, null, null, null, 7],
    ['CRM im Team vorstellen', 'Allgemein', 'todo', A, 'mittel', 6, null, null, 20, 'team'],
    ['Ablage für Verträge aufräumen', 'Allgemein', 'later', J, null, null, null, null, 20, 'team'],
    ['Teamtermin für Dezember planen', 'Allgemein', 'todo', M, null, 12, null, null, 20, 'team'],
    ['Bildmaterial für die Website sammeln', 'Allgemein', 'todo', A, null, null, null, null, 11],
    ['Notizen aus dem Partnerforum verteilen', 'Allgemein', 'todo', null, null, 15, null, null, 6],
  ]
  const K = {}
  cards.forEach(([title, project, kind, assignee, priority, due, personKey, orgKey, changedAgo, meetingKey], i) => {
    const id = uid()
    K[title] = id
    db.cards.push({
      id,
      title,
      description: null,
      project_id: P[project],
      stage_id: S[project][kind],
      person_id: personKey ? C[personKey] : null,
      org_id: orgKey ? O[orgKey] : null,
      assignee,
      priority,
      due_date: due === null || due === undefined ? null : addDays(today, due),
      archived: false,
      meeting_id: meetingKey ? MT[meetingKey] : null,
      stage_changed_at: daysAgo(changedAgo, 9 + (i % 8)),
      external_id: null,
      created_by: assignee || A,
      created_at: daysAgo(changedAgo + 2),
      updated_at: daysAgo(Math.max(0, changedAgo - 1), 8 + (i % 9), (i * 7) % 60),
    })
  })

  // Notizen
  const notes = [
    ['Petra hat die Filialen Hafenstraße und Altona für den Pilot vorgeschlagen. Angebot bitte mit beiden Standorten.', { card_id: K['Angebot Pilotinstallation an Nordlicht schicken'] }, A, 3],
    ['Laura will das Preisblatt erst im Vorstand besprechen. Nachfassen frühestens nächste Woche.', { card_id: K['Rückmeldung zum Preisblatt von Wohnbau Rheinblick'] }, A, 2],
    ['Plan liegt hier: https://example.com/station-3-plan\nMarkus prüft die Steckdosen bis Donnerstag.', { card_id: K['Sensorplan für Station 3 abstimmen'] }, J, 1],
    ['Sehr offen für den Pilot. Bevorzugt kurze Mails, telefonisch am besten vormittags.', { person_id: C.petra }, A, 9],
    ['Entscheidet zusammen mit dem Vorstand. Benedikt Haas ist für die Technik zuständig.', { person_id: C.laura }, A, 3],
    ['Hat den Pilot intern vorgestellt und viel Zuspruch bekommen.', { person_id: C.sabine }, M, 5],
    ['Insgesamt 42 Filialen in Norddeutschland. Pilot zunächst mit zwei Standorten.', { org_id: O.nordlicht }, A, 12],
    ['Drei Standorte, Station 3 im Haupthaus ist für den Pilot vorgesehen.', { org_id: O.auental }, J, 6],
    ['Emre Yilmaz aus der Haustechnik war spontan dabei. Gute Fragen zur Stromversorgung.', { meeting_id: MT.auental }, A, 1],
  ]
  notes.forEach(([content, ref, author, ago], i) => {
    const at = daysAgo(ago, 12 + (i % 6), (i * 13) % 60)
    db.notes.push({
      id: uid(),
      content,
      card_id: null,
      person_id: null,
      org_id: null,
      meeting_id: null,
      internal: false,
      ...ref,
      author,
      external_id: null,
      created_at: at,
      updated_at: at,
    })
  })

  // Eine Karte ist mit dem Gast geteilt, dazu eine öffentliche und eine interne Notiz
  const sharedCard = K['Installationstermin Filiale Hafenstraße bestätigen']
  db.card_shares.push({ id: uid(), card_id: sharedCard, email: DEMO_GUEST, created_at: daysAgo(2) })
  db.notes.push(
    { id: uid(), content: 'Paul übernimmt die Abstimmung mit der Filialleitung vor Ort.', card_id: sharedCard, person_id: null, org_id: null, meeting_id: null, internal: false, author: A, external_id: null, created_at: daysAgo(2, 11), updated_at: daysAgo(2, 11) },
    { id: uid(), content: 'Intern: Preis für die Installation noch nicht final, bitte nicht mit Paul besprechen.', card_id: sharedCard, person_id: null, org_id: null, meeting_id: null, internal: true, author: J, external_id: null, created_at: daysAgo(1, 16), updated_at: daysAgo(1, 16) }
  )

  // Termine in zwei Kalendern, diese und nächste Woche
  const mailOf = (key) => db.persons.find((p) => p.id === C[key]).emails[0]
  const calendars = {
    anna: { id: A, name: 'Anna Berger', color: '#37BA98' },
    jonas: { id: J, name: 'Jonas Keller', color: '#34495A' },
  }
  // Zeitpunkt in n Tagen um hh:mm (n darf negativ sein)
  const at = (n, h, m = 0) => {
    const d = new Date()
    d.setDate(d.getDate() + n)
    d.setHours(h, m, 0, 0)
    return d.toISOString()
  }
  const eventDefs = [
    ['anna', -3, 14, 0, 60, 'Erstgespräch Wohnbau Rheinblick', [A, mailOf('laura'), mailOf('benedikt')], 'Rheinufer 40, 50668 Köln', false],
    ['anna', -1, 10, 0, 45, 'Pilotplanung Klinikverbund Auental', [A, J, mailOf('sabine'), mailOf('markus'), 'emre.yilmaz@example.com'], null, true],
    ['anna', 0, 9, 30, 30, 'Jour fixe Vertrieb', [A, J, M], null, true],
    ['anna', 0, 14, 0, 60, 'Telefonat Nordlicht Handel', [A, mailOf('petra')], 'Telefon', false],
    ['jonas', 0, 14, 30, 60, 'Interner Check-in Installationspartner', [J, A], null, true],
    ['jonas', 1, 11, 0, 60, 'Termin Wohnbau Rheinblick', [J, A, mailOf('laura'), mailOf('benedikt')], 'Rheinufer 40, 50668 Köln', false],
    ['jonas', 1, null, 0, 0, 'Planungstag Fachmesse', [J], null, false],
    ['jonas', 2, 13, 0, 30, 'Abstimmung Netzwerk Technik Brandt', [J, mailOf('thomas')], null, true],
    ['anna', 3, 10, 0, 90, 'Workshop Pflegezentrum Am Mühlbach', [A, M, mailOf('stefan'), mailOf('sophie'), 'neue.ansprechpartnerin@example.com'], 'Mühlbachweg 8, 79098 Freiburg', false],
    ['anna', 4, 16, 0, 30, 'Rückruf Presse', [A, mailOf('daniel')], null, false],
    ['anna', 7, 9, 0, 60, 'Teamrunde November', [A, J, M], null, true],
    ['jonas', 8, 15, 0, 60, 'Vorbereitung Partnerforum', [J, mailOf('katrin')], null, true],
    ['anna', 9, 11, 0, 60, 'Review Pilot Klinikverbund', [A, mailOf('sabine')], null, true],
  ]
  eventDefs.forEach(([cal, day, hour, minute, minutes, title, attendees, location, meet], i) => {
    const allDay = hour === null
    const start = allDay ? at(day, 0) : at(day, hour, minute)
    const end = allDay ? at(day + 1, 0) : new Date(new Date(start).getTime() + minutes * 60000).toISOString()
    const id = uid()
    db.events.push({
      id,
      calendar_id: calendars[cal].id,
      calendar_name: calendars[cal].name,
      calendar_color: calendars[cal].color,
      event_id: 'demo' + i,
      ical_uid: `demo-${i}@example.com`,
      title,
      start_at: start,
      end_at: end,
      all_day: allDay,
      location,
      meet_url: meet ? `https://meet.google.com/aaa-bbbb-${String(100 + i)}` : null,
      html_link: 'https://calendar.google.com/calendar/',
      organizer: calendars[cal].id,
      attendees,
      description: i === 1 ? 'Agenda:\n1. Montagepunkte Station 3\n2. Datenschutz\n3. Zeitplan' : null,
      status: 'confirmed',
      updated_at: daysAgo(5),
    })
    attendees.forEach((mail) => {
      const person = db.persons.find((p) => p.emails.includes(mail))
      if (person) db.event_persons.push({ id: uid(), event_id: id, person_id: person.id })
    })
  })

  // Mails bei drei Kontakten
  const mailDefs = [
    ['petra', 'out', A, 6, 'Angebot Pilotinstallation', 'Hallo Petra,\n\nwie besprochen schicke ich dir das Angebot für die Pilotinstallation in zwei Filialen.\n\nViele Grüße\nAnna', ['Angebot_Pilot_Nordlicht.pdf'], 't1'],
    ['petra', 'in', A, 4, 'AW: Angebot Pilotinstallation', 'Hallo Anna,\n\ndanke für das Angebot. Wir würden gern mit der Filiale Hafenstraße starten. Passt euch ein Termin in der kommenden Woche?\n\nBeste Grüße\nPetra\n\nAm Mo., 27. Okt. schrieb Anna Berger:\n> Hallo Petra,\n> wie besprochen schicke ich dir das Angebot für die Pilotinstallation in zwei Filialen.\n> Viele Grüße\n> Anna', [], 't1'],
    ['petra', 'in', A, 1, 'Standorte für den Pilot', 'Hallo Anna,\n\nanbei die Grundrisse der beiden Filialen. Die Haustechnik ist informiert.\n\nPetra', ['Grundriss_Hafenstrasse.pdf', 'Grundriss_Altona.pdf'], 't2'],
    ['laura', 'out', A, 5, 'Preisblatt beQ Hub', 'Hallo Frau Vogt,\n\nwie vereinbart erhalten Sie unser Preisblatt für die Modernisierung im Bestand.\n\nFreundliche Grüße\nAnna Berger', ['Preisblatt_beQ_Hub.pdf'], 't3'],
    ['laura', 'in', A, 2, 'AW: Preisblatt beQ Hub', 'Hallo Frau Berger,\n\nvielen Dank. Wir besprechen das Preisblatt in der nächsten Vorstandssitzung und melden uns danach.\n\nMit freundlichen Grüßen\nLaura Vogt\n\nAm Di., 28. Okt. schrieb Anna Berger:\n> Hallo Frau Vogt,\n> wie vereinbart erhalten Sie unser Preisblatt für die Modernisierung im Bestand.', [], 't3'],
    ['laura', 'out', J, 0, 'Termin morgen', 'Hallo Frau Vogt,\n\nich freue mich auf unseren Termin morgen um 11 Uhr bei Ihnen in Köln.\n\nViele Grüße\nJonas Keller', [], 't4'],
    ['thomas', 'in', J, 7, 'Rahmenvertrag Entwurf', 'Hallo Jonas,\n\nanbei unser Entwurf für den Rahmenvertrag. Wir könnten ab Dezember starten.\n\nGruß\nThomas', ['Rahmenvertrag_Entwurf.docx'], 't5'],
    ['thomas', 'out', J, 3, 'AW: Rahmenvertrag Entwurf', 'Hallo Thomas,\n\ndanke dir. Ich gehe den Entwurf bis Ende der Woche durch und melde mich mit Anmerkungen.\n\nViele Grüße\nJonas\n\nAm Mo., 27. Okt. schrieb Thomas Brandt:\n> Hallo Jonas,\n> anbei unser Entwurf für den Rahmenvertrag.', [], 't5'],
  ]
  mailDefs.forEach(([key, direction, mailbox, ago, subject, body, attachments, thread], i) => {
    const person = db.persons.find((p) => p.id === C[key])
    const contact = person.emails[0]
    const self = db.team_members.find((t) => t.email === mailbox)
    const id = uid()
    db.emails.push({
      id,
      message_id: `<demo-${i}@example.com>`,
      thread_id: thread,
      mailbox,
      provider_id: 'demo' + i,
      direction,
      from_email: direction === 'out' ? mailbox : contact,
      from_name: direction === 'out' ? self.name : person.name,
      to_emails: direction === 'out' ? [contact] : [mailbox],
      cc_emails: [],
      subject,
      sent_at: daysAgo(ago, 9 + i, 15),
      body,
      attachments,
      created_at: daysAgo(ago, 9 + i, 20),
    })
    db.email_persons.push({ id: uid(), email_id: id, person_id: person.id })
  })

  return db
}
