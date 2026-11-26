// Einstellungen (Zahnrad): Farbschema pro Gerät, Konto, Mitteilungen aufs Handy, Postfächer und Kalender, abonnierte Kalender, Terminlink, Claude verbinden, Team (nur Admins), Produkte (Sales), Demo zurücksetzen
import { html, useState, useEffect } from '../lib/preact.js'
import { Icon } from '../lib/icons.js'
import { norm, fmtEuro } from '../lib/util.js'
import { parseEuro } from './deal.js'
import {
  setProfilePhoto,
  removeProfilePhoto,
  avatarUrl,
  state,
  isDemo,
  isAdmin,
  isSuperAdmin,
  isGuest,
  getTheme,
  setTheme,
  setUiLang,
  signOut,
  openDialog,
  insert,
  update,
  confirmDialog,
  resetDemo,
  toast,
  errorText,
  myEmail,
  savePrefs,
  terminSatz,
  normalizeLink,
  myActiveMailboxes,
  DEFAULT_TERMINSATZ,
} from '../store.js'
import { PageHead, Tile, Segmented, Field, Avatar } from './common.js'
import { squareJpeg } from '../lib/image.js'
import { MailboxTile, CalendarSubTile } from './mailboxes.js'
import { ClaudeTile } from './claude.js'
import { t, getLang } from '../i18n.js'
import { canPromptInstall, promptInstall, installHowTo, justInstalled } from '../install.js'
import {
  pushSupported,
  isIos,
  isStandalone,
  refreshPushState,
  enablePush,
  disablePush,
  sendTestPush,
  pushPrefs,
  savePushPrefs,
} from '../push.js'

const ROLES = [
  { value: 'admin', label: 'Admin' },
  { value: 'mitglied', label: 'Mitglied' },
  { value: 'gast', label: 'Gast' },
]
const roleLabel = (r) => t((ROLES.find((x) => x.value === r) || { label: r }).label)

function TeamAdmin() {
  const [form, setForm] = useState({ name: '', email: '', role: 'mitglied' })
  const set = (patch) => setForm({ ...form, ...patch })
  const list = [...state.db.team_members].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'de'))
  const add = async (e) => {
    e.preventDefault()
    const email = form.email.trim().toLowerCase()
    if (!form.name.trim() || !/@/.test(email)) return
    if (state.db.team_members.some((t) => norm(t.email) === email)) {
      toast(t('Diese Adresse steht schon im Team.'), { error: true })
      return
    }
    const row = await insert('team_members', { name: form.name.trim(), email, role: form.role, active: true })
    if (row) {
      toast(t('{name} eingetragen. Jetzt noch das Anmeldekonto in Supabase anlegen.', { name: row.name }))
      setForm({ name: '', email: '', role: 'mitglied' })
    }
  }
  const toggleActive = async (m) => {
    if (m.email === state.me.email) {
      toast(t('Dich selbst kannst du nicht deaktivieren.'), { error: true })
      return
    }
    if (m.active) {
      const ok = await confirmDialog({
        title: t('{name} deaktivieren?', { name: m.name }),
        text: t('Die Person kommt danach nicht mehr ins CRM. Deals und Notizen bleiben erhalten. Lösch das Anmeldekonto zusätzlich in Supabase.'),
        confirmLabel: t('Deaktivieren'),
        danger: true,
      })
      if (!ok) return
    }
    update('team_members', m.id, { active: !m.active })
  }

  const salesTeams = [...new Set(state.db.team_members.map((t) => t.sales_team).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'))

  return html`<${Tile} title=${t('Team')} count=${list.filter((m) => m.active).length}>
    <p class="muted small">
      ${t('Wer hier aktiv eingetragen ist, darf ins CRM. Das Anmeldekonto legst du zusätzlich in Supabase an („Authentication“, „Users“, „Add user“). Ein verlorener zweiter Faktor wird dort unter „Authentication“, „Users“ zurückgesetzt.')}
    </p>
    <ul class="team-list">
      ${list.map(
        (m) => html`<li class=${m.active ? '' : 'inactive'} key=${m.id}>
          <${Avatar} email=${m.email} />
          <span class="team-who">
            <strong>${m.name}</strong>
            <span class="muted small">${m.email}${m.super_admin ? ' · Super-Admin' : ''}</span>
          </span>
          <select
            aria-label=${t('Rolle von {name}', { name: m.name })}
            value=${m.role}
            disabled=${m.email === state.me.email || (m.super_admin && !isSuperAdmin())}
            title=${m.super_admin && !isSuperAdmin() ? t('Den Super-Admin ändert nur der Super-Admin selbst.') : undefined}
            onChange=${(e) => update('team_members', m.id, { role: e.target.value })}
          >
            ${ROLES.map((r) => html`<option value=${r.value}>${t(r.label)}</option>`)}
          </select>
          ${m.role !== 'gast' && html`<${SalesTeamFields} member=${m} teams=${salesTeams} />`}
          <button type="button" class="btn btn-small" disabled=${m.super_admin && !isSuperAdmin()} onClick=${() => toggleActive(m)}>${m.active ? t('Deaktivieren') : t('Aktivieren')}</button>
        </li>`
      )}
    </ul>
    <p class="muted small">
      ${t('Sales-Team und Teamlead bestimmen, wer welche Zahlen in „Sales“ sieht: jeder seine eigenen, ein Teamlead die seines Sales-Teams, Admins alle.')}
    </p>
    <form class="team-add" onSubmit=${add}>
      <h3 class="section-title">${t('Neue Person')}</h3>
      <div class="field-grid three">
        <${Field} label=${t('Name')} htmlFor="tm-name"><input id="tm-name" value=${form.name} onInput=${(e) => set({ name: e.target.value })} /><//>
        <${Field} label=${t('E-Mail')} htmlFor="tm-email"><input id="tm-email" type="email" value=${form.email} onInput=${(e) => set({ email: e.target.value })} /><//>
        <${Field} label=${t('Rolle')} htmlFor="tm-role">
          <select id="tm-role" value=${form.role} onChange=${(e) => set({ role: e.target.value })}>
            ${ROLES.map((r) => html`<option value=${r.value}>${t(r.label)}</option>`)}
          </select>
        <//>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary" disabled=${!form.name.trim() || !/@/.test(form.email)}>${t('Eintragen')}</button>
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
      aria-label=${t('Sales-Team von {name}', { name: member.name })}
      placeholder=${t('Sales-Team')}
      list="sales-teams"
      value=${team}
      onInput=${(e) => setTeam(e.target.value)}
      onBlur=${save}
      onKeyDown=${(e) => e.key === 'Enter' && e.target.blur()}
    />
    <datalist id="sales-teams">${teams.map((t) => html`<option value=${t}></option>`)}</datalist>
    <label class="check-label" title=${t('Teamlead sieht die Zahlen des ganzen Sales-Teams')}>
      <input
        type="checkbox"
        checked=${!!member.team_lead}
        disabled=${!member.sales_team}
        onChange=${(e) => update('team_members', member.id, { team_lead: e.target.checked })}
      />
      ${t('Teamlead')}
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
    if (!form.name.trim() || price === null) return toast(t('Bitte Name und Preis in Euro eingeben.'), { error: true })
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
    if (price === null) return toast(t('Bitte einen Preis in Euro eingeben, zum Beispiel 3.500.'), { error: true })
    if (price !== Number(p.price_cents)) update('products', p.id, { price_cents: price })
  }
  return html`<${Tile} title=${t('Produkte')} count=${list.filter((p) => p.active).length}>
    <p class="muted small">${t('Preise netto ohne MwSt. Ein geänderter Preis gilt für neue Produktzeilen, bestehende Deals behalten ihren Preis.')}</p>
    <ul class="product-list">
      ${list.map(
        (p) => html`<li key=${p.id} class=${p.active ? '' : 'inactive'}>
          <span class="team-who">
            <strong>${p.name}</strong>
            <span class="muted small">${t('{n} Netzwerkplätze', { n: p.places + p.bonus_places })}${p.bonus_places ? ' ' + t('({a} + {b} gratis)', { a: p.places, b: p.bonus_places }) : ''}</span>
          </span>
          ${admin
            ? html`<input class="product-price" aria-label=${t('Preis von {name}', { name: p.name })} inputmode="decimal" value=${String(p.price_cents / 100)} onBlur=${(e) => changePrice(p, e.target.value)} />
                <button type="button" class="btn btn-small" onClick=${() => toggle(p)}>${p.active ? t('Ausblenden') : t('Einblenden')}</button>`
            : html`<strong>${fmtEuro(p.price_cents)}</strong>`}
        </li>`
      )}
    </ul>
    ${admin &&
    html`<form class="team-add" onSubmit=${add}>
      <h3 class="section-title">${t('Neues Produkt')}</h3>
      <div class="field-grid four">
        <${Field} label=${t('Name')} htmlFor="pr-name"><input id="pr-name" value=${form.name} onInput=${(e) => setForm({ ...form, name: e.target.value })} /><//>
        <${Field} label=${t('Preis in Euro')} htmlFor="pr-price"><input id="pr-price" inputmode="decimal" value=${form.price} onInput=${(e) => setForm({ ...form, price: e.target.value })} /><//>
        <${Field} label=${t('Plätze')} htmlFor="pr-places"><input id="pr-places" type="number" min="0" value=${form.places} onInput=${(e) => setForm({ ...form, places: e.target.value })} /><//>
        <${Field} label=${t('davon gratis dazu')} htmlFor="pr-bonus"><input id="pr-bonus" type="number" min="0" value=${form.bonus} onInput=${(e) => setForm({ ...form, bonus: e.target.value })} /><//>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary" disabled=${!form.name.trim() || !form.price.trim()}>${t('Anlegen')}</button>
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
    if (main === null) return setError(t('Der Standard-Link sieht nicht wie ein Link aus. Bitte prüfen, zum Beispiel https://calendly.com/dein-name.'))
    const links = {}
    for (const [address, value] of Object.entries(per)) {
      const n = normalizeLink(value)
      if (n === null) return setError(t('Der Link für {address} sieht nicht wie ein Link aus. Bitte prüfen.', { address }))
      if (n) links[address] = n
    }
    setError(null)
    if (await savePrefs({ terminlink: main, terminsatz: satz.trim(), terminlinks: links })) {
      setLink(main)
      setPer({ ...per, ...links })
      toast(t('Terminlink gespeichert'))
    }
  }
  return html`<${Tile} title=${t('Terminlink')}>
    <form class="terminlink-settings" onSubmit=${save}>
      <p class="muted small">${t('Dein eigener Buchungslink, zum Beispiel von Calendly. Im Mailfenster fügt der Knopf „Terminlink“ den Satz und den Link an der Cursorstelle ein. Gilt auf allen deinen Geräten.')}</p>
      <${Field} label=${t('Standard-Link')} htmlFor="pref-terminlink">
        <input id="pref-terminlink" value=${link} placeholder=${t('https://calendly.com/dein-name')} inputmode="url" autocomplete="off" onInput=${(e) => setLink(e.target.value)} />
      <//>
      <${Field} label=${t('Satz davor')} htmlFor="pref-terminsatz" hint=${t('Leer heißt nur der Link.')}>
        <input id="pref-terminsatz" value=${satz} placeholder=${DEFAULT_TERMINSATZ} onInput=${(e) => setSatz(e.target.value)} />
      <//>
      ${boxes.length > 0 &&
      html`<button type="button" class="history-toggle" aria-expanded=${showPer} onClick=${() => setShowPer(!showPer)}>
        <${Icon} name="chevron" size=${16} /> ${t('Je Postfach ein anderer Link')}
      </button>`}
      ${showPer &&
      boxes.map(
        (b) => html`<${Field} label=${b.address} htmlFor=${'pref-terminlink-' + b.address} key=${b.address}>
          <input
            id=${'pref-terminlink-' + b.address}
            value=${per[b.address] || ''}
            placeholder=${t('leer heißt Standard-Link')}
            inputmode="url"
            autocomplete="off"
            onInput=${(e) => setPer({ ...per, [b.address]: e.target.value })}
          />
        <//>`
      )}
      ${error && html`<p class="form-error" role="alert">${error}</p>`}
      <div class="settings-actions"><button type="submit" class="btn btn-primary">${t('Speichern')}</button></div>
    </form>
  <//>`
}

// Das CRM als App (install.js, Wunsch vom 26.11.2026): Vollbild ohne Adressleiste, auf dem iPhone
// Voraussetzung für Mitteilungen. Läuft es schon als App, steht nur ein Satz da.
function InstallTile() {
  const [busy, setBusy] = useState(false)
  if (isStandalone() || justInstalled()) {
    return html`<${Tile} title=${t('App auf diesem Gerät')}>
      <p class="push-status on" role="status">${justInstalled() ? t('Installiert. Öffne das CRM ab jetzt über das Symbol auf dem Startbildschirm.') : t('Du nutzt das CRM als App, im Vollbild ohne Adressleiste.')}</p>
    <//>`
  }
  const install = async () => {
    setBusy(true)
    await promptInstall()
    setBusy(false)
  }
  return html`<${Tile} title=${t('App auf diesem Gerät')}>
    <p class="muted small">${t('Als App öffnet sich das CRM im Vollbild ohne Adressleiste, mit eigenem Symbol auf dem Startbildschirm.')}${isIos() ? ' ' + t('Auf dem iPhone kommen Mitteilungen nur in der App an.') : ''}</p>
    ${canPromptInstall()
      ? html`<div class="settings-actions"><button type="button" class="btn btn-primary" disabled=${busy} onClick=${install}><${Icon} name="plus" size=${18} /> ${t('App installieren')}</button></div>`
      : html`<p class="install-howto">${t(installHowTo())}</p>`}
  <//>`
}

// Mitteilungen aufs Handy (34_chat_push.sql): je Gerät einschalten, Einstellungen für alle Geräte
function PushTile() {
  const p = state.push
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    refreshPushState()
  }, [])
  const prefs = pushPrefs()
  const guest = isGuest()
  const channels = state.chat.rooms.filter((r) => r.art === 'kanal' && !r.archiviert)
  const kanaele = prefs.kanaele || []
  const run = async (fn) => {
    setBusy(true)
    await fn()
    setBusy(false)
  }
  const flag = (key) => prefs[key] !== false
  let status
  if (isDemo) status = t('Im Demo-Modus gibt es keine Mitteilungen aufs Handy. Die Einstellungen kannst du trotzdem ansehen.')
  // iPhone zuerst: Im Browser-Tab (Safari wie Chrome) fehlt dort die Push-Schnittstelle ganz,
  // der Weg führt immer über die App vom Home-Bildschirm
  else if (isIos() && !isStandalone()) status = t('Auf dem iPhone geht das nur aus der App auf dem Home-Bildschirm.') + ' ' + t(installHowTo()) + ' ' + t('Dann das CRM von dort öffnen und hier einschalten.')
  else if (!pushSupported() && isIos()) status = t('Dieses iPhone kann noch keine Mitteilungen empfangen. Bitte iOS auf Version 16.4 oder neuer aktualisieren.')
  else if (!pushSupported()) status = t('Dieser Browser kann keine Mitteilungen empfangen. Bitte das CRM in Chrome, Edge, Firefox oder Safari öffnen.')
  else if (p.permission === 'denied') status = t('Mitteilungen sind im Browser blockiert. Erlaube sie in den Einstellungen des Browsers für diese Seite, dann hier einschalten.')
  else status = p.here ? t('Auf diesem Gerät sind Mitteilungen an.') : t('Auf diesem Gerät sind Mitteilungen aus.')
  const canSwitch = !isDemo && pushSupported() && !(isIos() && !isStandalone()) && p.permission !== 'denied'
  const devices = p.devices || []
  return html`<${Tile} title=${t('Mitteilungen aufs Handy')}>
    <p class="muted small">${t('Neue Chat-Nachrichten als Mitteilung, auch wenn das CRM zu ist. Schalte jedes Gerät einzeln ein. Was ankommt, gilt für alle deine Geräte.')}</p>
    <p class=${p.here ? 'push-status on' : 'push-status'} role="status">${status}</p>
    ${devices.length > 0 &&
    html`<p class="muted small">${t('An auf:')} ${devices.map((d) => d.geraet || t('Gerät')).join(', ')}</p>`}
    <div class="settings-actions">
      ${p.here
        ? html`<button type="button" class="btn" disabled=${busy} onClick=${() => run(disablePush)}><${Icon} name="bell" size=${18} /> ${t('Auf diesem Gerät ausschalten')}</button>`
        : html`<button type="button" class="btn btn-primary" disabled=${busy || !canSwitch} onClick=${() => run(enablePush)}><${Icon} name="bell" size=${18} /> ${t('Auf diesem Gerät einschalten')}</button>`}
      <button type="button" class="btn" disabled=${busy || isDemo || !devices.length} onClick=${() => run(sendTestPush)}>${t('Testmitteilung schicken')}</button>
    </div>
    ${guest
      ? html`<p class="muted small">${t('Du bekommst Mitteilungen, wenn dich jemand mit @ erwähnt oder im Verlauf auf deine Nachricht antwortet.')}</p>`
      : html`<div class="push-prefs">
          <${Segmented}
            label=${t('Vorschau')}
            value=${prefs.vorschau === 'name' ? 'name' : 'text'}
            onChange=${(v) => savePushPrefs({ vorschau: v })}
            options=${[
              { value: 'text', label: t('Name und Textanfang') },
              { value: 'name', label: t('Nur Name') },
            ]}
          />
          <fieldset class="push-kinds">
            <legend>${t('Mitteilung bei')}</legend>
            <label class="check-label"><input type="checkbox" checked=${flag('direkt')} onChange=${(e) => savePushPrefs({ direkt: e.target.checked })} /> ${t('Direktnachrichten')}</label>
            <label class="check-label"><input type="checkbox" checked=${flag('gruppen')} onChange=${(e) => savePushPrefs({ gruppen: e.target.checked })} /> ${t('Gruppen')}</label>
            <label class="check-label"><input type="checkbox" checked=${flag('erwaehnungen')} onChange=${(e) => savePushPrefs({ erwaehnungen: e.target.checked })} /> ${t('@Erwähnungen und Antworten im Verlauf')}</label>
            <label class="check-label"><input type="checkbox" checked=${flag('zuweisungen')} onChange=${(e) => savePushPrefs({ zuweisungen: e.target.checked })} /> ${t('Deals und Aktivitäten, die dir jemand gibt')}</label>
          </fieldset>
          ${channels.length > 0 &&
          html`<fieldset class="push-kinds">
            <legend>${t('Kanäle (nur die, die du einschaltest)')}</legend>
            ${channels.map(
              (r) => html`<label class="check-label" key=${r.id}>
                <input
                  type="checkbox"
                  checked=${kanaele.includes(r.id)}
                  onChange=${(e) => savePushPrefs({ kanaele: e.target.checked ? [...kanaele.filter((id) => id !== r.id), r.id] : kanaele.filter((id) => id !== r.id) })}
                />
                # ${r.name}
              </label>`
            )}
          </fieldset>`}
          <p class="muted small">${t('Einzelne Gruppen und Direktnachrichten schaltest du im Chat oben mit der Glocke stumm.')}</p>
        </div>`}
  <//>`
}

// Profilfoto (38_profilfotos.sql): Bild auswählen, die App schneidet quadratisch zu und
// verkleinert auf 256 Pixel (ohne Zusatzdaten wie Aufnahmeort), dann hochladen. Gäste nicht.
function ProfilePhotoTile() {
  const [busy, setBusy] = useState(false)
  const me = myEmail()
  const has = !!avatarUrl(me)
  const pick = async (e) => {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file) return
    if (!/^image\//.test(file.type)) return toast(t('Bitte ein Bild auswählen (JPG, PNG oder HEIC).'), { error: true })
    setBusy(true)
    try {
      const blob = await squareJpeg(file, 256)
      await setProfilePhoto(blob)
      toast(t('Profilfoto gespeichert'))
    } catch (err) {
      toast(err && err.message === 'bild' ? t('Das Bild ließ sich nicht lesen. Bitte ein anderes Foto nehmen (JPG oder PNG).') : errorText(err), { error: true })
    }
    setBusy(false)
  }
  const drop = async () => {
    setBusy(true)
    try {
      await removeProfilePhoto()
      toast(t('Profilfoto entfernt'))
    } catch (err) {
      toast(errorText(err), { error: true })
    }
    setBusy(false)
  }
  return html`<${Tile} title=${t('Profilfoto')}>
    <div class="profile-photo">
      <${Avatar} email=${me} size="lg" />
      <div>
        <p class="muted small">${t('Dein Foto erscheint überall, wo dein Name steht: auf Karten, im Chat, an Notizen und im Team. Sehen können es nur Teammitglieder, Gäste nicht.')}</p>
        <div class="settings-actions">
          <label class=${'btn btn-primary' + (busy ? ' disabled' : '')}>
            <${Icon} name="plus" size=${18} /> ${has ? t('Anderes Foto') : t('Foto auswählen')}
            <input type="file" accept="image/*" class="sr-only" disabled=${busy} onChange=${pick} />
          </label>
          ${has && html`<button type="button" class="btn" disabled=${busy} onClick=${drop}><${Icon} name="trash" size=${18} /> ${t('Entfernen')}</button>`}
        </div>
      </div>
    </div>
  <//>`
}

export function SettingsPage() {
  const me = state.me || {}
  const theme = getTheme()
  return html`<div class="page page-narrow">
    <${PageHead} kicker=${t('Einstellungen')} title=${t('Einstellungen')} />

    <${Tile} title=${t('Darstellung')}>
      <p class="muted small">${t('Das Farbschema gilt nur auf diesem Gerät.')}</p>
      <${Segmented}
        label=${t('Farbschema')}
        value=${theme}
        onChange=${setTheme}
        options=${[
          { value: 'auto', label: t('Automatisch') },
          { value: 'light', label: t('Hell') },
          { value: 'dark', label: t('Dunkel') },
        ]}
      />
      <p class="muted small">${t('Die Sprache gilt für dich auf allen Geräten.')}</p>
      <${Segmented} label=${t('Sprache')} value=${getLang()} onChange=${setUiLang} options=${[{ value: 'de', label: 'Deutsch' }, { value: 'en', label: 'English' }]} />
    <//>

    <${Tile} title=${t('Konto')}>
      <dl class="account-data">
        <dt>${t('Name')}</dt><dd>${me.name}</dd>
        <dt>${t('E-Mail')}</dt><dd>${me.email}</dd>
        <dt>${t('Rolle')}</dt><dd>${roleLabel(state.role)}</dd>
      </dl>
      <div class="settings-actions">
        ${!state.sessionGoogle &&
        html`<button type="button" class="btn" onClick=${() => openDialog({ kind: 'change-password' })}><${Icon} name="lock" size=${18} /> ${t('Passwort ändern')}</button>`}
        <button type="button" class="btn" onClick=${() => openDialog({ kind: 'mfa-reset' })}><${Icon} name="reset" size=${18} /> ${t('Zweiten Faktor neu einrichten')}</button>
        ${!isDemo && html`<button type="button" class="btn" onClick=${signOut}><${Icon} name="logout" size=${18} /> ${t('Abmelden')}</button>`}
      </div>
    <//>

    ${!isGuest() && html`<${ProfilePhotoTile} />`}
    <${InstallTile} />
    ${state.chat.available && html`<${PushTile} key=${state.prefsLoaded ? 'geladen' : 'leer'} />`}
    ${!isGuest() && html`<${MailboxTile} />`}
    ${!isGuest() && html`<${CalendarSubTile} />`}
    ${!isGuest() && html`<${TerminlinkTile} key=${state.prefsLoaded ? 'geladen' : 'leer'} />`}
    ${!isGuest() && html`<${ClaudeTile} />`}
    ${isAdmin() && html`<${TeamAdmin} />`}
    ${!isGuest() && html`<${ProductCatalog} />`}

    ${isDemo &&
    html`<${Tile} title="Demo">
      <p class="muted small">${t('Alle Daten sind erfunden und liegen nur in diesem Browser.')}${isGuest() ? ' ' + t('Du siehst die App gerade so, wie ein Gast sie sieht.') : ''}</p>
      <div class="settings-actions">
        <button
          type="button"
          class="btn"
          onClick=${async () => {
            const ok = await confirmDialog({ title: t('Demo zurücksetzen?'), text: t('Alles, was du in der Demo geändert hast, wird durch frische Beispieldaten ersetzt.'), confirmLabel: t('Zurücksetzen') })
            if (ok) {
              resetDemo()
              toast(t('Beispieldaten sind frisch'))
            }
          }}
        >
          <${Icon} name="reset" size=${18} /> ${t('Demo zurücksetzen')}
        </button>
        ${isGuest()
          ? html`<a class="btn" href="?demo#/">${t('Als Teammitglied ansehen')}</a>`
          : html`<a class="btn" href="?demo&gast#/geteilt">${t('Als Gast ansehen')}</a>`}
      </div>
    <//>`}
  </div>`
}
