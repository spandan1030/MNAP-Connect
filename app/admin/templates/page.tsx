'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import Navbar from '@/components/ui/Navbar'
import { applyPlaceholders } from '@/lib/utils'
import { compressImage } from '@/lib/image'
import type { MessageTemplate } from '@/lib/types'

const CATEGORY_LABEL = {
  all: 'All', daily_rate: 'Daily rate', rate: 'Rate alert',
  offer: 'Offer', thankyou: 'Thank-you', walkin: 'Walk-in welcome', coupon: 'Coupon', custom: 'Custom',
} as const

const PLACEHOLDER_NAME = 'Priya Sharma'

const PLACEHOLDERS = [
  { tag: '{name}',       desc: 'Customer name',  varName: 'name' },
  { tag: '{rate_24kt}',  desc: '24KT / gram',    varName: 'rate_24kt' },
  { tag: '{rate_22kt}',  desc: '22KT / gram',    varName: 'rate_22kt' },
  { tag: '{rate_18kt}',  desc: '18KT / gram',    varName: 'rate_18kt' },
]

export default function TemplatesPage() {
  const supabase = createClient()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'daily_rate' | 'rate' | 'offer' | 'thankyou' | 'walkin' | 'coupon' | 'custom'>('all')
  const [loading, setLoading] = useState(true)

  // Form state
  const [formName, setFormName] = useState('')
  const [formBody, setFormBody] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  // Meta template fields
  const [metaName, setMetaName] = useState('')
  const [metaLang, setMetaLang] = useState('en')
  const [metaVars, setMetaVars] = useState('')   // comma-separated variable names
  const [headerType, setHeaderType] = useState<'none' | 'image'>('none')
  const [headerImageUrl, setHeaderImageUrl] = useState('')
  const [headerUploading, setHeaderUploading] = useState(false)
  const headerFileRef = useRef<HTMLInputElement>(null)
  const [showMetaSection, setShowMetaSection] = useState(false)
  // Reach suppression (wa_032)
  const [category, setCategory] = useState('custom')
  const [suppressionDays, setSuppressionDays] = useState(14)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const { data } = await supabase.from('wa_message_templates').select('*').order('created_at', { ascending: false })
    setTemplates(data ?? [])
    setLoading(false)
  }

  // Upload a header image to the public `wa-media` bucket and drop its public URL
  // into the field — so the store never has to leave the app to host an image.
  // Same bucket/path pattern as the catalogue uploader; compressed to keep it well
  // under Meta's ~5 MB header limit.
  async function onPickHeaderImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file after an error
    if (!file) return
    if (!file.type.startsWith('image/')) { setError('Please choose an image file (JPG or PNG).'); return }
    setError('')
    setHeaderUploading(true)
    try {
      const img = await compressImage(file)
      const path = `template-headers/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
      const { data: up, error: upErr } = await supabase.storage
        .from('wa-media').upload(path, img, { upsert: false, contentType: 'image/jpeg' })
      if (upErr || !up) { setError(`Upload failed: ${upErr?.message ?? 'unknown error'}`); return }
      const { data: { publicUrl } } = supabase.storage.from('wa-media').getPublicUrl(up.path)
      setHeaderImageUrl(publicUrl)
    } catch (err) {
      setError(`Upload failed: ${(err as Error).message}`)
    } finally {
      setHeaderUploading(false)
    }
  }

  function insertPlaceholder(tag: string) {
    const el = textareaRef.current
    if (!el) {
      setFormBody(prev => prev + tag)
      return
    }
    const start = el.selectionStart
    const end = el.selectionEnd
    const next = formBody.slice(0, start) + tag + formBody.slice(end)
    setFormBody(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + tag.length, start + tag.length)
    })
  }

  function startEdit(t: MessageTemplate) {
    setEditingId(t.id)
    setFormName(t.name)
    setFormBody(t.body_text)
    setMetaName(t.meta_template_name ?? '')
    setMetaLang(t.meta_template_lang ?? 'en')
    setMetaVars(t.meta_variables?.join(', ') ?? '')
    setHeaderType(t.header_type ?? 'none')
    setHeaderImageUrl(t.header_image_url ?? '')
    setCategory(t.category ?? 'custom')
    setSuppressionDays(t.suppression_days ?? 14)
    setShowMetaSection(!!(t.meta_template_name))
    setShowPreview(false)
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function resetForm() {
    setEditingId(null); setFormName(''); setFormBody('')
    setMetaName(''); setMetaLang('en'); setMetaVars(''); setHeaderType('none'); setHeaderImageUrl(''); setShowMetaSection(false)
    setCategory('custom'); setSuppressionDays(14)
    setError(''); setShowPreview(false)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!formName.trim() || !formBody.trim()) { setError('Name and message body are required.'); return }
    setSaving(true); setError('')
    const { data: { user } } = await supabase.auth.getUser()
    const parsedVars = metaVars.trim()
      ? metaVars.split(',').map(v => v.trim()).filter(Boolean)
      : null

    const payload = {
      name:               formName.trim(),
      topic_id:           null,   // templates are no longer topic-scoped; classified by Message type
      body_text:          formBody.trim(),
      created_by:         user!.id,
      meta_template_name: metaName.trim() || null,
      meta_template_lang: metaLang || 'en',
      meta_variables:     parsedVars,
      header_type:        headerType,
      header_image_url:   headerType === 'image' ? (headerImageUrl.trim() || null) : null,
      category:           category || 'custom',
      suppression_days:   category === 'daily_rate' ? 0 : Math.max(0, suppressionDays || 0),
    }
    if (editingId) {
      await supabase.from('wa_message_templates').update(payload).eq('id', editingId)
    } else {
      await supabase.from('wa_message_templates').insert(payload)
    }
    resetForm()
    setSaving(false)
    loadData()
  }

  async function toggleActive(t: MessageTemplate) {
    await supabase.from('wa_message_templates').update({ is_active: !t.is_active }).eq('id', t.id)
    loadData()
  }

  const filtered = templates.filter(t =>
    categoryFilter === 'all' ? true : (t.category ?? 'custom') === categoryFilter
  )

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-4 space-y-4">
        <h1 className="text-lg font-bold text-gray-900">Message Templates</h1>

        {/* Form */}
        <form onSubmit={handleSave} className="card p-4 space-y-3">
          <p className="text-sm font-semibold text-gray-700">{editingId ? 'Edit Template' : 'New Template'}</p>

          <input
            type="text"
            value={formName}
            onChange={e => setFormName(e.target.value)}
            className="input"
            placeholder="Template name (internal label)"
            required
          />

          {/* Message type — the single control that decides where a template is
              usable (thank-you broadcast, reach cohorts) and its resend guard.
              Not a customer-interest topic; it's what KIND of message this is. */}
          <div className="rounded-xl border border-gray-200 p-3 space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-700">Message type</label>
              <select
                value={category}
                onChange={e => {
                  const c = e.target.value
                  setCategory(c)
                  if (c === 'daily_rate') setSuppressionDays(0)
                  else if (suppressionDays === 0) setSuppressionDays(14)
                }}
                className="input text-sm"
              >
                <option value="custom">Custom / one-off</option>
                <option value="daily_rate">Daily rate (no resend guard)</option>
                <option value="rate">Rate alert</option>
                <option value="offer">Offer / promo</option>
                <option value="thankyou">Thank-you (used by the thank-you broadcast)</option>
                <option value="walkin">Walk-in welcome (auto-sent on new walk-in)</option>
                <option value="coupon">Coupon (used by the coupon / birthday module)</option>
              </select>
              <p className="text-[10px] text-gray-400">
                {category === 'thankyou'
                  ? 'Appears in the thank-you broadcast (Recent buyers, manual, and Invoices). A template used for invoice links must be a Utility template with a dynamic URL button ending in /i/{{1}}.'
                  : category === 'walkin'
                  ? "The active Walk-in welcome template is auto-sent the moment a walk-in is registered (Touch 0). Only ONE should be active at a time — the most recent wins. Use a Marketing template; lead with today's rate + fresh designs."
                  : category === 'coupon'
                  ? 'Used by the Coupon / birthday module to send codes. Add variables in order: name, coupon_code, offer, expiry. Use a Marketing template.'
                  : category === 'daily_rate'
                  ? 'Daily rate — always sends, never suppressed.'
                  : 'Available in Reach cohort sends.'}
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">
                Don&apos;t resend to the same number within
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  value={suppressionDays}
                  onChange={e => setSuppressionDays(Math.max(0, parseInt(e.target.value) || 0))}
                  disabled={category === 'daily_rate'}
                  className="input text-sm w-24 disabled:opacity-50"
                />
                <span className="text-xs text-gray-500">days</span>
              </div>
            </div>
          </div>

          {/* Placeholder chips */}
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">Tap to insert placeholder at cursor</p>
            <div className="flex flex-wrap gap-2">
              {PLACEHOLDERS.map(({ tag, desc }) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => insertPlaceholder(tag)}
                  className="flex flex-col items-start px-3 py-2 rounded-xl border border-green-200 bg-green-50 hover:bg-green-100 active:bg-green-200 transition-colors"
                >
                  <span className="text-xs font-mono font-semibold text-green-800">{tag}</span>
                  <span className="text-[10px] text-green-600 mt-0.5">{desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Textarea */}
          <div>
            <textarea
              ref={textareaRef}
              value={formBody}
              onChange={e => setFormBody(e.target.value)}
              className="input resize-none"
              rows={6}
              placeholder={'Hello {name}! Today\'s gold rates at MNAP:\n24KT: ₹{rate_24kt}/g | 22KT: ₹{rate_22kt}/g\n\nVisit us anytime!'}
              required
            />
          </div>

          {/* Meta / WhatsApp approved template section */}
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setShowMetaSection(s => !s)}
              className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
            >
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-green-600" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                  <path d="M12 0C5.373 0 0 5.373 0 12c0 2.096.544 4.066 1.497 5.777L0 24l6.385-1.473A11.955 11.955 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.848 0-3.58-.497-5.071-1.366l-.361-.214-3.742.862.934-3.628-.235-.374A9.96 9.96 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
                </svg>
                <span className="text-sm font-semibold text-gray-700">WhatsApp Approved Template</span>
                {metaName && (
                  <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Linked</span>
                )}
              </div>
              <span className="text-gray-400 text-base">{showMetaSection ? '−' : '+'}</span>
            </button>

            {showMetaSection && (
              <div className="px-4 py-4 space-y-4 bg-white">
                <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2.5 text-xs text-blue-700 space-y-1">
                  <p className="font-semibold">How to link a Meta-approved template:</p>
                  <ol className="list-decimal list-inside space-y-1 text-blue-600">
                    <li>Go to <strong>Meta Business Manager → WhatsApp → Message Templates</strong></li>
                    <li>Create a template using <code className="bg-blue-100 px-1 rounded">{'{{1}}'}</code>, <code className="bg-blue-100 px-1 rounded">{'{{2}}'}</code>… for variables</li>
                    <li>Wait for approval (usually 24–72 hrs)</li>
                    <li>Enter the exact template name below and map variables in order</li>
                  </ol>
                  <p className="mt-1 text-blue-600">Linked templates are used for <strong>Broadcast</strong> and work outside the 24-hour window.</p>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-500">Meta template name (exact)</label>
                  <input
                    type="text"
                    value={metaName}
                    onChange={e => setMetaName(e.target.value)}
                    className="input font-mono text-sm"
                    placeholder="e.g. daily_gold_rates"
                  />
                  <p className="text-[10px] text-gray-400">Must match exactly — lowercase, underscores, no spaces</p>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-500">Language code</label>
                  <input
                    type="text"
                    value={metaLang}
                    onChange={e => setMetaLang(e.target.value)}
                    className="input font-mono text-sm"
                    placeholder="en"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-gray-500">
                    Variable names — use the <strong>exact names</strong> from your Meta template (e.g. <code className="bg-gray-100 px-1 rounded">customer_name</code> if your template uses <code className="bg-gray-100 px-1 rounded">{'{{customer_name}}'}</code>)
                  </label>
                  <input
                    type="text"
                    value={metaVars}
                    onChange={e => setMetaVars(e.target.value)}
                    className="input font-mono text-sm"
                    placeholder="customer_name, rate_24kt, rate_22kt"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {PLACEHOLDERS.map(({ varName, desc }) => (
                      <button
                        key={varName}
                        type="button"
                        onClick={() => setMetaVars(prev => prev ? `${prev}, ${varName}` : varName)}
                        className="text-[10px] px-2 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-green-50 hover:text-green-700 border border-gray-200 transition-colors"
                      >
                        + {varName} <span className="text-gray-400">({desc})</span>
                      </button>
                    ))}
                  </div>
                  {metaVars && (
                    <div className="bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 space-y-1">
                      {metaVars.split(',').map((v, i) => v.trim()).filter(Boolean).map((v, i) => (
                        <p key={i} className="text-[10px] font-mono text-gray-600">
                          <span className="text-blue-600">{`{{${i + 1}}}`}</span> → <span className="text-green-700">{v}</span>
                        </p>
                      ))}
                    </div>
                  )}
                </div>

                {/* Header type */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-gray-500">Header type</label>
                  <div className="flex gap-2">
                    {(['none', 'image'] as const).map(type => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setHeaderType(type)}
                        className={`flex-1 py-2 rounded-lg border text-xs font-medium transition-colors ${
                          headerType === type
                            ? 'bg-green-600 text-white border-green-600'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        {type === 'none' ? 'No header' : '🖼 Image'}
                      </button>
                    ))}
                  </div>
                </div>

                {headerType === 'image' && (
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-gray-500">Header image URL</label>
                    <div className="flex gap-2">
                      <input
                        type="url"
                        value={headerImageUrl}
                        onChange={e => setHeaderImageUrl(e.target.value)}
                        className="input text-sm flex-1"
                        placeholder="https://your-domain.com/image.jpg"
                      />
                      <input
                        ref={headerFileRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={onPickHeaderImage}
                      />
                      <button
                        type="button"
                        onClick={() => headerFileRef.current?.click()}
                        disabled={headerUploading}
                        className="btn-secondary text-sm whitespace-nowrap disabled:opacity-50"
                      >
                        {headerUploading ? 'Uploading…' : '⬆ Upload image'}
                      </button>
                    </div>
                    <p className="text-[10px] text-gray-400">Paste a public URL, or upload an image to host it automatically. This image is sent as the header with every use of this template.</p>
                    {headerImageUrl && (
                      <img
                        src={headerImageUrl}
                        alt="Header preview"
                        className="mt-2 rounded-lg w-full object-cover max-h-32"
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                      />
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Preview */}
          {formBody && (
            <div>
              <button
                type="button"
                onClick={() => setShowPreview(p => !p)}
                className="text-xs text-green-700 font-medium underline underline-offset-2"
              >
                {showPreview ? 'Hide preview' : 'Preview message'}
              </button>
              {showPreview && (
                <div className="mt-2 bg-[#dcf8c6] rounded-2xl rounded-tl-sm p-3 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                  {applyPlaceholders(formBody, PLACEHOLDER_NAME, {
                    rate_24kt: 9850,
                    rate_22kt: 9025,
                    rate_18kt: 7380,
                  })}
                  <p className="text-[10px] text-gray-500 mt-2 border-t border-green-200 pt-2">
                    Preview uses sample rates. Actual rates filled at send time.
                  </p>
                </div>
              )}
            </div>
          )}

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="btn-primary flex-1 py-2.5">
              {saving ? 'Saving…' : editingId ? 'Update Template' : 'Add Template'}
            </button>
            {editingId && (
              <button type="button" onClick={resetForm} className="btn-secondary px-4 py-2.5">Cancel</button>
            )}
          </div>
        </form>

        {/* Filter by Message type */}
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {(['all', 'daily_rate', 'rate', 'offer', 'thankyou', 'walkin', 'coupon', 'custom'] as const).map(f => (
            <button
              key={f}
              onClick={() => setCategoryFilter(f)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                categoryFilter === f ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-300'
              }`}
            >
              {CATEGORY_LABEL[f]}
            </button>
          ))}
        </div>

        {/* Template list */}
        {loading ? (
          <p className="text-sm text-gray-400 text-center py-4">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="card p-8 text-center text-gray-400 text-sm">No templates yet.</div>
        ) : (
          <div className="space-y-2">
            {filtered.map(t => (
              <div key={t.id} className={`card p-4 ${!t.is_active ? 'opacity-50' : ''}`}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="font-semibold text-sm text-gray-900 truncate">{t.name}</p>
                      {t.meta_template_name && (
                        <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium flex-shrink-0">✓ WA approved</span>
                      )}
                    </div>
                    <p className="text-xs text-green-600 mt-0.5">{CATEGORY_LABEL[(t.category ?? 'custom') as keyof typeof CATEGORY_LABEL] ?? t.category}</p>
                    {t.meta_template_name && (
                      <p className="text-[10px] font-mono text-gray-400 mt-0.5">{t.meta_template_name}</p>
                    )}
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => startEdit(t)}
                      className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 px-2.5 py-1 rounded-lg"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => toggleActive(t)}
                      className={`text-xs px-2.5 py-1 rounded-lg border font-medium ${
                        t.is_active ? 'text-green-700 border-green-200 bg-green-50' : 'text-gray-500 border-gray-200'
                      }`}
                    >
                      {t.is_active ? 'Active' : 'Off'}
                    </button>
                  </div>
                </div>
                <p className="text-xs text-gray-500 line-clamp-2 whitespace-pre-wrap">{t.body_text}</p>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
