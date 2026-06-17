import { createClient } from '@/lib/supabase/client'

export type OptionField = 'item_name' | 'design' | 'description' | 'purity' | 'party'
export type Options = Record<OptionField, string[]>

const EMPTY: Options = { item_name: [], design: [], description: [], purity: [], party: [] }

// All managed dropdown values, grouped by field
export async function fetchCatalogueOptions(): Promise<Options> {
  const supabase = createClient()
  const { data } = await supabase.from('wa_catalogue_options').select('field, value').order('value')
  const grouped: Options = { item_name: [], design: [], description: [], purity: [], party: [] }
  for (const r of (data ?? [])) {
    const f = r.field as OptionField
    if (grouped[f]) grouped[f].push(r.value)
  }
  return grouped ?? EMPTY
}

// Add any newly-typed values so they become available in future dropdowns
export async function addCatalogueOptions(entries: Array<{ field: OptionField; value: string | null | undefined }>) {
  const supabase = createClient()
  const rows = entries
    .filter(e => e.value && e.value.trim())
    .map(e => ({ field: e.field, value: e.value!.trim() }))
  if (rows.length) {
    await supabase.from('wa_catalogue_options').upsert(rows, { onConflict: 'field,value', ignoreDuplicates: true })
  }
}
