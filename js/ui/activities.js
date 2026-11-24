// Aktivitäten (Gesamtprompt Fassung 6, Nachtrag vom 08.11.2026, B4 und B7): geplante Schritte mit
// Datum an Aufgabe, Kontakt und Firma. Ein Bereich im Fenster der Aufgabe und eine Kachel auf der
// Kontakt- und Firmenseite. Kontakt und Firma zeigen auch die Aktivitäten ihrer Aufgaben, die
// Firma zusätzlich die ihrer Kontakte, jeweils mit Link.
// Abhaken fragt „Erledigt. Nächsten Schritt planen?“. Gelöscht wird selten (nur eigene oder als
// Admin), Erledigtes bleibt aufklappbar mit „Wieder öffnen“.
import { html, useState, useRef, useLayoutEffect } from '../lib/preact.js'
import { Icon } from '../lib/icons.js'
import { todayStr, addDays, fmtDate, norm, firstName } from '../lib/util.js'
import {
  ACTIVITY_KINDS,
  activityKind,
  activityText,
  activitySort,
  createActivity,
  update,
  completeActivity,
  reopenActivity,
  deleteActivity,
  canDeleteActivity,
  followUpIn,
  getCard,
  getPerson,
  getOrg,
  activeMembers,
  memberName,
  myEmail,
  isGuest,
  activityAreaFor,
} from '../store.js'
import { openCard } from '../router.js'
import { Tile, activityWhen } from './common.js'

const QUICK = [
  ['Heute', 0],
  ['Morgen', 1],
  ['In 3 Tagen', 3],
  ['In 1 Woche', 7],
  ['In 2 Wochen', 14],
]

// Bereich (36_meine_pipeline.sql): „Sales“ an Kontakt, Firma oder Aufgabe mit Deal, sonst „intern“.
// Vorgeschlagen, änderbar, danach fest an der Aktivität.
export const AREAS = [
  { value: 'intern', label: 'Intern' },
  { value: 'sales', label: 'Sales' },
]

// Formular zum Anlegen und Ändern. Enter legt an, Escape schließt nur das Formular.
// target: woran die Aktivität hängt (für den Vorschlag „intern“ oder „Sales“)
export function ActivityForm({ initial, target = {}, onSave, onCancel, onDelete }) {
  const [art, setArt] = useState(initial.art || 'wiedervorlage')
  const [bereich, setBereich] = useState(initial.bereich || activityAreaFor({ ...target, ...initial }))
  const [zustaendig, setZustaendig] = useState(initial.zustaendig || '')
  const onCard = !!(initial.card_id || target.card_id)
  const [faellig, setFaellig] = useState(initial.faellig || addDays(todayStr(), 1))
  const [uhrzeit, setUhrzeit] = useState(initial.uhrzeit ? String(initial.uhrzeit).slice(0, 5) : '')
  const [titel, setTitel] = useState(initial.titel || '')
  const textRef = useRef()
  // Das Formular erscheint erst nach einem Klick, „autofocus“ greift dort nicht
  useLayoutEffect(() => {
    if (textRef.current) textRef.current.focus()
  }, [])

  const submit = (e) => {
    e.preventDefault()
    if (!faellig) return
    const fields = { art, faellig, uhrzeit: uhrzeit || null, titel: titel.trim() || null, bereich }
    if (!isGuest()) fields.zustaendig = zustaendig || null
    onSave(fields)
  }
  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onCancel()
    }
  }
  return html`<form class="act-form" onSubmit=${submit} onKeyDown=${onKeyDown}>
    <div class="act-kinds chips" role="group" aria-label="Art">
      ${ACTIVITY_KINDS.map(
        (k) => html`<button type="button" class=${'chip-btn small' + (k.value === art ? ' active' : '')} aria-pressed=${k.value === art} onClick=${() => setArt(k.value)}>
          <${Icon} name=${k.icon} size=${14} /> ${k.label}
        </button>`
      )}
    </div>
    <div class="act-quick chips" role="group" aria-label="Wann">
      ${QUICK.map(([label, n]) => {
        const d = addDays(todayStr(), n)
        return html`<button type="button" class=${'chip-btn small' + (d === faellig ? ' active' : '')} aria-pressed=${d === faellig} onClick=${() => setFaellig(d)}>${label}</button>`
      })}
    </div>
    <div class="act-when">
      <input type="date" value=${faellig} required aria-label="Datum" onInput=${(e) => setFaellig(e.target.value)} />
      <input type="time" value=${uhrzeit} aria-label="Uhrzeit, freiwillig" onInput=${(e) => setUhrzeit(e.target.value)} />
    </div>
    <div class="act-who">
      <div class="chips act-area" role="group" aria-label="Bereich">
        ${AREAS.map(
          (x) => html`<button type="button" class=${'chip-btn small' + (x.value === bereich ? ' active' : '')} aria-pressed=${x.value === bereich} onClick=${() => setBereich(x.value)}>${x.label}</button>`
        )}
      </div>
      ${!isGuest() &&
      html`<select class="act-holder" value=${zustaendig} aria-label="Zuständig" onChange=${(e) => setZustaendig(e.target.value)}>
        <option value="">${onCard ? 'Zuständig wie beim Deal' : 'Zuständig: wer sie anlegt'}</option>
        ${activeMembers().map((t) => html`<option value=${norm(t.email)}>${norm(t.email) === norm(myEmail()) ? 'Ich' : t.name}</option>`)}
        ${zustaendig && !activeMembers().some((t) => norm(t.email) === zustaendig) && html`<option value=${zustaendig}>${memberName(zustaendig)}</option>`}
      </select>`}
    </div>
    <input
      ref=${textRef}
      class="act-text"
      value=${titel}
      placeholder=${'Was genau? Leer heißt „' + activityKind(art).label + '“'}
      aria-label="Text"
      onInput=${(e) => setTitel(e.target.value)}
    />
    <div class="act-form-actions">
      ${onDelete && html`<button type="button" class="btn btn-danger-text" onClick=${onDelete}><${Icon} name="trash" size=${16} /> Löschen</button>`}
      <span class="act-spacer"></span>
      <button type="button" class="btn" onClick=${onCancel}>Abbrechen</button>
      <button type="submit" class="btn btn-primary">${initial.id ? 'Speichern' : 'Anlegen'}</button>
    </div>
  </form>`
}

// Wohin gehört die Aktivität? Nur auf Kontakt- und Firmenseite gezeigt.
function ActivityContext({ a, here }) {
  const card = a.card_id ? getCard(a.card_id) : null
  if (card && here !== 'card') {
    return html`<button type="button" class="act-context link-btn" onClick=${() => openCard(card.id)}>Deal „${card.title}“</button>`
  }
  const person = !card && a.person_id ? getPerson(a.person_id) : null
  if (person && here === 'org') return html`<a class="act-context" href=${'#/kontakte/' + person.id}>${person.name}</a>`
  return null
}

function ActivityItem({ a, here, onEdit, onDone }) {
  const kind = activityKind(a.art)
  const when = activityWhen(a)
  const other = a.zustaendig && norm(a.zustaendig) !== norm(myEmail())
  return html`<li class="act-item">
    <button type="button" class="check" title="Abhaken" aria-label=${'Abhaken: ' + activityText(a)} onClick=${() => onDone(a)}>
      <${Icon} name="check" size=${16} />
    </button>
    <div class="act-body">
      <button type="button" class="act-main" title="Ändern" onClick=${() => onEdit(a)}>
        <${Icon} name=${kind.icon} size=${16} />
        <span class="act-title">${activityText(a)}</span>
      </button>
      <${ActivityContext} a=${a} here=${here} />
    </div>
    ${other && html`<span class="muted small act-holder-name" title="Zuständig">${firstName(memberName(a.zustaendig))}</span>`}
    <span class=${'badge due-' + when.tone}>${when.text}</span>
  </li>`
}

function DoneItem({ a, here }) {
  const kind = activityKind(a.art)
  return html`<li class="act-item act-done">
    <span class="check checked" aria-hidden="true"><${Icon} name="check" size=${16} /></span>
    <div class="act-body">
      <span class="act-main"><${Icon} name=${kind.icon} size=${16} /><span class="act-title">${activityText(a)}</span></span>
      <${ActivityContext} a=${a} here=${here} />
    </div>
    <span class="muted small">${fmtDate(String(a.erledigt_at).slice(0, 10))}</span>
    <button type="button" class="link-btn small" onClick=${() => reopenActivity(a)}>Wieder öffnen</button>
  </li>`
}

// Bereich „Aktivitäten“. here: 'card' (im Fenster der Aufgabe), 'person' oder 'org' (Kachel).
// target: woran neue Aktivitäten hängen ({ card_id } oder { person_id } oder { org_id }).
export function ActivitySection({ list, here, target, card }) {
  const [form, setForm] = useState(null)
  const [nextFor, setNextFor] = useState(null)
  const [showDone, setShowDone] = useState(false)
  const open = list.filter((a) => !a.erledigt_at).sort(activitySort)
  const done = list.filter((a) => a.erledigt_at).sort((a, b) => String(b.erledigt_at).localeCompare(String(a.erledigt_at)))

  // Ändern oder neu anlegen. Neu hängt am Ort des Bereichs, beim „Nächsten Schritt“ am Ort
  // der erledigten Aktivität.
  const save = async (fields) => {
    const current = form
    setForm(null)
    if (current.a) await update('aktivitaeten', current.a.id, fields)
    else await createActivity({ ...(current.target || target), ...fields })
  }
  const remove = async () => {
    const a = form.a
    if (await deleteActivity(a)) setForm(null)
  }
  const onDone = async (a) => {
    setNextFor(null)
    if (await completeActivity(a)) setNextFor(a)
  }
  const planNext = () => {
    const a = nextFor
    setNextFor(null)
    // Nächster Schritt am selben Ort wie der erledigte
    setForm({ a: null, target: { card_id: a.card_id, person_id: a.card_id ? null : a.person_id, org_id: a.card_id || a.person_id ? null : a.org_id } })
  }

  const add = html`<button type="button" class="link-btn" onClick=${() => { setNextFor(null); setForm({ a: null }) }}><${Icon} name="plus" size=${16} /> Aktivität</button>`
  const body = html`
    ${nextFor &&
    html`<div class="act-next" role="status">
      <span>Erledigt. Nächsten Schritt planen?</span>
      <button type="button" class="btn btn-small btn-primary" onClick=${planNext}>Planen</button>
      <button type="button" class="btn btn-small" onClick=${() => setNextFor(null)}>Nein</button>
    </div>`}
    ${form &&
    html`<${ActivityForm}
      key=${form.a ? form.a.id : 'neu'}
      initial=${form.a || {}}
      target=${form.target || target}
      onSave=${save}
      onCancel=${() => setForm(null)}
      onDelete=${form.a && canDeleteActivity(form.a) ? remove : null}
    />`}
    ${open.length
      ? html`<ul class="act-list">${open.map((a) => html`<${ActivityItem} key=${a.id} a=${a} here=${here} onEdit=${(x) => { setNextFor(null); setForm({ a: x }) }} onDone=${onDone} />`)}</ul>`
      : !form && html`<p class="empty">Keine geplant.</p>`}
    ${card &&
    html`<div class="act-followup">
      <span class="muted small">Wieder vorlegen</span>
      ${[[3, 'In 3 Tagen'], [7, 'In 1 Woche'], [14, 'In 2 Wochen']].map(
        ([n, label]) => html`<button type="button" class="chip-btn small" onClick=${() => followUpIn(card, n)}>${label}</button>`
      )}
    </div>`}
    ${done.length > 0 &&
    html`<div class="act-done-wrap">
      <button type="button" class="history-toggle" aria-expanded=${showDone} onClick=${() => setShowDone(!showDone)}>
        <${Icon} name="chevron" size=${16} /> Erledigt (${done.length})
      </button>
      ${showDone && html`<ul class="act-list">${done.map((a) => html`<${DoneItem} key=${a.id} a=${a} here=${here} />`)}</ul>`}
    </div>`}
  `

  if (here === 'card') {
    return html`<section class="activities">
      <div class="act-head">
        <h3 class="section-title">Aktivitäten ${open.length > 0 && html`<span class="count">${open.length}</span>`}</h3>
        ${add}
      </div>
      <p class="muted small act-explain">Nächste Schritte mit Datum: Anruf, Mail, Termin, To-do oder Wiedervorlage. Sie stehen in der Übersicht und in der Pipeline der zuständigen Person.</p>
      ${body}
    </section>`
  }
  return html`<${Tile} title="Aktivitäten" count=${open.length} actions=${add} cls="activities">${body}<//>`
}
