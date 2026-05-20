
'use client';

import { useMemo } from 'react';
import { useAppState } from '@/modules/core/contexts/app-provider';
import type { PurchaseRequest, PurchaseLot } from '@/modules/core/lib/data';

interface Lot {
  lotId: string;
  category: string;
  requests: PurchaseRequest[];
  totalQuantity: number;
}

export function useLots() {
  const { purchaseRequests, purchaseLots } = useAppState();

  const openLotsMap = useMemo(() => {
    const map = new Map<string, Lot>();
    (purchaseLots || [])
        .filter((lot: PurchaseLot) => lot.status === 'open')
        .forEach((lot: PurchaseLot) => {
            map.set(lot.id, {
                lotId: lot.id,
                category: lot.name,
                requests: [] as PurchaseRequest[], // Explicitly type the empty array
                totalQuantity: 0,
            });
        });
    return map;
  }, [purchaseLots]);


  const { approvedRequests, batchedLots } = useMemo(() => {
    const safePurchaseRequests = purchaseRequests || [];
    const pending: PurchaseRequest[] = [];
    
    // Clonamos el mapa de lotes abiertos para trabajar sobre él
    const lotsMap = new Map(Array.from(openLotsMap.entries()).map(([key, value]) => [key, { ...value, requests: [] as PurchaseRequest[], totalQuantity: 0 }]));

    for (const req of safePurchaseRequests) {
        // Ignorar solicitudes que ya están recibidas o rechazadas
        if (req.status === 'received' || req.status === 'rejected') {
            continue;
        }

        // Si la solicitud tiene un lotId y ese lote está en nuestro mapa de lotes abiertos
        if (req.lotId && lotsMap.has(req.lotId)) {
            const lot = lotsMap.get(req.lotId)!;
            lot.requests.push(req);
            lot.totalQuantity += Number(req.quantity) || 0;
        } 
        // Si la solicitud está aprobada pero no tiene lote, va a pendientes.
        else if (req.status === 'approved' && !req.lotId) {
            pending.push(req);
        }
    }
    
    const finalLots = Array.from(lotsMap.values())
      .sort((a, b) => a.category.localeCompare(b.category));
      
    pending.sort((a, b) => {
        const dateA = a.createdAt ? (a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt as any).getTime()) : 0;
        const dateB = b.createdAt ? (b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt as any).getTime()) : 0;
        return dateB - dateA;
    });

    return {
        approvedRequests: pending,
        batchedLots: finalLots,
    };

  }, [purchaseRequests, openLotsMap]);

  return {
    approvedRequests,
    batchedLots,
  };
}
