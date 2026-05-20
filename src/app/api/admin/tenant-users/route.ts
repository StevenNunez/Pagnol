import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/modules/core/lib/supabase";
import { createClient } from "@supabase/supabase-js";

// Verify caller is authenticated and is super-admin
async function verifySuperAdmin(req: NextRequest) {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return null;

    const token = authHeader.replace("Bearer ", "");
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return null;

    // Check role in profiles
    const admin = getSupabaseAdmin();
    const { data: profile } = await admin
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

    if (profile?.role !== "super-admin") return null;
    return user;
}

// GET /api/admin/tenant-users?tenantId=xxx&countOnly=true
export async function GET(req: NextRequest) {
    const caller = await verifySuperAdmin(req);
    if (!caller) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const tenantId = req.nextUrl.searchParams.get("tenantId");
    const countOnly = req.nextUrl.searchParams.get("countOnly") === "true";

    if (!tenantId) {
        return NextResponse.json({ error: "tenantId requerido" }, { status: 400 });
    }

    const admin = getSupabaseAdmin();

    if (countOnly) {
        const { count, error } = await admin
            .from("profiles")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", tenantId)
            .is("deleted_at", null);

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ count: count ?? 0 });
    }

    const { data, error } = await admin
        .from("profiles")
        .select("id, name, email, role, is_active")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("name");

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ users: data ?? [] });
}
