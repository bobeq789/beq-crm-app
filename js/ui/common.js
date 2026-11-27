// Bausteine, die mehrere Bereiche nutzen
import { html, useState, useEffect, useLayoutEffect, useRef } from '../lib/preact.js'
import { Icon } from '../lib/icons.js'
import { SETTINGS } from '../settings.js'
import { splitLinks, dueInfo, fmtRelative, matches, initials, norm, todayStr, dayDiff, parseYmd, fmtDate, telHref } from '../lib/util.js'
import {
  state,
  memberName,
  getProject,
  getPerson,
  getOrg,
  insert,
  update,
  remove,
  notesFor,
  confirmDialog,
  closeDialog,
  dismissToast,
  completeCard,
  cardKind,
  isGuest,
  myEmail,
  isNew,
  isMentioned,
  assignedToOther,
  saveNote,
  allLabels,
  openActivitiesOfCard,
  activityKind,
  activityText,
  completeActivity,
  avatarUrl,
  getCard,
  sharesOf,
  projectSharesOf,
  activeGuests,
} from '../store.js'
import { mentionPeople, parseMentions, NoteText } from './mentions.js'
import { openCard } from '../router.js'
import { t } from '../i18n.js'

// „beQ“ bleibt auch in Großbuchstaben-Zeilen (Kicker) richtig geschrieben
export function brandSafe(text) {
  if (typeof text !== 'string' || !/beQ/.test(text)) return text
  return text.split(/(beQ)/).map((part) => (part === 'beQ' ? html`<span class="brand-name">beQ</span>` : part))
}

export function PageHead({ kicker, title, actions, back }) {
  return html`<header class="page-head">
    <div class="page-head-text">
      ${back && html`<a class="back-link" href=${back.href}><${Icon} name="back" size=${16} /> ${t(back.label)}</a>`}
      ${kicker && html`<div class="kicker">${brandSafe(t(kicker))}</div>`}
      <h1 class="page-title">${t(title)}</h1>
    </div>
    ${actions && html`<div class="page-actions">${actions}</div>`}
  </header>`
}

// drag (nur Übersicht): { onPointerDown } macht den Kopf zum Griff zum Verschieben der Kachel
export function Tile({ title, count, actions, children, cls = '', drag = null }) {
  return html`<section class=${'tile ' + cls}>
    ${(title || actions) &&
    html`<div
      class=${'tile-head' + (drag ? ' tile-head-drag' : '')}
      onPointerDown=${drag ? drag.onPointerDown : undefined}
      onDragStart=${drag ? (e) => e.preventDefault() : undefined}
    >
      ${drag && html`<span class="tile-grip" title=${t('Ziehen zum Verschieben')} aria-hidden="true"><${Icon} name="grip" size=${18} /></span>`}
      <h2 class="tile-title">${t(title)}${count !== undefined && html` <span class="count">${count}</span>`}</h2>
      ${actions}
    </div>`}
    ${children}
  </section>`
}

// Hörer neben einem Kontakt (Nachtrag „Anrufen“, B7, B4): normaler tel:-Link über telHref.
// Kein Knopf, wenn sich keine Nummer sicher wählen lässt. Tippfläche 44 px (B12).
export function CallLink({ name, phones }) {
  const phone = (phones || []).find((x) => telHref(x))
  if (!phone) return null
  return html`<a class="call-btn" href=${telHref(phone)} aria-label=${t('{name} anrufen', { name: name || t('Kontakt') })} title=${t('Anrufen: {phone}', { phone })}>
    <${Icon} name="phone" size=${20} />
  </a>`
}

export function Empty({ children }) {
  return html`<p class="empty">${children}</p>`
}

// Farbiger Punkt für Projekte (Farbe als Attribut, damit der Dunkelmodus aufhellen kann)
export function Dot({ color }) {
  return html`<span class="dot" data-c=${(color || '').toUpperCase()} style=${{ background: color }}></span>`
}

// Rund: Profilfoto, wenn es eins gibt (38_profilfotos.sql), sonst die Initialen
export function Avatar({ email, name, size = 'sm' }) {
  const label = name || memberName(email)
  const url = email ? avatarUrl(email) : null
  if (url) return html`<img class=${'avatar avatar-img avatar-' + size} src=${url} alt="" title=${label} loading="lazy" />`
  return html`<span class=${'avatar avatar-' + size} title=${label}>${initials(label)}</span>`
}

export function DueBadge({ due, done }) {
  const info = dueInfo(due)
  if (!info) return null
  return html`<span class=${'badge due-' + (done ? 'later' : info.tone)}><${Icon} name="clock" size=${12} />${info.text}</span>`
}

// Wann ist eine Aktivität dran? Text und Ton wie bei der Fälligkeit (rot überfällig, Grün hell heute)
const WD_SHORT = ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.']
export function activityWhen(a) {
  const diff = dayDiff(todayStr(), a.faellig)
  const time = a.uhrzeit ? ' ' + String(a.uhrzeit).slice(0, 5) : ''
  if (diff < 0) return { text: diff === -1 ? t('seit gestern') : t('seit {n} Tagen', { n: -diff }), tone: 'overdue' }
  if (diff === 0) return { text: t('heute') + time, tone: 'today' }
  if (diff === 1) return { text: t('morgen') + time, tone: 'soon' }
  if (diff < 7) return { text: t(WD_SHORT[parseYmd(a.faellig).getDay()]) + time, tone: 'soon' }
  return { text: fmtDate(a.faellig) + time, tone: 'later' }
}

// Marke der nächsten offenen Aktivität einer Aufgabe: Symbol der Art und wann, rot wenn
// überfällig. Im Tooltip Art, Text und die Zahl weiterer.
export function ActivityBadge({ cardId }) {
  const open = openActivitiesOfCard(cardId)
  if (!open.length) return null
  const a = open[0]
  const kind = activityKind(a.art)
  const when = activityWhen(a)
  const more = open.length - 1
  const tip = t('Nächste Aktivität: {kind}', { kind: t(kind.label) }) + (a.titel ? ', ' + a.titel : '') + (more ? t(', dazu {n} weitere', { n: more }) : '')
  return html`<span class=${'badge act-badge due-' + when.tone} title=${tip} aria-label=${tip}><${Icon} name=${kind.icon} size=${12} />${when.text}</span>`
}

// Marke „Neu“: Kollegen haben seit meinem letzten Öffnen etwas geändert
export function NewBadge({ cardId }) {
  if (isMentioned(cardId)) return html`<span class="badge badge-new" title=${t('Du wurdest erwähnt')}>${t('@ dich')}</span>`
  if (!isNew(cardId)) return null
  return html`<span class="badge badge-new" title=${t('Kollegen haben seit deinem letzten Öffnen etwas geändert')}>${t('Neu')}</span>`
}

export function PrioBadge({ priority }) {
  if (!priority) return null
  const p = SETTINGS.priorities.find((x) => x.value === priority)
  return html`<span class=${'badge prio-' + priority}>${p ? t(p.label) : priority}</span>`
}

export function Labels({ labels }) {
  if (!labels || !labels.length) return null
  return html`<span class="labels">${labels.map((l) => html`<span class="label">${l}</span>`)}</span>`
}

// Text mit anklickbaren Links und Zeilenumbrüchen, ohne HTML
export function LinkText({ text }) {
  return html`<span class="linktext">${splitLinks(text).map((p) =>
    typeof p === 'string' ? p : html`<a href=${p.href} title=${p.title || p.href} target="_blank" rel="noopener noreferrer">${p.text}</a>`
  )}</span>`
}

export function Segmented({ options, value, onChange, label }) {
  return html`<div class="segmented" role="group" aria-label=${t(label)}>
    ${options.map(
      (o) => html`<button type="button" class=${value === o.value ? 'active' : ''} aria-pressed=${value === o.value} onClick=${() => onChange(o.value)}>
        ${t(o.label)}
      </button>`
    )}
  </div>`
}

// Dringlichkeit: drei Knöpfe, abwählbar
export function PriorityPicker({ value, onChange }) {
  return html`<div class="prio-picker" role="group" aria-label=${t('Dringlichkeit')}>
    ${SETTINGS.priorities.map(
      (p) => html`<button
        type="button"
        class=${'chip-btn prio-' + p.value + (value === p.value ? ' active' : '')}
        aria-pressed=${value === p.value}
        onClick=${() => onChange(value === p.value ? null : p.value)}
      >
        ${t(p.label)}
      </button>`
    )}
  </div>`
}

export function ProjectSelect({ value, onChange, includeArchived = false, allowEmpty = false, id }) {
  const list = state.db.projects.filter((p) => includeArchived || !p.archived || p.id === value).sort((a, b) => a.sort - b.sort)
  return html`<select id=${id} value=${value || ''} onChange=${(e) => onChange(e.target.value || null)}>
    ${allowEmpty && html`<option value="">${t('Keine Pipeline')}</option>`}
    ${list.map((p) => html`<option value=${p.id}>${p.name}</option>`)}
  </select>`
}

export function AssigneeSelect({ value, onChange, id, emptyLabel = 'Niemand' }) {
  const list = state.db.team_members
    .filter((t) => (t.active && t.role !== 'gast') || t.email === value)
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))
  return html`<select id=${id} value=${value || ''} onChange=${(e) => onChange(e.target.value || null)}>
    <option value="">${t(emptyLabel)}</option>
    ${list.map((t) => html`<option value=${t.email}>${t.name}</option>`)}
  </select>`
}

export function Field({ label, children, hint, htmlFor }) {
  return html`<div class="field">
    ${label && html`<label class="field-label" for=${htmlFor}>${t(label)}</label>`}
    ${children}
    ${hint && html`<div class="field-hint">${t(hint)}</div>`}
  </div>`
}

// Eine Zeile „Zu erledigen“: Haken, Titel, darunter Projekt, Kontakt, Zuständig und Marken
// checkActivity: in „Wiedervorlagen“ hakt der Kreis diese Aktivität ab, die Aufgabe bleibt.
export function TaskRow({ card, showSince, sinceText, checkActivity }) {
  const project = getProject(card.project_id)
  const person = getPerson(card.person_id)
  const org = getOrg(card.org_id)
  const done = cardKind(card) === 'done'
  return html`<li class="task-row">
    ${checkActivity
      ? html`<button
          type="button"
          class="check"
          title=${t('Aktivität abhaken, der Deal bleibt')}
          aria-label=${t('Aktivität „{name}“ abhaken, der Deal bleibt', { name: t(activityText(checkActivity)) })}
          onClick=${() => completeActivity(checkActivity)}
        >
          <${Icon} name="check" size=${16} />
        </button>`
      : html`<button
          type="button"
          class=${'check' + (done ? ' checked' : '')}
          title=${done ? t('Erledigt') : t('Abhaken')}
          aria-label=${t('„{name}“ abhaken', { name: card.title })}
          onClick=${() => !done && completeCard(card)}
        >
          <${Icon} name="check" size=${16} />
        </button>`}
    <div class="task-main">
      <button type="button" class="task-title" onClick=${() => openCard(card.id)}>${card.title}</button>
      <div class="task-meta">
        <${NewBadge} cardId=${card.id} />
        ${project && html`<span class="meta-item"><${Dot} color=${project.color} />${project.name}</span>`}
        ${(person || org) && html`<span class="meta-item muted">${person ? person.name : org.name}</span>`}
        ${assignedToOther(card) && html`<${Avatar} email=${card.assignee} />`}
        <${PrioBadge} priority=${card.priority} />
        ${!done && html`<${DueBadge} due=${card.due_date} />`}
        ${!done && html`<${ActivityBadge} cardId=${card.id} />`}
        ${showSince && html`<span class="badge due-later">${sinceText}</span>`}
      </div>
    </div>
  </li>`
}

// ------------------------------------------------------------
// Fenster (Dialog) mit dunklem Hintergrund
// ------------------------------------------------------------
// Fenster übereinander (B14): Jedes Fenster (Dialog, Aufgabe, Termin, Archiv) meldet sich beim
// Öffnen hier an. Escape schließt nur das oberste, also das zuletzt geöffnete. Die Seite dahinter
// bleibt gesperrt (body.panel-open), bis das letzte Fenster zu ist. Felder, die Escape selbst
// brauchen (Klapplisten, Suche), halten die Taste mit stopPropagation oder preventDefault an.
const overlayStack = []
// Anmelden gleich nach dem Zeichnen (useLayoutEffect), nicht verzögert wie bei useEffect: Sonst
// schloss ein schnelles Escape direkt nach dem Öffnen eines Dialogs das Fenster dahinter.
// Die Reihenfolge folgt dem ersten Zeichnen des Fensters.
let overlaySeq = 0
function onOverlayKey(e) {
  if (e.key !== 'Escape' || e.defaultPrevented || !overlayStack.length) return
  overlayStack[overlayStack.length - 1].current()
}
export function useOverlay(onClose) {
  const ref = useRef(onClose)
  ref.current = onClose
  if (!ref.seq) ref.seq = ++overlaySeq
  useLayoutEffect(() => {
    overlayStack.push(ref)
    overlayStack.sort((a, b) => a.seq - b.seq)
    if (overlayStack.length === 1) {
      window.addEventListener('keydown', onOverlayKey)
      document.body.classList.add('panel-open')
    }
    return () => {
      const i = overlayStack.lastIndexOf(ref)
      if (i >= 0) overlayStack.splice(i, 1)
      if (!overlayStack.length) {
        window.removeEventListener('keydown', onOverlayKey)
        document.body.classList.remove('panel-open')
      }
    }
  }, [])
}

export function Modal({ title, onClose, children, footer, wide = false, cls = '' }) {
  useOverlay(onClose)
  return html`<div class="backdrop" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div class=${'modal' + (wide ? ' modal-wide' : '') + (cls ? ' ' + cls : '')} role="dialog" aria-modal="true" aria-label=${t(title)}>
      <div class="modal-head">
        <h2 class="modal-title">${t(title)}</h2>
        <button type="button" class="icon-btn" aria-label=${t('Schließen')} onClick=${onClose}><${Icon} name="x" /></button>
      </div>
      <div class="modal-body">${children}</div>
      ${footer && html`<div class="modal-foot">${footer}</div>`}
    </div>
  </div>`
}

function ConfirmDialog({ d }) {
  const done = (v) => {
    closeDialog()
    d.resolve(v)
  }
  return html`<${Modal}
    title=${d.title}
    onClose=${() => done(false)}
    footer=${html`<button type="button" class="btn" onClick=${() => done(false)}>${t(d.cancelLabel || 'Abbrechen')}</button>
      <button type="button" class=${d.danger ? 'btn btn-danger' : 'btn btn-primary'} onClick=${() => done(true)}>${t(d.confirmLabel)}</button>`}
  >
    ${d.text && html`<p>${t(d.text)}</p>`}
  <//>`
}

function PromptDialog({ d }) {
  const [value, setValue] = useState(d.value || '')
  const ref = useRef()
  useEffect(() => ref.current && ref.current.focus(), [])
  const done = (v) => {
    closeDialog()
    d.resolve(v)
  }
  const submit = (e) => {
    e.preventDefault()
    if (value.trim()) done(value.trim())
  }
  return html`<${Modal} title=${d.title} onClose=${() => done(null)}>
    <form onSubmit=${submit}>
      <${Field} label=${d.label} htmlFor="prompt-input">
        <input id="prompt-input" ref=${ref} value=${value} onInput=${(e) => setValue(e.target.value)} />
      <//>
      <div class="form-actions">
        <button type="button" class="btn" onClick=${() => done(null)}>${t('Abbrechen')}</button>
        <button type="submit" class="btn btn-primary" disabled=${!value.trim()}>${t(d.confirmLabel)}</button>
      </div>
    </form>
  <//>`
}

// Wird in main.js mit weiteren Dialogarten ergänzt
export const dialogKinds = { confirm: ConfirmDialog, prompt: PromptDialog }

export function Dialogs() {
  const d = state.dialog
  if (!d) return null
  const Comp = dialogKinds[d.kind]
  return Comp ? html`<${Comp} d=${d} key=${d.kind} />` : null
}

export function Toasts() {
  return html`<div class="toasts" role="status" aria-live="polite">
    ${state.toasts.map(
      (x) => html`<div class=${'toast' + (x.error ? ' toast-error' : '')} key=${x.id}>
        <span class="toast-text">${t(x.text)}</span>
        ${x.action &&
        html`<button
          type="button"
          class="toast-action"
          onClick=${() => {
            dismissToast(x.id)
            x.action.run()
          }}
        >
          ${t(x.action.label)}
        </button>`}
        <button type="button" class="toast-close" aria-label=${t('Meldung schließen')} onClick=${() => dismissToast(x.id)}>
          <${Icon} name="x" size=${16} />
        </button>
      </div>`
    )}
  </div>`
}

// ------------------------------------------------------------
// Auswahl mit Suche: Kontakt oder Firma (mit „neu anlegen“)
// ------------------------------------------------------------
export function EntityPicker({ kind, value, onChange, placeholder, inputId }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const table = kind === 'person' ? 'persons' : 'organizations'
  const selected = value ? state.db[table].find((x) => x.id === value) : null
  const hrefBase = kind === 'person' ? '#/kontakte/' : '#/firmen/'

  if (selected) {
    const org = kind === 'person' ? getOrg(selected.org_id) : null
    return html`<div class="picked">
      <a class="picked-name" href=${hrefBase + selected.id}>${selected.name}</a>
      ${org && html`<span class="muted small">${org.name}</span>`}
      <button type="button" class="icon-btn small" aria-label=${t('Auswahl entfernen')} onClick=${() => onChange(null)}><${Icon} name="x" size=${16} /></button>
    </div>`
  }

  const results = q.trim()
    ? state.db[table]
        .filter((x) => (kind === 'person' ? matches(q, x.name, x.emails, (getOrg(x.org_id) || {}).name) : matches(q, x.name, x.website)))
        .sort((a, b) => a.name.localeCompare(b.name, 'de'))
        .slice(0, 6)
    : []
  const exact = results.some((r) => norm(r.name) === norm(q))

  const create = async () => {
    const name = q.trim()
    if (!name) return
    const row = await insert(table, { name })
    if (row) {
      onChange(row.id)
      setQ('')
    }
  }

  return html`<div class="picker">
    <input
      id=${inputId}
      value=${q}
      placeholder=${t(placeholder)}
      autocomplete="off"
      onInput=${(e) => {
        setQ(e.target.value)
        setOpen(true)
      }}
      onFocus=${() => setOpen(true)}
      onBlur=${() => setTimeout(() => setOpen(false), 150)}
      onKeyDown=${(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          if (results[0] && norm(results[0].name) === norm(q)) onChange(results[0].id)
          else if (results.length === 1) onChange(results[0].id)
        }
      }}
    />
    ${open &&
    q.trim() &&
    html`<ul class="picker-list" role="listbox">
      ${results.map(
        (r) => html`<li>
          <button type="button" onMouseDown=${(e) => e.preventDefault()} onClick=${() => onChange(r.id)}>
            <span>${r.name}</span>
            ${kind === 'person' && r.org_id && html`<span class="muted small">${(getOrg(r.org_id) || {}).name}</span>`}
          </button>
        </li>`
      )}
      ${!exact &&
      html`<li>
        <button type="button" class="picker-new" onMouseDown=${(e) => e.preventDefault()} onClick=${create}>
          <${Icon} name="plus" size=${16} /> ${kind === 'person' ? t('„{name}“ als neuen Kontakt anlegen', { name: q.trim() }) : t('„{name}“ als neue Firma anlegen', { name: q.trim() })}
        </button>
      </li>`}
    </ul>`}
  </div>`
}

// Liste mit mehreren Werten (E-Mails, Telefonnummern)
export function ListInput({ values, onChange, placeholder, type = 'text', addLabel, idPrefix }) {
  const list = values && values.length ? values : ['']
  const set = (i, v) => onChange(list.map((x, j) => (j === i ? v : x)))
  return html`<div class="list-input">
    ${list.map(
      (v, i) => html`<div class="list-input-row">
        <input id=${i === 0 ? idPrefix : undefined} type=${type} value=${v} placeholder=${t(placeholder)} onInput=${(e) => set(i, e.target.value)} />
        ${list.length > 1 &&
        html`<button type="button" class="icon-btn small" aria-label=${t('Entfernen')} onClick=${() => onChange(list.filter((_, j) => j !== i))}>
          <${Icon} name="x" size=${16} />
        </button>`}
      </div>`
    )}
    <button type="button" class="link-btn" onClick=${() => onChange([...list, ''])}><${Icon} name="plus" size=${16} /> ${t(addLabel)}</button>
  </div>`
}

// ------------------------------------------------------------
// Labels vergeben (Gesamtprompt Fassung 6, B7 und C7): vergebene Labels als Marken mit
// „entfernen“, „+ Label“ öffnet ein Feld mit eigener Klappliste (keine Vorschlagsliste des
// Browsers). Gilt bei Kontakt, Firma und Aufgabe, im Formular wie direkt auf der Seite.
// - Groß- und Kleinschreibung erzeugt kein zweites Label: „kunde“ wählt das vorhandene „Kunde“.
// - Ohne Tippen ist nichts markiert, ein versehentliches Enter vergibt also nichts.
// - Escape schließt nur die Liste (beim zweiten Mal das Feld), nie das Fenster dahinter.
// - Labels, die mit „Aus “ beginnen, vergibt der Abgleich selbst, die Liste bietet sie nicht an.
// ------------------------------------------------------------
const labelKey = (s) => String(s || '').trim().toLocaleLowerCase('de')
export const isAutoLabel = (l) => /^Aus /.test(String(l || ''))
const MAX_OFFERED = 12
let labelPickerSeq = 0

export function LabelPicker({ value, onChange, inputId }) {
  const current = value || []
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [listOpen, setListOpen] = useState(true)
  const [active, setActive] = useState(-1)
  const inputRef = useRef()
  const addRef = useRef()
  const backToAdd = useRef(false)
  // Beim Schließen verschwindet das Feld, der Browser meldet das als „Verlassen“. Das darf
  // dann keinen getippten Text mehr übernehmen und den Fokus nicht verlieren.
  const closing = useRef(false)
  const listId = useRef('label-list-' + ++labelPickerSeq).current

  // Das Feld erscheint erst nach dem Klick, „autofocus“ greift dort nicht. Fokus per ref, im
  // Layout-Effekt (gleich nach dem Zeichnen), damit sofort Getipptes nicht verloren geht.
  // Nach Escape springt der Fokus zurück auf „+ Label“.
  useLayoutEffect(() => {
    if (editing) closing.current = false
    if (editing && inputRef.current) inputRef.current.focus()
    if (!editing && backToAdd.current && addRef.current) {
      backToAdd.current = false
      addRef.current.focus()
    }
  }, [editing])

  const known = allLabels()
  const assigned = new Set(current.map(labelKey))
  const offerable = known.filter((l) => !isAutoLabel(l) && !assigned.has(labelKey(l)))
  const q = text.trim()
  const key = labelKey(q)
  const existing = q ? known.find((l) => labelKey(l) === key) : null
  // Genau gleich zuerst, dann was so anfängt, dann der Rest
  const rank = (l) => (labelKey(l) === key ? 0 : labelKey(l).startsWith(key) ? 1 : 2)
  const items = (q ? offerable.filter((l) => matches(q, l)).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'de')) : offerable)
    .slice(0, MAX_OFFERED)
    .map((l) => ({ label: l }))
  if (q && !existing) items.push({ label: q, isNew: true })
  const taken = !!q && assigned.has(key)
  const autoOnly = !!existing && isAutoLabel(existing) && !taken

  const add = (raw) => {
    const t = String(raw || '').trim()
    if (!t) return
    const found = known.find((l) => labelKey(l) === labelKey(t))
    // Schon hier vergeben, oder ein automatisches Label (die vergibt nur der Abgleich)
    if (assigned.has(labelKey(t)) || (found && isAutoLabel(found))) return
    const label = found || t
    onChange([...current, label])
    setText('')
    setActive(-1)
    setListOpen(true)
  }
  const close = (focusAdd) => {
    closing.current = true
    if (focusAdd) backToAdd.current = true
    setEditing(false)
    setText('')
    setActive(-1)
    setListOpen(true)
  }
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setListOpen(true)
      setActive((a) => Math.min(a + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, -1))
    } else if (e.key === 'Enter') {
      // Nie das Formular absenden. Ohne markierten Eintrag passiert nichts.
      e.preventDefault()
      if (listOpen && active >= 0 && items[active]) add(items[active].label)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (listOpen) setListOpen(false)
      else close(true)
    }
  }
  // Verlassen mit getipptem Text übernimmt den Begriff, ohne Text schließt es nur
  const onBlur = () => {
    if (closing.current) return
    if (q) add(q)
    close(false)
  }

  return html`<div class="label-picker">
    ${(current.length > 0 || !editing) &&
    html`<div class="label-chips">
      ${current.map(
        (l) => html`<span class="chip label-chip" key=${l}>
          ${l}
          <button type="button" aria-label=${t('Label „{name}“ entfernen', { name: l })} onClick=${() => onChange(current.filter((x) => x !== l))}>
            <${Icon} name="x" size=${14} />
          </button>
        </span>`
      )}
      ${!editing &&
      html`<button type="button" ref=${addRef} class="label-add" onClick=${() => setEditing(true)}><${Icon} name="plus" size=${14} /> ${t('Label')}</button>`}
    </div>`}
    ${editing &&
    html`<div class="picker label-editor">
      <input
        ref=${inputRef}
        id=${inputId}
        value=${text}
        placeholder=${t('Label suchen oder neu')}
        aria-label=${t('Label suchen oder neu')}
        autocomplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded=${listOpen}
        aria-controls=${listId}
        aria-activedescendant=${listOpen && active >= 0 && items[active] ? listId + '-' + active : undefined}
        onInput=${(e) => {
          setText(e.target.value)
          setListOpen(true)
          setActive(e.target.value.trim() ? 0 : -1)
        }}
        onKeyDown=${onKeyDown}
        onBlur=${onBlur}
      />
      ${listOpen &&
      html`<ul class="picker-list label-list" id=${listId} role="listbox" aria-label=${t('Labels')}>
        ${!q && html`<li class="picker-hint" role="presentation">${t('Neues Label: einfach eintippen')}</li>`}
        ${items.map(
          (it, i) => html`<li role="option" id=${listId + '-' + i} aria-selected=${i === active} key=${(it.isNew ? 'neu:' : '') + it.label}>
            <button type="button" tabindex="-1" class=${(it.isNew ? 'picker-new' : '') + (i === active ? ' is-active' : '')} onMouseDown=${(e) => e.preventDefault()} onClick=${() => add(it.label)}>
              ${it.isNew ? html`<${Icon} name="plus" size=${16} /> ${t('„{name}“ als neues Label anlegen', { name: it.label })}` : html`<span>${it.label}</span>`}
            </button>
          </li>`
        )}
        ${taken && html`<li class="picker-hint" role="presentation">${t('„{name}“ ist schon vergeben', { name: existing })}</li>`}
        ${autoOnly && html`<li class="picker-hint" role="presentation">${t('„{name}“ vergibt der Abgleich selbst', { name: existing })}</li>`}
        ${!q && !items.length && html`<li class="picker-hint" role="presentation">${t('Alle vorhandenen Labels sind hier schon vergeben.')}</li>`}
      </ul>`}
    </div>`}
  </div>`
}

// ------------------------------------------------------------
// Notizen an Aufgaben, Kontakten, Firmen und Meetings
// „Nur für das Team“ versteckt eine Notiz vor Gästen. Gäste ändern nur ihre eigenen Notizen.
// Der Schalter steht nur da, wo Gäste überhaupt mitlesen können (Wunsch vom 24.11.2026): an einem
// Deal, der selbst oder dessen Pipeline mit einem Gast geteilt ist, an Kontakten und Firmen nur,
// wenn es Gäste im Team gibt. Sonst ist ohnehin alles nur im Team.
// ------------------------------------------------------------
export function guestsCanSee(field, id) {
  if (field === 'card_id') {
    const card = getCard(id)
    return !!card && (sharesOf(id).length > 0 || projectSharesOf(card.project_id).length > 0)
  }
  if (field === 'meeting_id') return false
  return activeGuests().length > 0
}
function NoteItem({ note, guestRelevant }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(note.content)
  const guest = isGuest()
  const own = norm(note.author) === norm(myEmail())
  const canEdit = !guest || own
  const edited = note.updated_at && new Date(note.updated_at) - new Date(note.created_at) > 60000
  const save = async () => {
    if (!text.trim()) return
    const patch = { content: text.trim() }
    if (note.card_id && !note.internal) patch.mentions = parseMentions(patch.content, mentionPeople(note.card_id).all)
    await saveNote(patch, note.id)
    setEditing(false)
  }
  const cancel = () => {
    setText(note.content)
    setEditing(false)
  }
  const del = async () => {
    if (await confirmDialog({ title: t('Notiz löschen?'), text: t('Die Notiz ist danach weg.'), confirmLabel: t('Löschen'), danger: true })) {
      remove('notes', note.id)
    }
  }
  return html`<li class=${'note' + (note.internal ? ' note-internal' : '')}>
    ${editing
      ? html`<textarea rows="4" value=${text} aria-label=${t('Notiz bearbeiten')} onInput=${(e) => setText(e.target.value)}></textarea>
          <div class="form-actions">
            <button type="button" class="btn" onClick=${cancel}>${t('Abbrechen')}</button>
            <button type="button" class="btn btn-primary" disabled=${!text.trim()} onClick=${save}>${t('Speichern')}</button>
          </div>`
      : html`<div class="note-content"><${NoteText} text=${note.content} mentions=${note.mentions} /></div>`}
    <div class="note-meta">
      <span>
        ${note.internal && guestRelevant && html`<span class="note-lock" title=${t('Nur für das Team, Gäste sehen diese Notiz nicht')}><${Icon} name="lock" size=${14} /> ${t('Nur Team')} · </span>`}
        <${Avatar} email=${note.author} /> ${memberName(note.author) || t('Unbekannt')}${note.via === 'claude' ? ' ' + t('über Claude') : ''} · ${fmtRelative(note.created_at)}${edited ? ' · ' + t('bearbeitet') : ''}
      </span>
      ${!editing &&
      html`<span class="note-actions">
        ${!guest &&
        guestRelevant &&
        html`<button
          type="button"
          class="icon-btn small"
          aria-pressed=${!!note.internal}
          aria-label=${note.internal ? t('Für Gäste sichtbar machen') : t('Nur für das Team')}
          title=${note.internal ? t('Für Gäste sichtbar machen') : t('Nur für das Team')}
          onClick=${() => update('notes', note.id, { internal: !note.internal })}
        >
          <${Icon} name=${note.internal ? 'lock' : 'lockOpen'} size=${16} />
        </button>`}
        ${canEdit && html`<button type="button" class="icon-btn small" aria-label=${t('Notiz bearbeiten')} onClick=${() => setEditing(true)}><${Icon} name="edit" size=${16} /></button>`}
        ${!guest && html`<button type="button" class="icon-btn small" aria-label=${t('Notiz löschen')} onClick=${del}><${Icon} name="trash" size=${16} /></button>`}
      </span>`}
    </div>
  </li>`
}

export function Notes({ field, id }) {
  const [text, setText] = useState('')
  const [internal, setInternal] = useState(false)
  const area = useRef(null)
  const guest = isGuest()
  const guestRelevant = !guest && guestsCanSee(field, id)
  const list = notesFor(field, id)
  // Erwähnungen nur an Aufgaben und nicht bei „Nur intern“
  const people = field === 'card_id' ? mentionPeople(id) : null
  const showMentions = people && !internal && people.buttons.length > 0
  const save = async () => {
    const content = text.trim()
    if (!content) return
    const isInternal = guestRelevant ? internal : false
    const mentions = people && !isInternal ? parseMentions(content, people.all) : []
    setText('')
    await saveNote({ content, [field]: id, internal: isInternal, mentions })
  }
  // „@Vorname “ an der Schreibmarke einfügen
  const mention = (p) => {
    const el = area.current
    const start = el ? el.selectionStart : text.length
    const end = el ? el.selectionEnd : text.length
    const before = text.slice(0, start)
    const insertText = (before && !/\s$/.test(before) ? ' ' : '') + '@' + p.label + ' '
    const next = before + insertText + text.slice(end)
    setText(next)
    requestAnimationFrame(() => {
      if (!area.current) return
      area.current.focus()
      const caret = start + insertText.length
      area.current.setSelectionRange(caret, caret)
    })
  }
  return html`<div class="notes">
    <div class="note-new">
      <textarea
        ref=${area}
        rows="3"
        placeholder=${t('Notiz schreiben …')}
        aria-label=${t('Neue Notiz')}
        value=${text}
        onInput=${(e) => setText(e.target.value)}
        onKeyDown=${(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save()
        }}
      ></textarea>
      ${showMentions &&
      html`<div class="mention-buttons" role="group" aria-label=${t('Erwähnen')}>
        ${people.buttons.map(
          (p) => html`<button type="button" class="chip-btn small" title=${p.name + (p.guest ? ' (' + t('Gast') + ')' : '')} onClick=${() => mention(p)}>@${p.label}</button>`
        )}
      </div>`}
      <div class="form-actions">
        ${guestRelevant &&
        html`<button
          type="button"
          class=${'chip-btn' + (internal ? ' active' : '')}
          aria-pressed=${internal}
          title=${t('Nur für das Team: Gäste sehen diese Notiz nicht')}
          onClick=${() => setInternal(!internal)}
        >
          <${Icon} name=${internal ? 'lock' : 'lockOpen'} size=${16} /> ${t('Nur Team')}
        </button>`}
        <button type="button" class="btn btn-primary" disabled=${!text.trim()} onClick=${save}>${t('Notiz speichern')}</button>
      </div>
    </div>
    ${list.length ? html`<ul class="note-list">${list.map((n) => html`<${NoteItem} note=${n} guestRelevant=${guestRelevant} key=${n.id} />`)}</ul>` : null}
  </div>`
}

// Handybreite? (unter 760 Pixel)
export function useIsMobile() {
  const query = '(max-width: 759px)'
  const [mobile, setMobile] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const fn = () => setMobile(mq.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])
  return mobile
}

// Klappliste mit Häkchen für mehrere Werte (Wunsch vom 24.11.2026, zum Beispiel „Weitere zuständig“).
// Knopf zeigt die Auswahl, ein Klick öffnet die Liste darunter. Ein Häkchen speichert sofort.
// Schließt bei Klick daneben und mit Escape (hält die Taste an, damit das Fenster offen bleibt).
// options: [{ value, label }], value: Liste gewählter Werte, onToggle(value, warAn)
let multiSelectSeq = 0
export function MultiSelect({ options, value, onToggle, label, empty = 'Niemand', id }) {
  const [open, setOpen] = useState(false)
  const ref = useRef()
  const listId = useRef('multi-' + ++multiSelectSeq).current
  useEffect(() => {
    if (!open) return
    const away = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false)
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])
  const chosen = options.filter((o) => value.includes(o.value))
  const summary = chosen.length ? chosen.map((o) => o.label).join(', ') : t(empty)
  const onKeyDown = (e) => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation()
      setOpen(false)
    }
  }
  return html`<div class="multi-select" ref=${ref} onKeyDown=${onKeyDown}>
    <button type="button" id=${id} class=${'multi-select-btn' + (chosen.length ? '' : ' is-empty')} aria-haspopup="listbox" aria-expanded=${open} aria-controls=${listId} aria-label=${t(label) + ': ' + summary} onClick=${() => setOpen(!open)}>
      <span class="multi-select-text">${summary}</span>
      <span class=${'pp-chevron' + (open ? ' open' : '')}><${Icon} name="chevron" size=${16} /></span>
    </button>
    ${open &&
    html`<ul class="multi-select-list" id=${listId} role="listbox" aria-multiselectable="true" aria-label=${t(label)}>
      ${options.map((o) => {
        const on = value.includes(o.value)
        return html`<li key=${o.value} role="option" aria-selected=${on}>
          <label class="check-label multi-select-item">
            <input type="checkbox" checked=${on} onChange=${() => onToggle(o.value, on)} />
            <span>${o.label}</span>
          </label>
        </li>`
      })}
    </ul>`}
  </div>`
}
