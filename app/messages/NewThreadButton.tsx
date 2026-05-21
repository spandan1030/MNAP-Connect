'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function NewThreadButton() {
  const [open, setOpen]   = useState(false)
  const [phone, setPhone] = useState('')
  const router = useRouter()

  function handleStart() {
    const clean = phone.replace(/\D/g, '')
    if (clean.length !== 10) return
    setOpen(false)
    setPhone('')
    router.push(`/messages/${clean}`)
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-8 h-8 bg-green-600 rounded-full flex items-center justify-center text-white shadow active:bg-green-700 transition-colors"
        aria-label="New conversation"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setOpen(false)}>
          <div
            className="bg-white w-full max-w-md rounded-t-2xl p-6"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-base font-bold text-gray-900 mb-1">New Conversation</h2>
            <p className="text-xs text-gray-500 mb-4">Enter a 10-digit phone number</p>
            <input
              className="input mb-3"
              placeholder="9876543210"
              value={phone}
              onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
              inputMode="numeric"
              autoFocus
            />
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => setOpen(false)}>Cancel</button>
              <button
                className="btn-primary flex-1 disabled:opacity-50"
                disabled={phone.replace(/\D/g, '').length !== 10}
                onClick={handleStart}
              >
                Open Chat
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
