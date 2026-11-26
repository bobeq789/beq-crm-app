// Chat (Stufe B, 30_chat.sql): links Kanäle und Unterhaltungen mit Zahlen, rechts der Verlauf.
// Am Handy entweder die Liste (#/chat) oder ein Raum (#/chat/<id>).
// Texte aus Nachrichten immer als Text (NoteText), nie als HTML.
import { html, useState, useEffect, useRef, useLayoutEffect } from '../lib/preact.js'
import { Icon } from '../lib/icons.js'
import { norm, matches, firstName, fmtTime, fmtDate, fmtSize } from '../lib/util.js'
import { state, myEmail, memberName, isGuest, isAdmin, openDialog, closeDialog, toast, activeMembers, activeGuests } from '../store.js'
import { navigate, openOverlay, closeOverlay } from '../router.js'
import { PageHead, Empty, Avatar, Modal, Field, Segmented, useIsMobile, useOverlay } from './common.js'
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
  threadOf,
  loadThread,
  setOpenThread,
  reactionsOf,
  toggleReaction,
  searchMessages,
  loadUntil,
  fileUrl,
  requestUrls,
  openChatFile,
  prepareFile,
  isImage,
  MAX_CHAT_FILE_BYTES,
  MAX_CHAT_FILES,
  isOnline,
} from '../chat.js'
import { REACTIONS } from '../data/chat_rules.js'
import { roomPushOn, toggleRoomPush } from '../push.js'
import { t } from '../i18n.js'

const me = () => norm(myEmail())

// ------------------------------------------------------------
// Seite
// ------------------------------------------------------------
export function ChatPage({ raumId, verlauf, nachricht }) {
  const mobile = useIsMobile()
  const chat = state.chat
  const guest = isGuest()
  if (!chat.available) {
    return html`<div class="page">
      <${PageHead} kicker=${t('Chat')} title=${t('Nachrichten')} />
      <${Empty}>${t('Der Chat ist noch nicht eingerichtet. Bitte melde dich beim Admin.')}<//>
    </div>`
  }
  const room = raumId ? getRoom(raumId) : null
  const actions = guest
    ? null
    : html`<button type="button" class="btn" onClick=${() => openDialog({ kind: 'chat-neu' })}><${Icon} name="users" size=${18} /> ${t('Neue Nachricht')}</button>
        <button type="button" class="btn btn-primary" onClick=${() => openDialog({ kind: 'chat-kanal' })}><${Icon} name="plus" size=${18} /> ${t('Neuer Kanal')}</button>`
  const showList = !mobile || !raumId
  const showRoom = !mobile || !!raumId
  return html`<div class="page chat-page">
    ${showList && html`<${PageHead} kicker=${t('Chat')} title=${t('Nachrichten')} actions=${actions} />`}
    <div class="chat-split">
      ${showList && html`<${RoomList} activeId=${raumId} />`}
      ${showRoom &&
      (room
        ? html`<${RoomView} room=${room} key=${room.id} mobile=${mobile} focusId=${verlauf ? null : nachricht} />`
        : raumId
        ? html`<div class="chat-empty-room">
            ${mobile && html`<a class="back-link" href="#/chat"><${Icon} name="back" size=${16} /> ${t('Alle Chats')}</a>`}
            <p>${t('Diesen Chat gibt es nicht (mehr) oder du bist nicht dabei.')}</p>
          </div>`
        : html`<div class="chat-empty-room"><p>${t('Wähl links einen Kanal oder eine Unterhaltung.')}</p></div>`)}
    </div>
    ${room && verlauf && html`<${ThreadPanel} room=${room} parentId=${verlauf} focusId=${nachricht} key=${verlauf} />`}
  </div>`
}

// ------------------------------------------------------------
// Liste der Räume
// ------------------------------------------------------------
function RoomList({ activeId }) {
  const [showArchived, setShowArchived] = useState(false)
  const [query, setQuery] = useState('')
  const searching = query.trim().length >= 2
  const rooms = state.chat.rooms
  const channels = rooms.filter((r) => r.art === 'kanal' && !r.archiviert).sort((a, b) => roomTitle(a).localeCompare(roomTitle(b), 'de'))
  const talks = rooms.filter((r) => r.art !== 'kanal')
  const archived = rooms.filter((r) => r.art === 'kanal' && r.archiviert)
  const searchBox = html`<div class="chat-search">
    <${Icon} name="search" size=${16} />
    <label class="sr-only" for="chat-suche">${t('Im Chat suchen')}</label>
    <input id="chat-suche" type="search" placeholder=${t('Im Chat suchen')} value=${query} onInput=${(e) => setQuery(e.target.value)}
      onKeyDown=${(e) => e.key === 'Escape' && query && (e.stopPropagation(), setQuery(''))} />
  </div>`
  const people = isGuest() ? [] : teamPeopleSignedIn()
  if (searching) {
    const hits = people.filter((p) => matches(query, p.name, p.email))
    return html`<nav class="chat-list" aria-label=${t('Suche im Chat')}>
      ${searchBox}
      ${hits.length > 0 &&
      html`<h2 class="chat-list-head">${t('Personen')}</h2>
        <ul class="chat-items">${hits.map((p) => html`<${PersonItem} person=${p} key=${p.email} />`)}</ul>
        <h2 class="chat-list-head">${t('Nachrichten')}</h2>`}
      <${SearchResults} query=${query.trim()} />
    </nav>`
  }
  return html`<nav class="chat-list" aria-label=${t('Kanäle und Unterhaltungen')}>
    ${searchBox}
    <h2 class="chat-list-head">${t('Kanäle')}</h2>
    ${channels.length ? html`<ul class="chat-items">${channels.map((r) => html`<${RoomItem} room=${r} active=${r.id === activeId} key=${r.id} />`)}</ul>` : html`<p class="chat-list-empty">${t('Noch keine Kanäle.')}</p>`}
    <h2 class="chat-list-head">${t('Direktnachrichten und Gruppen')}</h2>
    ${talks.length
      ? html`<ul class="chat-items">${talks.map((r) => html`<${RoomItem} room=${r} active=${r.id === activeId} key=${r.id} />`)}</ul>`
      : html`<p class="chat-list-empty">${isGuest() ? t('Als Gast schreibst du in den Kanälen, in die du eingeladen bist.') : t('Noch keine Unterhaltungen.')}</p>`}
    ${archived.length > 0 &&
    html`<button type="button" class="link-btn chat-archived-toggle" aria-expanded=${showArchived} onClick=${() => setShowArchived(!showArchived)}>
        ${t('Archivierte Kanäle ({n})', { n: archived.length })}
      </button>
      ${showArchived && html`<ul class="chat-items">${archived.map((r) => html`<${RoomItem} room=${r} active=${r.id === activeId} key=${r.id} />`)}</ul>`}`}
    ${people.length > 0 &&
    html`<h2 class="chat-list-head">${t('Team')} <span class="muted small">${t('{n} online', { n: people.filter((p) => isOnline(p.email)).length })}</span></h2>
      <ul class="chat-items">${people.map((p) => html`<${PersonItem} person=${p} key=${p.email} />`)}</ul>`}
  </nav>`
}

// Treffer der Suche: Raum, wer, wann, Ausschnitt mit dem Begriff (alles als Text)
function SearchResults({ query }) {
  const [state_, setState] = useState({ q: null, rows: [], loading: true })
  useEffect(() => {
    let alive = true
    setState((s) => ({ ...s, loading: true }))
    const timer = setTimeout(async () => {
      const rows = await searchMessages(query)
      if (alive) setState({ q: query, rows, loading: false })
    }, 250)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [query])
  if (state_.loading && state_.q !== query) return html`<p class="chat-list-empty">${t('Sucht …')}</p>`
  if (!state_.rows.length) return html`<p class="chat-list-empty">${t('Nichts gefunden.')}</p>`
  return html`<ul class="chat-results">
    ${state_.rows.map((m) => {
      const room = getRoom(m.raum_id)
      const go = () => {
        const params = m.antwort_auf ? { verlauf: m.antwort_auf, nachricht: m.id } : { nachricht: m.id }
        navigate('/chat/' + m.raum_id, params)
      }
      return html`<li key=${m.id}>
        <button type="button" class="chat-result" onClick=${go}>
          <span class="chat-result-head"><strong>${room ? roomTitle(room) : t('Chat')}</strong> <span class="muted">${memberName(m.autor)} · ${fmtDate(m.created_at)}${m.antwort_auf ? ' · ' + t('im Verlauf') : ''}</span></span>
          <span class="chat-result-text"><${Snippet} text=${m.text} query=${query} /></span>
        </button>
      </li>`
    })}
  </ul>`
}

// Ausschnitt um den Treffer, Treffer fett. Nur Text, nie HTML.
function Snippet({ text, query }) {
  const s = String(text || '')
  const i = s.toLocaleLowerCase('de').indexOf(query.toLocaleLowerCase('de'))
  if (i < 0) return s.slice(0, 140)
  const start = Math.max(0, i - 50)
  const end = Math.min(s.length, i + query.length + 80)
  return html`${start > 0 ? '…' : ''}${s.slice(start, i)}<mark>${s.slice(i, i + query.length)}</mark>${s.slice(i + query.length, end)}${end < s.length ? '…' : ''}`
}

function RoomIcon({ room }) {
  if (room.art === 'direkt') {
    const other = (room.mitglieder || []).find((e) => norm(e) !== me())
    return html`<${PersonAvatar} email=${other} />`
  }
  return html`<span class="chat-room-icon" aria-hidden="true"><${Icon} name=${room.art === 'gruppe' ? 'users' : room.offen ? 'hash' : 'lock'} size=${18} /></span>`
}

// Avatar mit Punkt: grün heißt gerade online (die App ist bei der Person offen, 37_team_online.sql)
function PersonAvatar({ email }) {
  if (isGuest()) return html`<${Avatar} email=${email} />`
  const on = isOnline(email)
  return html`<span class="presence-wrap"><${Avatar} email=${email} /><span class=${'presence-dot' + (on ? ' on' : '')} title=${on ? t('online') : t('nicht online')}></span></span>`
}

// Wer im Team schon angemeldet ist, ohne dich. Online zuerst, dann nach Namen.
// Fehlt die Liste (37_team_online.sql noch nicht ausgeführt), alle aktiven Teammitglieder.
function teamPeopleSignedIn() {
  const signed = state.chat.signedIn
  return teamPeople()
    .filter((p) => !signed || signed.includes(p.email))
    .sort((a, b) => Number(isOnline(b.email)) - Number(isOnline(a.email)) || a.name.localeCompare(b.name, 'de'))
}

function PersonItem({ person }) {
  const [busy, setBusy] = useState(false)
  const on = isOnline(person.email)
  const open = async () => {
    const existing = state.chat.rooms.find((r) => r.art === 'direkt' && (r.mitglieder || []).map(norm).includes(person.email))
    if (existing) return navigate('/chat/' + existing.id)
    if (busy) return
    setBusy(true)
    try {
      navigate('/chat/' + (await openDirect(person.email)))
    } catch (err) {
      toast(chatErrorText(err), { error: true })
    }
    setBusy(false)
  }
  return html`<li>
    <button type="button" class="chat-item chat-person" onClick=${open} aria-label=${person.name + ', ' + (on ? t('online') : t('nicht online')) + ', ' + t('Nachricht schreiben')}>
      <${PersonAvatar} email=${person.email} />
      <span class="chat-item-name">${person.name}</span>
      <span class=${'chat-presence' + (on ? ' on' : '')}>${on ? t('online') : ''}</span>
    </button>
  </li>`
}

function RoomItem({ room, active }) {
  const unread = room.ungelesen || 0
  const outsider = room.art === 'kanal' && !room.offen && !room.mitglied
  const label = roomTitle(room) + (unread ? ', ' + t('{n} ungelesen', { n: unread }) : '') + (room.erwaehnt ? ', ' + t('du wurdest erwähnt') : '')
  return html`<li>
    <a href=${'#/chat/' + room.id} class=${'chat-item' + (active ? ' active' : '') + (unread ? ' unread' : '') + (outsider ? ' outsider' : '')} aria-current=${active ? 'page' : undefined} aria-label=${label}>
      <${RoomIcon} room=${room} />
      <span class="chat-item-name">${roomTitle(room)}</span>
      ${room.erwaehnt > 0 && html`<span class="chat-at" title=${t('Du wurdest erwähnt')}>@</span>`}
      ${unread > 0 && html`<span class="chat-count">${unread > 99 ? '99+' : unread}</span>`}
    </a>
  </li>`
}

// ------------------------------------------------------------
// Ein Raum: Kopf, Verlauf, Eingabe
// ------------------------------------------------------------
function RoomView({ room, mobile, focusId }) {
  const msgs = messagesOf(room.id)
  const scrollRef = useRef()
  const nearBottom = useRef(true)
  const lastCount = useRef(0)
  const [editing, setEditing] = useState(null)
  const flash = useFocusMessage(scrollRef, msgs, focusId, () => (nearBottom.current = false), () => loadOlder(room.id))
  // Dateien in den Raum ziehen: landen im Eingabefeld
  const fileSink = useRef(null)
  const [dragging, setDragging] = useState(false)
  const canWrite = !room.archiviert
  const hasFiles = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files')
  const dropProps = canWrite
    ? {
        onDragOver: (e) => {
          if (!hasFiles(e)) return
          e.preventDefault()
          if (!dragging) setDragging(true)
        },
        onDragLeave: (e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false)
        },
        onDrop: (e) => {
          if (!hasFiles(e)) return
          e.preventDefault()
          setDragging(false)
          fileSink.current && fileSink.current([...e.dataTransfer.files])
        },
      }
    : {}

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
      ? [room.offen ? t('Offen fürs Team') : t('Nur auf Einladung'), room.archiviert ? t('archiviert') : '', room.beschreibung].filter(Boolean).join(' · ')
      : room.art === 'gruppe'
      ? t('Gruppe mit {n} Personen', { n: (room.mitglieder || []).length })
      : t('Direktnachricht')
  return html`<section class=${'chat-room' + (dragging ? ' dragging' : '')} aria-label=${roomTitle(room)} ...${dropProps}>
    <header class="chat-room-head">
      ${mobile && html`<a class="icon-btn chat-back" href="#/chat" aria-label=${t('Alle Chats')}><${Icon} name="back" /></a>`}
      <div class="chat-room-title">
        <h2>${roomTitle(room)}</h2>
        <p class="muted">${sub}</p>
      </div>
      <div class="chat-room-actions">
        ${!isGuest() &&
        (() => {
          const on = roomPushOn(room)
          const label = room.art === 'kanal' ? (on ? t('Mitteilungen aus diesem Kanal ausschalten') : t('Mitteilungen aus diesem Kanal einschalten')) : on ? t('Stumm schalten') : t('Stumm aufheben')
          return html`<button type="button" class=${'icon-btn chat-bell' + (on ? ' on' : '')} aria-pressed=${on} aria-label=${label} title=${label} onClick=${() => toggleRoomPush(room)}>
            <${Icon} name="bell" size=${18} />
          </button>`
        })()}
        ${room.art !== 'direkt' &&
        html`<button type="button" class="btn btn-small" onClick=${() => openDialog({ kind: 'chat-personen', raumId: room.id })} aria-label=${t('Personen') + ', ' + (room.mitglieder || []).length}>
          <${Icon} name="users" size=${16} /> ${(room.mitglieder || []).length}
        </button>`}
        ${canManage && html`<button type="button" class="icon-btn" aria-label=${t('Kanal bearbeiten')} title=${t('Kanal bearbeiten')} onClick=${() => openDialog({ kind: 'chat-kanal', raumId: room.id })}><${Icon} name="gear" size=${18} /></button>`}
      </div>
    </header>
    <div class="chat-scroll" ref=${scrollRef} onScroll=${onScroll}>
      ${!msgs.complete && msgs.list.length > 0 &&
      html`<div class="chat-older"><button type="button" class="btn btn-small" disabled=${msgs.loading} onClick=${() => loadOlder(room.id)}>${msgs.loading ? t('Lädt …') : t('Ältere Nachrichten laden')}</button></div>`}
      ${msgs.loading && !msgs.list.length && html`<p class="chat-hint">${t('Lädt …')}</p>`}
      ${msgs.loaded && !msgs.list.length && html`<p class="chat-hint">${t('Noch keine Nachrichten. Schreib die erste.')}</p>`}
      <${MessageList} room=${room} list=${msgs.list} editing=${editing} setEditing=${setEditing} flash=${flash} />
    </div>
    ${room.archiviert
      ? html`<p class="chat-archived-note">${t('Der Kanal ist archiviert. Lesen geht weiter, schreiben nicht mehr.')}</p>`
      : html`<${Composer} room=${room} fileSink=${fileSink} onSent=${() => (nearBottom.current = true)} />`}
  </section>`
}

// Sprung zu einer Nachricht (aus der Suche): ältere Seiten nachladen, bis sie da ist, dann
// hinscrollen und kurz hervorheben. Gibt die hervorgehobene Kennung zurück.
function useFocusMessage(scrollRef, entry, focusId, stopFollow, loadMore) {
  const [flash, setFlash] = useState(null)
  const done = useRef(null)
  const tries = useRef(0)
  useEffect(() => {
    if (!focusId || done.current === focusId || !entry.loaded) return
    const found = entry.list.some((m) => m.id === focusId)
    if (!found) {
      if (!entry.complete && !entry.loading && tries.current < 20) {
        tries.current += 1
        loadMore()
      }
      return
    }
    done.current = focusId
    stopFollow()
    requestAnimationFrame(() => {
      const el = scrollRef.current && scrollRef.current.querySelector(`[data-id="${focusId}"]`)
      if (el) el.scrollIntoView({ block: 'center' })
      setFlash(focusId)
      setTimeout(() => setFlash(null), 2500)
    })
  }, [focusId, entry.list.length, entry.loaded, entry.loading])
  return flash
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

function MessageList({ room, list, editing, setEditing, flash, inThread = false }) {
  const out = []
  let lastDay = null
  let prev = null
  list.forEach((m) => {
    const day = new Date(m.created_at).toDateString()
    if (day !== lastDay) {
      out.push(html`<div class="chat-day" key=${'d' + day}><span>${t(dayLabel(m.created_at))}</span></div>`)
      prev = null
      lastDay = day
    }
    // Folgenachricht derselben Person innerhalb von 5 Minuten: ohne Kopf
    const follow = prev && prev.autor === m.autor && new Date(m.created_at) - new Date(prev.created_at) < 5 * 60000
    out.push(html`<${Message} key=${m.id} m=${m} room=${room} follow=${follow} editing=${editing === m.id} setEditing=${setEditing} flash=${flash === m.id} inThread=${inThread} />`)
    prev = m
  })
  return html`<div class="chat-messages" role="log" aria-live="polite">${out}</div>`
}

function Message({ m, room, follow, editing, setEditing, flash, inThread }) {
  const own = norm(m.autor) === me()
  const deleted = !!m.geloescht_at
  const mentionsMe = (m.erwaehnt || []).includes(me())
  const [picker, setPicker] = useState(false)
  // Am Handy (ohne Maus) zeigt ein Tipp auf die Nachricht die Knöpfe
  const [active, setActive] = useState(false)
  const onTap = (e) => {
    if (e.target.closest('button, a, textarea, input')) return
    setActive(!active)
  }
  const canReact = !deleted && !m.pending && !m.failed && !room.archiviert
  const canReply = !inThread && !m.antwort_auf && !deleted && !m.pending && !m.failed
  const cls = ['chat-msg', follow && 'follow', m.pending && 'pending', m.failed && 'failed', mentionsMe && !deleted && 'mentioned', flash && 'flash', active && 'active'].filter(Boolean).join(' ')
  return html`<div class=${cls} data-id=${m.id}>
    <div class="chat-msg-avatar">${!follow && html`<${Avatar} email=${m.autor} />`}</div>
    <div class="chat-msg-main" onClick=${onTap}>
      ${!follow &&
      html`<div class="chat-msg-head">
        <strong>${memberName(m.autor)}</strong>
        <time datetime=${m.created_at}>${fmtTime(m.created_at)}</time>
      </div>`}
      ${editing
        ? html`<${EditBox} m=${m} room=${room} onDone=${() => setEditing(null)} />`
        : deleted
        ? html`<p class="chat-msg-text chat-deleted">${t('Nachricht gelöscht')}</p>`
        : m.text
        ? html`<p class="chat-msg-text"><${NoteText} text=${m.text} mentions=${m.erwaehnt} />${m.bearbeitet_at && html` <span class="chat-edited">${t('(bearbeitet)')}</span>`}</p>`
        : null}
      ${!deleted && !editing && (m.anhaenge || []).length > 0 && html`<${Attachments} m=${m} />`}
      ${m.failed &&
      html`<p class="chat-failed">${t('Nicht gesendet.')} <button type="button" class="link-btn" onClick=${() => discardFailed(m.raum_id, m.id, m.antwort_auf)}>${t('Verwerfen')}</button></p>`}
      <${ReactionBar} m=${m} canReact=${canReact} />
      ${picker && canReact && html`<${ReactionPicker} m=${m} onClose=${() => setPicker(false)} />`}
      ${!inThread && !m.antwort_auf && m.antworten > 0 &&
      html`<button type="button" class="chat-replies" onClick=${() => openOverlay('verlauf', m.id)}>
        <${Icon} name="reply" size=${14} /> ${m.antworten === 1 ? t('1 Antwort') : t('{n} Antworten', { n: m.antworten })}
        <span class="muted">· ${t('zuletzt {when}', { when: dayLabel(m.letzte_antwort_at) === 'Heute' ? fmtTime(m.letzte_antwort_at) : t(dayLabel(m.letzte_antwort_at)) })}</span>
      </button>`}
    </div>
    ${!editing && !m.pending && !m.failed &&
    html`<div class="chat-msg-tools">
      ${canReact && html`<button type="button" class="icon-btn" aria-label=${t('Reagieren')} title=${t('Reagieren')} aria-expanded=${picker} onClick=${() => setPicker(!picker)}><${Icon} name="smile" size=${16} /></button>`}
      ${canReply && html`<button type="button" class="icon-btn" aria-label=${t('Im Verlauf antworten')} title=${t('Im Verlauf antworten')} onClick=${() => openOverlay('verlauf', m.id)}><${Icon} name="reply" size=${16} /></button>`}
      ${own && !deleted && html`<button type="button" class="icon-btn" aria-label=${t('Nachricht bearbeiten')} title=${t('Bearbeiten')} onClick=${() => setEditing(m.id)}><${Icon} name="edit" size=${16} /></button>`}
      ${own && !deleted && html`<button type="button" class="icon-btn" aria-label=${t('Nachricht löschen')} title=${t('Löschen')} onClick=${() => deleteMessage(m)}><${Icon} name="trash" size=${16} /></button>`}
    </div>`}
  </div>`
}

// Reaktionen unter einer Nachricht: je Zeichen die Zahl, eigene hervorgehoben. Antippen schaltet.
function ReactionBar({ m, canReact }) {
  const list = reactionsOf(m.id)
  if (!list.length) return null
  const self = me()
  const groups = REACTIONS.map((z) => ({ z, who: list.filter((x) => x.zeichen === z).map((x) => x.email) })).filter((g) => g.who.length)
  return html`<div class="chat-reactions">
    ${groups.map((g) => {
      const mine = g.who.includes(self)
      const names = g.who.map((e) => (e === self ? t('du') : firstName(memberName(e)))).join(', ')
      return html`<button type="button" class=${'chat-reaction' + (mine ? ' mine' : '')} aria-pressed=${mine} disabled=${!canReact}
        title=${names} aria-label=${g.z + ' ' + g.who.length + ', ' + names} onClick=${() => toggleReaction(m, g.z)}>
        <span aria-hidden="true">${g.z}</span> ${g.who.length}
      </button>`
    })}
  </div>`
}

function ReactionPicker({ m, onClose }) {
  const mine = new Set(reactionsOf(m.id).filter((x) => x.email === me()).map((x) => x.zeichen))
  return html`<div class="chat-picker" role="group" aria-label=${t('Reaktion wählen')} onKeyDown=${(e) => e.key === 'Escape' && (e.stopPropagation(), onClose())}>
    ${REACTIONS.map(
      (z) => html`<button type="button" class=${mine.has(z) ? 'mine' : ''} aria-pressed=${mine.has(z)} onClick=${() => (toggleReaction(m, z), onClose())}>${z}</button>`
    )}
  </div>`
}

// ------------------------------------------------------------
// Verlauf (Antworten auf eine Nachricht): Fenster rechts, am Handy über die ganze Fläche
// ------------------------------------------------------------
function ThreadPanel({ room, parentId, focusId }) {
  const close = () => closeOverlay('verlauf')
  useOverlay(close)
  const scrollRef = useRef()
  const [editing, setEditing] = useState(null)
  const thread = threadOf(parentId)
  const parent = messagesOf(room.id).list.find((m) => m.id === parentId) || thread.parent
  const [loadedParent, setLoadedParent] = useState(null)
  useEffect(() => {
    setOpenThread(parentId)
    loadThread(parentId)
    if (!parent) loadUntilParent()
    return () => setOpenThread(null)
  }, [parentId])
  // Erste Nachricht nicht im geladenen Raum (zum Beispiel aus der Suche): einzeln holen
  async function loadUntilParent() {
    const rows = await searchParent(room.id, parentId)
    if (rows) setLoadedParent(rows)
  }
  const head = parent || loadedParent
  const flash = useFocusMessage(scrollRef, { ...thread, complete: true }, focusId, () => {}, () => {})
  // Neue Antworten: nach unten scrollen
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && !focusId) el.scrollTop = el.scrollHeight
  }, [thread.list.length])
  return html`<div class="backdrop chat-thread-backdrop" onClick=${(e) => e.target === e.currentTarget && close()}>
    <aside class="chat-thread" role="dialog" aria-modal="true" aria-label=${t('Verlauf')}>
      <header class="chat-room-head">
        <div class="chat-room-title">
          <h2>${t('Verlauf')}</h2>
          <p class="muted">${roomTitle(room)}</p>
        </div>
        <button type="button" class="icon-btn" aria-label=${t('Verlauf schließen')} onClick=${close}><${Icon} name="x" /></button>
      </header>
      <div class="chat-scroll" ref=${scrollRef}>
        ${head && html`<div class="chat-thread-parent"><${MessageList} room=${room} list=${[head]} editing=${null} setEditing=${() => {}} inThread=${true} /></div>`}
        ${thread.loading && !thread.list.length && html`<p class="chat-hint">${t('Lädt …')}</p>`}
        ${thread.loaded && !thread.list.length && html`<p class="chat-hint">${t('Noch keine Antworten.')}</p>`}
        <${MessageList} room=${room} list=${thread.list} editing=${editing} setEditing=${setEditing} flash=${flash} inThread=${true} />
      </div>
      ${room.archiviert || (head && head.geloescht_at)
        ? html`<p class="chat-archived-note">${room.archiviert ? t('Der Kanal ist archiviert.') : t('Die Nachricht ist gelöscht, antworten geht nicht mehr.')}</p>`
        : html`<${Composer} room=${room} parentId=${parentId} onSent=${() => {}} />`}
    </aside>
  </div>`
}

// Erste Nachricht eines Verlaufs einzeln suchen (nur, wenn sie nicht im Raum geladen ist)
async function searchParent(raumId, parentId) {
  await loadUntil(raumId, '0000')
  return messagesOf(raumId).list.find((m) => m.id === parentId) || null
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
    ? html`<ul class="chat-suggest" role="listbox" aria-label=${t('Person erwähnen')}>
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

function Composer({ room, onSent, parentId = null, fileSink = null }) {
  const input = useMentionInput(room)
  const [busy, setBusy] = useState(false)
  const [files, setFiles] = useState([])
  const fileInput = useRef()
  const id = 'chat-input-' + (parentId || room.id)

  // Dateien dazunehmen: höchstens 10, je höchstens 25 MB
  const addFiles = async (list) => {
    const ok = []
    for (const f of list) {
      if (!f || !f.size) continue
      if (f.size > MAX_CHAT_FILE_BYTES) {
        toast(t('„{name}“ ist größer als 25 MB. Bitte verkleinern oder als Link schicken.', { name: f.name }), { error: true })
        continue
      }
      ok.push(f)
    }
    const prepared = await Promise.all(ok.map(prepareFile))
    setFiles((cur) => {
      const room_ = MAX_CHAT_FILES - cur.length
      if (prepared.length > room_) toast(t('Höchstens {n} Dateien je Nachricht.', { n: MAX_CHAT_FILES }), { error: true })
      return [...cur, ...prepared.slice(0, Math.max(0, room_))]
    })
    input.ref.current && input.ref.current.focus()
  }
  if (fileSink) fileSink.current = addFiles
  const removeFile = (fid) => setFiles((cur) => cur.filter((f) => f.id !== fid))

  const send = async () => {
    const text = input.text.trim()
    if ((!text && !files.length) || busy) return
    if (text.length > 4000) return toast(t('Die Nachricht ist zu lang (höchstens 4.000 Zeichen).'), { error: true })
    setBusy(true)
    const mentions = input.mentions()
    const sending = files
    input.reset()
    setFiles([])
    onSent()
    await sendMessage(room.id, text, mentions, parentId, sending)
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
  // Bild aus der Zwischenablage einfügen
  const onPaste = (e) => {
    const list = [...((e.clipboardData && e.clipboardData.files) || [])]
    if (!list.length) return
    e.preventDefault()
    addFiles(list)
  }
  return html`<div class="chat-composer-wrap">
    ${files.length > 0 &&
    html`<ul class="chat-pending-files" aria-label=${t('Dateien für die Nachricht')}>
      ${files.map(
        (f) => html`<li key=${f.id}>
          ${f.preview ? html`<img src=${f.preview} alt="" />` : html`<span class="chat-file-icon" aria-hidden="true"><${Icon} name="paperclip" size=${16} /></span>`}
          <span class="chat-file-name">${f.file.name}</span>
          <span class="chat-file-size">${fmtSize(f.file.size)}</span>
          <button type="button" class="icon-btn" aria-label=${t('„{name}“ entfernen', { name: f.file.name })} onClick=${() => removeFile(f.id)}><${Icon} name="x" size=${14} /></button>
        </li>`
      )}
    </ul>`}
    <div class="chat-composer">
      ${input.suggestions}
      <input type="file" multiple class="sr-only" tabindex="-1" aria-hidden="true" ref=${fileInput}
        onChange=${(e) => (addFiles([...e.target.files]), (e.target.value = ''))} />
      <button type="button" class="icon-btn chat-attach" aria-label=${t('Datei anhängen')} title=${t('Datei oder Bild anhängen')} onClick=${() => fileInput.current.click()}>
        <${Icon} name="paperclip" size=${18} />
      </button>
      <label class="sr-only" for=${id}>${parentId ? t('Antwort im Verlauf') : t('Nachricht an {room}', { room: roomTitle(room) })}</label>
      <textarea
        id=${id}
        ref=${input.ref}
        rows="1"
        placeholder=${parentId ? t('Antworten') : t('Nachricht an {room}', { room: roomTitle(room) })}
        value=${input.text}
        onInput=${(e) => input.setText(e.target.value)}
        onKeyDown=${onKeyDown}
        onPaste=${onPaste}
      ></textarea>
      <button type="button" class="btn btn-primary chat-send" aria-label=${t('Senden')} disabled=${!input.text.trim() && !files.length} onClick=${send}><${Icon} name="send" size=${18} /></button>
    </div>
  </div>`
}

// Anhänge einer Nachricht: Bilder als Vorschau, andere Dateien als Zeile. Antippen öffnet.
function Attachments({ m }) {
  const list = m.anhaenge || []
  useEffect(() => {
    requestUrls(list.filter((a) => a.pfad && isImage(a)).map((a) => a.pfad))
  }, [m.id, list.length, state.chat.urls.size])
  const images = list.filter(isImage)
  const others = list.filter((a) => !isImage(a))
  const open = (a) => a.pfad && openChatFile(a)
  return html`<div class="chat-attachments">
    ${images.length > 0 &&
    html`<div class=${'chat-images' + (images.length > 1 ? ' many' : '')}>
      ${images.map((a, i) => {
        const src = a.lokal || (a.pfad && fileUrl(a.pfad))
        const ratio = a.breite && a.hoehe ? `${a.breite} / ${a.hoehe}` : '4 / 3'
        return html`<button type="button" key=${a.pfad || i} class="chat-image" style=${{ aspectRatio: ratio }} onClick=${() => open(a)} aria-label=${t('Bild „{name}“ öffnen', { name: a.name })} title=${a.name}>
          ${src ? html`<img src=${src} alt=${a.name} loading="lazy" />` : html`<span class="chat-image-wait"><${Icon} name="paperclip" size=${18} /><span>${a.name}</span></span>`}
        </button>`
      })}
    </div>`}
    ${others.map(
      (a, i) => html`<button type="button" key=${a.pfad || 'f' + i} class="chat-file" onClick=${() => open(a)} title=${a.name}>
        <span class="chat-file-icon" aria-hidden="true"><${Icon} name="paperclip" size=${16} /></span>
        <span class="chat-file-name">${a.name}</span>
        ${a.groesse ? html`<span class="chat-file-size">${fmtSize(a.groesse)}</span>` : null}
      </button>`
    )}
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
    if (!text && !(m.anhaenge || []).length) return
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
    <textarea ref=${input.ref} aria-label=${t('Nachricht bearbeiten')} value=${input.text} onInput=${(e) => input.setText(e.target.value)} onKeyDown=${onKeyDown}></textarea>
    <div class="chat-edit-actions">
      <button type="button" class="btn btn-small" onClick=${onDone}>${t('Abbrechen')}</button>
      <button type="button" class="btn btn-small btn-primary" disabled=${!input.text.trim() && !(m.anhaenge || []).length} onClick=${save}>${t('Speichern')}</button>
    </div>
  </div>`
}

// ------------------------------------------------------------
// Dialoge: Kanal anlegen oder bearbeiten, neue Nachricht, Personen
// ------------------------------------------------------------
function PersonChecks({ people, value, onChange, idPrefix }) {
  const set = new Set(value)
  const toggle = (email) => onChange(set.has(email) ? value.filter((e) => e !== email) : [...value, email])
  if (!people.length) return html`<p class="muted">${t('Niemand zur Auswahl.')}</p>`
  return html`<ul class="chat-people">
    ${people.map(
      (p) => html`<li key=${p.email}>
        <label for=${idPrefix + p.email}>
          <input type="checkbox" id=${idPrefix + p.email} checked=${set.has(p.email)} onChange=${() => toggle(p.email)} />
          <${Avatar} email=${p.email} name=${p.name} />
          <span>${p.name}${p.guest ? html` <span class="muted">${t('(Gast)')}</span>` : ''}</span>
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
        toast(t('Kanal gespeichert.'))
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
      toast(room.archiviert ? t('Kanal wieder aktiv.') : t('Kanal archiviert. Lesen geht weiter.'))
    } catch (err) {
      toast(chatErrorText(err), { error: true })
    }
    setBusy(false)
  }
  return html`<${Modal} title=${room ? t('Kanal bearbeiten') : t('Neuer Kanal')} onClose=${closeDialog}>
    <form onSubmit=${submit}>
      <${Field} label=${t('Name')} htmlFor="chat-kanal-name">
        <input id="chat-kanal-name" maxlength="80" value=${name} onInput=${(e) => setName(e.target.value)} placeholder=${t('zum Beispiel Messe Hamburg')} />
      <//>
      <${Field} label=${t('Beschreibung (optional)')} htmlFor="chat-kanal-text">
        <input id="chat-kanal-text" maxlength="500" value=${beschreibung} onInput=${(e) => setBeschreibung(e.target.value)} />
      <//>
      <${Field} label=${t('Wer ist dabei?')}>
        <${Segmented}
          label=${t('Wer ist dabei?')}
          value=${offen}
          onChange=${setOffen}
          options=${[
            { value: true, label: t('Offen fürs Team') },
            { value: false, label: t('Nur auf Einladung') },
          ]}
        />
      <//>
      <p class="muted chat-dialog-hint">
        ${offen
          ? t('Alle im Team lesen und schreiben mit. Gäste nur, wenn du sie einlädst.')
          : t('Nur eingeladene Personen und die Admins sehen den Kanal.')}
      </p>
      ${!room &&
      html`<${Field} label=${offen ? t('Gäste einladen (optional)') : t('Personen einladen')}>
        <${PersonChecks} people=${offen ? guestPeople() : [...teamPeople(), ...guestPeople()]} value=${people} onChange=${setPeople} idPrefix="chat-kanal-p-" />
      <//>`}
      <div class="form-actions">
        ${room && html`<button type="button" class="btn" disabled=${busy} onClick=${archive}>${room.archiviert ? t('Wieder aktivieren') : t('Archivieren')}</button>`}
        <button type="button" class="btn" onClick=${closeDialog}>${t('Abbrechen')}</button>
        <button type="submit" class="btn btn-primary" disabled=${!name.trim() || busy}>${room ? t('Speichern') : t('Anlegen')}</button>
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
  return html`<${Modal} title=${t('Neue Nachricht')} onClose=${closeDialog}>
    <form onSubmit=${submit}>
      <p class="muted chat-dialog-hint">${t('Eine Person: Direktnachricht. Mehrere: Gruppe. Lesen können nur die Beteiligten, auch kein Admin.')}</p>
      <${Field} label=${t('An wen?')}>
        <${PersonChecks} people=${teamPeople()} value=${people} onChange=${setPeople} idPrefix="chat-neu-p-" />
      <//>
      ${people.length > 1 &&
      html`<${Field} label=${t('Name der Gruppe (optional)')} htmlFor="chat-neu-name">
        <input id="chat-neu-name" maxlength="80" value=${name} onInput=${(e) => setName(e.target.value)} />
      <//>`}
      <div class="form-actions">
        <button type="button" class="btn" onClick=${closeDialog}>${t('Abbrechen')}</button>
        <button type="submit" class="btn btn-primary" disabled=${!people.length || busy}>${people.length > 1 ? t('Gruppe anlegen') : t('Schreiben')}</button>
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
        toast(room.art === 'kanal' && room.offen ? t('Du hast den Kanal verlassen. Er bleibt für dich lesbar, weil er offen ist.') : t('Du bist nicht mehr dabei.'))
        if (!(room.art === 'kanal' && (room.offen || isAdmin()))) navigate('/chat')
      }
    )
  return html`<${Modal} title=${t('Personen in {room}', { room: roomTitle(room) })} onClose=${closeDialog}>
    ${room.art === 'kanal' && room.offen && html`<p class="muted chat-dialog-hint">${t('Offener Kanal: Alle im Team lesen mit. Hier stehen die, die beigetreten sind oder eingeladen wurden.')}</p>`}
    <ul class="chat-members">
      ${members.map(
        (e) => html`<li key=${e}>
          <${Avatar} email=${e} />
          <span>${memberName(e)}${e === self ? ' ' + t('(du)') : ''}${e === norm(room.created_by) && room.art === 'kanal' ? html` <span class="muted">· ${t('hat den Kanal angelegt')}</span>` : ''}</span>
          ${e !== self && canRemoveOthers && html`<button type="button" class="btn btn-small" disabled=${busy} onClick=${() => run(() => removeMember(room.id, e))}>${t('Entfernen')}</button>`}
        </li>`
      )}
    </ul>
    ${canAdd && candidates.length > 0 &&
    html`<${Field} label=${t('Hinzufügen')}>
        <${PersonChecks} people=${candidates} value=${adding} onChange=${setAdding} idPrefix="chat-add-p-" />
      <//>
      <div class="form-actions">
        <button type="button" class="btn btn-primary" disabled=${!adding.length || busy} onClick=${() => run(() => addMembers(room.id, adding), () => setAdding([]))}>${t('Hinzufügen')}</button>
      </div>`}
    <div class="form-actions">
      ${members.includes(self) && html`<button type="button" class="btn" disabled=${busy} onClick=${leave}>${room.art === 'kanal' ? t('Kanal verlassen') : t('Gruppe verlassen')}</button>`}
      ${room.art === 'kanal' && room.offen && !members.includes(self) && !guest &&
      html`<button type="button" class="btn" disabled=${busy} onClick=${() => run(() => addMembers(room.id, [self]))}>${t('Beitreten')}</button>`}
      <button type="button" class="btn btn-primary" onClick=${closeDialog}>${t('Fertig')}</button>
    </div>
  <//>`
}

export const chatDialogs = { 'chat-kanal': ChannelDialog, 'chat-neu': NewTalkDialog, 'chat-personen': PeopleDialog }
