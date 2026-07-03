// Verifica el fix de cantidad para Consumibles en la cuenta real hola@teolabs.app. Borrar al terminar.
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }),
);

const BASE = 'http://localhost:3000';
const SHOTS = 'C:/Users/xistv/AppData/Local/Temp/claude/C--TeoLabs-Pagnol/77c657bc-eafc-4ba6-9da8-18b103825d88/scratchpad';
const b = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1440, height: 1000 },
});
const p = await b.newPage();
p.setDefaultTimeout(120000);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function pickSelect(labelText, optionText) {
  const opened = await p.evaluate((lt) => {
    const labels = [...document.querySelectorAll('label')];
    const label = labels.find((l) => l.textContent.includes(lt));
    if (!label) return false;
    const wrapper = label.closest('div');
    const trigger = wrapper?.querySelector('[role="combobox"]');
    if (!trigger) return false;
    trigger.click();
    return true;
  }, labelText);
  if (!opened) throw new Error(`No se encontró el combobox de "${labelText}"`);
  await new Promise((r) => setTimeout(r, 500));
  const picked = await p.evaluate((ot) => {
    const opt = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent.includes(ot));
    if (!opt) return null;
    opt.click();
    return opt.textContent;
  }, optionText);
  if (!picked) throw new Error(`No se encontró la opción "${optionText}" para "${labelText}"`);
  await new Promise((r) => setTimeout(r, 400));
  return picked;
}

try {
  await p.goto(BASE + '/login', { waitUntil: 'networkidle2', timeout: 300000 });
  await p.type('#identifier', env.ADMIN_EMAIL);
  await p.type('#password', env.ADMIN_PASSWORD);
  await Promise.all([p.click('button[type="submit"]'), p.waitForNavigation({ timeout: 120000 }).catch(() => {})]);
  log('login ok →', p.url());

  await p.goto(BASE + '/dashboard/pagnol/activos', { waitUntil: 'networkidle2', timeout: 300000 });
  await new Promise((r) => setTimeout(r, 3000));

  const opened = await p.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => /Registrar Activo|Nuevo Activo/.test(b.textContent));
    if (btn) { btn.click(); return btn.textContent; }
    return null;
  });
  log('modal abierto:', opened);
  await new Promise((r) => setTimeout(r, 1000));
  await p.screenshot({ path: SHOTS + '/tl-00-modal.png' });

  if (!opened) throw new Error('No se encontró el botón para registrar activo (¿permiso materials:create?)');

  const uniqueName = `TEST Sacos Cemento 25kg ${Date.now()}`;
  await p.type('#name', uniqueName);

  const cat = await pickSelect('Categoría Logística', '');
  log('categoría elegida:', cat);

  const usage = await pickSelect('Tipo de Uso', 'Consumible');
  log('tipo de uso elegido:', usage);

  await new Promise((r) => setTimeout(r, 500));
  await p.screenshot({ path: SHOTS + '/tl-01-consumible.png' });

  const fieldsVisible = await p.evaluate(() => ({
    cantidad: document.body.textContent.includes('Cantidad Inicial'),
    unidad: document.body.textContent.includes('Unidad de Medida'),
  }));
  log('campos visibles tras elegir Consumible:', JSON.stringify(fieldsVisible));

  await p.evaluate(() => { const el = document.querySelector('#unit'); if (el) el.value = ''; });
  await p.type('#unit', 'Saco');
  await p.evaluate(() => { const el = document.querySelector('#stock'); if (el) el.value = ''; });
  await p.type('#stock', '500');
  await p.screenshot({ path: SHOTS + '/tl-02-filled.png' });

  const submitted = await p.evaluate(() => {
    const btn = [...document.querySelectorAll('button[type="submit"]')].find(b => b.textContent.includes('Finalizar Registro'));
    if (btn) { btn.click(); return true; }
    return false;
  });
  log('submit click:', submitted);
  await new Promise((r) => setTimeout(r, 3000));
  await p.screenshot({ path: SHOTS + '/tl-03-after-submit.png' });

  log('nombre único usado para verificar en BD:', uniqueName);
} finally {
  await b.close();
}
