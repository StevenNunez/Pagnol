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
            // If this is a password recovery session, always go to update-password
            const isRecovery =
                data.session.user?.recovery_sent_at !== undefined &&
                safeNext === '/update-password';

            return NextResponse.redirect(`${origin}${safeNext}`);
        }
    }

    // Something went wrong — send to login with error param
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
