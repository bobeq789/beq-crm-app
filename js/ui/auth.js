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
  signInWithGoogle,
  signUp,
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

// Konto mit Passwort selbst anlegen ist erst an, wenn Supabase Mails verschicken kann (config.js)
const passwordSignup = !!(window.CRM_CONFIG && window.CRM_CONFIG.passwordSignup)

export function Login() {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState(local.get('beqcrm-last-email', ''))
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(state.authMessage)
  const [info, setInfo] = useState(null)

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
  if (mode === 'signup') return html`<${SignUp} initialEmail=${email} onBack=${() => setMode('login')} />`

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
      setError(t('Trag zuerst deine E-Mail-Adresse ein.'))
      return
    }
    try {
      await resetPassword(email.trim())
      setInfo(t('Wenn es ein Konto mit dieser Adresse gibt, kommt gleich eine Mail mit einem Link.'))
    } catch (err) {
      setError(errorText(err))
    }
  }

  return html`<${AuthShell}>
    <h1 class="auth-title">${t('Anmelden')}</h1>
    ${state.claudeRequest && html`<p class="auth-info claude-login-hint">${t('Claude möchte sich mit dem CRM verbinden. Melde dich zuerst an, danach entscheidest du.')}</p>`}
    <button type="button" class="btn btn-primary btn-block" disabled=${busy} onClick=${google}>${t('Mit Google anmelden')}</button>
    <p class="auth-hint auth-hint-top">${t('Mit deinem beQ-Konto bei Google. Beim ersten Mal richtest du danach einmal den Code aus der Authenticator-App ein.')}</p>
    <p class="auth-or">${t('oder mit E-Mail und Passwort')}</p>
    <form onSubmit=${submit}>
      <${Field} label=${t('E-Mail')} htmlFor="login-email">
        <input id="login-email" type="email" autocomplete="username" required value=${email} onInput=${(e) => setEmail(e.target.value)} />
      <//>
      <${Field} label=${t('Passwort')} htmlFor="login-password">
        <input id="login-password" type="password" autocomplete="current-password" required value=${password} onInput=${(e) => setPassword(e.target.value)} />
      <//>
      ${error && html`<p class="auth-error" role="alert">${error}</p>`}
      ${info && html`<p class="auth-info" role="status">${info}</p>`}
      <button type="submit" class="btn btn-block" disabled=${busy}>${busy ? t('Einen Moment …') : t('Anmelden')}</button>
    </form>
    <button type="button" class="auth-link" onClick=${forgot}>${t('Passwort vergessen?')}</button>
    ${passwordSignup && html`<button type="button" class="auth-link auth-link-tight" onClick=${() => setMode('signup')}>${t('Neu hier? Konto mit Passwort anlegen')}</button>`}
    <p class="auth-hint">${t('Mails zum Passwort kommen nur an, wenn in Supabase ein eigener Mailversand eingerichtet ist. Sonst hilft dir der Admin weiter.')}</p>
  <//>`
}

// Konto mit Passwort anlegen (nur beq.com). Supabase schickt eine Mail, erst der Link darin
// bestätigt, dass die Adresse dir gehört. Danach bist du sofort Mitglied.
function SignUp({ initialEmail, onBack }) {
  const [email, setEmail] = useState(/@beq\.com$/i.test(initialEmail || '') ? initialEmail : '')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [sentTo, setSentTo] = useState(null)
  const submit = async (e) => {
    e.preventDefault()
    const address = email.trim().toLowerCase()
    if (!/^[^@\s]+@beq\.com$/.test(address)) return setError(t('Bitte deine Adresse von beq.com eintragen.'))
    if (pw.length < 10) return setError(t('Bitte mindestens 10 Zeichen.'))
    if (pw !== pw2) return setError(t('Die beiden Passwörter sind nicht gleich.'))
    setBusy(true)
    setError(null)
    try {
      await signUp(address, pw)
      local.set('beqcrm-last-email', address)
      setSentTo(address)
    } catch (err) {
      setError(errorText(err))
    }
    setBusy(false)
  }
  if (sentTo) {
    return html`<${AuthShell}>
      <h1 class="auth-title">${t('Fast geschafft')}</h1>
      <p class="auth-text">${t('Wir haben dir eine Mail an {email} geschickt. Tipp auf den Link darin. Danach bist du angemeldet und richtest einmal den Code aus der Authenticator-App ein.', { email: sentTo })}</p>
      <p class="auth-hint">${t('Keine Mail da? Schau im Spam-Ordner nach oder melde dich beim Admin.')}</p>
      <button type="button" class="auth-link" onClick=${onBack}>${t('Zurück zur Anmeldung')}</button>
    <//>`
  }
  return html`<${AuthShell}>
    <h1 class="auth-title">${t('Konto anlegen')}</h1>
    <form onSubmit=${submit}>
      <${Field} label=${t('E-Mail (beq.com)')} htmlFor="signup-email">
        <input id="signup-email" type="email" autocomplete="username" required placeholder=${t('vorname.nachname@beq.com')} value=${email} onInput=${(e) => setEmail(e.target.value)} />
      <//>
      <${Field} label=${t('Passwort')} htmlFor="signup-pw" hint=${t('Mindestens 10 Zeichen')}>
        <input id="signup-pw" type="password" autocomplete="new-password" required value=${pw} onInput=${(e) => setPw(e.target.value)} />
      <//>
      <${Field} label=${t('Noch einmal')} htmlFor="signup-pw2">
        <input id="signup-pw2" type="password" autocomplete="new-password" required value=${pw2} onInput=${(e) => setPw2(e.target.value)} />
      <//>
      ${error && html`<p class="auth-error" role="alert">${error}</p>`}
      <button type="submit" class="btn btn-primary btn-block" disabled=${busy}>${busy ? t('Einen Moment …') : t('Konto anlegen')}</button>
    </form>
    <button type="button" class="auth-link" onClick=${onBack}>${t('Zurück zur Anmeldung')}</button>
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
    if (pw.length < 10) return setError(t('Bitte mindestens 10 Zeichen.'))
    if (pw !== pw2) return setError(t('Die beiden Passwörter sind nicht gleich.'))
    setBusy(true)
    try {
      await updatePassword(pw)
      closeDialog()
      toast(t('Neues Passwort gespeichert'))
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }
  return html`<${Modal} title=${t('Passwort ändern')} onClose=${closeDialog}>
    ${isDemo
      ? html`<p>${t('Im Demo-Modus gibt es keine Konten und keine Passwörter.')}</p>`
      : html`<form onSubmit=${submit}>
          <${Field} label=${t('Neues Passwort')} htmlFor="cp-1" hint=${t('Mindestens 10 Zeichen')}>
            <input id="cp-1" type="password" autocomplete="new-password" value=${pw} onInput=${(e) => setPw(e.target.value)} />
          <//>
          <${Field} label=${t('Noch einmal')} htmlFor="cp-2">
            <input id="cp-2" type="password" autocomplete="new-password" value=${pw2} onInput=${(e) => setPw2(e.target.value)} />
          <//>
          ${error && html`<p class="form-error" role="alert">${error}</p>`}
          <div class="form-actions">
            <button type="button" class="btn" onClick=${closeDialog}>${t('Abbrechen')}</button>
            <button type="submit" class="btn btn-primary" disabled=${busy || !pw}>${t('Speichern')}</button>
          </div>
        </form>`}
  <//>`
}
dialogKinds['change-password'] = ChangePassword

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
