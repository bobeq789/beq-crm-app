// Firmen: Liste mit Suche und Filtern, Firmenseite, Formular
import { html, useState, useEffect } from '../lib/preact.js'
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
  isGuest,
  activitiesForOrg,
} from '../store.js'
import { ActivitySection } from './activities.js'
import { navigate, openCard } from '../router.js'
import { EmailList, emailCount } from './emails.js'
import { PageHead, Tile, Empty, Labels, TaskRow, Notes, Field, LabelPicker, Avatar, CallLink } from './common.js'
import { t, locale } from '../i18n.js'

export function OrgsList() {
  const [query, setQuery] = useState('')
  const [industry, setIndustry] = useState('')
  const [label, setLabel] = useState('')
  // Seitenweise anzeigen (mit dem alten CRM tausende Firmen)
  const [limit, setLimit] = useState(100)
  useEffect(() => setLimit(100), [query, industry, label])
  const list = state.db.organizations
    .filter((o) => !industry || o.industry === industry)
    .filter((o) => !label || (o.labels || []).includes(label))
    .filter((o) => matches(query, o.name, o.website, o.address, o.industry))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))

  return html`<div class="page">
    <${PageHead}
      kicker=${t('Adressbuch')}
      title=${t('Firmen')}
      actions=${html`<a class="btn btn-primary" href="#/firmen/neu"><${Icon} name="plus" size=${18} /> ${t('Neue Firma')}</a>`}
    />
    <div class="list-filters">
      <label class="search">
        <${Icon} name="search" size=${18} />
        <input type="search" value=${query} placeholder=${t('Suchen: Name, Website, Ort')} aria-label=${t('Firmen durchsuchen')} onInput=${(e) => setQuery(e.target.value)} />
      </label>
      <select value=${industry} aria-label=${t('Branche')} onChange=${(e) => setIndustry(e.target.value)}>
        <option value="">${t('Alle Branchen')}</option>
        ${SETTINGS.industries.map((i) => html`<option value=${i}>${i}</option>`)}
      </select>
      <select value=${label} aria-label="Label" onChange=${(e) => setLabel(e.target.value)}>
        <option value="">${t('Alle Labels')}</option>
        ${allLabels().map((l) => html`<option value=${l}>${l}</option>`)}
      </select>
    </div>
    <p class="muted small list-count">${list.length === 1 ? t('1 Firma') : t('{n} Firmen', { n: list.length.toLocaleString(locale()) })}</p>
    ${list.length
      ? html`<ul class="row-list">
          ${list.slice(0, limit).map((o) => {
            const people = personsOfOrg(o.id).length
            return html`<li key=${o.id}>
              <a class="row-link" href=${'#/firmen/' + o.id}>
                <span class="org-icon"><${Icon} name="orgs" size=${20} /></span>
                <span class="row-main">
                  <span class="row-title">${o.name}</span>
                  <span class="row-meta">
                    ${[o.industry, people ? (people === 1 ? t('1 Kontakt') : t('{n} Kontakte', { n: people })) : null].filter(Boolean).join(' · ')}
                    <${Labels} labels=${o.labels} />
                  </span>
                </span>
                <${Icon} name="chevron" size=${18} cls="row-chevron" />
              </a>
            </li>`
          })}
        </ul>
        ${list.length > limit &&
        html`<button type="button" class="link-btn list-more" onClick=${() => setLimit(limit + 100)}>
          ${t('Weitere {n} anzeigen (noch {rest})', { n: Math.min(100, list.length - limit), rest: (list.length - limit).toLocaleString(locale()) })}
        </button>`}`
      : html`<${Empty}>${query || industry || label ? t('Keine Firmen gefunden.') : t('Noch keine Firmen.')}<//>`}
  </div>`
}

export function OrgDetail({ id }) {
  const o = getOrg(id)
  if (!o) {
    return html`<div class="page"><${PageHead} kicker=${t('Firma')} title=${t('Nicht gefunden')} back=${{ href: '#/firmen', label: t('Alle Firmen') }} />
      <${Empty}>${t('Diese Firma gibt es nicht mehr.')}<//></div>`
  }
  const people = personsOfOrg(o.id)
  const peopleIds = new Set(people.map((p) => p.id))
  // Offene Aufgaben der Firma oder ihrer Kontakte
  const cards = state.db.cards.filter((c) => isOpen(c) && (c.org_id === o.id || (c.person_id && peopleIds.has(c.person_id))))
  const meetings = meetingsOfOrg(o.id)

  const del = async () => {
    const ok = await confirmDialog({
      title: t('Firma löschen?'),
      text: t('„{name}“ und alle Notizen dazu sind danach weg. Kontakte und Deals bleiben, nur ohne diese Firma.', { name: o.name }),
      confirmLabel: t('Löschen'),
      danger: true,
    })
    if (!ok) return
    navigate('/firmen')
    await remove('organizations', o.id)
    toast(t('Firma gelöscht'))
  }
  const newTask = async () => {
    const title = await promptDialog({ title: t('Neuer Deal zu {name}', { name: o.name }), label: t('Titel'), confirmLabel: t('Anlegen') })
    if (!title) return
    const card = await createCard({ title, org_id: o.id, kind: 'todo', assignee: state.me && state.me.email })
    if (card) openCard(card.id)
  }

  return html`<div class="page">
    <${PageHead}
      kicker=${t('Firma')}
      title=${o.name}
      back=${{ href: '#/firmen', label: t('Alle Firmen') }}
      actions=${html`<a class="btn" href=${'#/firmen/' + o.id + '/bearbeiten'}><${Icon} name="edit" size=${16} /> ${t('Bearbeiten')}</a>
        <button type="button" class="btn btn-danger-text" onClick=${del}><${Icon} name="trash" size=${16} /> ${t('Löschen')}</button>`}
    />
    <div class="detail-meta">
      ${o.industry && html`<span>${o.industry}</span>`}
      ${o.website && html`<a class="meta-item" href=${webHref(o.website)} target="_blank" rel="noopener noreferrer"><${Icon} name="globe" size=${16} /> ${webLabel(o.website)}</a>`}
      ${o.address && html`<a class="meta-item" href=${mapsHref(o.address)} target="_blank" rel="noopener noreferrer"><${Icon} name="pin" size=${16} /> ${o.address}</a>`}
    </div>
    <div class="detail-labels">
      ${isGuest()
        ? html`<${Labels} labels=${o.labels} />`
        : html`<${LabelPicker} value=${o.labels} inputId="org-label-inline" onChange=${(labels) => update('organizations', o.id, { labels })} />`}
    </div>
    <div class="detail-grid">
      <div class="col-main">
        <${Tile} title=${t('Offene Deals')} count=${cards.length} actions=${html`<button type="button" class="link-btn" onClick=${newTask}><${Icon} name="plus" size=${16} /> Deal</button>`}>
          ${cards.length ? html`<ul class="task-list">${cards.map((c) => html`<${TaskRow} card=${c} key=${c.id} />`)}</ul>` : html`<${Empty}>${t('Keine offenen Deals.')}<//>`}
        <//>
        ${!isGuest() && html`<${ActivitySection} list=${activitiesForOrg(o.id)} here="org" target=${{ org_id: o.id }} />`}
        <${Tile} title=${t('Notizen')}><${Notes} field="org_id" id=${o.id} /><//>
        <${Tile} title=${t('E-Mails')} count=${emailCount(people.map((p) => p.id))}><${EmailList} personIds=${people.map((p) => p.id)} /><//>
      </div>
      <div class="col-side">
        <${Tile} title=${t('Kontakte')} count=${people.length} actions=${html`<a class="link-btn" href=${'#/kontakte/neu?firma=' + o.id}><${Icon} name="plus" size=${16} /> ${t('Kontakt')}</a>`}>
          ${people.length
            ? html`<ul class="people-mini">
                ${people.map(
                  (p) => html`<li key=${p.id} class="row-with-call">
                    <a href=${'#/kontakte/' + p.id}><${Avatar} name=${p.name} /><span><span class="pm-name">${p.name}</span>${p.position && html`<span class="muted small">${p.position}</span>`}</span></a>
                    <${CallLink} name=${p.name} phones=${p.phones} />
                  </li>`
                )}
              </ul>`
            : html`<${Empty}>${t('Noch keine Kontakte.')}<//>`}
        <//>
        <${Tile} title="Meetings" count=${meetings.length}>
          ${meetings.length
            ? html`<ul class="meeting-mini">${meetings.map((m) => html`<li key=${m.id}><a href=${'#/meetings/' + m.id}><span class="mm-title">${m.title}</span><span class="mm-meta">${fmtDateTime(m.held_at)}</span></a></li>`)}</ul>`
            : html`<${Empty}>${t('Noch keine Meetings.')}<//>`}
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
  if (id && !existing) return html`<div class="page"><${Empty}>${t('Diese Firma gibt es nicht mehr.')}<//></div>`

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
      toast(existing ? t('Firma gespeichert') : t('Firma angelegt'))
      navigate('/firmen/' + saved.id)
    }
  }

  const back = existing ? '#/firmen/' + existing.id : '#/firmen'
  return html`<div class="page page-narrow">
    <${PageHead} kicker=${existing ? t('Firma bearbeiten') : t('Firmen')} title=${existing ? existing.name : t('Neue Firma')} back=${{ href: back, label: t('Zurück') }} />
    <form class="form" onSubmit=${save}>
      <${Field} label="Name" htmlFor="o-name">
        <input id="o-name" value=${form.name} required autocomplete="off" onInput=${(e) => set({ name: e.target.value })} />
      <//>
      <div class="field-grid">
        <${Field} label="Website" htmlFor="o-web">
          <input id="o-web" value=${form.website} placeholder=${t('www.firma.de')} onInput=${(e) => set({ website: e.target.value })} />
        <//>
        <${Field} label=${t('Branche')} htmlFor="o-industry">
          <select id="o-industry" value=${form.industry} onChange=${(e) => set({ industry: e.target.value })}>
            <option value="">${t('Keine Angabe')}</option>
            ${SETTINGS.industries.map((i) => html`<option value=${i}>${i}</option>`)}
          </select>
        <//>
      </div>
      <${Field} label=${t('Domain für Mails')} htmlFor="o-domain" hint=${t('Zum Beispiel firma.de. Mails von dieser Domain ordnet der Abgleich der Firma zu.')}>
        <input id="o-domain" value=${form.domain} placeholder=${t('firma.de')} onInput=${(e) => set({ domain: e.target.value })} />
      <//>
      <${Field} label=${t('Adresse')} htmlFor="o-address">
        <textarea id="o-address" rows="2" value=${form.address} onInput=${(e) => set({ address: e.target.value })}></textarea>
      <//>
      <${Field} label="Labels">
        <${LabelPicker} value=${form.labels} inputId="org-label" onChange=${(labels) => set({ labels })} />
      <//>
      <div class="form-actions">
        <a class="btn" href=${back}>${t('Abbrechen')}</a>
        <button type="submit" class="btn btn-primary" disabled=${!form.name.trim() || saving}>${existing ? t('Speichern') : t('Firma anlegen')}</button>
      </div>
    </form>
  </div>`
}
