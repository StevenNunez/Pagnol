import { chromium } from '@playwright/test';

const BASE = 'http://localhost:3000';

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();

const results = [];
const log = (msg, ok = true) => {
  results.push({ ok, msg });
  console.log((ok ? '✅' : '❌') + ' ' + msg);
};

// ── 1. Login page ─────────────────────────────────────────────────────────────
await page.goto(BASE + '/login');
await page.waitForLoadState('networkidle');
log('Login page carga');

const hasGoogle  = await page.locator('text=Continuar con Google').isVisible();
const hasForgot  = await page.locator('text=Olvidó su clave').isVisible();
const hasRegLink = await page.locator('a[href="/register"]').isVisible();
log('Botón Google visible', hasGoogle);
log('Link "¿Olvidó su clave?"', hasForgot);
log('Link "Registrar empresa"', hasRegLink);
await page.screenshot({ path: 'C:/tmp/01-login.png' });

// ── 2. Register – flujo email/password (normal) ───────────────────────────────
await page.goto(BASE + '/register');
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1000);
log('Register (email) page carga');

const hasPasswordFields = (await page.locator('input[type="password"]').count()) >= 2;
const hasCompanyField   = await page.locator('input[placeholder*="Minera"]').isVisible().catch(() => false);
const hasEmailField     = await page.locator('input[type="email"]').isVisible().catch(() => false);
log('Tiene campos de contraseña', hasPasswordFields);
log('Tiene campo Razón Social', hasCompanyField);
log('Tiene campo email editable', hasEmailField);
await page.screenshot({ path: 'C:/tmp/02-register-email.png' });

// ── 3. Register – flujo OAuth (Google) ───────────────────────────────────────
await page.goto(BASE + '/register?oauth=1');
await page.waitForLoadState('networkidle');
await page.waitForTimeout(2500);

const urlAfterOAuth = page.url();
const redirectedToLogin = urlAfterOAuth.includes('/login');

if (redirectedToLogin) {
  log('Sin sesión Google → redirige correctamente a /login (comportamiento esperado)', true);
} else {
  // Si hay sesión (no aplica en headless sin Google auth real)
  const hasGoogleBanner    = await page.locator('text=Cuenta Google verificada').isVisible().catch(() => false);
  const hasNoPassword      = (await page.locator('input[type="password"]').count()) === 0;
  const hasReadonlyEmail   = await page.locator('input[readonly]').isVisible().catch(() => false);
  log('Banner "Cuenta Google verificada" visible', hasGoogleBanner);
  log('Sin campos de contraseña en modo OAuth', hasNoPassword);
  log('Email es readonly', hasReadonlyEmail);
}
await page.screenshot({ path: 'C:/tmp/03-register-oauth.png' });

// ── 4. Reset password ─────────────────────────────────────────────────────────
await page.goto(BASE + '/reset-password');
await page.waitForLoadState('networkidle');
log('Reset password page carga');

const hasGoogleHint = await page.locator('text=cuenta Google').isVisible().catch(() => false);
const hasEmailInput = await page.locator('input[type="email"]').isVisible().catch(() => false);
const hasSendBtn    = await page.locator('button[type="submit"]').isVisible().catch(() => false);
log('Hint para usuarios Google visible', hasGoogleHint);
log('Input de email visible', hasEmailInput);
log('Botón "Enviar enlace" visible', hasSendBtn);
await page.screenshot({ path: 'C:/tmp/04-reset-password.png' });

// ── 5. Update password sin token (debe mostrar "Enlace Inválido") ─────────────
await page.goto(BASE + '/update-password');
await page.waitForLoadState('networkidle');
await page.waitForTimeout(3500);

const showsInvalid  = await page.locator('text=Enlace Inválido').isVisible().catch(() => false);
const showsLoading  = await page.locator('text=Verificando').isVisible().catch(() => false);
const showsNewLink  = await page.locator('text=Solicitar nuevo enlace').isVisible().catch(() => false);
log('Update-password sin token → muestra "Enlace Inválido"', showsInvalid);
log('Botón "Solicitar nuevo enlace" visible', showsNewLink);
await page.screenshot({ path: 'C:/tmp/05-update-password.png' });

// ── 6. Simular hash error (como cuando Supabase cae al site URL) ──────────────
await page.goto(BASE + '/update-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1500);

const showsExpiredMsg = await page.locator('text=expiró').isVisible().catch(() => false);
log('Hash error de Supabase → muestra mensaje de expiración', showsExpiredMsg);
await page.screenshot({ path: 'C:/tmp/06-update-hash-error.png' });

// ── Resumen ───────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r.ok);
console.log('\n' + '─'.repeat(52));
console.log(`RESULTADO: ${results.length - failed.length}/${results.length} comprobaciones OK`);
if (failed.length) {
  console.log('\nFallaron:');
  failed.forEach(r => console.log('  ❌ ' + r.msg));
}

await browser.close();
