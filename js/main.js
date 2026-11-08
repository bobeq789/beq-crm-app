// Einstieg der App: Rahmen (Kopfleiste, Navigation), Seitenwahl, Fenster über der Seite, Service Worker
import { html, render, useEffect } from './lib/preact.js'
import { Icon } from './lib/icons.js'
import { useStore, boot, isDemo, isGuest, state } from './store.js'
import { useRoute } from './router.js'
import { Dialogs, Toasts } from './ui/common.js'
import { Overview, overviewCount } from './ui/overview.js'
import { Board } from './ui/board.js'
import { CardPanel } from './ui/card.js'
import { CalendarPage, EventPanel } from './ui/calendar.js'
import { MeetingsList, MeetingDetail, MeetingNew } from './ui/meetings.js'
import { ContactsList, ContactDetail, ContactForm } from './ui/contacts.js'
import { OrgsList, OrgDetail, OrgForm } from './ui/orgs.js'
import { SettingsPage } from './ui/prefs.js'
import { SharedPage } from './ui/shared.js'
import { SalesPage } from './ui/sales.js'
import { PostfachPage } from './ui/postfach.js'
import { TopSearch } from './ui/search.js'
import { Modal, dialogKinds } from './ui/common.js'
import { openDialog, closeDialog } from './store.js'
import { Login, SetPassword, NotMember, AuthError, Splash, MfaEnroll, MfaVerify } from './ui/auth.js'

const NAV_TEAM = [
  { key: '', label: 'Übersicht', icon: 'home' },
  { key: 'board', label: 'Board', icon: 'board' },
  { key: 'sales', label: 'Sales', icon: 'sales' },
  { key: 'kalender', label: 'Kalender', icon: 'calendar' },
  { key: 'postfach', label: 'Postfach', icon: 'mail' },
  { key: 'meetings', label: 'Meetings', icon: 'meetings' },
  { key: 'kontakte', label: 'Kontakte', icon: 'contacts' },
  { key: 'firmen', label: 'Firmen', icon: 'orgs' },
]
const NAV_GUEST = [{ key: 'geteilt', label: 'Geteilt', icon: 'share' }]
// Am Handy unten nur vier Bereiche und „Mehr“, der Rest steckt hinter „Mehr“
const MOBILE_MAIN = ['', 'board', 'postfach', 'kalender']

function NavMore() {
  const more = NAV_TEAM.filter((n) => !MOBILE_MAIN.includes(n.key))
  return html`<${Modal} title="Mehr" onClose=${closeDialog}>
    <ul class="nav-more">
      ${more.map(
        (n) => html`<li key=${n.key}>
          <a href=${'#/' + n.key} onClick=${closeDialog}><${Icon} name=${n.icon} size=${22} /> ${n.label}</a>
        </li>`
      )}
      <li><a href="#/einstellungen" onClick=${closeDialog}><${Icon} name="gear" size=${22} /> Einstellungen</a></li>
    </ul>
  <//>`
}
dialogKinds['nav-more'] = NavMore

function Page({ route }) {
  const [section, id, sub] = route.parts
  // Gäste sehen nur „Geteilt“ und die Einstellungen
  if (isGuest()) return section === 'einstellungen' ? html`<${SettingsPage} />` : html`<${SharedPage} />`
  switch (section) {
    case undefined:
      return html`<${Overview} />`
    case 'board':
      return html`<${Board} projectId=${id} />`
    case 'sales':
      return html`<${SalesPage} />`
    case 'kalender':
      return html`<${CalendarPage} />`
    case 'postfach':
      return html`<${PostfachPage} />`
    case 'meetings':
      if (id === 'neu') return html`<${MeetingNew} />`
      return id ? html`<${MeetingDetail} id=${id} key=${id} />` : html`<${MeetingsList} />`
    case 'kontakte':
      if (id === 'neu') return html`<${ContactForm} key="neu" />`
      if (id && sub === 'bearbeiten') return html`<${ContactForm} id=${id} key=${'edit' + id} />`
      return id ? html`<${ContactDetail} id=${id} />` : html`<${ContactsList} />`
    case 'firmen':
      if (id === 'neu') return html`<${OrgForm} key="neu" />`
      if (id && sub === 'bearbeiten') return html`<${OrgForm} id=${id} key=${'edit' + id} />`
      return id ? html`<${OrgDetail} id=${id} />` : html`<${OrgsList} />`
    case 'einstellungen':
      return html`<${SettingsPage} />`
    default:
      return html`<${Overview} />`
  }
}

// Zahlen in der Navigation (Nachtrag Follow-up, B1): an „Übersicht“ das Fällige plus „Antwort
// da“, am „Postfach“ die neuen Mails seit dem letzten Blick. Kreis in Grün mit Navy-Schrift.
function NavCount({ n, what }) {
  if (!n) return null
  return html`<span class="nav-count" title=${n + ' ' + what}><span aria-hidden="true">${n > 99 ? '99+' : n}</span><span class="sr-only">, ${n} ${what}</span></span>`
}

// Dieselbe Zahl wie an „Übersicht“ am App-Symbol (wo der Browser es kann), in der Hauptansicht
function useAppBadge(n) {
  useEffect(() => {
    try {
      if (n && navigator.setAppBadge) navigator.setAppBadge(n).catch(() => {})
      else if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {})
    } catch {
      // Ohne App-Symbol (zum Beispiel im normalen Browserfenster) nichts tun
    }
  }, [n])
}

function Shell({ route }) {
  const guest = isGuest()
  const nav = guest ? NAV_GUEST : NAV_TEAM
  const counts = guest ? {} : { '': overviewCount(), postfach: state.followUp.newMail.length }
  const countText = { '': 'fällig', postfach: 'neu' }
  useAppBadge(counts[''] || 0)
  const section = route.parts[0] || (guest ? 'geteilt' : '')
  const cardId = route.params.get('karte')
  const eventId = guest ? null : route.params.get('termin')
  const home = guest ? '#/geteilt' : '#/'
  return html`<div class="shell">
    <header class="topbar">
      <a class="brand" href=${home} aria-label="beQ CRM, zur Startseite">
        <img src="img/logo-dunkel.svg" alt="beQ CRM" width="104" height="26" />
      </a>
      ${!guest && html`<div class="topsearch"><${TopSearch} /></div>`}
      <nav class="topnav" aria-label="Bereiche">
        ${nav.map(
          (n) => html`<a
            href=${'#/' + n.key}
            class=${[section === n.key ? 'active' : '', !guest && !MOBILE_MAIN.includes(n.key) ? 'nav-extra' : ''].filter(Boolean).join(' ')}
            aria-current=${section === n.key ? 'page' : undefined}
          >
            ${n.label}<${NavCount} n=${counts[n.key]} what=${countText[n.key]} />
          </a>`
        )}
        ${!guest &&
        html`<button type="button" class=${'topnav-more' + (!MOBILE_MAIN.includes(section) && section !== 'einstellungen' ? ' active' : '')} onClick=${() => openDialog({ kind: 'nav-more' })}>
          Mehr
        </button>`}
      </nav>
      <div class="topbar-right">
        ${isDemo && html`<span class="demo-badge" title="Alle Daten sind erfunden und liegen nur in diesem Browser">${guest ? 'Demo · Gast' : 'Demo'}</span>`}
        <a
          class=${'header-icon' + (section === 'einstellungen' ? ' active' : '')}
          href="#/einstellungen"
          aria-label="Einstellungen"
          title="Einstellungen"
          aria-current=${section === 'einstellungen' ? 'page' : undefined}
        >
          <${Icon} name="gear" size=${22} />
        </a>
      </div>
    </header>
    <main class="content" id="inhalt">
      <${Page} route=${route} />
    </main>
    ${nav.length > 1 &&
    html`<nav class="bottomnav" aria-label="Bereiche">
      ${(guest ? nav : nav.filter((n) => MOBILE_MAIN.includes(n.key))).map(
        (n) => html`<a href=${'#/' + n.key} class=${section === n.key ? 'active' : ''} aria-current=${section === n.key ? 'page' : undefined}>
          <span class="bottomnav-icon"><${Icon} name=${n.icon} size=${22} /><${NavCount} n=${counts[n.key]} what=${countText[n.key]} /></span>
          <span>${n.label}</span>
        </a>`
      )}
      ${!guest &&
      html`<button type="button" class=${'bottomnav-more' + (!MOBILE_MAIN.includes(section) && section !== 'einstellungen' ? ' active' : '')} onClick=${() => openDialog({ kind: 'nav-more' })}>
        <${Icon} name="more" size=${22} />
        <span>Mehr</span>
      </button>`}
    </nav>`}
    ${cardId && html`<${CardPanel} id=${cardId} key=${cardId} />`}
    ${eventId && html`<${EventPanel} id=${eventId} key=${eventId} />`}
    <${Dialogs} />
    <${Toasts} />
  </div>`
}

function App() {
  const st = useStore()
  const route = useRoute()
  switch (st.auth) {
    case 'loading':
      return html`<${Splash} />`
    case 'login':
      return html`<${Login} /><${Toasts} />`
    case 'set-password':
      return html`<${SetPassword} /><${Toasts} />`
    case 'not-member':
      return html`<${NotMember} />`
    case 'mfa-enroll':
      return html`<${MfaEnroll} />`
    case 'mfa-verify':
      return html`<${MfaVerify} />`
    case 'error':
      return html`<${AuthError} />`
    default:
      return html`<${Shell} route=${route} />`
  }
}

// Seitenwechsel: nach oben scrollen (nicht, wenn nur ein Fenster auf- oder zugeht)
let lastPath = location.hash.split('?')[0]
window.addEventListener('hashchange', () => {
  const path = location.hash.split('?')[0]
  if (path !== lastPath) window.scrollTo(0, 0)
  lastPath = path
})

render(html`<${App} />`, document.getElementById('app'))
boot()

// Service Worker: hält die App-Dateien vor, fragt aber immer zuerst das Netz
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {})
}
