// Board pro Projekt: Spalten nebeneinander (Rechner) oder als Reiter (Handy), Drag & Drop, Suche, Filter
import { html, useState, useEffect, useRef } from '../lib/preact.js'
import { Icon } from '../lib/icons.js'
import { SETTINGS } from '../settings.js'
import { matches, local, fmtEuro } from '../lib/util.js'
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
  assignedToOther,
  activeGuests,
  projectSharesOf,
  dealOf,
  isGuest,
  addStage,
  moveStage,
  canMoveStage,
  deleteStage,
  countStageCards,
  lastOfKindHint,
} from '../store.js'
import { navigate, openCard } from '../router.js'
import { PageHead, Dot, Avatar, PrioBadge, DueBadge, NewBadge, Modal, Field, Empty, Labels, dialogKinds, useIsMobile } from './common.js'

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
      ${(card.labels || []).length > 0 && html`<span class="bc-labels"><${Labels} labels=${card.labels} /></span>`}
      <span class="bc-meta">
        <${NewBadge} cardId=${card.id} />
        ${assignedToOther(card) && html`<${Avatar} email=${card.assignee} />`}
        <${PrioBadge} priority=${card.priority} />
        <${DueBadge} due=${card.due_date} done=${isDone} />
        ${sharesOf(card.id).length > 0 && html`<span class="bc-notes" title="Mit einem Gast geteilt"><${Icon} name="share" size=${14} /></span>`}
        ${noteCount > 0 && html`<span class="bc-notes" title=${noteCount + (noteCount === 1 ? ' Notiz' : ' Notizen')}><${Icon} name="note" size=${14} />${noteCount}</span>`}
        ${card.archived && html`<span class="badge">Archiv</span>`}
        <${DealBadge} card=${card} />
      </span>
    </button>
  </li>`
}

// Wert des Deals auf der Karte (nur wenn ich die Zahlen sehen darf, sonst gibt es ihn hier nicht)
function DealBadge({ card }) {
  const deal = dealOf(card.id)
  if (!deal) return null
  const cls = deal.status === 'gewonnen' ? ' deal-won' : deal.status === 'verloren' ? ' deal-lost' : ''
  const label = deal.status === 'offen' ? '' : deal.status === 'gewonnen' ? ' gewonnen' : ' verloren'
  return html`<span class=${'badge deal-badge' + cls} title=${'Deal' + label}>${fmtEuro(deal.value_cents)}${label}</span>`
}

// Summe der offenen und gewonnenen Deals einer Spalte
function columnValue(cards) {
  return cards.reduce((sum, c) => {
    const d = dealOf(c.id)
    return d && d.status !== 'verloren' ? sum + Number(d.value_cents || 0) : sum
  }, 0)
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

// ------------------------------------------------------------
// Spalten direkt im Board (Gesamtprompt Fassung 6, B3)
// ------------------------------------------------------------

// Name einer Spalte direkt im Kopf ändern. Der Name steht im Zustand, damit ein Neuzeichnen (etwa
// nach dem Nachladen der Daten) den getippten Text nicht zurücksetzt. Enter speichert sofort,
// Verlassen des Felds auch, Escape bricht ab, leer speichert nichts. Der Merker verhindert, dass
// Enter und das danach folgende Verlassen des Felds doppelt speichern.
function StageNameInput({ stage, onDone }) {
  const [name, setName] = useState(stage.name)
  const ref = useRef()
  const finished = useRef(false)
  useEffect(() => {
    if (ref.current) {
      ref.current.focus()
      ref.current.select()
    }
  }, [])
  const finish = async (save) => {
    if (finished.current) return
    finished.current = true
    const n = name.trim()
    onDone()
    if (save && n && n !== stage.name) await update('stages', stage.id, { name: n })
  }
  return html`<input
    ref=${ref}
    class="column-rename"
    value=${name}
    maxlength="60"
    aria-label="Name der Spalte"
    onInput=${(e) => setName(e.target.value)}
    onKeyDown=${(e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        finish(true)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        finish(false)
      }
    }}
    onBlur=${() => finish(true)}
  />`
}

// Menü je Spalte (drei Punkte, am Handy „Spalte bearbeiten“). Gäste sehen es nie.
// „Erledigt“ hat nur Umbenennen und „Neue Spalte davor“ und bleibt immer hinten.
// Das Menü liegt fest über der Seite (am Knopf ausgerichtet), damit der waagrecht scrollbare
// Bereich der Spalten es nicht abschneidet. Beim Scrollen oder Ändern der Fenstergröße geht es zu.
const MENU_WIDTH = 240
function StageMenu({ stage, onRename, onAddAt, label = '' }) {
  const [pos, setPos] = useState(null)
  const open = !!pos
  const ref = useRef()
  const btn = useRef()
  const close = () => setPos(null)
  const toggle = () => {
    if (open) return close()
    const r = btn.current.getBoundingClientRect()
    setPos({ top: Math.round(r.bottom + 4), left: Math.round(Math.max(8, Math.min(r.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8))) })
  }
  useEffect(() => {
    if (!open) return
    const away = (e) => ref.current && !ref.current.contains(e.target) && close()
    const esc = (e) => e.key === 'Escape' && close()
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', esc)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])
  const index = stagesOf(stage.project_id).findIndex((s) => s.id === stage.id)
  const isDone = stage.kind === 'done'
  const run = (fn) => () => {
    close()
    fn()
  }
  return html`<span class="stage-menu-wrap" ref=${ref}>
    <button
      type="button"
      ref=${btn}
      class=${label ? 'btn btn-small' : 'icon-btn small'}
      aria-haspopup="menu"
      aria-expanded=${open}
      aria-label=${'Spalte „' + stage.name + '“ bearbeiten'}
      title="Spalte bearbeiten"
      onClick=${toggle}
    >
      ${label ? html`<${Icon} name="edit" size=${16} /> ${label}` : html`<${Icon} name="more" size=${18} />`}
    </button>
    ${open &&
    html`<div class="stage-menu" role="menu" style=${{ top: pos.top + 'px', left: pos.left + 'px', width: MENU_WIDTH + 'px' }}>
      <button type="button" role="menuitem" onClick=${run(onRename)}><${Icon} name="edit" size=${16} /> Umbenennen</button>
      ${isDone
        ? html`<button type="button" role="menuitem" onClick=${run(() => onAddAt(index))}><${Icon} name="plus" size=${16} /> Neue Spalte davor</button>
            <p class="stage-menu-note">Die Spalte für Erledigtes bleibt immer.</p>`
        : html`<button type="button" role="menuitem" disabled=${!canMoveStage(stage.id, -1)} onClick=${run(() => moveStage(stage.id, -1))}>
              <${Icon} name="back" size=${16} /> Nach links
            </button>
            <button type="button" role="menuitem" disabled=${!canMoveStage(stage.id, 1)} onClick=${run(() => moveStage(stage.id, 1))}>
              <${Icon} name="chevron" size=${16} /> Nach rechts
            </button>
            <button type="button" role="menuitem" onClick=${run(() => onAddAt(index + 1))}><${Icon} name="plus" size=${16} /> Neue Spalte rechts daneben</button>
            <button type="button" role="menuitem" class="danger" onClick=${run(() => askDeleteStage(stage))}><${Icon} name="trash" size=${16} /> Spalte löschen</button>`}
    </div>`}
  </span>`
}

// Gestrichelte Spalte an der Stelle, an der die neue Spalte entsteht
function NewStageColumn({ onCreate, onCancel }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef()
  useEffect(() => ref.current && ref.current.focus(), [])
  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    await onCreate(name.trim())
    setBusy(false)
  }
  return html`<form class="column column-new" onSubmit=${submit}>
    <label class="column-new-label" for="new-stage-name">Neue Spalte</label>
    <input
      id="new-stage-name"
      ref=${ref}
      value=${name}
      maxlength="60"
      placeholder="Name der Spalte"
      onInput=${(e) => setName(e.target.value)}
      onKeyDown=${(e) => e.key === 'Escape' && onCancel()}
    />
    <div class="form-actions">
      <button type="button" class="btn" onClick=${onCancel}>Abbrechen</button>
      <button type="submit" class="btn btn-primary" disabled=${!name.trim() || busy}>Anlegen</button>
    </div>
  </form>`
}

function Column({ stage, cards, onDropCard, onAdd, draggable, canEdit, renaming, onRename, onRenameDone, onAddAt }) {
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
      ${renaming
        ? html`<${StageNameInput} stage=${stage} onDone=${onRenameDone} />`
        : html`<h2 class="column-title">
              ${canEdit ? html`<button type="button" class="column-name" title="Klicken zum Umbenennen" onClick=${onRename}>${stage.name}</button>` : stage.name}
              <span class="count">${cards.length}</span>
              ${columnValue(cards) > 0 && html`<span class="column-value" title="Summe der Deals in dieser Spalte (netto, ohne verlorene)">${fmtEuro(columnValue(cards))}</span>`}
            </h2>
            <span class="column-actions">
              ${canEdit && html`<${StageMenu} stage=${stage} onRename=${onRename} onAddAt=${onAddAt} />`}
              <button type="button" class="icon-btn small" aria-label=${'Neue Aufgabe in „' + stage.name + '“'} onClick=${() => setAdding(true)}>
                <${Icon} name="plus" size=${18} />
              </button>
            </span>`}
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
  const [renaming, setRenaming] = useState(null)
  const [addingAt, setAddingAt] = useState(null)

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
      const labels = [...(c.labels || []), ...((person && person.labels) || []), ...((org && org.labels) || [])]
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
  const canEdit = !isGuest()
  const doneIndex = stages.findIndex((s) => s.kind === 'done')
  const beforeDone = doneIndex < 0 ? stages.length : doneIndex
  const createStage = async (name) => {
    const stage = await addStage(current.id, name, addingAt)
    if (stage) {
      setAddingAt(null)
      if (mobile) setMobileStage(stage.id)
    }
  }
  const columnProps = (s) => ({
    stage: s,
    cards: cardsOf(s),
    onDropCard: moveCard,
    onAdd: addCard,
    canEdit,
    renaming: renaming === s.id,
    onRename: () => setRenaming(s.id),
    onRenameDone: () => setRenaming(null),
    onAddAt: (i) => {
      setRenaming(null)
      setAddingAt(i)
    },
  })
  const placeholder = html`<${NewStageColumn} key="neue-spalte" onCreate=${createStage} onCancel=${() => setAddingAt(null)} />`
  const desktopColumns = []
  stages.forEach((s, i) => {
    if (addingAt === i) desktopColumns.push(placeholder)
    desktopColumns.push(html`<${Column} ...${columnProps(s)} draggable=${true} key=${s.id} />`)
  })
  if (addingAt !== null && addingAt >= stages.length) desktopColumns.push(placeholder)

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
          ${projectSharesOf(p.id).length > 0 &&
          html`<span class="tab-shared" title="Mit Gästen geteilt" aria-label="mit Gästen geteilt"><${Icon} name="users" size=${15} /></span>`}
          <span class="count">${state.db.cards.filter((c) => c.project_id === p.id && isOpen(c)).length}</span>
        </button>`
      )}
      <button type="button" class="tab tab-icon" aria-label="Neues Projekt" title="Neues Projekt" onClick=${newProject}><${Icon} name="plus" size=${18} /></button>
      <button
        type="button"
        class="tab tab-icon"
        aria-label="Projekt teilen"
        title="Projekt teilen"
        onClick=${() => openDialog({ kind: 'project-share', projectId: current.id })}
      >
        <${Icon} name="share" size=${18} />
      </button>
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
                title=${canEdit && s.id === activeStage.id ? 'Noch einmal antippen zum Umbenennen' : undefined}
                onClick=${() => {
                  setAddingAt(null)
                  // Den gewählten Reiter noch einmal antippen benennt die Spalte um
                  if (canEdit && s.id === activeStage.id) setRenaming(s.id)
                  else setMobileStage(s.id)
                }}
              >
                ${s.name} <span class="count">${cardsOf(s).length}</span>
              </button>`
            )}
            ${!isGuest() &&
            html`<button type="button" class="tab tab-icon" aria-label="Spalte hinzufügen" title="Spalte hinzufügen" onClick=${() => setAddingAt(beforeDone)}>
              <${Icon} name="plus" size=${18} />
            </button>`}
          </div>
          ${canEdit &&
          activeStage &&
          addingAt === null &&
          html`<div class="stage-tools">
            <${StageMenu} stage=${activeStage} label="Spalte bearbeiten" onRename=${() => setRenaming(activeStage.id)} onAddAt=${(i) => setAddingAt(i)} />
          </div>`}
          ${addingAt !== null
            ? html`<div class="board-mobile">${placeholder}</div>`
            : activeStage &&
              html`<div class="board-mobile">
                <${Column} ...${columnProps(activeStage)} draggable=${false} key=${activeStage.id} />
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
          ${desktopColumns}
          ${canEdit &&
          addingAt === null &&
          html`<div class="column-add">
            <button type="button" class="btn" onClick=${() => setAddingAt(beforeDone)}><${Icon} name="plus" size=${16} /> Spalte</button>
          </div>`}
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
function StageRow({ stage }) {
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
    <label class="stage-prob" title="Wahrscheinlichkeit für neue Deals in dieser Spalte (Sales)">
      <input
        type="number"
        min="0"
        max="100"
        step="5"
        inputmode="numeric"
        aria-label=${'Wahrscheinlichkeit in Prozent für „' + stage.name + '“'}
        placeholder="%"
        value=${stage.probability ?? ''}
        onChange=${(e) => {
          const v = e.target.value === '' ? null : Math.max(0, Math.min(100, Math.round(Number(e.target.value))))
          update('stages', stage.id, { probability: Number.isFinite(v) ? v : null })
        }}
      />
      <span>%</span>
    </label>
    <div class="stage-buttons">
      <button type="button" class="icon-btn small" aria-label="Nach oben" disabled=${!canMoveStage(stage.id, -1)} onClick=${() => moveStage(stage.id, -1)}><${Icon} name="up" size=${16} /></button>
      <button type="button" class="icon-btn small" aria-label="Nach unten" disabled=${!canMoveStage(stage.id, 1)} onClick=${() => moveStage(stage.id, 1)}><${Icon} name="down" size=${16} /></button>
      <button
        type="button"
        class="icon-btn small"
        aria-label="Spalte löschen"
        title=${isDone ? 'Die Spalte „Erledigt“ bleibt immer' : 'Spalte löschen'}
        disabled=${isDone}
        onClick=${() => askDeleteStage(stage)}
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
    <p class="muted small">Die Art bestimmt, wo Aufgaben in der Übersicht erscheinen. Namen kannst du frei wählen. Die Prozentzahl ist die Wahrscheinlichkeit für Deals in dieser Spalte (für die gewichtete Pipeline in „Sales“), leer heißt ohne.</p>
    <ul class="stage-list">
      ${stages.map((s) => html`<${StageRow} key=${s.id} stage=${s} />`)}
    </ul>
    <button type="button" class="btn" onClick=${() => askAddStage(project.id)}><${Icon} name="plus" size=${16} /> Spalte hinzufügen</button>

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

// ------------------------------------------------------------
// Spalten direkt im Board: anlegen, bearbeiten, löschen
// ------------------------------------------------------------
async function askAddStage(projectId, onCreated) {
  const name = await promptDialog({ title: 'Neue Spalte', label: 'Name der Spalte', confirmLabel: 'Anlegen' })
  if (!name || !name.trim()) return
  const stage = await addStage(projectId, name)
  if (stage && onCreated) onCreated(stage.id)
}

// Löschen: Aufgaben direkt in der Datenbank zählen (auch archivierte). Leere Spalte mit
// einfacher Rückfrage, sonst wählen, wohin die Aufgaben sollen. Ist es die letzte Spalte ihrer
// Art, steht das in der Rückfrage.
async function askDeleteStage(stage) {
  if (stage.kind === 'done') return
  const counted = await countStageCards(stage.id)
  if (!counted) return
  if (!counted.total) {
    const ok = await confirmDialog({
      title: `Spalte „${stage.name}“ löschen?`,
      text: lastOfKindHint(stage) || 'Die Spalte ist leer.',
      confirmLabel: 'Löschen',
      danger: true,
    })
    if (ok) await deleteStage(stage.id)
    return
  }
  openDialog({ kind: 'stage-delete', stageId: stage.id, total: counted.total, archived: counted.archived })
}

// Spalte mit Aufgaben löschen: erst sagen, wohin die Aufgaben sollen. Zeigt keine Deal-Werte.
function StageDelete({ d }) {
  const stage = state.db.stages.find((s) => s.id === d.stageId)
  const others = stage ? stagesOf(stage.project_id).filter((s) => s.id !== stage.id) : []
  const preferred = others.find((s) => s.kind === stage?.kind) || others.find((s) => s.kind === 'todo') || others[0]
  const [target, setTarget] = useState(preferred ? preferred.id : '')
  const [busy, setBusy] = useState(false)
  if (!stage) return null
  const total = d.total || 0
  const archived = d.archived || 0
  const hint = lastOfKindHint(stage)
  const close = () => closeDialog()
  const run = async () => {
    setBusy(true)
    const ok = await deleteStage(stage.id, target)
    setBusy(false)
    if (ok) close()
  }
  return html`<${Modal}
    title=${`Spalte „${stage.name}“ löschen?`}
    onClose=${close}
    footer=${html`<button type="button" class="btn" onClick=${close}>Abbrechen</button>
      <button type="button" class="btn btn-danger" disabled=${!target || busy} onClick=${run}>${busy ? 'Einen Moment …' : 'Verschieben und Spalte löschen'}</button>`}
  >
    <p>
      In „${stage.name}“ ${total === 1 ? 'liegt noch 1 Aufgabe' : `liegen noch ${total} Aufgaben`}${archived ? `, davon ${archived} archiviert` : ''}. Wohin sollen sie?
    </p>
    ${hint && html`<p class="muted small">${hint}</p>`}
    <${Field} label="Verschieben nach" htmlFor="stage-target">
      <select id="stage-target" value=${target} onChange=${(e) => setTarget(e.target.value)}>
        ${others.map((s) => html`<option value=${s.id}>${s.name}</option>`)}
      </select>
    <//>
  <//>`
}
dialogKinds['stage-delete'] = StageDelete

// Ganzes Projekt mit Gästen teilen: Gäste als Knöpfe, vor dem Teilen eine Rückfrage.
// Es gibt nur ein Fenster auf einmal, deshalb geht dieses nach der Rückfrage wieder auf.
function ProjectShare({ d }) {
  const project = getProject(d.projectId)
  if (!project) return null
  const guests = activeGuests()
  const shares = projectSharesOf(project.id)
  const reopen = () => openDialog({ kind: 'project-share', projectId: project.id })
  const toggle = async (g) => {
    const existing = shares.find((s) => s.email.toLowerCase() === g.email.toLowerCase())
    if (existing) {
      const ok = await confirmDialog({
        title: `Freigabe für ${g.name} aufheben?`,
        text: `${g.name} sieht dann nur noch Aufgaben aus „${project.name}“, die einzeln mit ${g.name.split(' ')[0]} geteilt sind.`,
        confirmLabel: 'Aufheben',
      })
      if (ok) await remove('project_shares', existing.id)
    } else {
      const ok = await confirmDialog({
        title: `Ganzes Projekt „${project.name}“ mit ${g.name} teilen?`,
        text: `${g.name} sieht dann alle Aufgaben darin, auch neue, und kann dort selbst Aufgaben anlegen.`,
        confirmLabel: 'Teilen',
      })
      if (ok) {
        const saved = await insert('project_shares', { project_id: project.id, email: g.email.toLowerCase() })
        if (saved) toast(`${g.name} sieht jetzt das ganze Projekt „${project.name}“.`)
      }
    }
    reopen()
  }
  return html`<${Modal} title=${`„${project.name}“ teilen`} onClose=${closeDialog}>
    ${guests.length === 0
      ? html`<p class="muted">Es gibt noch keine Gäste. Ein Admin legt sie in den Einstellungen unter „Team“ mit der Rolle Gast an.</p>`
      : html`<div class="chips" role="group" aria-label="Gäste">
          ${guests.map((g) => {
            const on = shares.some((s) => s.email.toLowerCase() === g.email.toLowerCase())
            return html`<button type="button" class=${'chip-btn' + (on ? ' active' : '')} aria-pressed=${on} onClick=${() => toggle(g)}>
              ${on && html`<${Icon} name="check" size=${14} />`} ${g.name}
            </button>`
          })}
        </div>`}
    <p class="muted small share-note">
      ${shares.length
        ? 'Geteilt: Gäste sehen alle Aufgaben dieses Projekts mit Kontakt, Firma, Verlauf und Notizen und können hier selbst Aufgaben anlegen. Notizen mit „Nur intern“, Mails, Meetings und Termine bleiben verborgen.'
        : 'Einzelne Aufgaben teilst du in der Aufgabe unter „Teilen mit“. Hier gibst du das ganze Projekt frei, auch für künftige Aufgaben.'}
    </p>
  <//>`
}
dialogKinds['project-share'] = ProjectShare
