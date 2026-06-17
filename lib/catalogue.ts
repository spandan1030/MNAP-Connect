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

// Add a single new allowed value (for the values-management screen)
export async function addCatalogueValue(field: OptionField, value: string) {
  const v = value.trim()
  if (!v) return
  const supabase = createClient()
  await supabase.from('wa_catalogue_options').upsert([{ field, value: v }], { onConflict: 'field,value', ignoreDuplicates: true })
}

// Rename / merge a value: re-classify every product using `oldValue` to `newValue`,
// then drop the old option and ensure the new one exists. If `newValue` already
// existed, the two simply merge.
export async function renameCatalogueValue(field: OptionField, oldValue: string, newValue: string) {
  const supabase = createClient()
  const next = newValue.trim()
  if (!next || next === oldValue) return
  // 1) Re-tag all products that carry the old value
  await supabase.from('wa_products').update({ [field]: next, updated_at: new Date().toISOString() }).eq(field, oldValue)
  // 2) Make sure the new value is a known option
  await supabase.from('wa_catalogue_options').upsert([{ field, value: next }], { onConflict: 'field,value', ignoreDuplicates: true })
  // 3) Remove the now-unused old option
  await supabase.from('wa_catalogue_options').delete().eq('field', field).eq('value', oldValue)
}

// Delete an allowed value from the dropdown list (does not touch products)
export async function deleteCatalogueValue(field: OptionField, value: string) {
  const supabase = createClient()
  await supabase.from('wa_catalogue_options').delete().eq('field', field).eq('value', value)
}
