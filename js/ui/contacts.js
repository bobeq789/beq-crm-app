// Kontakte: Liste mit Suche und Filter, Kontaktseite, Formular
import { html, useState, useEffect } from '../lib/preact.js'
import { Icon } from '../lib/icons.js'
import { matches, telHref, waHref, webHref, fmtDateTime, fmtDate, fmtTimeRange, local, norm } from '../lib/util.js'
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
  activeMembers,
  member,
  memberName,
  myEmail,
  loadAltdaten,
} from '../store.js'
import { navigate, openCard, openEvent } from '../router.js'
import { EmailList, emailCount } from './emails.js'
import { ActivitySection } from './activities.js'
import { PageHead, Tile, Empty, Labels, TaskRow, Notes, Field, ListInput, LabelPicker, EntityPicker, Segmented, Avatar, CallLink } from './common.js'

// Beim Sortieren Titel wie „Dr.“ überspringen
const sortName = (name) => String(name || '').replace(/^(Dr\.|Prof\.)\s+/i, '')

// Seitenweise anzeigen: mit dem alten CRM sind es mehrere tausend Kontakte (29_altcrm.sql)
const PAGE = 100

// Herkünfte, die häufigste zuerst
function allSources() {
  const count = new Map()
  state.db.persons.forEach((p) => p.herkunft && count.set(p.herkunft, (count.get(p.herkunft) || 0) + 1))
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'de')).map(([s]) => s)
}

export function ContactsList() {
  const [query, setQuery] = useState('')
  const [label, setLabel] = useState('')
  const [source, setSource] = useState('')
  const [scope, setScope] = useState(local.get('beqcrm-contacts-scope', 'alle'))
  const [sort, setSort] = useState(local.get('beqcrm-contacts-sort', 'name'))
  const [limit, setLimit] = useState(PAGE)
  const me = norm(myEmail())
  const guest = isGuest()
  const list = state.db.persons
    .filter((p) => guest || scope !== 'meine' || norm(p.betreuer) === me)
    .filter((p) => !label || (p.labels || []).includes(label))
    .filter((p) => !source || p.herkunft === source)
    .filter((p) => matches(query, p.name, (getOrg(p.org_id) || {}).name, p.emails, p.phones, p.position))
    .sort((a, b) => (sort === 'name' ? sortName(a.name).localeCompare(sortName(b.name), 'de') : String(b.updated_at).localeCompare(String(a.updated_at))))
  // Neue Suche oder neuer Filter: wieder ab der ersten Seite
  useEffect(() => setLimit(PAGE), [query, label, source, scope, sort])
  const sources = allSources()

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
      ${!guest &&
      html`<${Segmented}
        label="Betreuer"
        value=${scope}
        onChange=${(v) => {
          setScope(v)
          local.set('beqcrm-contacts-scope', v)
        }}
        options=${[
          { value: 'meine', label: 'Meine' },
          { value: 'alle', label: 'Alle' },
        ]}
      />`}
      <select value=${label} aria-label="Label" onChange=${(e) => setLabel(e.target.value)}>
        <option value="">Alle Labels</option>
        ${allLabels().map((l) => html`<option value=${l}>${l}</option>`)}
      </select>
      ${sources.length > 0 &&
      html`<select value=${source} aria-label="Herkunft" onChange=${(e) => setSource(e.target.value)}>
        <option value="">Alle Herkünfte</option>
        ${sources.map((s) => html`<option value=${s}>${s}</option>`)}
      </select>`}
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
    <p class="muted small list-count">${list.length.toLocaleString('de-DE')} ${list.length === 1 ? 'Kontakt' : 'Kontakte'}</p>
    ${list.length
      ? html`<ul class="row-list">
          ${list.slice(0, limit).map((p) => {
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
        </ul>
        ${list.length > limit &&
        html`<button type="button" class="link-btn list-more" onClick=${() => setLimit(limit + PAGE)}>
          Weitere ${Math.min(PAGE, list.length - limit)} anzeigen (noch ${(list.length - limit).toLocaleString('de-DE')})
        </button>`}`
      : html`<${Empty}>${query || label || source ? 'Keine Kontakte gefunden.' : scope === 'meine' && !guest ? 'Du betreust noch keine Kontakte. Unter „Alle“ siehst du alle.' : 'Noch keine Kontakte.'}<//>`}
  </div>`
}

// Betreuer des Kontakts (29_altcrm.sql): wer im Team ihn betreut. Gäste sehen nur den Namen.
function BetreuerField({ person }) {
  const current = norm(person.betreuer)
  if (isGuest()) return current ? html`<p class="muted small betreuer-line">Betreut von ${memberName(current)}</p>` : null
  const team = activeMembers()
  const known = !current || team.some((t) => norm(t.email) === current)
  return html`<label class="betreuer-line">
    <span class="muted small">Betreut von</span>
    <select
      value=${current}
      aria-label="Betreuer"
      onChange=${(e) => update('persons', person.id, { betreuer: e.target.value || null })}
    >
      <option value="">[niemand]</option>
      ${!known && html`<option value=${current}>${memberName(current) || current} (nicht mehr im Team)</option>`}
      ${team.map((t) => html`<option value=${norm(t.email)}>${norm(t.email) === norm(myEmail()) ? t.name + ' (ich)' : t.name}</option>`)}
    </select>
  </label>`
}

// Block aus dem alten CRM: erst beim Aufklappen laden (lange Texte, 29_altcrm.sql). Als Text,
// nie als HTML.
function OldCrmData({ person }) {
  // undefined: noch nicht geladen, '' : gibt es nicht, null: Fehler
  const [text, setText] = useState(undefined)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let current = true
    setText(undefined)
    setOpen(false)
    if (!isGuest()) loadAltdaten(person.id).then((t) => current && setText(t))
    return () => {
      current = false
    }
  }, [person.id])
  if (isGuest() || !text) return null
  return html`<${Tile} title="Aus dem alten CRM">
    <button type="button" class="link-btn" aria-expanded=${open} onClick=${() => setOpen(!open)}>
      ${open ? 'Ausblenden' : 'Anzeigen'}
    </button>
    ${open && html`<div class="old-crm">${text}</div>`}
  <//>`
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
      text: `„${p.name}“ und alle Notizen dazu sind danach weg. Deals und Meetings bleiben, nur ohne diesen Kontakt.`,
      confirmLabel: 'Löschen',
      danger: true,
    })
    if (!ok) return
    navigate('/kontakte')
    await remove('persons', p.id)
    toast('Kontakt gelöscht')
  }
  const newTask = async () => {
    const title = await promptDialog({ title: `Neuer Deal zu ${p.name}`, label: 'Titel', confirmLabel: 'Anlegen' })
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
      ${p.herkunft && html`<span class="meta-item">Herkunft: ${p.herkunft}</span>`}
    </div>
    <${BetreuerField} person=${p} />
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
        <${Tile} title="Offene Deals" count=${cards.length} actions=${html`<button type="button" class="link-btn" onClick=${newTask}><${Icon} name="plus" size=${16} /> Deal</button>`}>
          ${cards.length ? html`<ul class="task-list">${cards.map((c) => html`<${TaskRow} card=${c} key=${c.id} />`)}</ul>` : html`<${Empty}>Keine offenen Deals.<//>`}
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
        <${OldCrmData} person=${p} />
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
    // Neuer Kontakt: betreut von der Person, die ihn anlegt
    betreuer: existing ? existing.betreuer || '' : isGuest() ? '' : norm(myEmail()),
    herkunft: existing ? existing.herkunft || '' : '',
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
      ...(isGuest() ? {} : { betreuer: form.betreuer || null, herkunft: form.herkunft.trim() || null }),
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
      ${!isGuest() &&
      html`<div class="field-grid">
        <${Field} label="Betreut von" htmlFor="p-betreuer">
          <select id="p-betreuer" value=${form.betreuer} onChange=${(e) => set({ betreuer: e.target.value })}>
            <option value="">[niemand]</option>
            ${form.betreuer && !activeMembers().some((t) => norm(t.email) === form.betreuer) && html`<option value=${form.betreuer}>${memberName(form.betreuer)} (nicht mehr im Team)</option>`}
            ${activeMembers().map((t) => html`<option value=${norm(t.email)}>${t.name}</option>`)}
          </select>
        <//>
        <${Field} label="Herkunft" htmlFor="p-herkunft">
          <input id="p-herkunft" value=${form.herkunft} placeholder="zum Beispiel Messe, Empfehlung" onInput=${(e) => set({ herkunft: e.target.value })} />
        <//>
      </div>`}
      <div class="form-actions">
        <a class="btn" href=${back}>Abbrechen</a>
        <button type="submit" class="btn btn-primary" disabled=${!form.name.trim() || saving}>${existing ? 'Speichern' : 'Kontakt anlegen'}</button>
      </div>
    </form>
  </div>`
}
