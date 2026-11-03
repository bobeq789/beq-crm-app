// Bereich „Geteilt“ für Gäste: die mit ihnen geteilten Karten, nach Projekt
import { html } from '../lib/preact.js'
import { state, cardKind } from '../store.js'
import { PageHead, Tile, Empty, TaskRow, Dot } from './common.js'

export function SharedPage() {
  const name = state.me ? state.me.name.split(' ')[0] : ''
  const projects = [...state.db.projects].sort((a, b) => a.sort - b.sort)
  const groups = projects
    .map((p) => ({
      project: p,
      cards: state.db.cards
        .filter((c) => c.project_id === p.id && !c.archived)
        .sort((a, b) => Number(cardKind(a) === 'done') - Number(cardKind(b) === 'done') || String(b.updated_at).localeCompare(String(a.updated_at))),
    }))
    .filter((g) => g.cards.length)
  return html`<div class="page page-narrow">
    <${PageHead} kicker="Geteilt" title=${name ? `Hallo ${name}` : 'Mit dir geteilt'} />
    <p class="muted">Hier siehst du die Aufgaben, die das Team der beQ mit dir teilt. Du kannst Notizen schreiben und Spalte, Dringlichkeit und Fälligkeit ändern.</p>
    ${!groups.length && html`<${Empty}>Gerade ist nichts mit dir geteilt.<//>`}
    ${groups.map(
      (g) => html`<${Tile} key=${g.project.id} title=${html`<span class="meta-item"><${Dot} color=${g.project.color} />${g.project.name}</span>`} count=${g.cards.length}>
        <ul class="task-list">${g.cards.map((c) => html`<${TaskRow} card=${c} key=${c.id} />`)}</ul>
      <//>`
    )}
  </div>`
}
