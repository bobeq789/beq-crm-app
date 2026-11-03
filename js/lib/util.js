// Kleine Helfer: IDs, deutsche Datumsangaben, Suche, Links, Telefonnummern

export function uid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID()
  // Ersatz für ältere Browser
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

export const nowIso = () => new Date().toISOString()

const pad = (n) => String(n).padStart(2, '0')

// Datum als JJJJ-MM-TT in Ortszeit
export function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
export const todayStr = () => ymd(new Date())

export function parseYmd(s) {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(dateStr, n) {
  const d = parseYmd(dateStr)
  d.setDate(d.getDate() + n)
  return ymd(d)
}

// Tage von a bis b (b minus a), beide als JJJJ-MM-TT
export function dayDiff(a, b) {
  return Math.round((parseYmd(b) - parseYmd(a)) / 86400000)
}

// Ende der laufenden Woche (Sonntag)
export function endOfWeekStr() {
  const d = new Date()
  const dow = d.getDay() // 0 = Sonntag
  d.setDate(d.getDate() + (dow === 0 ? 0 : 7 - dow))
  return ymd(d)
}

const WD = ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.']
const WD_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']
const MON = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sept.', 'Okt.', 'Nov.', 'Dez.']
const MON_LONG = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

// „Mo., 3. Nov.“ (mit Jahr, wenn nicht das laufende Jahr)
export function fmtDate(value) {
  if (!value) return ''
  const d = typeof value === 'string' && value.length <= 10 ? parseYmd(value) : new Date(value)
  const year = d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : ''
  return `${WD[d.getDay()]}, ${d.getDate()}. ${MON[d.getMonth()]}${year}`
}

// „Montag, 2. November“
export function fmtDateLong(d = new Date()) {
  return `${WD_LONG[d.getDay()]}, ${d.getDate()}. ${MON_LONG[d.getMonth()]}`
}

export function fmtTime(iso) {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fmtDateTime(iso) {
  if (!iso) return ''
  return `${fmtDate(iso)}, ${fmtTime(iso)}`
}

export function monthLabel(iso) {
  const d = new Date(iso)
  return `${MON_LONG[d.getMonth()]} ${d.getFullYear()}`
}

// „gerade eben“, „vor 5 Minuten“, „gestern“, „vor 3 Tagen“, sonst Datum
export function fmtRelative(iso) {
  if (!iso) return ''
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (diffMin < 1) return 'gerade eben'
  if (diffMin < 60) return diffMin === 1 ? 'vor 1 Minute' : `vor ${diffMin} Minuten`
  const days = dayDiff(ymd(new Date(iso)), todayStr())
  if (days === 0) {
    const h = Math.round(diffMin / 60)
    return h === 1 ? 'vor 1 Stunde' : `vor ${h} Stunden`
  }
  if (days === 1) return 'gestern'
  if (days < 7) return `vor ${days} Tagen`
  return fmtDate(iso)
}

// „seit heute“, „seit gestern“, „seit 3 Tagen“, „seit 2 Wochen“
export function sinceLabel(iso) {
  if (!iso) return ''
  const days = dayDiff(ymd(new Date(iso)), todayStr())
  if (days <= 0) return 'seit heute'
  if (days === 1) return 'seit gestern'
  if (days < 14) return `seit ${days} Tagen`
  if (days < 60) return `seit ${Math.floor(days / 7)} Wochen`
  return `seit ${Math.floor(days / 30)} Monaten`
}

// Fälligkeit als kleine Marke: Text und Ton (overdue, today, soon, later)
export function dueInfo(due) {
  if (!due) return null
  const diff = dayDiff(todayStr(), due)
  if (diff < 0) {
    const n = -diff
    return { text: n === 1 ? 'seit gestern fällig' : `seit ${n} Tagen fällig`, tone: 'overdue' }
  }
  if (diff === 0) return { text: 'heute fällig', tone: 'today' }
  if (diff === 1) return { text: 'morgen', tone: 'soon' }
  if (diff < 7) return { text: WD_LONG[parseYmd(due).getDay()], tone: 'soon' }
  return { text: fmtDate(due).replace(/^\S+ /, ''), tone: 'later' }
}

// Für die Suche: klein, ohne Akzente, Umlaute bleiben vergleichbar
export function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
}

export function matches(query, ...fields) {
  const q = norm(query)
  if (!q) return true
  const hay = norm(fields.flat().filter(Boolean).join(' '))
  return q.split(/\s+/).every((part) => hay.includes(part))
}

export function initials(name) {
  const parts = String(name || '?')
    .replace(/^(Dr\.|Prof\.)\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function firstName(name) {
  return String(name || '').replace(/^(Dr\.|Prof\.)\s+/i, '').split(/\s+/)[0] || ''
}

// Text in Teile zerlegen: normale Strings und Links
const URL_RE = /(https?:\/\/[^\s<>"]+|www\.[^\s<>"]+)/g
export function splitLinks(text) {
  const s = String(text || '')
  const parts = []
  let last = 0
  s.replace(URL_RE, (m, _g, offset) => {
    if (offset > last) parts.push(s.slice(last, offset))
    // Satzzeichen am Ende gehören nicht zum Link
    const trail = m.match(/[.,!?)]+$/)
    const url = trail ? m.slice(0, -trail[0].length) : m
    parts.push({ href: url.startsWith('http') ? url : `https://${url}`, text: url })
    if (trail) parts.push(trail[0])
    last = offset + m.length
    return m
  })
  if (last < s.length) parts.push(s.slice(last))
  return parts
}

export function telHref(phone) {
  return 'tel:' + String(phone).replace(/[^\d+]/g, '')
}

// WhatsApp braucht die Nummer international ohne Plus (deutsche 0 wird 49)
export function waHref(phone) {
  let p = String(phone).replace(/[^\d+]/g, '')
  if (p.startsWith('+')) p = p.slice(1)
  else if (p.startsWith('00')) p = p.slice(2)
  else if (p.startsWith('0')) p = '49' + p.slice(1)
  return `https://wa.me/${p}`
}

export function webHref(url) {
  if (!url) return ''
  return /^https?:\/\//i.test(url) ? url : `https://${url}`
}

export function webLabel(url) {
  return String(url || '').replace(/^https?:\/\//i, '').replace(/\/$/, '')
}

export function mapsHref(address) {
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(address)}`
}

export function byText(key) {
  return (a, b) => String(a[key] || '').localeCompare(String(b[key] || ''), 'de')
}

export function byDesc(key) {
  return (a, b) => String(b[key] || '').localeCompare(String(a[key] || ''))
}

// Speichern im Browser, ohne Fehler, wenn der Speicher gesperrt ist
export const local = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key)
      return v === null ? fallback : JSON.parse(v)
    } catch {
      return fallback
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // Speicher nicht verfügbar, dann eben ohne
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key)
    } catch {
      // nichts zu tun
    }
  },
}

// ------------------------------------------------------------
// Kalender
// ------------------------------------------------------------
export const WEEKDAYS_SHORT = WD
export const WEEKDAYS_LONG = WD_LONG
export const MONTHS_LONG = MON_LONG

// Montag der Woche, in der d liegt (Ortszeit, 00:00)
export function startOfWeek(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  const dow = (x.getDay() + 6) % 7
  x.setDate(x.getDate() - dow)
  return x
}

export function addDaysDate(d, n) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

// Kalenderwoche nach ISO 8601
export function isoWeek(d) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = x.getUTCDay() || 7
  x.setUTCDate(x.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(x.getUTCFullYear(), 0, 1))
  return Math.ceil(((x - yearStart) / 86400000 + 1) / 7)
}

export function sameDay(a, b) {
  return ymd(new Date(a)) === ymd(new Date(b))
}

// „10:00 bis 11:00“, ganztägig „ganztägig“
export function fmtTimeRange(start, end, allDay) {
  if (allDay) return 'ganztägig'
  if (!end) return fmtTime(start)
  return `${fmtTime(start)} bis ${fmtTime(end)}`
}

// Text aus HTML gewinnen, ohne etwas davon auszuführen (DOMParser führt keine Skripte aus)
export function htmlToText(html) {
  const s = String(html || '')
  if (!/<[a-z][\s\S]*>/i.test(s)) return s
  const withBreaks = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n')
  const doc = new DOMParser().parseFromString(withBreaks, 'text/html')
  return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim()
}

// Mailtext in neuen Teil und zitierten Verlauf trennen
export function splitQuoted(body) {
  const lines = String(body || '').split('\n')
  const markers = [
    /^>/,
    /^(Am|On) .{4,120}(schrieb|wrote).{0,60}:\s*$/,
    /^-{2,}\s*(Original|Ursprüngliche)/i,
    /^(Von|From):\s.+/,
  ]
  const idx = lines.findIndex((l) => markers.some((re) => re.test(l.trim())))
  if (idx <= 0) return { main: String(body || '').trim(), quoted: '' }
  return { main: lines.slice(0, idx).join('\n').trim(), quoted: lines.slice(idx).join('\n').trim() }
}

const pad2 = (n) => String(n).padStart(2, '0')
function gcalStamp(d) {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}T${pad2(d.getHours())}${pad2(d.getMinutes())}00`
}

// Google Kalender mit vorausgefülltem Termin im gewählten Konto öffnen
export function googleCalendarUrl({ title, start, end, guests, location, description, meet, account }) {
  const p = new URLSearchParams()
  p.set('action', 'TEMPLATE')
  p.set('text', title || '')
  p.set('dates', `${gcalStamp(start)}/${gcalStamp(end)}`)
  p.set('ctz', 'Europe/Berlin')
  if (description) p.set('details', description)
  if (location) p.set('location', location)
  if (guests && guests.length) p.set('add', guests.join(','))
  if (meet) p.set('vcon', 'meet')
  if (account) p.set('authuser', account)
  return 'https://calendar.google.com/calendar/render?' + p.toString()
}

// Mail im richtigen Gmail-Konto öffnen
export function gmailUrl(mailbox, providerId) {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(mailbox || '')}#all/${encodeURIComponent(providerId || '')}`
}
