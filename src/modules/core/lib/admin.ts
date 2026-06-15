import { getSupabaseAdmin } from '@/modules/core/lib/supabase';

// Cliente admin (service role) como singleton, reutilizando la ÚNICA factory
// definida en supabase.ts (antes había dos createClient con service role).
// Bypassa RLS; solo para uso server-side.
export const supabaseAdmin = getSupabaseAdmin();
