import { NextResponse } from 'next/server';
import { getOpenApiDocument } from '@/lib/api/openapi';

// Público: los sistemas integrados generan sus tipos desde aquí.
export function GET() {
    return NextResponse.json(getOpenApiDocument(), {
        headers: { 'Cache-Control': 'public, max-age=300' },
    });
}
