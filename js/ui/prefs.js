// Einstellungen (Zahnrad): Farbschema pro Gerät, Konto, Team (nur Admins), Demo zurücksetzen
import { html, useState } from '../lib/preact.js'
import { Icon } from '../lib/icons.js'
import { norm } from '../lib/util.js'
import {
  state,
  isDemo,
  isAdmin,
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
} from '../store.js'
import { PageHead, Tile, Segmented, Field } from './common.js'

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
            <span class="muted small">${t.email}</span>
          </span>
          <select aria-label=${'Rolle von ' + t.name} value=${t.role} disabled=${t.email === state.me.email} onChange=${(e) => update('team_members', t.id, { role: e.target.value })}>
            ${ROLES.map((r) => html`<option value=${r.value}>${r.label}</option>`)}
          </select>
          <button type="button" class="btn btn-small" onClick=${() => toggleActive(t)}>${t.active ? 'Deaktivieren' : 'Aktivieren'}</button>
        </li>`
      )}
    </ul>
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
        <button type="button" class="btn" onClick=${() => openDialog({ kind: 'change-password' })}><${Icon} name="lock" size=${18} /> Passwort ändern</button>
        <button type="button" class="btn" onClick=${() => openDialog({ kind: 'mfa-reset' })}><${Icon} name="reset" size=${18} /> Zweiten Faktor neu einrichten</button>
        ${!isDemo && html`<button type="button" class="btn" onClick=${signOut}><${Icon} name="logout" size=${18} /> Abmelden</button>`}
      </div>
    <//>

    ${isAdmin() && html`<${TeamAdmin} />`}

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
