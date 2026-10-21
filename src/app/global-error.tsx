'use client';

// Reemplaza al layout raíz cuando éste mismo falla, así que define su propio
// <html> y no puede depender de Tailwind ni de los tokens de la app.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
    return (
        <html lang="es">
            <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#f8fafc', color: '#0f172a' }}>
                <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
                    <div style={{ maxWidth: 420, textAlign: 'center' }}>
                        <p style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px' }}>Pagnol no pudo cargar</p>
                        <p style={{ fontSize: 14, color: '#475569', margin: '0 0 20px' }}>
                            Tus datos están a salvo. Intenta de nuevo; si sigue pasando, avisa a soporte.
                        </p>
                        {error.digest && <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 16px' }}>Ref. {error.digest}</p>}
                        <button
                            onClick={() => retry()}
                            style={{ background: '#ea580c', color: '#fff', border: 0, borderRadius: 12, padding: '10px 20px', fontWeight: 700, cursor: 'pointer' }}
                        >
                            Reintentar
                        </button>
                    </div>
                </main>
            </body>
        </html>
    );
}
