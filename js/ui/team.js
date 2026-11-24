// Team-Überblick über die Aufgaben (Entscheidung vom 24.11.2026): nur für den Super-Admin
// (beQ Backoffice). Alle anderen sehen nur ihre eigenen Aufgaben (Übersicht, Meine Pipeline).
// Je Person: offen, überfällig, diese Woche fällig, wartet, offene Aktivitäten, erledigt in den
// letzten 7 Tagen. Je Projekt dasselbe plus Aufgaben ohne Zuständige. Ein Klick auf eine Person
// öffnet ihre Pipeline, ein Klick auf ein Projekt das Board.
// Nur eine Ansicht: Die Datenbank ändert sich dafür nicht, Aufgaben sieht ohnehin das ganze Team.
// Archivierte Aufgaben zählen nicht mit.
import { html } from '../lib/preact.js'
import { todayStr, endOfWeekStr, addDays, norm } from '../lib/util.js'
import { state, activeMembers, activeProjects, cardKind, isCardOf, activityHolder, isSuperAdmin } from '../store.js'
import { navigate } from '../router.js'
import { PageHead, Tile, Empty, Dot } from './common.js'

function Stat({ label, value, sub, main = false, alert = false }) {
  return html`<div class=${'stat' + (main ? ' stat-main' : '')}>
    <span class="stat-label">${label}</span>
    <span class=${'stat-value' + (alert && value > 0 ? ' stat-alert' : '')}>${value}</span>
    ${sub && html`<span class="muted small">${sub}</span>`}
  </div>`
}

// Zahlen für eine Menge Aufgaben
function countsOf(cards, today, weekEnd, weekAgo) {
  const open = cards.filter((c) => cardKind(c) !== 'done')
  return {
    open: open.length,
    overdue: open.filter((c) => c.due_date && c.due_date < today).length,
    week: open.filter((c) => c.due_date && c.due_date >= today && c.due_date <= weekEnd).length,
    waiting: open.filter((c) => cardKind(c) === 'waiting').length,
    done: cards.filter((c) => cardKind(c) === 'done' && String(c.stage_changed_at).slice(0, 10) >= weekAgo).length,
  }
}

const num = (n, alert = false) => html`<td class=${'ct-num' + (alert && n > 0 ? ' team-alert' : '')}>${n}</td>`

export function TeamPage() {
  if (!isSuperAdmin()) {
    return html`<div class="page"><${PageHead} kicker="Team" title="Team-Überblick" /><${Empty}>Diese Seite sieht nur beQ Backoffice.<//></div>`
  }
  const today = todayStr()
  const weekEnd = endOfWeekStr()
  const weekAgo = addDays(today, -7)
  const cards = state.db.cards.filter((c) => !c.archived)
  const acts = (state.db.aktivitaeten || []).filter((a) => !a.erledigt_at)
  const total = countsOf(cards, today, weekEnd, weekAgo)

  const people = activeMembers().map((t) => {
    const e = norm(t.email)
    const mine = cards.filter((c) => isCardOf(c, e))
    const myActs = acts.filter((a) => activityHolder(a) === e)
    return {
      member: t,
      ...countsOf(mine, today, weekEnd, weekAgo),
      acts: myActs.length,
      actsOverdue: myActs.filter((a) => a.faellig < today).length,
    }
  })
  const projects = activeProjects().map((p) => {
    const list = cards.filter((c) => c.project_id === p.id)
    return {
      project: p,
      ...countsOf(list, today, weekEnd, weekAgo),
      nobody: list.filter((c) => cardKind(c) !== 'done' && !c.assignee && !(c.mitzustaendig || []).length).length,
    }
  })

  return html`<div class="page page-team">
    <${PageHead} kicker="Team" title="Team-Überblick" />
    <p class="muted">Deals aller Pipelines ohne Archiv. Nur du siehst diese Seite. Deals mit mehreren Zuständigen zählen bei jeder Person.</p>
    <div class="stats">
      <${Stat} main=${true} label="Offen" value=${total.open} sub="ohne Erledigt" />
      <${Stat} label="Überfällig" value=${total.overdue} alert=${true} sub="Fälligkeit vorbei" />
      <${Stat} label="Diese Woche fällig" value=${total.week} sub=${'bis Sonntag'} />
      <${Stat} label="Wartet auf Rückmeldung" value=${total.waiting} />
      <${Stat} label="Erledigt" value=${total.done} sub="in den letzten 7 Tagen" />
    </div>

    <${Tile} title="Je Person">
      <div class="card-table-wrap">
        <table class="sales-table team-table">
          <thead>
            <tr><th>Person</th><th>Offen</th><th>Überfällig</th><th>Diese Woche</th><th>Wartet</th><th>Aktivitäten offen</th><th>Erledigt (7 Tage)</th></tr>
          </thead>
          <tbody>
            ${people.map(
              (p) => html`<tr key=${p.member.email}>
                <td><button type="button" class="ct-link" title="Pipeline öffnen" onClick=${() => navigate('/board/meine', { von: norm(p.member.email) })}>${p.member.name}</button></td>
                ${num(p.open)}${num(p.overdue, true)}${num(p.week)}${num(p.waiting)}
                <td class=${'ct-num' + (p.actsOverdue > 0 ? ' team-alert' : '')}>${p.acts}${p.actsOverdue > 0 ? ` (${p.actsOverdue} überfällig)` : ''}</td>
                ${num(p.done)}
              </tr>`
            )}
          </tbody>
        </table>
      </div>
    <//>

    <${Tile} title="Je Pipeline">
      <div class="card-table-wrap">
        <table class="sales-table team-table">
          <thead>
            <tr><th>Pipeline</th><th>Offen</th><th>Überfällig</th><th>Diese Woche</th><th>Wartet</th><th>Ohne Zuständige</th><th>Erledigt (7 Tage)</th></tr>
          </thead>
          <tbody>
            ${projects.map(
              (p) => html`<tr key=${p.project.id}>
                <td><button type="button" class="ct-link" title="Pipeline öffnen" onClick=${() => navigate('/board/' + p.project.id)}><${Dot} color=${p.project.color} /> ${p.project.name}</button></td>
                ${num(p.open)}${num(p.overdue, true)}${num(p.week)}${num(p.waiting)}${num(p.nobody, true)}${num(p.done)}
              </tr>`
            )}
          </tbody>
        </table>
      </div>
    <//>
  </div>`
}
