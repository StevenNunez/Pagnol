import { describe, it, expect } from 'vitest';
import { normalizarCodigo, pareceMalConfigurado, buscarPorCodigoEscaneado } from './scan-code';

interface Activo { id: string; internalCode?: string | null; serialNumber?: string | null; name: string }

const catalogo: Activo[] = [
    { id: 'a1', internalCode: 'VALAR-ACT-0017', serialNumber: '11162324', name: 'Rotomartillo Bauker' },
    { id: 'a2', internalCode: 'VALAR-ACT-0139', serialNumber: null, name: 'Esmeril angular' },
    { id: 'a3', internalCode: null, serialNumber: null, name: 'Ficha sin códigos' },
];

const buscar = (leido: string) =>
    buscarPorCodigoEscaneado(catalogo, leido, a => [a.internalCode, a.serialNumber, a.id], a => a.id);

describe('normalizarCodigo', () => {
    it('deja el código con lo que de verdad identifica', () => {
        expect(normalizarCodigo('VALAR-ACT-0017')).toBe('VALARACT0017');
        expect(normalizarCodigo("VALAR'ACT'0017")).toBe('VALARACT0017');
        expect(normalizarCodigo('valar act 0017')).toBe('VALARACT0017');
    });
});

describe('pareceMalConfigurado', () => {
    it('sólo se queja de símbolos que un código interno nunca lleva', () => {
        expect(pareceMalConfigurado('VALAR-ACT-0017')).toBe(false);
        expect(pareceMalConfigurado("VALAR'ACT'0017")).toBe(true);
        expect(pareceMalConfigurado('VALAR/ACT/0017')).toBe(true);
    });
});

describe('buscarPorCodigoEscaneado', () => {
    it('el caso que reportó el pañol: la pistola manda apóstrofes', () => {
        const r = buscar("VALAR'ACT'0017");
        expect(r.tipo).toBe('tolerado');
        expect(r.tipo === 'tolerado' && r.item.name).toBe('Rotomartillo Bauker');
    });

    it('el código correcto entra por la vía exacta, no por la tolerante', () => {
        expect(buscar('VALAR-ACT-0017').tipo).toBe('exacto');
    });

    it('acepta el número de serie y el id de las etiquetas viejas', () => {
        expect(buscar('11162324').tipo).toBe('exacto');
        expect(buscar('a2').tipo).toBe('exacto');
    });

    it('no distingue mayúsculas', () => {
        expect(buscar('valar-act-0139').tipo).toBe('exacto');
    });

    it('un código que no existe sigue sin existir', () => {
        expect(buscar('VALAR-ACT-9999').tipo).toBe('sin-resultado');
    });

    it('un texto sin letras ni dígitos NO calza con las fichas de campos vacíos', () => {
        // Sin la guarda, normalizar "---" da "" y "" compara igual contra todos
        // los códigos vacíos: pistolear basura entregaría un activo cualquiera.
        expect(buscar('---').tipo).toBe('sin-resultado');
        expect(buscar('   ').tipo).toBe('sin-resultado');
    });

    it('con dos candidatos no adivina: pide el código completo', () => {
        const ambiguo: Activo[] = [
            { id: 'x1', internalCode: 'AB-01', serialNumber: null, name: 'Uno' },
            { id: 'x2', internalCode: 'A-B01', serialNumber: null, name: 'Dos' },
        ];
        const r = buscarPorCodigoEscaneado(ambiguo, "AB'01", a => [a.internalCode], a => a.id);
        expect(r.tipo).toBe('ambiguo');
        expect(r.tipo === 'ambiguo' && r.candidatos).toHaveLength(2);
    });

    it('el mismo activo por dos campos no cuenta como ambigüedad', () => {
        const dobles: Activo[] = [{ id: 'y1', internalCode: 'K-9', serialNumber: 'K9', name: 'Uno solo' }];
        const r = buscarPorCodigoEscaneado(dobles, "K'9", a => [a.internalCode, a.serialNumber], a => a.id);
        expect(r.tipo).toBe('tolerado');
    });
});
