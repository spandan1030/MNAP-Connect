// Firebase Admin — SERVER-ONLY. Used to mirror published catalogue products into
// the M N Alankar Palace CUSTOMER app's Firestore (a separate Firebase project).
//
// Credentials come from a single env var FIREBASE_SERVICE_ACCOUNT_KEY holding the
// JSON of a service-account key for the `mnap-customer` project
// (Firebase console → Project settings → Service accounts → Generate new private
// key). Set it in Vercel (Production + Preview) and in .env.local for local dev.
// NEVER expose this to the browser — this file must only be imported from server
// code (API route handlers).

import { getApps, initializeApp, cert, type App } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

let _db: Firestore | null = null

function serviceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY
  if (!raw) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_KEY is not set. Add the mnap-customer service-account JSON to the environment.'
    )
  }
  // The JSON may be stored as-is or with escaped newlines in the private key.
  const parsed = JSON.parse(raw) as { project_id: string; client_email: string; private_key: string }
  parsed.private_key = parsed.private_key.replace(/\\n/g, '\n')
  return parsed
}

function app(): App {
  const existing = getApps().find((a) => a.name === 'catalogue-sync')
  if (existing) return existing
  const sa = serviceAccount()
  return initializeApp(
    {
      credential: cert({
        projectId: sa.project_id,
        clientEmail: sa.client_email,
        privateKey: sa.private_key,
      }),
      projectId: sa.project_id,
    },
    'catalogue-sync'
  )
}

/** Firestore handle for the CUSTOMER app's project. Lazy + singleton. */
export function customerDb(): Firestore {
  if (!_db) _db = getFirestore(app())
  return _db
}
