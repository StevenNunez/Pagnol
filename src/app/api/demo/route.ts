import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST() {
    const email = process.env.DEMO_EMAIL;
    const password = process.env.DEMO_PASSWORD;

    if (!email || !password) {
        return NextResponse.json({ error: 'Demo no disponible en este momento.' }, { status: 503 });
    }

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data.session) {
        return NextResponse.json({ error: 'No se pudo iniciar la sesión demo.' }, { status: 401 });
    }

    return NextResponse.json({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
    });
}
