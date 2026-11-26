// Bereich „Sales“: Auswertung der Deals je Zeitraum, Mitarbeiter und Board.
// Welche Deals hier ankommen, entscheidet die Datenbank (08_sales.sql): jeder seine
// eigenen, Teamleads die ihres Sales-Teams, Admins alle. Die Seite rechnet nur.
import { html, useState } from '../lib/preact.js'
import { local, todayStr, fmtEuro, fmtDate, norm, addDays } from '../lib/util.js'
import { state, myEmail, memberName, activeProjects, getCard, getStage, getOrg, getPerson, salesPeople } from '../store.js'
import { Icon } from '../lib/icons.js'
import { openCard } from '../router.js'
import { PageHead, Tile, Empty, Field, useIsMobile } from './common.js'
import { t, getLang } from '../i18n.js'

const MONTHS = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sept.', 'Okt.', 'Nov.', 'Dez.']
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const PERIODS = [
  { value: 'monat', label: 'Dieser Monat' },
  { value: 'vormonat', label: 'Letzter Monat' },
  { value: 'quartal', label: 'Dieses Quartal' },
  { value: 'vorquartal', label: 'Letztes Quartal' },
  { value: 'jahr', label: 'Dieses Jahr' },
  { value: 'vorjahr', label: 'Letztes Jahr' },
  { value: '12m', label: 'Letzte 12 Monate' },
  { value: 'eigen', label: 'Eigener Zeitraum' },
]

const ymd = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const lastDay = (y, m) => new Date(y, m + 1, 0).getDate()

// Zeitraum als [von, bis] im Format JJJJ-MM-TT, beide eingeschlossen
export function periodRange(kind, today = todayStr(), custom = {}) {
  const [y, mo] = today.split('-').map(Number)
  const m = mo - 1
  const q = Math.floor(m / 3) * 3
  switch (kind) {
    case 'monat':
      return [ymd(y, m, 1), ymd(y, m, lastDay(y, m))]
    case 'vormonat': {
      const d = new Date(y, m - 1, 1)
      return [ymd(d.getFullYear(), d.getMonth(), 1), ymd(d.getFullYear(), d.getMonth(), lastDay(d.getFullYear(), d.getMonth()))]
    }
    case 'quartal':
      return [ymd(y, q, 1), ymd(y, q + 2, lastDay(y, q + 2))]
    case 'vorquartal': {
      const d = new Date(y, q - 3, 1)
      return [ymd(d.getFullYear(), d.getMonth(), 1), ymd(d.getFullYear(), d.getMonth() + 2, lastDay(d.getFullYear(), d.getMonth() + 2))]
    }
    case 'jahr':
      return [ymd(y, 0, 1), ymd(y, 11, 31)]
    case 'vorjahr':
      return [ymd(y - 1, 0, 1), ymd(y - 1, 11, 31)]
    case '12m': {
      const d = new Date(y, m - 11, 1)
      return [ymd(d.getFullYear(), d.getMonth(), 1), ymd(y, m, lastDay(y, m))]
    }
    default:
      return [custom.from || addDays(today, -30), custom.to || today]
  }
}

// Monate zwischen zwei Daten als „JJJJ-MM“
function monthsBetween(from, to) {
  const out = []
  let [y, m] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m++
    if (m > 12) {
      m = 1
      y++
    }
    if (out.length > 36) break
  }
  return out
}
const monthLabel = (key) => {
  const [y, m] = key.split('-').map(Number)
  return `${(getLang() === 'en' ? MONTHS_EN : MONTHS)[m - 1]} ${y}`
}

// Wahrscheinlichkeit eines offenen Deals: eigene Angabe, sonst die der Spalte, sonst keine
function probabilityOf(deal) {
  if (deal.probability != null) return deal.probability
  const card = getCard(deal.card_id)
  const stage = card && getStage(card.stage_id)
  return stage && stage.probability != null ? stage.probability : null
}

// Alle Kennzahlen aus den sichtbaren Deals
export function computeSales({ deals, items, from, to, owner, projectId }) {
  const inScope = deals.filter((d) => {
    if (owner && norm(d.owner) !== norm(owner)) return false
    if (projectId) {
      const card = getCard(d.card_id)
      if (!card || card.project_id !== projectId) return false
    }
    return true
  })
  const closedIn = (d) => d.closed_at && d.closed_at >= from && d.closed_at <= to
  const won = inScope.filter((d) => d.status === 'gewonnen' && closedIn(d))
  const lost = inScope.filter((d) => d.status === 'verloren' && closedIn(d))
  // Offene Deals an archivierten Aufgaben zählen nicht mehr als offen (Entscheidung vom 16.11.2026).
  // Umsatz zählt nur „gewonnen“, auch wenn die Aufgabe archiviert ist.
  const open = inScope.filter((d) => d.status === 'offen' && !(getCard(d.card_id) || {}).archived)
  const sum = (list) => list.reduce((s, d) => s + Number(d.value_cents || 0), 0)
  const weighted = open.reduce((s, d) => s + (Number(d.value_cents || 0) * (probabilityOf(d) || 0)) / 100, 0)
  const wonIds = new Set(won.map((d) => d.id))
  const wonItems = items.filter((i) => wonIds.has(i.deal_id))
  const places = wonItems.reduce((s, i) => s + Number(i.quantity) * (Number(i.places || 0) + Number(i.bonus_places || 0)), 0)

  // je Mitarbeiter
  const people = new Map()
  const person = (email) => {
    const key = norm(email)
    if (!people.has(key)) people.set(key, { email: key, won: 0, wonCount: 0, lostCount: 0, open: 0, weighted: 0 })
    return people.get(key)
  }
  won.forEach((d) => {
    const p = person(d.owner)
    p.won += Number(d.value_cents || 0)
    p.wonCount++
  })
  lost.forEach((d) => person(d.owner).lostCount++)
  open.forEach((d) => {
    const p = person(d.owner)
    p.open += Number(d.value_cents || 0)
    p.weighted += (Number(d.value_cents || 0) * (probabilityOf(d) || 0)) / 100
  })

  // je Monat (gewonnen)
  const months = monthsBetween(from, to).map((key) => {
    const list = won.filter((d) => d.closed_at.slice(0, 7) === key)
    return { key, value: sum(list), count: list.length }
  })

  // Produkte (gewonnen)
  const products = new Map()
  wonItems.forEach((i) => {
    const key = i.product_id || i.name
    const p = products.get(key) || { name: i.name, quantity: 0, places: 0, value: 0 }
    p.quantity += Number(i.quantity)
    p.places += Number(i.quantity) * (Number(i.places || 0) + Number(i.bonus_places || 0))
    p.value += Math.round((Number(i.quantity) * Number(i.unit_price_cents) * (100 - Number(i.discount_percent || 0))) / 100)
    products.set(key, p)
  })

  // Prognose: offene Deals nach erwartetem Abschlussmonat
  const thisMonth = todayStr().slice(0, 7)
  const forecast = new Map()
  open.forEach((d) => {
    const key = !d.expected_close ? 'ohne' : d.expected_close.slice(0, 7) < thisMonth ? 'vorbei' : d.expected_close.slice(0, 7)
    const f = forecast.get(key) || { key, value: 0, weighted: 0, count: 0 }
    f.value += Number(d.value_cents || 0)
    f.weighted += (Number(d.value_cents || 0) * (probabilityOf(d) || 0)) / 100
    f.count++
    forecast.set(key, f)
  })

  // Verlustgründe
  const reasons = new Map()
  lost.forEach((d) => {
    const r = (d.lost_reason || '').trim() || t('[ohne Grund]')
    reasons.set(r, (reasons.get(r) || 0) + 1)
  })

  const decided = won.length + lost.length
  return {
    won,
    lost,
    open,
    wonSum: sum(won),
    lostSum: sum(lost),
    openSum: sum(open),
    weighted: Math.round(weighted),
    rate: decided ? Math.round((won.length / decided) * 100) : null,
    avg: won.length ? Math.round(sum(won) / won.length) : null,
    places,
    people: [...people.values()].sort((a, b) => b.won - a.won || b.open - a.open),
    months,
    products: [...products.values()].sort((a, b) => b.value - a.value),
    forecast: [...forecast.values()].sort((a, b) => {
      const order = (k) => (k === 'vorbei' ? '0' : k === 'ohne' ? '9999' : k)
      return order(a.key).localeCompare(order(b.key))
    }),
    reasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]),
  }
}

function Stat({ label, value, sub, main }) {
  return html`<div class=${'stat' + (main ? ' stat-main' : '')}>
    <span class="stat-label">${label}</span>
    <strong class="stat-value">${value}</strong>
    ${sub && html`<span class="stat-sub muted small">${sub}</span>`}
  </div>`
}

// Waagerechter Balken in einer Tabellenzeile (eine Reihe, Wert steht als Zahl daneben)
function Bar({ value, max, label }) {
  const pct = max > 0 ? Math.max(value > 0 ? 2 : 0, Math.round((value / max) * 100)) : 0
  return html`<span class="bar-track" title=${label}><span class="bar-fill" style=${`width:${pct}%`}></span></span>`
}

// Kunde einer Aufgabe für die Liste: Firma, sonst Kontakt
function customerOf(card) {
  if (!card) return ''
  const org = getOrg(card.org_id)
  const person = getPerson(card.person_id)
  return [org && org.name, person && person.name].filter(Boolean).join(', ')
}

// Produkte eines Deals in einer Zeile: „2 × Joint-Venture-Paket 1 (10 % Rabatt)“
export function productSummary(dealItems) {
  return dealItems
    .slice()
    .sort((a, b) => a.sort - b.sort)
    .map((i) => {
      const qty = String(Number(i.quantity)).replace('.', ',')
      const disc = Number(i.discount_percent || 0)
      return `${qty} × ${i.name}${disc ? ' ' + t('({p} % Rabatt)', { p: String(disc).replace('.', ',') }) : ''}`
    })
    .join(', ')
}

function placesOf(dealItems) {
  return dealItems.reduce((s, i) => s + Number(i.quantity) * (Number(i.places || 0) + Number(i.bonus_places || 0)), 0)
}

// Umsatzliste: gewonnene Deals im Zeitraum, je Mitarbeiter mit Zwischensumme
function RevenueList({ won, items }) {
  // Am Handy drei Spalten, die Produkte stehen dann unter der Aufgabe
  const mobile = useIsMobile()
  const span = mobile ? 2 : 3
  if (!won.length) return html`<${Empty}>${t('Im Zeitraum wurde nichts gewonnen.')}<//>`
  const groups = new Map()
  won.forEach((d) => {
    const key = norm(d.owner)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(d)
  })
  const sum = (list) => list.reduce((s, d) => s + Number(d.value_cents || 0), 0)
  const sorted = [...groups.entries()].sort((a, b) => sum(b[1]) - sum(a[1]))
  return html`<table class="sales-table revenue-table">
    <thead>
      <tr><th scope="col">${t('Abschluss')}</th><th scope="col">${t('Deal und Kunde')}</th>${!mobile && html`<th scope="col">${t('Produkte')}</th>`}<th scope="col" class="num">${t('Wert')}</th></tr>
    </thead>
    ${sorted.map(([email, list]) => html`<tbody key=${email}>
      <tr class="group-row">
        <th scope="rowgroup" colspan=${span}>${memberName(email)} <span class="muted small">${list.length === 1 ? t('1 Deal') : t('{n} Deals', { n: list.length })}</span></th>
        <td class="num"><strong>${fmtEuro(sum(list))}</strong></td>
      </tr>
      ${list
        .slice()
        .sort((a, b) => b.closed_at.localeCompare(a.closed_at))
        .map((d) => {
          const card = getCard(d.card_id)
          const dItems = items.filter((i) => i.deal_id === d.id)
          const places = placesOf(dItems)
          return html`<tr key=${d.id}>
            <td class="nowrap">${fmtDate(d.closed_at)}</td>
            <td>
              <button type="button" class="link-btn" onClick=${() => openCard(d.card_id)}>${card ? card.title : t('[Deal gelöscht]')}</button>
              ${customerOf(card) && html`<span class="muted small block">${customerOf(card)}</span>`}
              ${mobile && dItems.length > 0 && html`<span class="small block">${productSummary(dItems)}</span>`}
            </td>
            ${!mobile &&
            html`<td>${dItems.length ? productSummary(dItems) : html`<span class="muted">${t('[ohne Produkte]')}</span>`}${places > 0 && html`<span class="muted small block">${t('{n} Netzwerkplätze', { n: places })}</span>`}</td>`}
            <td class="num">${fmtEuro(d.value_cents)}</td>
          </tr>`
        })}
    </tbody>`)}
    <tfoot>
      <tr class="group-row"><th scope="row" colspan=${span}>${t('Summe')}</th><td class="num"><strong>${fmtEuro(sum(won))}</strong></td></tr>
    </tfoot>
  </table>`
}

// CSV für Excel: Semikolon, Dezimalkomma, UTF-8 mit BOM, damit Umlaute stimmen
export function revenueCsv(won, items) {
  const esc = (v) => {
    const s = String(v ?? '')
    return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const euro = (cents) => (Number(cents || 0) / 100).toFixed(2).replace('.', ',')
  const rows = [[t('Mitarbeiter'), t('Abschluss'), t('Deal'), t('Firma'), t('Kontakt'), t('Produkte'), t('Netzwerkplätze'), t('Wert netto EUR')]]
  won
    .slice()
    .sort((a, b) => memberName(a.owner).localeCompare(memberName(b.owner), 'de') || a.closed_at.localeCompare(b.closed_at))
    .forEach((d) => {
      const card = getCard(d.card_id)
      const dItems = items.filter((i) => i.deal_id === d.id)
      const org = card && getOrg(card.org_id)
      const person = card && getPerson(card.person_id)
      rows.push([memberName(d.owner), d.closed_at, card ? card.title : '', org ? org.name : '', person ? person.name : '', productSummary(dItems), placesOf(dItems), euro(d.value_cents)])
    })
  return '\ufeff' + rows.map((r) => r.map(esc).join(';')).join('\r\n') + '\r\n'
}

function downloadCsv(won, items, from, to) {
  const blob = new Blob([revenueCsv(won, items)], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `beQ-CRM-${t('Umsatzliste')}-${from}-${t('bis')}-${to}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export function SalesPage() {
  const [period, setPeriod] = useState(local.get('beqcrm-sales-period', 'quartal'))
  const [custom, setCustom] = useState({ from: '', to: '' })
  const [owner, setOwner] = useState('')
  const [projectId, setProjectId] = useState('')
  const people = salesPeople()
  const me = state.db.team_members.find((m) => norm(m.email) === norm(myEmail()))
  const [from, to] = periodRange(period, todayStr(), custom)
  const deals = state.db.deals || []
  const items = state.db.deal_items || []
  const r = computeSales({ deals, items, from, to, owner, projectId })
  const changePeriod = (v) => {
    setPeriod(v)
    local.set('beqcrm-sales-period', v)
  }

  const scope =
    me && me.role === 'admin'
      ? t('Du siehst als Admin die Zahlen aller.')
      : me && me.team_lead && me.sales_team
        ? t('Du siehst als Teamlead die Zahlen von „{team}“.', { team: me.sales_team })
        : t('Du siehst deine eigenen Zahlen.')
  const maxMonth = Math.max(0, ...r.months.map((m) => m.value))
  const maxPerson = Math.max(0, ...r.people.map((p) => p.won))

  return html`<div class="page">
    <${PageHead} kicker="Sales" title="Sales" />
    <p class="muted">${scope} ${t('Alle Werte in Euro, netto ohne MwSt.')}</p>

    <div class="sales-filters">
      <${Field} label=${t('Zeitraum')} htmlFor="sales-period">
        <select id="sales-period" value=${period} onChange=${(e) => changePeriod(e.target.value)}>
          ${PERIODS.map((p) => html`<option value=${p.value}>${t(p.label)}</option>`)}
        </select>
      <//>
      ${period === 'eigen' &&
      html`<${Field} label=${t('Von')} htmlFor="sales-from"><input id="sales-from" type="date" value=${custom.from || from} onChange=${(e) => setCustom({ ...custom, from: e.target.value })} /><//>
        <${Field} label=${t('Bis')} htmlFor="sales-to"><input id="sales-to" type="date" value=${custom.to || to} onChange=${(e) => setCustom({ ...custom, to: e.target.value })} /><//>`}
      ${people.length > 1 &&
      html`<${Field} label=${t('Mitarbeiter')} htmlFor="sales-owner">
        <select id="sales-owner" value=${owner} onChange=${(e) => setOwner(e.target.value)}>
          <option value="">${t('Alle')}</option>
          ${people.map((p) => html`<option value=${p.email.toLowerCase()}>${p.name}</option>`)}
        </select>
      <//>`}
      <${Field} label="Board" htmlFor="sales-board">
        <select id="sales-board" value=${projectId} onChange=${(e) => setProjectId(e.target.value)}>
          <option value="">${t('Alle Boards')}</option>
          ${activeProjects().map((p) => html`<option value=${p.id}>${p.name}</option>`)}
        </select>
      <//>
    </div>
    <p class="muted small sales-range">${t('{from} bis {to}', { from: fmtDate(from), to: fmtDate(to) })}</p>

    ${deals.length === 0 &&
    html`<${Empty}>${t('Noch keine Deals mit Wert. Den Wert trägst du im Deal unter „Wert und Status“ ein.')}<//>`}

    <div class="stats">
      <${Stat} main=${true} label=${t('Gewonnen')} value=${fmtEuro(r.wonSum)} sub=${r.won.length === 1 ? t('1 Deal') : t('{n} Deals', { n: r.won.length })} />
      <${Stat} label=${t('Abschlussquote')} value=${r.rate == null ? t('[keine Abschlüsse]') : `${r.rate} %`} sub=${t('{won} gewonnen, {lost} verloren', { won: r.won.length, lost: r.lost.length })} />
      <${Stat} label=${t('Ø Dealgröße')} value=${r.avg == null ? t('[keine]') : fmtEuro(r.avg)} sub=${t('gewonnene Deals')} />
      <${Stat} label=${t('Netzwerkplätze')} value=${String(r.places)} sub=${t('verkauft, inklusive gratis')} />
      <${Stat} label=${t('Offene Deals')} value=${fmtEuro(r.openSum)} sub=${t('{n} offen, unabhängig vom Zeitraum', { n: r.open.length })} />
      <${Stat} label=${t('Gewichtet')} value=${fmtEuro(r.weighted)} sub=${t('Wert mal Wahrscheinlichkeit')} />
    </div>

    <div class="sales-grid">
      <${Tile} title=${t('Gewonnen je Monat')}>
        <table class="sales-table">
          <thead><tr><th scope="col">${t('Monat')}</th><th scope="col" class="num">${t('Gewonnen')}</th><th scope="col" class="bar-col"><span class="sr-only">${t('Balken')}</span></th><th scope="col" class="num">Deals</th></tr></thead>
          <tbody>
            ${r.months.map(
              (m) => html`<tr key=${m.key}>
                <td>${monthLabel(m.key)}</td>
                <td class="num">${fmtEuro(m.value)}</td>
                <td class="bar-col"><${Bar} value=${m.value} max=${maxMonth} label=${t('{month}: {value}, {n} Deals', { month: monthLabel(m.key), value: fmtEuro(m.value), n: m.count })} /></td>
                <td class="num">${m.count}</td>
              </tr>`
            )}
          </tbody>
        </table>
      <//>

      <${Tile} title=${t('Je Mitarbeiter')}>
        ${r.people.length
          ? html`<table class="sales-table">
              <thead><tr><th scope="col">Name</th><th scope="col" class="num">${t('Gewonnen')}</th><th scope="col" class="bar-col"><span class="sr-only">${t('Balken')}</span></th><th scope="col" class="num">${t('Quote')}</th><th scope="col" class="num">${t('Offen')}</th></tr></thead>
              <tbody>
                ${r.people.map((p) => {
                  const decided = p.wonCount + p.lostCount
                  return html`<tr key=${p.email}>
                    <td>${memberName(p.email)}</td>
                    <td class="num">${fmtEuro(p.won)}</td>
                    <td class="bar-col"><${Bar} value=${p.won} max=${maxPerson} label=${t('{name}: {value} gewonnen', { name: memberName(p.email), value: fmtEuro(p.won) })} /></td>
                    <td class="num">${decided ? Math.round((p.wonCount / decided) * 100) + ' %' : t('[offen]')}</td>
                    <td class="num">${fmtEuro(p.open)}</td>
                  </tr>`
                })}
              </tbody>
            </table>`
          : html`<${Empty}>${t('Im Zeitraum nichts entschieden und nichts offen.')}<//>`}
      <//>

      <${Tile} title=${t('Produkte (gewonnen)')}>
        ${r.products.length
          ? html`<table class="sales-table">
              <thead><tr><th scope="col">${t('Produkt')}</th><th scope="col" class="num">${t('Menge')}</th><th scope="col" class="num">${t('Plätze')}</th><th scope="col" class="num">${t('Umsatz')}</th></tr></thead>
              <tbody>
                ${r.products.map(
                  (p) => html`<tr key=${p.name}>
                    <td>${p.name}</td>
                    <td class="num">${String(p.quantity).replace('.', ',')}</td>
                    <td class="num">${p.places}</td>
                    <td class="num">${fmtEuro(p.value)}</td>
                  </tr>`
                )}
              </tbody>
            </table>`
          : html`<${Empty}>${t('Im Zeitraum keine gewonnenen Deals mit Produkten.')}<//>`}
      <//>

      <${Tile} title=${t('Prognose (offene Deals)')}>
        ${r.forecast.length
          ? html`<table class="sales-table">
              <thead><tr><th scope="col">${t('Erwarteter Abschluss')}</th><th scope="col" class="num">Deals</th><th scope="col" class="num">${t('Wert')}</th><th scope="col" class="num">${t('Gewichtet')}</th></tr></thead>
              <tbody>
                ${r.forecast.map(
                  (f) => html`<tr key=${f.key}>
                    <td class=${f.key === 'vorbei' ? 'overdue-text' : ''}>${f.key === 'vorbei' ? t('Termin vorbei') : f.key === 'ohne' ? t('[ohne Termin]') : monthLabel(f.key)}</td>
                    <td class="num">${f.count}</td>
                    <td class="num">${fmtEuro(f.value)}</td>
                    <td class="num">${fmtEuro(Math.round(f.weighted))}</td>
                  </tr>`
                )}
              </tbody>
            </table>`
          : html`<${Empty}>${t('Keine offenen Deals.')}<//>`}
      <//>
    </div>

    <${Tile}
      title=${t('Umsatzliste je Mitarbeiter')}
      count=${r.won.length}
      actions=${r.won.length > 0 &&
      html`<button type="button" class="btn btn-small" onClick=${() => downloadCsv(r.won, items, from, to)}>
        <${Icon} name="arrowOut" size=${16} /> ${t('Als CSV')}
      </button>`}
    >
      <${RevenueList} won=${r.won} items=${items} />
    <//>

    <${Tile} title=${t('Verloren im Zeitraum')} count=${r.lost.length}>
      ${r.lost.length
        ? html`<table class="sales-table deals-table">
            <thead><tr><th scope="col">Deal</th><th scope="col">${t('Besitzer')}</th><th scope="col">${t('Verloren am')}</th><th scope="col">${t('Grund')}</th><th scope="col" class="num">${t('Wert')}</th></tr></thead>
            <tbody>
              ${[...r.lost]
                .sort((a, b) => b.closed_at.localeCompare(a.closed_at))
                .map((d) => {
                  const card = getCard(d.card_id)
                  return html`<tr key=${d.id}>
                    <td><button type="button" class="link-btn" onClick=${() => openCard(d.card_id)}>${card ? card.title : t('[Deal gelöscht]')}</button></td>
                    <td>${memberName(d.owner)}</td>
                    <td>${fmtDate(d.closed_at)}</td>
                    <td>${d.lost_reason || t('[ohne Grund]')}</td>
                    <td class="num muted">${fmtEuro(d.value_cents)}</td>
                  </tr>`
                })}
            </tbody>
          </table>`
        : html`<${Empty}>${t('Im Zeitraum wurde nichts verloren.')}<//>`}
      ${r.reasons.length > 0 &&
      html`<p class="muted small">${t('Verlustgründe: {list}', { list: r.reasons.map(([reason, n]) => `${reason} (${n})`).join(', ') })}</p>`}
    <//>
  </div>`
}
