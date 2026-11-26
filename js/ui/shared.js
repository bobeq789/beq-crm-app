// Startseite für Gäste „Mit dir geteilt“: oben „Für dich“, darunter je Projekt.
// Bei ganz geteilten Projekten (project_shares) legt der Gast mit „+“ selbst Aufgaben an.
import { html, useState } from '../lib/preact.js'
import { Icon } from '../lib/icons.js'
import { norm } from '../lib/util.js'
import { state, cardKind, isOpen, myEmail, member, mySharedProjectIds, createCard, toast, isMentioned } from '../store.js'
import { PageHead, Tile, Empty, TaskRow, Dot } from './common.js'
import { t, isEnglish } from '../i18n.js'

const PRIO_ORDER = { hoch: 0, mittel: 1, niedrig: 2 }

// „A“, „A und B“, „A, B und C“
function joinNames(names) {
  if (names.length <= 1) return names[0] || ''
  return names.slice(0, -1).join(', ') + ' ' + t('und') + ' ' + names[names.length - 1]
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
  if (sharers.some((m) => !m) || !names.length) names.push(names.length ? t('das Team der beQ') : t('Das Team der beQ'))
  const who = joinNames(names)
  const projectNames = fullProjects.map((p) => (isEnglish() ? `“${p.name}”` : `„${p.name}“`))
  return html`<div class="shared-intro">
    <p>
      ${names.length > 1 ? t('{who} teilen hier Deals mit dir.', { who }) : t('{who} teilt hier Deals mit dir.', { who })}
      ${fullProjects.length === 1 && ' ' + t('Die Pipeline {name} siehst du ganz, auch neue Deals.', { name: projectNames[0] })}
      ${fullProjects.length > 1 && ' ' + t('Die Pipelines {names} siehst du ganz, auch neue Deals.', { names: joinNames(projectNames) })}
    </p>
    <p class="muted">
      ${t('Du kannst Notizen schreiben und Spalte, Dringlichkeit, Fälligkeit und Zuständig ändern.')}
      ${fullProjects.length > 0 && ' ' + t('In ganz geteilten Pipelines legst du mit „+“ selbst Deals an.')}
    </p>
  </div>`
}

// Neue Aufgabe im ganz geteilten Projekt: nur ein Titel, zuständig ist der Gast selbst
function AddRow({ project, onDone }) {
  const [title, setTitle] = useState('')
  const save = async () => {
    const text = title.trim()
    if (!text) return onDone()
    const saved = await createCard({ title: text, project_id: project.id, assignee: myEmail() })
    if (saved) toast(t('Deal angelegt'))
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
      placeholder=${t('Neuer Deal in „{name}“', { name: project.name })}
      aria-label=${t('Neuer Deal in „{name}“', { name: project.name })}
      ref=${(el) => el && !el.dataset.focused && ((el.dataset.focused = '1'), el.focus())}
      onInput=${(e) => setTitle(e.target.value)}
      onKeyDown=${(e) => e.key === 'Escape' && onDone()}
    />
    <button type="submit" class="btn btn-primary" disabled=${!title.trim()}>${t('Anlegen')}</button>
  </form>`
}

function ProjectGroup({ project, cards, full }) {
  const [adding, setAdding] = useState(false)
  const title = html`<span class="meta-item">
    <${Dot} color=${project.color} />${project.name}
    ${full && html`<span class="tab-shared" title=${t('Ganz mit dir geteilt')}><${Icon} name="users" size=${15} /></span>`}
  </span>`
  const actions =
    full &&
    html`<button type="button" class="icon-btn" aria-label=${t('Neuer Deal in „{name}“', { name: project.name })} title=${t('Neuer Deal')} onClick=${() => setAdding(true)}>
      <${Icon} name="plus" />
    </button>`
  return html`<${Tile} title=${title} count=${cards.length} actions=${actions}>
    ${adding && html`<${AddRow} project=${project} onDone=${() => setAdding(false)} />`}
    ${cards.length
      ? html`<ul class="task-list">${cards.map((c) => html`<${TaskRow} card=${c} key=${c.id} />`)}</ul>`
      : !adding && html`<${Empty}>${t('Noch keine Deals. Mit „+“ legst du den ersten an.')}<//>`}
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
    <${PageHead} kicker=${t('Geteilt')} title=${name ? t('Hallo {name}', { name }) : t('Mit dir geteilt')} />
    ${groups.length ? html`<${Intro} fullProjects=${fullProjects} />` : html`<${Empty}>${t('Gerade ist nichts mit dir geteilt.')}<//>`}
    ${groups.length > 0 &&
    html`<${Tile} title=${t('Für dich')} count=${forMe.length}>
      ${forMe.length
        ? html`<ul class="task-list">${forMe.map((c) => html`<${TaskRow} card=${c} key=${c.id} />`)}</ul>`
        : html`<${Empty}>${t('Gerade bist du für keinen offenen Deal zuständig und niemand hat dich erwähnt.')}<//>`}
    <//>`}
    ${groups.map((g) => html`<${ProjectGroup} key=${g.project.id} project=${g.project} cards=${g.cards} full=${g.full} />`)}
  </div>`
}
