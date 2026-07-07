'use client'

import { useEffect, useRef, useState } from 'react'
import { CROP_RATIO, type CropRect } from '@/lib/image'

// Fixed-4:5 cropper. The frame is fixed; the user pans/zooms the image behind it,
// and whatever fills the frame becomes the crop (Instagram-style). Returns the
// normalized crop rect plus the decoded image so the caller can render without
// re-fetching. Source is a File (new upload) or an image URL (existing photo).

const FRAME_W = 300
const FRAME_H = Math.round(FRAME_W / CROP_RATIO) // 375
const MAX_ZOOM = 4

export default function ImageCropper({
  source, initial, onConfirm, onCancel,
}: {
  source: File | string
  initial?: CropRect | null
  onConfirm: (crop: CropRect, img: HTMLImageElement) => void
  onCancel: () => void
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [err, setErr] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [off, setOff] = useState({ tx: 0, ty: 0 }) // image top-left within the frame, px
  const drag = useRef<{ x: number; y: number } | null>(null)

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
    el.onload = () => {
      const bs = Math.max(FRAME_W / el.width, FRAME_H / el.height)
      if (initial && initial.w > 0) {
        const s = FRAME_W / (initial.w * el.width)
        const w = el.width * s, h = el.height * s
        setZoom(Math.min(MAX_ZOOM, Math.max(1, s / bs)))
        setOff(clamp(-initial.x * el.width * s, -initial.y * el.height * s, w, h))
      } else {
        const w = el.width * bs, h = el.height * bs
        setOff(clamp((FRAME_W - w) / 2, (FRAME_H - h) / 2, w, h))
      }
      setImg(el)
    }
    el.onerror = () => setErr(true)
    if (typeof source === 'string') el.src = source
    else { objUrl = URL.createObjectURL(source); el.src = objUrl }
    return () => { if (objUrl) URL.revokeObjectURL(objUrl) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    if (!img) return
    const crop: CropRect = {
      x: Math.max(0, Math.min(1, -off.tx / dispW)),
      y: Math.max(0, Math.min(1, -off.ty / dispH)),
      w: Math.min(1, FRAME_W / dispW),
      h: Math.min(1, FRAME_H / dispH),
    }
    onConfirm(crop, img)
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
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Zoom</span>
              <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={zoom}
                onChange={e => onZoom(Number(e.target.value))}
                className="flex-1 accent-green-600" />
            </div>
            <p className="text-[11px] text-gray-400 text-center">Drag to reposition · this 4:5 area is what customers see.</p>

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
