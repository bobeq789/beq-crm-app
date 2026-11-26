// Mails bei Kontakten und Firmen: neueste oben, Text wird erst beim Aufklappen geladen
import { html, useState, useEffect } from '../lib/preact.js'
import { Icon } from '../lib/icons.js'
import { fmtDateTime, fmtSize, htmlToText, splitQuoted, gmailUrl } from '../lib/util.js'
import { state, emailsOfPersons, ensureFull, personByEmail, memberName, member, isOwnMailbox, canOpenAttachments, openMailAttachment, spurFor, confirmDialog, toast, importGeminiMeeting, geminiMeetingOf } from '../store.js'
import { isGeminiMail, parseGeminiMail } from '../lib/gemini.js'
import { navigate } from '../router.js'
import { Empty, LinkText } from './common.js'
import { t } from '../i18n.js'

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
  return html`<ul class=${'attachments ' + cls} aria-label=${t('Anhänge')}>
    ${files.map((a, i) => {
      const key = i + ':' + a.part
      const inner = html`<${Icon} name="paperclip" size=${16} />
        <span class="att-name">${a.name}</span>
        ${busy === key ? html`<span class="att-size">${t('Öffnet …')}</span>` : a.size ? html`<span class="att-size">${fmtSize(a.size)}</span>` : null}`
      return html`<li key=${key}>
        ${can && a.part
          ? html`<button type="button" class="att-btn" disabled=${busy === key} aria-busy=${busy === key} title=${t('„{name}“ öffnen', { name: a.name })} onClick=${() => open(a, key)}>${inner}</button>`
          : html`<span class="att-btn att-off" title=${t('Anhänge öffnest du nur aus deinen eigenen Postfächern')}>${inner}</span>`}
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
const times = (n) => (n === 1 ? t('einmal') : `${n}×`)

// Notizen von Gemini: „Als Meeting übernehmen“ (41_meeting_gemini.sql). Nur in eigenen Postfächern,
// nur wenn der Text geladen ist und eine Zusammenfassung enthält. Schon übernommen: Link zum Meeting.
export function GeminiImport({ mail }) {
  const [busy, setBusy] = useState(false)
  if (!isGeminiMail(mail) || !isOwnMailbox(mail.mailbox) || !state.full.emails.has(mail.id)) return null
  const done = geminiMeetingOf(mail)
  if (done)
    return html`<div class="gemini-box">
      <${Icon} name="check" size=${16} />
      <span>${t('Als Meeting übernommen.')}</span>
      <a class="link-btn" href=${'#/meetings/' + done.id}>${t('Meeting öffnen')}</a>
    </div>`
  if (!parseGeminiMail(mail)) return null
  const run = async () => {
    const ok = await confirmDialog({
      title: t('Als Meeting übernehmen?'),
      text: t('Zusammenfassung und nächste Schritte von Gemini werden ein Meeting im CRM. Das Meeting sieht danach das ganze Team, Gäste nicht. Die Mail selbst bleibt privat.'),
      confirmLabel: t('Übernehmen'),
    })
    if (!ok) return
    setBusy(true)
    const res = await importGeminiMeeting(mail)
    setBusy(false)
    if (res.error) return toast(res.error, { error: true })
    toast(res.event ? t('Meeting angelegt, mit Zeit und Teilnehmern aus dem Termin.') : t('Meeting angelegt.'), {
      action: { label: t('Öffnen'), run: () => navigate('/meetings/' + res.meeting.id) },
    })
  }
  return html`<div class="gemini-box">
    <span>${t('Notizen von Gemini zu einem Meeting.')}</span>
    <button type="button" class="btn btn-small btn-primary" disabled=${busy} onClick=${run}><${Icon} name="meetings" size=${16} /> ${busy ? t('Wird übernommen …') : t('Als Meeting übernehmen')}</button>
  </div>`
}

export function SpurBadges({ mail }) {
  const s = spurFor(mail)
  if (!s) return null
  return html`<span class="spur-badges">
    ${s.geoeffnet > 0
      ? html`<span class="badge spur-badge spur-open" title=${t('Zuletzt geöffnet {when}', { when: fmtDateTime(s.zuletzt_geoeffnet) })}><${Icon} name="eye" size=${13} /> ${t('Geöffnet')} ${s.geoeffnet > 1 ? s.geoeffnet + '×' : ''}</span>`
      : html`<span class="badge spur-badge"><${Icon} name="eye" size=${13} /> ${t('Nicht geöffnet')}</span>`}
    ${s.geklickt > 0 && html`<span class="badge spur-badge spur-click" title=${t('Zuletzt angeklickt {when}', { when: fmtDateTime(s.zuletzt_geklickt) })}><${Icon} name="external" size=${13} /> ${t('Angeklickt')}</span>`}
  </span>`
}

export function SpurBox({ mail }) {
  const s = spurFor(mail)
  if (!s) return null
  const links = s.links || []
  return html`<section class="spur-box" aria-label=${t('Verfolgung')}>
    <div class="spur-head"><${Icon} name="eye" size=${16} /> <strong>${t('Verfolgung')}</strong> <span class="muted small">${t('nur für dich sichtbar')}</span></div>
    <ul class="spur-facts">
      <li>${s.geoeffnet > 0 ? t('Geöffnet {times}, zuletzt {when}', { times: times(s.geoeffnet), when: fmtDateTime(s.zuletzt_geoeffnet) }) : t('Noch nicht geöffnet')}</li>
      <li>
        ${s.links_anzahl === 0
          ? t('Die Mail hat keine Links.')
          : s.geklickt > 0
          ? t('Links angeklickt: {times}, zuletzt {when}', { times: times(s.geklickt), when: fmtDateTime(s.zuletzt_geklickt) })
          : t('Noch kein Link angeklickt')}
      </li>
      ${links.map((l) => html`<li class="spur-link" key=${l.link}><span class="spur-url" title=${l.link}>${shortLink(l.link)}</span> <span class="muted small">${times(l.anzahl)}</span></li>`)}
    </ul>
    <p class="muted small">${t(SPUR_HINT)}</p>
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
      <span class=${'mail-dir ' + (out ? 'out' : 'in')} title=${out ? t('gesendet') : t('empfangen')}>
        <${Icon} name=${out ? 'arrowOut' : 'arrowIn'} size=${16} />
      </span>
      <span class="mail-main">
        <span class="mail-subject">${mail.subject || t('(ohne Betreff)')}</span>
        <span class="mail-meta">${out ? t('an') + ' ' : t('von') + ' '}${counterpart} · ${fmtDateTime(mail.sent_at)}</span>
        <${SpurBadges} mail=${mail} />
      </span>
      ${(mail.attachments || []).length > 0 && html`<${Icon} name="paperclip" size=${16} cls="mail-clip" />`}
    </button>
    ${open &&
    html`<div class="mail-body">
      ${!loaded
        ? html`<p class="muted">${t('Wird geladen …')}</p>`
        : html`<div class="prose"><${LinkText} text=${parts.main || t('(kein Text)')} /></div>
            ${parts.quoted &&
            html`<button type="button" class="link-btn" onClick=${() => setShowQuoted(!showQuoted)}>
                ${showQuoted ? t('Zitierten Verlauf ausblenden') : t('Zitierten Verlauf anzeigen')}
              </button>
              ${showQuoted && html`<div class="prose quoted"><${LinkText} text=${parts.quoted} /></div>`}`}`}
      <${GeminiImport} mail=${mail} />
      <${MailAttachments} mail=${mail} />
      <${SpurBox} mail=${mail} />
      <div class="mail-foot">
        <span class="muted small">${t('Postfach: {box}', { box: mail.mailbox })}</span>
        ${mail.provider_id &&
        isOwnMailbox(mail.mailbox) &&
        html`<a class="link-btn" href=${gmailUrl(mail.mailbox, mail.provider_id)} target="_blank" rel="noopener noreferrer">
          <${Icon} name="external" size=${16} /> ${t('In Gmail öffnen')}
        </a>`}
      </div>
    </div>`}
  </li>`
}

export function EmailList({ personIds }) {
  const [limit, setLimit] = useState(PAGE)
  const list = emailsOfPersons(personIds)
  if (!list.length) return html`<${Empty}>${t('Noch keine Mails.')}<//>`
  return html`<div>
    <ul class="mail-list">${list.slice(0, limit).map((m) => html`<${EmailRow} mail=${m} key=${m.id} />`)}</ul>
    ${list.length > limit && html`<button type="button" class="link-btn" onClick=${() => setLimit(limit + PAGE)}>${t('Ältere anzeigen')}</button>`}
  </div>`
}

export function emailCount(personIds) {
  return emailsOfPersons(personIds).length
}
