// Kalender: Woche als Raster (am Rechner Montag bis Sonntag, auf dem Handy drei Tage), Liste nach Tagen,
// Termin-Details und „Neuer Termin“. Das CRM liest die Kalender nur. Neue Termine entstehen in Google Kalender.
import { html, useState, useEffect, useRef } from '../lib/preact.js'
import { Icon } from '../lib/icons.js'
import {
  local,
  ymd,
  fmtDate,
  fmtDateLong,
  fmtTime,
  fmtTimeRange,
  startOfWeek,
  addDaysDate,
  isoWeek,
  sameDay,
  htmlToText,
  googleCalendarUrl,
  mapsHref,
  MONTHS_LONG,
  WEEKDAYS_SHORT,
  firstName,
  norm,
} from '../lib/util.js'
import {
  state,
  calendars,
  getEvent,
  member,
  memberName,
  personByEmail,
  meetingForEvent,
  insert,
  myEmail,
  activeMembers,
  openDialog,
  closeDialog,
  promptDialog,
  toast,
} from '../store.js'
import { closeEvent, openEvent, navigate } from '../router.js'
import { PageHead, Empty, Dot, Field, Modal, LinkText, Segmented, useIsMobile, dialogKinds, brandSafe } from './common.js'

const HOUR_PX = 48
const VIEW_KEY = 'beqcrm-cal-view'
const HIDDEN_KEY = 'beqcrm-cal-hidden'

// Schriftfarbe passend zur Kalenderfarbe (alle Farben aus der Palette)
function textOn(color) {
  const c = String(color || '').replace('#', '')
  if (c.length !== 6) return '#0D1822'
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return lum > 0.45 ? '#0D1822' : '#FFFFFF'
}

const visibleEvents = (hidden) => state.db.events.filter((e) => e.status !== 'cancelled' && !hidden.has(e.calendar_id))

// Termine, die an einem Tag liegen (auch mehrtägige und ganztägige)
function eventsOnDay(list, day) {
  const start = new Date(day)
  start.setHours(0, 0, 0, 0)
  const end = addDaysDate(start, 1)
  return list.filter((e) => {
    const s = new Date(e.start_at)
    const en = e.end_at ? new Date(e.end_at) : new Date(s.getTime() + 30 * 60000)
    return s < end && en > start
  })
}

// Überlappende Termine nebeneinander anordnen
function layoutDay(events) {
  const sorted = [...events].sort((a, b) => a.start_at.localeCompare(b.start_at))
  const placed = []
  let cluster = []
  let clusterEnd = 0
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((p) => p.col + 1))
    cluster.forEach((p) => (p.cols = cols))
    cluster = []
  }
  sorted.forEach((ev) => {
    const s = new Date(ev.start_at).getTime()
    const e = ev.end_at ? new Date(ev.end_at).getTime() : s + 30 * 60000
    if (cluster.length && s >= clusterEnd) flush()
    const used = new Set(cluster.filter((p) => p.end > s).map((p) => p.col))
    let col = 0
    while (used.has(col)) col++
    const item = { ev, start: s, end: e, col, cols: 1 }
    cluster.push(item)
    placed.push(item)
    clusterEnd = Math.max(clusterEnd, e)
  })
  flush()
  return placed
}

function EventChip({ ev, compact }) {
  const color = ev.calendar_color || '#37BA98'
  return html`<button
    type="button"
    class=${'event-chip' + (compact ? ' compact' : '')}
    style=${{ background: color, color: textOn(color) }}
    onClick=${(e) => {
      e.stopPropagation()
      openEvent(ev.id)
    }}
  >
    <span class="event-title">${ev.title || '(ohne Titel)'}</span>
    ${!compact && !ev.all_day && html`<span class="event-time">${fmtTimeRange(ev.start_at, ev.end_at, false)}</span>`}
  </button>`
}

// ------------------------------------------------------------
// Wochenraster
// ------------------------------------------------------------
function WeekGrid({ days, events }) {
  const scrollRef = useRef()
  const now = new Date()
  useEffect(() => {
    // Beim Öffnen auf 7 Uhr springen, mit etwas Luft, damit die Stundenzahl ganz zu sehen ist
    if (scrollRef.current) scrollRef.current.scrollTop = 7 * HOUR_PX - 12
  }, [])
  const timed = events.filter((e) => !e.all_day)
  const allDay = events.filter((e) => e.all_day)
  const hours = Array.from({ length: 24 }, (_, i) => i)

  // Klick in eine freie Stelle: neuer Termin zu dieser Zeit (auf halbe Stunden gerundet)
  const clickSlot = (day, e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const minutes = Math.max(0, Math.min(23.5 * 60, Math.floor((e.clientY - rect.top) / (HOUR_PX / 2)) * 30))
    const start = new Date(day)
    start.setHours(0, minutes, 0, 0)
    openDialog({ kind: 'new-event', start: start.toISOString() })
  }

  return html`<div class="week" style=${{ '--days': days.length }}>
    <div class="week-head">
      <div class="week-gutter"></div>
      ${days.map(
        (d) => html`<div class=${'week-day-head' + (sameDay(d, now) ? ' today' : '')}>
          <span class="wd">${WEEKDAYS_SHORT[d.getDay()]}</span>
          <span class="dn">${d.getDate()}.</span>
        </div>`
      )}
    </div>
    ${allDay.length > 0 &&
    html`<div class="week-allday">
      <div class="week-gutter small muted">ganztägig</div>
      ${days.map((d) => html`<div class="allday-cell">${eventsOnDay(allDay, d).map((ev) => html`<${EventChip} ev=${ev} compact=${true} key=${ev.id} />`)}</div>`)}
    </div>`}
    <div class="week-body" ref=${scrollRef}>
      <div class="week-grid" style=${{ height: 24 * HOUR_PX + 'px' }}>
        <div class="week-gutter hours">
          ${hours.map((h) => html`<div class="hour-label" style=${{ top: h * HOUR_PX + 'px' }}>${h > 0 ? String(h).padStart(2, '0') + ':00' : ''}</div>`)}
        </div>
        ${days.map((d) => {
          const placed = layoutDay(eventsOnDay(timed, d))
          const dayStart = new Date(d)
          dayStart.setHours(0, 0, 0, 0)
          return html`<div class="day-col" onClick=${(e) => clickSlot(d, e)}>
            ${hours.map((h) => html`<div class="hour-line" style=${{ top: h * HOUR_PX + 'px' }}></div>`)}
            ${placed.map((p) => {
              const top = Math.max(0, (p.start - dayStart.getTime()) / 60000) * (HOUR_PX / 60)
              const bottom = Math.min(24 * 60, (p.end - dayStart.getTime()) / 60000) * (HOUR_PX / 60)
              const height = Math.max(HOUR_PX / 2.4, bottom - top - 2)
              return html`<div
                class="event-slot"
                key=${p.ev.id}
                style=${{ top: top + 'px', height: height + 'px', left: (p.col / p.cols) * 100 + '%', width: 100 / p.cols + '%' }}
              >
                <${EventChip} ev=${p.ev} compact=${height < HOUR_PX * 0.9} />
              </div>`
            })}
            ${sameDay(d, now) &&
            html`<div class="now-line" style=${{ top: (now.getHours() * 60 + now.getMinutes()) * (HOUR_PX / 60) + 'px' }}></div>`}
          </div>`
        })}
      </div>
    </div>
  </div>`
}

// ------------------------------------------------------------
// Liste nach Tagen
// ------------------------------------------------------------
function EventList({ events, past }) {
  const now = new Date()
  const from = past ? addDaysDate(now, -30) : new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const to = past ? now : addDaysDate(now, 120)
  const list = events
    .filter((e) => {
      const s = new Date(e.start_at)
      const en = e.end_at ? new Date(e.end_at) : s
      return en >= from && s <= to
    })
    .sort((a, b) => (past ? b.start_at.localeCompare(a.start_at) : a.start_at.localeCompare(b.start_at)))
  if (!list.length) return html`<${Empty}>${past ? 'In den letzten 30 Tagen gab es keine Termine.' : 'Keine anstehenden Termine.'}<//>`
  const groups = []
  list.forEach((e) => {
    const key = ymd(new Date(e.start_at))
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.items.push(e)
    else groups.push({ key, items: [e] })
  })
  return html`<div class="event-list">
    ${groups.map(
      (g) => html`<section key=${g.key}>
        <h2 class="group-title">${g.key === ymd(now) ? 'Heute, ' : ''}${fmtDateLong(new Date(g.items[0].start_at))}</h2>
        <ul class="row-list">
          ${g.items.map(
            (e) => html`<li key=${e.id}>
              <button type="button" class="row-link" onClick=${() => openEvent(e.id)}>
                <span class="row-time">${e.all_day ? 'ganztägig' : fmtTime(e.start_at)}</span>
                <span class="row-main">
                  <span class="row-title">${e.title || '(ohne Titel)'}</span>
                  <span class="row-meta">
                    <span class="meta-item"><${Dot} color=${e.calendar_color} />${e.calendar_name}</span>
                    ${!e.all_day && html`<span>${fmtTimeRange(e.start_at, e.end_at, false)}</span>`}
                    ${e.location && html`<span class="muted">${e.location}</span>`}
                  </span>
                </span>
                <${Icon} name="chevron" size=${18} cls="row-chevron" />
              </button>
            </li>`
          )}
        </ul>
      </section>`
    )}
  </div>`
}

// ------------------------------------------------------------
// Kleiner Monatskalender zum Springen
// ------------------------------------------------------------
function MiniMonth({ anchor, onPick, events }) {
  const [month, setMonth] = useState(new Date(anchor.getFullYear(), anchor.getMonth(), 1))
  useEffect(() => setMonth(new Date(anchor.getFullYear(), anchor.getMonth(), 1)), [anchor.getFullYear(), anchor.getMonth()])
  const first = startOfWeek(month)
  const days = Array.from({ length: 42 }, (_, i) => addDaysDate(first, i))
  const withEvents = new Set(events.map((e) => ymd(new Date(e.start_at))))
  const weekStart = startOfWeek(anchor)
  const inWeek = (d) => d >= weekStart && d < addDaysDate(weekStart, 7)
  return html`<div class="mini-month">
    <div class="mini-head">
      <button type="button" class="icon-btn small" aria-label="Vorheriger Monat" onClick=${() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
        <${Icon} name="chevronLeft" size=${16} />
      </button>
      <span>${MONTHS_LONG[month.getMonth()]} ${month.getFullYear()}</span>
      <button type="button" class="icon-btn small" aria-label="Nächster Monat" onClick=${() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
        <${Icon} name="chevron" size=${16} />
      </button>
    </div>
    <div class="mini-grid">
      ${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((w) => html`<span class="mini-wd">${w}</span>`)}
      ${days.map(
        (d) => html`<button
          type="button"
          class=${[
            'mini-day',
            d.getMonth() !== month.getMonth() ? 'other' : '',
            sameDay(d, new Date()) ? 'today' : '',
            inWeek(d) ? 'in-week' : '',
            withEvents.has(ymd(d)) ? 'has-events' : '',
          ].join(' ')}
          aria-label=${fmtDate(ymd(d))}
          onClick=${() => onPick(d)}
        >
          ${d.getDate()}
        </button>`
      )}
    </div>
  </div>`
}

// ------------------------------------------------------------
// Seite
// ------------------------------------------------------------
export function CalendarPage() {
  const mobile = useIsMobile()
  const [view, setView] = useState(local.get(VIEW_KEY, 'woche'))
  const [hidden, setHidden] = useState(() => new Set(local.get(HIDDEN_KEY, [])))
  const [anchor, setAnchor] = useState(() => new Date())
  const [past, setPast] = useState(false)
  const cals = calendars()
  const events = visibleEvents(hidden)

  const changeView = (v) => {
    setView(v)
    local.set(VIEW_KEY, v)
  }
  const toggleCal = (id) => {
    const next = new Set(hidden)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setHidden(next)
    local.set(HIDDEN_KEY, [...next])
  }

  const days = mobile
    ? [0, 1, 2].map((i) => addDaysDate(new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate()), i))
    : Array.from({ length: 7 }, (_, i) => addDaysDate(startOfWeek(anchor), i))
  const step = mobile ? 3 : 7
  const title =
    view === 'liste'
      ? past
        ? 'Letzte 30 Tage'
        : 'Nächste Termine'
      : `KW ${isoWeek(days[0])} · ${days[0].getDate()}. bis ${fmtDate(ymd(days[days.length - 1])).replace(/^\S+ /, '')}`

  const newEvent = () => openDialog({ kind: 'new-event' })

  if (!state.db.events.length) {
    return html`<div class="page">
      <${PageHead}
        kicker="Kalender"
        title="Kalender"
        actions=${html`<button type="button" class="btn btn-primary" onClick=${newEvent}><${Icon} name="plus" size=${18} /> Neuer Termin</button>`}
      />
      <div class="tile empty-calendar">
        <${Icon} name="calendar" size=${32} />
        <p><strong>Noch kein Kalender angebunden.</strong></p>
        <p class="muted">Sobald der Abgleich mit Google Kalender läuft, erscheinen hier die Termine aus euren Kalendern. Neue Termine kannst du trotzdem schon anlegen, sie öffnen sich in Google Kalender.</p>
      </div>
    </div>`
  }

  return html`<div class="page page-calendar">
    <${PageHead}
      kicker="Kalender"
      title=${title}
      actions=${html`<${Segmented}
          label="Ansicht"
          value=${view}
          onChange=${changeView}
          options=${[
            { value: 'woche', label: 'Woche' },
            { value: 'liste', label: 'Liste' },
          ]}
        />
        <button type="button" class="btn btn-primary" onClick=${newEvent}><${Icon} name="plus" size=${18} /><span class="hide-sm">Neuer Termin</span></button>`}
    />
    <div class="calendar-layout">
      ${!mobile &&
      html`<aside class="calendar-side">
        <${MiniMonth} anchor=${anchor} events=${events} onPick=${(d) => {
          setAnchor(d)
          if (view === 'liste') changeView('woche')
        }} />
        <h3 class="side-title">Kalender</h3>
        <ul class="cal-toggles">
          ${cals.map(
            (c) => html`<li>
              <button type="button" class=${'cal-toggle' + (hidden.has(c.id) ? ' off' : '')} aria-pressed=${!hidden.has(c.id)} onClick=${() => toggleCal(c.id)}>
                <${Dot} color=${c.color} /> ${c.name}
              </button>
            </li>`
          )}
        </ul>
      </aside>`}
      <div class="calendar-main">
        ${view === 'woche'
          ? html`<div class="calendar-toolbar">
                <button type="button" class="btn btn-small" onClick=${() => setAnchor(new Date())}>Heute</button>
                <button type="button" class="icon-btn" aria-label="Zurück" onClick=${() => setAnchor(addDaysDate(anchor, -step))}><${Icon} name="chevronLeft" /></button>
                <button type="button" class="icon-btn" aria-label="Weiter" onClick=${() => setAnchor(addDaysDate(anchor, step))}><${Icon} name="chevron" /></button>
                ${mobile &&
                html`<div class="cal-toggles-inline">
                  ${cals.map(
                    (c) => html`<button type="button" class=${'cal-toggle' + (hidden.has(c.id) ? ' off' : '')} aria-pressed=${!hidden.has(c.id)} onClick=${() => toggleCal(c.id)}>
                      <${Dot} color=${c.color} /> ${firstName(c.name)}
                    </button>`
                  )}
                </div>`}
              </div>
              <${WeekGrid} days=${days} events=${events} />`
          : html`<div class="calendar-toolbar">
                <${Segmented}
                  label="Zeitraum"
                  value=${past ? 'past' : 'next'}
                  onChange=${(v) => setPast(v === 'past')}
                  options=${[
                    { value: 'next', label: 'Ab heute' },
                    { value: 'past', label: 'Letzte 30 Tage' },
                  ]}
                />
              </div>
              <${EventList} events=${events} past=${past} />`}
      </div>
    </div>
  </div>`
}

// ------------------------------------------------------------
// Termin-Details (Fenster über der Seite, ?termin=…)
// ------------------------------------------------------------
export function EventPanel({ id }) {
  const ev = getEvent(id)
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !document.querySelector('.modal') && closeEvent()
    window.addEventListener('keydown', onKey)
    document.body.classList.add('panel-open')
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.classList.remove('panel-open')
    }
  }, [])

  if (!ev) {
    return html`<div class="backdrop" onClick=${closeEvent}>
      <aside class="panel" onClick=${(e) => e.stopPropagation()}>
        <div class="panel-head"><div class="kicker">Termin</div>
          <button type="button" class="icon-btn" aria-label="Schließen" onClick=${closeEvent}><${Icon} name="x" /></button></div>
        <p class="empty">Diesen Termin gibt es nicht mehr.</p>
      </aside>
    </div>`
  }

  const meeting = meetingForEvent(ev)
  const description = htmlToText(ev.description)
  const addContact = async (address) => {
    const guess = address.split('@')[0].split(/[._-]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    const name = await promptDialog({ title: 'Als Kontakt anlegen', label: 'Name', value: guess, confirmLabel: 'Anlegen' })
    if (!name) return
    const person = await insert('persons', { name, emails: [address] })
    if (!person) return
    await insert('event_persons', { event_id: ev.id, person_id: person.id })
    toast(`„${name}“ ist jetzt ein Kontakt`, { action: { label: 'Öffnen', run: () => navigate('/kontakte/' + person.id) } })
  }

  return html`<div class="backdrop" onClick=${closeEvent}>
    <aside class="panel" role="dialog" aria-modal="true" aria-label=${'Termin ' + (ev.title || '')} onClick=${(e) => e.stopPropagation()}>
      <div class="panel-head">
        <div class="kicker"><${Dot} color=${ev.calendar_color} />Termin · ${brandSafe(ev.calendar_name)}</div>
        <button type="button" class="icon-btn" aria-label="Schließen" onClick=${closeEvent}><${Icon} name="x" /></button>
      </div>
      <div class="panel-body">
        <h2 class="panel-title">${ev.title || '(ohne Titel)'}</h2>
        <p class="event-when">
          <${Icon} name="clock" size=${18} />
          ${fmtDateLong(new Date(ev.start_at))}, ${fmtTimeRange(ev.start_at, ev.end_at, ev.all_day)}
        </p>
        ${ev.location &&
        html`<p class="event-where">
          <${Icon} name="pin" size=${18} />
          ${/^https?:\/\//.test(ev.location)
            ? html`<a href=${ev.location} target="_blank" rel="noopener noreferrer">${ev.location}</a>`
            : html`<a href=${mapsHref(ev.location)} target="_blank" rel="noopener noreferrer">${ev.location}</a>`}
        </p>`}
        <div class="quick-actions">
          ${ev.meet_url &&
          html`<a class="btn btn-primary" href=${ev.meet_url} target="_blank" rel="noopener noreferrer"><${Icon} name="video" size=${18} /> Beitreten</a>`}
          ${meeting && html`<a class="btn" href=${'#/meetings/' + meeting.id}><${Icon} name="meetings" size=${18} /> Zusammenfassung</a>`}
          ${ev.html_link &&
          html`<a class="btn" href=${ev.html_link} target="_blank" rel="noopener noreferrer"><${Icon} name="external" size=${18} /> In Google Kalender</a>`}
        </div>

        <h3 class="section-title">Teilnehmer</h3>
        ${(ev.attendees || []).length
          ? html`<div class="chips">
              ${ev.attendees.map((address) => {
                if (member(address)) return html`<span class="chip chip-team">${memberName(address)}</span>`
                const p = personByEmail(address)
                if (p) return html`<a class="chip chip-link" href=${'#/kontakte/' + p.id}>${p.name}</a>`
                return html`<span class="chip chip-free">${address}
                  <button type="button" class="chip-add" title="Als Kontakt anlegen" onClick=${() => addContact(address)}><${Icon} name="plus" size=${14} /> Kontakt</button>
                </span>`
              })}
            </div>`
          : html`<${Empty}>Keine Teilnehmer eingetragen.<//>`}

        ${description &&
        html`<h3 class="section-title">Beschreibung</h3>
          <div class="prose"><${LinkText} text=${description} /></div>`}
      </div>
    </aside>
  </div>`
}

// ------------------------------------------------------------
// Neuer Termin: öffnet Google Kalender im gewählten Konto, alles ausgefüllt
// ------------------------------------------------------------
function toTimeInput(d) {
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

function NewEventDialog({ d }) {
  const startDefault = d.start ? new Date(d.start) : (() => {
    const x = new Date()
    x.setMinutes(x.getMinutes() < 30 ? 30 : 60, 0, 0)
    return x
  })()
  const endDefault = new Date(startDefault.getTime() + 60 * 60000)
  const accounts = [...new Set([myEmail(), ...activeMembers().map((m) => m.email)].filter(Boolean))]
  const [form, setForm] = useState({
    title: '',
    date: ymd(startDefault),
    from: toTimeInput(startDefault),
    to: toTimeInput(endDefault),
    guests: d.guests || [],
    location: '',
    description: '',
    meet: true,
    account: myEmail(),
  })
  const [guestText, setGuestText] = useState('')
  const set = (patch) => setForm({ ...form, ...patch })

  const suggestions = guestText.trim()
    ? state.db.persons
        .filter((p) => (p.emails || []).length && (norm(p.name).includes(norm(guestText)) || p.emails.some((m) => norm(m).includes(norm(guestText)))))
        .slice(0, 5)
    : []
  const addGuest = (address) => {
    const a = address.trim()
    if (a && /@/.test(a) && !form.guests.includes(a)) set({ guests: [...form.guests, a] })
    setGuestText('')
  }

  const open = (e) => {
    e.preventDefault()
    const start = new Date(`${form.date}T${form.from}`)
    let end = new Date(`${form.date}T${form.to}`)
    if (!(end > start)) end = new Date(start.getTime() + 60 * 60000)
    const url = googleCalendarUrl({ ...form, start, end })
    window.open(url, '_blank', 'noopener')
    closeDialog()
  }

  const guestLabel = (address) => {
    const p = personByEmail(address)
    return p ? p.name : member(address) ? memberName(address) : address
  }

  return html`<${Modal} title="Neuer Termin" onClose=${closeDialog} wide=${true}>
    <form onSubmit=${open}>
      <${Field} label="Titel" htmlFor="ev-title">
        <input id="ev-title" value=${form.title} required onInput=${(e) => set({ title: e.target.value })} />
      <//>
      <div class="field-grid three">
        <${Field} label="Datum" htmlFor="ev-date"><input id="ev-date" type="date" value=${form.date} required onInput=${(e) => set({ date: e.target.value })} /><//>
        <${Field} label="Von" htmlFor="ev-from"><input id="ev-from" type="time" value=${form.from} required onInput=${(e) => set({ from: e.target.value })} /><//>
        <${Field} label="Bis" htmlFor="ev-to"><input id="ev-to" type="time" value=${form.to} required onInput=${(e) => set({ to: e.target.value })} /><//>
      </div>
      <${Field} label="Gäste" htmlFor="ev-guests">
        <div class="chips guest-chips">
          ${form.guests.map(
            (g) => html`<span class="chip">${guestLabel(g)}<button type="button" aria-label=${g + ' entfernen'} onClick=${() => set({ guests: form.guests.filter((x) => x !== g) })}><${Icon} name="x" size=${14} /></button></span>`
          )}
        </div>
        <div class="picker">
          <input
            id="ev-guests"
            value=${guestText}
            autocomplete="off"
            placeholder="Kontakt suchen oder Adresse eintippen, Enter"
            onInput=${(e) => setGuestText(e.target.value)}
            onKeyDown=${(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (suggestions.length === 1) addGuest(suggestions[0].emails[0])
                else addGuest(guestText)
              }
            }}
          />
          ${suggestions.length > 0 &&
          html`<ul class="picker-list">
            ${suggestions.map(
              (p) => html`<li><button type="button" onMouseDown=${(e) => e.preventDefault()} onClick=${() => addGuest(p.emails[0])}>
                <span>${p.name}</span><span class="muted small">${p.emails[0]}</span>
              </button></li>`
            )}
          </ul>`}
        </div>
      <//>
      <div class="field-grid">
        <${Field} label="Ort" htmlFor="ev-loc"><input id="ev-loc" value=${form.location} onInput=${(e) => set({ location: e.target.value })} /><//>
        <${Field} label="Einladen aus dem Konto" htmlFor="ev-account">
          <select id="ev-account" value=${form.account} onChange=${(e) => set({ account: e.target.value })}>
            ${accounts.map((a) => html`<option value=${a}>${a}</option>`)}
          </select>
        <//>
      </div>
      <${Field} label="Beschreibung" htmlFor="ev-desc">
        <textarea id="ev-desc" rows="3" value=${form.description} onInput=${(e) => set({ description: e.target.value })}></textarea>
      <//>
      <label class="check-line">
        <input type="checkbox" checked=${form.meet} onChange=${(e) => set({ meet: e.target.checked })} />
        Google Meet hinzufügen
      </label>
      <p class="muted small">
        Das CRM liest die Kalender nur. Google Kalender öffnet sich mit allem ausgefüllt, erst „Speichern“ dort verschickt die Einladungen.
        Nach dem nächsten Abgleich erscheint der Termin auch hier.
      </p>
      <div class="form-actions">
        <button type="button" class="btn" onClick=${closeDialog}>Abbrechen</button>
        <button type="submit" class="btn btn-primary" disabled=${!form.title.trim()}><${Icon} name="external" size=${16} /> In Google Kalender öffnen</button>
      </div>
    </form>
  <//>`
}

dialogKinds['new-event'] = NewEventDialog

// Termine heute und morgen (für die Übersicht)
export function eventsTodayTomorrow(onlyMine, isMine) {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = addDaysDate(start, 2)
  return state.db.events
    .filter((e) => e.status !== 'cancelled')
    .filter((e) => {
      const s = new Date(e.start_at)
      const en = e.end_at ? new Date(e.end_at) : s
      return s < end && en > start
    })
    .filter((e) => !onlyMine || isMine(e))
    .sort((a, b) => a.start_at.localeCompare(b.start_at))
}
