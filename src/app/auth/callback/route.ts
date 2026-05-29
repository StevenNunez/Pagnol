import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url);
    const code = searchParams.get('code');
    const next = searchParams.get('next') ?? '/dashboard';

    // Only allow relative redirects to prevent open-redirect attacks
    const safeNext = next.startsWith('/') ? next : '/dashboard';

    if (code) {
        // PKCE flow: exchange the code for a session (used by password reset)
        const cookieStore = await cookies();
        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    getAll() { return cookieStore.getAll(); },
                    setAll(cookiesToSet) {
                        cookiesToSet.forEach(({ name, value, options }) =>
                            cookieStore.set(name, value, options)
                        );
                    },
                },
            }
        );

        const { data, error } = await supabase.auth.exchangeCodeForSession(code);

        if (!error && data.session) {
            return NextResponse.redirect(`${origin}${safeNext}`);
        }

        // PKCE exchange failed — redirect to login with error
        return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
    }

    // No code present → implicit flow (Google OAuth sends tokens in the URL hash).
    // The hash is invisible server-side; redirect to the destination and let the
    // client-side Supabase SDK pick up the tokens from the hash automatically.
    return NextResponse.redirect(`${origin}${safeNext}`);
}
