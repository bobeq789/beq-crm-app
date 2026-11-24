// Einstellungen: Postfächer und Kalender (10_postfaecher.sql, Edge Function „google-verbinden“).
// Jede Person verbindet ihre beQ-Postfächer selbst über Google, auch mehrere.
// Je Postfach lassen sich weitere Kalender des Google-Kontos dazunehmen (35_weitere_kalender.sql).
// Kalender per Link (iCal) abonnieren: CalendarSubTile weiter unten (39_kalender_abos.sql).
// Google schickt danach zurück nach #/einstellungen?postfach=ok|fehler&…, diese Seite meldet das Ergebnis.
import { html, useEffect } from '../lib/preact.js'
import { Icon } from '../lib/icons.js'
import { fmtRelative, norm } from '../lib/util.js'
import { useRoute } from '../router.js'
import { state, isSuperAdmin, myEmail, memberName, update, toast, confirmDialog, connectMailbox, disconnectMailbox, mailboxDataCounts, syncNow, loadMailboxCalendars, toggleMailboxCalendar, promptDialog, addCalendarSub, changeCalendarSub, removeCalendarSub } from '../store.js'
import { useState } from '../lib/preact.js'
import { Tile, Field } from './common.js'

// Gründe, die „google-verbinden“ bei einem Fehler mitschickt
const FAILURES = {
  abgelehnt: () => 'Du hast die Anmeldung bei Google abgebrochen. Es wurde nichts verbunden.',
  abgelaufen: () => 'Die Anfrage war zu alt. Bitte tipp noch einmal auf „Postfach verbinden“.',
  google: () => 'Google hat die Anmeldung nicht bestätigt. Bitte gleich noch einmal versuchen.',
  'kein-zugang': () => 'Google hat keinen dauerhaften Zugang erteilt. Bitte noch einmal verbinden.',
  adresse: () => 'Google hat keine bestätigte E-Mail-Adresse geschickt. Bitte mit einem beQ-Konto anmelden.',
  'keine-rechte': (a) => `Für ${a || 'dieses Postfach'} wurden weder Mails noch Kalender freigegeben. Bitte noch einmal verbinden und alle Häkchen setzen.`,
  speichern: () => 'Der Zugang ließ sich nicht speichern. Bitte gleich noch einmal versuchen.',
  'anderes-konto': (a) => `Bei Google war ${a || 'ein anderes Konto'} gewählt. Weitere Postfächer verbindest du hier mit „Postfach verbinden“.`,
}

function resultText(params) {
  const address = params.get('adresse') || ''
  if (params.get('postfach') === 'ok') {
    const mail = params.get('mail') !== '0'
    const calendar = params.get('kalender') !== '0'
    const only = !mail ? ' Google hat nur den Kalender freigegeben.' : !calendar ? ' Google hat nur die Mails freigegeben.' : ''
    return { text: `${address} ist verbunden.${only} Mails und Termine kommen mit dem nächsten Abgleich.`, error: false }
  }
  const reason = FAILURES[params.get('grund')] || FAILURES.google
  return { text: reason(address), error: true }
}

// Rückmeldung von Google einmal anzeigen und dann aus der Adresse entfernen
function useConnectResult() {
  const route = useRoute()
  const result = route.params.get('postfach')
  useEffect(() => {
    if (!result) return
    const { text, error } = resultText(route.params)
    toast(text, { error, duration: 9000 })
    history.replaceState(null, '', location.pathname + location.search + '#/einstellungen')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }, [result])
}

function statusText(box) {
  if (box.status === 'fehler') return { text: 'Zugang bei Google beendet. Bitte neu verbinden.', error: true }
  if (box.last_error) return { text: 'Letzter Abgleich hat nicht geklappt. Der nächste Versuch läuft von selbst.', error: true }
  if (box.last_sync_at) return { text: `abgeglichen ${fmtRelative(box.last_sync_at)}`, error: false }
  return { text: 'wartet auf den ersten Abgleich', error: false }
}

async function askDisconnect(box) {
  const ok = await confirmDialog({
    title: `${box.address} trennen?`,
    text: 'Das CRM liest danach nichts Neues mehr aus diesem Postfach. Den Zugang kannst du zusätzlich in deinem Google-Konto entfernen („Sicherheit“, „Drittanbieter-Apps und -Dienste“).',
    confirmLabel: 'Trennen',
    danger: true,
  })
  if (!ok) return
  const { mails, events } = mailboxDataCounts(box.address)
  let deleteData = false
  if (mails + events > 0) {
    deleteData = await confirmDialog({
      title: 'Bisherige Mails und Termine löschen?',
      text: `Im CRM liegen ${mails} ${mails === 1 ? 'Mail' : 'Mails'} und ${events} ${events === 1 ? 'Termin' : 'Termine'} aus ${box.address}. Ohne Löschen bleiben sie für das Team sichtbar.`,
      confirmLabel: 'Löschen',
      cancelLabel: 'Behalten',
      danger: true,
    })
  }
  await disconnectMailbox(box, deleteData)
}

function MailboxRow({ box }) {
  const me = norm(myEmail())
  const mine = box.owner === me
  const canManage = mine || isSuperAdmin()
  const active = box.status === 'aktiv'
  const status = statusText(box)
  const toggle = (field, value) => {
    // Mindestens eins muss an bleiben, sonst ist „Trennen“ der richtige Weg
    const other = field === 'sync_mail' ? box.sync_calendar : box.sync_mail
    if (!value && !other) return toast('Mails und Kalender ganz aus? Dann trenn das Postfach lieber.', { error: true })
    update('mailboxes', box.id, { [field]: value })
  }
  return html`<li>
    <span class="team-who">
      <strong>${box.address}</strong>
      <span class="muted small">${mine ? 'von dir verbunden' : `verbunden von ${memberName(box.owner)}`}</span>
      <span class=${status.error ? 'small overdue-text' : 'muted small'} title=${box.last_error || ''}>${status.text}</span>
    </span>
    <span class="mailbox-switches">
      <label class="check-label">
        <input type="checkbox" checked=${box.sync_mail} disabled=${!canManage || !active} onChange=${(e) => toggle('sync_mail', e.target.checked)} />
        Mails
      </label>
      <label class="check-label">
        <input type="checkbox" checked=${box.sync_calendar} disabled=${!canManage || !active} onChange=${(e) => toggle('sync_calendar', e.target.checked)} />
        Kalender
      </label>
    </span>
    <span class="mailbox-actions">
      ${mine && box.status === 'fehler' && html`<button type="button" class="btn btn-small" onClick=${connectMailbox}>Neu verbinden</button>`}
      ${canManage && html`<button type="button" class="btn btn-small" onClick=${() => askDisconnect(box)}>Trennen</button>`}
    </span>
    ${mine && active && box.sync_calendar && html`<${MoreCalendars} box=${box} />`}
  </li>`
}

// Weitere Kalender dieses Google-Kontos: aufklappen, einzeln ankreuzen
function MoreCalendars({ box }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(null)
  const all = (state.mailboxCalendars || []).filter((k) => k.mailbox_id === box.id && !k.primaer)
  const on = all.filter((k) => k.aktiv).length
  const id = 'kalender-' + box.id
  const toggle = async (k, value) => {
    setBusy(k.id)
    await toggleMailboxCalendar(k, value)
    setBusy(null)
  }
  return html`<div class="mailbox-calendars">
    <button type="button" class="history-toggle" aria-expanded=${open} aria-controls=${id} onClick=${() => setOpen(!open)}>
      <${Icon} name="chevron" size=${16} /> Weitere Kalender${on ? ` (${on} an)` : ''}
    </button>
    ${open &&
    html`<div id=${id}>
      ${all.length
        ? html`<ul class="mailbox-calendar-list">
            ${all.map(
              (k) => html`<li key=${k.id}>
                <label class="check-label">
                  <input type="checkbox" checked=${k.aktiv} disabled=${busy === k.id} onChange=${(e) => toggle(k, e.target.checked)} />
                  <span>${k.name || '[ohne Namen]'}</span>
                  ${k.zugriff === 'reader' && html`<span class="muted small">nur lesen</span>`}
                </label>
              </li>`
            )}
          </ul>`
        : html`<p class="muted small">Noch keine weiteren Kalender bekannt. „Jetzt abgleichen“ holt die Liste aus Google.</p>`}
      <p class="muted small">Angekreuzte Kalender kommen mit ihren Terminen ins CRM, wie dein Hauptkalender. Sehen können sie auch dein Teamlead und der Super-Admin. Ausschalten nimmt die Termine wieder heraus, in Google bleibt alles.</p>
    </div>`}
  </div>`
}

function SyncButton() {
  const [busy, setBusy] = useState(false)
  return html`<button
    type="button"
    class="btn"
    disabled=${busy}
    onClick=${async () => {
      setBusy(true)
      await syncNow()
      await loadMailboxCalendars()
      setBusy(false)
    }}
  >
    <${Icon} name="sync" size=${18} /> ${busy ? 'Gleicht ab …' : 'Jetzt abgleichen'}
  </button>`
}

export function MailboxTile() {
  useConnectResult()
  useEffect(() => {
    loadMailboxCalendars()
  }, [])
  const me = norm(myEmail())
  // Fremde Postfächer sieht nur der Super-Admin (26_super_admin.sql, in Supabase regelt das die Datenbank)
  const list = (state.db.mailboxes || [])
    .filter((b) => b.status !== 'getrennt' && (b.owner === me || isSuperAdmin()))
    .sort((a, b) => Number(b.owner === me) - Number(a.owner === me) || a.address.localeCompare(b.address, 'de'))
  return html`<${Tile} title="Postfächer und Kalender" count=${list.length}>
    <p class="muted small">
      Verbinde deine beQ-Postfächer, gern auch mehrere. Das CRM liest dann Mails und Termine mit. Senden, Einladen und Löschen geht nur, wenn du es im CRM selbst auslöst, und nur in deinen eigenen Postfächern. Gelöschte Mails landen im Papierkorb von Gmail.
      Deine Mails liest nur du. Deine Termine sehen außerdem dein Teamlead und der Super-Admin, andere Admins nicht, Gäste nie. Verbinde nur Postfächer, für die du zustimmen darfst.
    </p>
    ${list.length > 0 && html`<ul class="team-list mailbox-list">${list.map((b) => html`<${MailboxRow} key=${b.id} box=${b} />`)}</ul>`}
    <div class="settings-actions">
      <button type="button" class="btn btn-primary" onClick=${connectMailbox}><${Icon} name="plus" size=${18} /> Postfach verbinden</button>
      ${list.some((b) => b.owner === me && b.status === 'aktiv') && html`<${SyncButton} />`}
    </div>
    <p class="muted small mailbox-hint">Google fragt jedes Mal, welches Konto. Für ein weiteres Postfach meldest du dich dort mit diesem Postfach an.</p>
  <//>`
}

// ------------------------------------------------------------
// Abonnierte Kalender (39_kalender_abos.sql): ein Kalender per iCal-Link, ohne Anmeldung bei
// diesem Konto. Der Link geht einmal an die Datenbank und wird nie wieder angezeigt, weil jeder,
// der ihn hat, den Kalender lesen kann. Termine holt der Abgleich alle 15 Minuten, nur lesen.
// ------------------------------------------------------------
function subStatus(a) {
  if (!a.aktiv) return { text: 'ausgeschaltet', error: false }
  if (a.last_error) return { text: a.last_error, error: true }
  if (a.last_sync_at) return { text: `${a.termine ?? 0} ${a.termine === 1 ? 'Termin' : 'Termine'}, abgeglichen ${fmtRelative(a.last_sync_at)}`, error: false }
  return { text: 'wartet auf den ersten Abgleich', error: false }
}

function CalendarSubRow({ sub }) {
  const [busy, setBusy] = useState(false)
  const status = subStatus(sub)
  const run = async (fn) => {
    setBusy(true)
    await fn()
    setBusy(false)
  }
  const rename = async () => {
    const name = await promptDialog({ title: 'Kalender umbenennen', label: 'Name', value: sub.name })
    if (name && name.trim() && name.trim() !== sub.name) run(() => changeCalendarSub(sub.id, { name: name.trim() }))
  }
  const remove = async () => {
    const ok = await confirmDialog({
      title: `„${sub.name}“ entfernen?`,
      text: 'Die Termine dieses Kalenders verschwinden aus dem CRM. Im Original-Kalender bleibt alles. Zum erneuten Abonnieren brauchst du den Link noch einmal.',
      confirmLabel: 'Entfernen',
      danger: true,
    })
    if (ok) run(() => removeCalendarSub(sub.id))
  }
  return html`<li>
    <span class="team-who">
      <strong>${sub.name}</strong>
      <span class=${status.error ? 'small overdue-text' : 'muted small'}>${status.text}</span>
    </span>
    <span class="mailbox-switches">
      <label class="check-label">
        <input type="checkbox" checked=${sub.aktiv} disabled=${busy} onChange=${(e) => run(() => changeCalendarSub(sub.id, { aktiv: e.target.checked }))} />
        An
      </label>
    </span>
    <span class="mailbox-actions">
      <button type="button" class="btn btn-small" disabled=${busy} onClick=${rename}>Umbenennen</button>
      <button type="button" class="btn btn-small" disabled=${busy} onClick=${remove}>Entfernen</button>
    </span>
  </li>`
}

function CalendarSubForm({ onDone }) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [help, setHelp] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim()) return setError('Bitte gib dem Kalender einen Namen.')
    if (!url.trim()) return setError('Bitte füge den Link des Kalenders ein.')
    setBusy(true)
    setError('')
    const fail = await addCalendarSub(name, url)
    setBusy(false)
    if (fail) return setError(fail)
    setUrl('')
    setName('')
    onDone()
  }
  return html`<form class="calsub-form" onSubmit=${submit}>
    <${Field} label="Name im CRM" htmlFor="calsub-name">
      <input id="calsub-name" value=${name} maxlength="80" placeholder="zum Beispiel Messen 2027" autocomplete="off" onInput=${(e) => setName(e.target.value)} />
    <//>
    <${Field} label="Link des Kalenders (iCal)" htmlFor="calsub-url" hint="Beginnt mit https:// oder webcal://. Der Link wird nach dem Speichern nicht mehr angezeigt.">
      <input id="calsub-url" value=${url} inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://…/basic.ics" onInput=${(e) => setUrl(e.target.value)} />
    <//>
    <button type="button" class="history-toggle" aria-expanded=${help} aria-controls="calsub-help" onClick=${() => setHelp(!help)}>
      <${Icon} name="chevron" size=${16} /> Wo finde ich den Link?
    </button>
    ${help &&
    html`<ul id="calsub-help" class="calsub-help muted small">
      <li><strong>Google Kalender:</strong> am Computer beim Kalender auf die drei Punkte, „Einstellungen und Freigabe“, ganz unten „Geheime Adresse im iCal-Format“ kopieren.</li>
      <li><strong>Outlook:</strong> „Einstellungen“, „Kalender“, „Freigegebene Kalender“, „Kalender veröffentlichen“, den ICS-Link kopieren.</li>
      <li><strong>iCloud:</strong> beim Kalender „Kalender teilen“, „Öffentlicher Kalender“ einschalten, Link kopieren.</li>
      <li>Feiertage, Messen, Ferien: viele Seiten bieten einen Link zum Abonnieren („iCal“, „ICS“ oder „webcal“).</li>
    </ul>`}
    ${error && html`<p class="form-error" role="alert">${error}</p>`}
    <div class="settings-actions">
      <button type="submit" class="btn btn-primary" disabled=${busy}>${busy ? 'Holt Termine …' : 'Abonnieren'}</button>
      <button type="button" class="btn" disabled=${busy} onClick=${onDone}>Abbrechen</button>
    </div>
  </form>`
}

export function CalendarSubTile() {
  const me = norm(myEmail())
  const [adding, setAdding] = useState(false)
  const list = (state.db.kalender_abos || []).filter((a) => norm(a.owner) === me).sort((a, b) => a.name.localeCompare(b.name, 'de'))
  return html`<${Tile} title="Abonnierte Kalender" count=${list.length}>
    <p class="muted small">
      Einen Kalender per Link abonnieren, ohne dich bei diesem Konto anzumelden: einen Google-Kalender eines anderen Kontos, einen veröffentlichten Kalender aus Outlook oder iCloud, Feiertage oder Messen. Das CRM holt die Termine etwa alle 15 Minuten und ändert dort nie etwas.
      Sehen können die Termine wie bei deinem eigenen Kalender nur du, dein Teamlead und der Super-Admin, Gäste nie.
    </p>
    ${list.length > 0 && html`<ul class="team-list mailbox-list calsub-list">${list.map((a) => html`<${CalendarSubRow} key=${a.id} sub=${a} />`)}</ul>`}
    ${adding
      ? html`<${CalendarSubForm} onDone=${() => setAdding(false)} />`
      : html`<div class="settings-actions">
          <button type="button" class="btn btn-primary" disabled=${list.length >= 10} onClick=${() => setAdding(true)}><${Icon} name="plus" size=${18} /> Kalender abonnieren</button>
          ${list.some((a) => a.aktiv) && html`<${SyncButton} />`}
        </div>`}
    ${list.length >= 10 && html`<p class="muted small">Du hast schon 10 Kalender abonniert, mehr geht nicht.</p>`}
  <//>`
}
