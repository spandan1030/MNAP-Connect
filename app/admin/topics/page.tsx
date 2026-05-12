'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Navbar from '@/components/ui/Navbar'
import type { InterestTopic } from '@/lib/types'

export default function TopicsPage() {
  const supabase = createClient()
  const [topics, setTopics] = useState<InterestTopic[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [newParent, setNewParent] = useState<string>('none')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { loadTopics() }, [])

  async function loadTopics() {
    setLoading(true)
    const { data } = await supabase.from('wa_interest_topics').select('*').order('sort_order')
    setTopics(data ?? [])
    setLoading(false)
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setAdding(true); setError('')
    const { error } = await supabase.from('wa_interest_topics').insert({
      name: newName.trim(),
      parent_id: newParent === 'none' ? null : newParent,
      sort_order: topics.length,
    })
    if (error) { setError(error.message); setAdding(false); return }
    setNewName(''); setNewParent('none')
    setAdding(false)
    loadTopics()
  }

  async function toggleActive(topic: InterestTopic) {
    await supabase.from('wa_interest_topics').update({ is_active: !topic.is_active }).eq('id', topic.id)
    loadTopics()
  }

  const parents = topics.filter(t => !t.parent_id)
  const childTopics = (parentId: string) => topics.filter(t => t.parent_id === parentId)

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-4 space-y-4">
        <h1 className="text-lg font-bold text-gray-900">Interest Topics</h1>

        {/* Add form */}
        <form onSubmit={handleAdd} className="card p-4 space-y-3">
          <p className="text-sm font-semibold text-gray-700">Add New Topic</p>
          <input
            type="text" value={newName}
            onChange={e => setNewName(e.target.value)}
            className="input" placeholder="Topic name" required
          />
          <select value={newParent} onChange={e => setNewParent(e.target.value)} className="input">
            <option value="none">Top-level category</option>
            {parents.map(p => (
              <option key={p.id} value={p.id}>Under: {p.name}</option>
            ))}
          </select>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button type="submit" disabled={adding} className="btn-primary w-full py-2.5">
            {adding ? 'Adding…' : 'Add Topic'}
          </button>
        </form>

        {/* Topic tree */}
        {loading ? (
          <p className="text-sm text-gray-400 text-center py-4">Loading…</p>
        ) : (
          <div className="space-y-3">
            {parents.map(parent => (
              <div key={parent.id} className="card overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
                  <span className="font-semibold text-sm text-gray-900">{parent.name}</span>
                  <button
                    onClick={() => toggleActive(parent)}
                    className={`text-xs px-3 py-1 rounded-full font-medium border transition-colors ${
                      parent.is_active
                        ? 'bg-green-50 text-green-700 border-green-200'
                        : 'bg-gray-100 text-gray-500 border-gray-200'
                    }`}
                  >
                    {parent.is_active ? 'Active' : 'Inactive'}
                  </button>
                </div>
                {childTopics(parent.id).map(sub => (
                  <div key={sub.id} className="flex items-center justify-between px-4 py-2.5 border-b border-gray-50 last:border-0">
                    <span className="text-sm text-gray-700 pl-3">↳ {sub.name}</span>
                    <button
                      onClick={() => toggleActive(sub)}
                      className={`text-xs px-3 py-1 rounded-full font-medium border transition-colors ${
                        sub.is_active
                          ? 'bg-green-50 text-green-700 border-green-200'
                          : 'bg-gray-100 text-gray-500 border-gray-200'
                      }`}
                    >
                      {sub.is_active ? 'Active' : 'Inactive'}
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
