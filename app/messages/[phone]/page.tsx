'use client'

import { use, useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { applyPlaceholders } from '@/lib/utils'
import { describeError, shortError } from '@/lib/whatsapp/errors'
import { compressImage } from '@/lib/image'
import type { WaMessage, WaThread, MessageTemplate, InterestTopic } from '@/lib/types'

interface TodayRates {
  rate_24kt: number | null
  rate_22kt: number | null
  rate_18kt: number | null
}

const WINDOW_MS = 24 * 60 * 60 * 1000 // WhatsApp free-text reply window

const MAX_IMAGE_BYTES = 10 * 1024 * 1024 // 10 MB (compressed client-side before sending)
const MAX_IMAGES_AT_ONCE = 10

// ---------------------------------------------------------------------------
// Status tick icons
// ---------------------------------------------------------------------------
function StatusTick({ status }: { status: WaMessage['status'] }) {
  if (status === 'queued') return (
    <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <circle cx="12" cy="12" r="9" strokeWidth={2} />
    </svg>
  )
  if (status === 'sent') return (
    <svg className="w-3.5 h-3.5 text-gray-400" viewBox="0 0 16 16" fill="currentColor">
      <path d="M13.5 4.5l-7 7-3-3" stroke="currentColor" strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
  if (status === 'delivered') return (
    <span className="text-[10px] text-gray-400 font-bold tracking-tighter">✓✓</span>
  )
  if (status === 'read') return (
    <span className="text-[10px] text-blue-500 font-bold tracking-tighter">✓✓</span>
  )
  if (status === 'failed') return (
    <span className="text-[10px] text-red-500 font-bold">✗</span>
  )
  return null
}

// ---------------------------------------------------------------------------
// Single message bubble
// ---------------------------------------------------------------------------
function MessageBubble({ msg }: { msg: WaMessage }) {
  const isOut = msg.direction === 'outbound'
  const isImage = (msg.message_type ?? 'text') === 'image'
  const time = new Date(msg.created_at).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true
  })

  return (
    <div className={`flex ${isOut ? 'justify-end' : 'justify-start'} mb-1.5`}>
      <div
        className={`max-w-[78%] rounded-2xl shadow-sm overflow-hidden ${
          isOut
            ? 'bg-green-600 text-white rounded-br-sm'
            : 'bg-white text-gray-900 border border-gray-100 rounded-bl-sm'
        } ${isImage && msg.media_url ? 'p-1' : 'px-3.5 py-2'}`}
      >
        {/* Image */}
        {isImage && msg.media_url && (
          <a href={msg.media_url} target="_blank" rel="noopener noreferrer">
            <img
              src={msg.media_url}
              alt="Photo"
              className="rounded-xl block"
              style={{ maxHeight: '260px', maxWidth: '100%', objectFit: 'contain' }}
            />
          </a>
        )}
        {isImage && !msg.media_url && (
          <div className="flex items-center gap-1.5 px-2 py-1">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 18h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v10.5a1.5 1.5 0 001.5 1.5z"/>
            </svg>
            <span className="text-sm">Photo</span>
          </div>
        )}

        {/* Caption or text body */}
        {msg.body && (
          <p className={`text-sm leading-relaxed whitespace-pre-wrap break-words ${isImage && msg.media_url ? 'px-2.5 pt-1.5' : ''}`}>
            {msg.body}
          </p>
        )}

        {/* Footer: time + status */}
        <div className={`flex items-center gap-1 mt-0.5 ${isImage && msg.media_url ? 'px-2.5 pb-1' : ''} ${isOut ? 'justify-end' : 'justify-start'}`}>
          <span className={`text-[10px] ${isOut ? 'text-green-200' : 'text-gray-400'}`}>{time}</span>
          {isOut && <StatusTick status={msg.status} />}
        </div>

        {/* Failed reason — code + plain English */}
        {isOut && msg.status === 'failed' && (msg.error_code || msg.failed_reason) && (
          <div className={`mt-0.5 ${isImage && msg.media_url ? 'px-2.5 pb-1' : ''}`}>
            <p className="text-[10px] text-red-300 font-semibold">
              Not delivered{msg.error_code ? ` · ${shortError(msg.error_code)}` : ''}
            </p>
            <p className="text-[10px] text-red-200 leading-snug">
              {msg.error_code ? describeError(msg.error_code).hint : msg.failed_reason}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function ConversationPage({
  params,
}: {
  params: Promise<{ phone: string }>
}) {
  const { phone } = use(params)

  const supabase    = createClient()
  const router      = useRouter()
  const bottomRef   = useRef<HTMLDivElement>(null)
  const inputRef    = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [thread,        setThread]        = useState<WaThread | null>(null)
  const [messages,      setMessages]      = useState<WaMessage[]>([])
  const [text,          setText]          = useState('')
  const [sending,       setSending]       = useState(false)
  const [error,         setError]         = useState<string | null>(null)
  const [loading,       setLoading]       = useState(true)
  const [pendingImages, setPendingImages] = useState<File[]>([])
  const [imagePreviews, setImagePreviews] = useState<string[]>([])

  // Templates + interests (in-chat tools)
  const [sheet,            setSheet]            = useState<'none' | 'templates' | 'template-preview' | 'interests'>('none')
  const [templates,        setTemplates]        = useState<MessageTemplate[]>([])
  const [topics,           setTopics]           = useState<InterestTopic[]>([])
  const [todayRates,       setTodayRates]       = useState<TodayRates | null>(null)
  const [customerId,       setCustomerId]       = useState<string | null>(null)
  const [selectedTopics,   setSelectedTopics]   = useState<Set<string>>(new Set())
  const [interestsSaving,  setInterestsSaving]  = useState(false)
  const [interestsSaved,   setInterestsSaved]   = useState(false)
  const [previewTemplate,  setPreviewTemplate]  = useState<MessageTemplate | null>(null)
  const [previewBody,      setPreviewBody]      = useState('')
  const [tplSending,       setTplSending]       = useState(false)
  const [leads,            setLeads]            = useState<Array<{ intent: string | null; metal: string | null }>>([])

  // Scroll to bottom
  const scrollToBottom = useCallback((smooth = false) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant' })
  }, [])

  // Load thread + messages
  useEffect(() => {
    const todayStr = new Date().toLocaleDateString('en-CA')

    async function load() {
      setLoading(true)

      // Thread + supporting data (templates / topics / rates) in parallel.
      // Thread may not exist yet — the first outbound message creates it.
      const [thRes, tplRes, topicRes, ratesRes] = await Promise.all([
        supabase.from('wa_threads').select('*').eq('phone', phone).single(),
        supabase.from('wa_message_templates').select('*').eq('is_active', true).order('name'),
        supabase.from('wa_interest_topics').select('*').eq('is_active', true).order('sort_order'),
        supabase.from('daily_rates').select('rate_24kt, rate_22kt, rate_18kt').eq('date', todayStr).maybeSingle(),
      ])

      const th = thRes.data as WaThread | null
      setThread(th ?? null)
      setTemplates((tplRes.data ?? []) as MessageTemplate[])
      setTopics((topicRes.data ?? []) as InterestTopic[])
      setTodayRates((ratesRes.data ?? null) as TodayRates | null)

      if (th) {
        const [msgsRes, interestsRes, leadRes] = await Promise.all([
          supabase.from('wa_messages').select('*').eq('thread_id', th.id).order('created_at', { ascending: true }),
          th.customer_id
            ? supabase.from('wa_customer_interests').select('topic_id').eq('customer_id', th.customer_id)
            : Promise.resolve({ data: [] as { topic_id: string }[] }),
          th.customer_id
            ? supabase
                .from('wa_lead_captures')
                .select('intent, metal')
                .eq('customer_id', th.customer_id)
                .order('created_at', { ascending: false })
                .limit(30)
            : Promise.resolve({ data: [] as Array<{ intent: string | null; metal: string | null }> }),
        ])
        setMessages((msgsRes.data ?? []) as WaMessage[])
        setCustomerId(th.customer_id ?? null)
        setSelectedTopics(new Set((interestsRes.data ?? []).map(r => r.topic_id)))
        setLeads((leadRes.data ?? []) as Array<{ intent: string | null; metal: string | null }>)
      }

      setLoading(false)
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone])

  // Scroll to bottom after initial load
  useEffect(() => {
    if (!loading) scrollToBottom(false)
  }, [loading, scrollToBottom])

  // Realtime: new messages + status updates for this thread
  useEffect(() => {
    if (!thread) return

    const channel = supabase
      .channel(`thread-${thread.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'wa_messages', filter: `thread_id=eq.${thread.id}` },
        payload => {
          setMessages(prev => {
            // Avoid duplicates if we already inserted it client-side
            if (prev.find(m => m.id === payload.new.id)) return prev
            return [...prev, payload.new as WaMessage]
          })
          setTimeout(() => scrollToBottom(true), 50)
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'wa_messages', filter: `thread_id=eq.${thread.id}` },
        payload => {
          setMessages(prev =>
            prev.map(m => m.id === payload.new.id ? (payload.new as WaMessage) : m)
          )
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread?.id])

  // Image selection — accepts multiple files at once
  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = '' // allow re-selecting the same file
    if (files.length === 0) return

    const room = MAX_IMAGES_AT_ONCE - pendingImages.length
    if (room <= 0) {
      setError(`You can attach up to ${MAX_IMAGES_AT_ONCE} photos at once`)
      return
    }

    const accepted: File[] = []
    for (const file of files.slice(0, room)) {
      if (!file.type.startsWith('image/')) {
        setError('Only image files are supported')
        continue
      }
      if (file.size > MAX_IMAGE_BYTES) {
        setError('Each image must be under 10 MB')
        continue
      }
      accepted.push(file)
    }
    if (accepted.length === 0) return

    setPendingImages(prev => [...prev, ...accepted])
    setImagePreviews(prev => [...prev, ...accepted.map(f => URL.createObjectURL(f))])
    if (accepted.length === files.length) setError(null)
    inputRef.current?.focus()
  }

  function removePendingImage(index: number) {
    setImagePreviews(prev => {
      const url = prev[index]
      if (url) URL.revokeObjectURL(url)
      return prev.filter((_, i) => i !== index)
    })
    setPendingImages(prev => prev.filter((_, i) => i !== index))
  }

  function clearPendingImages() {
    setImagePreviews(prev => { prev.forEach(URL.revokeObjectURL); return [] })
    setPendingImages([])
  }

  async function handleSendImages() {
    if (pendingImages.length === 0 || sending) return
    setSending(true)
    setError(null)

    const caption = text.trim()
    const images = pendingImages
    setText('')
    clearPendingImages()

    let firstError: string | null = null
    // Send sequentially. Caption rides on the first photo only (WhatsApp shows
    // one caption per image). Each photo is compressed to fit Meta's ~5 MB limit.
    for (let i = 0; i < images.length; i++) {
      const compressed = await compressImage(images[i])
      const formData = new FormData()
      formData.append('phone', phone)
      formData.append('file',  compressed)
      if (i === 0 && caption) formData.append('caption', caption)

      try {
        const res  = await fetch('/api/whatsapp/send-media', { method: 'POST', body: formData })
        const data = await res.json()
        if (!res.ok) firstError = firstError ?? (data.error ?? 'Failed to send image')
      } catch {
        firstError = firstError ?? 'Network error — please try again'
      }
    }

    if (firstError) setError(firstError)
    if (!thread) {
      const { data: th } = await supabase.from('wa_threads').select('*').eq('phone', phone).single()
      setThread(th ?? null)
    }
    setTimeout(() => scrollToBottom(true), 100)
    setSending(false)
    inputRef.current?.focus()
  }

  // Send message
  async function handleSend() {
    if (pendingImages.length) { await handleSendImages(); return }

    const body = text.trim()
    if (!body || sending) return

    setSending(true)
    setError(null)
    setText('')

    try {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, body }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Failed to send message')
        setText(body) // restore text on failure
      } else {
        // Reload thread in case it was just created
        if (!thread) {
          const { data: th } = await supabase
            .from('wa_threads')
            .select('*')
            .eq('phone', phone)
            .single()
          setThread(th ?? null)
        }
        setTimeout(() => scrollToBottom(true), 100)
      }
    } catch {
      setError('Network error — please try again')
      setText(body)
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  // Textarea: Enter = send, Shift+Enter = newline
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const displayName  = thread?.customer_name || formatPhone(phone)
  const customerName = thread?.customer_name || 'Customer'

  // "Interested in" banner — the specific topics tagged across the whole
  // conversation (Sale & Discounts, Gold Exchange, Necklaces, …) plus the metal
  // they picked. Topics are the single source of truth, shared with the Send module.
  const interestNames = topics.filter(t => selectedTopics.has(t.id)).map(t => t.name)
  const metalNames    = [...new Set(leads.map(l => l.metal).filter(Boolean) as string[])]
    .map(m => m.charAt(0).toUpperCase() + m.slice(1))
  const seen = new Set<string>()
  const leadSummary = [...metalNames, ...interestNames]
    .filter(p => { const k = p.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true })
    .join(' · ')

  // 24h free-text window: open only if the customer messaged us within 24h
  const lastInboundAt = useMemo(() => {
    const inbound = messages.filter(m => m.direction === 'inbound')
    return inbound.length ? inbound[inbound.length - 1].created_at : null
  }, [messages])
  const [withinWindow, setWithinWindow] = useState(false)
  useEffect(() => {
    const check = () =>
      setWithinWindow(!!lastInboundAt && (Date.now() - new Date(lastInboundAt).getTime()) < WINDOW_MS)
    check()
    const id = setInterval(check, 60_000) // re-check so it flips when the window expires
    return () => clearInterval(id)
  }, [lastInboundAt])

  // Ensure a Type A customer record exists for this phone (link to thread)
  async function ensureCustomer(): Promise<string | null> {
    if (customerId) return customerId
    const { data: existing } = await supabase
      .from('wa_customers').select('id').eq('phone', phone).maybeSingle()
    let id = existing?.id ?? null
    if (!id) {
      const { data: created } = await supabase
        .from('wa_customers')
        .insert({ name: thread?.customer_name ?? `WhatsApp ${phone.slice(-4)}`, phone, enrolled_via: 'whatsapp' })
        .select('id').single()
      id = created?.id ?? null
    }
    if (id) {
      setCustomerId(id)
      if (thread && !thread.customer_id) {
        await supabase.from('wa_threads').update({ customer_id: id }).eq('id', thread.id)
        setThread({ ...thread, customer_id: id })
      }
    }
    return id
  }

  async function openInterests() {
    setError(null)
    await ensureCustomer()
    setSheet('interests')
  }

  function toggleTopic(id: string) {
    setSelectedTopics(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function saveInterests() {
    const cid = await ensureCustomer()
    if (!cid) { setError('Could not link this chat to a customer record.'); return }
    setInterestsSaving(true)
    await supabase.from('wa_customer_interests').delete().eq('customer_id', cid)
    if (selectedTopics.size > 0) {
      await supabase.from('wa_customer_interests').insert(
        [...selectedTopics].map(tid => ({ customer_id: cid, topic_id: tid }))
      )
    }
    setInterestsSaving(false)
    setInterestsSaved(true)
    setTimeout(() => { setInterestsSaved(false); setSheet('none') }, 1200)
  }

  function pickTemplate(t: MessageTemplate) {
    setPreviewTemplate(t)
    setPreviewBody(applyPlaceholders(t.body_text, customerName, todayRates))
    setSheet('template-preview')
  }

  async function sendTemplate() {
    if (!previewTemplate || tplSending) return
    setTplSending(true)
    setError(null)
    const cid = await ensureCustomer()
    try {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          body:       previewBody,
          templateId: previewTemplate.id,
          customerId: cid,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to send template')
      } else {
        setSheet('none')
        setPreviewTemplate(null)
        if (!thread) {
          const { data: th } = await supabase.from('wa_threads').select('*').eq('phone', phone).single()
          setThread(th ?? null)
        }
        setTimeout(() => scrollToBottom(true), 100)
      }
    } catch {
      setError('Network error — please try again')
    } finally {
      setTplSending(false)
    }
  }

  // Staff control: pause/resume the auto-reply bot for this customer.
  // When paused (with_agent), the bot stays silent even if the customer says "hi".
  async function toggleBot() {
    if (!thread) return
    const next = thread.bot_state === 'active' ? 'with_agent' : 'active'
    await supabase.from('wa_threads').update({ bot_state: next }).eq('id', thread.id)
    setThread({ ...thread, bot_state: next })
  }

  const parentTopics = topics.filter(t => !t.parent_id)
  const childTopics  = (parentId: string) => topics.filter(t => t.parent_id === parentId)

  return (
    // Full-screen flex column, sitting between sticky top bar and fixed bottom nav
    <div className="flex flex-col" style={{ height: 'calc(100dvh - 3rem)' }}>

      {/* Conversation header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200 flex-shrink-0">
        <button onClick={() => router.back()} className="text-gray-500 active:text-gray-800 p-1 -ml-1">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
          <span className="text-green-700 font-bold text-sm">
            {displayName.charAt(0).toUpperCase()}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 text-sm truncate">{displayName}</p>
          <p className="text-xs text-gray-400">{formatPhone(phone)}</p>
        </div>

        {/* Bot on/off — staff can pause auto-replies and take over */}
        {thread && (
          <button
            onClick={toggleBot}
            title={thread.bot_state === 'active' ? 'Auto-replies ON — tap to pause' : 'Auto-replies OFF — tap to resume'}
            className={`flex-shrink-0 text-[10px] font-bold px-2 py-1 rounded-full border transition-colors ${
              thread.bot_state === 'active'
                ? 'bg-green-50 text-green-700 border-green-200'
                : 'bg-gray-100 text-gray-500 border-gray-300'
            }`}
          >
            {thread.bot_state === 'active' ? 'BOT ON' : 'BOT OFF'}
          </button>
        )}

        {/* Assign interests */}
        <button
          onClick={openInterests}
          className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-gray-500 hover:text-green-600 hover:bg-green-50 transition-colors"
          aria-label="Assign interests"
          title="Assign interests"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
          </svg>
        </button>

        {/* Send a template */}
        <button
          onClick={() => { setError(null); setSheet('templates') }}
          className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-gray-500 hover:text-green-600 hover:bg-green-50 transition-colors"
          aria-label="Send template"
          title="Send template"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </button>
      </div>

      {/* Captured-intent context — what the customer told the bot they want */}
      {leadSummary && (
        <div className="flex-shrink-0 bg-blue-50 border-b border-blue-100 px-4 py-1.5">
          <p className="text-xs text-blue-800">
            <span className="font-semibold">Interested in:</span> {leadSummary}
          </p>
        </div>
      )}

      {/* Messages scroll area */}
      <div className="flex-1 overflow-y-auto px-3 py-3 bg-gray-50" style={{ paddingBottom: '80px' }}>
        {loading && (
          <div className="flex justify-center pt-8">
            <div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center pt-12 text-center">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mb-3">
              <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <p className="text-gray-500 text-sm font-medium">No messages yet</p>
            <p className="text-gray-400 text-xs mt-1">Start the conversation below</p>
          </div>
        )}

        {messages.map(msg => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-red-50 border-t border-red-200 px-4 py-2 flex-shrink-0">
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Image previews above send box */}
      {pendingImages.length > 0 && (
        <div className="flex-shrink-0 bg-white border-t border-gray-100 px-3 py-2">
          <div className="flex items-center gap-2 overflow-x-auto">
            {imagePreviews.map((src, i) => (
              <div key={src} className="relative flex-shrink-0">
                <img
                  src={src}
                  alt={`preview ${i + 1}`}
                  className="w-16 h-16 object-cover rounded-lg border border-gray-200"
                />
                <button
                  onClick={() => removePendingImage(i)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-gray-700 text-white flex items-center justify-center shadow"
                  aria-label="Remove image"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-gray-400 mt-1">
            {pendingImages.length} photo{pendingImages.length > 1 ? 's' : ''} ready
            {pendingImages.length > 1 ? ' · caption goes on the first' : ''}
          </p>
        </div>
      )}

      {/* 24h window-closed notice — free text won't deliver, must use a template */}
      {!loading && !withinWindow && messages.length > 0 && (
        <div className="flex-shrink-0 bg-amber-50 border-t border-amber-200 px-4 py-2 flex items-center justify-between gap-3">
          <p className="text-xs text-amber-700 leading-snug">
            24h reply window closed — a free message won’t deliver. Send an approved template instead.
          </p>
          <button
            onClick={() => { setError(null); setSheet('templates') }}
            className="flex-shrink-0 text-xs font-semibold text-white bg-amber-500 hover:bg-amber-600 px-3 py-1.5 rounded-lg transition-colors"
          >
            Template
          </button>
        </div>
      )}

      {/* Send box */}
      <div
        className="flex-shrink-0 bg-white border-t border-gray-200 px-3 py-2 flex items-end gap-2"
        style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom, 0px))' }}
      >
        {/* Attach image button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={sending}
          className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-gray-400 hover:text-green-600 hover:bg-green-50 transition-colors disabled:opacity-40"
          aria-label="Attach image"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 18h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v10.5a1.5 1.5 0 001.5 1.5z"/>
          </svg>
        </button>

        <textarea
          ref={inputRef}
          rows={1}
          className="flex-1 border border-gray-300 rounded-2xl px-3.5 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white"
          placeholder={pendingImages.length ? 'Add a caption (optional)…' : 'Type a message…'}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          style={{ maxHeight: '120px', overflowY: 'auto' }}
          disabled={sending}
        />
        <button
          onClick={handleSend}
          disabled={(!text.trim() && pendingImages.length === 0) || sending}
          className="w-10 h-10 rounded-full bg-green-600 flex items-center justify-center text-white flex-shrink-0 disabled:bg-gray-300 active:bg-green-700 transition-colors"
          aria-label="Send"
        >
          {sending ? (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-5 h-5 translate-x-0.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          )}
        </button>
      </div>

      {/* ── Template picker sheet ──────────────────────────────────────────── */}
      {sheet === 'templates' && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={() => setSheet('none')}>
          <div className="bg-white rounded-t-2xl flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
            <div className="flex-shrink-0 px-5 pt-5 pb-3">
              <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
              <p className="font-semibold text-gray-900">Choose a template</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Approved templates can be sent any time. Plain templates only deliver inside the 24h window.
              </p>
            </div>
            <div className="flex-1 overflow-y-auto px-5 space-y-2 pb-2">
              {templates.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-6">No active templates. Add some in the Templates tab.</p>
              )}
              {templates.map(t => (
                <button
                  key={t.id}
                  onClick={() => pickTemplate(t)}
                  className="w-full text-left card p-4 hover:border-green-300 hover:bg-green-50 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-sm text-gray-900 truncate">{t.name}</p>
                    {t.meta_template_name ? (
                      <span className="flex-shrink-0 text-[10px] font-semibold text-green-700 bg-green-100 border border-green-200 px-1.5 py-0.5 rounded-full">Approved</span>
                    ) : (
                      <span className="flex-shrink-0 text-[10px] font-semibold text-amber-700 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded-full">24h only</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                    {applyPlaceholders(t.body_text, customerName, todayRates)}
                  </p>
                </button>
              ))}
            </div>
            <div className="flex-shrink-0 px-5 pt-3 pb-8">
              <button onClick={() => setSheet('none')} className="btn-secondary w-full">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Template preview + send ────────────────────────────────────────── */}
      {sheet === 'template-preview' && previewTemplate && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={() => setSheet('none')}>
          <div className="bg-white rounded-t-2xl flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
            <div className="flex-shrink-0 px-5 pt-5 pb-3">
              <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-gray-900">Preview</p>
                <span className="text-xs bg-green-50 text-green-700 px-2 py-1 rounded-full border border-green-100 font-medium">{previewTemplate.name}</span>
              </div>
              {!previewTemplate.meta_template_name && !withinWindow && (
                <p className="text-xs text-amber-600 mt-2">
                  ⚠ This template isn’t Meta-approved, so it may not deliver outside the 24h window.
                </p>
              )}
            </div>
            <div className="flex-1 overflow-y-auto px-5 pb-2">
              <div className="bg-[#dcf8c6] rounded-2xl rounded-tl-sm p-4 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                {previewBody}
              </div>
            </div>
            <div className="flex-shrink-0 px-5 pt-3 pb-8 space-y-2">
              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-center">{error}</p>
              )}
              <button onClick={sendTemplate} disabled={tplSending} className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-60">
                {tplSending ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : 'Send'}
              </button>
              <button onClick={() => setSheet('templates')} disabled={tplSending} className="btn-secondary w-full disabled:opacity-60">← Back</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Assign interests sheet ─────────────────────────────────────────── */}
      {sheet === 'interests' && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={() => setSheet('none')}>
          <div className="bg-white rounded-t-2xl flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
            <div className="flex-shrink-0 px-5 pt-5 pb-3">
              <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
              <p className="font-semibold text-gray-900">Assign interests</p>
              <p className="text-xs text-gray-500 mt-0.5">Tag what {displayName} is interested in — they’ll be included in those broadcasts.</p>
            </div>
            <div className="flex-1 overflow-y-auto px-5 space-y-3 pb-2">
              {parentTopics.map(parent => {
                const subs = childTopics(parent.id)
                return (
                  <div key={parent.id}>
                    <button
                      type="button"
                      onClick={() => toggleTopic(parent.id)}
                      className={`w-full text-left px-3 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                        selectedTopics.has(parent.id) ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-700 border-gray-300'
                      }`}
                    >
                      {parent.name}
                    </button>
                    {subs.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2 pl-2">
                        {subs.map(sub => (
                          <button
                            key={sub.id}
                            type="button"
                            onClick={() => toggleTopic(sub.id)}
                            className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${
                              selectedTopics.has(sub.id) ? 'bg-green-100 text-green-800 border-green-400' : 'bg-white text-gray-600 border-gray-300'
                            }`}
                          >
                            {sub.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="flex-shrink-0 px-5 pt-3 pb-8 space-y-2">
              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-center">{error}</p>
              )}
              <button onClick={saveInterests} disabled={interestsSaving} className="btn-primary w-full disabled:opacity-60">
                {interestsSaving ? 'Saving…' : interestsSaved ? '✓ Saved' : 'Save interests'}
              </button>
              <button onClick={() => setSheet('none')} className="btn-secondary w-full">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function formatPhone(phone: string): string {
  if (phone.length === 10) return `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`
  return phone
}
