'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import Navbar from '@/components/ui/Navbar'
import { applyPlaceholders } from '@/lib/utils'
import type { InterestTopic, MessageTemplate } from '@/lib/types'

const PLACEHOLDER_NAME = 'Priya Sharma'

const PLACEHOLDERS = [
  { tag: '{name}',       desc: 'Customer name' },
  { tag: '{rate_24kt}',  desc: '24KT / gram' },
  { tag: '{rate_22kt}',  desc: '22KT / gram' },
  { tag: '{rate_18kt}',  desc: '18KT / gram' },
]

export default function TemplatesPage() {
  const supabase = createClient()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [topics, setTopics] = useState<InterestTopic[]>([])
  const [filterTopic, setFilterTopic] = useState<string>('all')
  const [loading, setLoading] = useState(true)

  // Form state
  const [formName, setFormName] = useState('')
  const [formTopic, setFormTopic] = useState<string>('none')
  const [formBody, setFormBody] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showPreview, setShowPreview] = useState(false)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const [tmplRes, topicsRes] = await Promise.all([
      supabase.from('wa_message_templates').select('*').order('created_at', { ascending: false }),
      supabase.from('wa_interest_topics').select('*').eq('is_active', true).order('sort_order'),
    ])
    setTemplates(tmplRes.data ?? [])
    setTopics(topicsRes.data ?? [])
    setLoading(false)
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
    setFormTopic(t.topic_id ?? 'none')
    setFormBody(t.body_text)
    setShowPreview(false)
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function resetForm() {
    setEditingId(null); setFormName(''); setFormTopic('none'); setFormBody(''); setError(''); setShowPreview(false)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!formName.trim() || !formBody.trim()) { setError('Name and message body are required.'); return }
    setSaving(true); setError('')
    const { data: { user } } = await supabase.auth.getUser()
    const payload = {
      name: formName.trim(),
      topic_id: formTopic === 'none' ? null : formTopic,
      body_text: formBody.trim(),
      created_by: user!.id,
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

  function topicName(id: string | null) {
    if (!id) return 'General'
    return topics.find(t => t.id === id)?.name ?? '—'
  }

  const filtered = templates.filter(t =>
    filterTopic === 'all' ? true : filterTopic === 'general' ? !t.topic_id : t.topic_id === filterTopic
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

          <select value={formTopic} onChange={e => setFormTopic(e.target.value)} className="input">
            <option value="none">General (no specific topic)</option>
            {topics.map(t => (
              <option key={t.id} value={t.id}>{t.parent_id ? `  ↳ ${t.name}` : t.name}</option>
            ))}
          </select>

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

        {/* Filter */}
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {['all', 'general', ...topics.filter(t => !t.parent_id).map(t => t.id)].map(f => {
            const label = f === 'all' ? 'All' : f === 'general' ? 'General' : topics.find(t => t.id === f)?.name ?? f
            return (
              <button
                key={f}
                onClick={() => setFilterTopic(f)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  filterTopic === f ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-300'
                }`}
              >
                {label}
              </button>
            )
          })}
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
                    <p className="font-semibold text-sm text-gray-900 truncate">{t.name}</p>
                    <p className="text-xs text-green-600 mt-0.5">{topicName(t.topic_id)}</p>
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
