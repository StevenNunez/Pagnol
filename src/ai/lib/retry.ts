/**
 * Reintenta una llamada a la API de Gemini cuando el modelo devuelve 503 (alta demanda)
 * o 429 (quota excedida). Usa backoff exponencial: 2s, 4s, 8s.
 *
 * Errores reintentables:
 *   UNAVAILABLE      → 503 Service Unavailable (alta demanda temporal)
 *   RESOURCE_EXHAUSTED → 429 Rate limit / quota
 */

const RETRYABLE = new Set(['UNAVAILABLE', 'RESOURCE_EXHAUSTED']);
const RETRYABLE_CODES = new Set([429, 503]);

interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  label?: string;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  { maxRetries = 3, baseDelayMs = 2000, label = 'AI' }: RetryOptions = {}
): Promise<T> {
  let lastErr: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;

      const retryable =
        RETRYABLE.has(err?.status) ||
        RETRYABLE_CODES.has(err?.code) ||
        RETRYABLE_CODES.has(err?.httpStatus);

      if (!retryable || attempt === maxRetries) throw err;

      const delayMs = baseDelayMs * Math.pow(2, attempt);
      console.warn(
        `[${label}] Intento ${attempt + 1}/${maxRetries} fallido ` +
        `(${err?.status ?? err?.code ?? 'error'}). ` +
        `Reintentando en ${delayMs / 1000}s...`
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  throw lastErr;
}
