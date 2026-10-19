import { describe, expect, it, vi } from 'vitest';

vi.mock('@/modules/core/lib/supabase', () => ({ supabase: {} }));

import { placeForReturn } from './returnPlace';

const C = 'contrato-torres', CENTRAL = 'oficina-central', RECIBE = 'panol-torres';

describe('placeForReturn', () => {
  it('un activo vuelve al pool central y a la oficina central, aunque se reciba en otro pañol o venga de un contrato', () => {
    expect(placeForReturn({ isAsset: true, centralWarehouseId: CENTRAL, contractId: C, warehouseId: RECIBE }))
      .toEqual({ contractId: null, warehouseId: CENTRAL });
  });

  it('sin pañol central definido, el activo queda en el pañol que lo recibió (pero sin contrato)', () => {
    expect(placeForReturn({ isAsset: true, centralWarehouseId: null, contractId: C, warehouseId: RECIBE }))
      .toEqual({ contractId: null, warehouseId: RECIBE });
    expect(placeForReturn({ isAsset: true, centralWarehouseId: null, contractId: C, warehouseId: null }))
      .toEqual({ contractId: null, warehouseId: null });
  });

  it('un consumible vuelve donde se recibió y al contrato indicado, con o sin pañol central', () => {
    expect(placeForReturn({ isAsset: false, centralWarehouseId: CENTRAL, contractId: C, warehouseId: RECIBE }))
      .toEqual({ contractId: C, warehouseId: RECIBE });
    expect(placeForReturn({ isAsset: false, centralWarehouseId: CENTRAL, contractId: null, warehouseId: null }))
      .toEqual({ contractId: null, warehouseId: null });
  });
});
