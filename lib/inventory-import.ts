// Inventory-import parsing (SERVER-ONLY).
//
// Turns the store software's item-status xlsx export into normalized rows for the
// wa_inventory master table. Pure functions — no DB access here; the API route
// owns persistence. The master is reference data for fast Add+ prefill and status
// resync; importing NEVER creates product cards.

import * as XLSX from 'xlsx'
import type { StockStatus } from '@/lib/types'

// Software BCM_STATUS → our product stock_status. Only these three drive a status
// change on an existing product card at import time. Any other raw status
// (Estm / Approval / Remove …) is still stored on the inventory master (so barcode
// lookup works) but never touches a product card.
export const STATUS_MAP: Record<string, StockStatus> = {
  NEW: 'in_stock',
  SALE: 'sold',
  DELETED: 'deleted',
}

/** Map a raw software status to a product stock_status, or null if unmapped. */
export function mapStatus(raw: string | null): StockStatus | null {
  if (!raw) return null
  return STATUS_MAP[raw.trim().toUpperCase()] ?? null
}

export interface InventoryRow {
  barcode: string
  itm_id: number | null
  item_name_raw: string | null
  party_id: number | null
  dsgn_id: number | null
  design_raw: string | null
  purt_id: number | null
  purity_raw: string | null
  grd_id: number | null
  grade_raw: string | null
  net_weight: number | null
  bcm_creation_date: string | null
  bcm_status: string | null
  sold_date: string | null
  deleted_date: string | null
}

export interface ParseResult {
  rows: InventoryRow[]                   // valid rows (barcode present), de-duped by barcode (last wins)
  totalRows: number                      // data rows seen (excluding the header)
  skipped: number                        // rows dropped for a missing barcode
  duplicates: number                     // duplicate barcodes collapsed (last wins)
  statusCounts: Record<string, number>   // raw BCM_STATUS → count across valid rows
}

// The columns we read from the export (case-insensitive header match).
const COLS = {
  barcode: 'BARCODE',
  itm_id: 'ITM_ID',
  item_name: 'ITEM_NAME',
  party_id: 'PARTY_ID',
  dsgn_id: 'DSGN_ID',
  design: 'DESIGN',
  purt_id: 'PURT_ID',
  purity: 'PURITY',
  grd_id: 'GRD_ID',
  grade: 'GRADE',
  net_weight: 'NET_WEIGHT',
  bcm_creation_date: 'BCM_CREATION_DATE',
  bcm_status: 'BCM_STATUS',
  sold_date: 'SOLD_DATE',
  deleted_date: 'DELETED_DATE',
} as const

// The software exports empty cells as the literal text "NULL" (seen in the date
// columns). Treat that — and blanks — as empty everywhere so it never leaks in as data.
function blank(v: unknown): boolean {
  if (v == null) return true
  const s = String(v).trim()
  return s === '' || s.toUpperCase() === 'NULL'
}

function str(v: unknown): string | null {
  if (blank(v)) return null
  return String(v).trim()
}

function int(v: unknown): number | null {
  if (blank(v)) return null
  const n = Number(String(v).trim())
  return Number.isFinite(n) ? Math.trunc(n) : null
}

function num(v: unknown): number | null {
  if (blank(v)) return null
  const n = Number(String(v).trim())
  return Number.isFinite(n) ? n : null
}

// Dates arrive as JS Date (cellDates:true), Excel serial numbers, or strings.
function iso(v: unknown): string | null {
  if (blank(v)) return null
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString()
  if (typeof v === 'number') {
    // Excel serial day (1900 date system): day 25569 = 1970-01-01.
    const ms = Math.round((v - 25569) * 86400 * 1000)
    const d = new Date(ms)
    return isNaN(d.getTime()) ? null : d.toISOString()
  }
  const d = new Date(String(v))
  return isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * Parse a workbook buffer into normalized inventory rows. Accepts BOTH .xlsx and
 * .csv — XLSX.read auto-detects the format from the buffer (and parses CSV date
 * strings when it recognizes them; unrecognized date formats degrade to null).
 * Reads the first sheet, matches columns by header name (case-insensitive),
 * drops rows without a barcode, and collapses duplicate barcodes (last wins).
 * Throws if the file can't be read or has no BARCODE column.
 */
export function parseInventoryWorkbook(data: Buffer | ArrayBuffer): ParseResult {
  const wb = XLSX.read(data, { cellDates: true })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) throw new Error('The file has no sheets.')
  const ws = wb.Sheets[sheetName]
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, blankrows: false })
  if (aoa.length < 2) throw new Error('The file has no data rows.')

  const header = (aoa[0] as unknown[]).map(h => String(h ?? '').trim().toUpperCase())
  const at = (name: string) => header.indexOf(name)
  const idx: Record<keyof typeof COLS, number> = Object.fromEntries(
    Object.entries(COLS).map(([k, v]) => [k, at(v)]),
  ) as Record<keyof typeof COLS, number>

  if (idx.barcode < 0) throw new Error('No BARCODE column found in the file.')

  const byBarcode = new Map<string, InventoryRow>()
  const statusCounts: Record<string, number> = {}
  let totalRows = 0
  let skipped = 0
  let duplicates = 0

  for (let r = 1; r < aoa.length; r++) {
    const row = aoa[r] as unknown[]
    if (!row || row.length === 0) continue
    totalRows++
    const cell = (c: number) => (c >= 0 ? row[c] : null)

    const barcode = str(cell(idx.barcode))
    if (!barcode) { skipped++; continue }

    const rawStatus = str(cell(idx.bcm_status))
    if (rawStatus) statusCounts[rawStatus] = (statusCounts[rawStatus] ?? 0) + 1

    const rec: InventoryRow = {
      barcode,
      itm_id: int(cell(idx.itm_id)),
      item_name_raw: str(cell(idx.item_name)),
      party_id: int(cell(idx.party_id)),
      dsgn_id: int(cell(idx.dsgn_id)),
      design_raw: str(cell(idx.design)),
      purt_id: int(cell(idx.purt_id)),
      purity_raw: str(cell(idx.purity)),
      grd_id: int(cell(idx.grd_id)),
      grade_raw: str(cell(idx.grade)),
      net_weight: num(cell(idx.net_weight)),
      bcm_creation_date: iso(cell(idx.bcm_creation_date)),
      bcm_status: rawStatus,
      sold_date: iso(cell(idx.sold_date)),
      deleted_date: iso(cell(idx.deleted_date)),
    }

    const key = barcode.toLowerCase()
    if (byBarcode.has(key)) duplicates++
    byBarcode.set(key, rec)
  }

  return { rows: [...byBarcode.values()], totalRows, skipped, duplicates, statusCounts }
}
