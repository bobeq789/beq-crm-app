// Bereich „Deal“ in der Aufgabe: Wert (netto, Euro), Status, Abschluss, Wahrscheinlichkeit
// und Produktzeilen aus dem Katalog. Nur für das Team, und nur wer die Zahlen sehen darf
// (eigene Deals, als Teamlead die des Teams, als Admin alle). Regeln in 08_sales.sql.
import { html, useState, useEffect } from '../lib/preact.js'
import { Icon } from '../lib/icons.js'
import { fmtEuro, firstName, norm } from '../lib/util.js'
import { itemTotal, closedDealMove } from '../data/rules.js'
import {
  isGuest,
  myEmail,
  memberName,
  dealOf,
  dealItems,
  activeProducts,
  salesPeople,
  cardDealOwner,
  syncDealValue,
  insert,
  update,
  remove,
  confirmDialog,
  toast,
  getStage,
  state,
  openActivitiesOfCard,
} from '../store.js'
import { Field } from './common.js'
import { t, stageLabel } from '../i18n.js'

const STATUS = [
  { value: 'offen', label: 'Offen' },
  { value: 'gewonnen', label: 'Gewonnen' },
  { value: 'verloren', label: 'Verloren' },
]

// „9800“, „9.800“, „9.800,50“ oder „9800.5“ in Cent
export function parseEuro(text) {
  let t = String(text || '').replace(/[€\s]/g, '')
  if (!t) return 0
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '')
  const v = Number(t)
  return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : null
}
function euroInput(cents) {
  const v = Number(cents || 0) / 100
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ',')
}

export function CardDeal({ card }) {
  if (isGuest()) return null
  const deal = dealOf(card.id)
  return deal ? html`<${DealEditor} card=${card} deal=${deal} />` : html`<${NoDeal} card=${card} />`
}

function NoDeal({ card }) {
  // Gibt es einen Deal, den ich nicht sehen darf? Dann nur den Besitzer nennen.
  const [owner, setOwner] = useState(undefined)
  useEffect(() => {
    let stale = false
    cardDealOwner(card.id).then((o) => !stale && setOwner(o || null))
    return () => {
      stale = true
    }
  }, [card.id])
  const people = salesPeople()
  const create = async () => {
    const assignee = card.assignee && people.find((p) => norm(p.email) === norm(card.assignee))
    const stage = getStage(card.stage_id)
    const saved = await insert('deals', {
      card_id: card.id,
      owner: (assignee ? assignee.email : myEmail()).toLowerCase(),
      status: 'offen',
      probability: stage && stage.probability != null ? stage.probability : null,
    })
    if (saved) toast(t('Wert und Status angelegt'))
  }
  return html`<section class="deal">
    <h3 class="section-title">${t('Wert und Status')}</h3>
    ${owner === undefined
      ? html`<p class="muted small">${t('Wird geladen …')}</p>`
      : owner
        ? html`<p class="muted small">
            ${t('Wert und Status dieses Deals führt {name}. Die Zahlen sehen nur {first} selbst, der Teamlead und die Admins.', { name: memberName(owner), first: firstName(memberName(owner)) })}
          </p>`
        : html`<p class="muted small">${t('Noch kein Wert. Mit Wert und Status zählt dieser Deal in „Sales“ mit Produkten und Abschluss.')}</p>
            <button type="button" class="btn" onClick=${create}><${Icon} name="plus" size=${16} /> ${t('Wert eintragen')}</button>`}
  </section>`
}

function DealEditor({ card, deal }) {
  const items = dealItems(deal.id)
  const people = salesPeople()
  const products = activeProducts()
  const [value, setValue] = useState(euroInput(deal.value_cents))
  const [reason, setReason] = useState(deal.lost_reason || '')
  useEffect(() => setValue(euroInput(deal.value_cents)), [deal.value_cents])
  useEffect(() => setReason(deal.lost_reason || ''), [deal.id, deal.lost_reason])
  const set = (patch) => update('deals', deal.id, patch)
  // Gewonnen oder verloren schiebt die Aufgabe nach „Erledigt“ (28_deal_abschluss.sql), das sagt die App dazu
  const setStatus = async (s) => {
    const move = closedDealMove(state.db, deal, { ...deal, status: s.value })
    const saved = await set({ status: s.value })
    if (saved && move) {
      const stage = getStage(move.stageId)
      // Offene Aktivitäten halten die Aufgabe aus dem Archiv (24_archiv.sql)
      const later = openActivitiesOfCard(card.id).length
        ? t('Ins Archiv kommt er, sobald seine offenen Aktivitäten erledigt sind und er 30 Tage nicht geändert wurde.')
        : t('Nach 30 Tagen ohne Änderung kommt er ins Archiv.')
      const what = { offen: 'Deal offen.', gewonnen: 'Deal gewonnen.', verloren: 'Deal verloren.' }[s.value]
      toast(`${t(what)} ${t('Er steht jetzt in „{stage}“.', { stage: stage ? stageLabel(stage.name) : t('Erledigt') })} ${later}`)
    }
  }

  const places = items.reduce((s, i) => s + Number(i.quantity) * Number(i.places || 0), 0)
  const bonus = items.reduce((s, i) => s + Number(i.quantity) * Number(i.bonus_places || 0), 0)

  const saveValue = () => {
    const cents = parseEuro(value)
    if (cents === null) {
      toast(t('Bitte einen Betrag in Euro eingeben, zum Beispiel 9.800.'), { error: true })
      setValue(euroInput(deal.value_cents))
    } else if (cents !== Number(deal.value_cents)) set({ value_cents: cents })
  }
  const addItem = async (productId) => {
    const p = products.find((x) => x.id === productId)
    if (!p) return
    const sort = Math.max(0, ...items.map((i) => i.sort)) + 1
    const saved = await insert('deal_items', {
      deal_id: deal.id,
      product_id: p.id,
      name: p.name,
      quantity: 1,
      unit_price_cents: p.price_cents,
      discount_percent: 0,
      places: p.places,
      bonus_places: p.bonus_places,
      sort,
    })
    if (saved) syncDealValue(deal.id)
  }
  const changeItem = async (item, patch) => {
    if (await update('deal_items', item.id, patch)) syncDealValue(deal.id)
  }
  const removeItem = async (item) => {
    if (await remove('deal_items', item.id)) syncDealValue(deal.id)
  }
  const removeDeal = async () => {
    const ok = await confirmDialog({
      title: t('Wert und Status entfernen?'),
      text: t('Wert, Produkte und Status dieses Deals sind danach weg. Der Deal selbst bleibt.'),
      confirmLabel: t('Entfernen'),
      danger: true,
    })
    if (ok && (await remove('deals', deal.id))) toast(t('Wert und Status entfernt'))
  }

  return html`<section class="deal">
    <div class="deal-head">
      <h3 class="section-title">${t('Wert und Status')}</h3>
      <div class="deal-value">
        <strong>${fmtEuro(deal.value_cents)}</strong>
        <span class="muted small">${t('netto')}</span>
      </div>
    </div>

    <${Field} label="Status">
      <div class="chips" role="group" aria-label=${t('Status des Deals')}>
        ${STATUS.map(
          (s) => html`<button
            type="button"
            class=${'chip-btn' + (deal.status === s.value ? ' active' : '')}
            aria-pressed=${deal.status === s.value}
            onClick=${() => deal.status !== s.value && setStatus(s)}
          >
            ${t(s.label)}
          </button>`
        )}
      </div>
    <//>
    ${deal.status === 'verloren' &&
    html`<${Field} label="Verlustgrund" htmlFor="deal-reason">
      <input
        id="deal-reason"
        value=${reason}
        placeholder=${t('zum Beispiel Budget, anderer Anbieter, kein Bedarf')}
        onInput=${(e) => setReason(e.target.value)}
        onBlur=${() => reason.trim() !== (deal.lost_reason || '') && set({ lost_reason: reason.trim() || null })}
      />
    <//>`}

    <div class="field-grid">
      ${people.length > 1 &&
      html`<${Field} label="Besitzer" htmlFor="deal-owner">
        <select id="deal-owner" value=${deal.owner} onChange=${(e) => set({ owner: e.target.value })}>
          ${people.map((p) => html`<option value=${p.email.toLowerCase()}>${p.name}</option>`)}
          ${!people.some((p) => norm(p.email) === norm(deal.owner)) && html`<option value=${deal.owner}>${memberName(deal.owner)}</option>`}
        </select>
      <//>`}
      ${deal.status === 'offen'
        ? html`<${Field} label="Erwarteter Abschluss" htmlFor="deal-expected">
              <input id="deal-expected" type="date" value=${deal.expected_close || ''} onChange=${(e) => set({ expected_close: e.target.value || null })} />
            <//>
            <${Field} label="Wahrscheinlichkeit in %" htmlFor="deal-prob">
              <input
                id="deal-prob"
                type="number"
                min="0"
                max="100"
                step="5"
                inputmode="numeric"
                value=${deal.probability ?? ''}
                placeholder=${t('[offen]')}
                onChange=${(e) => {
                  const v = e.target.value === '' ? null : Math.max(0, Math.min(100, Math.round(Number(e.target.value))))
                  set({ probability: Number.isFinite(v) ? v : null })
                }}
              />
            <//>`
        : html`<${Field} label=${deal.status === 'gewonnen' ? 'Gewonnen am' : 'Verloren am'} htmlFor="deal-closed">
            <input id="deal-closed" type="date" value=${deal.closed_at || ''} onChange=${(e) => e.target.value && set({ closed_at: e.target.value })} />
          <//>`}
    </div>

    <h4 class="deal-sub">${t('Produkte')}</h4>
    ${items.length > 0 &&
    html`<ul class="deal-items">
      ${items.map((i) => html`<${ItemRow} key=${i.id} item=${i} onChange=${(patch) => changeItem(i, patch)} onRemove=${() => removeItem(i)} />`)}
    </ul>`}
    <div class="deal-add">
      <select aria-label=${t('Produkt hinzufügen')} value="" onChange=${(e) => e.target.value && addItem(e.target.value)}>
        <option value="">${t('Produkt hinzufügen …')}</option>
        ${products.map((p) => html`<option value=${p.id}>${p.name} (${fmtEuro(p.price_cents)})</option>`)}
      </select>
    </div>
    ${items.length === 0
      ? html`<${Field} label="Wert in Euro, netto" htmlFor="deal-value" hint="Ohne Produkte gibst du den Wert direkt ein. Mit Produkten ergibt er sich aus den Zeilen.">
          <input id="deal-value" inputmode="decimal" value=${value} onInput=${(e) => setValue(e.target.value)} onBlur=${saveValue} />
        <//>`
      : places + bonus > 0 &&
        html`<p class="muted small">${t('{n} Netzwerkplätze', { n: places + bonus })}${bonus > 0 ? ' ' + t('({paid} bezahlt, {free} gratis)', { paid: places, free: bonus }) : ''}</p>`}

    <div class="deal-foot">
      <span class="muted small">${people.length > 1 ? '' : t('Besitzer: {name}', { name: memberName(deal.owner) })}</span>
      <button type="button" class="btn btn-danger-text" onClick=${removeDeal}><${Icon} name="trash" size=${16} /> ${t('Wert und Status entfernen')}</button>
    </div>
  </section>`
}

function ItemRow({ item, onChange, onRemove }) {
  const [qty, setQty] = useState(String(item.quantity))
  const [price, setPrice] = useState(euroInput(item.unit_price_cents))
  const [disc, setDisc] = useState(String(Number(item.discount_percent || 0)))
  useEffect(() => {
    setQty(String(Number(item.quantity)))
    setPrice(euroInput(item.unit_price_cents))
    setDisc(String(Number(item.discount_percent || 0)))
  }, [item.quantity, item.unit_price_cents, item.discount_percent])
  const save = () => {
    const q = Number(String(qty).replace(',', '.'))
    const p = parseEuro(price)
    const d = Number(String(disc).replace(',', '.'))
    if (!(q > 0) || p === null || !(d >= 0 && d <= 100)) {
      toast(t('Menge über 0, Preis in Euro und Rabatt zwischen 0 und 100 Prozent, bitte.'), { error: true })
      setQty(String(Number(item.quantity)))
      setPrice(euroInput(item.unit_price_cents))
      setDisc(String(Number(item.discount_percent || 0)))
      return
    }
    if (q !== Number(item.quantity) || p !== Number(item.unit_price_cents) || d !== Number(item.discount_percent || 0)) {
      onChange({ quantity: q, unit_price_cents: p, discount_percent: d })
    }
  }
  return html`<li class="deal-item">
    <span class="deal-item-name">${item.name}</span>
    <label class="deal-num"><span>${t('Menge')}</span><input inputmode="decimal" value=${qty} onInput=${(e) => setQty(e.target.value)} onBlur=${save} /></label>
    <label class="deal-num wide"><span>${t('Preis €')}</span><input inputmode="decimal" value=${price} onInput=${(e) => setPrice(e.target.value)} onBlur=${save} /></label>
    <label class="deal-num"><span>${t('Rabatt %')}</span><input inputmode="decimal" value=${disc} onInput=${(e) => setDisc(e.target.value)} onBlur=${save} /></label>
    <strong class="deal-item-sum">${fmtEuro(itemTotal(item))}</strong>
    <button type="button" class="icon-btn small" aria-label=${t('„{name}“ entfernen', { name: item.name })} onClick=${onRemove}><${Icon} name="trash" size=${16} /></button>
  </li>`
}
