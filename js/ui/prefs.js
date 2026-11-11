// Einstellungen (Zahnrad): Farbschema pro Gerät, Konto, Postfächer und Kalender, Terminlink, Claude verbinden, Team (nur Admins), Produkte (Sales), Demo zurücksetzen
import { html, useState } from '../lib/preact.js'
import { Icon } from '../lib/icons.js'
import { norm, fmtEuro } from '../lib/util.js'
import { parseEuro } from './deal.js'
import {
  state,
  isDemo,
  isAdmin,
  isSuperAdmin,
  isGuest,
  getTheme,
  setTheme,
  signOut,
  openDialog,
  insert,
  update,
  confirmDialog,
  resetDemo,
  toast,
  savePrefs,
  terminSatz,
  normalizeLink,
  myActiveMailboxes,
  DEFAULT_TERMINSATZ,
} from '../store.js'
import { PageHead, Tile, Segmented, Field } from './common.js'
import { MailboxTile } from './mailboxes.js'
import { ClaudeTile } from './claude.js'

const ROLES = [
  { value: 'admin', label: 'Admin' },
  { value: 'mitglied', label: 'Mitglied' },
  { value: 'gast', label: 'Gast' },
]
const roleLabel = (r) => (ROLES.find((x) => x.value === r) || { label: r }).label

function TeamAdmin() {
  const [form, setForm] = useState({ name: '', email: '', role: 'mitglied' })
  const set = (patch) => setForm({ ...form, ...patch })
  const list = [...state.db.team_members].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'de'))
  const add = async (e) => {
    e.preventDefault()
    const email = form.email.trim().toLowerCase()
    if (!form.name.trim() || !/@/.test(email)) return
    if (state.db.team_members.some((t) => norm(t.email) === email)) {
      toast('Diese Adresse steht schon im Team.', { error: true })
      return
    }
    const row = await insert('team_members', { name: form.name.trim(), email, role: form.role, active: true })
    if (row) {
      toast(`${row.name} eingetragen. Jetzt noch das Anmeldekonto in Supabase anlegen.`)
      setForm({ name: '', email: '', role: 'mitglied' })
    }
  }
  const toggleActive = async (t) => {
    if (t.email === state.me.email) {
      toast('Dich selbst kannst du nicht deaktivieren.', { error: true })
      return
    }
    if (t.active) {
      const ok = await confirmDialog({
        title: `${t.name} deaktivieren?`,
        text: 'Die Person kommt danach nicht mehr ins CRM. Aufgaben und Notizen bleiben erhalten. Lösch das Anmeldekonto zusätzlich in Supabase.',
        confirmLabel: 'Deaktivieren',
        danger: true,
      })
      if (!ok) return
    }
    update('team_members', t.id, { active: !t.active })
  }

  const salesTeams = [...new Set(state.db.team_members.map((t) => t.sales_team).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'))

  return html`<${Tile} title="Team" count=${list.filter((t) => t.active).length}>
    <p class="muted small">
      Wer hier aktiv eingetragen ist, darf ins CRM. Das Anmeldekonto legst du zusätzlich in Supabase an („Authentication“, „Users“, „Add user“).
      Ein verlorener zweiter Faktor wird dort unter „Authentication“, „Users“ zurückgesetzt.
    </p>
    <ul class="team-list">
      ${list.map(
        (t) => html`<li class=${t.active ? '' : 'inactive'} key=${t.id}>
          <span class="team-who">
            <strong>${t.name}</strong>
            <span class="muted small">${t.email}${t.super_admin ? ' · Super-Admin' : ''}</span>
          </span>
          <select
            aria-label=${'Rolle von ' + t.name}
            value=${t.role}
            disabled=${t.email === state.me.email || (t.super_admin && !isSuperAdmin())}
            title=${t.super_admin && !isSuperAdmin() ? 'Den Super-Admin ändert nur der Super-Admin selbst.' : undefined}
            onChange=${(e) => update('team_members', t.id, { role: e.target.value })}
          >
            ${ROLES.map((r) => html`<option value=${r.value}>${r.label}</option>`)}
          </select>
          ${t.role !== 'gast' && html`<${SalesTeamFields} member=${t} teams=${salesTeams} />`}
          <button type="button" class="btn btn-small" disabled=${t.super_admin && !isSuperAdmin()} onClick=${() => toggleActive(t)}>${t.active ? 'Deaktivieren' : 'Aktivieren'}</button>
        </li>`
      )}
    </ul>
    <p class="muted small">
      Sales-Team und Teamlead bestimmen, wer welche Zahlen in „Sales“ sieht: jeder seine eigenen, ein Teamlead die seines Sales-Teams, Admins alle.
    </p>
    <form class="team-add" onSubmit=${add}>
      <h3 class="section-title">Neue Person</h3>
      <div class="field-grid three">
        <${Field} label="Name" htmlFor="tm-name"><input id="tm-name" value=${form.name} onInput=${(e) => set({ name: e.target.value })} /><//>
        <${Field} label="E-Mail" htmlFor="tm-email"><input id="tm-email" type="email" value=${form.email} onInput=${(e) => set({ email: e.target.value })} /><//>
        <${Field} label="Rolle" htmlFor="tm-role">
          <select id="tm-role" value=${form.role} onChange=${(e) => set({ role: e.target.value })}>
            ${ROLES.map((r) => html`<option value=${r.value}>${r.label}</option>`)}
          </select>
        <//>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary" disabled=${!form.name.trim() || !/@/.test(form.email)}>Eintragen</button>
      </div>
    </form>
  <//>`
}

// Sales-Team (frei benennbar, zum Beispiel „Team Eichenauer“) und Teamlead einer Person
function SalesTeamFields({ member, teams }) {
  const [team, setTeam] = useState(member.sales_team || '')
  const save = () => {
    const v = team.trim() || null
    if (v !== (member.sales_team || null)) update('team_members', member.id, { sales_team: v, team_lead: v ? member.team_lead : false })
  }
  return html`<span class="sales-team-fields">
    <input
      aria-label=${'Sales-Team von ' + member.name}
      placeholder="Sales-Team"
      list="sales-teams"
      value=${team}
      onInput=${(e) => setTeam(e.target.value)}
      onBlur=${save}
      onKeyDown=${(e) => e.key === 'Enter' && e.target.blur()}
    />
    <datalist id="sales-teams">${teams.map((t) => html`<option value=${t}></option>`)}</datalist>
    <label class="check-label" title="Teamlead sieht die Zahlen des ganzen Sales-Teams">
      <input
        type="checkbox"
        checked=${!!member.team_lead}
        disabled=${!member.sales_team}
        onChange=${(e) => update('team_members', member.id, { team_lead: e.target.checked })}
      />
      Teamlead
    </label>
  </span>`
}

// Produktkatalog für Deals: Preise netto in Euro, Netzwerkplätze je Stück (bezahlt und gratis).
// Alle im Team sehen ihn, ändern dürfen nur Admins.
function ProductCatalog() {
  const admin = isAdmin()
  const list = [...(state.db.products || [])].sort((a, b) => Number(b.active) - Number(a.active) || a.sort - b.sort)
  const [form, setForm] = useState({ name: '', price: '', places: '1', bonus: '0' })
  const add = async (e) => {
    e.preventDefault()
    const price = parseEuro(form.price)
    if (!form.name.trim() || price === null) return toast('Bitte Name und Preis in Euro eingeben.', { error: true })
    const sort = Math.max(0, ...list.map((p) => p.sort)) + 1
    const saved = await insert('products', {
      name: form.name.trim(),
      price_cents: price,
      places: Math.max(0, parseInt(form.places, 10) || 0),
      bonus_places: Math.max(0, parseInt(form.bonus, 10) || 0),
      sort,
    })
    if (saved) setForm({ name: '', price: '', places: '1', bonus: '0' })
  }
  const toggle = (p) => update('products', p.id, { active: !p.active })
  const changePrice = (p, text) => {
    const price = parseEuro(text)
    if (price === null) return toast('Bitte einen Preis in Euro eingeben, zum Beispiel 3.500.', { error: true })
    if (price !== Number(p.price_cents)) update('products', p.id, { price_cents: price })
  }
  return html`<${Tile} title="Produkte" count=${list.filter((p) => p.active).length}>
    <p class="muted small">Preise netto ohne MwSt. Ein geänderter Preis gilt für neue Produktzeilen, bestehende Deals behalten ihren Preis.</p>
    <ul class="product-list">
      ${list.map(
        (p) => html`<li key=${p.id} class=${p.active ? '' : 'inactive'}>
          <span class="team-who">
            <strong>${p.name}</strong>
            <span class="muted small">${p.places + p.bonus_places} Netzwerkplätze${p.bonus_places ? ` (${p.places} + ${p.bonus_places} gratis)` : ''}</span>
          </span>
          ${admin
            ? html`<input class="product-price" aria-label=${'Preis von ' + p.name} inputmode="decimal" value=${String(p.price_cents / 100)} onBlur=${(e) => changePrice(p, e.target.value)} />
                <button type="button" class="btn btn-small" onClick=${() => toggle(p)}>${p.active ? 'Ausblenden' : 'Einblenden'}</button>`
            : html`<strong>${fmtEuro(p.price_cents)}</strong>`}
        </li>`
      )}
    </ul>
    ${admin &&
    html`<form class="team-add" onSubmit=${add}>
      <h3 class="section-title">Neues Produkt</h3>
      <div class="field-grid four">
        <${Field} label="Name" htmlFor="pr-name"><input id="pr-name" value=${form.name} onInput=${(e) => setForm({ ...form, name: e.target.value })} /><//>
        <${Field} label="Preis in Euro" htmlFor="pr-price"><input id="pr-price" inputmode="decimal" value=${form.price} onInput=${(e) => setForm({ ...form, price: e.target.value })} /><//>
        <${Field} label="Plätze" htmlFor="pr-places"><input id="pr-places" type="number" min="0" value=${form.places} onInput=${(e) => setForm({ ...form, places: e.target.value })} /><//>
        <${Field} label="davon gratis dazu" htmlFor="pr-bonus"><input id="pr-bonus" type="number" min="0" value=${form.bonus} onInput=${(e) => setForm({ ...form, bonus: e.target.value })} /><//>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary" disabled=${!form.name.trim() || !form.price.trim()}>Anlegen</button>
      </div>
    </form>`}
  <//>`
}

// Terminlink (B11): Standard-Link, Satz davor, aufklappbar ein anderer Link je eigenem Postfach.
// Gespeichert je Person auf allen Geräten (nutzer_einstellungen). Gäste haben das nicht.
function TerminlinkTile() {
  const boxes = myActiveMailboxes()
  const saved = state.prefs.terminlinks || {}
  const [link, setLink] = useState(state.prefs.terminlink || '')
  const [satz, setSatz] = useState(terminSatz())
  const [per, setPer] = useState(() => Object.fromEntries(boxes.map((b) => [b.address, saved[b.address] || ''])))
  const [showPer, setShowPer] = useState(Object.values(saved).some(Boolean))
  const [error, setError] = useState(null)
  const save = async (e) => {
    e.preventDefault()
    const main = normalizeLink(link)
    if (main === null) return setError('Der Standard-Link sieht nicht wie ein Link aus. Bitte prüfen, zum Beispiel https://calendly.com/dein-name.')
    const links = {}
    for (const [address, value] of Object.entries(per)) {
      const n = normalizeLink(value)
      if (n === null) return setError(`Der Link für ${address} sieht nicht wie ein Link aus. Bitte prüfen.`)
      if (n) links[address] = n
    }
    setError(null)
    if (await savePrefs({ terminlink: main, terminsatz: satz.trim(), terminlinks: links })) {
      setLink(main)
      setPer({ ...per, ...links })
      toast('Terminlink gespeichert')
    }
  }
  return html`<${Tile} title="Terminlink">
    <form class="terminlink-settings" onSubmit=${save}>
      <p class="muted small">Dein eigener Buchungslink, zum Beispiel von Calendly. Im Mailfenster fügt der Knopf „Terminlink“ den Satz und den Link an der Cursorstelle ein. Gilt auf allen deinen Geräten.</p>
      <${Field} label="Standard-Link" htmlFor="pref-terminlink">
        <input id="pref-terminlink" value=${link} placeholder="https://calendly.com/dein-name" inputmode="url" autocomplete="off" onInput=${(e) => setLink(e.target.value)} />
      <//>
      <${Field} label="Satz davor" htmlFor="pref-terminsatz" hint="Leer heißt nur der Link.">
        <input id="pref-terminsatz" value=${satz} placeholder=${DEFAULT_TERMINSATZ} onInput=${(e) => setSatz(e.target.value)} />
      <//>
      ${boxes.length > 0 &&
      html`<button type="button" class="history-toggle" aria-expanded=${showPer} onClick=${() => setShowPer(!showPer)}>
        <${Icon} name="chevron" size=${16} /> Je Postfach ein anderer Link
      </button>`}
      ${showPer &&
      boxes.map(
        (b) => html`<${Field} label=${b.address} htmlFor=${'pref-terminlink-' + b.address} key=${b.address}>
          <input
            id=${'pref-terminlink-' + b.address}
            value=${per[b.address] || ''}
            placeholder="leer heißt Standard-Link"
            inputmode="url"
            autocomplete="off"
            onInput=${(e) => setPer({ ...per, [b.address]: e.target.value })}
          />
        <//>`
      )}
      ${error && html`<p class="form-error" role="alert">${error}</p>`}
      <div class="settings-actions"><button type="submit" class="btn btn-primary">Speichern</button></div>
    </form>
  <//>`
}

export function SettingsPage() {
  const me = state.me || {}
  const theme = getTheme()
  return html`<div class="page page-narrow">
    <${PageHead} kicker="Einstellungen" title="Einstellungen" />

    <${Tile} title="Darstellung">
      <p class="muted small">Gilt nur auf diesem Gerät.</p>
      <${Segmented}
        label="Farbschema"
        value=${theme}
        onChange=${setTheme}
        options=${[
          { value: 'auto', label: 'Automatisch' },
          { value: 'light', label: 'Hell' },
          { value: 'dark', label: 'Dunkel' },
        ]}
      />
    <//>

    <${Tile} title="Konto">
      <dl class="account-data">
        <dt>Name</dt><dd>${me.name}</dd>
        <dt>E-Mail</dt><dd>${me.email}</dd>
        <dt>Rolle</dt><dd>${roleLabel(state.role)}</dd>
      </dl>
      <div class="settings-actions">
        ${!state.sessionGoogle &&
        html`<button type="button" class="btn" onClick=${() => openDialog({ kind: 'change-password' })}><${Icon} name="lock" size=${18} /> Passwort ändern</button>`}
        <button type="button" class="btn" onClick=${() => openDialog({ kind: 'mfa-reset' })}><${Icon} name="reset" size=${18} /> Zweiten Faktor neu einrichten</button>
        ${!isDemo && html`<button type="button" class="btn" onClick=${signOut}><${Icon} name="logout" size=${18} /> Abmelden</button>`}
      </div>
    <//>

    ${!isGuest() && html`<${MailboxTile} />`}
    ${!isGuest() && html`<${TerminlinkTile} key=${state.prefsLoaded ? 'geladen' : 'leer'} />`}
    ${!isGuest() && html`<${ClaudeTile} />`}
    ${isAdmin() && html`<${TeamAdmin} />`}
    ${!isGuest() && html`<${ProductCatalog} />`}

    ${isDemo &&
    html`<${Tile} title="Demo">
      <p class="muted small">Alle Daten sind erfunden und liegen nur in diesem Browser.${isGuest() ? ' Du siehst die App gerade so, wie ein Gast sie sieht.' : ''}</p>
      <div class="settings-actions">
        <button
          type="button"
          class="btn"
          onClick=${async () => {
            const ok = await confirmDialog({ title: 'Demo zurücksetzen?', text: 'Alles, was du in der Demo geändert hast, wird durch frische Beispieldaten ersetzt.', confirmLabel: 'Zurücksetzen' })
            if (ok) {
              resetDemo()
              toast('Beispieldaten sind frisch')
            }
          }}
        >
          <${Icon} name="reset" size=${18} /> Demo zurücksetzen
        </button>
        ${isGuest()
          ? html`<a class="btn" href="?demo#/">Als Teammitglied ansehen</a>`
          : html`<a class="btn" href="?demo&gast#/geteilt">Als Gast ansehen</a>`}
      </div>
    <//>`}
  </div>`
}
