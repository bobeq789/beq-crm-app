// Suche oben in der Kopfleiste (Nachtrag „Suche oben, Kachel entschlackt“, B1, B2, Frage 18).
//
// Findet Aufgaben, Kontakte, Firmen, Meetings und Deals in den Daten, die schon in der App
// geladen sind. Deals nur nach der Sichtregel aus Sales (salesPeople(), die Datenbank prüft
// zusätzlich can_see_sales()). Mails durchsucht das Postfach selbst: „In den Mails suchen“
// springt mit dem Suchbegriff dorthin (#/postfach?q=…), wie immer nur in den eigenen Postfächern.
// Aus dem Suchbegriff wird auf Wunsch eine Aufgabe (Fenster „Neue Aufgabe“). Das ersetzt das
// frühere Schnell-Anlegen über der Übersicht.
//
// Breite Fenster: Feld zwischen Logo und Reitern. Unter 1100 px nur eine Lupe, die Suche öffnet
// sich dann als Fläche über der Seite (am Handy über die ganze Breite).
// Tastatur: Strg+K (am Mac Cmd+K) oder „/“ öffnet die Suche, Pfeile wählen, Enter öffnet,
// Escape schließt.
import { html, useState, useRef, useEffect, useLayoutEffect } from '../lib/preact.js'
import { Icon } from '../lib/icons.js'
import { norm, matches, fmtEuro, fmtDate, local } from '../lib/util.js'
import {
  state,
  myEmail,
  createCard,
  defaultProjectId,
  getProject,
  getStage,
  getPerson,
  getOrg,
  getCard,
  memberName,
  salesPeople,
  isOpen,
  openDialog,
  closeDialog,
  toast,
} from '../store.js'
import { openCard, navigate } from '../router.js'
import { Modal, PriorityPicker, ProjectSelect, AssigneeSelect, Field, dialogKinds } from './common.js'

const PER_GROUP = 5
const STATUS = { offen: 'offen', gewonnen: 'gewonnen', verloren: 'verloren' }

// Wie gut passt ein Titel? Anfang des Titels vor Wortanfang vor irgendwo, sonst nur in anderen Feldern
function score(query, title) {
  const q = norm(query)
  const t = norm(title)
  if (t.startsWith(q)) return 3
  if (t.split(/[\s\-–,.„“"()/]+/).some((w) => w.startsWith(q))) return 2
  if (t.includes(q)) return 1
  return 0
}
const rank = (query, list, titleOf, extra = () => 0) =>
  list
    .map((x) => ({ x, s: score(query, titleOf(x)) + extra(x) }))
    .sort((a, b) => b.s - a.s || String(titleOf(a.x)).localeCompare(String(titleOf(b.x)), 'de'))
    .map((r) => r.x)

const joinParts = (...parts) => parts.filter(Boolean).join(' · ')

// Alle Treffer, nach Gruppen. Jede Gruppe höchstens PER_GROUP Einträge, dazu die Gesamtzahl.
export function searchAll(query) {
  const q = String(query || '').trim()
  if (!q) return []
  const db = state.db
  const groups = []
  const add = (key, label, all, toItem) => {
    if (all.length) groups.push({ key, label, total: all.length, items: all.slice(0, PER_GROUP).map(toItem) })
  }

  // Aufgaben: offene vor erledigten, archivierte nur, wenn sonst nichts passt
  const cards = db.cards.filter((c) => {
    const person = getPerson(c.person_id)
    const org = getOrg(c.org_id)
    return matches(q, c.title, c.description, c.labels, person && person.name, org && org.name)
  })
  add('aufgaben', 'Aufgaben', rank(q, cards, (c) => c.title, (c) => (c.archived ? -10 : isOpen(c) ? 0 : -5)), (c) => {
    const project = getProject(c.project_id)
    const stage = getStage(c.stage_id)
    return {
      id: 'karte-' + c.id,
      icon: 'board',
      title: c.title,
      sub: joinParts(project && project.name, c.archived ? 'archiviert' : stage && stage.name, c.assignee && memberName(c.assignee)),
      done: !isOpen(c),
      run: () => openCard(c.id),
    }
  })

  const persons = db.persons.filter((p) => {
    const org = getOrg(p.org_id)
    return matches(q, p.name, p.position, p.emails, p.phones, p.labels, org && org.name)
  })
  add('kontakte', 'Kontakte', rank(q, persons, (p) => p.name), (p) => {
    const org = getOrg(p.org_id)
    return { id: 'kontakt-' + p.id, icon: 'contacts', title: p.name, sub: joinParts(p.position, org && org.name), run: () => navigate('/kontakte/' + p.id) }
  })

  const orgs = db.organizations.filter((o) => matches(q, o.name, o.industry, o.domain, o.website, o.address, o.labels))
  add('firmen', 'Firmen', rank(q, orgs, (o) => o.name), (o) => ({
    id: 'firma-' + o.id,
    icon: 'orgs',
    title: o.name,
    sub: joinParts(o.industry, o.domain),
    run: () => navigate('/firmen/' + o.id),
  }))

  // Meetings: Titel und Teilnehmer (die Zusammenfassung lädt die App erst beim Öffnen)
  const namesByMeeting = new Map()
  for (const mp of db.meeting_persons || []) {
    const p = getPerson(mp.person_id)
    if (!p) continue
    if (!namesByMeeting.has(mp.meeting_id)) namesByMeeting.set(mp.meeting_id, [])
    namesByMeeting.get(mp.meeting_id).push(p.name)
  }
  const meetings = (db.meetings || []).filter((m) => matches(q, m.title, m.extra_names, namesByMeeting.get(m.id)))
  add(
    'meetings',
    'Meetings',
    rank(q, meetings, (m) => m.title).sort((a, b) => score(q, b.title) - score(q, a.title) || String(b.held_at).localeCompare(String(a.held_at))),
    (m) => ({ id: 'meeting-' + m.id, icon: 'meetings', title: m.title, sub: fmtDate(m.held_at), run: () => navigate('/meetings/' + m.id) })
  )

  // Deals: nur die, deren Zahlen ich sehen darf (wie in Sales)
  const allowed = new Set(salesPeople().map((t) => norm(t.email)))
  const deals = (db.deals || []).filter((d) => {
    if (!allowed.has(norm(d.owner))) return false
    const card = getCard(d.card_id)
    if (!card) return false
    const person = getPerson(card.person_id)
    const org = getOrg(card.org_id)
    return matches(q, card.title, person && person.name, org && org.name, memberName(d.owner))
  })
  add('deals', 'Deals', rank(q, deals, (d) => getCard(d.card_id).title, (d) => (d.status === 'offen' ? 0 : -1)), (d) => {
    const card = getCard(d.card_id)
    const org = getOrg(card.org_id)
    return {
      id: 'deal-' + d.id,
      icon: 'sales',
      title: card.title,
      sub: joinParts(fmtEuro(d.value_cents), STATUS[d.status], org && org.name, memberName(d.owner)),
      run: () => openCard(card.id),
    }
  })
  return groups
}

// Fensterbreite als Zustand (für die Stufen der Kopfleiste)
function useMedia(query) {
  const [hit, setHit] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const fn = () => setHit(mq.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [query])
  return hit
}

const isTyping = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '')

// Suchfeld mit Ergebnisliste. sheet: als Fläche über der Seite (schmale Fenster und Handy).
function SearchBox({ sheet, onClose, inputRef }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(sheet)
  const [active, setActive] = useState(0)
  const boxRef = useRef()
  const groups = open ? searchAll(query) : []
  const q = query.trim()

  // Alle wählbaren Einträge in Reihenfolge: Treffer, dann die Aktionen
  const actions = q
    ? [
        { id: 'neu', icon: 'plus', title: `„${q}“ als Aufgabe anlegen`, run: () => openDialog({ kind: 'new-task', title: q }) },
        { id: 'mails', icon: 'mail', title: 'In den Mails suchen', sub: 'nur in deinen Postfächern', run: () => navigate('/postfach', { q }) },
      ]
    : [{ id: 'neu', icon: 'plus', title: 'Neue Aufgabe', run: () => openDialog({ kind: 'new-task', title: '' }) }]
  const flat = [...groups.flatMap((g) => g.items), ...actions]
  const current = Math.min(active, flat.length - 1)

  useEffect(() => setActive(0), [query])
  // Als Fläche geöffnet: sofort ins Feld, damit man gleich tippen kann
  useLayoutEffect(() => {
    if (sheet && inputRef.current) inputRef.current.focus()
  }, [])

  const close = () => {
    setOpen(false)
    setQuery('')
    if (inputRef.current) inputRef.current.blur()
    if (onClose) onClose()
  }
  const choose = (item) => {
    close()
    item.run()
  }

  // Klick neben die Suche schließt sie (nur im Feld oben, die Fläche hat einen eigenen Hintergrund)
  useEffect(() => {
    if (sheet || !open) return
    const fn = (e) => boxRef.current && !boxRef.current.contains(e.target) && close()
    document.addEventListener('pointerdown', fn)
    return () => document.removeEventListener('pointerdown', fn)
  }, [open, sheet])

  // Aktiven Eintrag sichtbar halten
  useLayoutEffect(() => {
    const el = boxRef.current && boxRef.current.querySelector('.search-item.active')
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' })
  }, [current, open])

  const onKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((current + 1) % flat.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((current - 1 + flat.length) % flat.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (flat[current]) choose(flat[current])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    }
  }

  let index = -1
  const row = (item) => {
    index += 1
    const i = index
    return html`<li
      id=${'such-' + item.id}
      key=${item.id}
      role="option"
      aria-selected=${i === current}
      class=${'search-item' + (i === current ? ' active' : '') + (item.done ? ' done' : '')}
      onPointerMove=${() => i !== current && setActive(i)}
      onClick=${() => choose(item)}
    >
      <span class="search-icon"><${Icon} name=${item.icon} size=${18} /></span>
      <span class="search-text">
        <span class="search-title">${item.title}</span>
        ${item.sub && html`<span class="search-sub">${item.sub}</span>`}
      </span>
    </li>`
  }

  const panel =
    open &&
    html`<div class="search-panel" onPointerDown=${(e) => e.target.closest('.search-item') && e.preventDefault()}>
      <ul class="search-list" role="listbox" id="such-liste" aria-label="Suchergebnisse">
        ${!q && html`<li class="search-hint" role="presentation">Findet Aufgaben, Kontakte, Firmen, Meetings und Deals.</li>`}
        ${q && !groups.length && html`<li class="search-hint" role="presentation">Nichts gefunden für „${q}“.</li>`}
        ${groups.map(
          (g) => html`<li class="search-group" role="presentation" key=${g.key}>
            <div class="search-group-title">${g.label}${g.total > g.items.length && html` <span class="count">${g.items.length} von ${g.total}</span>`}</div>
            <ul role="presentation">${g.items.map(row)}</ul>
          </li>`
        )}
        <li class="search-group search-actions" role="presentation">
          <ul role="presentation">${actions.map(row)}</ul>
        </li>
      </ul>
    </div>`

  return html`<div class=${'gsearch' + (sheet ? ' search-sheet' : '')} ref=${boxRef}>
    <div class="search-field">
      <${Icon} name="search" size=${18} />
      <input
        ref=${inputRef}
        type="search"
        value=${query}
        placeholder="Suchen"
        aria-label="Suchen in Aufgaben, Kontakten, Firmen, Meetings und Deals"
        role="combobox"
        aria-expanded=${open}
        aria-controls="such-liste"
        aria-autocomplete="list"
        aria-activedescendant=${open && flat[current] ? 'such-' + flat[current].id : undefined}
        autocomplete="off"
        enterkeyhint="search"
        onFocus=${() => setOpen(true)}
        onInput=${(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onKeyDown=${onKey}
      />
      ${!sheet && !query && html`<kbd class="search-kbd" aria-hidden="true">${isMac ? '⌘K' : 'Strg K'}</kbd>`}
      ${sheet && html`<button type="button" class="search-cancel" onClick=${close}>Abbrechen</button>`}
    </div>
    ${panel}
  </div>`
}

// In der Kopfleiste: breites Fenster Feld, schmales Fenster Lupe mit Fläche darüber
export function TopSearch() {
  const compact = useMedia('(max-width: 1099px)')
  const [sheetOpen, setSheetOpen] = useState(false)
  const inputRef = useRef()

  // Strg+K, Cmd+K oder „/“ (nicht beim Tippen in einem Feld)
  useEffect(() => {
    const fn = (e) => {
      const combo = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k'
      const slash = e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(document.activeElement)
      if (!combo && !slash) return
      if (state.dialog) return // Ein Fenster ist offen, das bleibt vorne
      e.preventDefault()
      if (compact) setSheetOpen(true)
      else if (inputRef.current) inputRef.current.focus()
    }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [compact])

  // Fläche: Seite dahinter nicht scrollen (den Cursor setzt SearchBox selbst)
  useEffect(() => {
    if (!sheetOpen) return
    document.body.classList.add('search-sheet-open')
    return () => document.body.classList.remove('search-sheet-open')
  }, [sheetOpen])
  useEffect(() => {
    if (!compact) setSheetOpen(false)
  }, [compact])

  if (!compact) return html`<${SearchBox} sheet=${false} inputRef=${inputRef} />`
  return html`<button type="button" class="header-icon search-button" aria-label="Suchen" title="Suchen" onClick=${() => setSheetOpen(true)}>
      <${Icon} name="search" size=${22} />
    </button>
    ${sheetOpen &&
    html`<div class="search-backdrop" onClick=${(e) => e.target === e.currentTarget && setSheetOpen(false)}>
      <${SearchBox} sheet=${true} inputRef=${inputRef} onClose=${() => setSheetOpen(false)} />
    </div>`}`
}

// ------------------------------------------------------------
// Fenster „Neue Aufgabe“ (früher das Schnell-Anlegen über der Übersicht)
// ------------------------------------------------------------
function NewTaskDialog({ d }) {
  const [title, setTitle] = useState(d.title || '')
  const [priority, setPriority] = useState(null)
  const [due, setDue] = useState('')
  const lastProject = local.get('beqcrm-last-quick-project')
  const validLast = lastProject && getProject(lastProject) && !getProject(lastProject).archived ? lastProject : null
  const [projectId, setProjectId] = useState(d.project_id || validLast || defaultProjectId())
  const [assignee, setAssignee] = useState(myEmail())
  const [busy, setBusy] = useState(false)
  const inputRef = useRef()
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    const t = title.trim()
    if (!t || busy) return
    setBusy(true)
    local.set('beqcrm-last-quick-project', projectId)
    const card = await createCard({ title: t, project_id: projectId, kind: 'todo', priority, due_date: due || null, assignee: assignee || null })
    setBusy(false)
    if (!card) return
    closeDialog()
    toast('Aufgabe angelegt', { action: { label: 'Öffnen', run: () => openCard(card.id) } })
  }

  return html`<${Modal} title="Neue Aufgabe" onClose=${closeDialog}>
    <form class="new-task" onSubmit=${submit} id="neue-aufgabe">
      <${Field} label="Was steht an?" htmlFor="nt-title">
        <input id="nt-title" ref=${inputRef} value=${title} onInput=${(e) => setTitle(e.target.value)} autocomplete="off" />
      <//>
      <div class="quick-options">
        <${PriorityPicker} value=${priority} onChange=${setPriority} />
        <label class="quick-field">
          <span class="sr-only">Fällig am</span>
          <input type="date" value=${due} onInput=${(e) => setDue(e.target.value)} aria-label="Fällig am" />
        </label>
        <label class="quick-field">
          <span class="sr-only">Projekt</span>
          <${ProjectSelect} value=${projectId} onChange=${setProjectId} />
        </label>
        <label class="quick-field">
          <span class="sr-only">Zuständig</span>
          <${AssigneeSelect} value=${assignee} onChange=${setAssignee} emptyLabel="Niemand zuständig" />
        </label>
      </div>
      <div class="new-task-foot">
        <button type="button" class="btn" onClick=${closeDialog}>Abbrechen</button>
        <button type="submit" class="btn btn-primary" disabled=${!title.trim() || busy}><${Icon} name="plus" size=${18} /> Anlegen</button>
      </div>
    </form>
  <//>`
}
dialogKinds['new-task'] = NewTaskDialog
