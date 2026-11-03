// Anmeldung, zweiter Faktor (TOTP), neues Passwort, „nicht freigeschaltet“, Passwort ändern
import { html, useState, useEffect, useRef } from '../lib/preact.js'
import { Icon } from '../lib/icons.js'
import { local } from '../lib/util.js'
import {
  state,
  isDemo,
  signIn,
  signOut,
  resetPassword,
  updatePassword,
  afterLogin,
  errorText,
  toast,
  closeDialog,
  mfaEnroll,
  mfaVerify,
  mfaFinishLogin,
  mfaRemoveOthers,
} from '../store.js'
import { Modal, Field, dialogKinds } from './common.js'

// Grüne Signal-Bögen aus einer Ecke, nach außen immer transparenter
function SignalArcs() {
  const arcs = [140, 230, 320, 410, 500, 590, 680]
  return html`<svg class="signal-arcs" viewBox="0 0 700 700" aria-hidden="true" preserveAspectRatio="xMaxYMax meet">
    ${arcs.map((r, i) => html`<circle cx="700" cy="700" r=${r} fill="none" stroke="#37BA98" stroke-width=${i < 2 ? 3 : 2} opacity=${(0.85 - i * 0.12).toFixed(2)} />`)}
    <circle cx="700" cy="700" r="46" fill="#37BA98" opacity="0.9" />
  </svg>`
}

function AuthShell({ children }) {
  return html`<div class="auth-screen">
    <${SignalArcs} />
    <div class="auth-card">
      <div class="auth-brand">
        <img src="img/logo-dunkel.svg" alt="beQ Hub" width="132" height="34" />
        <span class="brand-crm">CRM</span>
      </div>
      ${children}
    </div>
  </div>`
}

export function Login() {
  const [email, setEmail] = useState(local.get('beqcrm-last-email', ''))
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(state.authMessage)
  const [info, setInfo] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      await signIn(email.trim(), password)
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }
  const forgot = async () => {
    setError(null)
    if (!email.trim()) {
      setError('Trag zuerst deine E-Mail-Adresse ein.')
      return
    }
    try {
      await resetPassword(email.trim())
      setInfo('Wenn es ein Konto mit dieser Adresse gibt, kommt gleich eine Mail mit einem Link.')
    } catch (err) {
      setError(errorText(err))
    }
  }

  return html`<${AuthShell}>
    <h1 class="auth-title">Anmelden</h1>
    <form onSubmit=${submit}>
      <${Field} label="E-Mail" htmlFor="login-email">
        <input id="login-email" type="email" autocomplete="username" required value=${email} onInput=${(e) => setEmail(e.target.value)} />
      <//>
      <${Field} label="Passwort" htmlFor="login-password">
        <input id="login-password" type="password" autocomplete="current-password" required value=${password} onInput=${(e) => setPassword(e.target.value)} />
      <//>
      ${error && html`<p class="auth-error" role="alert">${error}</p>`}
      ${info && html`<p class="auth-info" role="status">${info}</p>`}
      <button type="submit" class="btn btn-primary btn-block" disabled=${busy}>${busy ? 'Einen Moment …' : 'Anmelden'}</button>
    </form>
    <button type="button" class="auth-link" onClick=${forgot}>Passwort vergessen?</button>
    <p class="auth-hint">Die Mail kommt nur an, wenn in Supabase ein eigener Mailversand eingerichtet ist. Sonst hilft dir der Admin weiter.</p>
  <//>`
}

// Eingabe für den 6-stelligen Code
function CodeInput({ value, onInput, id = 'mfa-code', autoFocus = true }) {
  const ref = useRef()
  useEffect(() => {
    if (autoFocus && ref.current) ref.current.focus()
  }, [])
  return html`<input
    id=${id}
    ref=${ref}
    class="code-input"
    inputmode="numeric"
    autocomplete="one-time-code"
    pattern="[0-9]{6}"
    placeholder="000000"
    value=${value}
    onInput=${(e) => onInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
  />`
}

// Zweiten Faktor einrichten: Schlüssel kopieren, iPhone-Link, QR-Code zum Aufklappen, ersten Code eingeben
export function MfaSetup({ onDone, onCancel, dark = false }) {
  const [factor, setFactor] = useState(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    mfaEnroll()
      .then(setFactor)
      .catch((err) => setError(errorText(err)))
  }, [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(factor.secret)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }
  const submit = async (e) => {
    e.preventDefault()
    if (code.length !== 6) return
    setBusy(true)
    setError(null)
    try {
      await mfaVerify(factor.factorId, code)
      await onDone(factor.factorId)
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  if (!factor) {
    return html`<div class=${'mfa-setup' + (dark ? ' dark' : '')}>
      ${error ? html`<p class="auth-error" role="alert">${error}</p>` : html`<p>Einen Moment, der Schlüssel wird erzeugt …</p>`}
      ${onCancel && html`<button type="button" class="btn btn-block" onClick=${onCancel}>Abbrechen</button>`}
    </div>`
  }

  // Schlüssel in Vierergruppen, damit er sich leichter abtippen lässt
  const grouped = factor.secret.replace(/(.{4})/g, '$1 ').trim()
  return html`<form class=${'mfa-setup' + (dark ? ' dark' : '')} onSubmit=${submit}>
    <ol class="mfa-steps">
      <li>
        <strong>Schlüssel in eine Authenticator-App übernehmen.</strong>
        Das geht mit dem Passwort-Manager, Google Authenticator, Microsoft Authenticator oder 1Password.
        <div class="mfa-secret">
          <code>${grouped}</code>
          <button type="button" class="btn btn-small" onClick=${copy}>${copied ? 'Kopiert' : 'Kopieren'}</button>
        </div>
        <a class="mfa-iphone" href=${factor.uri}><${Icon} name="lock" size=${16} /> Auf dem iPhone hier tippen</a>
        <details class="mfa-qr">
          <summary>QR-Code anzeigen</summary>
          <img src=${factor.qr} alt="QR-Code für die Authenticator-App" width="180" height="180" />
        </details>
      </li>
      <li>
        <strong>Den 6-stelligen Code aus der App eingeben.</strong>
        <${CodeInput} value=${code} onInput=${setCode} />
      </li>
    </ol>
    ${error && html`<p class="auth-error" role="alert">${error}</p>`}
    <div class="form-actions">
      ${onCancel && html`<button type="button" class="btn" onClick=${onCancel}>Abbrechen</button>`}
      <button type="submit" class="btn btn-primary" disabled=${busy || code.length !== 6}>${busy ? 'Einen Moment …' : 'Bestätigen'}</button>
    </div>
  </form>`
}

export function MfaEnroll() {
  return html`<${AuthShell}>
    <h1 class="auth-title">Zweiten Faktor einrichten</h1>
    <p class="auth-text">Zum Schutz der Daten braucht das beQ CRM bei jeder Anmeldung zusätzlich einen Code vom Handy. Das richtest du einmal ein.</p>
    <${MfaSetup} dark=${true} onDone=${() => mfaFinishLogin()} onCancel=${signOut} />
  <//>`
}

export function MfaVerify() {
  const [code, setCode] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    if (code.length !== 6) return
    setBusy(true)
    setError(null)
    try {
      await mfaVerify(state.mfaFactorId, code)
      await mfaFinishLogin()
    } catch (err) {
      setError(errorText(err))
      setCode('')
      setBusy(false)
    }
  }
  return html`<${AuthShell}>
    <h1 class="auth-title">Code eingeben</h1>
    <p class="auth-text">Gib den aktuellen 6-stelligen Code aus deiner Authenticator-App ein.</p>
    <form onSubmit=${submit}>
      <${Field} label="Code" htmlFor="mfa-code"><${CodeInput} value=${code} onInput=${setCode} /><//>
      ${error && html`<p class="auth-error" role="alert">${error}</p>`}
      <button type="submit" class="btn btn-primary btn-block" disabled=${busy || code.length !== 6}>${busy ? 'Einen Moment …' : 'Anmelden'}</button>
    </form>
    <button type="button" class="auth-link" onClick=${signOut}>Mit einem anderen Konto anmelden</button>
    <p class="auth-hint">Handy verloren? Der Admin setzt den zweiten Faktor in Supabase unter „Authentication“, „Users“ zurück.</p>
  <//>`
}

export function SetPassword() {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const submit = async (e) => {
    e.preventDefault()
    if (pw.length < 10) return setError('Bitte mindestens 10 Zeichen.')
    if (pw !== pw2) return setError('Die beiden Passwörter sind nicht gleich.')
    setBusy(true)
    setError(null)
    try {
      await updatePassword(pw)
      toast('Neues Passwort gespeichert')
      await afterLogin(state.sessionEmail)
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }
  return html`<${AuthShell}>
    <h1 class="auth-title">Neues Passwort festlegen</h1>
    <form onSubmit=${submit}>
      <${Field} label="Neues Passwort" htmlFor="new-pw" hint="Mindestens 10 Zeichen">
        <input id="new-pw" type="password" autocomplete="new-password" required value=${pw} onInput=${(e) => setPw(e.target.value)} />
      <//>
      <${Field} label="Noch einmal" htmlFor="new-pw2">
        <input id="new-pw2" type="password" autocomplete="new-password" required value=${pw2} onInput=${(e) => setPw2(e.target.value)} />
      <//>
      ${error && html`<p class="auth-error" role="alert">${error}</p>`}
      <button type="submit" class="btn btn-primary btn-block" disabled=${busy}>Passwort speichern</button>
    </form>
  <//>`
}

export function NotMember() {
  return html`<${AuthShell}>
    <h1 class="auth-title">Noch nicht freigeschaltet</h1>
    <p class="auth-text">Dein Konto ist noch nicht für das beQ CRM freigeschaltet. Melde dich bei ${state.adminName || 'beim Admin'}.</p>
    <p class="auth-hint">Angemeldet als ${state.sessionEmail}</p>
    <button type="button" class="btn btn-block" onClick=${signOut}>Abmelden</button>
  <//>`
}

export function AuthError() {
  return html`<${AuthShell}>
    <h1 class="auth-title">Das hat nicht geklappt</h1>
    <p class="auth-text">${state.authMessage || 'Die Daten ließen sich nicht laden.'}</p>
    <button type="button" class="btn btn-primary btn-block" onClick=${() => location.reload()}>Noch einmal versuchen</button>
  <//>`
}

export function Splash() {
  return html`<div class="splash" aria-busy="true"><img src="img/logo-dunkel.svg" alt="beQ Hub" width="150" height="38" /></div>`
}

// ------------------------------------------------------------
// Dialoge aus den Einstellungen
// ------------------------------------------------------------
function ChangePassword() {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    if (pw.length < 10) return setError('Bitte mindestens 10 Zeichen.')
    if (pw !== pw2) return setError('Die beiden Passwörter sind nicht gleich.')
    setBusy(true)
    try {
      await updatePassword(pw)
      closeDialog()
      toast('Neues Passwort gespeichert')
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }
  return html`<${Modal} title="Passwort ändern" onClose=${closeDialog}>
    ${isDemo
      ? html`<p>Im Demo-Modus gibt es keine Konten und keine Passwörter.</p>`
      : html`<form onSubmit=${submit}>
          <${Field} label="Neues Passwort" htmlFor="cp-1" hint="Mindestens 10 Zeichen">
            <input id="cp-1" type="password" autocomplete="new-password" value=${pw} onInput=${(e) => setPw(e.target.value)} />
          <//>
          <${Field} label="Noch einmal" htmlFor="cp-2">
            <input id="cp-2" type="password" autocomplete="new-password" value=${pw2} onInput=${(e) => setPw2(e.target.value)} />
          <//>
          ${error && html`<p class="form-error" role="alert">${error}</p>`}
          <div class="form-actions">
            <button type="button" class="btn" onClick=${closeDialog}>Abbrechen</button>
            <button type="submit" class="btn btn-primary" disabled=${busy || !pw}>Speichern</button>
          </div>
        </form>`}
  <//>`
}
dialogKinds['change-password'] = ChangePassword

// Zweiten Faktor neu einrichten: Der alte gilt, bis der neue bestätigt ist, danach wird er entfernt
function MfaReset() {
  return html`<${Modal} title="Zweiten Faktor neu einrichten" onClose=${closeDialog} wide=${true}>
    ${isDemo
      ? html`<p>Im Demo-Modus gibt es keinen zweiten Faktor.</p>`
      : html`<p class="muted">Zum Beispiel für ein neues Handy oder einen anderen Passwort-Manager. Dein bisheriger Faktor gilt, bis du den neuen bestätigt hast.</p>
          <${MfaSetup}
            onCancel=${closeDialog}
            onDone=${async (factorId) => {
              await mfaRemoveOthers(factorId)
              closeDialog()
              toast('Neuer zweiter Faktor eingerichtet, der alte gilt nicht mehr')
            }}
          />`}
  <//>`
}
dialogKinds['mfa-reset'] = MfaReset
