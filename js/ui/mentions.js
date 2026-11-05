// @Erwähnungen in Notizen: wer erwähnt werden kann, Erkennen beim Speichern,
// Hervorheben in der Notiz. Alles als Text, nie als HTML.
import { html } from '../lib/preact.js'
import { splitLinks, norm } from '../lib/util.js'
import { state, myEmail, isGuest, getCard, guestSeesCard, memberName } from '../store.js'

const LETTER = /[\p{L}\p{N}]/u

function firstNameOf(name) {
  return String(name || '').replace(/^(Dr\.|Prof\.)\s+/i, '').split(/\s+/)[0] || ''
}

// Kürzester eindeutiger Name je Person: Vorname, bei gleichem Vornamen der volle Name
export function withLabels(people) {
  const count = new Map()
  people.forEach((p) => count.set(norm(firstNameOf(p.name)), (count.get(norm(firstNameOf(p.name))) || 0) + 1))
  return people.map((p) => ({ ...p, label: count.get(norm(firstNameOf(p.name))) > 1 ? p.name : firstNameOf(p.name) }))
}

// Wer an dieser Karte erwähnt werden kann.
// buttons: Knöpfe unter dem Notizfeld (Team und Gäste, die die Karte sehen).
// all: was beim Tippen zählt (für Teammitglieder auch Gäste, die die Karte noch
// nicht sehen, sie bekommen sie dann geteilt). Gäste erwähnen nur das Team.
export function mentionPeople(cardId) {
  const card = getCard(cardId)
  const me = norm(myEmail())
  const guestMode = isGuest()
  const people = state.db.team_members
    .filter((t) => t.active && norm(t.email) !== me && (!guestMode || t.role !== 'gast'))
    .map((t) => ({ email: t.email.toLowerCase(), name: t.name, guest: t.role === 'gast' }))
    .sort((a, b) => Number(a.guest) - Number(b.guest) || a.name.localeCompare(b.name, 'de'))
  const all = withLabels(people)
  const buttons = all.filter((p) => !p.guest || (card && guestSeesCard(card, p.email)))
  return { all, buttons }
}

// „@Vorname“ bzw. „@Vorname Nachname“ im Text finden. Bei doppeltem Vornamen zählt nur
// der volle Name. Nach dem Namen darf kein Buchstabe folgen („@Annabell“ ist nicht Anna).
export function parseMentions(text, people) {
  const t = String(text || '')
  const lower = t.toLocaleLowerCase('de')
  const found = new Set()
  people.forEach((p) => {
    const variants = p.label === p.name ? [p.name] : [p.label, p.name]
    variants.forEach((v) => {
      const needle = '@' + v.toLocaleLowerCase('de')
      let i = lower.indexOf(needle)
      while (i !== -1) {
        const next = t.charAt(i + needle.length)
        if (!next || !LETTER.test(next)) found.add(p.email)
        i = lower.indexOf(needle, i + 1)
      }
    })
  })
  return [...found]
}

// Notiztext mit hervorgehobenen Erwähnungen und klickbaren Links
export function NoteText({ text, mentions }) {
  const names = []
  ;(mentions || []).forEach((m) => {
    const full = memberName(m)
    if (full && full !== m) names.push(full, firstNameOf(full))
  })
  if (!names.length) return html`<span class="linktext">${linkParts(text)}</span>`
  // Längere Namen zuerst, damit „@Anna Berger“ vor „@Anna“ greift
  const sorted = [...new Set(names)].sort((a, b) => b.length - a.length)
  const parts = []
  const t = String(text || '')
  const lower = t.toLocaleLowerCase('de')
  let pos = 0
  while (pos < t.length) {
    let hit = null
    let at = t.indexOf('@', pos)
    while (at !== -1 && !hit) {
      for (const n of sorted) {
        const end = at + 1 + n.length
        if (lower.slice(at + 1, end) === n.toLocaleLowerCase('de') && !LETTER.test(t.charAt(end))) {
          hit = { at, end }
          break
        }
      }
      if (!hit) at = t.indexOf('@', at + 1)
    }
    if (!hit) {
      parts.push(...linkParts(t.slice(pos)))
      break
    }
    if (hit.at > pos) parts.push(...linkParts(t.slice(pos, hit.at)))
    parts.push(html`<strong class="mention">${t.slice(hit.at, hit.end)}</strong>`)
    pos = hit.end
  }
  return html`<span class="linktext">${parts}</span>`
}

function linkParts(text) {
  return splitLinks(text).map((p) =>
    typeof p === 'string' ? p : html`<a href=${p.href} target="_blank" rel="noopener noreferrer">${p.text}</a>`
  )
}
