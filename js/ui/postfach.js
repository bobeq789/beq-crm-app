// Reiter „Postfach“: alle Mails aus den verbundenen Postfächern (14_postfach.sql).
// Liste mit Filter (Eingang, Gesendet, Alle, Ohne Antwort), Postfach und Suche, daneben die Mail mit
// Anhängen. „Neue Mail“, „Antworten“, „Allen antworten“, „Weiterleiten“ öffnen das
// Fenster zum Schreiben. Senden und Löschen nur aus eigenen Postfächern.
// Mailtext wird nie als HTML eingesetzt, sondern als Text (htmlToText).
import { html, useState, useEffect, useRef } from '../lib/preact.js'
import { Icon } from '../lib/icons.js'
import { fmtDate, fmtTime, fmtDateTime, fmtSize, htmlToText, splitQuoted, gmailUrl, matches, norm, todayStr } from '../lib/util.js'
import { useRoute, setParam } from '../router.js'
import {
  state,
  isDemo,
  ensureFull,
  member,
  memberName,
  personByEmail,
  myActiveMailboxes,
  isOwnMailbox,
  sendMail,
  mailSignature,
  deleteMail,
  syncNow,
  openDialog,
  closeDialog,
  confirmDialog,
  toast,
  openedPostfach,
  closedPostfach,
  isNewMail,
  loadNoReply,
  dismissNoReply,
} from '../store.js'
import { PageHead, Segmented, Empty, LinkText, Modal, Field, dialogKinds, useIsMobile } from './common.js'
import { MailAttachments, attachmentsOf } from './emails.js'

const PAGE = 60
const MAX_FILES = 18 * 1024 * 1024

// Name zu einer Adresse: Teammitglied, Kontakt oder die Adresse selbst
function nameFor(address) {
  if (!address) return ''
  if (member(address)) return memberName(address)
  const p = personByEmail(address)
  return p ? p.name : address
}
const fromName = (m) => m.from_name || nameFor(m.from_email)

function shortTime(iso) {
  if (!iso) return ''
  return iso.slice(0, 10) === todayStr() || new Date(iso).toDateString() === new Date().toDateString() ? fmtTime(iso) : fmtDate(iso)
}

function mailboxesOf(m) {
  return m.mailboxes && m.mailboxes.length ? m.mailboxes : [m.mailbox]
}

// ------------------------------------------------------------
// Liste
// ------------------------------------------------------------
// Neu seit dem letzten Blick: fett mit gefülltem Pfeil, wie ungelesen (Gmail bleibt unberührt)
function MailItem({ mail, active, onOpen }) {
  const out = mail.direction === 'out'
  const who = out ? 'An ' + (mail.to_emails || []).map(nameFor).join(', ') : fromName(mail)
  const files = attachmentsOf(mail)
  const fresh = isNewMail(mail)
  return html`<li>
    <button type="button" class=${'pf-item' + (active ? ' active' : '') + (fresh ? ' pf-new' : '')} aria-current=${active ? 'true' : undefined} onClick=${() => onOpen(mail.id)}>
      <span class="pf-line1">
        <span class="pf-who">${fresh && html`<span class="pf-new-mark" aria-label="Neu"></span>`}${who || '(unbekannt)'}</span>
        <span class="pf-time">${shortTime(mail.sent_at)}</span>
      </span>
      <span class="pf-subject">
        ${files.length > 0 && html`<${Icon} name="paperclip" size=${14} cls="pf-clip" />`}
        ${mail.subject || '(ohne Betreff)'}
      </span>
      ${mail.snippet && html`<span class="pf-snippet">${mail.snippet}</span>`}
    </button>
  </li>`
}

// ------------------------------------------------------------
// Lesen
// ------------------------------------------------------------
function MailReader({ mail, onBack }) {
  const [showQuoted, setShowQuoted] = useState(false)
  useEffect(() => {
    ensureFull('emails', mail.id)
    setShowQuoted(false)
  }, [mail.id])
  const loaded = state.full.emails.has(mail.id)
  const parts = loaded ? splitQuoted(htmlToText(mail.body)) : null
  const files = attachmentsOf(mail)
  const own = isOwnMailbox(mail.mailbox)
  const persons = state.db.email_persons.filter((x) => x.email_id === mail.id).map((x) => state.db.persons.find((p) => p.id === x.person_id)).filter(Boolean)
  const reply = (mode) => openCompose({ mode, mail })
  const remove = async () => {
    const ok = await confirmDialog({
      title: 'Mail löschen?',
      text: 'Die Mail kommt in den Papierkorb von Gmail und verschwindet aus dem CRM. Im Papierkorb lässt sie sich 30 Tage lang wiederherstellen.',
      confirmLabel: 'Löschen',
      danger: true,
    })
    if (ok && (await deleteMail(mail))) (onBack || (() => setParam('mail', null, true)))()
  }
  return html`<article class="pf-reader">
    ${onBack && html`<button type="button" class="link-btn pf-back" onClick=${onBack}><${Icon} name="back" size=${16} /> Zurück zur Liste</button>`}
    <h2 class="pf-reader-subject">${mail.subject || '(ohne Betreff)'}</h2>
    <div class="pf-reader-meta">
      <div><strong>${fromName(mail)}</strong> <span class="muted small">${mail.from_email}</span></div>
      ${(mail.to_emails || []).length > 0 && html`<div class="muted small">An: ${mail.to_emails.map(nameFor).join(', ')}</div>`}
      ${(mail.cc_emails || []).length > 0 && html`<div class="muted small">Kopie: ${mail.cc_emails.map(nameFor).join(', ')}</div>`}
      <div class="muted small">${fmtDateTime(mail.sent_at)}, Postfach ${mailboxesOf(mail).join(', ')}</div>
    </div>
    <div class="pf-actions">
      <button type="button" class="btn btn-small" onClick=${() => reply('antworten')}><${Icon} name="reply" size=${16} /> Antworten</button>
      <button type="button" class="btn btn-small" onClick=${() => reply('allen')}><${Icon} name="replyAll" size=${16} /> Allen antworten</button>
      <button type="button" class="btn btn-small" onClick=${() => reply('weiter')}><${Icon} name="forward" size=${16} /> Weiterleiten</button>
      ${own && html`<button type="button" class="btn btn-small btn-danger-text" onClick=${remove}><${Icon} name="trash" size=${16} /> Löschen</button>`}
      ${!isDemo &&
      own &&
      mail.provider_id &&
      html`<a class="btn btn-small" href=${gmailUrl(mail.mailbox, mail.provider_id)} target="_blank" rel="noopener noreferrer"><${Icon} name="external" size=${16} /> In Gmail</a>`}
    </div>
    <${MailAttachments} mail=${mail} cls="pf-attachments" />
    <div class="pf-body">
      ${!loaded
        ? html`<p class="muted">Wird geladen …</p>`
        : html`<div class="prose"><${LinkText} text=${parts.main || '(kein Text)'} /></div>
            ${parts.quoted &&
            html`<button type="button" class="link-btn" onClick=${() => setShowQuoted(!showQuoted)}>
                ${showQuoted ? 'Zitierten Verlauf ausblenden' : 'Zitierten Verlauf anzeigen'}
              </button>
              ${showQuoted && html`<div class="prose quoted"><${LinkText} text=${parts.quoted} /></div>`}`}`}
    </div>
    ${persons.length > 0 &&
    html`<div class="pf-persons">
      <span class="muted small">Kontakte:</span>
      ${persons.map((p) => html`<a key=${p.id} href=${'#/kontakte/' + p.id}>${p.name}</a>`)}
    </div>`}
  </article>`
}

// ------------------------------------------------------------
// „Ohne Antwort“ (D3): eigene Mails an Fremde, älter als 3 Tage, ohne Antwort. Aufgeklappt
// „Nachhaken“ (Antwort im selben Verlauf) und „Braucht keine Antwort“ (auch als Haken).
// ------------------------------------------------------------
function NoReplyItem({ item, open, onToggle }) {
  const mail = state.db.emails.find((m) => m.id === item.email_id)
  const to = (item.to_emails || []).map(nameFor).join(', ')
  const since = item.tage === 1 ? 'seit 1 Tag' : `seit ${item.tage} Tagen`
  return html`<li class=${'pf-noreply' + (open ? ' open' : '')}>
    <div class="pf-noreply-row">
      <button type="button" class="pf-item" aria-expanded=${open} onClick=${onToggle}>
        <span class="pf-line1"><span class="pf-who">An ${to || '(unbekannt)'}</span><span class="pf-time">${shortTime(item.sent_at)}</span></span>
        <span class="pf-subject"><span class="badge due-later">${since}</span> ${item.subject || '(ohne Betreff)'}</span>
      </button>
      <button type="button" class="check pf-noreply-check" title="Braucht keine Antwort" aria-label=${'Braucht keine Antwort: ' + (item.subject || 'ohne Betreff')} onClick=${() => dismissNoReply(item)}>
        <${Icon} name="check" size=${16} />
      </button>
    </div>
    ${open &&
    html`<div class="pf-noreply-actions">
      ${mail && html`<button type="button" class="btn btn-small btn-primary" onClick=${() => openReply(mail)}><${Icon} name="reply" size=${16} /> Nachhaken</button>`}
      <button type="button" class="btn btn-small" onClick=${() => dismissNoReply(item)}><${Icon} name="check" size=${16} /> Braucht keine Antwort</button>
    </div>`}
  </li>`
}

function NoReplyList({ box }) {
  const [openKey, setOpenKey] = useState(null)
  const items = (state.followUp.noReply || []).filter((x) => !box || x.mailbox === box)
  if (state.followUp.noReply === null) return html`<p class="muted pf-loading">Wird geladen …</p>`
  if (!items.length) return html`<${Empty}>Gerade wartest du auf keine Antwort. Hier stehen eigene Mails an Fremde, auf die nach 3 Tagen niemand geantwortet hat.<//>`
  return html`<ul class="pf-items">
    ${items.map((x) => {
      const key = x.mailbox + '|' + x.verlauf
      return html`<${NoReplyItem} key=${key} item=${x} open=${openKey === key} onToggle=${() => setOpenKey(openKey === key ? null : key)} />`
    })}
  </ul>`
}

// ------------------------------------------------------------
// Seite
// ------------------------------------------------------------
export function PostfachPage() {
  const route = useRoute()
  const mobile = useIsMobile()
  const [folder, setFolder] = useState('eingang')
  const [box, setBox] = useState('')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [syncing, setSyncing] = useState(false)
  const selectedId = route.params.get('mail')
  // Öffnen merkt sich den letzten Blick (auf allen Geräten), die Zahl am Postfach geht auf null
  useEffect(() => {
    openedPostfach()
    return closedPostfach
  }, [])
  useEffect(() => {
    if (folder === 'ohne') loadNoReply()
  }, [folder])
  // Auswahl nur mit eigenen Postfächern, fremde Mails liefert die Datenbank ohnehin nicht (17_mails_privat.sql)
  const boxes = myActiveMailboxes()
  const mine = myActiveMailboxes()

  const list = state.db.emails
    .filter((m) => (folder === 'eingang' ? m.direction !== 'out' : folder === 'gesendet' ? m.direction === 'out' : true))
    .filter((m) => !box || mailboxesOf(m).includes(box))
    .filter((m) => !query || matches(query, m.subject, m.from_name, m.from_email, (m.to_emails || []).join(' '), m.snippet))
    .sort((a, b) => String(b.sent_at).localeCompare(String(a.sent_at)))
  const selected = selectedId ? state.db.emails.find((m) => m.id === selectedId) : null
  const open = (id) => setParam('mail', id, !mobile)
  const back = () => setParam('mail', null, true)

  const runSync = async () => {
    setSyncing(true)
    await syncNow()
    setSyncing(false)
  }
  const actions = html`<div class="pf-head-actions">
    ${mine.length > 0 &&
    html`<button type="button" class="btn" disabled=${syncing} onClick=${runSync}><${Icon} name="sync" size=${18} /> ${syncing ? 'Gleicht ab …' : 'Jetzt abgleichen'}</button>`}
    <button type="button" class="btn btn-primary" onClick=${() => openCompose({ mode: 'neu' })}><${Icon} name="plus" size=${18} /> Neue Mail</button>
  </div>`

  // Handy: entweder Liste oder Mail
  if (mobile && selected) {
    return html`<div class="page"><${MailReader} mail=${selected} onBack=${back} key=${selected.id} /></div>`
  }

  const listView = folder === 'ohne'
    ? html`<section class="pf-list" aria-label="Ohne Antwort"><${NoReplyList} box=${box} /></section>`
    : html`<section class="pf-list" aria-label="Mails">
    ${list.length === 0
      ? html`<${Empty}>${state.db.emails.length ? 'Keine Mails für diese Auswahl.' : boxes.length ? 'Noch keine Mails. Der erste Abgleich läuft in den nächsten Minuten.' : 'Noch kein Postfach verbunden. Unter Einstellungen, „Postfächer und Kalender“ verbindest du deins.'}<//>`
      : html`<ul class="pf-items">${list.slice(0, limit).map((m) => html`<${MailItem} key=${m.id} mail=${m} active=${m.id === selectedId} onOpen=${open} />`)}</ul>
          ${list.length > limit && html`<button type="button" class="link-btn pf-more" onClick=${() => setLimit(limit + PAGE)}>Ältere anzeigen (${list.length - limit})</button>`}`}
  </section>`

  return html`<div class="page page-wide">
    <${PageHead} kicker="Postfach" title="Postfach" actions=${actions} />
    <div class="pf-toolbar">
      <${Segmented}
        label="Ordner"
        value=${folder}
        onChange=${(v) => {
          setFolder(v)
          setLimit(PAGE)
        }}
        options=${[
          { value: 'eingang', label: 'Eingang' },
          { value: 'gesendet', label: 'Gesendet' },
          { value: 'alle', label: 'Alle' },
          { value: 'ohne', label: 'Ohne Antwort' },
        ]}
      />
      ${boxes.length > 1 &&
      html`<select aria-label="Postfach" value=${box} onChange=${(e) => setBox(e.target.value)}>
        <option value="">Alle Postfächer</option>
        ${boxes.map((b) => html`<option value=${b.address}>${b.address}</option>`)}
      </select>`}
      <label class="search pf-search">
        <${Icon} name="search" size=${18} />
        <input type="search" value=${query} placeholder="Suchen: Betreff, Absender, Empfänger" aria-label="Mails durchsuchen" onInput=${(e) => setQuery(e.target.value)} />
      </label>
    </div>
    ${mobile
      ? listView
      : html`<div class="pf-split">
          ${listView}
          <div class="pf-reader-wrap">
            ${selected ? html`<${MailReader} mail=${selected} key=${selected.id} />` : html`<div class="pf-empty-reader"><${Icon} name="inbox" size=${32} /><p class="muted">Wähl links eine Mail aus.</p></div>`}
          </div>
        </div>`}
  </div>`
}

// ------------------------------------------------------------
// Schreiben: neu, antworten, allen antworten, weiterleiten
// ------------------------------------------------------------
async function openCompose({ mode, mail = null }) {
  if (mail) await ensureFull('emails', mail.id)
  const full = mail ? state.db.emails.find((m) => m.id === mail.id) || mail : null
  openDialog({ kind: 'mail-compose', mode, mail: full })
}
export const openNewMail = (to = '') => openDialog({ kind: 'mail-compose', mode: 'neu', to })
// Antwort auf genau diese Mail, im selben Verlauf (auch „Nachhaken“ auf eine eigene Mail)
export const openReply = (mail, mode = 'antworten') => openCompose({ mode, mail })

// Erste Zeile des zitierten Verlaufs. Beim Senden trennt sie eigenen Text und Zitat, damit die
// Signatur wie in Gmail dazwischen steht.
const quoteMarker = (mail) => `Am ${fmtDateTime(mail.sent_at)} schrieb ${fromName(mail)}:`
const FORWARD_MARKER = 'Weitergeleitete Mail:'

function quote(mail) {
  const text = htmlToText(mail.body || '')
  return `\n\n${quoteMarker(mail)}\n` + text.split('\n').map((l) => '> ' + l).join('\n')
}

function prefill(d, mine) {
  const own = new Set(mine.map((b) => b.address))
  const m = d.mail
  const von = (m && mine.find((b) => mailboxesOf(m).includes(b.address))) || mine[0]
  const base = { von: von ? von.address : '', an: d.to || '', cc: '', betreff: '', text: '', marker: '' }
  if (!m) return base
  const subject = m.subject || ''
  if (d.mode === 'weiter') {
    return {
      ...base,
      betreff: /^(fwd?|wg):/i.test(subject) ? subject : 'Fwd: ' + subject,
      marker: FORWARD_MARKER,
      text: `\n\n${FORWARD_MARKER}\nVon: ${fromName(m)} <${m.from_email}>\nDatum: ${fmtDateTime(m.sent_at)}\nBetreff: ${subject}\nAn: ${(m.to_emails || []).join(', ')}\n\n${htmlToText(m.body || '')}`,
    }
  }
  const sender = m.direction === 'out' ? m.to_emails || [] : [m.from_email]
  const all = d.mode === 'allen' ? [...sender, ...(m.to_emails || []), ...(m.cc_emails || [])] : sender
  const to = [...new Set(all.map(norm))].filter((a) => a && !own.has(a))
  return { ...base, an: to.join(', '), betreff: /^(re|aw):/i.test(subject) ? subject : 'Re: ' + subject, text: quote(m), marker: quoteMarker(m) }
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function MailCompose({ d }) {
  const mine = myActiveMailboxes()
  const [form, setForm] = useState(() => prefill(d, mine))
  const [showCc, setShowCc] = useState(false)
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [sig, setSig] = useState({ status: 'laden', text: '' })
  const [withSig, setWithSig] = useState(true)
  const fileInput = useRef()
  // Signatur aus Gmail für das gewählte Postfach (nur Text, die App zeigt kein fremdes HTML)
  useEffect(() => {
    let current = true
    setSig({ status: 'laden', text: '' })
    mailSignature(form.von).then((value) => current && setSig(value))
    return () => {
      current = false
    }
  }, [form.von])
  const set = (patch) => setForm({ ...form, ...patch })
  const total = files.reduce((n, f) => n + f.size, 0)
  const close = () => closeDialog()
  const title = { neu: 'Neue Mail', antworten: 'Antworten', allen: 'Allen antworten', weiter: 'Weiterleiten' }[d.mode] || 'Neue Mail'
  const addresses = [...new Set([...state.db.persons.flatMap((p) => p.emails || []), ...state.db.team_members.map((t) => t.email)].map(norm))].sort()

  const addFiles = (list) => {
    const next = [...files, ...Array.from(list || [])]
    if (next.reduce((n, f) => n + f.size, 0) > MAX_FILES) {
      setError('Die Anhänge sind zusammen größer als 18 MB. Bitte weniger oder kleinere Dateien anhängen.')
      return
    }
    setError(null)
    setFiles(next)
  }
  const submit = async (e) => {
    e.preventDefault()
    const an = form.an.split(/[,;]/).map((a) => a.trim()).filter(Boolean)
    const cc = form.cc.split(/[,;]/).map((a) => a.trim()).filter(Boolean)
    if (!form.von) return setError('Verbinde zuerst dein Postfach unter Einstellungen, „Postfächer und Kalender“.')
    if (!an.length && !cc.length) return setError('Bitte mindestens eine Adresse eintragen.')
    const bad = [...an, ...cc].find((a) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a))
    if (bad) return setError(`Die Adresse „${bad}“ stimmt nicht. Bitte prüfen.`)
    setBusy(true)
    setError(null)
    try {
      const dateien = []
      for (const f of files) dateien.push({ name: f.name, mime: f.type || 'application/octet-stream', data: await readFile(f) })
      // Eigener Text und zitierter Verlauf getrennt, die Signatur kommt dazwischen
      const at = form.marker ? form.text.indexOf(form.marker) : -1
      const ok = await sendMail({
        von: form.von,
        an,
        cc,
        betreff: form.betreff,
        text: at >= 0 ? form.text.slice(0, at) : form.text,
        zitat: at >= 0 ? form.text.slice(at) : '',
        signatur: withSig && sig.status === 'da',
        antwort_auf: d.mail && d.mode !== 'weiter' ? d.mail.id : null,
        dateien,
      })
      setBusy(false)
      if (ok) close()
    } catch {
      setBusy(false)
      setError('Eine Datei ließ sich nicht lesen. Bitte noch einmal anhängen.')
    }
  }

  if (!mine.length) {
    return html`<${Modal} title=${title} onClose=${close} footer=${html`<button type="button" class="btn" onClick=${close}>Schließen</button>`}>
      <p>Um Mails zu schreiben, verbinde zuerst dein Postfach.</p>
      <a class="btn btn-primary" href="#/einstellungen" onClick=${close}>Zu „Postfächer und Kalender“</a>
    <//>`
  }
  return html`<${Modal}
    title=${title}
    onClose=${close}
    wide=${true}
    footer=${html`<button type="button" class="btn" onClick=${close}>Abbrechen</button>
      <button type="submit" form="mail-compose-form" class="btn btn-primary" disabled=${busy}><${Icon} name="send" size=${18} /> ${busy ? 'Wird gesendet …' : 'Senden'}</button>`}
  >
    <form id="mail-compose-form" class="pf-compose" onSubmit=${submit}>
      ${mine.length > 1
        ? html`<${Field} label="Von" htmlFor="mc-von">
            <select id="mc-von" value=${form.von} onChange=${(e) => set({ von: e.target.value })}>
              ${mine.map((b) => html`<option value=${b.address}>${b.address}</option>`)}
            </select>
          <//>`
        : html`<p class="muted small">Von ${form.von}</p>`}
      <${Field} label="An" htmlFor="mc-an" hint="Mehrere Adressen mit Komma trennen">
        <input id="mc-an" list="mc-adressen" value=${form.an} onInput=${(e) => set({ an: e.target.value })} autocomplete="off" />
      <//>
      <datalist id="mc-adressen">${addresses.map((a) => html`<option value=${a}></option>`)}</datalist>
      ${showCc || form.cc
        ? html`<${Field} label="Kopie (Cc)" htmlFor="mc-cc"><input id="mc-cc" list="mc-adressen" value=${form.cc} onInput=${(e) => set({ cc: e.target.value })} autocomplete="off" /><//>`
        : html`<button type="button" class="link-btn pf-cc" onClick=${() => setShowCc(true)}>Kopie (Cc) hinzufügen</button>`}
      <${Field} label="Betreff" htmlFor="mc-betreff"><input id="mc-betreff" value=${form.betreff} onInput=${(e) => set({ betreff: e.target.value })} /><//>
      <${Field} label="Nachricht" htmlFor="mc-text">
        <textarea id="mc-text" rows="12" value=${form.text} onInput=${(e) => set({ text: e.target.value })}></textarea>
      <//>
      <div class="pf-signature">
        <label class="check-label">
          <input type="checkbox" checked=${withSig && sig.status === 'da'} disabled=${sig.status !== 'da'} onChange=${(e) => setWithSig(e.target.checked)} />
          Signatur aus Gmail anhängen
        </label>
        ${sig.status === 'laden'
          ? html`<p class="muted small">Signatur wird geladen …</p>`
          : sig.status === 'da'
          ? withSig &&
            html`<div class="pf-signature-preview" aria-label="Vorschau der Signatur">${sig.text}</div>
              <p class="muted small">In der Mail steht sie mit Logo und Formatierung wie in Gmail${form.marker ? ', über dem zitierten Verlauf' : ''}.</p>`
          : sig.status === 'keine'
          ? html`<p class="muted small">Für ${form.von} ist in Gmail keine Signatur hinterlegt. Du legst sie in Gmail unter „Einstellungen“, „Signatur“ an.</p>`
          : html`<p class="muted small">Die Signatur ließ sich nicht laden, die Mail geht ohne Signatur raus. ${sig.text}</p>`}
      </div>
      ${d.mode === 'weiter' && attachmentsOf(d.mail || {}).length > 0 && html`<p class="muted small">Die Anhänge der ursprünglichen Mail sind nicht dabei. Häng sie bei Bedarf neu an.</p>`}
      <div class="pf-files">
        ${files.map(
          (f, i) => html`<span class="pf-file" key=${i + f.name}>
            <${Icon} name="paperclip" size=${14} /> ${f.name} <span class="muted small">${fmtSize(f.size)}</span>
            <button type="button" class="icon-btn small" aria-label=${'„' + f.name + '“ entfernen'} onClick=${() => setFiles(files.filter((_, k) => k !== i))}><${Icon} name="x" size=${14} /></button>
          </span>`
        )}
        <input ref=${fileInput} type="file" multiple hidden onChange=${(e) => {
          addFiles(e.target.files)
          e.target.value = ''
        }} />
        <button type="button" class="btn btn-small" onClick=${() => fileInput.current.click()}><${Icon} name="paperclip" size=${16} /> Datei anhängen</button>
        ${files.length > 0 && html`<span class="muted small">zusammen ${fmtSize(total)} von höchstens 18 MB</span>`}
      </div>
      ${error && html`<p class="form-error" role="alert">${error}</p>`}
    </form>
  <//>`
}
dialogKinds['mail-compose'] = MailCompose
