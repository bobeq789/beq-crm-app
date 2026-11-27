// Board pro Projekt: Spalten nebeneinander (Rechner) oder als Reiter (Handy), Drag & Drop, Suche, Filter
import { html, useState, useEffect, useRef } from '../lib/preact.js'
import { Icon } from '../lib/icons.js'
import { SETTINGS } from '../settings.js'
import { matches, local, fmtEuro, fmtDate, norm, firstName } from '../lib/util.js'
import {
  state,
  activeProjects,
  projectArea,
  ownWords,
  isOwnProject,
  stagesOf,
  getProject,
  getPerson,
  getOrg,
  getStage,
  memberName,
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
  answerFor,
  cardHolders,
  pinnedCards,
  isNew,
} from '../store.js'
import { navigate, openCard } from '../router.js'
import { PageHead, Dot, Avatar, PrioBadge, DueBadge, NewBadge, Modal, Field, Empty, Labels, ActivityBadge, dialogKinds, useIsMobile, Segmented } from './common.js'
import { CardTable } from './cardtable.js'
import { t, stageLabel, locale } from '../i18n.js'

const DONE_LIMIT = 15

// viewer: aus wessen Sicht (Pipeline einer anderen Person), Kürzel nur für die anderen Zuständigen.
// showProject: Projekt oben auf der Karte (Pipeline zeigt Aufgaben aus allen Projekten).
// note: kurzer Hinweis, zum Beispiel „Unteraufgabe für dich“
export function BoardCard({ card, draggable, viewer = null, showProject = false, note = null }) {
  const person = getPerson(card.person_id)
  const org = getOrg(card.org_id)
  const noteCount = notesFor('card_id', card.id).length
  const isDone = state.db.stages.find((s) => s.id === card.stage_id)?.kind === 'done'
  const project = showProject ? getProject(card.project_id) : null
  const who = norm(viewer || myEmail())
  const others = cardHolders(card).filter((e) => e !== who)
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
      ${project && html`<span class="bc-project"><${Dot} color=${project.color} />${project.name}</span>`}
      <span class="bc-title">${card.title}</span>
      ${note && html`<span class="bc-note">${note}</span>`}
      ${(person || org) && html`<span class="bc-sub">${[person && person.name, org && org.name].filter(Boolean).join(' · ')}</span>`}
      ${(card.labels || []).length > 0 && html`<span class="bc-labels"><${Labels} labels=${card.labels} /></span>`}
      <span class="bc-meta">
        ${answerFor(card.id) && html`<span class="badge badge-new" title=${t('Ein Kontakt hat geantwortet')}>${t('Antwort da')}</span>`}
        <${NewBadge} cardId=${card.id} />
        ${others.slice(0, 3).map((e) => html`<${Avatar} email=${e} key=${e} />`)}
        <${PrioBadge} priority=${card.priority} />
        <${DueBadge} due=${card.due_date} done=${isDone} />
        ${sharesOf(card.id).length > 0 && html`<span class="bc-notes" title=${t('Mit einem Gast geteilt')}><${Icon} name="share" size=${14} /></span>`}
        ${noteCount > 0 && html`<span class="bc-notes" title=${noteCount === 1 ? t('1 Notiz') : t('{n} Notizen', { n: noteCount })}><${Icon} name="note" size=${14} />${noteCount}</span>`}
        ${card.archived && html`<span class="badge">${t('Archiv')}</span>`}
        ${!isDone && html`<${ActivityBadge} cardId=${card.id} />`}
        <${DealBadge} card=${card} />
      </span>
    </button>
  </li>`
}

// Wert des Deals auf der Karte (nur wenn ich die Zahlen sehen darf, sonst gibt es ihn hier nicht)
export function DealBadge({ card }) {
  const deal = dealOf(card.id)
  if (!deal) return null
  const cls = deal.status === 'gewonnen' ? ' deal-won' : deal.status === 'verloren' ? ' deal-lost' : ''
  const label = deal.status === 'offen' ? '' : deal.status === 'gewonnen' ? ' ' + t('gewonnen') : ' ' + t('verloren')
  return html`<span class=${'badge deal-badge' + cls} title=${t('Wert') + label}>${fmtEuro(deal.value_cents)}${label}</span>`
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
      placeholder=${t('Titel des Deals')}
      aria-label=${t('Titel des neuen Deals')}
      onInput=${(e) => setTitle(e.target.value)}
      onKeyDown=${(e) => e.key === 'Escape' && onCancel()}
    />
    <div class="form-actions">
      <button type="button" class="btn" onClick=${onCancel}>${t('Abbrechen')}</button>
      <button type="submit" class="btn btn-primary" disabled=${!title.trim()}>${t('Anlegen')}</button>
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
    aria-label=${t('Name der Spalte')}
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
      aria-label=${t('Spalte „{name}“ bearbeiten', { name: stageLabel(stage.name) })}
      title=${t('Spalte bearbeiten')}
      onClick=${toggle}
    >
      ${label ? html`<${Icon} name="edit" size=${16} /> ${t(label)}` : html`<${Icon} name="more" size=${18} />`}
    </button>
    ${open &&
    html`<div class="stage-menu" role="menu" style=${{ top: pos.top + 'px', left: pos.left + 'px', width: MENU_WIDTH + 'px' }}>
      <button type="button" role="menuitem" onClick=${run(onRename)}><${Icon} name="edit" size=${16} /> ${t('Umbenennen')}</button>
      ${isDone
        ? html`<button type="button" role="menuitem" onClick=${run(() => onAddAt(index))}><${Icon} name="plus" size=${16} /> ${t('Neue Spalte davor')}</button>
            <p class="stage-menu-note">${t('Die Spalte für Erledigtes bleibt immer.')}</p>`
        : html`<button type="button" role="menuitem" disabled=${!canMoveStage(stage.id, -1)} onClick=${run(() => moveStage(stage.id, -1))}>
              <${Icon} name="back" size=${16} /> ${t('Nach links')}
            </button>
            <button type="button" role="menuitem" disabled=${!canMoveStage(stage.id, 1)} onClick=${run(() => moveStage(stage.id, 1))}>
              <${Icon} name="chevron" size=${16} /> ${t('Nach rechts')}
            </button>
            <button type="button" role="menuitem" onClick=${run(() => onAddAt(index + 1))}><${Icon} name="plus" size=${16} /> ${t('Neue Spalte rechts daneben')}</button>
            <button type="button" role="menuitem" class="danger" onClick=${run(() => askDeleteStage(stage))}><${Icon} name="trash" size=${16} /> ${t('Spalte löschen')}</button>`}
    </div>`}
  </span>`
}

// Klappliste oben im Board (Wunsch vom 24.11.2026): statt einer Reihe Reiter ein Knopf mit der
// aktuellen Auswahl. Die Liste hat zwei Gruppen (40_pipeline_bereich.sql):
//   „Intern“: Projekte mit bereich intern, je Person eines („Intern <Vorname>“, Entscheidung vom
//     24.11.2026, ersetzt „Meine Pipeline“ und „Pipeline von …“)
//   „Extern / Sales“: Projekte mit bereich sales (ohne Angabe ebenfalls Sales)
// Eigene Pipelines (am Namen erkannt) stehen in jeder Gruppe oben mit Sternchen, auch leer.
// Je Projekt Farbe, Zahl der offenen Aufgaben und das Zeichen für geteilte Projekte. Projekte ganz
// ohne Aufgaben (auch ohne archivierte) stehen erst nach „Leere Pipelines anzeigen“, gelöscht
// wird nichts. Liegt wie das Spaltenmenü fest über der Seite. Wird auch von der Pipeline genutzt.
const PICKER_WIDTH = 320
const openCountOf = (id) => state.db.cards.filter((c) => c.project_id === id && isOpen(c)).length
const hasCards = (id) => state.db.cards.some((c) => c.project_id === id)
// projectArea, ownWords, isOwnProject stehen in store.js (dort braucht sie die Vorgabe für neue Deals)
export { projectArea, ownWords, isOwnProject }

export function ProjectPicker({ currentId }) {
  const [pos, setPos] = useState(null)
  const [showEmpty, setShowEmpty] = useState(false)
  const open = !!pos
  const ref = useRef()
  const btn = useRef()
  const close = () => {
    setPos(null)
    setShowEmpty(false)
  }
  const toggle = () => {
    if (open) return close()
    const r = btn.current.getBoundingClientRect()
    const width = Math.min(PICKER_WIDTH, window.innerWidth - 16)
    setPos({ top: Math.round(r.bottom + 4), left: Math.round(Math.max(8, Math.min(r.left, window.innerWidth - width - 8))), width })
  }
  useEffect(() => {
    if (!open) return
    const away = (e) => ref.current && !ref.current.contains(e.target) && close()
    const esc = (e) => e.key === 'Escape' && (e.stopPropagation(), close())
    const onScroll = (e) => !(e.target && e.target.closest && e.target.closest('.project-menu')) && close()
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', esc, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
    }
  }, [open])
  const all = activeProjects()
  const mine = ownWords(myEmail(), memberName(myEmail()))
  const own = (p) => isOwnProject(p, mine)
  // Eigene Pipelines stehen immer da, auch leer
  const filled = all.filter((p) => hasCards(p.id) || p.id === currentId || own(p))
  const empty = all.filter((p) => !filled.includes(p))
  const current = all.find((p) => p.id === currentId)
  const shared = (p) => projectSharesOf(p.id).length > 0
  // Escape auch direkt am Knopf (der Fokus liegt dort), falls die Liste gerade erst aufging
  const onKeyDown = (e) => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation()
      close()
    }
  }
  const go = (path) => {
    close()
    navigate(path)
  }
  const projectItem = (p) => html`<li key=${p.id} role="option" aria-selected=${p.id === currentId}>
    <button type="button" class=${p.id === currentId ? 'active' : ''} onClick=${() => go('/board/' + p.id)}>
      <${Dot} color=${p.color} />
      <span class="pp-name">${p.name}</span>
      ${own(p) && html`<span class="pp-star" title=${t('Deine Pipeline')} aria-label=${t('deine Pipeline')}><${Icon} name="star" size=${14} /></span>`}
      ${shared(p) && html`<span class="tab-shared" title=${t('Mit Gästen geteilt')} aria-label=${t('mit Gästen geteilt')}><${Icon} name="users" size=${15} /></span>`}
      <span class="count">${openCountOf(p.id)}</span>
      ${p.id === currentId && html`<${Icon} name="check" size=${16} />`}
    </button>
  </li>`
  // Eigene zuerst, sonst die Reihenfolge der Pipelines
  const ownFirst = (list) => [...list.filter(own), ...list.filter((p) => !own(p))]
  const intern = ownFirst(filled.filter((p) => projectArea(p) === 'intern'))
  const sales = ownFirst(filled.filter((p) => projectArea(p) === 'sales'))
  const label = current ? current.name : t('Pipeline wählen')
  return html`<span class="project-picker" ref=${ref} onKeyDown=${onKeyDown}>
    <button type="button" ref=${btn} class="project-picker-btn" aria-haspopup="listbox" aria-expanded=${open} aria-label=${t('Board wählen, aktuell {name}', { name: label })} onClick=${toggle}>
      ${current && html`<${Dot} color=${current.color} />`}
      <span class="pp-name">${label}</span>
      ${current && html`<span class="count">${openCountOf(current.id)}</span>`}
      <span class=${'pp-chevron' + (open ? ' open' : '')}><${Icon} name="chevron" size=${16} /></span>
    </button>
    ${open &&
    html`<ul class="stage-menu project-menu" role="listbox" aria-label=${t('Boards')} style=${{ top: pos.top + 'px', left: pos.left + 'px', width: pos.width + 'px', maxHeight: `calc(100vh - ${pos.top + 16}px)` }}>
      <li class="pp-sep" role="presentation">${t('Intern')}</li>
      ${intern.map(projectItem)}
      ${!intern.length && html`<li class="pp-empty muted small" role="presentation">${t('Noch keine interne Pipeline.')}</li>`}
      <li class="pp-sep" role="presentation">${t('Extern / Sales')}</li>
      ${sales.map(projectItem)}
      ${!sales.length && html`<li class="pp-empty muted small" role="presentation">${t('Noch keine Sales-Pipeline.')}</li>`}
      ${empty.length > 0 &&
      (showEmpty
        ? empty.map(projectItem)
        : html`<li role="presentation">
            <button type="button" class="pp-more" onClick=${() => setShowEmpty(true)}>${t('Leere Pipelines anzeigen ({n})', { n: empty.length })}</button>
          </li>`)}
    </ul>`}
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
    <label class="column-new-label" for="new-stage-name">${t('Neue Spalte')}</label>
    <input
      id="new-stage-name"
      ref=${ref}
      value=${name}
      maxlength="60"
      placeholder=${t('Name der Spalte')}
      onInput=${(e) => setName(e.target.value)}
      onKeyDown=${(e) => e.key === 'Escape' && onCancel()}
    />
    <div class="form-actions">
      <button type="button" class="btn" onClick=${onCancel}>${t('Abbrechen')}</button>
      <button type="submit" class="btn btn-primary" disabled=${!name.trim() || busy}>${t('Anlegen')}</button>
    </div>
  </form>`
}

function Column({ stage, cards, onDropCard, onAdd, draggable, canEdit, renaming, onRename, onRenameDone, onAddAt, archiveCount = 0, onArchive }) {
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
              ${canEdit ? html`<button type="button" class="column-name" title=${t('Klicken zum Umbenennen')} onClick=${onRename}>${stageLabel(stage.name)}</button>` : stageLabel(stage.name)}
              <span class="count">${cards.length}</span>
              ${columnValue(cards) > 0 && html`<span class="column-value" title=${t('Summe der Deals in dieser Spalte (netto, ohne verlorene)')}>${fmtEuro(columnValue(cards))}</span>`}
            </h2>
            <span class="column-actions">
              ${canEdit && html`<${StageMenu} stage=${stage} onRename=${onRename} onAddAt=${onAddAt} />`}
              <button type="button" class="icon-btn small" aria-label=${t('Neuer Deal in „{name}“', { name: stageLabel(stage.name) })} onClick=${() => setAdding(true)}>
                <${Icon} name="plus" size=${18} />
              </button>
            </span>`}
    </div>
    ${adding &&
    html`<${InlineAdd}
      onAdd=${(title) => {
        onAdd(title, stage.id)
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
      ${showAll ? t('Weniger anzeigen') : t('Alle {n} anzeigen', { n: cards.length })}
    </button>`}
    ${!cards.length && !adding && html`<p class="column-empty">${t('Keine Deals')}</p>`}
    ${isDone &&
    archiveCount > 0 &&
    html`<a class="archive-link" href=${'#/board/' + stage.project_id + '/archiv'} onClick=${(e) => (e.preventDefault(), onArchive())}>
      <${Icon} name="archive" size=${16} /> ${archiveCount === 1 ? t('Archiv: 1 älterer Deal') : t('Archiv: {n} ältere Deals', { n: archiveCount })}
    </a>`}
  </section>`
}

// ------------------------------------------------------------
// Archiv eines Projekts als eigenes Fenster (Nachtrag „Archiv“, B3): #/board/<id>/archiv?q=…
// Erledigtes kommt nach 30 Tagen ohne Änderung von selbst hierher (24_archiv.sql).
// Sortiert nach der letzten Änderung, nach Monat gruppiert, die jüngsten zuerst. Eine Aufgabe
// öffnet sich über dem Archiv, Escape schließt dann nur sie (useOverlay in common.js).
// ------------------------------------------------------------
let archiveFromBoard = false
export function openArchive(projectId, q = '') {
  archiveFromBoard = true
  navigate('/board/' + projectId + '/archiv', q ? { q } : null)
}
function closeArchive(projectId) {
  if (archiveFromBoard) {
    archiveFromBoard = false
    history.back()
  } else {
    location.replace('#/board/' + projectId)
  }
}

// Suche in Aufgaben: Titel, Beschreibung, Labels, Kontakt, Firma
function cardMatches(c, q) {
  if (!q.trim()) return true
  const person = getPerson(c.person_id)
  const org = getOrg(c.org_id)
  return matches(q, c.title, c.description, c.labels, person && person.name, org && org.name)
}
const archivedOf = (projectId) => state.db.cards.filter((c) => c.project_id === projectId && c.archived)
const monthLabel = (iso) => new Date(iso).toLocaleDateString(locale(), { month: 'long', year: 'numeric' })

function ArchiveWindow({ project, initialQuery }) {
  const [q, setQ] = useState(initialQuery || '')
  const mobile = useIsMobile()
  const inputRef = useRef()
  useEffect(() => setQ(initialQuery || ''), [initialQuery])
  useEffect(() => {
    if (!mobile && inputRef.current) inputRef.current.focus()
  }, [])
  const all = archivedOf(project.id)
  const hits = all.filter((c) => cardMatches(c, q)).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
  const groups = []
  for (const c of hits) {
    const label = monthLabel(c.updated_at)
    if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, cards: [] })
    groups[groups.length - 1].cards.push(c)
  }
  const sub = (c) => {
    const stage = getStage(c.stage_id)
    const person = getPerson(c.person_id)
    const org = getOrg(c.org_id)
    return [stage && stageLabel(stage.name), t('zuletzt geändert {date}', { date: fmtDate(c.updated_at) }), person && person.name, org && org.name, c.assignee && memberName(c.assignee)]
      .filter(Boolean)
      .join(' · ')
  }
  return html`<${Modal} title=${t('Archiv: {name}', { name: project.name })} onClose=${() => closeArchive(project.id)} wide=${true} cls="archive-modal">
    <label class="search archive-search">
      <${Icon} name="search" size=${18} />
      <input ref=${inputRef} type="search" value=${q} placeholder=${t('Im Archiv suchen: Titel, Kontakt, Firma')} aria-label=${t('Archiv durchsuchen')} onInput=${(e) => setQ(e.target.value)} />
    </label>
    <p class="muted small archive-info">
      ${all.length === 1 ? t('1 Deal im Archiv.') : t('{n} Deals im Archiv.', { n: all.length })}
      ${t('Erledigtes kommt nach 30 Tagen ohne Änderung von selbst hierher, außer offene Deals und Deals mit offener Aktivität. Ein Klick öffnet den Deal, dort holt „Aus dem Archiv holen“ ihn zurück.')}
    </p>
    ${!all.length && html`<${Empty}>${t('Im Archiv dieser Pipeline liegt nichts.')}<//>`}
    ${all.length > 0 && !hits.length && html`<${Empty}>${t('Nichts gefunden für „{q}“.', { q: q.trim() })}<//>`}
    ${groups.map(
      (g) => html`<section class="archive-group" key=${g.label}>
        <h3 class="group-title">${g.label} <span class="count">${g.cards.length}</span></h3>
        <ul class="row-list archive-list">
          ${g.cards.map(
            (c) => html`<li key=${c.id}>
              <button type="button" class="row-link" onClick=${() => openCard(c.id)}>
                <span class="row-text">
                  <span class="row-title">${c.title}</span>
                  <span class="row-sub">${sub(c)}</span>
                </span>
              </button>
            </li>`
          )}
        </ul>
      </section>`
    )}
  <//>`
}

// Angeheftete Deals (47_angeheftet.sql, Wunsch vom 27.11.2026): schmaler Streifen oben in den
// eigenen Pipelines („Intern <Name>“ und „Vertrieb <Name>“), waagerecht scrollbar. Je Deal Titel,
// Pipeline und Spalte, grüner Punkt bei Neuem seit dem letzten Öffnen. Ohne Pins kein Streifen.
function PinnedStrip() {
  const cards = pinnedCards()
  if (!cards.length) return null
  return html`<section class="pinned-strip" aria-label=${t('Angeheftet')}>
    <h2 class="pinned-title"><${Icon} name="pin" size=${16} /> ${t('Angeheftet')} <span class="count">${cards.length}</span></h2>
    <ul class="pinned-list">
      ${cards.map((c) => {
        const p = getProject(c.project_id)
        const st = getStage(c.stage_id)
        const fresh = isNew(c.id)
        return html`<li key=${c.id}>
          <button type="button" class="pinned-card" onClick=${() => openCard(c.id)} aria-label=${c.title + (fresh ? ', ' + t('neu') : '')}>
            <span class="pinned-card-title">${fresh && html`<span class="pin-new" aria-hidden="true"></span>`}${c.title}</span>
            <span class="pinned-card-meta">${p && html`<${Dot} color=${p.color} />`}${p ? p.name : ''}${st ? ' · ' + stageLabel(st.name) : ''}${c.archived ? ' · ' + t('archiviert') : ''}</span>
          </button>
        </li>`
      })}
    </ul>
  </section>`
}

export function Board({ projectId, archiveOpen = false, archiveQuery = '' }) {
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
  const [mobileStage, setMobileStage] = useState(null)
  const [renaming, setRenaming] = useState(null)
  const [addingAt, setAddingAt] = useState(null)
  // Board oder Liste (Entscheidung vom 24.11.2026), je Gerät gemerkt
  const [view, setView] = useState(() => (local.get('beqcrm-board-view', 'board') === 'liste' ? 'liste' : 'board'))
  const changeView = (v) => {
    setView(v)
    local.set('beqcrm-board-view', v)
  }

  useEffect(() => {
    if (current) local.set('beqcrm-last-project', current.id)
  }, [current && current.id])

  if (!current) {
    return html`<div class="page"><${PageHead} kicker="Board" title=${t('Noch keine Pipeline')} />
      <button type="button" class="btn btn-primary" onClick=${newProject}><${Icon} name="plus" size=${18} /> ${t('Pipeline anlegen')}</button></div>`
  }

  const stages = stagesOf(current.id)
  const filtered = state.db.cards.filter((c) => {
    if (c.project_id !== current.id) return false
    if (c.archived) return false
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
  // Archiv: Zahl für den Link unter „Erledigt“ und Treffer der Board-Suche im Archiv
  const archived = archivedOf(current.id)
  const archiveHits = query.trim() ? archived.filter((c) => cardMatches(c, query)).length : 0
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
  const firstDoneId = (stages.find((s) => s.kind === 'done') || {}).id
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
    // Link ins Archiv nur unter der ersten Spalte der Art „Erledigt“
    archiveCount: s.id === firstDoneId ? archived.length : 0,
    onArchive: () => openArchive(current.id),
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
    <div class="project-tabs project-bar">
      <${ProjectPicker} currentId=${current.id} />
      <button type="button" class="tab tab-icon" aria-label=${t('Neue Pipeline')} title=${t('Neue Pipeline')} onClick=${newProject}><${Icon} name="plus" size=${18} /></button>
      <button
        type="button"
        class="tab tab-icon"
        aria-label=${t('Pipeline teilen')}
        title=${t('Pipeline teilen')}
        onClick=${() => openDialog({ kind: 'project-share', projectId: current.id })}
      >
        <${Icon} name="share" size=${18} />
      </button>
      <button
        type="button"
        class="tab tab-icon"
        aria-label=${t('Pipeline-Einstellungen')}
        title=${t('Pipeline-Einstellungen')}
        onClick=${() => openDialog({ kind: 'project-settings', projectId: current.id })}
      >
        <${Icon} name="gear" size=${18} />
      </button>
    </div>

    <div class="board-filters">
      <${Segmented} label="Ansicht" value=${view} onChange=${changeView} options=${[{ value: 'board', label: 'Board' }, { value: 'liste', label: 'Liste' }]} />
      <label class="search">
        <${Icon} name="search" size=${18} />
        <input type="search" value=${query} placeholder=${t('Suchen: Titel, Kontakt, Firma')} aria-label=${t('Board durchsuchen')} onInput=${(e) => setQuery(e.target.value)} />
      </label>
      <select value=${assignee} aria-label=${t('Zuständig')} onChange=${(e) => setAssignee(e.target.value)}>
        <option value="">${t('Alle Zuständigen')}</option>
        <option value="__none">${t('Niemand zuständig')}</option>
        ${state.db.team_members
          .filter((m) => m.active)
          .map((m) => html`<option value=${m.email}>${m.name}</option>`)}
      </select>
      <select value=${label} aria-label=${t('Label')} onChange=${(e) => setLabel(e.target.value)}>
        <option value="">${t('Alle Labels')}</option>
        ${allLabels().map((l) => html`<option value=${l}>${l}</option>`)}
      </select>
    </div>
    ${archiveHits > 0 &&
    html`<p class="archive-hits">
      <a href=${'#/board/' + current.id + '/archiv'} onClick=${(e) => (e.preventDefault(), openArchive(current.id, query.trim()))}>
        <${Icon} name="archive" size=${16} /> ${archiveHits === 1 ? t('1 weiterer Treffer im Archiv') : t('{n} weitere Treffer im Archiv', { n: archiveHits })}
      </a>
    </p>`}

    ${!isGuest() && isOwnProject(current, ownWords(myEmail(), memberName(myEmail()))) && html`<${PinnedStrip} />`}
    ${view === 'liste'
      ? html`<${CardTable} cards=${filtered} />
          ${mobile &&
          html`<button
            type="button"
            class="fab"
            aria-label=${t('Neuer Deal')}
            onClick=${async () => {
              const title = await promptDialog({ title: t('Neuer Deal'), label: t('Titel'), confirmLabel: t('Anlegen') })
              const first = stages.find((s) => s.kind === 'todo') || stages[0]
              if (title && first) {
                const card = await addCard(title, first.id)
                if (card) openCard(card.id)
              }
            }}
          >
            <${Icon} name="plus" size=${26} />
          </button>`}`
      : mobile
      ? html`<div class="stage-tabs" role="tablist" aria-label=${t('Spalten')}>
            ${stages.map(
              (s) => html`<button
                type="button"
                role="tab"
                aria-selected=${s.id === activeStage.id}
                class=${'tab' + (s.id === activeStage.id ? ' active' : '')}
                title=${canEdit && s.id === activeStage.id ? t('Noch einmal antippen zum Umbenennen') : undefined}
                onClick=${() => {
                  setAddingAt(null)
                  // Den gewählten Reiter noch einmal antippen benennt die Spalte um
                  if (canEdit && s.id === activeStage.id) setRenaming(s.id)
                  else setMobileStage(s.id)
                }}
              >
                ${stageLabel(s.name)} <span class="count">${cardsOf(s).length}</span>
              </button>`
            )}
            ${!isGuest() &&
            html`<button type="button" class="tab tab-icon" aria-label=${t('Spalte hinzufügen')} title=${t('Spalte hinzufügen')} onClick=${() => setAddingAt(beforeDone)}>
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
            aria-label=${t('Neuer Deal')}
            onClick=${async () => {
              const title = await promptDialog({ title: t('Neuer Deal'), label: t('Titel'), confirmLabel: t('Anlegen') })
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
            <button type="button" class="btn" onClick=${() => setAddingAt(beforeDone)}><${Icon} name="plus" size=${16} /> ${t('Spalte')}</button>
          </div>`}
        </div>`}
    ${archiveOpen && html`<${ArchiveWindow} project=${current} initialQuery=${archiveQuery} />`}
  </div>`
}

async function newProject() {
  const name = await promptDialog({ title: t('Neue Pipeline'), label: t('Name der Pipeline'), confirmLabel: t('Anlegen') })
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
      aria-label=${t('Name der Spalte')}
      onInput=${(e) => setName(e.target.value)}
      onBlur=${() => name.trim() && name.trim() !== stage.name && update('stages', stage.id, { name: name.trim() })}
      onKeyDown=${(e) => e.key === 'Enter' && e.target.blur()}
    />
    ${isDone
      ? html`<span class="stage-kind-fixed" title=${t('Jede Pipeline hat genau eine Spalte der Art „Erledigt“')}>${t('Erledigt')}</span>`
      : html`<select value=${stage.kind} aria-label=${t('Art der Spalte')} onChange=${(e) => update('stages', stage.id, { kind: e.target.value })}>
          ${SETTINGS.stageKinds.filter((k) => k.value !== 'done').map((k) => html`<option value=${k.value}>${k.label}</option>`)}
        </select>`}
    <label class="stage-prob" title=${t('Wahrscheinlichkeit für neue Deals in dieser Spalte (Sales)')}>
      <input
        type="number"
        min="0"
        max="100"
        step="5"
        inputmode="numeric"
        aria-label=${t('Wahrscheinlichkeit in Prozent für „{name}“', { name: stageLabel(stage.name) })}
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
      <button type="button" class="icon-btn small" aria-label=${t('Nach oben')} disabled=${!canMoveStage(stage.id, -1)} onClick=${() => moveStage(stage.id, -1)}><${Icon} name="up" size=${16} /></button>
      <button type="button" class="icon-btn small" aria-label=${t('Nach unten')} disabled=${!canMoveStage(stage.id, 1)} onClick=${() => moveStage(stage.id, 1)}><${Icon} name="down" size=${16} /></button>
      <button
        type="button"
        class="icon-btn small"
        aria-label=${t('Spalte löschen')}
        title=${isDone ? t('Die Spalte „Erledigt“ bleibt immer') : t('Spalte löschen')}
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
      title: t('Pipeline „{name}“ archivieren?', { name: project.name }),
      text: t('Die Pipeline verschwindet aus der Klappliste. Deals und Spalten bleiben erhalten, du kannst sie hier jederzeit wiederherstellen.'),
      confirmLabel: t('Archivieren'),
    })
    if (!ok) return
    await update('projects', project.id, { archived: true })
    toast(t('„{name}“ archiviert', { name: project.name }))
    navigate('/board')
  }

  return html`<${Modal} title=${t('Pipeline-Einstellungen')} onClose=${close} wide=${true}>
    <${Field} label=${t('Name')} htmlFor="project-name">
      <input
        id="project-name"
        value=${name}
        onInput=${(e) => setName(e.target.value)}
        onBlur=${() => name.trim() && name.trim() !== project.name && update('projects', project.id, { name: name.trim() })}
        onKeyDown=${(e) => e.key === 'Enter' && e.target.blur()}
      />
    <//>
    <${Field} label=${t('Bereich')} hint=${t('Bestimmt, unter welcher Überschrift die Pipeline in der Klappliste oben steht.')}>
      <div class="segmented" role="radiogroup" aria-label=${t('Bereich')}>
        ${[
          ['intern', 'Intern'],
          ['sales', 'Extern / Sales'],
        ].map(
          ([value, text]) => html`<button
            type="button"
            role="radio"
            aria-checked=${projectArea(project) === value}
            class=${projectArea(project) === value ? 'active' : ''}
            onClick=${() => projectArea(project) !== value && update('projects', project.id, { bereich: value })}
          >
            ${t(text)}
          </button>`
        )}
      </div>
    <//>
    <${Field} label=${t('Farbe')}>
      <div class="swatches" role="radiogroup" aria-label=${t('Farbe')}>
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
    <h3 class="section-title">${t('Spalten')}</h3>
    <p class="muted small">${t('Die Art bestimmt, wo Deals in der Übersicht erscheinen. Namen kannst du frei wählen. Die Prozentzahl ist die Wahrscheinlichkeit für Deals in dieser Spalte (für den gewichteten Wert in „Sales“), leer heißt ohne.')}</p>
    <ul class="stage-list">
      ${stages.map((s) => html`<${StageRow} key=${s.id} stage=${s} />`)}
    </ul>
    <button type="button" class="btn" onClick=${() => askAddStage(project.id)}><${Icon} name="plus" size=${16} /> ${t('Spalte hinzufügen')}</button>

    <div class="settings-foot">
      <button type="button" class="btn" onClick=${archiveProject}><${Icon} name="archive" size=${16} /> ${t('Pipeline archivieren')}</button>
    </div>
    ${archived.length > 0 &&
    html`<div class="archived-projects">
      <h3 class="section-title">${t('Archivierte Pipelines')}</h3>
      <ul>
        ${archived.map(
          (p) => html`<li>
            <span><${Dot} color=${p.color} />${p.name}</span>
            <button
              type="button"
              class="link-btn"
              onClick=${async () => {
                await update('projects', p.id, { archived: false })
                toast(t('„{name}“ wiederhergestellt', { name: p.name }))
              }}
            >
              ${t('Wiederherstellen')}
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
  const name = await promptDialog({ title: t('Neue Spalte'), label: t('Name der Spalte'), confirmLabel: t('Anlegen') })
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
      title: t('Spalte „{name}“ löschen?', { name: stageLabel(stage.name) }),
      text: lastOfKindHint(stage) || t('Die Spalte ist leer.'),
      confirmLabel: t('Löschen'),
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
    title=${t('Spalte „{name}“ löschen?', { name: stageLabel(stage.name) })}
    onClose=${close}
    footer=${html`<button type="button" class="btn" onClick=${close}>${t('Abbrechen')}</button>
      <button type="button" class="btn btn-danger" disabled=${!target || busy} onClick=${run}>${busy ? t('Einen Moment …') : t('Verschieben und Spalte löschen')}</button>`}
  >
    <p>
      ${total === 1 ? t('In „{name}“ liegt noch 1 Deal', { name: stageLabel(stage.name) }) : t('In „{name}“ liegen noch {n} Deals', { name: stageLabel(stage.name), n: total })}${archived ? t(', davon {n} archiviert', { n: archived }) : ''}. ${t('Wohin sollen sie?')}
    </p>
    ${hint && html`<p class="muted small">${hint}</p>`}
    <${Field} label=${t('Verschieben nach')} htmlFor="stage-target">
      <select id="stage-target" value=${target} onChange=${(e) => setTarget(e.target.value)}>
        ${others.map((s) => html`<option value=${s.id}>${stageLabel(s.name)}</option>`)}
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
        title: t('Freigabe für {name} aufheben?', { name: g.name }),
        text: t('{name} sieht dann nur noch Deals aus „{project}“, die einzeln mit {first} geteilt sind.', { name: g.name, project: project.name, first: g.name.split(' ')[0] }),
        confirmLabel: t('Aufheben'),
      })
      if (ok) await remove('project_shares', existing.id)
    } else {
      const ok = await confirmDialog({
        title: t('Ganze Pipeline „{project}“ mit {name} teilen?', { project: project.name, name: g.name }),
        text: t('{name} sieht dann alle Deals darin, auch neue, und kann dort selbst Deals anlegen.', { name: g.name }),
        confirmLabel: t('Teilen'),
      })
      if (ok) {
        const saved = await insert('project_shares', { project_id: project.id, email: g.email.toLowerCase() })
        if (saved) toast(t('{name} sieht jetzt die ganze Pipeline „{project}“.', { name: g.name, project: project.name }))
      }
    }
    reopen()
  }
  return html`<${Modal} title=${t('„{name}“ teilen', { name: project.name })} onClose=${closeDialog}>
    ${guests.length === 0
      ? html`<p class="muted">${t('Es gibt noch keine Gäste. Ein Admin legt sie in den Einstellungen unter „Team“ mit der Rolle Gast an.')}</p>`
      : html`<div class="chips" role="group" aria-label=${t('Gäste')}>
          ${guests.map((g) => {
            const on = shares.some((s) => s.email.toLowerCase() === g.email.toLowerCase())
            return html`<button type="button" class=${'chip-btn' + (on ? ' active' : '')} aria-pressed=${on} onClick=${() => toggle(g)}>
              ${on && html`<${Icon} name="check" size=${14} />`} ${g.name}
            </button>`
          })}
        </div>`}
    <p class="muted small share-note">
      ${shares.length
        ? t('Geteilt: Gäste sehen alle Deals dieser Pipeline mit Kontakt, Firma, Verlauf und Notizen und können hier selbst Deals anlegen. Notizen mit „Nur intern“, Mails, Meetings und Termine bleiben verborgen.')
        : t('Einzelne Deals teilst du im Deal unter „Teilen mit“. Hier gibst du die ganze Pipeline frei, auch für künftige Deals.')}
    </p>
  <//>`
}
dialogKinds['project-share'] = ProjectShare
