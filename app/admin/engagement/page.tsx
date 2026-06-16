'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Navbar from '@/components/ui/Navbar'

// Editable bot copy. `image` = WhatsApp can carry a picture with this message
// (only the plain-text replies can — the button/list screens are text-only).
const FIELDS: Array<{ key: string; label: string; help: string; image: boolean }> = [
  { key: 'welcome',     label: 'Welcome message',            help: 'Shown with the 2 main buttons + “More options” when a customer says hi.', image: false },
  { key: 'more_options',label: '“More options” heading',     help: 'Shown above the full list when a customer taps “More options”.', image: false },
  { key: 'offers_menu',   label: '“Offers & Sale” heading',     help: 'Shown above the Offers / Gold Exchange-Cash buttons.', image: false },
  { key: 'offer',         label: 'Offer / Sale message',        help: 'Sent when a customer taps “Offers”. Add a poster image if you like.', image: true },
  { key: 'exchange_menu', label: '“Gold Exchange/Cash” heading',help: 'Shown above the Gold Exchange / Instant Cash buttons.', image: false },
  { key: 'exchange_info', label: 'Gold Exchange message',       help: 'Sent when a customer taps “Gold Exchange”. Add an image if you like.', image: true },
  { key: 'cash_info',     label: 'Instant Cash message',        help: 'Sent when a customer taps “Instant Cash”. Add an image if you like.', image: true },
  { key: 'scheme_info', label: 'Gold Savings Scheme reply',  help: 'Sent when a customer is interested in the Gold Savings Scheme. Add a poster image if you like.', image: true },
  { key: 'rate_outro',  label: 'After sending the rate',     help: 'Follow-up shown with Offers / New Designs / Talk to our team.', image: false },
  { key: 'ask_metal',   label: 'Ask: which metal?',          help: 'Shown above the Gold / Silver / Diamond buttons.', image: false },
  { key: 'ask_product', label: 'Ask: which item?',           help: 'Shown above the list of products.', image: false },
  { key: 'ask_designs', label: 'Ask: send designs?',         help: 'Shown above Yes / No / Talk to our team.', image: false },
  { key: 'designs_ack', label: 'After “Yes, send designs”',  help: 'Confirms your team will share designs.', image: true },
  { key: 'care_prompt', label: 'Talk to our team — prompt',  help: 'Asks the customer to type their question.', image: false },
  { key: 'care_ack',    label: 'After they ask a question',  help: 'Acknowledges and hands the chat to your team.', image: false },
  { key: 'closing',     label: 'Closing message',            help: 'Shown when the customer says “No, thank you”.', image: false },
  { key: 'thank_you',   label: 'Thank-you for purchase',     help: 'For the sales-report upload (coming soon). Needs a matching approved template to actually deliver.', image: true },
]

interface MsgState { content: string; image_url: string | null }

export default function EngagementAdminPage() {
  const supabase = createClient()
  const router = useRouter()

  const [msgs,      setMsgs]      = useState<Record<string, MsgState>>({})
  const [loading,   setLoading]   = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [savedKey,  setSavedKey]  = useState<string | null>(null)
  const [uploading, setUploading] = useState<string | null>(null)
  const [error,     setError]     = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data } = await supabase.from('wa_bot_messages').select('key, content, image_url')
      const saved = new Map((data ?? []).map(r => [r.key, r]))
      const map = Object.fromEntries(
        FIELDS.map(f => {
          const row = saved.get(f.key)
          return [f.key, { content: row?.content ?? '', image_url: row?.image_url ?? null }]
        })
      )
      setMsgs(map)
      setLoading(false)
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function setContent(key: string, content: string) {
    setMsgs(prev => ({ ...prev, [key]: { ...prev[key], content } }))
  }

  async function handleUpload(key: string, file: File) {
    if (!file.type.startsWith('image/')) { setError('Please choose an image file'); return }
    if (file.size > 5 * 1024 * 1024)     { setError('Image must be under 5 MB'); return }
    setError(null)
    setUploading(key)
    const ext = file.name.split('.').pop() || 'jpg'
    const path = `bot/${key}-${Date.now()}.${ext}`
    const { data, error: upErr } = await supabase.storage.from('wa-media').upload(path, file, { upsert: false })
    if (upErr || !data) { setError(upErr?.message ?? 'Upload failed'); setUploading(null); return }
    const { data: { publicUrl } } = supabase.storage.from('wa-media').getPublicUrl(data.path)
    setMsgs(prev => ({ ...prev, [key]: { ...prev[key], image_url: publicUrl } }))
    setUploading(null)
  }

  function removeImage(key: string) {
    setMsgs(prev => ({ ...prev, [key]: { ...prev[key], image_url: null } }))
  }

  async function save(key: string) {
    setSavingKey(key)
    setError(null)
    const { data: { user } } = await supabase.auth.getUser()
    const { error: saveErr } = await supabase.from('wa_bot_messages').upsert({
      key,
      content:    msgs[key]?.content ?? '',
      image_url:  msgs[key]?.image_url ?? null,
      updated_by: user?.id ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' })
    setSavingKey(null)
    if (saveErr) { setError(saveErr.message); return }
    setSavedKey(key)
    setTimeout(() => setSavedKey(k => (k === key ? null : k)), 2000)
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-4 space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-700">←</button>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Auto-reply messages</h1>
            <p className="text-xs text-gray-500">Edit what customers receive in the automatic WhatsApp conversation.</p>
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
        )}

        {loading ? (
          <div className="flex justify-center pt-10">
            <div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          FIELDS.map(f => {
            const m = msgs[f.key] ?? { content: '', image_url: null }
            return (
              <div key={f.key} className="card p-4 space-y-2">
                <div>
                  <p className="text-sm font-semibold text-gray-800">{f.label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{f.help}</p>
                </div>

                <textarea
                  value={m.content}
                  onChange={e => setContent(f.key, e.target.value)}
                  rows={3}
                  className="input resize-none text-sm leading-relaxed"
                  placeholder="Message text…"
                />

                {f.image && (
                  <div className="flex items-center gap-3">
                    {m.image_url ? (
                      <div className="flex items-center gap-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={m.image_url} alt="" className="w-12 h-12 object-cover rounded-lg border border-gray-200" />
                        <button onClick={() => removeImage(f.key)} className="text-xs text-red-600 font-medium">Remove image</button>
                      </div>
                    ) : (
                      <label className="text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-3 py-1.5 rounded-full cursor-pointer">
                        {uploading === f.key ? 'Uploading…' : '+ Add image'}
                        <input
                          type="file" accept="image/*" className="hidden"
                          disabled={uploading === f.key}
                          onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) handleUpload(f.key, file) }}
                        />
                      </label>
                    )}
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    onClick={() => save(f.key)}
                    disabled={savingKey === f.key}
                    className="text-xs font-semibold text-white bg-green-600 hover:bg-green-700 px-4 py-1.5 rounded-full disabled:opacity-50"
                  >
                    {savingKey === f.key ? 'Saving…' : savedKey === f.key ? '✓ Saved' : 'Save'}
                  </button>
                </div>
              </div>
            )
          })
        )}
      </main>
    </div>
  )
}
