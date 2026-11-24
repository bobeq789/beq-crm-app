// Meine Pipeline (36_meine_pipeline.sql, Entscheidungen vom 24.11.2026)
//
// Ein Board je Person mit denselben Spalten wie die Projekte (To-dos, In Arbeit, Warte auf
// Rückmeldung, Später, Erledigt). Darin alle Aufgaben aus allen Projekten, für die die Person
// zuständig ist (Hauptperson oder weitere zuständige Person), dazu Aufgaben mit einer offenen
// Unteraufgabe für sie. Verschieben ändert die Spalte im Projekt der Aufgabe, es gibt keine
// doppelten Daten.
// Rechts zwei Listen mit den offenen Aktivitäten: „Aktivitäten intern“ und „Aktivitäten Sales“
// (aktivitaeten.bereich), gruppiert nach Überfällig, Heute, Diese Woche, Später.
// „Von mir vergeben“ zeigt, was die Person anderen gegeben hat (cards.vergeben_von, angelegte
// Unteraufgaben und Aktivitäten für andere).
// Die Pipeline anderer sieht nur der Super-Admin (beQ Backoffice, Entscheidung vom 24.11.2026),
// alle anderen nur ihre eigene.
// Adresse: #/pipeline?von=<Adresse>&ansicht=vergeben
import { html, useState, useEffect } from '../lib/preact.js'
import { Icon } from '../lib/icons.js'
import { matches, todayStr, endOfWeekStr, norm, firstName, local } from '../lib/util.js'
import {
  state,
  activeMembers,
  activeProjects,
  getProject,
  getCard,
  getPerson,
  getOrg,
  memberName,
  myEmail,
  cardKind,
  isCardOf,
  moveCardToKind,
  createCard,
  activityHolder,
  activityArea,
  activityKind,
  activityText,
  activitySort,
  completeActivity,
  openDialog,
  closeDialog,
  toast,
  isSuperAdmin,
} from '../store.js'
import { navigate, openCard, setParam } from '../router.js'
import { PageHead, Modal, Field, ProjectSelect, Avatar, Empty, activityWhen, dialogKinds, useIsMobile } from './common.js'
import { BoardCard, ProjectPicker, PIPELINE_ID } from './board.js'

export const PIPELINE_COLUMNS = [
  { kind: 'todo', label: 'To-dos' },
  { kind: 'doing', label: 'In Arbeit' },
  { kind: 'waiting', label: 'Warte auf Rückmeldung' },
  { kind: 'later', label: 'Später' },
  { kind: 'done', label: 'Erledigt' },
]
const DONE_LIMIT = 15
const LIST_LIMIT = 8

// Wessen Pipeline? Ohne Angabe die eigene. Andere nur für den Super-Admin, nur aktive
// Teammitglieder (keine Gäste).
function personOf(param) {
  if (!isSuperAdmin()) return norm(myEmail())
  const e = norm(param || '')
  return activeMembers().find((t) => norm(t.email) === e) ? e : norm(myEmail())
}

// Kurzer Hinweis auf der Karte, warum sie in dieser Pipeline steht
function subtaskNote(subs, forWhom) {
  if (subs.length === 1) return `Checkliste für ${forWhom}: „${subs[0].titel}“`
  return `${subs.length} Punkte der Checkliste für ${forWhom}`
}

// Aufgaben der Pipeline mit Hinweis. mode: 'zustaendig' oder 'vergeben'
export function pipelineCards(person, mode) {
  const p = norm(person)
  const self = p === norm(myEmail())
  const openSubs = (state.db.unteraufgaben || []).filter((u) => !u.erledigt_at && u.zustaendig)
  const out = []
  state.db.cards.forEach((card) => {
    if (card.archived) return
    const subs = openSubs.filter((u) => u.card_id === card.id)
    if (mode === 'vergeben') {
      if (norm(card.vergeben_von || '') === p && card.assignee && norm(card.assignee) !== p) {
        out.push({ card, note: null })
        return
      }
      const given = subs.filter((u) => norm(u.created_by || '') === p && norm(u.zustaendig) !== p)
      if (given.length) {
        const names = [...new Set(given.map((u) => firstName(memberName(u.zustaendig))))].join(', ')
        out.push({ card, note: subtaskNote(given, names) })
      }
      return
    }
    if (isCardOf(card, p)) {
      const co = norm(card.assignee || '') !== p && (card.mitzustaendig || []).map(norm).includes(p)
      out.push({ card, note: co ? 'Mitzuständig' : null })
      return
    }
    const mine = subs.filter((u) => norm(u.zustaendig) === p)
    if (mine.length) out.push({ card, note: subtaskNote(mine, self ? 'dich' : firstName(memberName(p))) })
  })
  return out
}

// Offene Aktivitäten der Pipeline. mode wie oben.
export function pipelineActivities(person, mode) {
  const p = norm(person)
  return (state.db.aktivitaeten || [])
    .filter((a) => !a.erledigt_at)
    .filter((a) => {
      const card = a.card_id ? getCard(a.card_id) : null
      if (card && card.archived) return false
      if (mode === 'vergeben') return norm(a.created_by || '') === p && !!a.zustaendig && norm(a.zustaendig) !== p
      return activityHolder(a) === p
    })
    .sort(activitySort)
}

// Überfällig, Heute, Diese Woche, Später
function groupByWhen(list) {
  const today = todayStr()
  const weekEnd = endOfWeekStr()
  const groups = [
    { key: 'overdue', label: 'Überfällig', items: [] },
    { key: 'today', label: 'Heute', items: [] },
    { key: 'week', label: 'Diese Woche', items: [] },
    { key: 'later', label: 'Später', items: [] },
  ]
  list.forEach((a) => {
    const g = a.faellig < today ? 0 : a.faellig === today ? 1 : a.faellig <= weekEnd ? 2 : 3
    groups[g].items.push(a)
  })
  return groups.filter((g) => g.items.length)
}

// Wohin gehört die Aktivität? Aufgabe, sonst Kontakt, sonst Firma
function contextOf(a) {
  const card = a.card_id ? getCard(a.card_id) : null
  if (card) return { label: card.title, open: () => openCard(card.id) }
  const person = a.person_id ? getPerson(a.person_id) : null
  if (person) return { label: person.name, open: () => navigate('/kontakte/' + person.id) }
  const org = a.org_id ? getOrg(a.org_id) : null
  if (org) return { label: org.name, open: () => navigate('/firmen/' + org.id) }
  return { label: '', open: () => {} }
}

function activityMatches(a, q) {
  if (!q.trim()) return true
  return matches(q, activityText(a), contextOf(a).label)
}

function PipelineActivity({ a, mode }) {
  const kind = activityKind(a.art)
  const when = activityWhen(a)
  const ctx = contextOf(a)
  return html`<li class="pl-act">
    <button type="button" class="check" title="Abhaken" aria-label=${'Abhaken: ' + activityText(a)} onClick=${() => completeActivity(a)}>
      <${Icon} name="check" size=${16} />
    </button>
    <button type="button" class="pl-act-main" onClick=${ctx.open} title=${ctx.label ? 'Öffnen: ' + ctx.label : undefined}>
      <span class="pl-act-title"><${Icon} name=${kind.icon} size=${15} /> ${activityText(a)}</span>
      ${ctx.label && html`<span class="pl-act-ctx">${ctx.label}</span>`}
    </button>
    ${mode === 'vergeben' && html`<${Avatar} email=${a.zustaendig} />`}
    <span class=${'badge due-' + when.tone}>${when.text}</span>
  </li>`
}

function ActivityList({ title, list, mode, empty }) {
  const [showAll, setShowAll] = useState(false)
  const groups = groupByWhen(list)
  let left = showAll ? Infinity : LIST_LIMIT
  return html`<section class="pl-list">
    <h2 class="pl-list-title">${title} <span class="count">${list.length}</span></h2>
    ${!list.length && html`<p class="column-empty">${empty}</p>`}
    ${groups.map((g) => {
      const items = g.items.slice(0, Math.max(0, left))
      left -= items.length
      if (!items.length) return null
      return html`<div class="pl-group" key=${g.key}>
        <h3 class=${'pl-group-title' + (g.key === 'overdue' ? ' overdue' : '')}>${g.label}</h3>
        <ul class="pl-acts">${items.map((a) => html`<${PipelineActivity} key=${a.id} a=${a} mode=${mode} />`)}</ul>
      </div>`
    })}
    ${list.length > LIST_LIMIT &&
    html`<button type="button" class="link-btn" onClick=${() => setShowAll(!showAll)}>${showAll ? 'Weniger anzeigen' : `Alle ${list.length} anzeigen`}</button>`}
  </section>`
}

function PipelineColumn({ col, items, draggable, viewer }) {
  const [over, setOver] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const isDone = col.kind === 'done'
  const shown = isDone && !showAll ? items.slice(0, DONE_LIMIT) : items
  const drop = (e) => {
    e.preventDefault()
    setOver(false)
    const card = getCard(e.dataTransfer.getData('text/plain'))
    if (card) moveCardToKind(card, col.kind)
  }
  return html`<section
    class=${'column pl-column' + (over ? ' drop-over' : '')}
    aria-label=${col.label}
    onDragOver=${(e) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (!over) setOver(true)
    }}
    onDragLeave=${(e) => !e.currentTarget.contains(e.relatedTarget) && setOver(false)}
    onDrop=${drop}
  >
    <div class="column-head">
      <h2 class="column-title">${col.label} <span class="count">${items.length}</span></h2>
    </div>
    <ul class="column-cards">
      ${shown.map((x) => html`<${BoardCard} key=${x.card.id} card=${x.card} draggable=${draggable} viewer=${viewer} showProject=${true} note=${x.note} />`)}
    </ul>
    ${isDone &&
    items.length > DONE_LIMIT &&
    html`<button type="button" class="link-btn" onClick=${() => setShowAll(!showAll)}>${showAll ? 'Weniger anzeigen' : `Alle ${items.length} anzeigen`}</button>`}
    ${!items.length && html`<p class="column-empty">Keine Deals</p>`}
  </section>`
}

// Sortierung wie auf dem Board: Erledigt nach dem Zeitpunkt des Erledigens, sonst zuletzt geändert
const sortFor = (kind) => (a, b) =>
  kind === 'done'
    ? String(b.card.stage_changed_at).localeCompare(String(a.card.stage_changed_at))
    : String(b.card.updated_at).localeCompare(String(a.card.updated_at))

export function PipelinePage({ params }) {
  const mobile = useIsMobile()
  const person = personOf(params.get('von'))
  const mode = params.get('ansicht') === 'vergeben' ? 'vergeben' : 'zustaendig'
  const self = person === norm(myEmail())
  const name = memberName(person)
  const [query, setQuery] = useState('')
  const [project, setProject] = useState('')
  const [tab, setTab] = useState('aufgaben')
  const [mobileKind, setMobileKind] = useState('todo')
  // Im Board gemerkt wie ein Projekt: „Board“ öffnet beim nächsten Mal wieder die Pipeline
  useEffect(() => local.set('beqcrm-last-project', PIPELINE_ID), [])

  const cardMatches = (card) => {
    if (project && card.project_id !== project) return false
    if (!query.trim()) return true
    const p = getPerson(card.person_id)
    const o = getOrg(card.org_id)
    return matches(query, card.title, card.labels, p && p.name, o && o.name)
  }
  const items = pipelineCards(person, mode).filter((x) => cardMatches(x.card))
  const byKind = Object.fromEntries(PIPELINE_COLUMNS.map((c) => [c.kind, items.filter((x) => cardKind(x.card) === c.kind).sort(sortFor(c.kind))]))
  const acts = pipelineActivities(person, mode).filter((a) => {
    if (project) {
      const card = a.card_id ? getCard(a.card_id) : null
      if (!card || card.project_id !== project) return false
    }
    return activityMatches(a, query)
  })
  const intern = acts.filter((a) => activityArea(a) === 'intern')
  const sales = acts.filter((a) => activityArea(a) === 'sales')
  const openCount = items.filter((x) => cardKind(x.card) !== 'done').length

  const title = self ? 'Meine Pipeline' : `Pipeline von ${name}`
  const givenLabel = self ? 'Von mir vergeben' : `Von ${firstName(name)} vergeben`
  const emptyActs = mode === 'vergeben' ? 'Nichts an andere vergeben.' : 'Nichts offen.'

  const lists = html`
    <${ActivityList} title="Aktivitäten intern" list=${intern} mode=${mode} empty=${emptyActs} />
    <${ActivityList} title="Aktivitäten Sales" list=${sales} mode=${mode} empty=${emptyActs} />`

  const filters = html`<div class="board-filters pl-filters">
    ${isSuperAdmin() &&
    html`<select value=${person} aria-label="Pipeline von" onChange=${(e) => setParam('von', norm(e.target.value) === norm(myEmail()) ? null : e.target.value, true)}>
      ${activeMembers().map((t) => html`<option value=${norm(t.email)}>${norm(t.email) === norm(myEmail()) ? 'Meine Pipeline' : 'Pipeline von ' + t.name}</option>`)}
    </select>`}
    <div class="segmented" role="group" aria-label="Ansicht">
      <button type="button" class=${mode === 'zustaendig' ? 'active' : ''} aria-pressed=${mode === 'zustaendig'} onClick=${() => setParam('ansicht', null, true)}>Zuständig</button>
      <button type="button" class=${mode === 'vergeben' ? 'active' : ''} aria-pressed=${mode === 'vergeben'} onClick=${() => setParam('ansicht', 'vergeben', true)}>${givenLabel}</button>
    </div>
    <select value=${project} aria-label="Pipeline" onChange=${(e) => setProject(e.target.value)}>
      <option value="">Alle Pipelines</option>
      ${activeProjects()
        .filter((p) => p.id === project || state.db.cards.some((c) => c.project_id === p.id))
        .map((p) => html`<option value=${p.id}>${p.name}</option>`)}
    </select>
    <label class="search">
      <${Icon} name="search" size=${18} />
      <input type="search" value=${query} placeholder="Suchen: Titel, Kontakt, Firma" aria-label="Pipeline durchsuchen" onInput=${(e) => setQuery(e.target.value)} />
    </label>
  </div>`

  const newTask = () => openDialog({ kind: 'pipeline-new', person })
  const actions = html`<button type="button" class="btn btn-primary" onClick=${newTask}><${Icon} name="plus" size=${18} /> Neuer Deal</button>`
  const kicker = mode === 'vergeben' ? 'Board · vergeben' : 'Board'
  const bar = html`<div class="project-tabs project-bar"><${ProjectPicker} currentId=${PIPELINE_ID} pipelineCount=${openCount} /></div>`

  if (mobile) {
    const col = PIPELINE_COLUMNS.find((c) => c.kind === mobileKind) || PIPELINE_COLUMNS[0]
    return html`<div class="page page-pipeline">
      <${PageHead} kicker=${kicker} title=${title} />
      ${bar}
      ${filters}
      <div class="stage-tabs pl-tabs" role="tablist" aria-label="Bereich">
        ${[
          ['aufgaben', 'Deals', openCount],
          ['intern', 'Intern', intern.length],
          ['sales', 'Sales', sales.length],
        ].map(
          ([key, label, n]) => html`<button type="button" role="tab" aria-selected=${tab === key} class=${'tab' + (tab === key ? ' active' : '')} onClick=${() => setTab(key)}>
            ${label} <span class="count">${n}</span>
          </button>`
        )}
      </div>
      ${tab === 'aufgaben' &&
      html`<div class="stage-tabs" role="tablist" aria-label="Spalten">
          ${PIPELINE_COLUMNS.map(
            (c) => html`<button type="button" role="tab" aria-selected=${c.kind === col.kind} class=${'tab tab-small' + (c.kind === col.kind ? ' active' : '')} onClick=${() => setMobileKind(c.kind)}>
              ${c.label} <span class="count">${byKind[c.kind].length}</span>
            </button>`
          )}
        </div>
        <div class="board-mobile"><${PipelineColumn} col=${col} items=${byKind[col.kind]} draggable=${false} viewer=${person} /></div>`}
      ${tab === 'intern' && html`<${ActivityList} title="Aktivitäten intern" list=${intern} mode=${mode} empty=${emptyActs} />`}
      ${tab === 'sales' && html`<${ActivityList} title="Aktivitäten Sales" list=${sales} mode=${mode} empty=${emptyActs} />`}
      <button type="button" class="fab" aria-label="Neuer Deal" onClick=${newTask}><${Icon} name="plus" size=${26} /></button>
    </div>`
  }

  return html`<div class="page page-pipeline">
    <${PageHead} kicker=${kicker} title=${title} actions=${actions} />
    ${bar}
    ${filters}
    <div class="pl-layout">
      <div class="board pl-board">
        ${PIPELINE_COLUMNS.map((c) => html`<${PipelineColumn} key=${c.kind} col=${c} items=${byKind[c.kind]} draggable=${true} viewer=${person} />`)}
      </div>
      <aside class="pl-aside" aria-label="Aktivitäten">${lists}</aside>
    </div>
  </div>`
}

// ------------------------------------------------------------
// Neue Aufgabe aus der Pipeline: für mich oder für jemand anderen (vergeben)
// ------------------------------------------------------------
function NewTaskDialog({ d }) {
  const members = activeMembers()
  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState(() => {
    const p = activeProjects().find((x) => x.name === 'Allgemein') || activeProjects()[0]
    return p ? p.id : ''
  })
  const [assignee, setAssignee] = useState(d.person || norm(myEmail()))
  const [due, setDue] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    if (!title.trim() || busy) return
    setBusy(true)
    const card = await createCard({ title: title.trim(), project_id: projectId || null, assignee, due_date: due || null, kind: 'todo' })
    setBusy(false)
    if (!card) return
    closeDialog()
    const project = getProject(card.project_id)
    toast(norm(assignee) === norm(myEmail()) ? `In ${project ? project.name : 'deiner Pipeline'} angelegt` : `An ${memberName(assignee)} vergeben`, {
      action: { label: 'Öffnen', run: () => openCard(card.id) },
    })
  }
  return html`<${Modal} title="Neuer Deal" onClose=${closeDialog}>
    <form class="form" onSubmit=${submit}>
      <${Field} label="Titel" htmlFor="pl-title">
        <input id="pl-title" value=${title} required maxlength="300" autofocus onInput=${(e) => setTitle(e.target.value)} />
      <//>
      <${Field} label="Zuständig" htmlFor="pl-who">
        <select id="pl-who" value=${assignee} onChange=${(e) => setAssignee(e.target.value)}>
          ${members.map((t) => html`<option value=${norm(t.email)}>${norm(t.email) === norm(myEmail()) ? 'Ich' : t.name}</option>`)}
        </select>
      <//>
      <div class="field-grid">
        <${Field} label="Pipeline" htmlFor="pl-project">
          <${ProjectSelect} id="pl-project" value=${projectId} onChange=${setProjectId} />
        <//>
        <${Field} label="Fällig am" htmlFor="pl-due">
          <input id="pl-due" type="date" value=${due} onInput=${(e) => setDue(e.target.value)} />
        <//>
      </div>
      <p class="muted small">Weitere Zuständige, Checkliste und Aktivitäten trägst du danach im Deal ein.</p>
      <div class="form-actions">
        <button type="button" class="btn" onClick=${closeDialog}>Abbrechen</button>
        <button type="submit" class="btn btn-primary" disabled=${!title.trim() || busy}>${norm(assignee) === norm(myEmail()) ? 'Anlegen' : 'Vergeben'}</button>
      </div>
    </form>
  <//>`
}
dialogKinds['pipeline-new'] = NewTaskDialog
