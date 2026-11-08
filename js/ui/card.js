// Aufgabe (Detailansicht): öffnet sich über der aktuellen Seite, am Rechner rechts, auf dem Handy bildschirmfüllend.
// Gäste sehen eine schlanke Fassung: nur Spalte, Dringlichkeit und Fälligkeit änderbar, dazu Notizen.
import { html, useState, useEffect } from '../lib/preact.js'
import { Icon } from '../lib/icons.js'
import { fmtDate, fmtRelative, norm } from '../lib/util.js'
import {
  getCard,
  getProject,
  getPerson,
  getOrg,
  getMeeting,
  stagesOf,
  stageOfKind,
  update,
  insert,
  remove,
  memberName,
  confirmDialog,
  toast,
  isGuest,
  activeGuests,
  sharesOf,
  markCardSeen,
  state,
  myEmail,
  assignCard,
  activitiesOfCard,
  answerFor,
} from '../store.js'
import { closeCard } from '../router.js'
import { Field, PriorityPicker, ProjectSelect, EntityPicker, Notes, Dot, LinkText, brandSafe, LabelPicker, Labels } from './common.js'
import { History } from './history.js'
import { CardFiles } from './files.js'
import { CardDeal } from './deal.js'
import { ActivitySection } from './activities.js'
import { openReply } from './postfach.js'
import { wroteWhen } from './overview.js'

// Teilen mit Gästen: antippen teilt, noch einmal antippen nimmt es zurück
function ShareRow({ card }) {
  const guests = activeGuests()
  if (!guests.length) return null
  const shares = sharesOf(card.id)
  const toggle = (g) => {
    const existing = shares.find((s) => norm(s.email) === norm(g.email))
    if (existing) remove('card_shares', existing.id)
    else insert('card_shares', { card_id: card.id, email: g.email })
  }
  return html`<div class="share-row">
    <div class="share-label"><${Icon} name="share" size=${16} /> Teilen mit</div>
    <div class="chips">
      ${guests.map((g) => {
        const on = shares.some((s) => norm(s.email) === norm(g.email))
        return html`<button type="button" class=${'chip-btn' + (on ? ' active' : '')} aria-pressed=${on} onClick=${() => toggle(g)}>
          ${on && html`<${Icon} name="check" size=${14} />`} ${g.name}
        </button>`
      })}
    </div>
    <p class="muted small">
      ${shares.length
        ? 'Geteilt: Der Gast sieht diese Aufgabe mit Kontakt, Firma und Notizen. Notizen mit „Nur intern“, Mails, Meetings und andere Aufgaben bleiben verborgen.'
        : 'Nur das Team sieht diese Aufgabe.'}
    </p>
  </div>`
}

// Zuständig als Knöpfe: „Niemand“, „Ich“, dann das Team, dann Gäste. Ein Tipp speichert.
// Gäste sehen nur „Niemand“, „Ich“ und das Team (sie dürfen keinem anderen Gast zuweisen).
function AssigneePicker({ card }) {
  const me = norm(myEmail())
  const current = norm(card.assignee || '')
  const guestMode = isGuest()
  const byName = (a, b) => a.name.localeCompare(b.name, 'de')
  const others = state.db.team_members.filter((t) => t.active && norm(t.email) !== me)
  const options = [
    { value: null, label: 'Niemand' },
    { value: myEmail(), label: 'Ich' },
    ...others.filter((t) => t.role !== 'gast').sort(byName).map((t) => ({ value: t.email, label: t.name })),
    ...(guestMode ? [] : others.filter((t) => t.role === 'gast').sort(byName).map((t) => ({ value: t.email, label: t.name, guest: true }))),
  ]
  // Zuständig ist jemand, der nicht mehr aktiv ist: trotzdem anzeigen
  if (current && current !== me && !options.some((o) => o.value && norm(o.value) === current)) {
    options.push({ value: card.assignee, label: memberName(card.assignee) })
  }
  return html`<div class="chips assignee-picker" role="group" aria-label="Zuständig">
    ${options.map((o) => {
      const on = o.value ? norm(o.value) === current : !current
      return html`<button
        type="button"
        class=${'chip-btn' + (on ? ' active' : '')}
        aria-pressed=${on}
        onClick=${() => !on && assignCard(card, o.value)}
      >
        ${o.label}${o.guest && html`<span class="chip-note">Gast</span>`}
      </button>`
    })}
  </div>`
}

function PanelFrame({ card, project, children }) {
  return html`<div class="backdrop" onClick=${closeCard}>
    <aside class="panel" role="dialog" aria-modal="true" aria-label=${'Aufgabe ' + (card ? card.title : '')} onClick=${(e) => e.stopPropagation()}>
      <div class="panel-head">
        <div class="kicker">${project && html`<${Dot} color=${project.color} />`}Aufgabe${project ? ' · ' : ''}${project ? brandSafe(project.name) : ''}</div>
        <button type="button" class="icon-btn" aria-label="Schließen" onClick=${closeCard}><${Icon} name="x" /></button>
      </div>
      <div class="panel-body">${children}</div>
    </aside>
  </div>`
}

// „Antwort da“ (Nachtrag Follow-up): ein Kontakt hat geschrieben, seit die Aufgabe zuletzt
// geändert wurde. „Antworten“ öffnet die Antwort auf genau diese Mail. Die Mail liegt immer in
// einem eigenen Postfach (Frage 14), also kann man auch daraus antworten.
function AnswerNotice({ card }) {
  const a = answerFor(card.id)
  if (!a) return null
  const mail = state.db.emails.find((m) => m.id === a.email_id)
  const who = a.from_name || (getPerson(card.person_id) || {}).name || a.from_email
  return html`<div class="answer-notice" role="status">
    <${Icon} name="mail" size=${18} />
    <div class="answer-notice-text"><strong>Antwort da:</strong> ${who} ${wroteWhen(a.sent_at)}${a.subject ? html`: „${a.subject}“` : ''}</div>
    ${mail && html`<button type="button" class="btn btn-small btn-primary" onClick=${() => openReply(mail)}><${Icon} name="reply" size=${16} /> Antworten</button>`}
  </div>`
}

function StagePicker({ card }) {
  const stages = stagesOf(card.project_id)
  return html`<${Field} label="Spalte">
    <div class="stage-picker" role="group" aria-label="Spalte">
      ${stages.map(
        (s) => html`<button
          type="button"
          class=${'chip-btn' + (s.id === card.stage_id ? ' active' : '')}
          aria-pressed=${s.id === card.stage_id}
          onClick=${() => s.id !== card.stage_id && update('cards', card.id, { stage_id: s.id })}
        >
          ${s.name}
        </button>`
      )}
    </div>
  <//>`
}

function DueField({ card }) {
  return html`<${Field} label="Fällig am" htmlFor="card-due">
    <div class="with-clear">
      <input id="card-due" type="date" value=${card.due_date || ''} onChange=${(e) => update('cards', card.id, { due_date: e.target.value || null })} />
      ${card.due_date &&
      html`<button type="button" class="icon-btn small" aria-label="Fälligkeit entfernen" onClick=${() => update('cards', card.id, { due_date: null })}>
        <${Icon} name="x" size=${16} />
      </button>`}
    </div>
  <//>`
}

// Gast: nur ansehen, Spalte, Dringlichkeit, Fälligkeit, Notizen
function GuestCard({ card }) {
  const project = getProject(card.project_id)
  const person = getPerson(card.person_id)
  const org = getOrg(card.org_id)
  return html`<${PanelFrame} card=${card} project=${project}>
    <h2 class="panel-title">${card.title}</h2>
    ${card.description && html`<div class="prose"><${LinkText} text=${card.description} /></div>`}
    <dl class="card-facts">
      ${person && html`<dt>Kontakt</dt><dd>${person.name}</dd>`}
      ${org && html`<dt>Firma</dt><dd>${org.name}</dd>`}
      ${(card.labels || []).length > 0 && html`<dt>Labels</dt><dd><${Labels} labels=${card.labels} /></dd>`}
    </dl>
    <${StagePicker} card=${card} />
    <${Field} label="Zuständig"><${AssigneePicker} card=${card} /><//>
    <div class="field-grid">
      <${DueField} card=${card} />
      <${Field} label="Dringlichkeit"><${PriorityPicker} value=${card.priority} onChange=${(v) => update('cards', card.id, { priority: v })} /><//>
    </div>
    <${ActivitySection} list=${activitiesOfCard(card.id)} here="card" target=${{ card_id: card.id }} card=${card} />
    <${CardFiles} card=${card} />
    <${History} card=${card} />
    <h3 class="section-title">Notizen</h3>
    <${Notes} field="card_id" id=${card.id} />
  <//>`
}

export function CardPanel({ id }) {
  const card = getCard(id)
  const [title, setTitle] = useState(card ? card.title : '')
  const [description, setDescription] = useState(card ? card.description || '' : '')

  useEffect(() => {
    if (card) {
      setTitle(card.title)
      setDescription(card.description || '')
    }
    // Öffnen setzt „gesehen“, damit die Marke „Neu“ verschwindet
    markCardSeen(id)
  }, [id])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !document.querySelector('.modal')) closeCard()
    }
    window.addEventListener('keydown', onKey)
    document.body.classList.add('panel-open')
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.classList.remove('panel-open')
    }
  }, [])

  if (!card) {
    return html`<${PanelFrame} card=${null} project=${null}><p class="empty">Diese Aufgabe gibt es nicht mehr.</p><//>`
  }
  if (isGuest()) return html`<${GuestCard} card=${card} />`

  const project = getProject(card.project_id)
  const stages = stagesOf(card.project_id)
  const meeting = getMeeting(card.meeting_id)
  const set = (patch) => update('cards', card.id, patch)

  const saveTitle = () => {
    const t = title.trim()
    if (!t) setTitle(card.title)
    else if (t !== card.title) set({ title: t })
  }
  const saveDescription = () => {
    const d = description.trim()
    if (d !== (card.description || '')) set({ description: d || null })
  }

  // Projekt wechseln: Spalte gleicher Art im neuen Projekt
  const changeProject = (projectId) => {
    if (!projectId || projectId === card.project_id) return
    const oldStage = stages.find((s) => s.id === card.stage_id)
    const target = stageOfKind(projectId, oldStage ? oldStage.kind : 'todo')
    set({ project_id: projectId, stage_id: target && target.id })
  }

  // Kontakt wählen: Firma des Kontakts übernehmen, wenn noch keine gesetzt ist
  const changePerson = (personId) => {
    const patch = { person_id: personId }
    const person = getPerson(personId)
    if (person && person.org_id && !card.org_id) patch.org_id = person.org_id
    set(patch)
  }

  const del = async () => {
    const ok = await confirmDialog({ title: 'Aufgabe löschen?', text: `„${card.title}“ und ihre Notizen sind danach weg.`, confirmLabel: 'Löschen', danger: true })
    if (!ok) return
    closeCard()
    await remove('cards', card.id)
    toast('Aufgabe gelöscht')
  }

  return html`<${PanelFrame} card=${card} project=${project}>
    <textarea
      class="title-input"
      rows="2"
      value=${title}
      aria-label="Titel"
      onInput=${(e) => setTitle(e.target.value)}
      onBlur=${saveTitle}
      onKeyDown=${(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.target.blur()
        }
      }}
    ></textarea>
    <${AnswerNotice} card=${card} />
    <${ShareRow} card=${card} />
    ${card.archived && html`<p class="notice">Diese Aufgabe liegt im Archiv.</p>`}

    <${StagePicker} card=${card} />
    <${Field} label="Zuständig"><${AssigneePicker} card=${card} /><//>

    <div class="field-grid">
      <${Field} label="Projekt" htmlFor="card-project">
        <${ProjectSelect} id="card-project" value=${card.project_id} onChange=${changeProject} />
      <//>
      <${DueField} card=${card} />
      <${Field} label="Dringlichkeit">
        <${PriorityPicker} value=${card.priority} onChange=${(v) => set({ priority: v })} />
      <//>
      <${Field} label="Kontakt" htmlFor="card-person">
        <${EntityPicker} kind="person" inputId="card-person" value=${card.person_id} onChange=${changePerson} placeholder="Kontakt suchen oder neu anlegen" />
      <//>
      <${Field} label="Firma" htmlFor="card-org">
        <${EntityPicker} kind="org" inputId="card-org" value=${card.org_id} onChange=${(v) => set({ org_id: v })} placeholder="Firma suchen oder neu anlegen" />
      <//>
    </div>

    <${Field} label="Labels">
      <${LabelPicker} value=${card.labels} inputId="card-label" onChange=${(labels) => set({ labels })} />
    <//>

    <${Field} label="Beschreibung" htmlFor="card-desc">
      <textarea
        id="card-desc"
        rows="4"
        value=${description}
        placeholder="Details, Links, nächste Schritte"
        onInput=${(e) => setDescription(e.target.value)}
        onBlur=${saveDescription}
      ></textarea>
    <//>

    ${meeting &&
    html`<p class="meeting-origin">
      <${Icon} name="meetings" size=${16} /> Aus dem Meeting <a href=${'#/meetings/' + meeting.id}>„${meeting.title}“</a> vom ${fmtDate(meeting.held_at)}
    </p>`}

    <${ActivitySection} list=${activitiesOfCard(card.id)} here="card" target=${{ card_id: card.id }} card=${card} />
    <${CardDeal} card=${card} />
    <${CardFiles} card=${card} />
    <${History} card=${card} />
    <h3 class="section-title">Notizen</h3>
    <${Notes} field="card_id" id=${card.id} />

    <div class="panel-foot">
      <span class="muted small">Angelegt von ${memberName(card.created_by) || 'unbekannt'} ${fmtRelative(card.created_at)}</span>
      <div class="panel-actions">
        <button type="button" class="btn" onClick=${() => set({ archived: !card.archived })}>
          <${Icon} name="archive" size=${16} /> ${card.archived ? 'Aus dem Archiv holen' : 'Archivieren'}
        </button>
        <button type="button" class="btn btn-danger-text" onClick=${del}><${Icon} name="trash" size=${16} /> Löschen</button>
      </div>
    </div>
  <//>`
}
