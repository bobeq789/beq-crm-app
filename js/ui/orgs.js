// Firmen: Liste mit Suche und Filtern, Firmenseite, Formular
import { html, useState } from '../lib/preact.js'
import { Icon } from '../lib/icons.js'
import { SETTINGS } from '../settings.js'
import { matches, webHref, webLabel, mapsHref, fmtDateTime } from '../lib/util.js'
import {
  state,
  getOrg,
  insert,
  update,
  remove,
  isOpen,
  personsOfOrg,
  meetingsOfOrg,
  allLabels,
  createCard,
  confirmDialog,
  promptDialog,
  toast,
} from '../store.js'
import { navigate, openCard } from '../router.js'
import { EmailList, emailCount } from './emails.js'
import { PageHead, Tile, Empty, Labels, TaskRow, Notes, Field, LabelInput, Avatar } from './common.js'

export function OrgsList() {
  const [query, setQuery] = useState('')
  const [industry, setIndustry] = useState('')
  const [label, setLabel] = useState('')
  const list = state.db.organizations
    .filter((o) => !industry || o.industry === industry)
    .filter((o) => !label || (o.labels || []).includes(label))
    .filter((o) => matches(query, o.name, o.website, o.address, o.industry))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))

  return html`<div class="page">
    <${PageHead}
      kicker="Adressbuch"
      title="Firmen"
      actions=${html`<a class="btn btn-primary" href="#/firmen/neu"><${Icon} name="plus" size=${18} /> Neue Firma</a>`}
    />
    <div class="list-filters">
      <label class="search">
        <${Icon} name="search" size=${18} />
        <input type="search" value=${query} placeholder="Suchen: Name, Website, Ort" aria-label="Firmen durchsuchen" onInput=${(e) => setQuery(e.target.value)} />
      </label>
      <select value=${industry} aria-label="Branche" onChange=${(e) => setIndustry(e.target.value)}>
        <option value="">Alle Branchen</option>
        ${SETTINGS.industries.map((i) => html`<option value=${i}>${i}</option>`)}
      </select>
      <select value=${label} aria-label="Label" onChange=${(e) => setLabel(e.target.value)}>
        <option value="">Alle Labels</option>
        ${allLabels().map((l) => html`<option value=${l}>${l}</option>`)}
      </select>
    </div>
    <p class="muted small list-count">${list.length} ${list.length === 1 ? 'Firma' : 'Firmen'}</p>
    ${list.length
      ? html`<ul class="row-list">
          ${list.map((o) => {
            const people = personsOfOrg(o.id).length
            return html`<li key=${o.id}>
              <a class="row-link" href=${'#/firmen/' + o.id}>
                <span class="org-icon"><${Icon} name="orgs" size=${20} /></span>
                <span class="row-main">
                  <span class="row-title">${o.name}</span>
                  <span class="row-meta">
                    ${[o.industry, people ? `${people} ${people === 1 ? 'Kontakt' : 'Kontakte'}` : null].filter(Boolean).join(' · ')}
                    <${Labels} labels=${o.labels} />
                  </span>
                </span>
                <${Icon} name="chevron" size=${18} cls="row-chevron" />
              </a>
            </li>`
          })}
        </ul>`
      : html`<${Empty}>${query || industry || label ? 'Keine Firmen gefunden.' : 'Noch keine Firmen.'}<//>`}
  </div>`
}

export function OrgDetail({ id }) {
  const o = getOrg(id)
  if (!o) {
    return html`<div class="page"><${PageHead} kicker="Firma" title="Nicht gefunden" back=${{ href: '#/firmen', label: 'Alle Firmen' }} />
      <${Empty}>Diese Firma gibt es nicht mehr.<//></div>`
  }
  const people = personsOfOrg(o.id)
  const peopleIds = new Set(people.map((p) => p.id))
  // Offene Aufgaben der Firma oder ihrer Kontakte
  const cards = state.db.cards.filter((c) => isOpen(c) && (c.org_id === o.id || (c.person_id && peopleIds.has(c.person_id))))
  const meetings = meetingsOfOrg(o.id)

  const del = async () => {
    const ok = await confirmDialog({
      title: 'Firma löschen?',
      text: `„${o.name}“ und alle Notizen dazu sind danach weg. Kontakte und Aufgaben bleiben, nur ohne diese Firma.`,
      confirmLabel: 'Löschen',
      danger: true,
    })
    if (!ok) return
    navigate('/firmen')
    await remove('organizations', o.id)
    toast('Firma gelöscht')
  }
  const newTask = async () => {
    const title = await promptDialog({ title: `Neue Aufgabe zu ${o.name}`, label: 'Titel', confirmLabel: 'Anlegen' })
    if (!title) return
    const card = await createCard({ title, org_id: o.id, kind: 'todo', assignee: state.me && state.me.email })
    if (card) openCard(card.id)
  }

  return html`<div class="page">
    <${PageHead}
      kicker="Firma"
      title=${o.name}
      back=${{ href: '#/firmen', label: 'Alle Firmen' }}
      actions=${html`<a class="btn" href=${'#/firmen/' + o.id + '/bearbeiten'}><${Icon} name="edit" size=${16} /> Bearbeiten</a>
        <button type="button" class="btn btn-danger-text" onClick=${del}><${Icon} name="trash" size=${16} /> Löschen</button>`}
    />
    <div class="detail-meta">
      ${o.industry && html`<span>${o.industry}</span>`}
      ${o.website && html`<a class="meta-item" href=${webHref(o.website)} target="_blank" rel="noopener noreferrer"><${Icon} name="globe" size=${16} /> ${webLabel(o.website)}</a>`}
      ${o.address && html`<a class="meta-item" href=${mapsHref(o.address)} target="_blank" rel="noopener noreferrer"><${Icon} name="pin" size=${16} /> ${o.address}</a>`}
      <${Labels} labels=${o.labels} />
    </div>
    <div class="detail-grid">
      <div class="col-main">
        <${Tile} title="Offene Aufgaben" count=${cards.length} actions=${html`<button type="button" class="link-btn" onClick=${newTask}><${Icon} name="plus" size=${16} /> Aufgabe</button>`}>
          ${cards.length ? html`<ul class="task-list">${cards.map((c) => html`<${TaskRow} card=${c} key=${c.id} />`)}</ul>` : html`<${Empty}>Keine offenen Aufgaben.<//>`}
        <//>
        <${Tile} title="Notizen"><${Notes} field="org_id" id=${o.id} /><//>
        <${Tile} title="E-Mails" count=${emailCount(people.map((p) => p.id))}><${EmailList} personIds=${people.map((p) => p.id)} /><//>
      </div>
      <div class="col-side">
        <${Tile} title="Kontakte" count=${people.length} actions=${html`<a class="link-btn" href=${'#/kontakte/neu?firma=' + o.id}><${Icon} name="plus" size=${16} /> Kontakt</a>`}>
          ${people.length
            ? html`<ul class="people-mini">
                ${people.map(
                  (p) => html`<li key=${p.id}><a href=${'#/kontakte/' + p.id}><${Avatar} name=${p.name} /><span><span class="pm-name">${p.name}</span>${p.position && html`<span class="muted small">${p.position}</span>`}</span></a></li>`
                )}
              </ul>`
            : html`<${Empty}>Noch keine Kontakte.<//>`}
        <//>
        <${Tile} title="Meetings" count=${meetings.length}>
          ${meetings.length
            ? html`<ul class="meeting-mini">${meetings.map((m) => html`<li key=${m.id}><a href=${'#/meetings/' + m.id}><span class="mm-title">${m.title}</span><span class="mm-meta">${fmtDateTime(m.held_at)}</span></a></li>`)}</ul>`
            : html`<${Empty}>Noch keine Meetings.<//>`}
        <//>
      </div>
    </div>
  </div>`
}

export function OrgForm({ id }) {
  const existing = id ? getOrg(id) : null
  const [form, setForm] = useState(() => ({
    name: existing ? existing.name : '',
    website: existing ? existing.website || '' : '',
    domain: existing ? existing.domain || '' : '',
    address: existing ? existing.address || '' : '',
    industry: existing ? existing.industry || '' : '',
    labels: existing ? [...(existing.labels || [])] : [],
  }))
  const [saving, setSaving] = useState(false)
  const set = (patch) => setForm({ ...form, ...patch })
  if (id && !existing) return html`<div class="page"><${Empty}>Diese Firma gibt es nicht mehr.<//></div>`

  const save = async (e) => {
    e.preventDefault()
    if (!form.name.trim() || saving) return
    setSaving(true)
    const row = {
      name: form.name.trim(),
      website: form.website.trim() || null,
      domain: form.domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '') || null,
      address: form.address.trim() || null,
      industry: form.industry || null,
      labels: form.labels,
    }
    const saved = existing ? await update('organizations', existing.id, row) : await insert('organizations', row)
    setSaving(false)
    if (saved) {
      toast(existing ? 'Firma gespeichert' : 'Firma angelegt')
      navigate('/firmen/' + saved.id)
    }
  }

  const back = existing ? '#/firmen/' + existing.id : '#/firmen'
  return html`<div class="page page-narrow">
    <${PageHead} kicker=${existing ? 'Firma bearbeiten' : 'Firmen'} title=${existing ? existing.name : 'Neue Firma'} back=${{ href: back, label: 'Zurück' }} />
    <form class="form" onSubmit=${save}>
      <${Field} label="Name" htmlFor="o-name">
        <input id="o-name" value=${form.name} required autocomplete="off" onInput=${(e) => set({ name: e.target.value })} />
      <//>
      <div class="field-grid">
        <${Field} label="Website" htmlFor="o-web">
          <input id="o-web" value=${form.website} placeholder="www.firma.de" onInput=${(e) => set({ website: e.target.value })} />
        <//>
        <${Field} label="Branche" htmlFor="o-industry">
          <select id="o-industry" value=${form.industry} onChange=${(e) => set({ industry: e.target.value })}>
            <option value="">Keine Angabe</option>
            ${SETTINGS.industries.map((i) => html`<option value=${i}>${i}</option>`)}
          </select>
        <//>
      </div>
      <${Field} label="Domain für Mails" htmlFor="o-domain" hint="Zum Beispiel firma.de. Mails von dieser Domain ordnet der Abgleich der Firma zu.">
        <input id="o-domain" value=${form.domain} placeholder="firma.de" onInput=${(e) => set({ domain: e.target.value })} />
      <//>
      <${Field} label="Adresse" htmlFor="o-address">
        <textarea id="o-address" rows="2" value=${form.address} onInput=${(e) => set({ address: e.target.value })}></textarea>
      <//>
      <${Field} label="Labels">
        <${LabelInput} value=${form.labels} suggestions=${allLabels()} onChange=${(labels) => set({ labels })} />
      <//>
      <div class="form-actions">
        <a class="btn" href=${back}>Abbrechen</a>
        <button type="submit" class="btn btn-primary" disabled=${!form.name.trim() || saving}>${existing ? 'Speichern' : 'Firma anlegen'}</button>
      </div>
    </form>
  </div>`
}
