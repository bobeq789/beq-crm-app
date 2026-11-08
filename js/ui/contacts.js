// Kontakte: Liste mit Suche und Filter, Kontaktseite, Formular
import { html, useState } from '../lib/preact.js'
import { Icon } from '../lib/icons.js'
import { matches, telHref, waHref, webHref, fmtDateTime, fmtDate, fmtTimeRange, local } from '../lib/util.js'
import {
  state,
  getPerson,
  getOrg,
  insert,
  update,
  remove,
  isOpen,
  meetingsOfPerson,
  allLabels,
  createCard,
  confirmDialog,
  promptDialog,
  toast,
  eventsOfPerson,
  openDialog,
  isGuest,
  activitiesForPerson,
} from '../store.js'
import { navigate, openCard, openEvent } from '../router.js'
import { EmailList, emailCount } from './emails.js'
import { ActivitySection } from './activities.js'
import { PageHead, Tile, Empty, Labels, TaskRow, Notes, Field, ListInput, LabelPicker, EntityPicker, Segmented, Avatar, CallLink } from './common.js'

// Beim Sortieren Titel wie „Dr.“ überspringen
const sortName = (name) => String(name || '').replace(/^(Dr\.|Prof\.)\s+/i, '')

export function ContactsList() {
  const [query, setQuery] = useState('')
  const [label, setLabel] = useState('')
  const [sort, setSort] = useState(local.get('beqcrm-contacts-sort', 'name'))
  const list = state.db.persons
    .filter((p) => !label || (p.labels || []).includes(label))
    .filter((p) => matches(query, p.name, (getOrg(p.org_id) || {}).name, p.emails, p.phones, p.position))
    .sort((a, b) => (sort === 'name' ? sortName(a.name).localeCompare(sortName(b.name), 'de') : String(b.updated_at).localeCompare(String(a.updated_at))))

  return html`<div class="page">
    <${PageHead}
      kicker="Adressbuch"
      title="Kontakte"
      actions=${html`<a class="btn btn-primary" href="#/kontakte/neu"><${Icon} name="plus" size=${18} /> Neuer Kontakt</a>`}
    />
    <div class="list-filters">
      <label class="search">
        <${Icon} name="search" size=${18} />
        <input type="search" value=${query} placeholder="Suchen: Name, Firma, E-Mail, Telefon" aria-label="Kontakte durchsuchen" onInput=${(e) => setQuery(e.target.value)} />
      </label>
      <select value=${label} aria-label="Label" onChange=${(e) => setLabel(e.target.value)}>
        <option value="">Alle Labels</option>
        ${allLabels().map((l) => html`<option value=${l}>${l}</option>`)}
      </select>
      <${Segmented}
        label="Sortierung"
        value=${sort}
        onChange=${(v) => {
          setSort(v)
          local.set('beqcrm-contacts-sort', v)
        }}
        options=${[
          { value: 'name', label: 'Name' },
          { value: 'recent', label: 'Zuletzt geändert' },
        ]}
      />
    </div>
    <p class="muted small list-count">${list.length} ${list.length === 1 ? 'Kontakt' : 'Kontakte'}</p>
    ${list.length
      ? html`<ul class="row-list">
          ${list.map((p) => {
            const org = getOrg(p.org_id)
            // Hörer neben der Zeile, nicht darin (kein Link im Link, Nachtrag „Anrufen“)
            return html`<li key=${p.id} class="row-with-call">
              <a class="row-link" href=${'#/kontakte/' + p.id}>
                <${Avatar} name=${p.name} size="md" />
                <span class="row-main">
                  <span class="row-title">${p.name}</span>
                  <span class="row-meta">
                    ${[p.position, org && org.name].filter(Boolean).join(' · ')}
                    <${Labels} labels=${p.labels} />
                  </span>
                </span>
                <${Icon} name="chevron" size=${18} cls="row-chevron" />
              </a>
              <${CallLink} name=${p.name} phones=${p.phones} />
            </li>`
          })}
        </ul>`
      : html`<${Empty}>${query || label ? 'Keine Kontakte gefunden.' : 'Noch keine Kontakte.'}<//>`}
  </div>`
}

// Nächste und letzte Termine mit diesem Kontakt
function EventsOfPerson({ personId }) {
  const all = eventsOfPerson(personId)
  const now = new Date().toISOString()
  const next = all.filter((e) => (e.end_at || e.start_at) >= now).slice(0, 3)
  const last = all.filter((e) => (e.end_at || e.start_at) < now).reverse().slice(0, 3)
  const row = (e) => html`<li key=${e.id}>
    <button type="button" class="mini-event" onClick=${() => openEvent(e.id)}>
      <span class="mm-title">${e.title || '(ohne Titel)'}</span>
      <span class="mm-meta">${fmtDate(e.start_at)}, ${fmtTimeRange(e.start_at, e.end_at, e.all_day)}</span>
    </button>
  </li>`
  return html`<${Tile} title="Termine" count=${all.length}>
    ${!all.length && html`<${Empty}>Keine Termine mit diesem Kontakt.<//>`}
    ${next.length > 0 && html`<h3 class="group-title">Nächste</h3><ul class="meeting-mini">${next.map(row)}</ul>`}
    ${last.length > 0 && html`<h3 class="group-title">Letzte</h3><ul class="meeting-mini">${last.map(row)}</ul>`}
  <//>`
}

export function ContactDetail({ id }) {
  const p = getPerson(id)
  if (!p) {
    return html`<div class="page"><${PageHead} kicker="Kontakt" title="Nicht gefunden" back=${{ href: '#/kontakte', label: 'Alle Kontakte' }} />
      <${Empty}>Diesen Kontakt gibt es nicht mehr.<//></div>`
  }
  const org = getOrg(p.org_id)
  const cards = state.db.cards.filter((c) => c.person_id === p.id && isOpen(c))
  const meetings = meetingsOfPerson(p.id)
  // Für die Knöpfe oben die erste Nummer, die sich wählen lässt (siehe parsePhone in util.js)
  const phone = (p.phones || []).find((x) => telHref(x))
  const waPhone = (p.phones || []).find((x) => waHref(x))
  const email = (p.emails || [])[0]

  const del = async () => {
    const ok = await confirmDialog({
      title: 'Kontakt löschen?',
      text: `„${p.name}“ und alle Notizen dazu sind danach weg. Aufgaben und Meetings bleiben, nur ohne diesen Kontakt.`,
      confirmLabel: 'Löschen',
      danger: true,
    })
    if (!ok) return
    navigate('/kontakte')
    await remove('persons', p.id)
    toast('Kontakt gelöscht')
  }
  const newTask = async () => {
    const title = await promptDialog({ title: `Neue Aufgabe zu ${p.name}`, label: 'Titel', confirmLabel: 'Anlegen' })
    if (!title) return
    const card = await createCard({ title, person_id: p.id, org_id: p.org_id, kind: 'todo', assignee: state.me && state.me.email })
    if (card) openCard(card.id)
  }

  return html`<div class="page">
    <${PageHead}
      kicker="Kontakt"
      title=${p.name}
      back=${{ href: '#/kontakte', label: 'Alle Kontakte' }}
      actions=${html`<a class="btn" href=${'#/kontakte/' + p.id + '/bearbeiten'}><${Icon} name="edit" size=${16} /> Bearbeiten</a>
        <button type="button" class="btn btn-danger-text" onClick=${del}><${Icon} name="trash" size=${16} /> Löschen</button>`}
    />
    <div class="detail-meta">
      ${p.position && html`<span>${p.position}</span>`}
      ${org && html`<a class="meta-item" href=${'#/firmen/' + org.id}><${Icon} name="orgs" size=${16} /> ${org.name}</a>`}
    </div>
    <div class="detail-labels">
      ${isGuest()
        ? html`<${Labels} labels=${p.labels} />`
        : html`<${LabelPicker} value=${p.labels} inputId="person-label-inline" onChange=${(labels) => update('persons', p.id, { labels })} />`}
    </div>
    <div class="quick-actions">
      ${email && html`<button type="button" class="btn" onClick=${() => openDialog({ kind: 'new-event', guests: [email] })}><${Icon} name="calendar" size=${18} /> Termin einladen</button>`}
      ${phone && html`<a class="btn" href=${telHref(phone)}><${Icon} name="phone" size=${18} /> Anrufen</a>`}
      ${email && html`<a class="btn" href=${'mailto:' + email}><${Icon} name="mail" size=${18} /> Mailen</a>`}
      ${waPhone && html`<a class="btn" href=${waHref(waPhone)} target="_blank" rel="noopener noreferrer"><${Icon} name="whatsapp" size=${18} /> WhatsApp</a>`}
    </div>
    <div class="detail-grid">
      <div class="col-main">
        <${Tile} title="Offene Aufgaben" count=${cards.length} actions=${html`<button type="button" class="link-btn" onClick=${newTask}><${Icon} name="plus" size=${16} /> Aufgabe</button>`}>
          ${cards.length ? html`<ul class="task-list">${cards.map((c) => html`<${TaskRow} card=${c} key=${c.id} />`)}</ul>` : html`<${Empty}>Keine offenen Aufgaben.<//>`}
        <//>
        ${!isGuest() && html`<${ActivitySection} list=${activitiesForPerson(p.id)} here="person" target=${{ person_id: p.id }} />`}
        <${Tile} title="Notizen"><${Notes} field="person_id" id=${p.id} /><//>
        <${Tile} title="E-Mails" count=${emailCount([p.id])}><${EmailList} personIds=${[p.id]} /><//>
      </div>
      <div class="col-side">
        <${Tile} title="Kontaktdaten">
          <ul class="contact-data">
            ${(p.phones || []).map(
              (ph) => html`<li>
                ${telHref(ph)
                  ? html`<a href=${telHref(ph)}><${Icon} name="phone" size=${18} /> ${ph}</a>`
                  : html`<span class="contact-plain" title="Diese Nummer lässt sich nicht automatisch wählen. Bitte unter „Bearbeiten“ prüfen."><${Icon} name="phone" size=${18} /> ${ph}</span>`}
                ${waHref(ph) && html`<a class="icon-btn small" href=${waHref(ph)} target="_blank" rel="noopener noreferrer" aria-label=${'WhatsApp an ' + ph} title="WhatsApp"><${Icon} name="whatsapp" size=${18} /></a>`}
              </li>`
            )}
            ${(p.emails || []).map((m) => html`<li><a href=${'mailto:' + m}><${Icon} name="mail" size=${18} /> ${m}</a></li>`)}
            ${p.linkedin_url && html`<li><a href=${webHref(p.linkedin_url)} target="_blank" rel="noopener noreferrer"><${Icon} name="linkedin" size=${18} /> LinkedIn</a></li>`}
          </ul>
          ${!(p.phones || []).length && !(p.emails || []).length && !p.linkedin_url && html`<${Empty}>Noch keine Kontaktdaten.<//>`}
        <//>
        <${EventsOfPerson} personId=${p.id} />
        <${Tile} title="Meetings" count=${meetings.length}>
          ${meetings.length
            ? html`<ul class="meeting-mini">${meetings.map((m) => html`<li key=${m.id}><a href=${'#/meetings/' + m.id}><span class="mm-title">${m.title}</span><span class="mm-meta">${fmtDateTime(m.held_at)}</span></a></li>`)}</ul>`
            : html`<${Empty}>Noch keine Meetings.<//>`}
        <//>
      </div>
    </div>
  </div>`
}

export function ContactForm({ id }) {
  const existing = id ? getPerson(id) : null
  const presetOrg = new URLSearchParams(location.hash.split('?')[1] || '').get('firma')
  const [form, setForm] = useState(() => ({
    name: existing ? existing.name : '',
    position: existing ? existing.position || '' : '',
    org_id: existing ? existing.org_id : presetOrg || null,
    emails: existing ? [...(existing.emails || [])] : [''],
    phones: existing ? [...(existing.phones || [])] : [''],
    linkedin_url: existing ? existing.linkedin_url || '' : '',
    labels: existing ? [...(existing.labels || [])] : [],
  }))
  const [saving, setSaving] = useState(false)
  const set = (patch) => setForm({ ...form, ...patch })
  if (id && !existing) return html`<div class="page"><${Empty}>Diesen Kontakt gibt es nicht mehr.<//></div>`

  const save = async (e) => {
    e.preventDefault()
    if (!form.name.trim() || saving) return
    setSaving(true)
    const row = {
      name: form.name.trim(),
      position: form.position.trim() || null,
      org_id: form.org_id || null,
      emails: form.emails.map((x) => x.trim()).filter(Boolean),
      phones: form.phones.map((x) => x.trim()).filter(Boolean),
      linkedin_url: form.linkedin_url.trim() || null,
      labels: form.labels,
    }
    const saved = existing ? await update('persons', existing.id, row) : await insert('persons', row)
    setSaving(false)
    if (saved) {
      toast(existing ? 'Kontakt gespeichert' : 'Kontakt angelegt')
      navigate('/kontakte/' + saved.id)
    }
  }

  const back = existing ? '#/kontakte/' + existing.id : '#/kontakte'
  return html`<div class="page page-narrow">
    <${PageHead} kicker=${existing ? 'Kontakt bearbeiten' : 'Kontakte'} title=${existing ? existing.name : 'Neuer Kontakt'} back=${{ href: back, label: 'Zurück' }} />
    <form class="form" onSubmit=${save}>
      <${Field} label="Name" htmlFor="p-name">
        <input id="p-name" value=${form.name} required autocomplete="off" onInput=${(e) => set({ name: e.target.value })} />
      <//>
      <div class="field-grid">
        <${Field} label="Position" htmlFor="p-position">
          <input id="p-position" value=${form.position} onInput=${(e) => set({ position: e.target.value })} />
        <//>
        <${Field} label="Firma" htmlFor="p-org">
          <${EntityPicker} kind="org" inputId="p-org" value=${form.org_id} onChange=${(v) => set({ org_id: v })} placeholder="Firma suchen oder neu anlegen" />
        <//>
      </div>
      <${Field} label="E-Mail-Adressen" htmlFor="p-email">
        <${ListInput} idPrefix="p-email" values=${form.emails} type="email" placeholder="name@firma.de" addLabel="Weitere E-Mail" onChange=${(emails) => set({ emails })} />
      <//>
      <${Field} label="Telefonnummern" htmlFor="p-phone">
        <${ListInput} idPrefix="p-phone" values=${form.phones} type="tel" placeholder="+49 …" addLabel="Weitere Nummer" onChange=${(phones) => set({ phones })} />
      <//>
      <${Field} label="LinkedIn" htmlFor="p-linkedin">
        <input id="p-linkedin" type="url" value=${form.linkedin_url} placeholder="https://www.linkedin.com/in/…" onInput=${(e) => set({ linkedin_url: e.target.value })} />
      <//>
      <${Field} label="Labels">
        <${LabelPicker} value=${form.labels} inputId="person-label" onChange=${(labels) => set({ labels })} />
      <//>
      <div class="form-actions">
        <a class="btn" href=${back}>Abbrechen</a>
        <button type="submit" class="btn btn-primary" disabled=${!form.name.trim() || saving}>${existing ? 'Speichern' : 'Kontakt anlegen'}</button>
      </div>
    </form>
  </div>`
}
