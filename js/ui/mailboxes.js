// Einstellungen: Postfächer und Kalender (10_postfaecher.sql, Edge Function „google-verbinden“).
// Jede Person verbindet ihre beQ-Postfächer selbst über Google, auch mehrere.
// Google schickt danach zurück nach #/einstellungen?postfach=ok|fehler&…, diese Seite meldet das Ergebnis.
import { html, useEffect } from '../lib/preact.js'
import { Icon } from '../lib/icons.js'
import { fmtRelative, norm } from '../lib/util.js'
import { useRoute } from '../router.js'
import { state, isAdmin, myEmail, memberName, update, toast, confirmDialog, connectMailbox, disconnectMailbox, mailboxDataCounts } from '../store.js'
import { Tile } from './common.js'

// Gründe, die „google-verbinden“ bei einem Fehler mitschickt
const FAILURES = {
  abgelehnt: () => 'Du hast die Anmeldung bei Google abgebrochen. Es wurde nichts verbunden.',
  abgelaufen: () => 'Die Anfrage war zu alt. Bitte tipp noch einmal auf „Postfach verbinden“.',
  google: () => 'Google hat die Anmeldung nicht bestätigt. Bitte gleich noch einmal versuchen.',
  'kein-zugang': () => 'Google hat keinen dauerhaften Zugang erteilt. Bitte noch einmal verbinden.',
  adresse: () => 'Google hat keine bestätigte E-Mail-Adresse geschickt. Bitte mit einem beQ-Konto anmelden.',
  'keine-rechte': (a) => `Für ${a || 'dieses Postfach'} wurden weder Mails noch Kalender freigegeben. Bitte noch einmal verbinden und alle Häkchen setzen.`,
  speichern: () => 'Der Zugang ließ sich nicht speichern. Bitte gleich noch einmal versuchen.',
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
  const canManage = mine || isAdmin()
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
  </li>`
}

export function MailboxTile() {
  useConnectResult()
  const me = norm(myEmail())
  const list = (state.db.mailboxes || [])
    .filter((b) => b.status !== 'getrennt')
    .sort((a, b) => Number(b.owner === me) - Number(a.owner === me) || a.address.localeCompare(b.address, 'de'))
  return html`<${Tile} title="Postfächer und Kalender" count=${list.length}>
    <p class="muted small">
      Verbinde deine beQ-Postfächer, gern auch mehrere. Das CRM liest dann Mails und Termine mit. Senden, Einladen und Löschen geht nur, wenn du es im CRM selbst auslöst, und nur in deinen eigenen Postfächern. Gelöschte Mails landen im Papierkorb von Gmail.
      Was aus einem verbundenen Postfach kommt, sehen alle im Team, Gäste nicht. Verbinde deshalb nur Postfächer, für die du zustimmen darfst.
    </p>
    ${list.length > 0 && html`<ul class="team-list mailbox-list">${list.map((b) => html`<${MailboxRow} key=${b.id} box=${b} />`)}</ul>`}
    <div class="settings-actions">
      <button type="button" class="btn btn-primary" onClick=${connectMailbox}><${Icon} name="plus" size=${18} /> Postfach verbinden</button>
    </div>
    <p class="muted small mailbox-hint">Google fragt jedes Mal, welches Konto. Für ein weiteres Postfach meldest du dich dort mit diesem Postfach an.</p>
  <//>`
}
