'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import Navbar from '@/components/ui/Navbar'
import CustomerPeek from '@/components/ui/CustomerPeek'
import NewThreadButton from './NewThreadButton'
import type { WaThread } from '@/lib/types'

export default function MessagesPage() {
  const supabase = createClient()
  const [threads, setThreads] = useState<WaThread[]>([])
  const [loading, setLoading] = useState(true)
  const [peekPhone, setPeekPhone] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('wa_threads')
        .select('*')
        .order('last_message_at', { ascending: false })
      setThreads((data ?? []) as WaThread[])
      setLoading(false)
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Realtime: update thread list as messages arrive or are sent
  useEffect(() => {
    const channel = supabase
      .channel('wa-threads-list')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'wa_threads' },
        payload => {
          setThreads(prev => {
            if (prev.find(t => t.id === (payload.new as WaThread).id)) return prev
            return [payload.new as WaThread, ...prev]
          })
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'wa_threads' },
        payload => {
          setThreads(prev => {
            const updated = payload.new as WaThread
            const rest = prev.filter(t => t.id !== updated.id)
            // Most-recently-updated thread goes to top
            return [updated, ...rest]
          })
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-1 max-w-lg mx-auto w-full px-4 pt-4 pb-24">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-lg font-bold text-gray-900">Messages</h1>
          <NewThreadButton />
        </div>

        {loading && (
          <div className="flex justify-center pt-12">
            <div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && threads.length === 0 && (
          <div className="card p-8 text-center mt-8">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </div>
            <p className="text-gray-600 font-medium text-sm">No conversations yet</p>
            <p className="text-gray-400 text-xs mt-1">
              Messages sent or received via WhatsApp will appear here.
            </p>
          </div>
        )}

        {!loading && threads.length > 0 && (
          <div className="card overflow-hidden">
            {threads.map((thread, i) => (
              <Link
                key={thread.id}
                href={`/messages/${thread.phone}`}
                className={`flex items-center gap-3 px-4 py-3.5 active:bg-gray-100 transition-colors ${
                  i > 0 ? 'border-t border-gray-100' : ''
                }`}
              >
                <div className="w-11 h-11 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-green-700 font-bold text-sm">
                    {(thread.customer_name || thread.phone).charAt(0).toUpperCase()}
                  </span>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-semibold text-gray-900 text-sm truncate">
                      {thread.customer_name || formatPhone(thread.phone)}
                    </p>
                    {thread.last_message_at && (
                      <span className="text-[11px] text-gray-400 flex-shrink-0">
                        {relativeTime(thread.last_message_at)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {thread.needs_agent && (
                      <span className="flex-shrink-0 text-[10px] font-semibold text-white bg-green-600 px-1.5 py-0.5 rounded-full">Reply</span>
                    )}
                    <p className="text-xs text-gray-500 truncate">
                      {thread.last_message_preview ?? 'No messages yet'}
                    </p>
                  </div>
                </div>

                <button
                  onClick={e => { e.preventDefault(); e.stopPropagation(); setPeekPhone(thread.phone) }}
                  aria-label="Who is this?"
                  className="flex-shrink-0 w-6 h-6 rounded-full border border-gray-200 text-gray-400 text-[11px] font-bold flex items-center justify-center active:bg-gray-100"
                >i</button>
                <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            ))}
          </div>
        )}
      </main>

      <CustomerPeek phone={peekPhone} onClose={() => setPeekPhone(null)} />
    </div>
  )
}

function formatPhone(phone: string): string {
  if (phone.length === 10) return `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`
  return phone
}

function relativeTime(iso: string): string {
  const date = new Date(iso)
  const now  = new Date()
  const diffMs   = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60_000)
  const diffHrs  = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHrs / 24)

  if (diffMins < 1)  return 'just now'
  if (diffMins < 60) return `${diffMins}m`
  if (diffHrs  < 24) return `${diffHrs}h`
  if (diffDays === 1) return 'Yesterday'
  if (diffDays  < 7) return `${diffDays}d`
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}
