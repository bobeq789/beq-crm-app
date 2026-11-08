// Übersicht (Startseite): Schnellerfassung, Zu erledigen, Team, Termine, Wiedervorlagen, Letzte Meetings.
// Jede Aufgabe steht nur einmal: To-dos und „In Arbeit“ in „Zu erledigen“, alle übrigen Arten
// außer „Erledigt“ in „Wiedervorlagen“ (Nachträge Aktivitäten und Terminlink vom 08.11.2026).
import { html, useState, useRef } from '../lib/preact.js'
import { Icon } from '../lib/icons.js'
import { todayStr, endOfWeekStr, addDays, fmtDateLong, fmtDateTime, fmtTimeRange, firstName, sinceLabel, local, ymd, norm } from '../lib/util.js'
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
  nextActivity,
  allActivities,
  isMyActivity,
  activityKind,
  activityText,
  activitySort,
  completeActivity,
  getPerson,
  getOrg,
} from '../store.js'
import { openEvent, navigate } from '../router.js'
import { eventsTodayTomorrow } from './calendar.js'
import { PageHead, Tile, Empty, TaskRow, Segmented, PriorityPicker, ProjectSelect, AssigneeSelect, Dot, activityWhen, useIsMobile } from './common.js'

const PRIO_ORDER = { hoch: 0, mittel: 1, niedrig: 2 }

// Früheres Datum aus Frist und nächster offener Aktivität
function effectiveDate(card) {
  const next = nextActivity(card.id)
  const dates = [card.due_date, next && next.faellig].filter(Boolean).sort()
  return dates[0] || null
}

// Sortierung: Dringlichkeit, dann das frühere Datum aus Frist und nächster Aktivität, dann zuletzt geändert
function taskSort(a, b) {
  const pa = PRIO_ORDER[a.priority] ?? 3
  const pb = PRIO_ORDER[b.priority] ?? 3
  if (pa !== pb) return pa - pb
  const da = effectiveDate(a) || '9999-99-99'
  const dbb = effectiveDate(b) || '9999-99-99'
  if (da !== dbb) return da < dbb ? -1 : 1
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
  // Jede Aufgabe nur in der ersten passenden Gruppe. Was heute dran ist (Frist oder
  // Aktivität), steht immer oben und nie hinter „Alle anzeigen“.
  cards.forEach((c) => {
    const date = effectiveDate(c)
    if (date && date <= today) groups.today.push(c)
    else if (c.priority === 'hoch') groups.urgent.push(c)
    else if (date && date <= weekEnd) groups.week.push(c)
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

// Wiedervorlagen (C8): Fälliges und die nächsten 7 Tage nach dem Datum der nächsten Aktivität
// (ein altes Datum an der Aufgabe zählt als Rückfall), dazu Aktivitäten ohne Aufgabe.
// Danach „Wartet auf Antwort“: wartende Aufgaben ohne etwas in den nächsten 7 Tagen.
export function followUpItems(cards, scope) {
  const today = todayStr()
  const in7 = addDays(today, 7)
  const dated = []
  const waiting = []
  cards.forEach((c) => {
    const act = nextActivity(c.id)
    const date = act ? act.faellig : c.due_date
    if (date && date <= in7) dated.push({ key: c.id, date, card: c, act })
    else if (cardKind(c) === 'waiting') waiting.push(c)
  })
  allActivities()
    .filter((a) => !a.card_id && !a.erledigt_at && a.faellig <= in7 && (scope === 'all' || isMyActivity(a)))
    .forEach((a) => dated.push({ key: a.id, date: a.faellig, act: a }))
  dated.sort((x, y) => x.date.localeCompare(y.date) || (x.act && y.act ? activitySort(x.act, y.act) : 0))
  waiting.sort((a, b) => String(a.stage_changed_at).localeCompare(String(b.stage_changed_at)))
  return { due: dated.filter((x) => x.date <= today), soon: dated.filter((x) => x.date > today), waiting }
}

// Aktivität ohne Aufgabe: Symbol, Text, Kontakt und Firma. Ein Klick öffnet den Kontakt.
function LooseActivityRow({ act }) {
  const person = getPerson(act.person_id)
  const org = getOrg(act.org_id) || (person && getOrg(person.org_id))
  const kind = activityKind(act.art)
  const when = activityWhen(act)
  const open = () => (person ? navigate('/kontakte/' + person.id) : org && navigate('/firmen/' + org.id))
  return html`<li class="task-row">
    <button type="button" class="check" title="Abhaken" aria-label=${'Abhaken: ' + activityText(act)} onClick=${() => completeActivity(act)}>
      <${Icon} name="check" size=${16} />
    </button>
    <div class="task-main">
      <button type="button" class="task-title act-loose" onClick=${open}><${Icon} name=${kind.icon} size=${16} /><span>${activityText(act)}</span></button>
      <div class="task-meta">
        ${[person && person.name, org && org.name].filter(Boolean).map((t) => html`<span class="meta-item muted">${t}</span>`)}
        <span class=${'badge due-' + when.tone}>${when.text}</span>
      </div>
    </div>
  </li>`
}

function FollowUpTile({ groups }) {
  const { due, soon, waiting } = groups
  const row = (x) =>
    x.card
      ? html`<${TaskRow} card=${x.card} key=${x.key} checkActivity=${x.act} />`
      : html`<${LooseActivityRow} act=${x.act} key=${x.key} />`
  const section = (title, list, render) =>
    list.length
      ? html`<div class="task-group">
          <h3 class="group-title">${title} <span class="count">${list.length}</span></h3>
          <ul class="task-list">${list.map(render)}</ul>
        </div>`
      : null
  const empty = !due.length && !soon.length && !waiting.length
  return html`<${Tile} title="Wiedervorlagen" count=${due.length} cls="tile-followup">
    ${empty && html`<${Empty}>Gerade steht nichts zum Nachhaken an.<//>`}
    ${section('Fällig', due, row)}
    ${section('Nächste 7 Tage', soon, row)}
    ${section('Wartet auf Antwort', waiting, (c) => html`<${TaskRow} card=${c} key=${c.id} showSince=${true} sinceText=${sinceLabel(c.stage_changed_at)} />`)}
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
  // Wiedervorlagen: alle übrigen Arten außer „Erledigt“. Bei „Meine“ zählt auch, wenn die
  // nächste Aktivität mir gehört.
  const followCards = state.db.cards.filter((c) => {
    if (c.archived || ['todo', 'doing', 'done'].includes(cardKind(c))) return false
    if (scope === 'all' || isMine(c)) return true
    const next = nextActivity(c.id)
    return !!next && isMyActivity(next)
  })
  const follow = followUpItems(followCards, scope)
  const isMobile = useIsMobile()
  // Am Handy rückt die Kachel nach oben, sobald dort etwas fällig ist (C8 Punkt 5)
  const followFirst = isMobile && follow.due.length > 0
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
      <div class="col-main">
        ${followFirst && html`<${FollowUpTile} groups=${follow} />`}
        <${TodoTile} cards=${todo} />
      </div>
      <div class="col-side">
        <${TeamTile} />
        <${EventsTile} scope=${scope} />
        ${!followFirst && html`<${FollowUpTile} groups=${follow} />`}
        <${MeetingsTile} />
      </div>
    </div>
  </div>`
}
