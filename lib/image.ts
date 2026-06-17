// Client-side image downscale + re-encode to JPEG before upload.
// Phone-camera photos are often several MB (and sometimes HEIC); this keeps
// uploads fast and well within storage limits. We produce two sizes: a full
// image for detail/preview/share, and a small thumbnail for the grid so the
// catalogue stays light at thousands of products. Falls back to the original
// file if the browser can't decode it.

const MAX_DIM = 1600        // full image, longest edge, px
const JPEG_QUALITY = 0.82
const THUMB_DIM = 320       // grid thumbnail, longest edge, px
const THUMB_QUALITY = 0.7

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')) }
    img.src = url
  })
}

async function resize(img: HTMLImageElement, maxDim: number, quality: number, name: string): Promise<File | null> {
  let { width, height } = img
  if (Math.max(width, height) > maxDim) {
    const scale = maxDim / Math.max(width, height)
    width = Math.round(width * scale)
    height = Math.round(height * scale)
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, width, height)
  const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', quality))
  if (!blob) return null
  return new File([blob], `${name}.jpg`, { type: 'image/jpeg' })
}

export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  try {
    const img = await loadImage(file)
    const name = file.name.replace(/\.[^.]+$/, '') || 'photo'
    return (await resize(img, MAX_DIM, JPEG_QUALITY, name)) ?? file
  } catch {
    return file // browser couldn't decode (e.g. HEIC on Android) — upload original
  }
}

// Full image + small thumbnail in one decode pass. `thumb` is null if the
// browser couldn't decode the file (callers fall back to the full image).
export async function compressWithThumb(file: File): Promise<{ full: File; thumb: File | null }> {
  if (!file.type.startsWith('image/')) return { full: file, thumb: null }
  try {
    const img = await loadImage(file)
    const name = file.name.replace(/\.[^.]+$/, '') || 'photo'
    const full = (await resize(img, MAX_DIM, JPEG_QUALITY, name)) ?? file
    const thumb = await resize(img, THUMB_DIM, THUMB_QUALITY, `${name}-thumb`)
    return { full, thumb }
  } catch {
    return { full: file, thumb: null }
  }
}
