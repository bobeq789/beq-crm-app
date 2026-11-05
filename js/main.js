// Einstieg der App: Rahmen (Kopfleiste, Navigation), Seitenwahl, Fenster über der Seite, Service Worker
import { html, render } from './lib/preact.js'
import { Icon } from './lib/icons.js'
import { useStore, boot, isDemo, isGuest } from './store.js'
import { useRoute } from './router.js'
import { Dialogs, Toasts } from './ui/common.js'
import { Overview } from './ui/overview.js'
import { Board } from './ui/board.js'
import { CardPanel } from './ui/card.js'
import { CalendarPage, EventPanel } from './ui/calendar.js'
import { MeetingsList, MeetingDetail, MeetingNew } from './ui/meetings.js'
import { ContactsList, ContactDetail, ContactForm } from './ui/contacts.js'
import { OrgsList, OrgDetail, OrgForm } from './ui/orgs.js'
import { SettingsPage } from './ui/prefs.js'
import { SharedPage } from './ui/shared.js'
import { SalesPage } from './ui/sales.js'
import { Login, SetPassword, NotMember, AuthError, Splash, MfaEnroll, MfaVerify } from './ui/auth.js'

const NAV_TEAM = [
  { key: '', label: 'Übersicht', icon: 'home' },
  { key: 'board', label: 'Board', icon: 'board' },
  { key: 'sales', label: 'Sales', icon: 'sales' },
  { key: 'kalender', label: 'Kalender', icon: 'calendar' },
  { key: 'meetings', label: 'Meetings', icon: 'meetings' },
  { key: 'kontakte', label: 'Kontakte', icon: 'contacts' },
  { key: 'firmen', label: 'Firmen', icon: 'orgs' },
]
const NAV_GUEST = [{ key: 'geteilt', label: 'Geteilt', icon: 'share' }]

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

function Shell({ route }) {
  const guest = isGuest()
  const nav = guest ? NAV_GUEST : NAV_TEAM
  const section = route.parts[0] || (guest ? 'geteilt' : '')
  const cardId = route.params.get('karte')
  const eventId = guest ? null : route.params.get('termin')
  const home = guest ? '#/geteilt' : '#/'
  return html`<div class="shell">
    <header class="topbar">
      <a class="brand" href=${home} aria-label="beQ CRM, zur Startseite">
        <img src="img/logo-dunkel.svg" alt="beQ Hub" width="102" height="26" />
        <span class="brand-crm">CRM</span>
      </a>
      <nav class="topnav" aria-label="Bereiche">
        ${nav.map(
          (n) => html`<a href=${'#/' + n.key} class=${section === n.key ? 'active' : ''} aria-current=${section === n.key ? 'page' : undefined}>
            ${n.label}
          </a>`
        )}
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
      ${nav.map(
        (n) => html`<a href=${'#/' + n.key} class=${section === n.key ? 'active' : ''} aria-current=${section === n.key ? 'page' : undefined}>
          <${Icon} name=${n.icon} size=${22} />
          <span>${n.label}</span>
        </a>`
      )}
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
