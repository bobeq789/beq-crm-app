// Startseite für Gäste „Mit dir geteilt“: oben „Für dich“, darunter je Projekt.
// Bei ganz geteilten Projekten (project_shares) legt der Gast mit „+“ selbst Aufgaben an.
import { html, useState } from '../lib/preact.js'
import { Icon } from '../lib/icons.js'
import { norm } from '../lib/util.js'
import { state, cardKind, isOpen, myEmail, member, mySharedProjectIds, createCard, toast, isMentioned } from '../store.js'
import { PageHead, Tile, Empty, TaskRow, Dot } from './common.js'

const PRIO_ORDER = { hoch: 0, mittel: 1, niedrig: 2 }

// „A“, „A und B“, „A, B und C“
function joinNames(names) {
  if (names.length <= 1) return names[0] || ''
  return names.slice(0, -1).join(', ') + ' und ' + names[names.length - 1]
}

// Offene zuerst, dann nach Fälligkeit und Dringlichkeit, Erledigte ans Ende
function guestSort(a, b) {
  const doneA = Number(cardKind(a) === 'done')
  const doneB = Number(cardKind(b) === 'done')
  if (doneA !== doneB) return doneA - doneB
  const da = a.due_date || '9999-99-99'
  const dbb = b.due_date || '9999-99-99'
  if (da !== dbb) return da < dbb ? -1 : 1
  const pa = PRIO_ORDER[a.priority] ?? 3
  const pb = PRIO_ORDER[b.priority] ?? 3
  if (pa !== pb) return pa - pb
  return String(b.updated_at).localeCompare(String(a.updated_at))
}

// Ein Satz oben: wer geteilt hat und was der Gast darf
function Intro({ fullProjects }) {
  const me = norm(myEmail())
  const sharers = [...state.db.card_shares, ...(state.db.project_shares || [])]
    .filter((s) => norm(s.email) === me)
    .map((s) => member(s.created_by))
  const names = [...new Set(sharers.filter(Boolean).map((m) => m.name))].sort((a, b) => a.localeCompare(b, 'de'))
  if (sharers.some((m) => !m) || !names.length) names.push(names.length ? 'das Team der beQ' : 'Das Team der beQ')
  const who = joinNames(names)
  const verb = names.length > 1 ? 'teilen' : 'teilt'
  const projectNames = fullProjects.map((p) => `„${p.name}“`)
  return html`<div class="shared-intro">
    <p>
      ${who} ${verb} hier Aufgaben mit dir.
      ${fullProjects.length === 1 && ` Das Projekt ${projectNames[0]} siehst du ganz, auch neue Aufgaben.`}
      ${fullProjects.length > 1 && ` Die Projekte ${joinNames(projectNames)} siehst du ganz, auch neue Aufgaben.`}
    </p>
    <p class="muted">
      Du kannst Notizen schreiben und Spalte, Dringlichkeit, Fälligkeit und Zuständig ändern.
      ${fullProjects.length > 0 && ' In ganz geteilten Projekten legst du mit „+“ selbst Aufgaben an.'}
    </p>
  </div>`
}

// Neue Aufgabe im ganz geteilten Projekt: nur ein Titel, zuständig ist der Gast selbst
function AddRow({ project, onDone }) {
  const [title, setTitle] = useState('')
  const save = async () => {
    const t = title.trim()
    if (!t) return onDone()
    const saved = await createCard({ title: t, project_id: project.id, assignee: myEmail() })
    if (saved) toast('Aufgabe angelegt')
    setTitle('')
    onDone()
  }
  return html`<form
    class="shared-add"
    onSubmit=${(e) => {
      e.preventDefault()
      save()
    }}
  >
    <input
      type="text"
      value=${title}
      placeholder=${`Neue Aufgabe in „${project.name}“`}
      aria-label=${`Neue Aufgabe in „${project.name}“`}
      ref=${(el) => el && !el.dataset.focused && ((el.dataset.focused = '1'), el.focus())}
      onInput=${(e) => setTitle(e.target.value)}
      onKeyDown=${(e) => e.key === 'Escape' && onDone()}
    />
    <button type="submit" class="btn btn-primary" disabled=${!title.trim()}>Anlegen</button>
  </form>`
}

function ProjectGroup({ project, cards, full }) {
  const [adding, setAdding] = useState(false)
  const title = html`<span class="meta-item">
    <${Dot} color=${project.color} />${project.name}
    ${full && html`<span class="tab-shared" title="Ganz mit dir geteilt"><${Icon} name="users" size=${15} /></span>`}
  </span>`
  const actions =
    full &&
    html`<button type="button" class="icon-btn" aria-label=${`Neue Aufgabe in „${project.name}“`} title="Neue Aufgabe" onClick=${() => setAdding(true)}>
      <${Icon} name="plus" />
    </button>`
  return html`<${Tile} title=${title} count=${cards.length} actions=${actions}>
    ${adding && html`<${AddRow} project=${project} onDone=${() => setAdding(false)} />`}
    ${cards.length
      ? html`<ul class="task-list">${cards.map((c) => html`<${TaskRow} card=${c} key=${c.id} />`)}</ul>`
      : !adding && html`<${Empty}>Noch keine Aufgaben. Mit „+“ legst du die erste an.<//>`}
  <//>`
}

export function SharedPage() {
  const name = state.me ? state.me.name.split(' ')[0] : ''
  const me = norm(myEmail())
  const full = mySharedProjectIds()
  const projects = [...state.db.projects].sort((a, b) => a.sort - b.sort)
  const visible = state.db.cards.filter((c) => !c.archived)
  // Für dich: zuständig oder seit dem letzten Öffnen erwähnt („@ dich“)
  const forMe = visible
    .filter((c) => isOpen(c) && (norm(c.assignee || '') === me || isMentioned(c.id)))
    .sort((a, b) => Number(isMentioned(b.id)) - Number(isMentioned(a.id)) || guestSort(a, b))
  const groups = projects
    .map((p) => ({ project: p, full: full.has(p.id), cards: visible.filter((c) => c.project_id === p.id).sort(guestSort) }))
    .filter((g) => g.cards.length || g.full)
  const fullProjects = groups.filter((g) => g.full).map((g) => g.project)

  return html`<div class="page page-narrow">
    <${PageHead} kicker="Geteilt" title=${name ? `Hallo ${name}` : 'Mit dir geteilt'} />
    ${groups.length ? html`<${Intro} fullProjects=${fullProjects} />` : html`<${Empty}>Gerade ist nichts mit dir geteilt.<//>`}
    ${groups.length > 0 &&
    html`<${Tile} title="Für dich" count=${forMe.length}>
      ${forMe.length
        ? html`<ul class="task-list">${forMe.map((c) => html`<${TaskRow} card=${c} key=${c.id} />`)}</ul>`
        : html`<${Empty}>Gerade bist du für keine offene Aufgabe zuständig und niemand hat dich erwähnt.<//>`}
    <//>`}
    ${groups.map((g) => html`<${ProjectGroup} key=${g.project.id} project=${g.project} cards=${g.cards} full=${g.full} />`)}
  </div>`
}
