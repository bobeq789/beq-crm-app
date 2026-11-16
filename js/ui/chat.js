// Chat (Stufe B, 30_chat.sql): links Kanäle und Unterhaltungen mit Zahlen, rechts der Verlauf.
// Am Handy entweder die Liste (#/chat) oder ein Raum (#/chat/<id>).
// Texte aus Nachrichten immer als Text (NoteText), nie als HTML.
import { html, useState, useEffect, useRef, useLayoutEffect } from '../lib/preact.js'
import { Icon } from '../lib/icons.js'
import { norm, firstName, fmtTime, fmtDate } from '../lib/util.js'
import { state, myEmail, memberName, isGuest, isAdmin, openDialog, closeDialog, toast, activeMembers, activeGuests } from '../store.js'
import { navigate } from '../router.js'
import { PageHead, Empty, Avatar, Modal, Field, Segmented, useIsMobile } from './common.js'
import { withLabels, parseMentions, NoteText } from './mentions.js'
import {
  getRoom,
  roomTitle,
  messagesOf,
  loadMessages,
  loadOlder,
  setActiveRoom,
  markRead,
  sendMessage,
  editMessage,
  deleteMessage,
  discardFailed,
  createChannel,
  openDirect,
  createGroup,
  addMembers,
  removeMember,
  changeRoom,
  chatErrorText,
} from '../chat.js'

const me = () => norm(myEmail())

// ------------------------------------------------------------
// Seite
// ------------------------------------------------------------
export function ChatPage({ raumId }) {
  const mobile = useIsMobile()
  const chat = state.chat
  const guest = isGuest()
  if (!chat.available) {
    return html`<div class="page">
      <${PageHead} kicker="Chat" title="Nachrichten" />
      <${Empty}>Der Chat ist noch nicht eingerichtet. Bitte melde dich beim Admin.<//>
    </div>`
  }
  const room = raumId ? getRoom(raumId) : null
  const actions = guest
    ? null
    : html`<button type="button" class="btn" onClick=${() => openDialog({ kind: 'chat-neu' })}><${Icon} name="users" size=${18} /> Neue Nachricht</button>
        <button type="button" class="btn btn-primary" onClick=${() => openDialog({ kind: 'chat-kanal' })}><${Icon} name="plus" size=${18} /> Neuer Kanal</button>`
  const showList = !mobile || !raumId
  const showRoom = !mobile || !!raumId
  return html`<div class="page chat-page">
    ${showList && html`<${PageHead} kicker="Chat" title="Nachrichten" actions=${actions} />`}
    <div class="chat-split">
      ${showList && html`<${RoomList} activeId=${raumId} />`}
      ${showRoom &&
      (room
        ? html`<${RoomView} room=${room} key=${room.id} mobile=${mobile} />`
        : raumId
        ? html`<div class="chat-empty-room">
            ${mobile && html`<a class="back-link" href="#/chat"><${Icon} name="back" size=${16} /> Alle Chats</a>`}
            <p>Diesen Chat gibt es nicht (mehr) oder du bist nicht dabei.</p>
          </div>`
        : html`<div class="chat-empty-room"><p>Wähl links einen Kanal oder eine Unterhaltung.</p></div>`)}
    </div>
  </div>`
}

// ------------------------------------------------------------
// Liste der Räume
// ------------------------------------------------------------
function RoomList({ activeId }) {
  const [showArchived, setShowArchived] = useState(false)
  const rooms = state.chat.rooms
  const channels = rooms.filter((r) => r.art === 'kanal' && !r.archiviert).sort((a, b) => roomTitle(a).localeCompare(roomTitle(b), 'de'))
  const talks = rooms.filter((r) => r.art !== 'kanal')
  const archived = rooms.filter((r) => r.art === 'kanal' && r.archiviert)
  return html`<nav class="chat-list" aria-label="Kanäle und Unterhaltungen">
    <h2 class="chat-list-head">Kanäle</h2>
    ${channels.length ? html`<ul class="chat-items">${channels.map((r) => html`<${RoomItem} room=${r} active=${r.id === activeId} key=${r.id} />`)}</ul>` : html`<p class="chat-list-empty">Noch keine Kanäle.</p>`}
    <h2 class="chat-list-head">Direktnachrichten und Gruppen</h2>
    ${talks.length
      ? html`<ul class="chat-items">${talks.map((r) => html`<${RoomItem} room=${r} active=${r.id === activeId} key=${r.id} />`)}</ul>`
      : html`<p class="chat-list-empty">${isGuest() ? 'Als Gast schreibst du in den Kanälen, in die du eingeladen bist.' : 'Noch keine Unterhaltungen.'}</p>`}
    ${archived.length > 0 &&
    html`<button type="button" class="link-btn chat-archived-toggle" aria-expanded=${showArchived} onClick=${() => setShowArchived(!showArchived)}>
        Archivierte Kanäle (${archived.length})
      </button>
      ${showArchived && html`<ul class="chat-items">${archived.map((r) => html`<${RoomItem} room=${r} active=${r.id === activeId} key=${r.id} />`)}</ul>`}`}
  </nav>`
}

function RoomIcon({ room }) {
  if (room.art === 'direkt') {
    const other = (room.mitglieder || []).find((e) => norm(e) !== me())
    return html`<${Avatar} email=${other} />`
  }
  return html`<span class="chat-room-icon" aria-hidden="true"><${Icon} name=${room.art === 'gruppe' ? 'users' : room.offen ? 'hash' : 'lock'} size=${18} /></span>`
}

function RoomItem({ room, active }) {
  const unread = room.ungelesen || 0
  const outsider = room.art === 'kanal' && !room.offen && !room.mitglied
  const label = roomTitle(room) + (unread ? `, ${unread} ungelesen` : '') + (room.erwaehnt ? ', du wurdest erwähnt' : '')
  return html`<li>
    <a href=${'#/chat/' + room.id} class=${'chat-item' + (active ? ' active' : '') + (unread ? ' unread' : '') + (outsider ? ' outsider' : '')} aria-current=${active ? 'page' : undefined} aria-label=${label}>
      <${RoomIcon} room=${room} />
      <span class="chat-item-name">${roomTitle(room)}</span>
      ${room.erwaehnt > 0 && html`<span class="chat-at" title="Du wurdest erwähnt">@</span>`}
      ${unread > 0 && html`<span class="chat-count">${unread > 99 ? '99+' : unread}</span>`}
    </a>
  </li>`
}

// ------------------------------------------------------------
// Ein Raum: Kopf, Verlauf, Eingabe
// ------------------------------------------------------------
function RoomView({ room, mobile }) {
  const msgs = messagesOf(room.id)
  const scrollRef = useRef()
  const nearBottom = useRef(true)
  const lastCount = useRef(0)
  const [editing, setEditing] = useState(null)

  useEffect(() => {
    setActiveRoom(room.id)
    if (!messagesOf(room.id).loaded) loadMessages(room.id)
    else loadMessages(room.id, true)
    return () => setActiveRoom(null)
  }, [room.id])

  // Offen und sichtbar: gelesen
  useEffect(() => {
    if (room.ungelesen || room.erwaehnt) markRead(room.id)
  }, [room.id, room.ungelesen, room.erwaehnt])

  // Neue Nachrichten unten: mitscrollen, wenn man schon unten war. Ältere oben: Position halten.
  const prevHeight = useRef(0)
  const prevFirst = useRef(null)
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const first = msgs.list[0] && msgs.list[0].id
    if (prevFirst.current && first !== prevFirst.current && lastCount.current) {
      el.scrollTop = el.scrollHeight - prevHeight.current + el.scrollTop
    } else if (nearBottom.current || !lastCount.current) {
      el.scrollTop = el.scrollHeight
    }
    prevFirst.current = first
    prevHeight.current = el.scrollHeight
    lastCount.current = msgs.list.length
  }, [msgs.list.length, msgs.list.length && msgs.list[msgs.list.length - 1].id])

  const onScroll = (e) => {
    const el = e.currentTarget
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    prevHeight.current = el.scrollHeight
  }

  const canManage = room.art === 'kanal' && !isGuest() && (norm(room.created_by) === me() || isAdmin())
  const sub =
    room.art === 'kanal'
      ? [room.offen ? 'Offen fürs Team' : 'Nur auf Einladung', room.archiviert ? 'archiviert' : '', room.beschreibung].filter(Boolean).join(' · ')
      : room.art === 'gruppe'
      ? `Gruppe mit ${(room.mitglieder || []).length} Personen`
      : 'Direktnachricht'
  return html`<section class="chat-room" aria-label=${roomTitle(room)}>
    <header class="chat-room-head">
      ${mobile && html`<a class="icon-btn chat-back" href="#/chat" aria-label="Alle Chats"><${Icon} name="back" /></a>`}
      <div class="chat-room-title">
        <h2>${roomTitle(room)}</h2>
        <p class="muted">${sub}</p>
      </div>
      <div class="chat-room-actions">
        ${room.art !== 'direkt' &&
        html`<button type="button" class="btn btn-small" onClick=${() => openDialog({ kind: 'chat-personen', raumId: room.id })} aria-label=${'Personen, ' + (room.mitglieder || []).length}>
          <${Icon} name="users" size=${16} /> ${(room.mitglieder || []).length}
        </button>`}
        ${canManage && html`<button type="button" class="icon-btn" aria-label="Kanal bearbeiten" title="Kanal bearbeiten" onClick=${() => openDialog({ kind: 'chat-kanal', raumId: room.id })}><${Icon} name="gear" size=${18} /></button>`}
      </div>
    </header>
    <div class="chat-scroll" ref=${scrollRef} onScroll=${onScroll}>
      ${!msgs.complete && msgs.list.length > 0 &&
      html`<div class="chat-older"><button type="button" class="btn btn-small" disabled=${msgs.loading} onClick=${() => loadOlder(room.id)}>${msgs.loading ? 'Lädt …' : 'Ältere Nachrichten laden'}</button></div>`}
      ${msgs.loading && !msgs.list.length && html`<p class="chat-hint">Lädt …</p>`}
      ${msgs.loaded && !msgs.list.length && html`<p class="chat-hint">Noch keine Nachrichten. Schreib die erste.</p>`}
      <${MessageList} room=${room} list=${msgs.list} editing=${editing} setEditing=${setEditing} />
    </div>
    ${room.archiviert
      ? html`<p class="chat-archived-note">Der Kanal ist archiviert. Lesen geht weiter, schreiben nicht mehr.</p>`
      : html`<${Composer} room=${room} onSent=${() => (nearBottom.current = true)} />`}
  </section>`
}

// Tag als Trenner: Heute, Gestern, sonst Datum
function dayLabel(iso) {
  const d = new Date(iso)
  const today = new Date()
  const y = new Date()
  y.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Heute'
  if (d.toDateString() === y.toDateString()) return 'Gestern'
  return fmtDate(iso)
}

function MessageList({ room, list, editing, setEditing }) {
  const out = []
  let lastDay = null
  let prev = null
  list.forEach((m) => {
    const day = new Date(m.created_at).toDateString()
    if (day !== lastDay) {
      out.push(html`<div class="chat-day" key=${'d' + day}><span>${dayLabel(m.created_at)}</span></div>`)
      prev = null
      lastDay = day
    }
    // Folgenachricht derselben Person innerhalb von 5 Minuten: ohne Kopf
    const follow = prev && prev.autor === m.autor && new Date(m.created_at) - new Date(prev.created_at) < 5 * 60000
    out.push(html`<${Message} key=${m.id} m=${m} room=${room} follow=${follow} editing=${editing === m.id} setEditing=${setEditing} />`)
    prev = m
  })
  return html`<div class="chat-messages" role="log" aria-live="polite">${out}</div>`
}

function Message({ m, room, follow, editing, setEditing }) {
  const own = norm(m.autor) === me()
  const deleted = !!m.geloescht_at
  const mentionsMe = (m.erwaehnt || []).includes(me())
  return html`<div class=${'chat-msg' + (follow ? ' follow' : '') + (m.pending ? ' pending' : '') + (m.failed ? ' failed' : '') + (mentionsMe && !deleted ? ' mentioned' : '')}>
    <div class="chat-msg-avatar">${!follow && html`<${Avatar} email=${m.autor} />`}</div>
    <div class="chat-msg-main">
      ${!follow &&
      html`<div class="chat-msg-head">
        <strong>${memberName(m.autor)}</strong>
        <time datetime=${m.created_at}>${fmtTime(m.created_at)}</time>
      </div>`}
      ${editing
        ? html`<${EditBox} m=${m} room=${room} onDone=${() => setEditing(null)} />`
        : deleted
        ? html`<p class="chat-msg-text chat-deleted">Nachricht gelöscht</p>`
        : html`<p class="chat-msg-text"><${NoteText} text=${m.text} mentions=${m.erwaehnt} />${m.bearbeitet_at && html` <span class="chat-edited">(bearbeitet)</span>`}</p>`}
      ${m.failed &&
      html`<p class="chat-failed">Nicht gesendet. <button type="button" class="link-btn" onClick=${() => discardFailed(m.raum_id, m.id)}>Verwerfen</button></p>`}
    </div>
    ${own && !deleted && !editing && !m.pending && !m.failed &&
    html`<div class="chat-msg-tools">
      <button type="button" class="icon-btn" aria-label="Nachricht bearbeiten" title="Bearbeiten" onClick=${() => setEditing(m.id)}><${Icon} name="edit" size=${16} /></button>
      <button type="button" class="icon-btn" aria-label="Nachricht löschen" title="Löschen" onClick=${() => deleteMessage(m)}><${Icon} name="trash" size=${16} /></button>
    </div>`}
  </div>`
}

// ------------------------------------------------------------
// Eingabe mit @Erwähnungen
// ------------------------------------------------------------
// Wer im Raum erwähnt werden kann: bei offenen Kanälen das ganze Team (ohne Gäste) plus
// eingeladene Gäste, sonst die Beteiligten
function mentionable(room) {
  const self = me()
  const all = state.db.team_members.filter((t) => t.active)
  const members = new Set((room.mitglieder || []).map(norm))
  const people = all
    .filter((t) => norm(t.email) !== self)
    .filter((t) => (room.art === 'kanal' && room.offen ? t.role !== 'gast' || members.has(norm(t.email)) : members.has(norm(t.email))))
    .map((t) => ({ email: norm(t.email), name: t.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))
  return withLabels(people)
}

const AT_RE = /(^|\s)@([\p{L}\p{N}.-]*)$/u

function useMentionInput(room, initial = '') {
  const [text, setText] = useState(initial)
  const [query, setQuery] = useState(null)
  const [pick, setPick] = useState(0)
  const ref = useRef()
  const people = mentionable(room)
  const matches = query === null ? [] : people.filter((p) => norm(p.label).startsWith(norm(query)) || norm(p.name).startsWith(norm(query))).slice(0, 6)
  const update = (value) => {
    setText(value)
    const el = ref.current
    const caret = el ? el.selectionStart : value.length
    const hit = value.slice(0, caret).match(AT_RE)
    setQuery(hit ? hit[2] : null)
    setPick(0)
  }
  // Cursor nach dem Einsetzen hinter den Namen setzen, sobald der neue Text im Feld steht
  const caretAfter = useRef(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (el && caretAfter.current !== null) {
      el.focus()
      el.setSelectionRange(caretAfter.current, caretAfter.current)
      caretAfter.current = null
    }
  })
  const insert = (p) => {
    const el = ref.current
    const caret = el ? el.selectionStart : text.length
    const before = text.slice(0, caret).replace(AT_RE, (all, space) => space + '@' + p.label + ' ')
    caretAfter.current = before.length
    setText(before + text.slice(caret))
    setQuery(null)
  }
  // Pfeile und Enter in der Vorschlagsliste. true heißt: Taste verbraucht.
  const onKey = (e) => {
    if (!matches.length) return false
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setPick((pick + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length)
      return true
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      insert(matches[pick])
      return true
    }
    if (e.key === 'Escape') {
      e.stopPropagation()
      setQuery(null)
      return true
    }
    return false
  }
  const suggestions = matches.length
    ? html`<ul class="chat-suggest" role="listbox" aria-label="Person erwähnen">
        ${matches.map(
          (p, i) => html`<li key=${p.email} role="option" aria-selected=${i === pick}>
            <button type="button" class=${i === pick ? 'active' : ''} onMouseDown=${(e) => e.preventDefault()} onClick=${() => insert(p)}>
              <${Avatar} email=${p.email} name=${p.name} /> ${p.name}
            </button>
          </li>`
        )}
      </ul>`
    : null
  return { text, setText: update, reset: () => (setText(''), setQuery(null)), ref, onKey, suggestions, mentions: () => parseMentions(text, people) }
}

function Composer({ room, onSent }) {
  const input = useMentionInput(room)
  const [busy, setBusy] = useState(false)
  const send = async () => {
    const text = input.text.trim()
    if (!text || busy) return
    if (text.length > 4000) return toast('Die Nachricht ist zu lang (höchstens 4.000 Zeichen).', { error: true })
    setBusy(true)
    const mentions = input.mentions()
    input.reset()
    onSent()
    await sendMessage(room.id, text, mentions)
    setBusy(false)
    input.ref.current && input.ref.current.focus()
  }
  const onKeyDown = (e) => {
    if (input.onKey(e)) return
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      send()
    }
  }
  return html`<div class="chat-composer">
    ${input.suggestions}
    <label class="sr-only" for=${'chat-input-' + room.id}>Nachricht an ${roomTitle(room)}</label>
    <textarea
      id=${'chat-input-' + room.id}
      ref=${input.ref}
      rows="1"
      placeholder=${'Nachricht an ' + roomTitle(room)}
      value=${input.text}
      onInput=${(e) => input.setText(e.target.value)}
      onKeyDown=${onKeyDown}
    ></textarea>
    <button type="button" class="btn btn-primary chat-send" aria-label="Senden" disabled=${!input.text.trim()} onClick=${send}><${Icon} name="send" size=${18} /></button>
  </div>`
}

function EditBox({ m, room, onDone }) {
  const input = useMentionInput(room, m.text)
  useEffect(() => {
    const el = input.ref.current
    if (el) {
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }
  }, [])
  const save = async () => {
    const text = input.text.trim()
    if (!text) return
    if (text === m.text) return onDone()
    if (await editMessage(m, text, input.mentions())) onDone()
  }
  const onKeyDown = (e) => {
    if (input.onKey(e)) return
    if (e.key === 'Escape') {
      e.stopPropagation()
      onDone()
    } else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      save()
    }
  }
  return html`<div class="chat-edit">
    ${input.suggestions}
    <textarea ref=${input.ref} aria-label="Nachricht bearbeiten" value=${input.text} onInput=${(e) => input.setText(e.target.value)} onKeyDown=${onKeyDown}></textarea>
    <div class="chat-edit-actions">
      <button type="button" class="btn btn-small" onClick=${onDone}>Abbrechen</button>
      <button type="button" class="btn btn-small btn-primary" disabled=${!input.text.trim()} onClick=${save}>Speichern</button>
    </div>
  </div>`
}

// ------------------------------------------------------------
// Dialoge: Kanal anlegen oder bearbeiten, neue Nachricht, Personen
// ------------------------------------------------------------
function PersonChecks({ people, value, onChange, idPrefix }) {
  const set = new Set(value)
  const toggle = (email) => onChange(set.has(email) ? value.filter((e) => e !== email) : [...value, email])
  if (!people.length) return html`<p class="muted">Niemand zur Auswahl.</p>`
  return html`<ul class="chat-people">
    ${people.map(
      (p) => html`<li key=${p.email}>
        <label for=${idPrefix + p.email}>
          <input type="checkbox" id=${idPrefix + p.email} checked=${set.has(p.email)} onChange=${() => toggle(p.email)} />
          <${Avatar} email=${p.email} name=${p.name} />
          <span>${p.name}${p.guest ? html` <span class="muted">(Gast)</span>` : ''}</span>
        </label>
      </li>`
    )}
  </ul>`
}

const teamPeople = () => activeMembers().filter((t) => norm(t.email) !== me()).map((t) => ({ email: norm(t.email), name: t.name, guest: false }))
const guestPeople = () => activeGuests().map((t) => ({ email: norm(t.email), name: t.name, guest: true }))

function ChannelDialog({ d }) {
  const room = d.raumId ? getRoom(d.raumId) : null
  const [name, setName] = useState(room ? room.name : '')
  const [beschreibung, setBeschreibung] = useState(room ? room.beschreibung || '' : '')
  const [offen, setOffen] = useState(room ? room.offen : true)
  const [people, setPeople] = useState([])
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      if (room) {
        await changeRoom(room.id, { name: name.trim(), beschreibung, offen })
        closeDialog()
        toast('Kanal gespeichert.')
      } else {
        const id = await createChannel({ name: name.trim(), beschreibung, offen, mitglieder: people })
        closeDialog()
        navigate('/chat/' + id)
      }
    } catch (err) {
      toast(chatErrorText(err), { error: true })
    }
    setBusy(false)
  }
  const archive = async () => {
    setBusy(true)
    try {
      await changeRoom(room.id, { archiviert: !room.archiviert })
      closeDialog()
      toast(room.archiviert ? 'Kanal wieder aktiv.' : 'Kanal archiviert. Lesen geht weiter.')
    } catch (err) {
      toast(chatErrorText(err), { error: true })
    }
    setBusy(false)
  }
  return html`<${Modal} title=${room ? 'Kanal bearbeiten' : 'Neuer Kanal'} onClose=${closeDialog}>
    <form onSubmit=${submit}>
      <${Field} label="Name" htmlFor="chat-kanal-name">
        <input id="chat-kanal-name" maxlength="80" value=${name} onInput=${(e) => setName(e.target.value)} placeholder="zum Beispiel Messe Hamburg" />
      <//>
      <${Field} label="Beschreibung (optional)" htmlFor="chat-kanal-text">
        <input id="chat-kanal-text" maxlength="500" value=${beschreibung} onInput=${(e) => setBeschreibung(e.target.value)} />
      <//>
      <${Field} label="Wer ist dabei?">
        <${Segmented}
          label="Wer ist dabei?"
          value=${offen}
          onChange=${setOffen}
          options=${[
            { value: true, label: 'Offen fürs Team' },
            { value: false, label: 'Nur auf Einladung' },
          ]}
        />
      <//>
      <p class="muted chat-dialog-hint">
        ${offen
          ? 'Alle im Team lesen und schreiben mit. Gäste nur, wenn du sie einlädst.'
          : 'Nur eingeladene Personen und die Admins sehen den Kanal.'}
      </p>
      ${!room &&
      html`<${Field} label=${offen ? 'Gäste einladen (optional)' : 'Personen einladen'}>
        <${PersonChecks} people=${offen ? guestPeople() : [...teamPeople(), ...guestPeople()]} value=${people} onChange=${setPeople} idPrefix="chat-kanal-p-" />
      <//>`}
      <div class="form-actions">
        ${room && html`<button type="button" class="btn" disabled=${busy} onClick=${archive}>${room.archiviert ? 'Wieder aktivieren' : 'Archivieren'}</button>`}
        <button type="button" class="btn" onClick=${closeDialog}>Abbrechen</button>
        <button type="submit" class="btn btn-primary" disabled=${!name.trim() || busy}>${room ? 'Speichern' : 'Anlegen'}</button>
      </div>
    </form>
  <//>`
}

function NewTalkDialog() {
  const [people, setPeople] = useState([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    if (!people.length || busy) return
    setBusy(true)
    try {
      const id = people.length === 1 ? await openDirect(people[0]) : await createGroup({ mitglieder: people, name })
      closeDialog()
      navigate('/chat/' + id)
    } catch (err) {
      toast(chatErrorText(err), { error: true })
    }
    setBusy(false)
  }
  return html`<${Modal} title="Neue Nachricht" onClose=${closeDialog}>
    <form onSubmit=${submit}>
      <p class="muted chat-dialog-hint">Eine Person: Direktnachricht. Mehrere: Gruppe. Lesen können nur die Beteiligten, auch kein Admin.</p>
      <${Field} label="An wen?">
        <${PersonChecks} people=${teamPeople()} value=${people} onChange=${setPeople} idPrefix="chat-neu-p-" />
      <//>
      ${people.length > 1 &&
      html`<${Field} label="Name der Gruppe (optional)" htmlFor="chat-neu-name">
        <input id="chat-neu-name" maxlength="80" value=${name} onInput=${(e) => setName(e.target.value)} />
      <//>`}
      <div class="form-actions">
        <button type="button" class="btn" onClick=${closeDialog}>Abbrechen</button>
        <button type="submit" class="btn btn-primary" disabled=${!people.length || busy}>${people.length > 1 ? 'Gruppe anlegen' : 'Schreiben'}</button>
      </div>
    </form>
  <//>`
}

function PeopleDialog({ d }) {
  const room = getRoom(d.raumId)
  const [adding, setAdding] = useState([])
  const [busy, setBusy] = useState(false)
  if (!room) return null
  const self = me()
  const members = room.mitglieder || []
  const guest = isGuest()
  const canRemoveOthers = room.art === 'kanal' && !guest && (norm(room.created_by) === self || isAdmin())
  const canAdd = !guest && !room.archiviert && (room.art === 'kanal' || members.includes(self))
  const candidates = (room.art === 'kanal' ? [...teamPeople(), ...guestPeople()] : teamPeople()).filter((p) => !members.includes(p.email))
  const run = async (fn, done) => {
    setBusy(true)
    try {
      await fn()
      if (done) done()
    } catch (err) {
      toast(chatErrorText(err), { error: true })
    }
    setBusy(false)
  }
  const leave = () =>
    run(
      () => removeMember(room.id, self),
      () => {
        closeDialog()
        toast(room.art === 'kanal' && room.offen ? 'Du hast den Kanal verlassen. Er bleibt für dich lesbar, weil er offen ist.' : 'Du bist nicht mehr dabei.')
        if (!(room.art === 'kanal' && (room.offen || isAdmin()))) navigate('/chat')
      }
    )
  return html`<${Modal} title=${'Personen in ' + roomTitle(room)} onClose=${closeDialog}>
    ${room.art === 'kanal' && room.offen && html`<p class="muted chat-dialog-hint">Offener Kanal: Alle im Team lesen mit. Hier stehen die, die beigetreten sind oder eingeladen wurden.</p>`}
    <ul class="chat-members">
      ${members.map(
        (e) => html`<li key=${e}>
          <${Avatar} email=${e} />
          <span>${memberName(e)}${e === self ? ' (du)' : ''}${e === norm(room.created_by) && room.art === 'kanal' ? html` <span class="muted">· hat den Kanal angelegt</span>` : ''}</span>
          ${e !== self && canRemoveOthers && html`<button type="button" class="btn btn-small" disabled=${busy} onClick=${() => run(() => removeMember(room.id, e))}>Entfernen</button>`}
        </li>`
      )}
    </ul>
    ${canAdd && candidates.length > 0 &&
    html`<${Field} label="Hinzufügen">
        <${PersonChecks} people=${candidates} value=${adding} onChange=${setAdding} idPrefix="chat-add-p-" />
      <//>
      <div class="form-actions">
        <button type="button" class="btn btn-primary" disabled=${!adding.length || busy} onClick=${() => run(() => addMembers(room.id, adding), () => setAdding([]))}>Hinzufügen</button>
      </div>`}
    <div class="form-actions">
      ${members.includes(self) && html`<button type="button" class="btn" disabled=${busy} onClick=${leave}>${room.art === 'kanal' ? 'Kanal verlassen' : 'Gruppe verlassen'}</button>`}
      ${room.art === 'kanal' && room.offen && !members.includes(self) && !guest &&
      html`<button type="button" class="btn" disabled=${busy} onClick=${() => run(() => addMembers(room.id, [self]))}>Beitreten</button>`}
      <button type="button" class="btn btn-primary" onClick=${closeDialog}>Fertig</button>
    </div>
  <//>`
}

export const chatDialogs = { 'chat-kanal': ChannelDialog, 'chat-neu': NewTalkDialog, 'chat-personen': PeopleDialog }
