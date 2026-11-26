// Verlauf einer Aufgabe in ganzen Sätzen, neueste oben (Daten aus card_events)
import { html, useState, useEffect } from '../lib/preact.js'
import { Icon } from '../lib/icons.js'
import { fmtDate, fmtRelative, firstName, norm } from '../lib/util.js'
import { fetchCardEvents, memberName, myEmail, state } from '../store.js'
import { Avatar } from './common.js'
import { t, isEnglish, stageLabel, locale } from '../i18n.js'

const PRIO = { hoch: 'Hoch', mittel: 'Mittel', niedrig: 'Niedrig' }

// Aktivitäten im Verlauf (19_aktivitaeten.sql): detail ist „art|datum|text“ bzw. „art|text“.
// Artikel je Art für ganze Sätze (Englisch über t()).
const ACT = {
  wiedervorlage: ['eine Wiedervorlage', 'die Wiedervorlage'],
  anruf: ['einen Anruf', 'den Anruf'],
  mail: ['eine Mail', 'die Mail'],
  termin: ['einen Termin', 'den Termin'],
  aufgabe: ['ein To-do', 'das To-do'],
}
// Text in Anführungszeichen der jeweiligen Sprache
const quote = (x) => (isEnglish() ? `“${x}”` : `„${x}“`)
function actParts(kind, detail) {
  const parts = String(detail || '').split('|')
  const art = ACT[parts[0]] ? parts[0] : 'wiedervorlage'
  const withDate = kind !== 'aktivitaet_erledigt'
  const date = withDate ? parts[1] : null
  const text = (withDate ? parts.slice(2) : parts.slice(1)).join('|')
  return { a: t(ACT[art][0]), the: t(ACT[art][1]), date: date ? fmtDate(date) : '', text: text ? ' ' + quote(text) : '' }
}
// Satz in zwei Fassungen: eigener Eintrag („Du hast …“) und der anderer („{who} hat …“)
const say = (self, mine, other, vars) => t(self ? mine : other, vars)
function activitySentence(kind, detail, who, self) {
  const x = actParts(kind, detail)
  const v = { who, a: x.a, the: x.the, text: x.text, date: x.date }
  if (kind === 'aktivitaet') return say(self, 'Du hast {a}{text} für {date} geplant', '{who} hat {a}{text} für {date} geplant', v)
  if (kind === 'aktivitaet_erledigt') return say(self, 'Du hast {the}{text} erledigt', '{who} hat {the}{text} erledigt', v)
  return say(self, 'Du hast {the}{text} auf {date} verschoben', '{who} hat {the}{text} auf {date} verschoben', v)
}

// Ein Eintrag als Satz. Eigene Einträge mit „Du“.
export function eventSentence(e, me = myEmail()) {
  const self = !!e.actor && norm(e.actor) === norm(me)
  const who = firstName(memberName(e.actor)) || e.actor
  const d = e.detail || ''
  const person = (address) => (norm(address) === norm(me) ? t('dich') : firstName(memberName(address)) || address)
  const v = { who, d, q: quote(d) }
  // Ohne Person (Skript, Import, nächtliches Archivieren aus 24_archiv.sql) ohne Subjekt formulieren,
  // zum Beispiel „Automatisch archiviert“
  if (!e.actor) {
    if (e.kind === 'aktivitaet') {
      const x = actParts(e.kind, d)
      return t('Automatisch {a}{text} für {date} geplant', { a: x.a, text: x.text, date: x.date })
    }
    if (e.kind === 'angelegt') return t('Automatisch angelegt')
    if (e.kind === 'spalte') return t('Automatisch nach {q} verschoben', { q: quote(stageLabel(d)) })
    if (e.kind === 'projekt') return t('Automatisch in die Pipeline {d} verschoben', v)
    if (e.kind === 'archiv') return d === 'archiviert' ? t('Automatisch archiviert') : t('Automatisch aus dem Archiv geholt')
    return t('Automatisch geändert')
  }
  switch (e.kind) {
    case 'angelegt':
      return say(self, 'Du hast ihn angelegt', '{who} hat ihn angelegt', v)
    case 'spalte':
      return say(self, 'Du hast ihn nach {q} verschoben', '{who} hat ihn nach {q} verschoben', { ...v, q: quote(stageLabel(d)) })
    case 'projekt':
      return say(self, 'Du hast ihn in die Pipeline {d} verschoben', '{who} hat ihn in die Pipeline {d} verschoben', v)
    case 'dringlichkeit':
      return d
        ? say(self, 'Du hast die Dringlichkeit auf {p} gesetzt', '{who} hat die Dringlichkeit auf {p} gesetzt', { ...v, p: t(PRIO[d] || d) })
        : say(self, 'Du hast die Dringlichkeit entfernt', '{who} hat die Dringlichkeit entfernt', v)
    case 'faelligkeit':
      return d
        ? say(self, 'Du hast die Fälligkeit auf {date} gesetzt', '{who} hat die Fälligkeit auf {date} gesetzt', { ...v, date: fmtDate(d) })
        : say(self, 'Du hast die Fälligkeit entfernt', '{who} hat die Fälligkeit entfernt', v)
    case 'zustaendig':
      if (!d) return say(self, 'Du hast die Zuständigkeit entfernt', '{who} hat die Zuständigkeit entfernt', v)
      if (self && norm(d) === norm(me)) return t('Du hast dich zuständig gemacht')
      return say(self, 'Du hast {person} zuständig gemacht', '{who} hat {person} zuständig gemacht', { ...v, person: person(d) })
    case 'titel':
      return say(self, 'Du hast den Titel geändert', '{who} hat den Titel geändert', v)
    case 'archiv':
      return d === 'archiviert'
        ? say(self, 'Du hast ihn archiviert', '{who} hat ihn archiviert', v)
        : say(self, 'Du hast ihn aus dem Archiv geholt', '{who} hat ihn aus dem Archiv geholt', v)
    case 'notiz':
      return say(self, 'Du hast eine Notiz geschrieben', '{who} hat eine Notiz geschrieben', v)
    case 'erwaehnung':
      return say(self, 'Du hast {person} erwähnt', '{who} hat {person} erwähnt', { ...v, person: person(d) })
    case 'datei':
      return say(self, 'Du hast {q} hochgeladen', '{who} hat {q} hochgeladen', v)
    case 'aktivitaet':
    case 'aktivitaet_erledigt':
    case 'aktivitaet_verschoben':
      return activitySentence(e.kind, d, who, self)
    // Meine Pipeline (36_meine_pipeline.sql)
    case 'mitzustaendig_dazu':
      if (self && norm(d) === norm(me)) return t('Du hast dich als weitere zuständige Person eingetragen')
      return say(self, 'Du hast {person} als weitere zuständige Person eingetragen', '{who} hat {person} als weitere zuständige Person eingetragen', { ...v, person: person(d) })
    case 'mitzustaendig_weg':
      return say(self, 'Du hast {person} als weitere zuständige Person ausgetragen', '{who} hat {person} als weitere zuständige Person ausgetragen', { ...v, person: person(d) })
    case 'unteraufgabe':
      return say(self, 'Du hast {q} zur Checkliste hinzugefügt', '{who} hat {q} zur Checkliste hinzugefügt', v)
    case 'unteraufgabe_erledigt':
      return say(self, 'Du hast {q} auf der Checkliste abgehakt', '{who} hat {q} auf der Checkliste abgehakt', v)
    case 'unteraufgabe_geloescht':
      return say(self, 'Du hast {q} von der Checkliste gelöscht', '{who} hat {q} von der Checkliste gelöscht', v)
    default:
      return say(self, 'Du hast etwas geändert', '{who} hat etwas geändert', v)
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
    const timer = setTimeout(async () => {
      const list = await fetchCardEvents(card.id)
      if (!stale) setEvents(list)
    }, 300)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [open, card.id, card.updated_at, state.historyTick])

  return html`<section class="history">
    <button type="button" class="history-toggle" aria-expanded=${open} onClick=${() => setOpen(!open)}>
      ${/* „Verlauf“ heißt im Chat „Thread“ (en-comm.js), hier „History“, deshalb ohne Wörterbuch */ ''}
      <${Icon} name="chevron" size=${16} /> ${isEnglish() ? 'History' : 'Verlauf'}
    </button>
    ${open &&
    (events === null
      ? html`<p class="muted small">${t('Wird geladen …')}</p>`
      : events.length === 0
        ? html`<p class="muted small">${t('Noch keine Einträge.')}</p>`
        : html`<ul class="history-list">
            ${events.map(
              (e) => html`<li key=${e.id}>
                ${e.actor ? html`<${Avatar} email=${e.actor} />` : html`<span class="avatar avatar-sm avatar-auto" aria-hidden="true"></span>`}
                <span class="history-text">${eventSentence(e)}${e.via === 'claude' && html` <span class="via-claude">${t('über Claude')}</span>`}</span>
                <span class="muted small" title=${new Date(e.at).toLocaleString(locale())}>${fmtRelative(e.at)}</span>
              </li>`
            )}
          </ul>`)}
  </section>`
}
