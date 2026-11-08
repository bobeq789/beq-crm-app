// Verlauf einer Aufgabe in ganzen Sätzen, neueste oben (Daten aus card_events)
import { html, useState, useEffect } from '../lib/preact.js'
import { Icon } from '../lib/icons.js'
import { fmtDate, fmtRelative, firstName, norm } from '../lib/util.js'
import { fetchCardEvents, memberName, myEmail, state } from '../store.js'

const PRIO = { hoch: 'Hoch', mittel: 'Mittel', niedrig: 'Niedrig' }

// Aktivitäten im Verlauf (19_aktivitaeten.sql): detail ist „art|datum|text“ bzw. „art|text“.
// Artikel je Art für ganze Sätze.
const ACT = {
  wiedervorlage: ['eine Wiedervorlage', 'die Wiedervorlage'],
  anruf: ['einen Anruf', 'den Anruf'],
  mail: ['eine Mail', 'die Mail'],
  termin: ['einen Termin', 'den Termin'],
  aufgabe: ['eine Aufgabe', 'die Aufgabe'],
}
function actParts(kind, detail) {
  const parts = String(detail || '').split('|')
  const art = ACT[parts[0]] ? parts[0] : 'wiedervorlage'
  const withDate = kind !== 'aktivitaet_erledigt'
  const date = withDate ? parts[1] : null
  const text = (withDate ? parts.slice(2) : parts.slice(1)).join('|')
  return { a: ACT[art][0], the: ACT[art][1], date: date ? fmtDate(date) : '', text: text ? ` „${text}“` : '' }
}
function activitySentence(kind, detail, who, hat) {
  const x = actParts(kind, detail)
  if (kind === 'aktivitaet') return `${who} ${hat} ${x.a}${x.text} für ${x.date} geplant`
  if (kind === 'aktivitaet_erledigt') return `${who} ${hat} ${x.the}${x.text} erledigt`
  return `${who} ${hat} ${x.the}${x.text} auf ${x.date} verschoben`
}

// Ein Eintrag als Satz. Eigene Einträge mit „Du“.
export function eventSentence(e, me = myEmail()) {
  const self = e.actor && norm(e.actor) === norm(me)
  const who = !e.actor ? 'Automatisch' : self ? 'Du' : firstName(memberName(e.actor)) || e.actor
  const hat = self ? 'hast' : 'hat'
  const d = e.detail || ''
  const person = (address) => (norm(address) === norm(me) ? 'dich' : firstName(memberName(address)) || address)
  // Ohne Person (Skript, Import) ohne Subjekt formulieren
  if (!e.actor) {
    if (e.kind === 'aktivitaet') {
      const x = actParts(e.kind, d)
      return `${who} ${x.a}${x.text} für ${x.date} geplant`
    }
    const passive = {
      angelegt: 'angelegt',
      spalte: `nach „${d}“ verschoben`,
      projekt: `ins Projekt ${d} verschoben`,
      archiv: d === 'archiviert' ? 'archiviert' : 'aus dem Archiv geholt',
    }
    return `${who} ${passive[e.kind] || 'geändert'}`
  }
  switch (e.kind) {
    case 'angelegt':
      return `${who} ${hat} sie angelegt`
    case 'spalte':
      return `${who} ${hat} sie nach „${d}“ verschoben`
    case 'projekt':
      return `${who} ${hat} sie ins Projekt ${d} verschoben`
    case 'dringlichkeit':
      return d ? `${who} ${hat} die Dringlichkeit auf ${PRIO[d] || d} gesetzt` : `${who} ${hat} die Dringlichkeit entfernt`
    case 'faelligkeit':
      return d ? `${who} ${hat} die Fälligkeit auf ${fmtDate(d)} gesetzt` : `${who} ${hat} die Fälligkeit entfernt`
    case 'zustaendig':
      if (!d) return `${who} ${hat} die Zuständigkeit entfernt`
      if (self && norm(d) === norm(me)) return `Du hast dich zuständig gemacht`
      return `${who} ${hat} ${person(d)} zuständig gemacht`
    case 'titel':
      return `${who} ${hat} den Titel geändert`
    case 'archiv':
      return d === 'archiviert' ? `${who} ${hat} sie archiviert` : `${who} ${hat} sie aus dem Archiv geholt`
    case 'notiz':
      return `${who} ${hat} eine Notiz geschrieben`
    case 'erwaehnung':
      return `${who} ${hat} ${person(d)} erwähnt`
    case 'datei':
      return `${who} ${hat} „${d}“ hochgeladen`
    case 'aktivitaet':
    case 'aktivitaet_erledigt':
    case 'aktivitaet_verschoben':
      return activitySentence(e.kind, d, who, hat)
    default:
      return `${who} ${hat} etwas geändert`
  }
}

// Einklappbarer Bereich „Verlauf“. Lädt neu, wenn sich die Karte ändert.
export function History({ card }) {
  const [open, setOpen] = useState(false)
  const [events, setEvents] = useState(null)
  useEffect(() => {
    if (!open) return
    let stale = false
    // Kurz warten, damit eigene Änderungen schon in der Datenbank stehen
    const t = setTimeout(async () => {
      const list = await fetchCardEvents(card.id)
      if (!stale) setEvents(list)
    }, 300)
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [open, card.id, card.updated_at, state.historyTick])

  return html`<section class="history">
    <button type="button" class="history-toggle" aria-expanded=${open} onClick=${() => setOpen(!open)}>
      <${Icon} name="chevron" size=${16} /> Verlauf
    </button>
    ${open &&
    (events === null
      ? html`<p class="muted small">Wird geladen …</p>`
      : events.length === 0
        ? html`<p class="muted small">Noch keine Einträge.</p>`
        : html`<ul class="history-list">
            ${events.map(
              (e) => html`<li key=${e.id}>
                <span class="history-text">${eventSentence(e)}</span>
                <span class="muted small" title=${new Date(e.at).toLocaleString('de-DE')}>${fmtRelative(e.at)}</span>
              </li>`
            )}
          </ul>`)}
  </section>`
}
