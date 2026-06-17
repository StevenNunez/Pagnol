import 'server-only';
import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';
import puppeteer, { type Browser } from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

// Motor de generación del Reporte Diario de Trabajo (VALAR / SQM).
// Adaptado del proyecto `reporte-pdf` original (puppeteer full → puppeteer-core
// + @sparticuz/chromium) para correr en Vercel Functions (runtime nodejs) y en
// local sobre el Chrome/Edge instalado.
//
// El diseño (template.hbs) y el contrato de datos (sample-data.json) NO se tocan.

const ENGINE_DIR = path.join(process.cwd(), 'src', 'lib', 'report-engine');

Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);

// Convierte una imagen local (assets/) a data URI para que Chromium la embeba.
// Si ya viene como data URI o URL remota, la deja pasar tal cual.
function imgToDataUri(file?: string | null): string | null {
  try {
    if (!file) return null;
    if (file.startsWith('data:') || file.startsWith('http://') || file.startsWith('https://')) {
      return file;
    }
    const abs = path.isAbsolute(file) ? file : path.join(ENGINE_DIR, file);
    if (!fs.existsSync(abs)) return null;
    const ext = path.extname(abs).slice(1).toLowerCase();
    const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    return `data:${mime};base64,${fs.readFileSync(abs).toString('base64')}`;
  } catch {
    return null;
  }
}

// Normaliza los datos: alinea la matriz de horas por OT, calcula la fila de
// totales (si no viene) y el % de avance. Misma lógica que el motor original.
export function prepararDatos(d: any): any {
  const ots: string[] = d.ots || [];

  (d.personal || []).forEach((p: any) => {
    p.cols = ots.map((ot) => (p.horas && p.horas[ot] != null ? p.horas[ot] : ''));
  });

  if (!d.totales) {
    const sum = (sel: (p: any) => any) =>
      (d.personal || []).reduce((a: number, p: any) => a + (parseFloat(sel(p)) || 0), 0);
    const round = (n: number) => Math.round(n * 100) / 100;
    d.totales = {
      cols: ots.map((ot) =>
        round((d.personal || []).reduce((a: number, p: any) => a + (parseFloat(p.horas && p.horas[ot]) || 0), 0)),
      ),
      colacion: round(sum((p) => p.colacion)),
      doc: round(sum((p) => p.doc)),
      traslado: round(sum((p) => p.traslado)),
      subhh: round(sum((p) => p.subhh)),
      hext: round(sum((p) => p.hext)),
      total: round(sum((p) => p.total)),
    };
  }

  (d.actividades || []).forEach((a: any) => {
    let v = a.avance;
    if (v == null) v = 0;
    if (v <= 1) v = v * 100; // admite 0.9 ó 90
    a.avancePct = Math.round(v);
  });

  d.logos = d.logos || {};
  d.logos.valar = imgToDataUri(d.logos.valar || 'assets/logo-valar.svg');
  d.logos.sqm = imgToDataUri(d.logos.sqm || 'assets/logo-sqm.svg');

  return d;
}

let templateCache: HandlebarsTemplateDelegate | null = null;
function getTemplate(): HandlebarsTemplateDelegate {
  if (!templateCache) {
    const src = fs.readFileSync(path.join(ENGINE_DIR, 'template.hbs'), 'utf8');
    templateCache = Handlebars.compile(src);
  }
  return templateCache;
}

const isServerless = !!process.env.VERCEL || !!process.env.AWS_REGION || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

// Rutas típicas de Edge en Windows (puppeteer-core no soporta Edge vía `channel`,
// solo vía executablePath). Sirven de fallback en local cuando no hay Chrome.
const WINDOWS_EDGE_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

async function launchBrowser(): Promise<Browser> {
  if (isServerless) {
    // Modo gráfico off: más liviano y estable en serverless (no necesitamos WebGL).
    chromium.setGraphicsMode = false;
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }

  // Local: ruta explícita, luego Chrome por canal, luego Edge por ruta conocida.
  const baseArgs = ['--no-sandbox', '--disable-setuid-sandbox'];
  const explicit = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (explicit) {
    return puppeteer.launch({ headless: true, executablePath: explicit, args: baseArgs });
  }

  let lastErr: unknown;
  for (const channel of ['chrome', 'chrome-beta'] as const) {
    try {
      return await puppeteer.launch({ headless: true, channel, args: baseArgs });
    } catch (err) {
      lastErr = err;
    }
  }
  for (const edgePath of WINDOWS_EDGE_PATHS) {
    if (fs.existsSync(edgePath)) {
      try {
        return await puppeteer.launch({ headless: true, executablePath: edgePath, args: baseArgs });
      } catch (err) {
        lastErr = err;
      }
    }
  }
  throw new Error(
    'No se encontró un navegador Chromium local. Instala Chrome/Edge o define PUPPETEER_EXECUTABLE_PATH. ' +
      `Detalle: ${(lastErr as Error)?.message || lastErr}`,
  );
}

// Genera el PDF de 4 páginas y devuelve el Buffer (para subir a Storage o stream).
export async function generarReportePdf(datos: any): Promise<Buffer> {
  const datosOk = prepararDatos(JSON.parse(JSON.stringify(datos)));
  const html = getTemplate()(datosOk);

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    // Las imágenes van embebidas como data URI y la tipografía es del sistema,
    // así que 'load' basta (no hay recursos de red que esperar).
    await page.setContent(html, { waitUntil: 'load' });
    const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
