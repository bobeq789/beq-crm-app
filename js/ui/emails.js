// Mails bei Kontakten und Firmen: neueste oben, Text wird erst beim Aufklappen geladen
import { html, useState, useEffect } from '../lib/preact.js'
import { Icon } from '../lib/icons.js'
import { fmtDateTime, htmlToText, splitQuoted, gmailUrl } from '../lib/util.js'
import { state, emailsOfPersons, ensureFull, personByEmail, memberName, member } from '../store.js'
import { Empty, LinkText } from './common.js'

const PAGE = 10

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
      ${(mail.attachments || []).length > 0 &&
      html`<ul class="attachments">
        ${mail.attachments.map((a) => html`<li><${Icon} name="paperclip" size=${14} /> ${a}</li>`)}
      </ul>`}
      <div class="mail-foot">
        <span class="muted small">Postfach: ${mail.mailbox}</span>
        ${mail.provider_id &&
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
