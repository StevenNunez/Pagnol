'use client';

import React from 'react';
import Link from 'next/link';
import { ScanFace, X } from 'lucide-react';
import { supabase } from '@/modules/core/lib/supabase';
import { useAuth } from '@/modules/core/contexts/app-provider';
import { Button } from '@/components/ui/button';

/**
 * Aviso para quien tiene un registro facial que se puede confundir con el de
 * otra persona.
 *
 * Aparece **sólo si le pasa a quien está mirando**, no a todo el mundo: en una
 * faena con la gente ya enrolada, pedirle a todos que se vuelvan a registrar es
 * carísimo, y un aviso que le sale a todos se ignora a los dos días.
 *
 * No dice con quién se confunde. Esa información no le sirve a la persona y es
 * un dato de otra (ver la nota en `/api/biometric/enrollment-quality`).
 *
 * Se puede cerrar, y no vuelve a molestar en esa sesión: el registro sigue
 * funcionando, sólo que sin holgura — no es un bloqueo.
 */
export function EnrollmentQualityBanner() {
    const { user } = useAuth();
    const [nivel, setNivel] = React.useState<string | null>(null);
    const [cerrado, setCerrado] = React.useState(false);

    React.useEffect(() => {
        if (!user?.id) return;
        let vivo = true;
        (async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                if (!session?.access_token) return;
                const r = await fetch('/api/biometric/enrollment-quality', {
                    headers: { Authorization: `Bearer ${session.access_token}` },
                });
                if (!r.ok) return;
                const { nivel } = await r.json();
                if (vivo) setNivel(nivel);
            } catch {
                // Un aviso de calidad no puede romper el panel: si falla, no se muestra.
            }
        })();
        return () => { vivo = false; };
    }, [user?.id]);

    if (cerrado || nivel !== 'confundible') return null;

    return (
        <div className="flex items-start gap-3 p-4 rounded-[1.5rem] bg-warning-subtle text-warning-subtle-foreground border border-warning/30">
            <ScanFace size={18} className="shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
                <p className="text-[10px] font-black uppercase tracking-widest">
                    Conviene repetir tu registro facial
                </p>
                <p className="text-xs mt-1 leading-snug">
                    Tu rostro quedó registrado con poco margen y el sistema podría confundirte con
                    otra persona al entregarte un equipo. Repetirlo toma un minuto y ahora se
                    registra con varias tomas, así que queda bastante mejor.
                </p>
                <Link href="/dashboard/profile" className="inline-block mt-2">
                    <Button size="sm" variant="outline" className="rounded-xl gap-2 h-8 text-xs">
                        <ScanFace size={13} /> Repetir mi registro
                    </Button>
                </Link>
            </div>
            <button
                type="button"
                onClick={() => setCerrado(true)}
                aria-label="Cerrar aviso"
                className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
            >
                <X size={16} />
            </button>
        </div>
    );
}
