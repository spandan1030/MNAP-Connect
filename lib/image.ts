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

// ---- 4:5 crop (customer-app display) --------------------------------------
// Product photos are shown to customers at a fixed 4:5 portrait. We keep the
// original upload and derive a cropped 4:5 image (full + thumb) from it. The
// crop rect is stored normalized (0..1) so the cropper can reopen in place.

export type CropRect = { x: number; y: number; w: number; h: number }

export const CROP_RATIO = 4 / 5      // width / height (portrait)
const CROP_W = 1280                  // cropped full image, px
const CROP_H = 1600                  // = CROP_W / CROP_RATIO
const CROP_THUMB_W = 320             // cropped grid thumbnail, px
const CROP_THUMB_H = 400
const CROP_QUALITY = 0.85
const CROP_THUMB_QUALITY = 0.72

// The largest centered 4:5 rectangle that fits an imgW×imgH image, normalized.
export function centerCrop(imgW: number, imgH: number): CropRect {
  if (imgW <= 0 || imgH <= 0) return { x: 0, y: 0, w: 1, h: 1 }
  const imgRatio = imgW / imgH
  if (imgRatio > CROP_RATIO) {
    // too wide → full height, crop the sides
    const w = (CROP_RATIO * imgH) / imgW
    return { x: (1 - w) / 2, y: 0, w, h: 1 }
  }
  // too tall (or exact) → full width, crop top/bottom
  const h = (imgW / CROP_RATIO) / imgH
  return { x: 0, y: (1 - h) / 2, w: 1, h }
}

async function drawCrop(img: HTMLImageElement, crop: CropRect, outW: number, outH: number, quality: number, name: string): Promise<File | null> {
  const sx = crop.x * img.width
  const sy = crop.y * img.height
  const sw = crop.w * img.width
  const sh = crop.h * img.height
  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH)
  const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', quality))
  if (!blob) return null
  return new File([blob], `${name}.jpg`, { type: 'image/jpeg' })
}

// Render the 4:5 crop of a source (File or already-decoded image) into a full
// display image + a small thumbnail. When `crop` is omitted the largest centered
// 4:5 region is used. Returns null if the source can't be decoded.
export async function renderCrop(source: File | HTMLImageElement, crop?: CropRect | null): Promise<{ display: File; thumb: File } | null> {
  try {
    const img = source instanceof HTMLImageElement ? source : await loadImage(source)
    const base = source instanceof HTMLImageElement ? 'photo' : (source.name.replace(/\.[^.]+$/, '') || 'photo')
    const rect = crop ?? centerCrop(img.width, img.height)
    const display = await drawCrop(img, rect, CROP_W, CROP_H, CROP_QUALITY, `${base}-4x5`)
    const thumb = await drawCrop(img, rect, CROP_THUMB_W, CROP_THUMB_H, CROP_THUMB_QUALITY, `${base}-4x5-thumb`)
    if (!display || !thumb) return null
    return { display, thumb }
  } catch {
    return null
  }
}
