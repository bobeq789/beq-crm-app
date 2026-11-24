// Bilder im Browser verkleinern (Profilfotos, 38_profilfotos.sql). Das Bild wird mittig
// quadratisch zugeschnitten und als JPEG neu gezeichnet. Dabei fallen alle Zusatzdaten weg
// (zum Beispiel Aufnahmeort und Kamera), nur die Pixel bleiben.
export async function squareJpeg(file, size = 256, quality = 0.85) {
  let source
  try {
    // createImageBitmap dreht Handyfotos nach ihrer Ausrichtung richtig herum
    source = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    source = await new Promise((resolve, reject) => {
      const img = new Image()
      const url = URL.createObjectURL(file)
      img.onload = () => (URL.revokeObjectURL(url), resolve(img))
      img.onerror = () => (URL.revokeObjectURL(url), reject(new Error('bild')))
      img.src = url
    })
  }
  const w = source.width || source.naturalWidth
  const h = source.height || source.naturalHeight
  if (!w || !h) throw new Error('bild')
  const side = Math.min(w, h)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, size, size)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size)
  if (source.close) source.close()
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  if (!blob) throw new Error('bild')
  return blob
}
