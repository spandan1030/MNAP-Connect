import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  const { pathname } = request.nextUrl

  // Public, self-authenticating endpoints that must bypass the login redirect:
  //  · /api/whatsapp/*          — Meta webhook (verified by signature)
  //  · /api/invoices/feedback   — the customer app posts birthday/anniversary +
  //                               review here server-to-server (no cookie), gated
  //                               by the x-publish-secret shared secret. The other
  //                               /api/invoices/* routes are admin and stay gated.
  const isPublicApi =
    pathname.startsWith('/api/whatsapp/') || pathname === '/api/invoices/feedback'

  if (!user && pathname !== '/login' && pathname !== '/enroll' && pathname !== '/enroll/success' && !isPublicApi) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (user && pathname === '/login') {
    return NextResponse.redirect(new URL('/send', request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
