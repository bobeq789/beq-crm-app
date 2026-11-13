// Mails bei Kontakten und Firmen: neueste oben, Text wird erst beim Aufklappen geladen
import { html, useState, useEffect } from '../lib/preact.js'
import { Icon } from '../lib/icons.js'
import { fmtDateTime, fmtSize, htmlToText, splitQuoted, gmailUrl } from '../lib/util.js'
import { state, emailsOfPersons, ensureFull, personByEmail, memberName, member, isOwnMailbox, canOpenAttachments, openMailAttachment, spurFor } from '../store.js'
import { Empty, LinkText } from './common.js'

const PAGE = 10

// Anhänge einer Mail mit Teil-Nummer (aus dem Abgleich). Ohne Teil-Nummer nur der Name.
export const attachmentsOf = (m) =>
  m.attachment_list && m.attachment_list.length ? m.attachment_list : (m.attachments || []).map((name) => ({ name, part: '' }))

// Anhänge als Knöpfe: bei Kontakt, Firma und im Postfach. Öffnen nur aus eigenen Postfächern
// (Frage 13: Nein), sonst steht nur der Name da. Während des Ladens steht „Öffnet …“ am Knopf.
export function MailAttachments({ mail, cls = '' }) {
  const [busy, setBusy] = useState(null)
  const files = attachmentsOf(mail)
  if (!files.length) return null
  const can = canOpenAttachments(mail)
  const open = async (a, key) => {
    setBusy(key)
    await openMailAttachment(mail, a)
    setBusy(null)
  }
  return html`<ul class=${'attachments ' + cls} aria-label="Anhänge">
    ${files.map((a, i) => {
      const key = i + ':' + a.part
      const inner = html`<${Icon} name="paperclip" size=${16} />
        <span class="att-name">${a.name}</span>
        ${busy === key ? html`<span class="att-size">Öffnet …</span>` : a.size ? html`<span class="att-size">${fmtSize(a.size)}</span>` : null}`
      return html`<li key=${key}>
        ${can && a.part
          ? html`<button type="button" class="att-btn" disabled=${busy === key} aria-busy=${busy === key} title=${'„' + a.name + '“ öffnen'} onClick=${() => open(a, key)}>${inner}</button>`
          : html`<span class="att-btn att-off" title="Anhänge öffnest du nur aus deinen eigenen Postfächern">${inner}</span>`}
      </li>`
    })}
  </ul>`
}

// ------------------------------------------------------------
// Mail-Verfolgung (27_mail_spur.sql): nur an eigenen gesendeten Mails mit Schalter, nur für den
// Absender. Kurz als Marken (Listen), ausführlich als Kasten (geöffnete Mail).
// ------------------------------------------------------------
export const SPUR_HINT = '„Geöffnet“ ist nicht immer genau: Apple Mail lädt Bilder oft von selbst, Outlook blockiert sie oft. Virenscanner klicken manchmal Links. Klicks sind verlässlicher als „geöffnet“.'

// Link kurz zeigen: ohne https:// und www., lange Pfade gekürzt
function shortLink(url) {
  const s = String(url || '').replace(/^https?:\/\/(www\.)?/i, '')
  return s.length > 48 ? s.slice(0, 47) + '…' : s
}
const times = (n) => (n === 1 ? 'einmal' : `${n}×`)

export function SpurBadges({ mail }) {
  const s = spurFor(mail)
  if (!s) return null
  return html`<span class="spur-badges">
    ${s.geoeffnet > 0
      ? html`<span class="badge spur-badge spur-open" title=${'Zuletzt geöffnet ' + fmtDateTime(s.zuletzt_geoeffnet)}><${Icon} name="eye" size=${13} /> Geöffnet ${s.geoeffnet > 1 ? s.geoeffnet + '×' : ''}</span>`
      : html`<span class="badge spur-badge"><${Icon} name="eye" size=${13} /> Nicht geöffnet</span>`}
    ${s.geklickt > 0 && html`<span class="badge spur-badge spur-click" title=${'Zuletzt angeklickt ' + fmtDateTime(s.zuletzt_geklickt)}><${Icon} name="external" size=${13} /> Angeklickt</span>`}
  </span>`
}

export function SpurBox({ mail }) {
  const s = spurFor(mail)
  if (!s) return null
  const links = s.links || []
  return html`<section class="spur-box" aria-label="Verfolgung">
    <div class="spur-head"><${Icon} name="eye" size=${16} /> <strong>Verfolgung</strong> <span class="muted small">nur für dich sichtbar</span></div>
    <ul class="spur-facts">
      <li>${s.geoeffnet > 0 ? html`Geöffnet ${times(s.geoeffnet)}, zuletzt ${fmtDateTime(s.zuletzt_geoeffnet)}` : 'Noch nicht geöffnet'}</li>
      <li>
        ${s.links_anzahl === 0
          ? 'Die Mail hat keine Links.'
          : s.geklickt > 0
          ? html`Links angeklickt: ${times(s.geklickt)}, zuletzt ${fmtDateTime(s.zuletzt_geklickt)}`
          : 'Noch kein Link angeklickt'}
      </li>
      ${links.map((l) => html`<li class="spur-link" key=${l.link}><span class="spur-url" title=${l.link}>${shortLink(l.link)}</span> <span class="muted small">${times(l.anzahl)}</span></li>`)}
    </ul>
    <p class="muted small">${SPUR_HINT}</p>
  </section>`
}

// Name zu einer Adresse: Teammitglied, Kontakt oder die Adresse selbst
function nameFor(address) {
  if (member(address)) return memberName(address)
  const p = personByEmail(address)
  return p ? p.name : address
}

function EmailRow({ mail }) {
  const [open, setOpen] = useState(false)
  const [showQuoted, setShowQuoted] = useState(false)
  useEffect(() => {
    if (open) ensureFull('emails', mail.id)
  }, [open])
  const loaded = state.full.emails.has(mail.id)
  const out = mail.direction === 'out'
  const counterpart = out ? (mail.to_emails || []).map(nameFor).join(', ') : mail.from_name || nameFor(mail.from_email)
  const parts = loaded ? splitQuoted(htmlToText(mail.body)) : null
  return html`<li class=${'mail' + (open ? ' open' : '')}>
    <button type="button" class="mail-head" aria-expanded=${open} onClick=${() => setOpen(!open)}>
      <span class=${'mail-dir ' + (out ? 'out' : 'in')} title=${out ? 'gesendet' : 'empfangen'}>
        <${Icon} name=${out ? 'arrowOut' : 'arrowIn'} size=${16} />
      </span>
      <span class="mail-main">
        <span class="mail-subject">${mail.subject || '(ohne Betreff)'}</span>
        <span class="mail-meta">${out ? 'an ' : 'von '}${counterpart} · ${fmtDateTime(mail.sent_at)}</span>
        <${SpurBadges} mail=${mail} />
      </span>
      ${(mail.attachments || []).length > 0 && html`<${Icon} name="paperclip" size=${16} cls="mail-clip" />`}
    </button>
    ${open &&
    html`<div class="mail-body">
      ${!loaded
        ? html`<p class="muted">Wird geladen …</p>`
        : html`<div class="prose"><${LinkText} text=${parts.main || '(kein Text)'} /></div>
            ${parts.quoted &&
            html`<button type="button" class="link-btn" onClick=${() => setShowQuoted(!showQuoted)}>
                ${showQuoted ? 'Zitierten Verlauf ausblenden' : 'Zitierten Verlauf anzeigen'}
              </button>
              ${showQuoted && html`<div class="prose quoted"><${LinkText} text=${parts.quoted} /></div>`}`}`}
      <${MailAttachments} mail=${mail} />
      <${SpurBox} mail=${mail} />
      <div class="mail-foot">
        <span class="muted small">Postfach: ${mail.mailbox}</span>
        ${mail.provider_id &&
        isOwnMailbox(mail.mailbox) &&
        html`<a class="link-btn" href=${gmailUrl(mail.mailbox, mail.provider_id)} target="_blank" rel="noopener noreferrer">
          <${Icon} name="external" size=${16} /> In Gmail öffnen
        </a>`}
      </div>
    </div>`}
  </li>`
}

export function EmailList({ personIds }) {
  const [limit, setLimit] = useState(PAGE)
  const list = emailsOfPersons(personIds)
  if (!list.length) return html`<${Empty}>Noch keine Mails.<//>`
  return html`<div>
    <ul class="mail-list">${list.slice(0, limit).map((m) => html`<${EmailRow} mail=${m} key=${m.id} />`)}</ul>
    ${list.length > limit && html`<button type="button" class="link-btn" onClick=${() => setLimit(limit + PAGE)}>Ältere anzeigen</button>`}
  </div>`
}

export function emailCount(personIds) {
  return emailsOfPersons(personIds).length
}
