// Claude-Zugang (E1, Entscheidung vom 09.11.2026): Freigabe-Seite und „Claude verbinden“ in den
// Einstellungen. Jede Person verbindet ihr eigenes Claude über die Edge Function „crm-mcp“.
// Supabase (Authentication, OAuth Server) schickt die Person mit ?authorization_id=… hierher.
// Nach Anmeldung mit zweitem Faktor zeigt ClaudeConsent, wer fragt und was Claude darf.
// „Erlauben“ trägt die Freigabe im CRM ein (claude_freigabe_erteilen() in 25_claude_zugang.sql)
// und stimmt dann bei Supabase zu. Nur Claude (claude.ai, claude.com) und Claude Code auf dem
// eigenen Rechner (localhost) lassen sich verbinden, Gäste gar nicht.
import { html, useState, useEffect } from '../lib/preact.js'
import { Icon } from '../lib/icons.js'
import { fmtRelative } from '../lib/util.js'
import {
  state,
  isDemo,
  isGuest,
  errorText,
  toast,
  confirmDialog,
  leaveClaudeConsent,
  returnToClaude,
  claudeDetails,
  claudeApprove,
  claudeDeny,
  claudeGrants,
  claudeAccesses,
  claudeRevoke,
  claudeRevokeGrant,
} from '../store.js'
import { Tile } from './common.js'
import { AuthShell } from './auth.js'

const config = window.CRM_CONFIG || {}
export const MCP_URL = config.supabaseUrl ? config.supabaseUrl.replace(/\/$/, '') + '/functions/v1/crm-mcp' : '[Adresse nach dem Einrichten von Supabase]'

// Wohin Supabase nach der Zustimmung weiterleitet. Erlaubt: Claude und Claude Code auf dem eigenen Rechner.
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1']
export function redirectInfo(uri) {
  let host = ''
  try {
    host = new URL(uri).hostname.toLowerCase()
  } catch {
    return { host: '', allowed: false, label: '[unbekannt]' }
  }
  if (LOCAL_HOSTS.includes(host)) return { host, allowed: true, label: 'Claude Code auf diesem Rechner' }
  if (['claude.ai', 'claude.com'].some((d) => host === d || host.endsWith('.' + d))) return { host, allowed: true, label: host }
  return { host, allowed: false, label: host }
}

const clientOf = (d) => {
  const c = (d && d.client) || {}
  return { id: String(c.client_id || c.id || d.client_id || ''), name: c.client_name || c.name || 'Claude' }
}

function CanList() {
  return html`<div class="claude-rights">
    <p class="claude-rights-head"><${Icon} name="check" size=${16} /> Claude darf, mit deinen Rechten im CRM</p>
    <ul>
      <li>Aufgaben, Notizen, Aktivitäten, Kontakte, Firmen, Deals und Meetings lesen, anlegen und ändern</li>
      <li>Aufgaben und Deals in andere Spalten und Projekte verschieben</li>
      <li>Termine lesen, die du im CRM siehst</li>
      <li>Mails lesen, nur aus deinen eigenen Postfächern</li>
    </ul>
    <p class="claude-rights-head"><${Icon} name="x" size=${16} /> Claude darf nie</p>
    <ul>
      <li>etwas löschen</li>
      <li>Mails senden</li>
      <li>Projekte und Spalten anlegen, umbenennen oder löschen</li>
      <li>Team, Rechte, Postfächer, Produkte oder deine Einstellungen ändern</li>
    </ul>
  </div>`
}

// Die Freigabe-Seite (statt des CRM, solange eine Anfrage von Claude offen ist)
export function ClaudeConsent() {
  const id = state.claudeRequest
  // null: lädt. Sonst { details } | { expired } | { reconnect } | { done }
  const [view, setView] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let stale = false
    ;(async () => {
      let d
      try {
        d = await claudeDetails(id)
      } catch {
        if (!stale) setView({ expired: true })
        return
      }
      if (stale) return
      if (d && d.authorization_id) return setView({ details: d })
      // Schon früher erlaubt: Supabase hat ohne Rückfrage zugestimmt. Weiter nur, wenn jeder
      // Zugang, den Supabase kennt, im CRM noch freigegeben ist. Sonst die alten Zugänge bei
      // Supabase beenden, damit beim nächsten Verbinden wieder diese Seite kommt.
      const [grants, accesses] = await Promise.all([claudeGrants().catch(() => null), claudeAccesses().catch(() => [])])
      const active = new Set((accesses || []).map((a) => a.client_id))
      const stale2 = (grants || []).filter((g) => !active.has(g.clientId))
      if (!stale2.length && !isGuest()) return returnToClaude(d && d.redirect_url)
      for (const g of stale2) await claudeRevokeGrant(g.clientId).catch(() => {})
      setView({ reconnect: true })
    })()
    return () => {
      stale = true
    }
  }, [id])

  const decide = async (allow) => {
    setError(null)
    setBusy(true)
    const d = view.details
    try {
      let url
      if (allow) {
        const client = clientOf(d)
        if (!client.id) throw Object.assign(new Error('Die Anfrage enthält keine Kennung. Bitte in Claude noch einmal verbinden.'), { code: 'meldung' })
        url = await claudeApprove(id, { clientId: client.id, clientName: client.name, redirectHost: redirectInfo(d.redirect_uri).host })
        setView({ ...view, done: true })
        // Demo: keine Weiterleitung, stattdessen in die Einstellungen
        if (!url) {
          toast('Claude ist verbunden (Demo). Den Zugang siehst du unter „Claude verbinden“.')
          location.hash = '#/einstellungen'
        }
      } else {
        url = await claudeDeny(id)
      }
      returnToClaude(url)
    } catch (err) {
      setBusy(false)
      setError(errorText(err))
    }
  }

  if (!view) {
    return html`<${AuthShell}>
      <h1 class="auth-title">Claude verbinden</h1>
      <p class="auth-text" aria-busy="true">Einen Moment, die Anfrage von Claude wird geladen …</p>
    <//>`
  }
  if (view.expired) {
    return html`<${AuthShell}>
      <h1 class="auth-title">Anfrage abgelaufen</h1>
      <p class="auth-text">Die Anfrage von Claude ist abgelaufen oder wurde schon beantwortet. Bitte in Claude noch einmal auf „Verbinden“ tippen.</p>
      <button type="button" class="btn btn-block" onClick=${leaveClaudeConsent}>Weiter ins CRM</button>
    <//>`
  }
  if (view.reconnect) {
    return html`<${AuthShell}>
      <h1 class="auth-title">Bitte neu verbinden</h1>
      <p class="auth-text">
        ${isGuest()
          ? 'Den Claude-Zugang gibt es nur für Mitglieder des Teams, nicht für Gäste.'
          : 'Dieser Zugang war im CRM entzogen. Er ist jetzt auch bei Claude beendet. Bitte in Claude noch einmal auf „Verbinden“ tippen, dann kannst du ihn hier neu freigeben.'}
      </p>
      <button type="button" class="btn btn-block" onClick=${leaveClaudeConsent}>Weiter ins CRM</button>
    <//>`
  }

  const d = view.details
  const client = clientOf(d)
  const target = redirectInfo(d.redirect_uri)
  const guest = isGuest()
  const blocked = guest || !target.allowed
  return html`<${AuthShell}>
    <p class="claude-kicker">Claude verbinden</p>
    <h1 class="auth-title">Zugang für ${client.name} freigeben?</h1>
    ${guest
      ? html`<p class="auth-text">Den Claude-Zugang gibt es nur für Mitglieder des Teams, nicht für Gäste. Bitte lehne die Anfrage ab.</p>`
      : !target.allowed
        ? html`<p class="auth-text">
            Diese Anfrage kommt nicht von Claude, sie leitet nach <strong>${target.label}</strong> weiter. Aus Sicherheitsgründen lässt sich hier nur Claude verbinden. Bitte
            lehne ab.
          </p>`
        : html`<p class="auth-text">„${client.name}“ möchte mit deinem Konto auf das beQ CRM zugreifen.</p>
            <${CanList} />
            <p class="auth-hint claude-hint">
              Alles, was Claude ändert, steht im Verlauf mit „über Claude“. Entziehen kannst du den Zugang jederzeit unter Einstellungen, „Claude verbinden“.
            </p>`}
    <dl class="claude-facts">
      <dt>Konto</dt>
      <dd>${state.sessionEmail}</dd>
      <dt>Zurück zu</dt>
      <dd>${target.label}</dd>
    </dl>
    ${error && html`<p class="auth-error" role="alert">${error}</p>`}
    ${view.done
      ? html`<p class="auth-info" role="status">Verbunden. Du wirst zu Claude zurückgeschickt …</p>`
      : html`${!blocked && html`<button type="button" class="btn btn-primary btn-block" disabled=${busy} onClick=${() => decide(true)}>Erlauben</button>`}
          <button type="button" class=${'btn btn-block' + (blocked ? ' btn-primary' : '')} disabled=${busy} onClick=${() => decide(false)}>Ablehnen</button>`}
  <//>`
}

// ------------------------------------------------------------
// Einstellungen: „Claude verbinden“ (nur Mitglieder und Admins)
// ------------------------------------------------------------
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text)
    toast('Adresse kopiert')
  } catch {
    toast('Kopieren ging nicht. Bitte die Adresse markieren und kopieren.', { error: true })
  }
}

export function ClaudeTile() {
  const [list, setList] = useState(null)
  const [error, setError] = useState(null)
  const load = async () => {
    try {
      setList(await claudeAccesses())
      setError(null)
    } catch (err) {
      setList([])
      setError(/claude|function|schema cache|PGRST202/i.test(String(err && (err.message || err.code))) ? 'Der Claude-Zugang ist in Supabase noch nicht eingerichtet.' : errorText(err))
    }
  }
  useEffect(() => {
    load()
  }, [])
  const revoke = async (a) => {
    const ok = await confirmDialog({
      title: 'Zugang entziehen?',
      text: `${a.client_name || 'Claude'} kommt danach nicht mehr ins CRM. Was Claude schon angelegt hat, bleibt. Neu verbinden geht jederzeit.`,
      confirmLabel: 'Entziehen',
      danger: true,
    })
    if (!ok) return
    try {
      await claudeRevoke(a.client_id)
      toast('Zugang entzogen')
    } catch (err) {
      toast('Im CRM ist der Zugang gesperrt, bei Claude ließ er sich nicht abmelden. Bitte gleich noch einmal versuchen.', { error: true })
    }
    load()
  }
  return html`<${Tile} title="Claude verbinden" count=${list && list.length ? list.length : undefined}>
    <p class="muted small">
      Verbinde dein eigenes Claude mit dem CRM, im Browser, in der Desktop-App oder in Claude Code. Claude arbeitet dann mit deinen Rechten: Aufgaben,
      Notizen, Aktivitäten, Kontakte, Firmen, Deals, Meetings und Termine lesen und schreiben, Mails nur aus deinen eigenen Postfächern lesen. Claude löscht nie und
      sendet keine Mails.
    </p>
    <div class="claude-url">
      <label class="field-label" for="claude-url">Adresse des CRM für Claude</label>
      <div class="claude-url-row">
        <input id="claude-url" readonly value=${MCP_URL} onFocus=${(e) => e.target.select()} />
        <button type="button" class="btn" onClick=${() => copy(MCP_URL)}>Kopieren</button>
      </div>
    </div>
    <ol class="claude-steps">
      <li>
        <strong>Claude im Browser oder in der Desktop-App:</strong> „Customize“ (Anpassen), „Connectors“, beim Connector „beQ CRM“ auf „Connect“ klicken. Fehlt er, legt ihn
        ein Owner eures Claude-Teams einmal an: „Organization settings“, „Connectors“, „Add“, „Custom“, „Web“, Name „beQ CRM“, diese Adresse, bei der Anmeldung „Register
        automatically“.
      </li>
      <li>
        <strong>Claude Code:</strong> Im Terminal <code>claude mcp add --transport http --scope user beq-crm ${MCP_URL}</code>, dann in Claude Code <code>/mcp</code>,
        „beq-crm“ wählen und anmelden.
      </li>
      <li>Claude öffnet das CRM. Dort meldest du dich an (mit zweitem Faktor) und klickst auf „Erlauben“.</li>
    </ol>
    ${error && html`<p class="form-error" role="alert">${error}</p>`}
    ${list && list.length > 0
      ? html`<ul class="claude-list">
          ${list.map(
            (a) => html`<li key=${a.client_id}>
              <span class="claude-list-name">
                <strong>${a.client_name || 'Claude'}</strong>
                <span class="muted small">${a.redirect_host && LOCAL_HOSTS.includes(a.redirect_host) ? 'Claude Code' : a.redirect_host || ''} · freigegeben ${fmtRelative(a.erteilt_at)}</span>
              </span>
              <button type="button" class="btn" onClick=${() => revoke(a)}>Zugang entziehen</button>
            </li>`
          )}
        </ul>`
      : list && !error && html`<p class="muted small">Noch kein Claude verbunden.${isDemo ? ' Zum Ausprobieren: ?demo&authorization_id=test an die Adresse hängen.' : ''}</p>`}
  <//>`
}
