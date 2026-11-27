// Aufgabe (Detailansicht): öffnet sich über der aktuellen Seite, am Rechner rechts, auf dem Handy bildschirmfüllend.
// Gäste sehen eine schlanke Fassung: nur Spalte, Dringlichkeit und Fälligkeit änderbar, dazu Notizen.
import { html, useState, useEffect } from '../lib/preact.js'
import { Icon } from '../lib/icons.js'
import { fmtDate, fmtDateTime, fmtRelative, norm, telHref, firstName } from '../lib/util.js'
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
  toast,
  isGuest,
  myActiveMailboxes,
  activeGuests,
  sharesOf,
  markCardSeen,
  isPinned,
  togglePin,
  state,
  spurFor,
  emailsOfPersons,
  myEmail,
  assignCard,
  activitiesOfCard,
  answerFor,
  activeMembers,
  setCoAssignees,
} from '../store.js'
import { closeCard } from '../router.js'
import { Field, MultiSelect, PriorityPicker, ProjectSelect, EntityPicker, Notes, Dot, LinkText, brandSafe, LabelPicker, Labels, useOverlay } from './common.js'
import { History } from './history.js'
import { CardFiles } from './files.js'
import { CardDeal } from './deal.js'
import { ActivitySection } from './activities.js'
import { openReply, openNewMail } from './postfach.js'
import { wroteWhen } from './overview.js'
import { t, isEnglish, stageLabel } from '../i18n.js'

// Betreff, Titel und ähnliche Daten in Anführungszeichen der gewählten Sprache
const quoted = (s) => (isEnglish() ? `“${s}”` : `„${s}“`)

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
    <div class="share-label"><${Icon} name="share" size=${16} /> ${t('Teilen mit')}</div>
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
        ? t('Geteilt: Der Gast sieht diesen Deal mit Kontakt, Firma und Notizen. Notizen mit „Nur intern“, Mails, Meetings und andere Deals bleiben verborgen.')
        : t('Nur das Team sieht diesen Deal.')}
    </p>
  </div>`
}

// Zuständig als Klappliste (Wunsch vom 24.11.2026, vorher Knöpfe): „Niemand“, „Ich“, dann das
// Team, dann Gäste. Eine Auswahl speichert. Gäste sehen nur „Niemand“, „Ich“ und das Team (sie
// dürfen keinem anderen Gast zuweisen).
function AssigneePicker({ card, id = 'card-assignee' }) {
  const me = norm(myEmail())
  const current = norm(card.assignee || '')
  const guestMode = isGuest()
  const byName = (a, b) => a.name.localeCompare(b.name, 'de')
  const others = state.db.team_members.filter((m) => m.active && norm(m.email) !== me)
  const team = others.filter((m) => m.role !== 'gast').sort(byName)
  const guests = guestMode ? [] : others.filter((m) => m.role === 'gast').sort(byName)
  // Zuständig ist jemand, der nicht mehr aktiv ist: trotzdem anzeigen
  const missing = current && current !== me && !others.some((m) => norm(m.email) === current)
  const value = !current ? '' : current === me ? me : current
  const onChange = (e) => {
    const v = e.target.value
    if (norm(v) !== current) assignCard(card, v || null)
  }
  return html`<select id=${id} class="assignee-select" value=${value} onChange=${onChange}>
    <option value="">${t('Niemand')}</option>
    <option value=${me}>${t('Ich')}</option>
    ${team.map((m) => html`<option value=${norm(m.email)}>${m.name}</option>`)}
    ${guests.length > 0 && html`<optgroup label=${t('Gäste')}>${guests.map((m) => html`<option value=${norm(m.email)}>${m.name}</option>`)}</optgroup>`}
    ${missing && html`<option value=${current}>${memberName(card.assignee)}</option>`}
  </select>`
}

// Weitere Zuständige (36_meine_pipeline.sql): nur Teammitglieder, nie Gäste, nie die Hauptperson.
// Die Aufgabe erscheint dann in der Pipeline aller Zuständigen. Ein Tipp schaltet um.
const MAX_CO = 10
function CoAssigneePicker({ card }) {
  const me = norm(myEmail())
  const main = norm(card.assignee || '')
  const list = (card.mitzustaendig || []).map(norm)
  const options = activeMembers().filter((m) => norm(m.email) !== main)
  // Wer nicht mehr aktiv ist, bleibt sichtbar, bis jemand ihn austrägt
  list.filter((e) => !options.some((m) => norm(m.email) === e)).forEach((e) => options.push({ email: e, name: memberName(e) }))
  if (!options.length) return null
  const toggle = (e, on) => {
    if (!on && list.length >= MAX_CO) return toast(t('Höchstens {n} weitere Zuständige je Deal.', { n: MAX_CO }), { error: true })
    setCoAssignees(card, on ? list.filter((x) => x !== e) : [...list, e])
  }
  return html`<${Field} label="Weitere zuständig" htmlFor="card-co-assignees">
    <${MultiSelect}
      id="card-co-assignees"
      label="Weitere zuständig"
      empty="Niemand weiter"
      options=${options.map((m) => ({ value: norm(m.email), label: norm(m.email) === me ? t('Ich') : m.name }))}
      value=${list}
      onToggle=${(e, on) => toggle(e, on)}
    />
  <//>`
}

function ContactActions({ person }) {
  if (!person) return null
  const phones = (person.phones || []).filter((x) => telHref(x)).slice(0, 2)
  const email = (person.emails || [])[0]
  if (!phones.length && !email) return null
  const canSend = !isGuest() && myActiveMailboxes().length > 0
  return html`<div class="contact-actions">
    ${phones.map(
      (ph) => html`<a class="btn btn-small" href=${telHref(ph)} key=${ph} aria-label=${t('{name} anrufen', { name: person.name }) + (phones.length > 1 ? ', ' + ph : '')}>
        <${Icon} name="phone" size=${16} /> ${phones.length > 1 ? ph : t('Anrufen')}
      </a>`
    )}
    ${email &&
    (canSend
      ? html`<button type="button" class="btn btn-small" onClick=${() => openNewMail(email)}><${Icon} name="mail" size=${16} /> ${t('Mail schreiben')}</button>`
      : html`<a class="btn btn-small" href=${'mailto:' + email}><${Icon} name="mail" size=${16} /> ${t('Mail schreiben')}</a>`)}
  </div>`
}

function PanelFrame({ card, project, children }) {
  return html`<div class="backdrop" onClick=${closeCard}>
    <aside class="panel" role="dialog" aria-modal="true" aria-label=${t('Deal') + ' ' + (card ? card.title : '')} onClick=${(e) => e.stopPropagation()}>
      <div class="panel-head">
        <div class="kicker">${project && html`<${Dot} color=${project.color} />`}${t('Deal')}${project ? ' · ' : ''}${project ? brandSafe(project.name) : ''}</div>
        <div class="panel-head-actions">
          ${card && !isGuest() && html`<${PinButton} card=${card} />`}
          <button type="button" class="icon-btn" aria-label=${t('Schließen')} onClick=${closeCard}><${Icon} name="x" /></button>
        </div>
      </div>
      <div class="panel-body">${children}</div>
    </aside>
  </div>`
}

// Anheften (47_angeheftet.sql): nur für mich, oben in meinen Pipelines und unter „Team“, wenn es
// Neues gibt. Gäste nie.
function PinButton({ card }) {
  const on = isPinned(card.id)
  return html`<button
    type="button"
    class=${'btn btn-small pin-btn' + (on ? ' on' : '')}
    aria-pressed=${on}
    title=${on ? t('Lösen') : t('Oben in deinen Pipelines anheften')}
    onClick=${() => togglePin(card.id)}
  >
    <${Icon} name="pin" size=${16} /> ${on ? t('Angeheftet') : t('Anheften')}
  </button>`
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
    <div class="answer-notice-text"><strong>${t('Antwort da:')}</strong> ${who} ${wroteWhen(a.sent_at)}${a.subject ? ': ' + quoted(a.subject) : ''}</div>
    ${mail && html`<button type="button" class="btn btn-small btn-primary" onClick=${() => openReply(mail)}><${Icon} name="reply" size=${16} /> ${t('Antworten')}</button>`}
  </div>`
}

// Mail-Verfolgung (27_mail_spur.sql): die letzte eigene verfolgte Mail an den Kontakt der
// Aufgabe (ohne Kontakt: an die Kontakte der Firma). Nur für den Absender, wie in der Mail.
function TrackedMailNotice({ card }) {
  const ids = card.person_id ? [card.person_id] : card.org_id ? state.db.persons.filter((p) => p.org_id === card.org_id).map((p) => p.id) : []
  if (!ids.length) return null
  const mail = emailsOfPersons(ids).find((m) => spurFor(m))
  if (!mail) return null
  const s = spurFor(mail)
  const last = fmtDateTime(s.zuletzt_geoeffnet)
  const opened =
    s.geoeffnet > 0
      ? s.geoeffnet === 1
        ? t('geöffnet einmal, zuletzt {date}', { date: last })
        : t('geöffnet {n}×, zuletzt {date}', { n: s.geoeffnet, date: last })
      : t('noch nicht geöffnet')
  const clicked = s.geklickt > 0 ? t(', Link angeklickt {date}', { date: fmtDateTime(s.zuletzt_geklickt) }) : ''
  return html`<div class="spur-notice" role="status">
    <${Icon} name="eye" size=${18} />
    <div class="spur-notice-text">${t('Deine Mail {subject} vom {date}: {status}.', { subject: quoted(mail.subject || t('ohne Betreff')), date: fmtDate(mail.sent_at), status: opened + clicked })}</div>
  </div>`
}

// Spalte als Klappliste (Wunsch vom 24.11.2026, vorher Knöpfe)
function StagePicker({ card }) {
  const stages = stagesOf(card.project_id)
  return html`<${Field} label="Spalte" htmlFor="card-stage">
    <select id="card-stage" value=${card.stage_id} onChange=${(e) => e.target.value !== card.stage_id && update('cards', card.id, { stage_id: e.target.value })}>
      ${stages.map((s) => html`<option value=${s.id}>${stageLabel(s.name)}</option>`)}
    </select>
  <//>`
}

function DueField({ card }) {
  return html`<${Field} label="Fällig am" htmlFor="card-due">
    <div class="with-clear">
      <input id="card-due" type="date" value=${card.due_date || ''} onChange=${(e) => update('cards', card.id, { due_date: e.target.value || null })} />
      ${card.due_date &&
      html`<button type="button" class="icon-btn small" aria-label=${t('Fälligkeit entfernen')} onClick=${() => update('cards', card.id, { due_date: null })}>
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
      ${person && html`<dt>${t('Kontakt')}</dt><dd>${person.name}<${ContactActions} person=${person} /></dd>`}
      ${org && html`<dt>${t('Firma')}</dt><dd>${org.name}</dd>`}
      ${(card.labels || []).length > 0 && html`<dt>${t('Labels')}</dt><dd><${Labels} labels=${card.labels} /></dd>`}
    </dl>
    <${StagePicker} card=${card} />
    <${Field} label="Zuständig" htmlFor="card-assignee"><${AssigneePicker} card=${card} /><//>
    <div class="field-grid">
      <${DueField} card=${card} />
      <${Field} label="Dringlichkeit"><${PriorityPicker} value=${card.priority} onChange=${(v) => update('cards', card.id, { priority: v })} /><//>
    </div>
    <${ActivitySection} list=${activitiesOfCard(card.id)} here="card" target=${{ card_id: card.id }} card=${card} />
    <${CardFiles} card=${card} />
    <${History} card=${card} />
    <h3 class="section-title">${t('Notizen')}</h3>
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

  // Escape schließt nur das oberste Fenster (B14), zum Beispiel die Aufgabe über dem Archiv
  useOverlay(closeCard)

  if (!card) {
    return html`<${PanelFrame} card=${null} project=${null}><p class="empty">${t('Diesen Deal gibt es nicht mehr.')}</p><//>`
  }
  if (isGuest()) return html`<${GuestCard} card=${card} />`

  const project = getProject(card.project_id)
  const stages = stagesOf(card.project_id)
  const meeting = getMeeting(card.meeting_id)
  const set = (patch) => update('cards', card.id, patch)

  const saveTitle = () => {
    const text = title.trim()
    if (!text) setTitle(card.title)
    else if (text !== card.title) set({ title: text })
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

  return html`<${PanelFrame} card=${card} project=${project}>
    <textarea
      class="title-input"
      rows="2"
      value=${title}
      aria-label=${t('Titel')}
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
    <${TrackedMailNotice} card=${card} />
    ${card.archived &&
    html`<p class="notice">
      ${t('Dieser Deal liegt im Archiv. Du findest ihn auf dem Board unter „Erledigt“ über den Link „Archiv“. „Aus dem Archiv holen“ unten holt sie zurück.')}
    </p>`}

    ${/* Abschnitte (Wunsch vom 24.11.2026): Überblick, Wert und Status, Aktivitäten, dann Beschreibung,
      Notizen, Dateien und Verlauf. Jeder Abschnitt als Fläche mit Überschrift. */ ''}
    <section class="deal-section" aria-labelledby="deal-sec-overview">
      <h3 class="deal-section-title" id="deal-sec-overview">${t('Überblick')}</h3>
      <div class="field-grid">
        <${StagePicker} card=${card} />
        <${Field} label="Pipeline" htmlFor="card-project">
          <${ProjectSelect} id="card-project" value=${card.project_id} onChange=${changeProject} />
        <//>
        <${Field} label="Zuständig" htmlFor="card-assignee"><${AssigneePicker} card=${card} /><//>
        <${CoAssigneePicker} card=${card} />
        <${DueField} card=${card} />
        <${Field} label="Dringlichkeit">
          <${PriorityPicker} value=${card.priority} onChange=${(v) => set({ priority: v })} />
        <//>
      </div>
      ${card.vergeben_von && norm(card.vergeben_von) !== norm(card.assignee || '') &&
      html`<p class="muted small handed-by">${norm(card.vergeben_von) === norm(myEmail()) ? t('Vergeben von dir') : t('Vergeben von {name}', { name: memberName(card.vergeben_von) })}</p>`}
      <div class="field-grid">
        <${Field} label="Kontakt" htmlFor="card-person">
          <${EntityPicker} kind="person" inputId="card-person" value=${card.person_id} onChange=${changePerson} placeholder="Kontakt suchen oder neu anlegen" />
          <${ContactActions} person=${getPerson(card.person_id)} />
        <//>
        <${Field} label="Firma" htmlFor="card-org">
          <${EntityPicker} kind="org" inputId="card-org" value=${card.org_id} onChange=${(v) => set({ org_id: v })} placeholder="Firma suchen oder neu anlegen" />
        <//>
      </div>
      <${Field} label="Labels">
        <${LabelPicker} value=${card.labels} inputId="card-label" onChange=${(labels) => set({ labels })} />
      <//>
      <${ShareRow} card=${card} />
    </section>

    <section class="deal-section deal-section-sales">
      <${CardDeal} card=${card} />
    </section>

    <section class="deal-section">
      <${ActivitySection} list=${activitiesOfCard(card.id)} here="card" target=${{ card_id: card.id }} card=${card} />
    </section>

    <section class="deal-section" aria-labelledby="deal-sec-desc">
      <h3 class="deal-section-title" id="deal-sec-desc">${t('Beschreibung')}</h3>
      <textarea
        id="card-desc"
        rows="4"
        aria-labelledby="deal-sec-desc"
        value=${description}
        placeholder=${t('Details, Links, nächste Schritte')}
        onInput=${(e) => setDescription(e.target.value)}
        onBlur=${saveDescription}
      ></textarea>
      ${meeting &&
      html`<p class="meeting-origin">
        <${Icon} name="meetings" size=${16} /> ${t('Aus dem Meeting')} <a href=${'#/meetings/' + meeting.id}>${quoted(meeting.title)}</a> ${t('vom {date}', { date: fmtDate(meeting.held_at) })}
      </p>`}
    </section>

    <section class="deal-section" aria-labelledby="deal-sec-notes">
      <h3 class="deal-section-title" id="deal-sec-notes">${t('Notizen')}</h3>
      <${Notes} field="card_id" id=${card.id} />
    </section>

    <section class="deal-section">
      <${CardFiles} card=${card} />
    </section>

    <section class="deal-section">
      <${History} card=${card} />
    </section>

    <div class="panel-foot">
      <span class="muted small">${t('Angelegt von {name} {when}', { name: memberName(card.created_by) || t('unbekannt'), when: fmtRelative(card.created_at) })}</span>
      <div class="panel-actions">
        ${/* Deals nur archivieren, nie löschen (44_deals_nur_archivieren.sql, Wunsch vom 25.11.2026) */ ''}
        <button type="button" class="btn" onClick=${() => set({ archived: !card.archived })}>
          <${Icon} name="archive" size=${16} /> ${card.archived ? t('Aus dem Archiv holen') : t('Archivieren')}
        </button>
      </div>
    </div>
  <//>`
}
