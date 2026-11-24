// Notizen von Gemini (Google Meet) als Meeting übernehmen (Wunsch vom 24.11.2026, 41_meeting_gemini.sql).
//
// Gemini schickt nach einem Meeting eine Mail von gemini-notes@google.com, Betreff
// „Notizen: „Titel“ 24. Nov. 2026“ oder „Notes: “Title” Nov 24, 2026“. Im Text stehen nacheinander
// „Zusammenfassung“ (Summary), „Empfohlene nächste Schritte“ (Suggested next steps), manchmal
// „Details“, danach Googles Fußzeile. Diese Datei zerlegt das, ohne etwas zu laden oder zu speichern.
// Was daraus ein Meeting macht, steht in importGeminiMeeting() in store.js.

export const GEMINI_SENDER = 'gemini-notes@google.com'

export const isGeminiMail = (mail) => !!mail && String(mail.from_email || '').toLowerCase() === GEMINI_SENDER

const HEADINGS = [
  ['summary', /^(zusammenfassung|summary)$/i],
  ['next', /^(empfohlene nächste schritte|vorgeschlagene nächste schritte|nächste schritte|suggested next steps|next steps|action items)$/i],
  ['details', /^details$/i],
]
// Ab hier kommt nur noch Googles Fußzeile (der Bindestrich in „E‑Mail“ ist bei Google oft ein
// geschützter, deshalb „E.Mail“)
const FOOTER = /^(ist der inhalt dieser e.mail hilfreich|is this email helpful|was this email helpful|e.mail war (nicht )?hilfreich|email was (not )?helpful|besprechungsaufzeichnungen|meeting records|google llc|sie haben diese e.mail erhalten|you (have )?received this email|you are receiving this email)/i

function clean(lines) {
  return lines
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Titel aus dem Betreff: Text in den Anführungszeichen, sonst ohne „Notizen:“ und Datum
export function geminiTitle(subject) {
  const s = String(subject || '').trim()
  const quoted = s.match(/„([^“”"]+)[“”"]/) || s.match(/“([^”]+)”/) || s.match(/"([^"]+)"/)
  if (quoted) return quoted[1].trim()
  return s.replace(/^(notizen|notes)\s*:\s*/i, '').trim() || 'Meeting'
}

// { title, summary, nextSteps } oder null, wenn keine Zusammenfassung zu finden ist
export function parseGeminiMail(mail) {
  if (!isGeminiMail(mail)) return null
  const lines = String(mail.body || '').replace(/\r\n?/g, '\n').split('\n')
  const parts = { summary: [], next: [], details: [] }
  let current = null
  for (const raw of lines) {
    const line = raw.trim()
    const heading = HEADINGS.find(([, re]) => re.test(line))
    if (heading) {
      current = heading[0]
      continue
    }
    if (FOOTER.test(line)) {
      if (current) break
      continue
    }
    if (current) parts[current].push(raw.replace(/\s+$/, ''))
  }
  const summary = clean(parts.summary)
  const details = clean(parts.details)
  if (!summary && !details) return null
  return {
    title: geminiTitle(mail.subject),
    summary: [summary, details && 'Details\n' + details].filter(Boolean).join('\n\n'),
    nextSteps: clean(parts.next) || null,
  }
}

// Gleicher Titel? (Groß- und Kleinschreibung, Leerraum und Anführungszeichen egal)
export const sameTitle = (a, b) => {
  const n = (s) => String(s || '').toLowerCase().replace(/[„“”"']/g, '').replace(/\s+/g, ' ').trim()
  return !!n(a) && n(a) === n(b)
}
