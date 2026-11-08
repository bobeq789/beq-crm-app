// Kacheln der Übersicht anordnen (Gesamtprompt Fassung 6, Nachträge „Kacheln“ und „Kacheln direkt
// ziehen“ vom 08.11.2026, B2). Jede Person ordnet selbst an, gespeichert in
// nutzer_einstellungen.werte.kacheln als { reihe: [Kachel-IDs], breit: [IDs der linken, breiten
// Spalte] }, gilt auf allen Geräten. Leer (null) heißt Standard. Unbekannte IDs fallen weg, neue
// Kacheln hängen sich hinten an.
//
// Zwei Wege:
// - „Anordnen“: schmale Leisten, am Rechner zwei Spalten mit HTML-Drag-and-Drop und Pfeilen
//   (↑ ↓ in der Spalte, ← → wechselt die Spalte), am Handy eine Reihe mit ↑ ↓. Für Tastatur
//   und Bildschirmleser.
// - Direkt am Kopf ziehen, in der normalen Ansicht und am Handy, mit Pointer-Ereignissen (HTML-Drag
//   geht am iPhone nicht). Mit der Maus der ganze Kopf außer Knöpfen und Links, mit dem Finger nur
//   der Griff, damit ein Wisch über den Titel weiter die Seite scrollt.
import { html, useState, useEffect, useRef } from '../lib/preact.js'
import { Icon } from '../lib/icons.js'

// Feste IDs, nicht die angezeigten Namen (sonst geht eine gespeicherte Anordnung verloren)
export const TILE_DEFAULT = { reihe: ['aufgaben', 'team', 'termine', 'wiedervorlagen', 'meetings'], breit: ['aufgaben'] }

// Gespeicherte Anordnung auf die Kacheln anwenden, die es für diese Person gerade gibt
export function tileLayout(saved, available) {
  const base = saved && Array.isArray(saved.reihe) ? saved : TILE_DEFAULT
  const reihe = base.reihe.filter((id, i, all) => available.includes(id) && all.indexOf(id) === i)
  available.forEach((id) => {
    if (!reihe.includes(id)) reihe.push(id)
  })
  const breit = (Array.isArray(base.breit) ? base.breit : []).filter((id) => reihe.includes(id))
  return { reihe, breit }
}

const inWide = (layout, id) => layout.breit.includes(id)
const columnOf = (layout, wide) => layout.reihe.filter((id) => inWide(layout, id) === wide)

// Kachel verschieben. target: { id, before } (vor oder nach einer Kachel) oder { col: 'breit' |
// 'schmal' } (ans Ende der Spalte). Am Handy (eine Reihe) bleibt „breit“ unverändert.
export function moveTile(layout, id, target, oneColumn = false) {
  const reihe = layout.reihe.filter((x) => x !== id)
  const breit = new Set(layout.breit)
  if (target.col) {
    if (!oneColumn) target.col === 'breit' ? breit.add(id) : breit.delete(id)
    const col = oneColumn ? reihe : reihe.filter((x) => breit.has(x) === (target.col === 'breit'))
    const last = col[col.length - 1]
    reihe.splice(last ? reihe.indexOf(last) + 1 : reihe.length, 0, id)
  } else {
    if (!oneColumn) breit.has(target.id) ? breit.add(id) : breit.delete(id)
    reihe.splice(reihe.indexOf(target.id) + (target.before ? 0 : 1), 0, id)
  }
  return { reihe, breit: layout.reihe.filter((x) => breit.has(x)) }
}

// Pfeile: zwei Nachbarn derselben Spalte in der Gesamtreihe tauschen (am Handy die ganze Reihe),
// ← → wechselt die Spalte und hängt die Kachel dort hinten an
export function arrowMove(layout, id, dir, oneColumn = false) {
  if (dir === 'left' || dir === 'right') return moveTile(layout, id, { col: dir === 'left' ? 'breit' : 'schmal' })
  const col = oneColumn ? layout.reihe : columnOf(layout, inWide(layout, id))
  const i = col.indexOf(id)
  const other = col[dir === 'up' ? i - 1 : i + 1]
  if (!other) return layout
  const reihe = [...layout.reihe]
  const a = reihe.indexOf(id)
  const b = reihe.indexOf(other)
  reihe[a] = other
  reihe[b] = id
  return { reihe, breit: layout.breit }
}

// ------------------------------------------------------------
// „Anordnen“: Leisten mit Drag-and-Drop (Rechner) und Pfeilen
// ------------------------------------------------------------
export function ArrangeView({ layout, names, oneColumn, custom, onChange, onReset, onDone }) {
  const [over, setOver] = useState(null)
  const dragId = useRef(null)
  const drop = (target) => {
    const id = dragId.current
    dragId.current = null
    setOver(null)
    if (id && !(target.id === id)) onChange(moveTile(layout, id, target, oneColumn))
  }
  const bar = (id, wide) => {
    const col = oneColumn ? layout.reihe : columnOf(layout, wide)
    const i = col.indexOf(id)
    const name = names[id]
    const mark = over && over.id === id ? (over.before ? ' drop-before' : ' drop-after') : ''
    return html`<li
      key=${id}
      class=${'arrange-bar' + mark}
      draggable=${!oneColumn}
      onDragStart=${(e) => {
        dragId.current = id
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', id)
      }}
      onDragEnd=${() => setOver(null)}
      onDragOver=${(e) => {
        e.preventDefault()
        e.stopPropagation()
        const r = e.currentTarget.getBoundingClientRect()
        const before = e.clientY < r.top + r.height / 2
        if (!over || over.id !== id || over.before !== before) setOver({ id, before })
      }}
      onDrop=${(e) => {
        e.preventDefault()
        e.stopPropagation()
        drop({ id, before: e.clientY < e.currentTarget.getBoundingClientRect().top + e.currentTarget.getBoundingClientRect().height / 2 })
      }}
    >
      ${!oneColumn && html`<span class="arrange-grip" aria-hidden="true"><${Icon} name="grip" size=${18} /></span>`}
      <span class="arrange-name">${name}</span>
      <span class="arrange-arrows">
        <button type="button" class="icon-btn small" disabled=${i === 0} aria-label=${`„${name}“ nach oben`} onClick=${() => onChange(arrowMove(layout, id, 'up', oneColumn))}><${Icon} name="up" size=${16} /></button>
        <button type="button" class="icon-btn small" disabled=${i === col.length - 1} aria-label=${`„${name}“ nach unten`} onClick=${() => onChange(arrowMove(layout, id, 'down', oneColumn))}><${Icon} name="down" size=${16} /></button>
        ${!oneColumn &&
        (wide
          ? html`<button type="button" class="icon-btn small" aria-label=${`„${name}“ in die rechte Spalte`} onClick=${() => onChange(arrowMove(layout, id, 'right'))}><${Icon} name="arrowRight" size=${16} /></button>`
          : html`<button type="button" class="icon-btn small" aria-label=${`„${name}“ in die linke, breite Spalte`} onClick=${() => onChange(arrowMove(layout, id, 'left'))}><${Icon} name="back" size=${16} /></button>`)}
      </span>
    </li>`
  }
  const column = (wide) => {
    const ids = columnOf(layout, wide)
    const colName = wide ? 'breit' : 'schmal'
    return html`<ul
      class=${'arrange-col' + (over && over.col === colName ? ' drop-end' : '')}
      aria-label=${wide ? 'Linke, breite Spalte' : 'Rechte Spalte'}
      onDragOver=${(e) => {
        e.preventDefault()
        if (!over || over.col !== colName) setOver({ col: colName })
      }}
      onDrop=${(e) => {
        e.preventDefault()
        drop({ col: colName })
      }}
    >
      ${ids.map((id) => bar(id, wide))}
      ${!ids.length && html`<li class="arrange-empty">Leere Spalte, Kachel hierher ziehen</li>`}
    </ul>`
  }
  return html`<section class="arrange" aria-label="Kacheln anordnen">
    <div class="arrange-head">
      <p class="muted small">${oneColumn ? 'Mit den Pfeilen ordnest du die Kacheln.' : 'Leisten ziehen oder die Pfeile nutzen.'} Du kannst Kacheln auch direkt am Griff im Kopf ziehen.</p>
      <div class="arrange-actions">
        ${custom && html`<button type="button" class="btn btn-small" onClick=${onReset}>Standard</button>`}
        <button type="button" class="btn btn-small btn-primary" onClick=${onDone}>Fertig</button>
      </div>
    </div>
    ${oneColumn
      ? html`<ul class="arrange-col" aria-label="Kacheln">${layout.reihe.map((id) => bar(id, inWide(layout, id)))}</ul>`
      : html`<div class="arrange-grid">${column(true)}${column(false)}</div>`}
  </section>`
}

// ------------------------------------------------------------
// Direkt am Kopf ziehen (Pointer-Ereignisse)
// ------------------------------------------------------------
const EDGE = 70
const START_PX = 6

// Liefert { start(id, event), dragging, target }. onDrop(id, target) bekommt das Ziel.
export function useTileDrag(onDrop) {
  const drag = useRef(null)
  const dropRef = useRef(onDrop)
  dropRef.current = onDrop
  const [dragging, setDragging] = useState(null)
  const [target, setTarget] = useState(null)

  useEffect(() => {
    let raf = 0
    const position = (d) => {
      d.slot.style.transform = `translate(${d.lastX - d.x}px, ${d.lastY - d.y + (window.scrollY - d.scroll)}px)`
    }
    // Ziel unter dem Zeiger: andere Kachel (obere Hälfte davor, untere danach) oder freie Fläche
    // einer Spalte (ans Ende). Die gezogene Kachel selbst wird übersprungen.
    const findTarget = (d) => {
      for (const el of document.elementsFromPoint(d.lastX, d.lastY)) {
        if (d.slot.contains(el)) continue
        const slot = el.closest && el.closest('.tile-slot')
        if (slot) {
          const r = slot.getBoundingClientRect()
          return { id: slot.dataset.tile, before: d.lastY < r.top + r.height / 2 }
        }
        const col = el.closest && el.closest('.ov-col')
        if (col) return { col: col.dataset.col }
      }
      // Unter der letzten Kachel einer Spalte (oder im Spalt dazwischen): die Spalte, in der der
      // Zeiger waagerecht steht, ans Ende
      const col = [...document.querySelectorAll('.ov-col')].find((c) => {
        const r = c.getBoundingClientRect()
        return d.lastX >= r.left && d.lastX <= r.right && d.lastY >= r.top
      })
      return col ? { col: col.dataset.col } : null
    }
    // Am Bildschirmrand scrollt die Seite mit
    const autoScroll = () => {
      const d = drag.current
      if (!d || !d.started) return
      const step = d.lastY < EDGE ? -12 : d.lastY > window.innerHeight - EDGE ? 12 : 0
      if (step) {
        window.scrollBy(0, step)
        position(d)
        const t = findTarget(d)
        d.target = t
        setTarget(t)
      }
      raf = requestAnimationFrame(autoScroll)
    }
    const finish = (commit) => {
      const d = drag.current
      drag.current = null
      cancelAnimationFrame(raf)
      if (!d || !d.started) return
      d.slot.style.transform = ''
      d.slot.classList.remove('tile-dragging')
      document.body.classList.remove('tiles-dragging')
      setDragging(null)
      setTarget(null)
      if (commit && d.target) dropRef.current(d.id, d.target)
    }
    const move = (e) => {
      const d = drag.current
      if (!d || e.pointerId !== d.pointerId) return
      d.lastX = e.clientX
      d.lastY = e.clientY
      if (!d.started) {
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < START_PX) return
        d.started = true
        d.slot.classList.add('tile-dragging')
        document.body.classList.add('tiles-dragging')
        setDragging(d.id)
        raf = requestAnimationFrame(autoScroll)
      }
      e.preventDefault()
      position(d)
      const t = findTarget(d)
      d.target = t
      setTarget(t)
    }
    const up = (e) => drag.current && e.pointerId === drag.current.pointerId && finish(true)
    const cancel = (e) => drag.current && e.pointerId === drag.current.pointerId && finish(false)
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      cancelAnimationFrame(raf)
    }
  }, [])

  // pointerdown am Kopf einer Kachel
  const start = (id, e) => {
    if (e.button) return
    const fromGrip = !!e.target.closest('.tile-grip')
    // Ohne Griff nur mit der Maus und nicht auf Knöpfen, Links und Feldern
    if (!fromGrip && (e.pointerType !== 'mouse' || e.target.closest('button, a, input, select, textarea, label'))) return
    const slot = e.currentTarget.closest('.tile-slot')
    if (!slot) return
    // Sonst beginnt der Browser selbst zu markieren oder zu ziehen und bricht das Ziehen ab (pointercancel)
    e.preventDefault()
    drag.current = { id, slot, pointerId: e.pointerId, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, scroll: window.scrollY, started: false, target: null }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // ohne Capture geht es auch, die Ereignisse kommen über window
    }
  }
  return { start, dragging, target }
}
