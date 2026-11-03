// Bausteine, die mehrere Bereiche nutzen
import { html, useState, useEffect, useRef } from '../lib/preact.js'
import { Icon } from '../lib/icons.js'
import { SETTINGS } from '../settings.js'
import { splitLinks, dueInfo, fmtRelative, matches, initials, norm } from '../lib/util.js'
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
} from '../store.js'
import { openCard } from '../router.js'

// „beQ“ bleibt auch in Großbuchstaben-Zeilen (Kicker) richtig geschrieben
export function brandSafe(text) {
  if (typeof text !== 'string' || !/beQ/.test(text)) return text
  return text.split(/(beQ)/).map((part) => (part === 'beQ' ? html`<span class="brand-name">beQ</span>` : part))
}

export function PageHead({ kicker, title, actions, back }) {
  return html`<header class="page-head">
    <div class="page-head-text">
      ${back && html`<a class="back-link" href=${back.href}><${Icon} name="back" size=${16} /> ${back.label}</a>`}
      ${kicker && html`<div class="kicker">${brandSafe(kicker)}</div>`}
      <h1 class="page-title">${title}</h1>
    </div>
    ${actions && html`<div class="page-actions">${actions}</div>`}
  </header>`
}

export function Tile({ title, count, actions, children, cls = '' }) {
  return html`<section class=${'tile ' + cls}>
    ${(title || actions) &&
    html`<div class="tile-head">
      <h2 class="tile-title">${title}${count !== undefined && html` <span class="count">${count}</span>`}</h2>
      ${actions}
    </div>`}
    ${children}
  </section>`
}

export function Empty({ children }) {
  return html`<p class="empty">${children}</p>`
}

// Farbiger Punkt für Projekte (Farbe als Attribut, damit der Dunkelmodus aufhellen kann)
export function Dot({ color }) {
  return html`<span class="dot" data-c=${(color || '').toUpperCase()} style=${{ background: color }}></span>`
}

export function Avatar({ email, name, size = 'sm' }) {
  const label = name || memberName(email)
  return html`<span class=${'avatar avatar-' + size} title=${label}>${initials(label)}</span>`
}

export function DueBadge({ due, done }) {
  const info = dueInfo(due)
  if (!info) return null
  return html`<span class=${'badge due-' + (done ? 'later' : info.tone)}><${Icon} name="clock" size=${12} />${info.text}</span>`
}

export function PrioBadge({ priority }) {
  if (!priority) return null
  const p = SETTINGS.priorities.find((x) => x.value === priority)
  return html`<span class=${'badge prio-' + priority}>${p ? p.label : priority}</span>`
}

export function Labels({ labels }) {
  if (!labels || !labels.length) return null
  return html`<span class="labels">${labels.map((l) => html`<span class="label">${l}</span>`)}</span>`
}

// Text mit anklickbaren Links und Zeilenumbrüchen, ohne HTML
export function LinkText({ text }) {
  return html`<span class="linktext">${splitLinks(text).map((p) =>
    typeof p === 'string' ? p : html`<a href=${p.href} target="_blank" rel="noopener noreferrer">${p.text}</a>`
  )}</span>`
}

export function Segmented({ options, value, onChange, label }) {
  return html`<div class="segmented" role="group" aria-label=${label}>
    ${options.map(
      (o) => html`<button type="button" class=${value === o.value ? 'active' : ''} aria-pressed=${value === o.value} onClick=${() => onChange(o.value)}>
        ${o.label}
      </button>`
    )}
  </div>`
}

// Dringlichkeit: drei Knöpfe, abwählbar
export function PriorityPicker({ value, onChange }) {
  return html`<div class="prio-picker" role="group" aria-label="Dringlichkeit">
    ${SETTINGS.priorities.map(
      (p) => html`<button
        type="button"
        class=${'chip-btn prio-' + p.value + (value === p.value ? ' active' : '')}
        aria-pressed=${value === p.value}
        onClick=${() => onChange(value === p.value ? null : p.value)}
      >
        ${p.label}
      </button>`
    )}
  </div>`
}

export function ProjectSelect({ value, onChange, includeArchived = false, allowEmpty = false, id }) {
  const list = state.db.projects.filter((p) => includeArchived || !p.archived || p.id === value).sort((a, b) => a.sort - b.sort)
  return html`<select id=${id} value=${value || ''} onChange=${(e) => onChange(e.target.value || null)}>
    ${allowEmpty && html`<option value="">Kein Projekt</option>`}
    ${list.map((p) => html`<option value=${p.id}>${p.name}</option>`)}
  </select>`
}

export function AssigneeSelect({ value, onChange, id, emptyLabel = 'Niemand' }) {
  const list = state.db.team_members
    .filter((t) => (t.active && t.role !== 'gast') || t.email === value)
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))
  return html`<select id=${id} value=${value || ''} onChange=${(e) => onChange(e.target.value || null)}>
    <option value="">${emptyLabel}</option>
    ${list.map((t) => html`<option value=${t.email}>${t.name}</option>`)}
  </select>`
}

export function Field({ label, children, hint, htmlFor }) {
  return html`<div class="field">
    ${label && html`<label class="field-label" for=${htmlFor}>${label}</label>`}
    ${children}
    ${hint && html`<div class="field-hint">${hint}</div>`}
  </div>`
}

// Eine Zeile „Zu erledigen“: Haken, Titel, darunter Projekt, Kontakt, Zuständig und Marken
export function TaskRow({ card, showSince, sinceText }) {
  const project = getProject(card.project_id)
  const person = getPerson(card.person_id)
  const org = getOrg(card.org_id)
  const done = cardKind(card) === 'done'
  return html`<li class="task-row">
    <button
      type="button"
      class=${'check' + (done ? ' checked' : '')}
      title=${done ? 'Erledigt' : 'Abhaken'}
      aria-label=${'„' + card.title + '“ abhaken'}
      onClick=${() => !done && completeCard(card)}
    >
      <${Icon} name="check" size=${16} />
    </button>
    <div class="task-main">
      <button type="button" class="task-title" onClick=${() => openCard(card.id)}>${card.title}</button>
      <div class="task-meta">
        ${project && html`<span class="meta-item"><${Dot} color=${project.color} />${project.name}</span>`}
        ${(person || org) && html`<span class="meta-item muted">${person ? person.name : org.name}</span>`}
        ${card.assignee && html`<${Avatar} email=${card.assignee} />`}
        <${PrioBadge} priority=${card.priority} />
        ${!done && html`<${DueBadge} due=${card.due_date} />`}
        ${showSince && html`<span class="badge due-later">${sinceText}</span>`}
      </div>
    </div>
  </li>`
}

// ------------------------------------------------------------
// Fenster (Dialog) mit dunklem Hintergrund
// ------------------------------------------------------------
export function Modal({ title, onClose, children, footer, wide = false }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return html`<div class="backdrop" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div class=${'modal' + (wide ? ' modal-wide' : '')} role="dialog" aria-modal="true" aria-label=${title}>
      <div class="modal-head">
        <h2 class="modal-title">${title}</h2>
        <button type="button" class="icon-btn" aria-label="Schließen" onClick=${onClose}><${Icon} name="x" /></button>
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
    footer=${html`<button type="button" class="btn" onClick=${() => done(false)}>Abbrechen</button>
      <button type="button" class=${d.danger ? 'btn btn-danger' : 'btn btn-primary'} onClick=${() => done(true)}>${d.confirmLabel}</button>`}
  >
    ${d.text && html`<p>${d.text}</p>`}
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
        <button type="button" class="btn" onClick=${() => done(null)}>Abbrechen</button>
        <button type="submit" class="btn btn-primary" disabled=${!value.trim()}>${d.confirmLabel}</button>
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
      (t) => html`<div class=${'toast' + (t.error ? ' toast-error' : '')} key=${t.id}>
        <span class="toast-text">${t.text}</span>
        ${t.action &&
        html`<button
          type="button"
          class="toast-action"
          onClick=${() => {
            dismissToast(t.id)
            t.action.run()
          }}
        >
          ${t.action.label}
        </button>`}
        <button type="button" class="toast-close" aria-label="Meldung schließen" onClick=${() => dismissToast(t.id)}>
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
      <button type="button" class="icon-btn small" aria-label="Auswahl entfernen" onClick=${() => onChange(null)}><${Icon} name="x" size=${16} /></button>
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
      placeholder=${placeholder}
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
          <${Icon} name="plus" size=${16} /> „${q.trim()}“ als ${kind === 'person' ? 'neuen Kontakt' : 'neue Firma'} anlegen
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
        <input id=${i === 0 ? idPrefix : undefined} type=${type} value=${v} placeholder=${placeholder} onInput=${(e) => set(i, e.target.value)} />
        ${list.length > 1 &&
        html`<button type="button" class="icon-btn small" aria-label="Entfernen" onClick=${() => onChange(list.filter((_, j) => j !== i))}>
          <${Icon} name="x" size=${16} />
        </button>`}
      </div>`
    )}
    <button type="button" class="link-btn" onClick=${() => onChange([...list, ''])}><${Icon} name="plus" size=${16} /> ${addLabel}</button>
  </div>`
}

// Labels: Vorschläge antippen oder frei eintippen
export function LabelInput({ value, onChange, suggestions }) {
  const [text, setText] = useState('')
  const current = value || []
  const toggle = (l) => onChange(current.includes(l) ? current.filter((x) => x !== l) : [...current, l])
  const all = [...new Set([...suggestions, ...current])]
  const add = () => {
    const l = text.trim()
    if (l && !current.includes(l)) onChange([...current, l])
    setText('')
  }
  return html`<div class="label-input">
    <div class="chips">
      ${all.map(
        (l) => html`<button type="button" class=${'chip-btn' + (current.includes(l) ? ' active' : '')} aria-pressed=${current.includes(l)} onClick=${() => toggle(l)}>
          ${l}
        </button>`
      )}
    </div>
    <div class="inline-add">
      <input
        value=${text}
        placeholder="Neues Label"
        onInput=${(e) => setText(e.target.value)}
        onKeyDown=${(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            add()
          }
        }}
      />
      <button type="button" class="btn" disabled=${!text.trim()} onClick=${add}>Hinzufügen</button>
    </div>
  </div>`
}

// ------------------------------------------------------------
// Notizen an Aufgaben, Kontakten, Firmen und Meetings
// „Nur intern“ versteckt eine Notiz vor Gästen. Gäste ändern nur ihre eigenen Notizen.
// ------------------------------------------------------------
function NoteItem({ note }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(note.content)
  const guest = isGuest()
  const own = norm(note.author) === norm(myEmail())
  const canEdit = !guest || own
  const edited = note.updated_at && new Date(note.updated_at) - new Date(note.created_at) > 60000
  const save = async () => {
    if (!text.trim()) return
    await update('notes', note.id, { content: text.trim() })
    setEditing(false)
  }
  const cancel = () => {
    setText(note.content)
    setEditing(false)
  }
  const del = async () => {
    if (await confirmDialog({ title: 'Notiz löschen?', text: 'Die Notiz ist danach weg.', confirmLabel: 'Löschen', danger: true })) {
      remove('notes', note.id)
    }
  }
  return html`<li class=${'note' + (note.internal ? ' note-internal' : '')}>
    ${editing
      ? html`<textarea rows="4" value=${text} aria-label="Notiz bearbeiten" onInput=${(e) => setText(e.target.value)}></textarea>
          <div class="form-actions">
            <button type="button" class="btn" onClick=${cancel}>Abbrechen</button>
            <button type="button" class="btn btn-primary" disabled=${!text.trim()} onClick=${save}>Speichern</button>
          </div>`
      : html`<div class="note-content"><${LinkText} text=${note.content} /></div>`}
    <div class="note-meta">
      <span>
        ${note.internal && html`<span class="note-lock" title="Nur intern, für Gäste unsichtbar"><${Icon} name="lock" size=${14} /> Nur intern · </span>`}
        ${memberName(note.author) || 'Unbekannt'} · ${fmtRelative(note.created_at)}${edited ? ' · bearbeitet' : ''}
      </span>
      ${!editing &&
      html`<span class="note-actions">
        ${!guest &&
        html`<button
          type="button"
          class="icon-btn small"
          aria-pressed=${!!note.internal}
          aria-label=${note.internal ? 'Für Gäste sichtbar machen' : 'Nur intern'}
          title=${note.internal ? 'Für Gäste sichtbar machen' : 'Nur intern'}
          onClick=${() => update('notes', note.id, { internal: !note.internal })}
        >
          <${Icon} name=${note.internal ? 'lock' : 'lockOpen'} size=${16} />
        </button>`}
        ${canEdit && html`<button type="button" class="icon-btn small" aria-label="Notiz bearbeiten" onClick=${() => setEditing(true)}><${Icon} name="edit" size=${16} /></button>`}
        ${!guest && html`<button type="button" class="icon-btn small" aria-label="Notiz löschen" onClick=${del}><${Icon} name="trash" size=${16} /></button>`}
      </span>`}
    </div>
  </li>`
}

export function Notes({ field, id }) {
  const [text, setText] = useState('')
  const [internal, setInternal] = useState(false)
  const guest = isGuest()
  const list = notesFor(field, id)
  const save = async () => {
    const content = text.trim()
    if (!content) return
    setText('')
    await insert('notes', { content, [field]: id, internal: guest ? false : internal })
  }
  return html`<div class="notes">
    <div class="note-new">
      <textarea
        rows="3"
        placeholder="Notiz schreiben …"
        aria-label="Neue Notiz"
        value=${text}
        onInput=${(e) => setText(e.target.value)}
        onKeyDown=${(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save()
        }}
      ></textarea>
      <div class="form-actions">
        ${!guest &&
        html`<button
          type="button"
          class=${'chip-btn' + (internal ? ' active' : '')}
          aria-pressed=${internal}
          title="Nur intern: Gäste sehen diese Notiz nicht"
          onClick=${() => setInternal(!internal)}
        >
          <${Icon} name=${internal ? 'lock' : 'lockOpen'} size=${16} /> Nur intern
        </button>`}
        <button type="button" class="btn btn-primary" disabled=${!text.trim()} onClick=${save}>Notiz speichern</button>
      </div>
    </div>
    ${list.length ? html`<ul class="note-list">${list.map((n) => html`<${NoteItem} note=${n} key=${n.id} />`)}</ul>` : null}
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
