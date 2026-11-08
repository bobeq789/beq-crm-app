// Übersicht (Startseite): Schnellerfassung, Zu erledigen, Team, Termine, Wiedervorlagen, Letzte Meetings.
// Jede Aufgabe steht nur einmal: To-dos und „In Arbeit“ in „Zu erledigen“, alle übrigen Arten
// außer „Erledigt“ in „Wiedervorlagen“ (Nachträge Aktivitäten und Terminlink vom 08.11.2026).
import { html, useState, useRef } from '../lib/preact.js'
import { Icon } from '../lib/icons.js'
import { todayStr, endOfWeekStr, addDays, fmtDateLong, fmtDateTime, fmtTimeRange, fmtRelative, firstName, sinceLabel, local, ymd, norm } from '../lib/util.js'
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
  answerFor,
  followUpIn,
  isGuest,
  activeMembers,
  savePrefs,
} from '../store.js'
import { TILE_DEFAULT, tileLayout, moveTile, ArrangeView, useTileDrag } from './tiles.js'
import { openEvent, openCard, navigate } from '../router.js'
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

function TodoTile({ cards, drag }) {
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
  return html`<${Tile} title="Zu erledigen" count=${cards.length} cls="tile-todo" drag=${drag}>
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
  // „Antwort da“ ganz oben, diese Aufgaben stehen nicht noch einmal unter „Fällig“ oder „Wartet“
  const answers = []
  cards.forEach((c) => {
    const answer = answerFor(c.id)
    if (answer) return answers.push({ key: c.id, card: c, answer })
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
  answers.sort((x, y) => String(y.answer.sent_at).localeCompare(String(x.answer.sent_at)))
  return { answers, due: dated.filter((x) => x.date <= today), soon: dated.filter((x) => x.date > today), waiting }
}

// „hat gestern geschrieben“, „hat vor 3 Tagen geschrieben“, „hat am Mo., 3. Nov. geschrieben“
export function wroteWhen(iso) {
  const rel = fmtRelative(iso)
  return /^(vor|gestern|gerade)/.test(rel) ? `hat ${rel} geschrieben` : `hat am ${rel} geschrieben`
}

// Antwort da: Absender, wann, Betreff, dazu „Wieder in 3 Tagen, 1 Woche, 2 Wochen“. Das
// Verschieben ändert die Aufgabe, damit ist der Hinweis weg.
function AnswerRow({ card, answer }) {
  const who = answer.from_name || (getPerson(card.person_id) || {}).name || answer.from_email
  return html`<li class="task-row answer-row">
    <span class="answer-icon" aria-hidden="true"><${Icon} name="mail" size=${16} /></span>
    <div class="task-main">
      <button type="button" class="task-title" onClick=${() => openCard(card.id)}>${card.title}</button>
      <div class="answer-line"><strong>${who}</strong> ${wroteWhen(answer.sent_at)}${answer.subject ? html`: „${answer.subject}“` : ''}</div>
      <div class="answer-actions">
        <span class="muted small">Wieder in</span>
        ${[[3, '3 Tagen'], [7, '1 Woche'], [14, '2 Wochen']].map(
          ([n, label]) => html`<button type="button" class="chip-btn small" onClick=${() => followUpIn(card, n)}>${label}</button>`
        )}
      </div>
    </div>
  </li>`
}

// Zahl an „Übersicht“ und am App-Symbol: „Antwort da“ plus alles Fällige (auch aus „Zu
// erledigen“), je Aufgabe einmal, plus fällige Aktivitäten ohne Aufgabe. Immer wie „Meine“.
export function overviewCount() {
  if (isGuest()) return 0
  const today = todayStr()
  const ids = new Set()
  state.db.cards.forEach((c) => {
    if (c.archived) return
    const kind = cardKind(c)
    if (kind === 'done') return
    const next = nextActivity(c.id)
    if (kind === 'todo' || kind === 'doing') {
      const date = effectiveDate(c)
      if (isMine(c) && date && date <= today) ids.add(c.id)
      return
    }
    if (!isMine(c) && !(next && isMyActivity(next))) return
    const date = next ? next.faellig : c.due_date
    if ((date && date <= today) || answerFor(c.id)) ids.add(c.id)
  })
  const loose = allActivities().filter((a) => !a.card_id && !a.erledigt_at && a.faellig <= today && isMyActivity(a)).length
  return ids.size + loose
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

function FollowUpTile({ groups, drag }) {
  const { answers, due, soon, waiting } = groups
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
  const empty = !answers.length && !due.length && !soon.length && !waiting.length
  return html`<${Tile} title="Wiedervorlagen" count=${answers.length + due.length} cls="tile-followup" drag=${drag}>
    ${empty && html`<${Empty}>Gerade steht nichts zum Nachhaken an.<//>`}
    ${section('Antwort da', answers, (x) => html`<${AnswerRow} key=${x.key} card=${x.card} answer=${x.answer} />`)}
    ${section('Fällig', due, row)}
    ${section('Nächste 7 Tage', soon, row)}
    ${section('Wartet auf Antwort', waiting, (c) => html`<${TaskRow} card=${c} key=${c.id} showSince=${true} sinceText=${sinceLabel(c.stage_changed_at)} />`)}
  <//>`
}

// Kachel „Team“: was Kollegen geändert haben und was bei anderen liegt
function TeamTile({ drag }) {
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
  return html`<${Tile} title="Team" drag=${drag}>
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

function EventsTile({ scope, drag }) {
  const list = eventsTodayTomorrow(scope === 'mine', isMyEvent)
  const today = todayStr()
  const groups = [
    { label: 'Heute', items: list.filter((e) => ymd(new Date(e.start_at)) <= today) },
    { label: 'Morgen', items: list.filter((e) => ymd(new Date(e.start_at)) > today) },
  ].filter((g) => g.items.length)
  return html`<${Tile} title="Termine heute und morgen" count=${list.length} drag=${drag}>
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

function MeetingsTile({ drag }) {
  const list = [...state.db.meetings].sort((a, b) => b.held_at.localeCompare(a.held_at)).slice(0, 6)
  return html`<${Tile} title="Letzte Meetings" drag=${drag}>
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
  const name = state.me ? firstName(state.me.name) : ''

  // Kacheln (B2): Anordnung je Person aus nutzer_einstellungen. „Team“ gilt erst ab zwei Personen
  // im Team und taucht sonst auch beim Anordnen nicht auf.
  const [arranging, setArranging] = useState(false)
  const available = TILE_DEFAULT.reihe.filter((id) => id !== 'team' || activeMembers().length > 1)
  const saved = state.prefs.kacheln
  const custom = !!(saved && Array.isArray(saved.reihe))
  const layout = tileLayout(saved, available)
  // Am Handy eine Reihe. Ohne eigene Anordnung rückt „Wiedervorlagen“ nach oben, sobald dort
  // etwas ansteht (C8 Punkt 5). Mit eigener Anordnung gilt nur die eigene Reihenfolge. Die
  // Reihenfolge kommt aus dem Code, nicht aus einer CSS-Regel.
  const followFirst = isMobile && !custom && follow.due.length + follow.answers.length > 0
  const mobileOrder = followFirst ? ['wiedervorlagen', ...layout.reihe.filter((id) => id !== 'wiedervorlagen')] : layout.reihe
  const saveLayout = (next) => savePrefs({ kacheln: next })
  // Ablegen beim direkten Ziehen. Am Handy gilt für die Berechnung die Reihenfolge, die gerade
  // zu sehen ist, und „breit“ bleibt, wie es ist.
  const drag = useTileDrag((id, target) => {
    const base = isMobile ? { reihe: mobileOrder, breit: layout.breit } : layout
    saveLayout(moveTile(base, id, target, isMobile))
  })
  const names = { aufgaben: 'Zu erledigen', team: 'Team', termine: 'Termine heute und morgen', wiedervorlagen: 'Wiedervorlagen', meetings: 'Letzte Meetings' }
  const tileFor = (id) => {
    const d = { onPointerDown: (e) => drag.start(id, e) }
    if (id === 'aufgaben') return html`<${TodoTile} cards=${todo} drag=${d} />`
    if (id === 'team') return html`<${TeamTile} drag=${d} />`
    if (id === 'termine') return html`<${EventsTile} scope=${scope} drag=${d} />`
    if (id === 'wiedervorlagen') return html`<${FollowUpTile} groups=${follow} drag=${d} />`
    return html`<${MeetingsTile} drag=${d} />`
  }
  const t = drag.target
  const slot = (id) => {
    const mark = t && t.id === id ? (t.before ? ' drop-before' : ' drop-after') : ''
    return html`<div class=${'tile-slot' + mark} data-tile=${id} key=${id}>${tileFor(id)}</div>`
  }
  // Eine Spalte. Während des Ziehens ist sie auch leer zu sehen, mit „Hierher ziehen“.
  const column = (col, ids, cls) =>
    html`<div class=${'ov-col ' + cls + (t && t.col === col ? ' drop-end' : '')} data-col=${col}>
      ${ids.map(slot)}
      ${drag.dragging && !ids.filter((x) => x !== drag.dragging).length && html`<div class="ov-drop-hint">Hierher ziehen</div>`}
    </div>`
  const wide = layout.reihe.filter((id) => layout.breit.includes(id))
  const narrow = layout.reihe.filter((id) => !layout.breit.includes(id))
  const oneSided = !drag.dragging && (!wide.length || !narrow.length)

  return html`<div class="page">
    <${PageHead}
      kicker=${fmtDateLong()}
      title=${name ? `Hallo ${name}` : 'Übersicht'}
      actions=${html`<div class="ov-head-actions">
        <${Segmented}
          label="Welche Aufgaben"
          value=${scope}
          onChange=${changeScope}
          options=${[
            { value: 'mine', label: 'Meine' },
            { value: 'all', label: 'Alle' },
          ]}
        />
        <button type="button" class=${'btn btn-small' + (arranging ? ' active' : '')} aria-pressed=${arranging} onClick=${() => setArranging(!arranging)}>
          <${Icon} name="grip" size=${16} /> Anordnen
        </button>
      </div>`}
    />
    ${arranging
      ? html`<${ArrangeView}
          layout=${isMobile ? { reihe: mobileOrder, breit: layout.breit } : layout}
          names=${names}
          oneColumn=${isMobile}
          custom=${custom}
          onChange=${saveLayout}
          onReset=${() => saveLayout(null)}
          onDone=${() => setArranging(false)}
        />`
      : html`<${QuickAdd} />
          ${isMobile
            ? html`<div class="overview-grid ov-one">${column('alle', mobileOrder, 'col-main')}</div>`
            : oneSided
            ? html`<div class="overview-grid ov-one">${column(wide.length ? 'breit' : 'schmal', layout.reihe, 'col-main')}</div>`
            : html`<div class="overview-grid">${column('breit', wide, 'col-main')}${column('schmal', narrow, 'col-side')}</div>`}`}
  </div>`
}
