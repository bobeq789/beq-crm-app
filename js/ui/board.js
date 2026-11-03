// Board pro Projekt: Spalten nebeneinander (Rechner) oder als Reiter (Handy), Drag & Drop, Suche, Filter
import { html, useState, useEffect, useRef } from '../lib/preact.js'
import { Icon } from '../lib/icons.js'
import { SETTINGS } from '../settings.js'
import { matches, local } from '../lib/util.js'
import {
  state,
  activeProjects,
  stagesOf,
  getProject,
  getPerson,
  getOrg,
  update,
  insert,
  remove,
  createCard,
  createProject,
  myEmail,
  openDialog,
  closeDialog,
  confirmDialog,
  promptDialog,
  toast,
  notesFor,
  sharesOf,
  allLabels,
  isOpen,
} from '../store.js'
import { navigate, openCard } from '../router.js'
import { PageHead, Dot, Avatar, PrioBadge, DueBadge, Modal, Field, Empty, dialogKinds, useIsMobile } from './common.js'

const DONE_LIMIT = 15

function BoardCard({ card, draggable }) {
  const person = getPerson(card.person_id)
  const org = getOrg(card.org_id)
  const noteCount = notesFor('card_id', card.id).length
  const isDone = state.db.stages.find((s) => s.id === card.stage_id)?.kind === 'done'
  return html`<li
    class="board-card"
    draggable=${draggable}
    onDragStart=${(e) => {
      e.dataTransfer.setData('text/plain', card.id)
      e.dataTransfer.effectAllowed = 'move'
      e.currentTarget.classList.add('dragging')
    }}
    onDragEnd=${(e) => e.currentTarget.classList.remove('dragging')}
  >
    <button type="button" class="board-card-btn" onClick=${() => openCard(card.id)}>
      <span class="bc-title">${card.title}</span>
      ${(person || org) && html`<span class="bc-sub">${[person && person.name, org && org.name].filter(Boolean).join(' · ')}</span>`}
      <span class="bc-meta">
        ${card.assignee && html`<${Avatar} email=${card.assignee} />`}
        <${PrioBadge} priority=${card.priority} />
        <${DueBadge} due=${card.due_date} done=${isDone} />
        ${sharesOf(card.id).length > 0 && html`<span class="bc-notes" title="Mit einem Gast geteilt"><${Icon} name="share" size=${14} /></span>`}
        ${noteCount > 0 && html`<span class="bc-notes" title=${noteCount + (noteCount === 1 ? ' Notiz' : ' Notizen')}><${Icon} name="note" size=${14} />${noteCount}</span>`}
        ${card.archived && html`<span class="badge">Archiv</span>`}
      </span>
    </button>
  </li>`
}

function InlineAdd({ onAdd, onCancel }) {
  const [title, setTitle] = useState('')
  const ref = useRef()
  useEffect(() => ref.current && ref.current.focus(), [])
  return html`<form
    class="inline-card-add"
    onSubmit=${(e) => {
      e.preventDefault()
      if (title.trim()) {
        onAdd(title.trim())
        setTitle('')
      }
    }}
  >
    <input
      ref=${ref}
      value=${title}
      placeholder="Titel der Aufgabe"
      aria-label="Titel der neuen Aufgabe"
      onInput=${(e) => setTitle(e.target.value)}
      onKeyDown=${(e) => e.key === 'Escape' && onCancel()}
    />
    <div class="form-actions">
      <button type="button" class="btn" onClick=${onCancel}>Abbrechen</button>
      <button type="submit" class="btn btn-primary" disabled=${!title.trim()}>Anlegen</button>
    </div>
  </form>`
}

function Column({ stage, cards, onDropCard, onAdd, draggable }) {
  const [over, setOver] = useState(false)
  const [adding, setAdding] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const isDone = stage.kind === 'done'
  const shown = isDone && !showAll ? cards.slice(0, DONE_LIMIT) : cards
  return html`<section
    class=${'column' + (over ? ' drop-over' : '')}
    onDragOver=${(e) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (!over) setOver(true)
    }}
    onDragLeave=${(e) => !e.currentTarget.contains(e.relatedTarget) && setOver(false)}
    onDrop=${(e) => {
      e.preventDefault()
      setOver(false)
      const id = e.dataTransfer.getData('text/plain')
      if (id) onDropCard(id, stage.id)
    }}
  >
    <div class="column-head">
      <h2 class="column-title">${stage.name} <span class="count">${cards.length}</span></h2>
      <button type="button" class="icon-btn small" aria-label=${'Neue Aufgabe in „' + stage.name + '“'} onClick=${() => setAdding(true)}>
        <${Icon} name="plus" size=${18} />
      </button>
    </div>
    ${adding &&
    html`<${InlineAdd}
      onAdd=${(t) => {
        onAdd(t, stage.id)
        setAdding(false)
      }}
      onCancel=${() => setAdding(false)}
    />`}
    <ul class="column-cards">
      ${shown.map((c) => html`<${BoardCard} card=${c} key=${c.id} draggable=${draggable} />`)}
    </ul>
    ${isDone &&
    cards.length > DONE_LIMIT &&
    html`<button type="button" class="link-btn" onClick=${() => setShowAll(!showAll)}>
      ${showAll ? 'Weniger anzeigen' : `Alle ${cards.length} anzeigen`}
    </button>`}
    ${!cards.length && !adding && html`<p class="column-empty">Keine Aufgaben</p>`}
  </section>`
}

export function Board({ projectId }) {
  const mobile = useIsMobile()
  const projects = activeProjects()
  const remembered = local.get('beqcrm-last-project')
  const current =
    getProject(projectId) ||
    (remembered && projects.find((p) => p.id === remembered)) ||
    projects[0] ||
    null
  const [query, setQuery] = useState('')
  const [assignee, setAssignee] = useState('')
  const [label, setLabel] = useState('')
  const [archive, setArchive] = useState(false)
  const [mobileStage, setMobileStage] = useState(null)

  useEffect(() => {
    if (current) local.set('beqcrm-last-project', current.id)
  }, [current && current.id])

  if (!current) {
    return html`<div class="page"><${PageHead} kicker="Board" title="Noch kein Projekt" />
      <button type="button" class="btn btn-primary" onClick=${newProject}><${Icon} name="plus" size=${18} /> Projekt anlegen</button></div>`
  }

  const stages = stagesOf(current.id)
  const filtered = state.db.cards.filter((c) => {
    if (c.project_id !== current.id) return false
    if (archive ? !c.archived : c.archived) return false
    if (assignee === '__none' && c.assignee) return false
    if (assignee && assignee !== '__none' && (c.assignee || '').toLowerCase() !== assignee.toLowerCase()) return false
    if (label) {
      const person = getPerson(c.person_id)
      const org = getOrg(c.org_id)
      const labels = [...((person && person.labels) || []), ...((org && org.labels) || [])]
      if (!labels.includes(label)) return false
    }
    if (query.trim()) {
      const person = getPerson(c.person_id)
      const org = getOrg(c.org_id)
      if (!matches(query, c.title, person && person.name, org && org.name)) return false
    }
    return true
  })
  const cardsOf = (stage) =>
    filtered
      .filter((c) => c.stage_id === stage.id)
      .sort((a, b) =>
        stage.kind === 'done'
          ? String(b.stage_changed_at).localeCompare(String(a.stage_changed_at))
          : String(b.updated_at).localeCompare(String(a.updated_at))
      )

  const moveCard = (cardId, stageId) => {
    const card = state.db.cards.find((c) => c.id === cardId)
    if (card && card.stage_id !== stageId) update('cards', cardId, { stage_id: stageId })
  }
  const addCard = (title, stageId) =>
    createCard({
      title,
      project_id: current.id,
      stage_id: stageId,
      assignee: assignee && assignee !== '__none' ? assignee : myEmail(),
    })

  const activeStage = stages.find((s) => s.id === mobileStage) || stages[0]

  return html`<div class="page page-board">
    <${PageHead} kicker="Board" title=${current.name} />
    <div class="project-tabs" role="tablist" aria-label="Projekte">
      ${projects.map(
        (p) => html`<button
          type="button"
          role="tab"
          aria-selected=${p.id === current.id}
          class=${'tab' + (p.id === current.id ? ' active' : '')}
          onClick=${() => navigate('/board/' + p.id)}
        >
          <${Dot} color=${p.color} />${p.name}
          <span class="count">${state.db.cards.filter((c) => c.project_id === p.id && isOpen(c)).length}</span>
        </button>`
      )}
      <button type="button" class="tab tab-icon" aria-label="Neues Projekt" title="Neues Projekt" onClick=${newProject}><${Icon} name="plus" size=${18} /></button>
      <button
        type="button"
        class="tab tab-icon"
        aria-label="Projekt-Einstellungen"
        title="Projekt-Einstellungen"
        onClick=${() => openDialog({ kind: 'project-settings', projectId: current.id })}
      >
        <${Icon} name="gear" size=${18} />
      </button>
    </div>

    <div class="board-filters">
      <label class="search">
        <${Icon} name="search" size=${18} />
        <input type="search" value=${query} placeholder="Suchen: Titel, Kontakt, Firma" aria-label="Board durchsuchen" onInput=${(e) => setQuery(e.target.value)} />
      </label>
      <select value=${assignee} aria-label="Zuständig" onChange=${(e) => setAssignee(e.target.value)}>
        <option value="">Alle Zuständigen</option>
        <option value="__none">Niemand zuständig</option>
        ${state.db.team_members
          .filter((t) => t.active)
          .map((t) => html`<option value=${t.email}>${t.name}</option>`)}
      </select>
      <select value=${label} aria-label="Label" onChange=${(e) => setLabel(e.target.value)}>
        <option value="">Alle Labels</option>
        ${allLabels().map((l) => html`<option value=${l}>${l}</option>`)}
      </select>
      <button type="button" class=${'chip-btn' + (archive ? ' active' : '')} aria-pressed=${archive} onClick=${() => setArchive(!archive)}>
        <${Icon} name="archive" size=${16} /> Archiv
      </button>
    </div>

    ${mobile
      ? html`<div class="stage-tabs" role="tablist" aria-label="Spalten">
            ${stages.map(
              (s) => html`<button
                type="button"
                role="tab"
                aria-selected=${s.id === activeStage.id}
                class=${'tab' + (s.id === activeStage.id ? ' active' : '')}
                onClick=${() => setMobileStage(s.id)}
              >
                ${s.name} <span class="count">${cardsOf(s).length}</span>
              </button>`
            )}
          </div>
          ${activeStage &&
          html`<div class="board-mobile">
            <${Column} stage=${activeStage} cards=${cardsOf(activeStage)} onDropCard=${moveCard} onAdd=${addCard} draggable=${false} key=${activeStage.id} />
          </div>`}
          <button
            type="button"
            class="fab"
            aria-label="Neue Aufgabe"
            onClick=${async () => {
              const title = await promptDialog({ title: 'Neue Aufgabe', label: 'Titel', confirmLabel: 'Anlegen' })
              if (title) {
                const card = await addCard(title, activeStage.id)
                if (card) openCard(card.id)
              }
            }}
          >
            <${Icon} name="plus" size=${26} />
          </button>`
      : html`<div class="board">
          ${stages.map((s) => html`<${Column} stage=${s} cards=${cardsOf(s)} onDropCard=${moveCard} onAdd=${addCard} draggable=${true} key=${s.id} />`)}
        </div>`}
    ${archive && !filtered.length && html`<${Empty}>Im Archiv dieses Projekts liegt nichts.<//>`}
  </div>`
}

async function newProject() {
  const name = await promptDialog({ title: 'Neues Projekt', label: 'Name des Projekts', confirmLabel: 'Anlegen' })
  if (!name) return
  const p = await createProject(name)
  if (p) navigate('/board/' + p.id)
}

// ------------------------------------------------------------
// Projekt-Einstellungen: Name, Farbe, Archiv, Spalten
// ------------------------------------------------------------
function StageRow({ stage, index, total, onMove, cardCount }) {
  const [name, setName] = useState(stage.name)
  useEffect(() => setName(stage.name), [stage.name])
  const isDone = stage.kind === 'done'
  return html`<li class="stage-row">
    <input
      value=${name}
      aria-label="Name der Spalte"
      onInput=${(e) => setName(e.target.value)}
      onBlur=${() => name.trim() && name.trim() !== stage.name && update('stages', stage.id, { name: name.trim() })}
      onKeyDown=${(e) => e.key === 'Enter' && e.target.blur()}
    />
    ${isDone
      ? html`<span class="stage-kind-fixed" title="Jedes Projekt hat genau eine Spalte der Art „Erledigt“">Erledigt</span>`
      : html`<select value=${stage.kind} aria-label="Art der Spalte" onChange=${(e) => update('stages', stage.id, { kind: e.target.value })}>
          ${SETTINGS.stageKinds.filter((k) => k.value !== 'done').map((k) => html`<option value=${k.value}>${k.label}</option>`)}
        </select>`}
    <div class="stage-buttons">
      <button type="button" class="icon-btn small" aria-label="Nach oben" disabled=${index === 0} onClick=${() => onMove(index, -1)}><${Icon} name="up" size=${16} /></button>
      <button type="button" class="icon-btn small" aria-label="Nach unten" disabled=${index === total - 1} onClick=${() => onMove(index, 1)}><${Icon} name="down" size=${16} /></button>
      <button
        type="button"
        class="icon-btn small"
        aria-label="Spalte löschen"
        title=${isDone ? 'Die Spalte „Erledigt“ bleibt immer' : cardCount ? 'Nur leere Spalten lassen sich löschen' : 'Spalte löschen'}
        disabled=${isDone || cardCount > 0}
        onClick=${async () => {
          if (await confirmDialog({ title: `Spalte „${stage.name}“ löschen?`, confirmLabel: 'Löschen', danger: true })) remove('stages', stage.id)
        }}
      >
        <${Icon} name="trash" size=${16} />
      </button>
    </div>
  </li>`
}

function ProjectSettings({ d }) {
  const project = getProject(d.projectId)
  const [name, setName] = useState(project ? project.name : '')
  if (!project) return null
  const stages = stagesOf(project.id)
  const archived = state.db.projects.filter((p) => p.archived)
  const close = () => closeDialog()

  const move = async (index, dir) => {
    const a = stages[index]
    const b = stages[index + dir]
    if (!a || !b) return
    // Reihenfolge neu durchnummerieren, dann die beiden tauschen
    const order = stages.map((s) => s.id)
    order[index] = b.id
    order[index + dir] = a.id
    for (const [i, id] of order.entries()) {
      const s = stages.find((x) => x.id === id)
      if (s.sort !== i + 1) await update('stages', id, { sort: i + 1 })
    }
  }
  const addStage = async () => {
    const sort = Math.max(0, ...stages.map((s) => s.sort)) + 1
    await insert('stages', { project_id: project.id, name: 'Neue Spalte', kind: 'todo', sort })
  }
  const archiveProject = async () => {
    const ok = await confirmDialog({
      title: `Projekt „${project.name}“ archivieren?`,
      text: 'Das Projekt verschwindet aus den Reitern. Aufgaben und Spalten bleiben erhalten, du kannst es hier jederzeit wiederherstellen.',
      confirmLabel: 'Archivieren',
    })
    if (!ok) return
    await update('projects', project.id, { archived: true })
    toast(`„${project.name}“ archiviert`)
    navigate('/board')
  }

  return html`<${Modal} title="Projekt-Einstellungen" onClose=${close} wide=${true}>
    <${Field} label="Name" htmlFor="project-name">
      <input
        id="project-name"
        value=${name}
        onInput=${(e) => setName(e.target.value)}
        onBlur=${() => name.trim() && name.trim() !== project.name && update('projects', project.id, { name: name.trim() })}
        onKeyDown=${(e) => e.key === 'Enter' && e.target.blur()}
      />
    <//>
    <${Field} label="Farbe">
      <div class="swatches" role="radiogroup" aria-label="Farbe">
        ${SETTINGS.projectColors.map(
          (c) => html`<button
            type="button"
            role="radio"
            aria-checked=${project.color === c.value}
            class=${'swatch' + (project.color === c.value ? ' active' : '')}
            title=${c.label}
            aria-label=${c.label}
            onClick=${() => update('projects', project.id, { color: c.value })}
          >
            <${Dot} color=${c.value} />
          </button>`
        )}
      </div>
    <//>
    <h3 class="section-title">Spalten</h3>
    <p class="muted small">Die Art bestimmt, wo Aufgaben in der Übersicht erscheinen. Namen kannst du frei wählen.</p>
    <ul class="stage-list">
      ${stages.map(
        (s, i) =>
          html`<${StageRow}
            key=${s.id}
            stage=${s}
            index=${i}
            total=${stages.length}
            onMove=${move}
            cardCount=${state.db.cards.filter((c) => c.stage_id === s.id).length}
          />`
      )}
    </ul>
    <button type="button" class="btn" onClick=${addStage}><${Icon} name="plus" size=${16} /> Spalte hinzufügen</button>

    <div class="settings-foot">
      <button type="button" class="btn" onClick=${archiveProject}><${Icon} name="archive" size=${16} /> Projekt archivieren</button>
    </div>
    ${archived.length > 0 &&
    html`<div class="archived-projects">
      <h3 class="section-title">Archivierte Projekte</h3>
      <ul>
        ${archived.map(
          (p) => html`<li>
            <span><${Dot} color=${p.color} />${p.name}</span>
            <button
              type="button"
              class="link-btn"
              onClick=${async () => {
                await update('projects', p.id, { archived: false })
                toast(`„${p.name}“ wiederhergestellt`)
              }}
            >
              Wiederherstellen
            </button>
          </li>`
        )}
      </ul>
    </div>`}
  <//>`
}

dialogKinds['project-settings'] = ProjectSettings
