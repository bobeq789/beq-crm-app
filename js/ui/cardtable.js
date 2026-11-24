// Listenansicht eines Projekt-Boards (Entscheidung vom 24.11.2026): dieselben Aufgaben wie das
// Board mit denselben Filtern, nur als sortierbare Tabelle. Kein eigener Menüpunkt, sondern der
// Umschalter „Board, Liste“ über dem Board (js/ui/board.js). Ein Klick öffnet die Aufgabe.
// Am Handy als Zeilen untereinander statt Tabelle.
import { html, useState } from '../lib/preact.js'
import { Icon } from '../lib/icons.js'
import { fmtEuro, fmtDate, firstName } from '../lib/util.js'
import { getPerson, getOrg, getStage, memberName, dealOf } from '../store.js'
import { openCard } from '../router.js'
import { DueBadge, PrioBadge, Empty, useIsMobile, Avatar } from './common.js'

const PAGE = 100
const PRIO_RANK = { hoch: 0, mittel: 1, niedrig: 2 }
// Leere Werte immer ans Ende, egal in welche Richtung sortiert wird
const cmp = (a, b) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1)

const COLUMNS = [
  { key: 'titel', label: 'Deal', value: (c) => c.title.toLowerCase() },
  { key: 'spalte', label: 'Spalte', value: (c) => (getStage(c.stage_id) || {}).sort ?? null },
  { key: 'zustaendig', label: 'Zuständig', value: (c) => (c.assignee ? memberName(c.assignee).toLowerCase() : null) },
  { key: 'faellig', label: 'Fällig', value: (c) => c.due_date || null },
  { key: 'dringlichkeit', label: 'Dringlichkeit', value: (c) => (c.priority ? PRIO_RANK[c.priority] : null) },
  { key: 'deal', label: 'Wert', value: (c) => (dealOf(c.id) ? Number(dealOf(c.id).value_cents || 0) : null), desc: true },
  { key: 'geaendert', label: 'Geändert', value: (c) => String(c.updated_at || ''), desc: true },
]

function sortCards(cards, key, dir) {
  const col = COLUMNS.find((c) => c.key === key) || COLUMNS[1]
  const sign = dir === 'desc' ? -1 : 1
  return [...cards].sort((a, b) => {
    const va = col.value(a)
    const vb = col.value(b)
    if (va === null || vb === null) return cmp(va, vb)
    // Gleichstand: nach Fälligkeit, dann zuletzt geändert
    return sign * cmp(va, vb) || cmp(a.due_date || null, b.due_date || null) || String(b.updated_at).localeCompare(String(a.updated_at))
  })
}

const who = (c) => {
  if (!c.assignee) return ''
  const more = (c.mitzustaendig || []).length
  return memberName(c.assignee) + (more ? ` +${more}` : '')
}
const sub = (c) => {
  const p = getPerson(c.person_id)
  const o = getOrg(c.org_id)
  return [p && p.name, o && o.name].filter(Boolean).join(' · ')
}
const dealText = (c) => {
  const d = dealOf(c.id)
  if (!d) return ''
  return fmtEuro(d.value_cents) + (d.status === 'gewonnen' ? ' gewonnen' : d.status === 'verloren' ? ' verloren' : '')
}
const isDone = (c) => (getStage(c.stage_id) || {}).kind === 'done'

export function CardTable({ cards }) {
  const mobile = useIsMobile()
  const [sort, setSort] = useState({ key: 'spalte', dir: 'asc' })
  const [showAll, setShowAll] = useState(false)
  if (!cards.length) return html`<${Empty}>Keine Deals für diese Auswahl.<//>`
  const sorted = sortCards(cards, sort.key, sort.dir)
  const shown = showAll ? sorted : sorted.slice(0, PAGE)
  const toggle = (col) =>
    setSort((s) => (s.key === col.key ? { key: col.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: col.key, dir: col.desc ? 'desc' : 'asc' }))
  const more =
    sorted.length > PAGE &&
    html`<button type="button" class="link-btn" onClick=${() => setShowAll(!showAll)}>${showAll ? 'Weniger anzeigen' : `Alle ${sorted.length} anzeigen`}</button>`

  if (mobile) {
    return html`<div class="card-list-wrap">
      <div class="card-list-sort">
        <label class="muted small" for="list-sort">Sortieren</label>
        <select id="list-sort" value=${sort.key} onChange=${(e) => toggle(COLUMNS.find((c) => c.key === e.target.value))}>
          ${COLUMNS.map((c) => html`<option value=${c.key}>${c.label}</option>`)}
        </select>
      </div>
      <ul class="card-list">
        ${shown.map(
          (c) => html`<li key=${c.id}>
            <button type="button" class="card-list-row" onClick=${() => openCard(c.id)}>
              <span class="cl-title">${c.title}</span>
              ${sub(c) && html`<span class="cl-sub">${sub(c)}</span>`}
              <span class="cl-meta">
                <span class="badge">${(getStage(c.stage_id) || {}).name || ''}</span>
                ${c.assignee && html`<span class="muted small">${firstName(memberName(c.assignee))}</span>`}
                <${DueBadge} due=${c.due_date} done=${isDone(c)} />
                <${PrioBadge} priority=${c.priority} />
                ${dealText(c) && html`<span class="badge deal-badge">${dealText(c)}</span>`}
              </span>
            </button>
          </li>`
        )}
      </ul>
      ${more}
    </div>`
  }

  return html`<div class="card-table-wrap">
    <table class="sales-table card-table">
      <thead>
        <tr>
          ${COLUMNS.map((col) => {
            const active = sort.key === col.key
            return html`<th aria-sort=${active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
              <button type="button" class=${'th-sort' + (active ? ' active' : '')} onClick=${() => toggle(col)}>
                ${col.label}${active && html`<${Icon} name=${sort.dir === 'asc' ? 'up' : 'down'} size=${13} />`}
              </button>
            </th>`
          })}
        </tr>
      </thead>
      <tbody>
        ${shown.map(
          (c) => html`<tr key=${c.id} class="card-table-row" onClick=${() => openCard(c.id)}>
            <td class="ct-title">
              <button type="button" class="ct-link" onClick=${(e) => (e.stopPropagation(), openCard(c.id))}>${c.title}</button>
              ${sub(c) && html`<span class="ct-sub">${sub(c)}</span>`}
            </td>
            <td>${(getStage(c.stage_id) || {}).name || ''}</td>
            <td class="ct-who">${c.assignee && html`<${Avatar} email=${c.assignee} />`} ${who(c)}</td>
            <td><${DueBadge} due=${c.due_date} done=${isDone(c)} /></td>
            <td><${PrioBadge} priority=${c.priority} /></td>
            <td class="ct-num">${dealText(c)}</td>
            <td class="ct-num muted">${fmtDate(String(c.updated_at || '').slice(0, 10))}</td>
          </tr>`
        )}
      </tbody>
    </table>
    ${more}
  </div>`
}
