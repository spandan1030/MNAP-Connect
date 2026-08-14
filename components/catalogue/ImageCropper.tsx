'use client'

import { useEffect, useRef, useState } from 'react'
import { CROP_RATIO, rotateImageToCanvas, loadWatermark, type CropRect, type Rotation, type LogoPlacement } from '@/lib/image'

// Fixed-4:5 cropper. The frame is fixed; the user pans/zooms (and can rotate) the
// image behind it, and whatever fills the frame becomes the crop (Instagram-style).
// Rotation is baked into a working image for preview + crop math; on confirm we hand
// back the ORIGINAL image plus the chosen `rotate` so renderCrop reproduces it.
// Source is a File (new upload) or an image URL (existing photo).

const FRAME_W = 300
const FRAME_H = Math.round(FRAME_W / CROP_RATIO) // 375
const MAX_ZOOM = 4
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

// Last-used watermark placement is remembered so it stays consistent across photos.
const LOGO_KEY = 'mnap_crop_logo'
const DEFAULT_LOGO: LogoPlacement = { cx: 0.5, cy: 0.9, scale: 0.32, opacity: 1 }
function readLogoPref(): { on: boolean; cfg: LogoPlacement } {
  if (typeof window === 'undefined') return { on: false, cfg: DEFAULT_LOGO }
  try {
    const raw = window.localStorage.getItem(LOGO_KEY)
    if (raw) { const j = JSON.parse(raw); return { on: !!j.on, cfg: { ...DEFAULT_LOGO, ...(j.cfg ?? {}) } } }
  } catch { /* ignore */ }
  return { on: false, cfg: DEFAULT_LOGO }
}

// Draw `base` rotated by `deg` and decode it back into an <img> for display + math.
function loadRotated(base: HTMLImageElement, deg: number): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (!(deg % 360)) { resolve(base); return }
    const canvas = rotateImageToCanvas(base, deg)
    if (!canvas) { reject(new Error('rotate failed')); return }
    try {
      const im = new Image()
      im.onload = () => resolve(im)
      im.onerror = () => reject(new Error('rotate failed'))
      im.src = canvas.toDataURL('image/jpeg', 0.92)
    } catch { reject(new Error('rotate failed')) }
  })
}

export default function ImageCropper({
  source, initial, onConfirm, onCancel,
}: {
  source: File | string
  initial?: CropRect | null
  onConfirm: (crop: CropRect, img: HTMLImageElement) => void
  onCancel: () => void
}) {
  const [baseImg, setBaseImg] = useState<HTMLImageElement | null>(null) // original, unrotated
  const [img, setImg] = useState<HTMLImageElement | null>(null)         // working (rotated) preview
  const [rotate, setRotate] = useState<Rotation>(0)
  const [err, setErr] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [off, setOff] = useState({ tx: 0, ty: 0 }) // image top-left within the frame, px
  const drag = useRef<{ x: number; y: number } | null>(null)

  // Watermark overlay
  const [logoImg, setLogoImg] = useState<HTMLImageElement | null>(null)
  const [logoOn, setLogoOn]   = useState(false)
  const [logo, setLogo]       = useState<LogoPlacement>(DEFAULT_LOGO)
  const logoDrag = useRef<{ x: number; y: number } | null>(null)

  const baseScale = img ? Math.max(FRAME_W / img.width, FRAME_H / img.height) : 1
  const scale = baseScale * zoom
  const dispW = img ? img.width * scale : 0
  const dispH = img ? img.height * scale : 0

  function clamp(tx: number, ty: number, w: number, h: number) {
    return {
      tx: Math.min(0, Math.max(FRAME_W - w, tx)),
      ty: Math.min(0, Math.max(FRAME_H - h, ty)),
    }
  }

  // Load the source (crossOrigin for URLs so the canvas isn't tainted on render).
  useEffect(() => {
    let objUrl: string | null = null
    const el = new Image()
    if (typeof source === 'string') el.crossOrigin = 'anonymous'
    el.onload = async () => {
      setBaseImg(el)
      const r0 = (initial?.rotate ?? 0) as Rotation
      let working = el
      let applied: Rotation = 0
      try { working = await loadRotated(el, r0); applied = r0 } catch { working = el; applied = 0 }
      const bs = Math.max(FRAME_W / working.width, FRAME_H / working.height)
      if (initial && initial.w > 0) {
        const s = FRAME_W / (initial.w * working.width)
        const w = working.width * s, h = working.height * s
        setZoom(Math.min(MAX_ZOOM, Math.max(1, s / bs)))
        setOff(clamp(-initial.x * working.width * s, -initial.y * working.height * s, w, h))
      } else {
        const w = working.width * bs, h = working.height * bs
        setOff(clamp((FRAME_W - w) / 2, (FRAME_H - h) / 2, w, h))
      }
      setRotate(applied)
      setImg(working)
    }
    el.onerror = () => setErr(true)
    if (typeof source === 'string') el.src = source
    else { objUrl = URL.createObjectURL(source); el.src = objUrl }
    return () => { if (objUrl) URL.revokeObjectURL(objUrl) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load the watermark + seed the logo placement (from this photo's saved crop, else the
  // remembered last-used placement). Runs once.
  useEffect(() => {
    loadWatermark().then(setLogoImg)
    const pref = readLogoPref()
    if (initial && 'logo' in initial) {
      setLogoOn(!!initial.logo)
      setLogo(initial.logo ?? pref.cfg)
    } else {
      setLogoOn(pref.on)
      setLogo(pref.cfg)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Drag the watermark within the frame (separate from image panning).
  function onLogoDown(e: React.PointerEvent) {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    logoDrag.current = { x: e.clientX, y: e.clientY }
  }
  function onLogoMove(e: React.PointerEvent) {
    if (!logoDrag.current) return
    e.stopPropagation()
    const dx = (e.clientX - logoDrag.current.x) / FRAME_W
    const dy = (e.clientY - logoDrag.current.y) / FRAME_H
    logoDrag.current = { x: e.clientX, y: e.clientY }
    setLogo(l => ({ ...l, cx: clamp01(l.cx + dx), cy: clamp01(l.cy + dy) }))
  }
  function onLogoUp(e: React.PointerEvent) {
    e.stopPropagation()
    logoDrag.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
  }

  // Rotate 90° clockwise: rebuild the working image and re-centre (rotation changes framing).
  async function rotate90() {
    if (!baseImg) return
    const next = (((rotate + 90) % 360)) as Rotation
    let working: HTMLImageElement
    try { working = await loadRotated(baseImg, next) } catch { return } // rotation unavailable → leave as-is
    const bs = Math.max(FRAME_W / working.width, FRAME_H / working.height)
    const w = working.width * bs, h = working.height * bs
    setRotate(next)
    setImg(working)
    setZoom(1)
    setOff(clamp((FRAME_W - w) / 2, (FRAME_H - h) / 2, w, h))
  }

  function onPointerDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY }
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current || !img) return
    const dx = e.clientX - drag.current.x
    const dy = e.clientY - drag.current.y
    drag.current = { x: e.clientX, y: e.clientY }
    setOff(o => clamp(o.tx + dx, o.ty + dy, dispW, dispH))
  }
  function onPointerUp(e: React.PointerEvent) {
    drag.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
  }

  function onZoom(z: number) {
    if (!img) { setZoom(z); return }
    const oldScale = baseScale * zoom
    const newScale = baseScale * z
    // keep the image point under the frame centre fixed
    const cx = (FRAME_W / 2 - off.tx) / oldScale
    const cy = (FRAME_H / 2 - off.ty) / oldScale
    const w = img.width * newScale, h = img.height * newScale
    setZoom(z)
    setOff(clamp(FRAME_W / 2 - cx * newScale, FRAME_H / 2 - cy * newScale, w, h))
  }

  function confirm() {
    if (!img || !baseImg) return
    // Crop is normalized to the ROTATED image; `rotate` + the ORIGINAL image go back so
    // renderCrop rotates then crops (matching both the new-upload and re-crop paths).
    const crop: CropRect = {
      x: Math.max(0, Math.min(1, -off.tx / dispW)),
      y: Math.max(0, Math.min(1, -off.ty / dispH)),
      w: Math.min(1, FRAME_W / dispW),
      h: Math.min(1, FRAME_H / dispH),
      rotate,
      logo: logoOn ? logo : null,
    }
    // Remember this placement (and on/off) as the default for the next photo.
    try { window.localStorage.setItem(LOGO_KEY, JSON.stringify({ on: logoOn, cfg: logo })) } catch { /* ignore */ }
    onConfirm(crop, baseImg)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl p-4 w-full max-w-sm mx-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 text-sm">Crop to 4:5</h3>
          <button onClick={onCancel} className="text-gray-400 text-xl leading-none">×</button>
        </div>

        {err ? (
          <p className="text-sm text-red-600 py-8 text-center">Couldn’t load this image.</p>
        ) : (
          <>
            <div className="flex justify-center">
              <div
                className="relative overflow-hidden rounded-lg bg-gray-900 touch-none select-none cursor-move"
                style={{ width: FRAME_W, height: FRAME_H }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              >
                {img && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={img.src}
                    alt=""
                    draggable={false}
                    className="absolute max-w-none pointer-events-none"
                    style={{ left: off.tx, top: off.ty, width: dispW, height: dispH }}
                  />
                )}
                {/* rule-of-thirds guides */}
                <div className="absolute inset-0 pointer-events-none">
                  <div className="absolute top-1/3 inset-x-0 h-px bg-white/30" />
                  <div className="absolute top-2/3 inset-x-0 h-px bg-white/30" />
                  <div className="absolute left-1/3 inset-y-0 w-px bg-white/30" />
                  <div className="absolute left-2/3 inset-y-0 w-px bg-white/30" />
                  <div className="absolute inset-0 ring-1 ring-white/60 rounded-lg" />
                </div>
                {/* watermark overlay — drag to place */}
                {logoOn && logoImg && (() => {
                  const lw = logo.scale * FRAME_W
                  const lh = lw * (logoImg.height / logoImg.width)
                  return (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={logoImg.src}
                      alt=""
                      draggable={false}
                      onPointerDown={onLogoDown}
                      onPointerMove={onLogoMove}
                      onPointerUp={onLogoUp}
                      onPointerCancel={onLogoUp}
                      className="absolute touch-none cursor-move ring-1 ring-white/40"
                      style={{ left: logo.cx * FRAME_W - lw / 2, top: logo.cy * FRAME_H - lh / 2, width: lw, opacity: logo.opacity }}
                    />
                  )
                })()}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button onClick={rotate90} disabled={!img} title="Rotate 90°"
                className="flex items-center gap-1 text-xs font-medium text-gray-600 border border-gray-300 rounded-lg px-2.5 py-1.5 active:bg-gray-50 disabled:opacity-50">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M4 9a9 9 0 108-5" />
                </svg>
                Rotate
              </button>
              <span className="text-xs text-gray-400">Zoom</span>
              <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={zoom}
                onChange={e => onZoom(Number(e.target.value))}
                className="flex-1 accent-green-600" />
            </div>

            {/* Watermark controls */}
            <div className="space-y-2 border-t border-gray-100 pt-3">
              <button onClick={() => setLogoOn(o => !o)} disabled={!logoImg}
                className={`w-full flex items-center justify-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-2 border transition-colors disabled:opacity-50 ${
                  logoOn ? 'bg-green-50 text-green-700 border-green-300' : 'bg-white text-gray-600 border-gray-300'
                }`}>
                {logoImg ? (logoOn ? '✓ Logo on — drag it to place' : '+ Add logo') : 'Add watermark.png to public/ to enable'}
              </button>
              {logoOn && logoImg && (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400 w-12 flex-shrink-0">Size</span>
                    <input type="range" min={0.1} max={0.8} step={0.01} value={logo.scale}
                      onChange={e => setLogo(l => ({ ...l, scale: Number(e.target.value) }))}
                      className="flex-1 accent-green-600" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400 w-12 flex-shrink-0">Opacity</span>
                    <input type="range" min={0.2} max={1} step={0.01} value={logo.opacity}
                      onChange={e => setLogo(l => ({ ...l, opacity: Number(e.target.value) }))}
                      className="flex-1 accent-green-600" />
                  </div>
                </>
              )}
            </div>
            <p className="text-[11px] text-gray-400 text-center">Drag to reposition · Rotate to straighten{logoOn ? ' · drag the logo to place it' : ''} · this 4:5 area is what customers see.</p>

            <div className="flex gap-2">
              <button onClick={onCancel} className="btn-secondary flex-1">Cancel</button>
              <button onClick={confirm} disabled={!img} className="btn-primary flex-1 disabled:opacity-60">Use this crop</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
