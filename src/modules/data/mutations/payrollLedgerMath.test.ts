import { describe, it, expect } from 'vitest';
import {
    splitCostByContract, monthOfLaborSourceId, budgetDeviation, payrollPayableAmount,
    type LaborDayFact,
} from './payrollLedgerMath';

const dia = (contractId: string | null, date: string, name: string | null = null): LaborDayFact => ({
    sourceId: `u1:${date}`, contractId, contractName: name, amountNet: 40500,
});

describe('splitCostByContract — reparto proporcional por obra', () => {
    it('el caso del ADR: 12 días en A y 8 en B reparten 60/40', () => {
        const facts = [
            ...Array.from({ length: 12 }, (_, i) => dia('A', `2026-05-${String(i + 1).padStart(2, '0')}`, 'Obra A')),
            ...Array.from({ length: 8 }, (_, i) => dia('B', `2026-05-${String(i + 13).padStart(2, '0')}`, 'Obra B')),
        ];
        const shares = splitCostByContract(1000000, facts);
        expect(shares).toHaveLength(2);
        expect(shares.find(s => s.contractId === 'A')).toMatchObject({ days: 12, amount: 600000 });
        expect(shares.find(s => s.contractId === 'B')).toMatchObject({ days: 8, amount: 400000 });
    });

    it('la suma de las partes es EXACTAMENTE el total, aun con redondeo feo', () => {
        // 3 obras con 1 día cada una sobre un monto no divisible por 3
        const facts = [dia('A', '2026-05-01'), dia('B', '2026-05-02'), dia('C', '2026-05-03')];
        const shares = splitCostByContract(1000000, facts);
        expect(shares.reduce((s, x) => s + x.amount, 0)).toBe(1000000);
    });

    it('el residuo del redondeo se ajusta en la obra con más días', () => {
        const facts = [
            dia('A', '2026-05-01'), dia('A', '2026-05-02'),
            dia('B', '2026-05-03'),
        ];
        const shares = splitCostByContract(100, facts);
        expect(shares.reduce((s, x) => s + x.amount, 0)).toBe(100);
        expect(shares[0].contractId).toBe('A');   // ordenado por días desc
        expect(shares[0].days).toBe(2);
    });

    it('una sola obra recibe el total íntegro', () => {
        const shares = splitCostByContract(872481, [dia('A', '2026-05-01'), dia('A', '2026-05-02')]);
        expect(shares).toHaveLength(1);
        expect(shares[0].amount).toBe(872481);
    });

    it('"sin obra" es una obra válida: no se reparte ni se esconde', () => {
        const facts = [dia(null, '2026-05-01'), dia('A', '2026-05-02')];
        const shares = splitCostByContract(1000, facts);
        expect(shares).toHaveLength(2);
        expect(shares.find(s => s.contractId === null)?.amount).toBe(500);
    });

    it('sin días imputados el costo va al pool (contrato null)', () => {
        const shares = splitCostByContract(500000, []);
        expect(shares).toEqual([{ contractId: null, contractName: null, days: 0, amount: 500000 }]);
    });

    it('costo 0 no genera reparto', () => {
        expect(splitCostByContract(0, [dia('A', '2026-05-01')])).toEqual([]);
    });

    it('conserva el nombre de la obra aunque solo un día lo traiga', () => {
        const facts = [dia('A', '2026-05-01', null), dia('A', '2026-05-02', 'Obra A')];
        expect(splitCostByContract(1000, facts)[0].contractName).toBe('Obra A');
    });
});

describe('monthOfLaborSourceId', () => {
    it('extrae el mes del día trabajado', () => {
        expect(monthOfLaborSourceId('aa0d378d-67bf-4541-bd21-7d8d89fdadd8:2026-05-14')).toBe('2026-05');
    });

    it('tolera un source_id con formato distinto', () => {
        expect(monthOfLaborSourceId('sin-fecha')).toBeNull();
        expect(monthOfLaborSourceId('u1:no-es-fecha')).toBeNull();
    });
});

describe('budgetDeviation — el número que hay que poder leer', () => {
    it('ahorro: lo dice en castellano y con monto', () => {
        const d = budgetDeviation(4500000, 4350000);
        expect(d.direction).toBe('ahorro');
        expect(d.delta).toBe(150000);
        expect(d.message).toMatch(/te ahorraste/i);
        expect(d.message).toContain('150.000');
    });

    it('exceso: también con monto, sin eufemismos', () => {
        const d = budgetDeviation(4500000, 4720000);
        expect(d.direction).toBe('exceso');
        expect(d.delta).toBe(-220000);
        expect(d.magnitude).toBe(220000);
        expect(d.message).toMatch(/pagando .* más/i);
        expect(d.message).toContain('220.000');
    });

    it('coincidencia exacta', () => {
        const d = budgetDeviation(1000000, 1000000);
        expect(d.direction).toBe('exacto');
        expect(d.delta).toBe(0);
        expect(d.message).toMatch(/coincide exactamente/i);
    });

    it('porcentaje con un decimal', () => {
        expect(budgetDeviation(4500000, 4350000).pct).toBe(3.3);
        expect(budgetDeviation(1000000, 1100000).pct).toBe(-10);
    });

    it('🔴 sin presupuesto NO inventa un 100% de ahorro', () => {
        const d = budgetDeviation(0, 500000);
        expect(d.hasBudget).toBe(false);
        expect(d.pct).toBe(0);
        expect(d.message).toMatch(/sin presupuesto cargado/i);
        expect(d.message).toContain('500.000');
    });

    it('sin presupuesto y sin gasto lo dice sin alarmar', () => {
        const d = budgetDeviation(0, 0);
        expect(d.hasBudget).toBe(false);
        expect(d.message).toMatch(/sin gasto registrado/i);
    });

    it('gasto 0 con presupuesto cargado es ahorro total', () => {
        const d = budgetDeviation(1000000, 0);
        expect(d.direction).toBe('ahorro');
        expect(d.pct).toBe(100);
    });

    it('redondea a peso: no arrastra centavos', () => {
        const d = budgetDeviation(1000000.6, 999999.4);
        expect(d.budget).toBe(1000001);
        expect(d.actual).toBe(999999);
        expect(d.delta).toBe(2);
    });
});

describe('payrollPayableAmount — la obligación de caja neta de anticipos', () => {
    it('sin anticipos proyecta el costo empresa completo', () => {
        expect(payrollPayableAmount(1_200_000, 0)).toBe(1_200_000);
    });

    it('descuenta lo ya entregado como anticipo', () => {
        expect(payrollPayableAmount(1_200_000, 200_000)).toBe(1_000_000);
    });

    it('los dos payables suman el desembolso real, sin duplicar caja', () => {
        // Es la invariante que justifica el cambio: el payable del anticipo
        // ($200.000) más el de la planilla tienen que dar el costo empresa.
        const costoEmpresa = 1_200_000;
        const anticipo = 200_000;
        expect(anticipo + payrollPayableAmount(costoEmpresa, anticipo)).toBe(costoEmpresa);
    });

    it('un anticipo igual al costo empresa deja la planilla sin obligación', () => {
        expect(payrollPayableAmount(500_000, 500_000)).toBe(0);
    });

    it('nunca proyecta un pago al revés si el dato viene inconsistente', () => {
        expect(payrollPayableAmount(500_000, 900_000)).toBe(0);
        expect(payrollPayableAmount(500_000, -100_000)).toBe(500_000);
    });

    it('sin costo empresa no hay obligación que proyectar', () => {
        expect(payrollPayableAmount(0, 50_000)).toBe(0);
        expect(payrollPayableAmount(-10, 0)).toBe(0);
    });

    it('redondea a peso', () => {
        expect(payrollPayableAmount(1_000_000.6, 200_000.4)).toBe(800_001);
    });
});
