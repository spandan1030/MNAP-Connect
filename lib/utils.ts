import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  })
}

export function buildWhatsAppUrl(phone: string, message: string) {
  const cleaned = phone.replace(/\D/g, '')
  const number = cleaned.startsWith('91') ? cleaned : `91${cleaned}`
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`
}

interface Rates {
  rate_24kt: number | null
  rate_22kt: number | null
  rate_18kt: number | null
}

function fmtRate(val: number | null) {
  if (val == null) return '—'
  return val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function applyPlaceholders(template: string, customerName: string, rates?: Rates | null) {
  let out = template.replace(/\{name\}/g, customerName)
  if (rates) {
    out = out
      .replace(/\{rate_24kt\}/g, fmtRate(rates.rate_24kt))
      .replace(/\{rate_22kt\}/g, fmtRate(rates.rate_22kt))
      .replace(/\{rate_18kt\}/g, fmtRate(rates.rate_18kt))
  }
  return out
}
