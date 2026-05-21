'use client'

import { use, useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { WaMessage, WaThread } from '@/lib/types'

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
  const time = new Date(msg.created_at).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true
  })

  return (
    <div className={`flex ${isOut ? 'justify-end' : 'justify-start'} mb-1.5`}>
      <div
        className={`max-w-[78%] rounded-2xl px-3.5 py-2 shadow-sm ${
          isOut
            ? 'bg-green-600 text-white rounded-br-sm'
            : 'bg-white text-gray-900 border border-gray-100 rounded-bl-sm'
        }`}
      >
        {/* Body */}
        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
          {msg.body}
        </p>

        {/* Footer: time + status */}
        <div className={`flex items-center gap-1 mt-0.5 ${isOut ? 'justify-end' : 'justify-start'}`}>
          <span className={`text-[10px] ${isOut ? 'text-green-200' : 'text-gray-400'}`}>{time}</span>
          {isOut && <StatusTick status={msg.status} />}
        </div>

        {/* Failed reason */}
        {isOut && msg.status === 'failed' && msg.failed_reason && (
          <p className="text-[10px] text-red-300 mt-0.5">{msg.failed_reason}</p>
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

  const supabase  = createClient()
  const router    = useRouter()
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLTextAreaElement>(null)

  const [thread,   setThread]   = useState<WaThread | null>(null)
  const [messages, setMessages] = useState<WaMessage[]>([])
  const [text,     setText]     = useState('')
  const [sending,  setSending]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [loading,  setLoading]  = useState(true)

  // Scroll to bottom
  const scrollToBottom = useCallback((smooth = false) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant' })
  }, [])

  // Load thread + messages
  useEffect(() => {
    async function load() {
      setLoading(true)

      // Thread (may not exist yet — first message creates it)
      const { data: th } = await supabase
        .from('wa_threads')
        .select('*')
        .eq('phone', phone)
        .single()

      setThread(th ?? null)

      if (th) {
        const { data: msgs } = await supabase
          .from('wa_messages')
          .select('*')
          .eq('thread_id', th.id)
          .order('created_at', { ascending: true })

        setMessages((msgs ?? []) as WaMessage[])
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

  // Send message
  async function handleSend() {
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

  const displayName = thread?.customer_name || formatPhone(phone)

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
      </div>

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

      {/* Send box — fixed above bottom nav */}
      <div
        className="flex-shrink-0 bg-white border-t border-gray-200 px-3 py-2 flex items-end gap-2"
        style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <textarea
          ref={inputRef}
          rows={1}
          className="flex-1 border border-gray-300 rounded-2xl px-3.5 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white"
          placeholder="Type a message…"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          style={{ maxHeight: '120px', overflowY: 'auto' }}
          disabled={sending}
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || sending}
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
    </div>
  )
}

function formatPhone(phone: string): string {
  if (phone.length === 10) return `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`
  return phone
}
