// Anmeldung, zweiter Faktor (TOTP), neues Passwort, „nicht freigeschaltet“, Passwort ändern
import { html, useState, useEffect, useRef } from '../lib/preact.js'
import { Icon } from '../lib/icons.js'
import {
  state,
  isDemo,
  signOut,
  signInWithGoogle,
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
import { setUiLang } from '../store.js'
import { t, getLang } from '../i18n.js'

// Grüne Signal-Bögen aus einer Ecke, nach außen immer transparenter
function SignalArcs() {
  const arcs = [140, 230, 320, 410, 500, 590, 680]
  return html`<svg class="signal-arcs" viewBox="0 0 700 700" aria-hidden="true" preserveAspectRatio="xMaxYMax meet">
    ${arcs.map((r, i) => html`<circle cx="700" cy="700" r=${r} fill="none" stroke="#37BA98" stroke-width=${i < 2 ? 3 : 2} opacity=${(0.85 - i * 0.12).toFixed(2)} />`)}
    <circle cx="700" cy="700" r="46" fill="#37BA98" opacity="0.9" />
  </svg>`
}

export function AuthShell({ children }) {
  return html`<div class="auth-screen">
    <${SignalArcs} />
    <div class="auth-card">
      <div class="auth-brand">
        <img src="img/logo-dunkel.svg" alt="beQ CRM" width="134" height="34" />
      </div>
      ${children}
    </div>
    <${LangSwitch} />
  </div>`
}

// Sprache vor der Anmeldung wählen (je Gerät, i18n.js). Nach der Anmeldung gilt die Wahl aus den Einstellungen.
function LangSwitch() {
  const lang = getLang()
  return html`<div class="auth-lang" role="group" aria-label=${t('Sprache')}>
    <button type="button" class=${lang === 'de' ? 'active' : ''} aria-pressed=${lang === 'de'} onClick=${() => setUiLang('de')}>Deutsch</button>
    <button type="button" class=${lang === 'en' ? 'active' : ''} aria-pressed=${lang === 'en'} onClick=${() => setUiLang('en')}>English</button>
  </div>`
}

// Anmelden nur mit Google und einer Adresse von beq.com (Entscheidung vom 26.11.2026,
// 46_nur_beq.sql). Passwort, „Passwort vergessen“ und Konto anlegen gibt es nicht mehr.
export function Login() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(state.authMessage)

  const google = async () => {
    setError(null)
    setBusy(true)
    try {
      await signInWithGoogle()
      // Der Browser wechselt jetzt zu Google
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return html`<${AuthShell}>
    <h1 class="auth-title">${t('Anmelden')}</h1>
    ${state.claudeRequest && html`<p class="auth-info claude-login-hint">${t('Claude möchte sich mit dem CRM verbinden. Melde dich zuerst an, danach entscheidest du.')}</p>`}
    ${error && html`<p class="auth-error" role="alert">${error}</p>`}
    <button type="button" class="btn btn-primary btn-block" disabled=${busy} onClick=${google}>${busy ? t('Einen Moment …') : t('Mit Google anmelden')}</button>
    <p class="auth-hint auth-hint-top">${t('Mit deinem beQ-Konto bei Google (Adresse auf beq.com). Ein Passwort für das CRM gibt es nicht. Beim ersten Mal richtest du danach einmal den Code aus der Authenticator-App ein.')}</p>
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
      ${error ? html`<p class="auth-error" role="alert">${error}</p>` : html`<p>${t('Einen Moment, der Schlüssel wird erzeugt …')}</p>`}
      ${onCancel && html`<button type="button" class="btn btn-block" onClick=${onCancel}>${t('Abbrechen')}</button>`}
    </div>`
  }

  // Schlüssel in Vierergruppen, damit er sich leichter abtippen lässt
  const grouped = factor.secret.replace(/(.{4})/g, '$1 ').trim()
  return html`<form class=${'mfa-setup' + (dark ? ' dark' : '')} onSubmit=${submit}>
    <ol class="mfa-steps">
      <li>
        <strong>${t('Schlüssel in eine Authenticator-App übernehmen.')}</strong>
        ${t('Das geht mit dem Passwort-Manager, Google Authenticator, Microsoft Authenticator oder 1Password.')}
        <div class="mfa-secret">
          <code>${grouped}</code>
          <button type="button" class="btn btn-small" onClick=${copy}>${copied ? t('Kopiert') : t('Kopieren')}</button>
        </div>
        <a class="mfa-iphone" href=${factor.uri}><${Icon} name="lock" size=${16} /> ${t('Auf dem iPhone hier tippen')}</a>
        <details class="mfa-qr">
          <summary>${t('QR-Code anzeigen')}</summary>
          <img src=${factor.qr} alt=${t('QR-Code für die Authenticator-App')} width="180" height="180" />
        </details>
      </li>
      <li>
        <strong>${t('Den 6-stelligen Code aus der App eingeben.')}</strong>
        <${CodeInput} value=${code} onInput=${setCode} />
      </li>
    </ol>
    ${error && html`<p class="auth-error" role="alert">${error}</p>`}
    <div class="form-actions">
      ${onCancel && html`<button type="button" class="btn" onClick=${onCancel}>${t('Abbrechen')}</button>`}
      <button type="submit" class="btn btn-primary" disabled=${busy || code.length !== 6}>${busy ? t('Einen Moment …') : t('Bestätigen')}</button>
    </div>
  </form>`
}

export function MfaEnroll() {
  return html`<${AuthShell}>
    <h1 class="auth-title">${t('Zweiten Faktor einrichten')}</h1>
    <p class="auth-text">${t('Zum Schutz der Daten braucht das beQ CRM bei jeder Anmeldung zusätzlich einen Code vom Handy. Das richtest du einmal ein.')}</p>
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
    <h1 class="auth-title">${t('Code eingeben')}</h1>
    <p class="auth-text">${t('Gib den aktuellen 6-stelligen Code aus deiner Authenticator-App ein.')}</p>
    <form onSubmit=${submit}>
      <${Field} label=${t('Code')} htmlFor="mfa-code"><${CodeInput} value=${code} onInput=${setCode} /><//>
      ${error && html`<p class="auth-error" role="alert">${error}</p>`}
      <button type="submit" class="btn btn-primary btn-block" disabled=${busy || code.length !== 6}>${busy ? t('Einen Moment …') : t('Anmelden')}</button>
    </form>
    <button type="button" class="auth-link" onClick=${signOut}>${t('Mit einem anderen Konto anmelden')}</button>
    <p class="auth-hint">${t('Handy verloren? Der Admin setzt den zweiten Faktor in Supabase unter „Authentication“, „Users“ zurück.')}</p>
  <//>`
}

export function SetPassword() {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const submit = async (e) => {
    e.preventDefault()
    if (pw.length < 10) return setError(t('Bitte mindestens 10 Zeichen.'))
    if (pw !== pw2) return setError(t('Die beiden Passwörter sind nicht gleich.'))
    setBusy(true)
    setError(null)
    try {
      await updatePassword(pw)
      toast(t('Neues Passwort gespeichert'))
      await afterLogin(state.sessionEmail)
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }
  return html`<${AuthShell}>
    <h1 class="auth-title">${t('Neues Passwort festlegen')}</h1>
    <form onSubmit=${submit}>
      <${Field} label=${t('Neues Passwort')} htmlFor="new-pw" hint=${t('Mindestens 10 Zeichen')}>
        <input id="new-pw" type="password" autocomplete="new-password" required value=${pw} onInput=${(e) => setPw(e.target.value)} />
      <//>
      <${Field} label=${t('Noch einmal')} htmlFor="new-pw2">
        <input id="new-pw2" type="password" autocomplete="new-password" required value=${pw2} onInput=${(e) => setPw2(e.target.value)} />
      <//>
      ${error && html`<p class="auth-error" role="alert">${error}</p>`}
      <button type="submit" class="btn btn-primary btn-block" disabled=${busy}>${t('Passwort speichern')}</button>
    </form>
  <//>`
}

export function NotMember() {
  return html`<${AuthShell}>
    <h1 class="auth-title">${t('Noch nicht freigeschaltet')}</h1>
    <p class="auth-text">${state.adminName ? t('Dein Konto ist noch nicht für das beQ CRM freigeschaltet. Melde dich bei {name}.', { name: state.adminName }) : t('Dein Konto ist noch nicht für das beQ CRM freigeschaltet. Melde dich beim Admin.')}</p>
    <p class="auth-hint">${t('Angemeldet als {email}', { email: state.sessionEmail })}</p>
    <button type="button" class="btn btn-block" onClick=${signOut}>${t('Abmelden')}</button>
  <//>`
}

export function AuthError() {
  return html`<${AuthShell}>
    <h1 class="auth-title">${t('Das hat nicht geklappt')}</h1>
    <p class="auth-text">${state.authMessage || t('Die Daten ließen sich nicht laden.')}</p>
    <button type="button" class="btn btn-primary btn-block" onClick=${() => location.reload()}>${t('Noch einmal versuchen')}</button>
  <//>`
}

// Anmeldung ist gespeichert, aber gerade kein Netz (Wunsch vom 24.11.2026: am Handy nicht wie
// abgemeldet wirken). Sobald wieder Netz da ist, lädt die App von selbst neu.
export function AuthOffline() {
  useEffect(() => {
    const retry = () => location.reload()
    window.addEventListener('online', retry)
    const timer = setInterval(() => navigator.onLine && retry(), 20000)
    return () => {
      window.removeEventListener('online', retry)
      clearInterval(timer)
    }
  }, [])
  return html`<${AuthShell}>
    <h1 class="auth-title">${t('Keine Verbindung')}</h1>
    <p class="auth-text">${t('Du bist weiter angemeldet. Sobald dein Gerät wieder Netz hat, geht es von selbst weiter.')}</p>
    <button type="button" class="btn btn-primary btn-block" onClick=${() => location.reload()}>${t('Noch einmal versuchen')}</button>
  <//>`
}

export function Splash() {
  return html`<div class="splash" aria-busy="true"><img src="img/logo-dunkel.svg" alt="beQ CRM" width="152" height="38" /></div>`
}


// Zweiten Faktor neu einrichten: Der alte gilt, bis der neue bestätigt ist, danach wird er entfernt
function MfaReset() {
  return html`<${Modal} title=${t('Zweiten Faktor neu einrichten')} onClose=${closeDialog} wide=${true}>
    ${isDemo
      ? html`<p>${t('Im Demo-Modus gibt es keinen zweiten Faktor.')}</p>`
      : html`<p class="muted">${t('Zum Beispiel für ein neues Handy oder einen anderen Passwort-Manager. Dein bisheriger Faktor gilt, bis du den neuen bestätigt hast.')}</p>
          <${MfaSetup}
            onCancel=${closeDialog}
            onDone=${async (factorId) => {
              await mfaRemoveOthers(factorId)
              closeDialog()
              toast(t('Neuer zweiter Faktor eingerichtet, der alte gilt nicht mehr'))
            }}
          />`}
  <//>`
}
dialogKinds['mfa-reset'] = MfaReset
