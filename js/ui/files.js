// Bereich „Dateien“ in der Aufgabe: Liste, Hinzufügen (am Handy auch Kamera und Fotos),
// Öffnen über einen signierten Link, Löschen nur für das Team
import { html, useState, useEffect, useRef } from '../lib/preact.js'
import { Icon } from '../lib/icons.js'
import { fmtRelative, fmtSize, displayFileName } from '../lib/util.js'
import { isGuest, listCardFiles, uploadCardFile, openCardFile, deleteCardFile, confirmDialog, toast } from '../store.js'

export function CardFiles({ card }) {
  const [files, setFiles] = useState(null)
  const [busy, setBusy] = useState([])
  const input = useRef(null)
  const guest = isGuest()

  const load = async () => setFiles(await listCardFiles(card.id))
  useEffect(() => {
    setFiles(null)
    load()
  }, [card.id])

  const add = async (list) => {
    const chosen = [...list]
    if (!chosen.length) return
    setBusy(chosen.map((f) => f.name))
    let ok = 0
    for (const f of chosen) if (await uploadCardFile(card.id, f)) ok++
    setBusy([])
    if (ok) toast(ok === 1 ? 'Datei hinzugefügt' : `${ok} Dateien hinzugefügt`)
    load()
  }

  const del = async (f) => {
    const name = displayFileName(f.path)
    const yes = await confirmDialog({ title: 'Datei löschen?', text: `„${name}“ ist danach für alle weg.`, confirmLabel: 'Löschen', danger: true })
    if (yes && (await deleteCardFile(f.path))) {
      toast('Datei gelöscht')
      load()
    }
  }

  return html`<section class="files">
    <div class="files-head">
      <h3 class="section-title">Dateien ${files && files.length > 0 && html`<span class="count">${files.length}</span>`}</h3>
      <button type="button" class="btn" onClick=${() => input.current && input.current.click()} disabled=${busy.length > 0}>
        <${Icon} name="paperclip" size=${16} /> Datei hinzufügen
      </button>
      <input
        ref=${input}
        type="file"
        multiple
        hidden
        aria-label="Datei auswählen"
        onChange=${(e) => {
          add(e.target.files)
          e.target.value = ''
        }}
      />
    </div>
    ${busy.length > 0 && html`<p class="muted small">Wird hochgeladen: ${busy.join(', ')} …</p>`}
    ${files === null
      ? html`<p class="muted small">Wird geladen …</p>`
      : files.length === 0
        ? html`<p class="muted small">Noch keine Dateien. Angebote, Präsentationen oder Fotos vom Handy, bis 25 MB je Datei.</p>`
        : html`<ul class="file-list">
            ${files.map(
              (f) => html`<li key=${f.path}>
                <button type="button" class="file-open" onClick=${() => openCardFile(f.path)} title="Öffnen">
                  <${Icon} name="paperclip" size=${16} />
                  <span class="file-name">${displayFileName(f.path)}</span>
                </button>
                <span class="muted small file-meta">${fmtSize(f.size)}${f.size != null ? ' · ' : ''}${fmtRelative(f.created_at)}</span>
                ${!guest &&
                html`<button type="button" class="icon-btn small" aria-label=${'„' + displayFileName(f.path) + '“ löschen'} onClick=${() => del(f)}>
                  <${Icon} name="trash" size=${16} />
                </button>`}
              </li>`
            )}
          </ul>`}
  </section>`
}
