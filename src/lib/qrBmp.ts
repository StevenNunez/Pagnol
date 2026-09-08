/**
 * Genera el QR de un activo como BMP monocromo listo para la pistola
 * marcadora de inkjet (la que graba el código directo sobre el fierro).
 *
 * El BMP se escribe byte a byte desde la matriz del QR: no hay canvas ni
 * conversión de imagen de por medio, así que los módulos nunca salen
 * interpolados ni con antialias — que es justo lo que hace que un QR chico
 * deje de leerse impreso.
 *
 * Especificación del cabezal (152 inyectores para 12,7 mm):
 *   · BMP de 1 bit, sin comprimir      — es lo único que lee la pistola
 *   · 147 × 147 px  (21 módulos × 7)   — deja holgura sobre los 152 inyectores
 *   · escala entera obligatoria        — con decimales los módulos se deforman
 *   · versión 1 fija (21 × 21)         — módulo de 0,58 mm, el mínimo legible
 *   · corrección M                     — tolera manchas de tinta y roce de faena
 *   · borde 0                          — la superficie del activo da el margen
 */

import QRCode from 'qrcode';

/** Caracteres del modo alfanumérico del QR (los únicos que rinden 20 en v1-M). */
const ALFANUMERICO = /^[0-9A-Z $%*+\-./:]+$/;

/** Tope de contenido en versión 1 con corrección M, en modo alfanumérico. */
export const MAX_CARACTERES = 20;

/** Tope si el texto cae a modo byte (una sola minúscula basta para caerse). */
const MAX_CARACTERES_BYTE = 14;

export interface OpcionesBmp {
  /** Píxeles por módulo. Entero obligatorio. */
  escala?: number;
  /** Módulos de margen blanco alrededor del QR. */
  borde?: number;
}

export type Validacion =
  | { ok: true; payload: string }
  | { ok: false; motivo: string };

/**
 * Revisa que el texto quepa en un QR versión 1 antes de intentar grabarlo.
 * Devuelve el payload ya normalizado (sin espacios sobrantes, en mayúsculas):
 * el lector del pañol compara en mayúsculas, así que la normalización no
 * rompe el escaneo y sí evita caer a modo byte por una minúscula suelta.
 */
export function validarPayload(texto: string | null | undefined): Validacion {
  const payload = (texto || '').trim().toUpperCase();

  if (!payload) {
    return { ok: false, motivo: 'No tiene código interno asignado.' };
  }
  if (!ALFANUMERICO.test(payload)) {
    const sobran = [...new Set(payload.split('').filter((c) => !ALFANUMERICO.test(c)))];
    if (payload.length > MAX_CARACTERES_BYTE) {
      return {
        ok: false,
        motivo: `Usa caracteres fuera del set del QR (${sobran.join(' ')}) y tiene ${payload.length} caracteres; con esos caracteres el tope baja a ${MAX_CARACTERES_BYTE}.`,
      };
    }
    return { ok: true, payload };
  }
  if (payload.length > MAX_CARACTERES) {
    return {
      ok: false,
      motivo: `Tiene ${payload.length} caracteres y el tope es ${MAX_CARACTERES}. Un código más largo achica los módulos y deja de leerse impreso.`,
    };
  }
  return { ok: true, payload };
}

/**
 * Arma el BMP de 1 bit. Lanza si el texto no cabe en versión 1 — usa
 * `validarPayload` antes para saber el motivo sin romper el lote entero.
 */
export function qrToBmp(texto: string, opciones: OpcionesBmp = {}): Uint8Array {
  const escala = opciones.escala ?? 7;
  const borde = opciones.borde ?? 0;

  if (!Number.isInteger(escala) || escala < 1) {
    throw new Error('La escala tiene que ser un entero: con decimales los módulos salen deformados.');
  }

  const validacion = validarPayload(texto);
  if (!validacion.ok) throw new Error(validacion.motivo);

  const qr = QRCode.create(validacion.payload, { errorCorrectionLevel: 'M', version: 1 });
  const n = qr.modules.size; // 21
  const data = qr.modules.data; // 1 = negro
  const lado = (n + borde * 2) * escala;

  // ── Cabecera BMP ───────────────────────────────────────────────────────────
  const bytesFila = Math.ceil(lado / 8);
  const filaConRelleno = Math.ceil(bytesFila / 4) * 4; // las filas van alineadas a 4 bytes
  const tamPixeles = filaConRelleno * lado;
  const tamCabecera = 14 + 40 + 8; // archivo + info + paleta de 2 colores
  const tamArchivo = tamCabecera + tamPixeles;

  const bytes = new Uint8Array(tamArchivo);
  const vista = new DataView(bytes.buffer);

  // BITMAPFILEHEADER
  bytes[0] = 0x42; // 'B'
  bytes[1] = 0x4d; // 'M'
  vista.setUint32(2, tamArchivo, true);
  vista.setUint32(10, tamCabecera, true);

  // BITMAPINFOHEADER
  vista.setUint32(14, 40, true);
  vista.setInt32(18, lado, true);
  vista.setInt32(22, lado, true); // positivo = filas de abajo hacia arriba
  vista.setUint16(26, 1, true); // planos
  vista.setUint16(28, 1, true); // 1 bit por píxel
  vista.setUint32(30, 0, true); // sin compresión
  vista.setUint32(34, tamPixeles, true);
  vista.setInt32(38, 2835, true); // 72 DPI
  vista.setInt32(42, 2835, true);
  vista.setUint32(46, 2, true); // colores en paleta
  vista.setUint32(50, 2, true);

  // Paleta (BGRA): índice 0 = negro, índice 1 = blanco.
  // Si alguna pistola ignorara la paleta e imprimiera en negativo, se
  // intercambian estas dos líneas y listo.
  vista.setUint32(54, 0x00000000, true);
  vista.setUint32(58, 0x00ffffff, true);

  // ── Píxeles ────────────────────────────────────────────────────────────────
  for (let y = 0; y < lado; y++) {
    const filaBmp = lado - 1 - y; // el BMP guarda de abajo hacia arriba
    const base = tamCabecera + filaBmp * filaConRelleno;

    for (let x = 0; x < lado; x++) {
      const mx = Math.floor(x / escala) - borde;
      const my = Math.floor(y / escala) - borde;

      let negro = false;
      if (mx >= 0 && mx < n && my >= 0 && my < n) {
        negro = data[my * n + mx] === 1;
      }

      // bit encendido = índice 1 = blanco; apagado = índice 0 = negro
      if (!negro) {
        bytes[base + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }

  return bytes;
}

/**
 * Nombre de archivo para el pendrive: IMG001.bmp, IMG002.bmp…
 * La pantalla de la pistola los lista en ese orden, así que el número es la
 * única forma que tiene el operador de ubicar un activo — siempre va junto a
 * la hoja índice del lote.
 */
export function nombreArchivoLote(indice: number): string {
  return `IMG${String(indice).padStart(3, '0')}.bmp`;
}
