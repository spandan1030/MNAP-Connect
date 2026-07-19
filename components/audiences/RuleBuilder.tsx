'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FIELDS, FIELD_BY_KEY, opsFor, INTEREST_SOURCE_OPTIONS,
  type Rule, type RuleGroup, type RuleTree, type RuleOp, type FieldDef,
} from '@/lib/audiences/rules'

// The rule builder. Boxes are OR'd, rules inside a box are AND'd, and any rule
// can be negated — that is the entire grammar, and it is visible on screen
// rather than implied by which band a chip sits in.
//
// Every rule shows how many people it matches ON ITS OWN, next to the box total
// and the audience total. A rule that matches nobody is obvious while you build
// instead of after you save.

type Opt = { value: string; label: string }

interface CountResult { total: number; groups: { total: number; rules: (number | null)[] }[] }

export default function RuleBuilder({ tree, onChange, dynamicOptions }: {
  tree: RuleTree
  onChange: (t: RuleTree) => void
  dynamicOptions?: Partial<Record<'call_campaigns' | 'topics' | 'ad_campaigns', Opt[]>>
}) {
  const [counts, setCounts] = useState<CountResult | null>(null)
  const [counting, setCounting] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced live counts — one request per settled edit, not per keystroke.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    const hasAny = tree.groups?.some(g => g.rules?.length)
    if (!hasAny) { setCounts(null); return }
    setCounting(true)
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/audiences/count', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rules: tree }),
        })
        setCounts(res.ok ? await res.json() : null)
      } catch { setCounts(null) } finally { setCounting(false) }
    }, 500)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [tree])

  const groups = tree.groups?.length ? tree.groups : [{ rules: [] }]

  const setGroup = useCallback((gi: number, g: RuleGroup) => {
    const next = groups.map((old, i) => (i === gi ? g : old))
    onChange({ groups: next })
  }, [groups, onChange])

  const setRule = (gi: number, ri: number, r: Rule) =>
    setGroup(gi, { rules: groups[gi].rules.map((old, i) => (i === ri ? r : old)) })

  const addRule = (gi: number) =>
    setGroup(gi, { rules: [...groups[gi].rules, { field: 'sales_recency_tier', op: 'any_of', values: [] }] })

  const removeRule = (gi: number, ri: number) => {
    const rules = groups[gi].rules.filter((_, i) => i !== ri)
    if (!rules.length && groups.length > 1) onChange({ groups: groups.filter((_, i) => i !== gi) })
    else setGroup(gi, { rules })
  }

  const addGroup = () => onChange({ groups: [...groups, { rules: [] }] })

  return (
    <div className="space-y-2">
      {groups.map((g, gi) => (
        <div key={gi}>
          {gi > 0 && (
            <div className="flex items-center gap-2 my-2">
              <div className="h-px flex-1 bg-gray-200" />
              <span className="text-[10px] font-bold text-gray-500 tracking-wider px-2 py-0.5 rounded-full border border-gray-200 bg-white">OR</span>
              <div className="h-px flex-1 bg-gray-200" />
            </div>
          )}

          <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-2.5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-bold text-gray-600">
                {groups.length > 1 ? `Group ${gi + 1}` : 'Match all of these'}
              </p>
              {counts?.groups?.[gi] != null && (
                <span className="text-[10px] font-medium text-gray-500">
                  {counts.groups[gi].total.toLocaleString('en-IN')} people
                </span>
              )}
            </div>

            <div className="space-y-1.5">
              {g.rules.map((r, ri) => (
                <div key={ri}>
                  {ri > 0 && <p className="text-[10px] font-bold text-gray-400 ml-1 mb-1">AND</p>}
                  <RuleRow
                    rule={r}
                    count={counts?.groups?.[gi]?.rules?.[ri] ?? null}
                    dynamicOptions={dynamicOptions}
                    onChange={next => setRule(gi, ri, next)}
                    onRemove={() => removeRule(gi, ri)}
                  />
                </div>
              ))}
              {!g.rules.length && <p className="text-[11px] text-gray-400 px-1 py-2">No rules yet.</p>}
            </div>

            <button onClick={() => addRule(gi)}
              className="mt-2 text-[11px] font-semibold text-green-700 border border-green-200 bg-white rounded-lg px-2.5 py-1">
              + Add rule
            </button>
          </div>
        </div>
      ))}

      <div className="flex items-center justify-between pt-1">
        <button onClick={addGroup}
          className="text-[11px] font-semibold text-gray-600 border border-gray-200 bg-white rounded-lg px-2.5 py-1">
          + OR another group
        </button>
        <span className="text-[11px] font-bold text-gray-700">
          {counting ? 'counting…' : counts ? `${counts.total.toLocaleString('en-IN')} people match` : ''}
        </span>
      </div>
    </div>
  )
}

// ── one rule row ───────────────────────────────────────────────────────────
function RuleRow({ rule, count, onChange, onRemove, dynamicOptions }: {
  rule: Rule
  count: number | null
  onChange: (r: Rule) => void
  onRemove: () => void
  dynamicOptions?: Partial<Record<string, Opt[]>>
}) {
  const f = FIELD_BY_KEY[rule.field]
  const ops = f ? opsFor(f.type) : []
  const options: Opt[] = f?.options ?? (f?.optionsFrom ? dynamicOptions?.[f.optionsFrom] ?? [] : [])

  // Changing the field resets the operator + value: an operator from the old
  // type would be meaningless against the new one.
  function pickField(key: string) {
    const nf = FIELD_BY_KEY[key]
    onChange({ field: key, op: opsFor(nf.type)[0].op, values: [], not: rule.not })
  }

  const grouped = FIELDS.reduce<Record<string, FieldDef[]>>((acc, fd) => {
    (acc[fd.group] ??= []).push(fd); return acc
  }, {})

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-2">
      <div className="flex items-center gap-1.5">
        <select value={rule.field} onChange={e => pickField(e.target.value)}
          className="input !py-1 text-[12px] flex-1 min-w-0">
          {Object.entries(grouped).map(([grp, list]) => (
            <optgroup key={grp} label={grp}>
              {list.map(fd => <option key={fd.key} value={fd.key}>{fd.label}</option>)}
            </optgroup>
          ))}
        </select>

        <select value={rule.op} onChange={e => onChange({ ...rule, op: e.target.value as RuleOp })}
          className="input !py-1 text-[12px] w-[42%] min-w-0">
          {ops.map(o => <option key={o.op} value={o.op}>{o.label}</option>)}
        </select>

        <button onClick={() => onChange({ ...rule, not: !rule.not })}
          title="Exclude these people instead"
          className={`text-[10px] font-bold px-2 py-1 rounded-lg border shrink-0 ${
            rule.not ? 'bg-red-600 text-white border-red-600' : 'bg-white text-gray-400 border-gray-200'}`}>
          NOT
        </button>
        <button onClick={onRemove} className="text-gray-300 hover:text-red-500 px-1 shrink-0" title="Remove">×</button>
      </div>

      <ValueEditor rule={rule} field={f} options={options} onChange={onChange} />

      {f?.hint && <p className="text-[10px] text-gray-400 mt-1">{f.hint}</p>}
      {count != null && (
        <p className={`text-[10px] mt-1 font-medium ${count === 0 ? 'text-red-600' : 'text-gray-500'}`}>
          this rule alone: {count.toLocaleString('en-IN')}{count === 0 ? ' — matches nobody' : ''}
        </p>
      )}
    </div>
  )
}

// ── value editors, chosen by the field's type + the operator ───────────────
function ValueEditor({ rule, field, options, onChange }: {
  rule: Rule; field?: FieldDef; options: Opt[]; onChange: (r: Rule) => void
}) {
  if (!field) return null
  const toggle = (v: string) => {
    const cur = rule.values ?? []
    onChange({ ...rule, values: cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v] })
  }
  const toggleSrc = (v: string) => {
    const cur = rule.sources ?? []
    onChange({ ...rule, sources: cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v] })
  }

  if (rule.op === 'exists' || rule.op === 'is_true') return null

  if (field.type === 'interest') {
    return (
      <div className="mt-1.5 space-y-1.5">
        <ChipRow options={options} selected={rule.values ?? []} onToggle={toggle} />
        {rule.op === 'in_last_days'
          ? <NumInput label="days" value={rule.days} onChange={n => onChange({ ...rule, days: n })} />
          : (
            <div>
              <p className="text-[10px] text-gray-400 mb-1">from channel <span className="text-gray-300">(any if none picked)</span></p>
              <ChipRow options={INTEREST_SOURCE_OPTIONS} selected={rule.sources ?? []} onToggle={toggleSrc} />
            </div>
          )}
      </div>
    )
  }

  if (rule.op === 'any_of') {
    return options.length
      ? <div className="mt-1.5"><ChipRow options={options} selected={rule.values ?? []} onToggle={toggle} /></div>
      : <p className="text-[10px] text-gray-400 mt-1.5">No options available.</p>
  }

  if (field.type === 'number') {
    if (rule.op === 'between') return (
      <div className="mt-1.5 flex items-center gap-2">
        <NumInput label="from" value={rule.min} onChange={n => onChange({ ...rule, min: n })} />
        <NumInput label="to" value={rule.max} onChange={n => onChange({ ...rule, max: n })} />
      </div>
    )
    const isMin = rule.op === 'gte'
    return <div className="mt-1.5"><NumInput label={isMin ? 'at least' : 'at most'}
      value={isMin ? rule.min : rule.max}
      onChange={n => onChange({ ...rule, [isMin ? 'min' : 'max']: n })} /></div>
  }

  if (field.type === 'date') {
    if (rule.op === 'in_last_days') return <div className="mt-1.5"><NumInput label="days" value={rule.days} onChange={n => onChange({ ...rule, days: n })} /></div>
    if (rule.op === 'between') return (
      <div className="mt-1.5 flex items-center gap-2">
        <input type="date" className="input !py-1 text-[12px]" value={rule.from ?? ''} onChange={e => onChange({ ...rule, from: e.target.value })} />
        <span className="text-[11px] text-gray-400">→</span>
        <input type="date" className="input !py-1 text-[12px]" value={rule.to ?? ''} onChange={e => onChange({ ...rule, to: e.target.value })} />
      </div>
    )
    const key = rule.op === 'after' ? 'from' : 'to'
    return <div className="mt-1.5"><input type="date" className="input !py-1 text-[12px]"
      value={(rule[key] as string) ?? ''} onChange={e => onChange({ ...rule, [key]: e.target.value })} /></div>
  }

  return null
}

function ChipRow({ options, selected, onToggle }: { options: Opt[]; selected: string[]; onToggle: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map(o => (
        <button key={o.value} onClick={() => onToggle(o.value)}
          className={`px-2 py-0.5 rounded-lg text-[11px] border font-medium ${
            selected.includes(o.value) ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-200'}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function NumInput({ label, value, onChange }: { label: string; value?: number; onChange: (n: number | undefined) => void }) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-[10px] text-gray-400">{label}</span>
      <input type="number" inputMode="numeric" className="input !py-1 text-[12px] w-28"
        value={value ?? ''} onChange={e => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
    </label>
  )
}
