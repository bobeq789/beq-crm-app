// Übersicht (Startseite): Schnellerfassung, Zu erledigen, Team, Termine, Warte auf Rückmeldung, Letzte Meetings
import { html, useState, useRef } from '../lib/preact.js'
import { Icon } from '../lib/icons.js'
import { todayStr, endOfWeekStr, fmtDateLong, fmtDateTime, fmtTimeRange, firstName, sinceLabel, local, ymd, norm } from '../lib/util.js'
import {
  state,
  myEmail,
  cardKind,
  createCard,
  defaultProjectId,
  getProject,
  meetingPersons,
  isMyEvent,
  isOpen,
  isNew,
  isMentioned,
  flagOf,
  lastHandover,
} from '../store.js'
import { openEvent } from '../router.js'
import { eventsTodayTomorrow } from './calendar.js'
import { PageHead, Tile, Empty, TaskRow, Segmented, PriorityPicker, ProjectSelect, AssigneeSelect, Dot } from './common.js'

const PRIO_ORDER = { hoch: 0, mittel: 1, niedrig: 2 }

// Sortierung: Fälligkeit, dann Dringlichkeit, dann zuletzt geändert
function taskSort(a, b) {
  const da = a.due_date || '9999-99-99'
  const dbb = b.due_date || '9999-99-99'
  if (da !== dbb) return da < dbb ? -1 : 1
  const pa = PRIO_ORDER[a.priority] ?? 3
  const pb = PRIO_ORDER[b.priority] ?? 3
  if (pa !== pb) return pa - pb
  return String(b.updated_at).localeCompare(String(a.updated_at))
}

// „Meine“: ich bin zuständig, oder niemand ist zuständig und ich habe die Aufgabe angelegt
export function isMine(card) {
  const me = myEmail().toLowerCase()
  const assignee = (card.assignee || '').toLowerCase()
  return assignee ? assignee === me : (card.created_by || '').toLowerCase() === me
}

function QuickAdd() {
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState(null)
  const [due, setDue] = useState('')
  const lastProject = local.get('beqcrm-last-quick-project')
  const validLast = lastProject && getProject(lastProject) && !getProject(lastProject).archived ? lastProject : null
  const [projectId, setProjectId] = useState(validLast || defaultProjectId())
  const [assignee, setAssignee] = useState(myEmail())
  const inputRef = useRef()

  const submit = async (e) => {
    e.preventDefault()
    const t = title.trim()
    if (!t) return
    local.set('beqcrm-last-quick-project', projectId)
    setTitle('')
    setPriority(null)
    setDue('')
    await createCard({ title: t, project_id: projectId, kind: 'todo', priority, due_date: due || null, assignee: assignee || null })
    inputRef.current && inputRef.current.focus()
  }

  return html`<form class="quick-add" onSubmit=${submit}>
    <div class="quick-row">
      <input
        ref=${inputRef}
        class="quick-input"
        value=${title}
        placeholder="Was steht an?"
        aria-label="Neue Aufgabe"
        onInput=${(e) => setTitle(e.target.value)}
      />
      <button type="submit" class="btn btn-primary" disabled=${!title.trim()}><${Icon} name="plus" size=${18} /><span class="hide-sm">Anlegen</span></button>
    </div>
    <div class="quick-options">
      <${PriorityPicker} value=${priority} onChange=${setPriority} />
      <label class="quick-field">
        <span class="sr-only">Fällig am</span>
        <input type="date" value=${due} onInput=${(e) => setDue(e.target.value)} aria-label="Fällig am" />
      </label>
      <label class="quick-field">
        <span class="sr-only">Projekt</span>
        <${ProjectSelect} value=${projectId} onChange=${setProjectId} />
      </label>
      <label class="quick-field">
        <span class="sr-only">Zuständig</span>
        <${AssigneeSelect} value=${assignee} onChange=${setAssignee} emptyLabel="Niemand zuständig" />
      </label>
    </div>
  </form>`
}

function TodoTile({ cards }) {
  const [showAll, setShowAll] = useState(false)
  const today = todayStr()
  const weekEnd = endOfWeekStr()
  const groups = { today: [], urgent: [], week: [], rest: [] }
  // Jede Aufgabe nur in der ersten passenden Gruppe
  cards.forEach((c) => {
    if (c.due_date && c.due_date <= today) groups.today.push(c)
    else if (c.priority === 'hoch') groups.urgent.push(c)
    else if (c.due_date && c.due_date <= weekEnd) groups.week.push(c)
    else groups.rest.push(c)
  })
  Object.values(groups).forEach((g) => g.sort(taskSort))
  const rest = showAll ? groups.rest : groups.rest.slice(0, 8)
  const section = (title, list, extra) =>
    list.length
      ? html`<div class="task-group">
          <h3 class="group-title">${title} <span class="count">${list.length}</span></h3>
          <ul class="task-list">${list.map((c) => html`<${TaskRow} card=${c} key=${c.id} />`)}</ul>
          ${extra}
        </div>`
      : null
  return html`<${Tile} title="Zu erledigen" count=${cards.length} cls="tile-todo">
    ${cards.length === 0 && html`<${Empty}>Nichts offen. Schön.<//>`}
    ${section('Überfällig und heute', groups.today)}
    ${section('Dringend', groups.urgent)}
    ${section('Diese Woche', groups.week)}
    ${groups.rest.length
      ? html`<div class="task-group">
          <h3 class="group-title">Weitere <span class="count">${groups.rest.length}</span></h3>
          <ul class="task-list">${rest.map((c) => html`<${TaskRow} card=${c} key=${c.id} />`)}</ul>
          ${groups.rest.length > 8 &&
          html`<button type="button" class="link-btn" onClick=${() => setShowAll(!showAll)}>
            ${showAll ? 'Weniger anzeigen' : `Alle ${groups.rest.length} anzeigen`}
          </button>`}
        </div>`
      : null}
  <//>`
}

function WaitingTile({ cards }) {
  const list = [...cards].sort((a, b) => String(a.stage_changed_at).localeCompare(String(b.stage_changed_at)))
  return html`<${Tile} title="Warte auf Rückmeldung" count=${list.length}>
    ${list.length
      ? html`<ul class="task-list">${list.map((c) => html`<${TaskRow} card=${c} key=${c.id} showSince=${true} sinceText=${sinceLabel(c.stage_changed_at)} />`)}</ul>`
      : html`<${Empty}>Gerade wartest du auf nichts.<//>`}
  <//>`
}

// Kachel „Team“: was Kollegen geändert haben und was bei anderen liegt
function TeamTile() {
  const me = norm(myEmail())
  const open = state.db.cards.filter(isOpen)
  const lastChange = (c) => String((flagOf(c.id) || {}).last_change || '')
  // Erwähnungen („@ dich“) stehen oben, sonst zuletzt geändert zuerst
  const fresh = open
    .filter((c) => isNew(c.id))
    .sort((a, b) => Number(isMentioned(b.id)) - Number(isMentioned(a.id)) || lastChange(b).localeCompare(lastChange(a)))
    .slice(0, 8)
  // Liegt bei anderen: jemand anderes ist zuständig, und ich habe sie angelegt oder weitergegeben.
  // „seit“: letzte Zuweisung an die zuständige Person, sonst das Anlegen.
  const elsewhere = open
    .filter((c) => {
      if (!c.assignee || norm(c.assignee) === me) return false
      const h = lastHandover(c.id)
      return norm(c.created_by || '') === me || (h && norm(h.actor || '') === me)
    })
    .map((c) => {
      const h = lastHandover(c.id)
      return { card: c, since: h && norm(h.assignee || '') === norm(c.assignee) ? h.at : c.created_at }
    })
    .sort((a, b) => String(a.since).localeCompare(String(b.since)))
  return html`<${Tile} title="Team">
    <div class="task-group">
      <h3 class="group-title">Neu seit deinem letzten Blick ${fresh.length > 0 && html`<span class="count">${fresh.length}</span>`}</h3>
      ${fresh.length
        ? html`<ul class="task-list">${fresh.map((c) => html`<${TaskRow} card=${c} key=${c.id} />`)}</ul>`
        : html`<${Empty}>Keine Änderungen von anderen.<//>`}
    </div>
    <div class="task-group">
      <h3 class="group-title">Liegt bei anderen ${elsewhere.length > 0 && html`<span class="count">${elsewhere.length}</span>`}</h3>
      ${elsewhere.length
        ? html`<ul class="task-list">
            ${elsewhere.slice(0, 8).map((x) => html`<${TaskRow} card=${x.card} key=${x.card.id} showSince=${true} sinceText=${sinceLabel(x.since)} />`)}
          </ul>`
        : html`<${Empty}>Gerade liegt nichts bei anderen.<//>`}
    </div>
  <//>`
}

function EventsTile({ scope }) {
  const list = eventsTodayTomorrow(scope === 'mine', isMyEvent)
  const today = todayStr()
  const groups = [
    { label: 'Heute', items: list.filter((e) => ymd(new Date(e.start_at)) <= today) },
    { label: 'Morgen', items: list.filter((e) => ymd(new Date(e.start_at)) > today) },
  ].filter((g) => g.items.length)
  return html`<${Tile} title="Termine heute und morgen" count=${list.length}>
    ${!state.db.events.length
      ? html`<${Empty}>Noch kein Kalender angebunden.<//>`
      : !list.length
        ? html`<${Empty}>Heute und morgen stehen keine Termine an.<//>`
        : groups.map(
            (g) => html`<div class="task-group" key=${g.label}>
              <h3 class="group-title">${g.label}</h3>
              <ul class="meeting-mini">
                ${g.items.map(
                  (e) => html`<li key=${e.id}>
                    <button type="button" class="mini-event" onClick=${() => openEvent(e.id)}>
                      <span class="mm-title">${e.title || '(ohne Titel)'}</span>
                      <span class="mm-meta"><${Dot} color=${e.calendar_color} />${fmtTimeRange(e.start_at, e.end_at, e.all_day)}${e.location ? ' · ' + e.location : ''}</span>
                    </button>
                  </li>`
                )}
              </ul>
            </div>`
          )}
    <a class="tile-link" href="#/kalender">Zum Kalender <${Icon} name="arrowRight" size=${16} /></a>
  <//>`
}

function MeetingsTile() {
  const list = [...state.db.meetings].sort((a, b) => b.held_at.localeCompare(a.held_at)).slice(0, 6)
  return html`<${Tile} title="Letzte Meetings">
    ${list.length
      ? html`<ul class="meeting-mini">
          ${list.map((m) => {
            const project = getProject(m.project_id)
            const people = meetingPersons(m.id).map((p) => p.name)
            const names = [...people, ...(m.extra_names || [])]
            return html`<li key=${m.id}>
              <a href=${'#/meetings/' + m.id}>
                <span class="mm-title">${m.title}</span>
                <span class="mm-meta">
                  ${project && html`<${Dot} color=${project.color} />`}${fmtDateTime(m.held_at)}${names.length ? ' · ' + names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2}` : '') : ''}
                </span>
              </a>
            </li>`
          })}
        </ul>`
      : html`<${Empty}>Noch keine Meetings.<//>`}
    <a class="tile-link" href="#/meetings">Alle Meetings <${Icon} name="arrowRight" size=${16} /></a>
  <//>`
}

export function Overview() {
  const [scope, setScope] = useState(local.get('beqcrm-scope', 'mine'))
  const changeScope = (v) => {
    setScope(v)
    local.set('beqcrm-scope', v)
  }
  const visible = state.db.cards.filter((c) => !c.archived && (scope === 'all' || isMine(c)))
  const todo = visible.filter((c) => ['todo', 'doing'].includes(cardKind(c)))
  const waiting = visible.filter((c) => cardKind(c) === 'waiting')
  const name = state.me ? firstName(state.me.name) : ''

  return html`<div class="page">
    <${PageHead}
      kicker=${fmtDateLong()}
      title=${name ? `Hallo ${name}` : 'Übersicht'}
      actions=${html`<${Segmented}
        label="Welche Aufgaben"
        value=${scope}
        onChange=${changeScope}
        options=${[
          { value: 'mine', label: 'Meine' },
          { value: 'all', label: 'Alle' },
        ]}
      />`}
    />
    <${QuickAdd} />
    <div class="overview-grid">
      <div class="col-main"><${TodoTile} cards=${todo} /></div>
      <div class="col-side">
        <${TeamTile} />
        <${EventsTile} scope=${scope} />
        <${WaitingTile} cards=${waiting} />
        <${MeetingsTile} />
      </div>
    </div>
  </div>`
}
