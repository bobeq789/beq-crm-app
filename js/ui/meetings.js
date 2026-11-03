// Meetings: Liste nach Monaten, Detailansicht, Anlegen und Bearbeiten, Action Items aufs Board
import { html, useState, useEffect } from '../lib/preact.js'
import { Icon } from '../lib/icons.js'
import { matches, fmtDateTime, fmtDate, fmtTime, monthLabel, norm } from '../lib/util.js'
import {
  state,
  getMeeting,
  getProject,
  getPerson,
  getOrg,
  meetingPersons,
  insert,
  update,
  remove,
  createCard,
  defaultProjectId,
  memberByName,
  personByName,
  confirmDialog,
  toast,
  ensureFull,
  searchMeetingSummaries,
} from '../store.js'
import { navigate, openCard } from '../router.js'
import { PageHead, Tile, Empty, Dot, Field, ProjectSelect, Notes, LinkText } from './common.js'

// „Name: Aufgabe“ zerlegen, Aufzählungszeichen am Anfang ignorieren
export function parseActionItems(text) {
  return String(text || '')
    .split('\n')
    .map((l) => l.replace(/^\s*[-*•]\s*/, '').trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^([^:]{1,40}):\s*(.+)$/)
      return m ? { line, name: m[1].trim(), task: m[2].trim() } : { line, name: null, task: line }
    })
}

const participantNames = (m) => [...meetingPersons(m.id).map((p) => p.name), ...(m.extra_names || [])]

// Für <input type="datetime-local">: Ortszeit ohne Zeitzone
function toLocalInput(iso) {
  const d = iso ? new Date(iso) : new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ------------------------------------------------------------
// Liste
// ------------------------------------------------------------
export function MeetingsList() {
  const [query, setQuery] = useState('')
  const [projectId, setProjectId] = useState('')
  const [summaryHits, setSummaryHits] = useState(new Set())
  const q = query.trim()

  // Ab drei Zeichen auch in den Zusammenfassungen suchen (in der Datenbank, die Texte sind nicht vorab geladen)
  useEffect(() => {
    if (q.length < 3) {
      setSummaryHits(new Set())
      return
    }
    let stale = false
    const t = setTimeout(async () => {
      try {
        const ids = await searchMeetingSummaries(q)
        if (!stale) setSummaryHits(new Set(ids))
      } catch {
        // Suche in den Zusammenfassungen ist ein Zusatz, Fehler hier nicht melden
      }
    }, 300)
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [q])

  const searched = state.db.meetings.filter((m) => !q || matches(q, m.title, participantNames(m)) || summaryHits.has(m.id))
  const projects = state.db.projects.filter((p) => !p.archived).sort((a, b) => a.sort - b.sort)
  const list = searched.filter((m) => !projectId || m.project_id === projectId).sort((a, b) => b.held_at.localeCompare(a.held_at))

  const groups = []
  list.forEach((m) => {
    const label = monthLabel(m.held_at)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(m)
    else groups.push({ label, items: [m] })
  })

  return html`<div class="page">
    <${PageHead}
      kicker="Gespräche"
      title="Meetings"
      actions=${html`<a class="btn btn-primary" href="#/meetings/neu"><${Icon} name="plus" size=${18} /> Neues Meeting</a>`}
    />
    <div class="list-filters">
      <label class="search">
        <${Icon} name="search" size=${18} />
        <input type="search" value=${query} placeholder="Suchen: Titel, Teilnehmer, Inhalt" aria-label="Meetings durchsuchen" onInput=${(e) => setQuery(e.target.value)} />
      </label>
    </div>
    <div class="project-tabs" role="tablist" aria-label="Projekte">
      <button type="button" role="tab" aria-selected=${!projectId} class=${'tab' + (!projectId ? ' active' : '')} onClick=${() => setProjectId('')}>
        Alle <span class="count">${searched.length}</span>
      </button>
      ${projects.map(
        (p) => html`<button type="button" role="tab" aria-selected=${projectId === p.id} class=${'tab' + (projectId === p.id ? ' active' : '')} onClick=${() => setProjectId(p.id)}>
          <${Dot} color=${p.color} />${p.name} <span class="count">${searched.filter((m) => m.project_id === p.id).length}</span>
        </button>`
      )}
    </div>
    ${!list.length && html`<${Empty}>${q || projectId ? 'Keine Meetings gefunden.' : 'Noch keine Meetings. Leg das erste an.'}<//>`}
    ${groups.map(
      (g) => html`<section class="month-group" key=${g.label}>
        <h2 class="group-title">${g.label}</h2>
        <ul class="row-list">
          ${g.items.map((m) => {
            const project = getProject(m.project_id)
            const names = participantNames(m)
            return html`<li key=${m.id}>
              <a class="row-link" href=${'#/meetings/' + m.id}>
                <span class="row-date">
                  <span class="row-day">${new Date(m.held_at).getDate()}.</span>
                  <span class="row-wd">${fmtDate(m.held_at).split(',')[0]}</span>
                </span>
                <span class="row-main">
                  <span class="row-title">${m.title}</span>
                  <span class="row-meta">
                    ${fmtTime(m.held_at)}${m.duration_min ? `, ${m.duration_min} Min.` : ''}
                    ${project && html`<span class="meta-item"><${Dot} color=${project.color} />${project.name}</span>`}
                    ${names.length > 0 && html`<span class="meta-item muted">${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''}</span>`}
                    ${m.source === 'fireflies' && html`<span class="badge">Fireflies</span>`}
                  </span>
                </span>
                <${Icon} name="chevron" size=${18} cls="row-chevron" />
              </a>
            </li>`
          })}
        </ul>
      </section>`
    )}
  </div>`
}

// ------------------------------------------------------------
// Teilnehmer auswählen: Kontakte oder freie Namen
// ------------------------------------------------------------
function ParticipantInput({ personIds, extraNames, onChange }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const results = q.trim()
    ? state.db.persons
        .filter((p) => !personIds.includes(p.id) && matches(q, p.name, p.emails, (getOrg(p.org_id) || {}).name))
        .sort((a, b) => a.name.localeCompare(b.name, 'de'))
        .slice(0, 6)
    : []
  const addPerson = (id) => {
    onChange(personIds.concat(id), extraNames)
    setQ('')
  }
  const addName = () => {
    const name = q.trim()
    if (!name) return
    const exact = results.find((p) => norm(p.name) === norm(name))
    if (exact) addPerson(exact.id)
    else if (!extraNames.includes(name)) onChange(personIds, extraNames.concat(name))
    setQ('')
  }
  return html`<div class="participants-input">
    <div class="chips">
      ${personIds.map((id) => {
        const p = getPerson(id)
        return p
          ? html`<span class="chip">${p.name}<button type="button" aria-label=${p.name + ' entfernen'} onClick=${() => onChange(personIds.filter((x) => x !== id), extraNames)}><${Icon} name="x" size=${14} /></button></span>`
          : null
      })}
      ${extraNames.map(
        (n) => html`<span class="chip chip-free">${n}<button type="button" aria-label=${n + ' entfernen'} onClick=${() => onChange(personIds, extraNames.filter((x) => x !== n))}><${Icon} name="x" size=${14} /></button></span>`
      )}
    </div>
    <div class="picker">
      <input
        id="meeting-participants"
        value=${q}
        autocomplete="off"
        placeholder="Kontakt suchen oder Namen eintippen, Enter"
        onInput=${(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus=${() => setOpen(true)}
        onBlur=${() => setTimeout(() => setOpen(false), 150)}
        onKeyDown=${(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            addName()
          }
        }}
      />
      ${open &&
      q.trim() &&
      html`<ul class="picker-list">
        ${results.map(
          (p) => html`<li><button type="button" onMouseDown=${(e) => e.preventDefault()} onClick=${() => addPerson(p.id)}>
            <span>${p.name}</span>${p.org_id && html`<span class="muted small">${(getOrg(p.org_id) || {}).name}</span>`}
          </button></li>`
        )}
        <li><button type="button" class="picker-new" onMouseDown=${(e) => e.preventDefault()} onClick=${addName}>
          <${Icon} name="plus" size=${16} /> „${q.trim()}“ als Namen ohne Kontakt hinzufügen
        </button></li>
      </ul>`}
    </div>
  </div>`
}

// ------------------------------------------------------------
// Anlegen und Bearbeiten
// ------------------------------------------------------------
export function MeetingEditor({ meeting, onDone }) {
  const isNew = !meeting
  const [form, setForm] = useState(() => ({
    title: meeting ? meeting.title : '',
    held_at: toLocalInput(meeting && meeting.held_at),
    duration_min: meeting && meeting.duration_min ? String(meeting.duration_min) : '',
    project_id: meeting ? meeting.project_id : defaultProjectId(),
    summary: meeting ? meeting.summary || '' : '',
    action_items: meeting ? meeting.action_items || '' : '',
    personIds: meeting ? meetingPersons(meeting.id).map((p) => p.id) : [],
    extra_names: meeting ? [...(meeting.extra_names || [])] : [],
  }))
  const [saving, setSaving] = useState(false)
  const set = (patch) => setForm({ ...form, ...patch })

  const save = async (e) => {
    e.preventDefault()
    if (!form.title.trim() || saving) return
    setSaving(true)
    const row = {
      title: form.title.trim(),
      held_at: new Date(form.held_at).toISOString(),
      duration_min: form.duration_min ? parseInt(form.duration_min, 10) : null,
      project_id: form.project_id || null,
      summary: form.summary.trim() || null,
      action_items: form.action_items.trim() || null,
      extra_names: form.extra_names,
    }
    let saved
    if (isNew) {
      saved = await insert('meetings', row)
    } else {
      saved = await update('meetings', meeting.id, row)
    }
    if (saved) {
      const before = state.db.meeting_persons.filter((mp) => mp.meeting_id === saved.id)
      for (const mp of before) if (!form.personIds.includes(mp.person_id)) await remove('meeting_persons', mp.id)
      for (const pid of form.personIds) {
        if (!before.some((mp) => mp.person_id === pid)) await insert('meeting_persons', { meeting_id: saved.id, person_id: pid })
      }
      toast(isNew ? 'Meeting angelegt' : 'Meeting gespeichert')
      if (isNew) navigate('/meetings/' + saved.id)
      else onDone && onDone()
    }
    setSaving(false)
  }

  return html`<form class="meeting-form" onSubmit=${save}>
    <${Field} label="Titel" htmlFor="meeting-title">
      <input id="meeting-title" value=${form.title} required onInput=${(e) => set({ title: e.target.value })} placeholder="Worum ging es?" />
    <//>
    <div class="field-grid three">
      <${Field} label="Datum und Uhrzeit" htmlFor="meeting-at">
        <input id="meeting-at" type="datetime-local" value=${form.held_at} required onInput=${(e) => set({ held_at: e.target.value })} />
      <//>
      <${Field} label="Dauer in Minuten" htmlFor="meeting-duration">
        <input id="meeting-duration" type="number" min="0" step="5" inputmode="numeric" value=${form.duration_min} onInput=${(e) => set({ duration_min: e.target.value })} />
      <//>
      <${Field} label="Projekt" htmlFor="meeting-project">
        <${ProjectSelect} id="meeting-project" value=${form.project_id} allowEmpty=${true} onChange=${(v) => set({ project_id: v })} />
      <//>
    </div>
    <${Field} label="Teilnehmer" htmlFor="meeting-participants">
      <${ParticipantInput}
        personIds=${form.personIds}
        extraNames=${form.extra_names}
        onChange=${(personIds, extra_names) => set({ personIds, extra_names })}
      />
    <//>
    <${Field} label="Zusammenfassung" htmlFor="meeting-summary">
      <textarea id="meeting-summary" rows="6" value=${form.summary} onInput=${(e) => set({ summary: e.target.value })}></textarea>
    <//>
    <${Field} label="Action Items" htmlFor="meeting-actions" hint="Eine pro Zeile, gern im Format „Name: Aufgabe“">
      <textarea id="meeting-actions" rows="5" value=${form.action_items} placeholder="Anna: Angebot schicken" onInput=${(e) => set({ action_items: e.target.value })}></textarea>
    <//>
    <div class="form-actions">
      ${isNew ? html`<a class="btn" href="#/meetings">Abbrechen</a>` : html`<button type="button" class="btn" onClick=${onDone}>Abbrechen</button>`}
      <button type="submit" class="btn btn-primary" disabled=${!form.title.trim() || saving}>${isNew ? 'Meeting anlegen' : 'Speichern'}</button>
    </div>
  </form>`
}

export function MeetingNew() {
  return html`<div class="page page-narrow">
    <${PageHead} kicker="Meetings" title="Neues Meeting" back=${{ href: '#/meetings', label: 'Alle Meetings' }} />
    <${MeetingEditor} />
  </div>`
}

// ------------------------------------------------------------
// Detailansicht
// ------------------------------------------------------------
function ActionItems({ meeting }) {
  const items = parseActionItems(meeting.action_items)
  const people = meetingPersons(meeting.id)
  const existing = state.db.cards.filter((c) => c.meeting_id === meeting.id)

  const toBoard = async (item) => {
    const projectId = meeting.project_id && getProject(meeting.project_id) && !getProject(meeting.project_id).archived ? meeting.project_id : defaultProjectId()
    const fields = { title: item.task, project_id: projectId, meeting_id: meeting.id, kind: 'todo' }
    const m = item.name && memberByName(item.name)
    if (m) {
      fields.assignee = m.email
    } else if (item.name) {
      const person = personByName(item.name, people) || personByName(item.name)
      const isExternal = person || (meeting.extra_names || []).some((n) => norm(n) === norm(item.name))
      if (isExternal) fields.kind = 'waiting'
      if (person) {
        fields.person_id = person.id
        if (person.org_id) fields.org_id = person.org_id
      }
    }
    const card = await createCard(fields)
    if (card) toast('Aufgabe liegt auf dem Board', { action: { label: 'Öffnen', run: () => openCard(card.id) } })
  }

  if (!items.length) return html`<${Empty}>Keine Action Items.<//>`
  return html`<ul class="action-items">
    ${items.map((item) => {
      const card = existing.find((c) => norm(c.title) === norm(item.task))
      return html`<li class="action-item">
        <span class="ai-text">${item.name && html`<strong>${item.name}:</strong> `}${item.task}</span>
        ${card
          ? html`<button type="button" class="link-btn ai-done" onClick=${() => openCard(card.id)}><${Icon} name="check" size=${16} /> Auf dem Board</button>`
          : html`<button type="button" class="btn btn-small" onClick=${() => toBoard(item)}><${Icon} name="board" size=${16} /> Aufs Board</button>`}
      </li>`
    })}
  </ul>`
}

function Participants({ meeting }) {
  const people = meetingPersons(meeting.id).sort((a, b) => a.name.localeCompare(b.name, 'de'))
  const extra = meeting.extra_names || []
  const makeContact = async (name) => {
    const person = await insert('persons', { name })
    if (!person) return
    await insert('meeting_persons', { meeting_id: meeting.id, person_id: person.id })
    await update('meetings', meeting.id, { extra_names: extra.filter((n) => n !== name) })
    toast(`„${name}“ ist jetzt ein Kontakt`, { action: { label: 'Öffnen', run: () => navigate('/kontakte/' + person.id) } })
  }
  if (!people.length && !extra.length) return html`<${Empty}>Keine Teilnehmer eingetragen.<//>`
  return html`<div class="chips">
    ${people.map((p) => {
      const org = getOrg(p.org_id)
      return html`<a class="chip chip-link" href=${'#/kontakte/' + p.id}>${p.name}${org && html`<span class="muted">${org.name}</span>`}</a>`
    })}
    ${extra.map(
      (n) => html`<span class="chip chip-free">${n}
        <button type="button" class="chip-add" title="Als Kontakt anlegen" onClick=${() => makeContact(n)}><${Icon} name="plus" size=${14} /> Kontakt</button>
      </span>`
    )}
  </div>`
}

export function MeetingDetail({ id }) {
  const [editing, setEditing] = useState(false)
  const meeting = getMeeting(id)
  // Die Zusammenfassung lädt erst jetzt
  useEffect(() => {
    ensureFull('meetings', id)
  }, [id])
  const loaded = state.full.meetings.has(id)
  if (!meeting) {
    return html`<div class="page"><${PageHead} kicker="Meeting" title="Nicht gefunden" back=${{ href: '#/meetings', label: 'Alle Meetings' }} />
      <${Empty}>Dieses Meeting gibt es nicht mehr.<//></div>`
  }
  const project = getProject(meeting.project_id)

  const del = async () => {
    const ok = await confirmDialog({
      title: 'Meeting löschen?',
      text: `„${meeting.title}“ und die Notizen dazu sind danach weg. Aufgaben aus diesem Meeting bleiben auf dem Board.`,
      confirmLabel: 'Löschen',
      danger: true,
    })
    if (!ok) return
    navigate('/meetings')
    await remove('meetings', meeting.id)
    toast('Meeting gelöscht')
  }

  if (editing) {
    return html`<div class="page page-narrow">
      <${PageHead} kicker="Meeting bearbeiten" title=${meeting.title} />
      <${MeetingEditor} meeting=${meeting} onDone=${() => setEditing(false)} key=${meeting.id} />
    </div>`
  }

  return html`<div class="page">
    <${PageHead}
      kicker=${'Meeting · ' + fmtDateTime(meeting.held_at)}
      title=${meeting.title}
      back=${{ href: '#/meetings', label: 'Alle Meetings' }}
      actions=${html`<button type="button" class="btn" disabled=${!loaded} onClick=${() => setEditing(true)}><${Icon} name="edit" size=${16} /> Bearbeiten</button>
        <button type="button" class="btn btn-danger-text" onClick=${del}><${Icon} name="trash" size=${16} /> Löschen</button>`}
    />
    <div class="detail-meta">
      ${meeting.duration_min && html`<span class="meta-item"><${Icon} name="clock" size=${16} /> ${meeting.duration_min} Minuten</span>`}
      ${project && html`<span class="meta-item"><${Dot} color=${project.color} />${project.name}</span>`}
      <span class="badge">${meeting.source === 'fireflies' ? 'aus Fireflies' : 'von Hand angelegt'}</span>
    </div>
    <div class="detail-grid">
      <div class="col-main">
        <${Tile} title="Zusammenfassung">
          ${!loaded
            ? html`<p class="muted">Wird geladen …</p>`
            : meeting.summary
              ? html`<div class="prose"><${LinkText} text=${meeting.summary} /></div>`
              : html`<${Empty}>Keine Zusammenfassung.<//>`}
        <//>
        <${Tile} title="Action Items"><${ActionItems} meeting=${meeting} /><//>
      </div>
      <div class="col-side">
        <${Tile} title="Teilnehmer"><${Participants} meeting=${meeting} /><//>
        <${Tile} title="Notizen"><${Notes} field="meeting_id" id=${meeting.id} /><//>
      </div>
    </div>
  </div>`
}
