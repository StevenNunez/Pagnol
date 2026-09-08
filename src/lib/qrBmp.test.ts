import { describe, it, expect } from 'vitest';
import QRCode from 'qrcode';
import { qrToBmp, validarPayload, nombreArchivoLote, MAX_CARACTERES } from './qrBmp';

const CODIGO = 'VALAR-ACT-0139';
const UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

/** Lee la cabecera del BMP tal como la leería el firmware de la pistola. */
function leerCabecera(bmp: Uint8Array) {
  const v = new DataView(bmp.buffer, bmp.byteOffset, bmp.byteLength);
  return {
    firma: String.fromCharCode(bmp[0], bmp[1]),
    tamArchivo: v.getUint32(2, true),
    offsetPixeles: v.getUint32(10, true),
    ancho: v.getInt32(18, true),
    alto: v.getInt32(22, true),
    bitsPorPixel: v.getUint16(28, true),
    compresion: v.getUint32(30, true),
    colores: v.getUint32(46, true),
  };
}

/** Reconstruye la matriz de módulos leyendo los píxeles del BMP. */
function matrizDesdeBmp(bmp: Uint8Array, lado: number, escala: number): number[] {
  const cab = leerCabecera(bmp);
  const bytesFila = Math.ceil((lado * escala) / 8);
  const filaConRelleno = Math.ceil(bytesFila / 4) * 4;
  const modulos: number[] = [];

  for (let my = 0; my < lado; my++) {
    for (let mx = 0; mx < lado; mx++) {
      // Se muestrea el centro del módulo.
      const x = mx * escala + Math.floor(escala / 2);
      const y = my * escala + Math.floor(escala / 2);
      const filaBmp = lado * escala - 1 - y;
      const byte = bmp[cab.offsetPixeles + filaBmp * filaConRelleno + (x >> 3)];
      const bit = (byte >> (7 - (x & 7))) & 1;
      modulos.push(bit === 0 ? 1 : 0); // bit apagado = negro = módulo encendido
    }
  }
  return modulos;
}

describe('validarPayload', () => {
  it('acepta un código interno normal y lo normaliza', () => {
    expect(validarPayload('  valar-act-0139 ')).toEqual({ ok: true, payload: CODIGO });
  });

  it('rechaza un UUID: no cabe en versión 1 y no se leería impreso', () => {
    const r = validarPayload(UUID);
    expect(r.ok).toBe(false);
  });

  it('rechaza un activo sin código interno', () => {
    expect(validarPayload(null).ok).toBe(false);
    expect(validarPayload('   ').ok).toBe(false);
  });

  it(`acepta justo ${MAX_CARACTERES} caracteres y rechaza uno más`, () => {
    expect(validarPayload('A'.repeat(MAX_CARACTERES)).ok).toBe(true);
    expect(validarPayload('A'.repeat(MAX_CARACTERES + 1)).ok).toBe(false);
  });

  it('rechaza caracteres fuera del set alfanumérico cuando el texto es largo', () => {
    // El guión bajo obliga a modo byte, donde el tope baja de 20 a 14.
    expect(validarPayload('CODIGO_CON_GUION_BAJO').ok).toBe(false);
  });
});

describe('qrToBmp', () => {
  const bmp = qrToBmp(CODIGO);

  it('mide 147 × 147 px, como espera el cabezal de 12,7 mm', () => {
    const cab = leerCabecera(bmp);
    expect(cab.ancho).toBe(147);
    expect(cab.alto).toBe(147);
  });

  it('es un BMP de 1 bit sin comprimir', () => {
    const cab = leerCabecera(bmp);
    expect(cab.firma).toBe('BM');
    expect(cab.bitsPorPixel).toBe(1);
    expect(cab.compresion).toBe(0);
    expect(cab.colores).toBe(2);
  });

  it('declara un tamaño de archivo igual al real', () => {
    expect(leerCabecera(bmp).tamArchivo).toBe(bmp.length);
  });

  it('los píxeles reproducen exactamente la matriz del QR', () => {
    const qr = QRCode.create(CODIGO, { errorCorrectionLevel: 'M', version: 1 });
    const esperada = Array.from(qr.modules.data);
    expect(matrizDesdeBmp(bmp, qr.modules.size, 7)).toEqual(esperada);
  });

  it('la esquina superior izquierda es negra: ahí arranca el patrón de posición', () => {
    // Sin este patrón el lector no encuentra el código.
    const qr = QRCode.create(CODIGO, { errorCorrectionLevel: 'M', version: 1 });
    expect(matrizDesdeBmp(bmp, qr.modules.size, 7)[0]).toBe(1);
  });

  it('lanza con un UUID en vez de generar un QR ilegible', () => {
    expect(() => qrToBmp(UUID)).toThrow();
  });

  it('lanza si la escala no es entera', () => {
    expect(() => qrToBmp(CODIGO, { escala: 7.5 })).toThrow(/entero/);
  });

  it('con borde el archivo crece de forma proporcional', () => {
    expect(leerCabecera(qrToBmp(CODIGO, { borde: 1 })).ancho).toBe((21 + 2) * 7);
  });
});

describe('nombreArchivoLote', () => {
  it('numera con tres dígitos para que la pistola los ordene bien', () => {
    expect(nombreArchivoLote(1)).toBe('IMG001.bmp');
    expect(nombreArchivoLote(147)).toBe('IMG147.bmp');
  });
});
