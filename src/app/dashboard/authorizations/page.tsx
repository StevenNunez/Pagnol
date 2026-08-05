'use client';

import React, { useMemo } from 'react';
import { PageShell } from '@/components/page-shell';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { AuthorizationInbox, type ApprovableRequest } from '@/components/operations/authorization-inbox';
import { rentalCategoryLabel } from '@/modules/core/lib/data';
import { Package, ShoppingCart, Truck } from 'lucide-react';

export default function AuthorizationsPage() {
  const {
    requests: materialRequests, purchaseRequests, rentalRequests, materials, users,
    authorizeMaterialRequest, updateMaterialRequestStatus,
    authorizePurchaseRequest, updatePurchaseRequestStatus,
    authorizeRentalRequest, updateRentalRequestStatus,
    can,
  } = useAppState();

  const canMaterial = can('material_requests:authorize');
  const canPurchase = can('purchase_requests:authorize');
  const canRental = can('rentals:authorize');

  // Mapa materialId → nombre, para mostrar las líneas de las solicitudes de material.
  const materialMap = useMemo(() => {
    const m = new Map<string, string>();
    (materials || []).forEach((mat: any) => m.set(mat.id, mat.name));
    return m;
  }, [materials]);

  const userMap = useMemo(() => {
    const m = new Map<string, string>();
    (users || []).forEach((u: any) => m.set(u.id, u.name));
    return m;
  }, [users]);

  // Solo pendientes SIN autorizar (gate del ADC abajo).
  const materialItems: ApprovableRequest[] = useMemo(() =>
    (materialRequests || [])
      .filter((r: any) => r.status === 'pending' && !r.adcAuthorizedAt)
      .map((r: any) => ({
        id: r.id,
        code: r.internalCode,
        requesterName: r.userName || userMap.get(r.supervisorId),
        contractName: r.contractName,
        date: r.createdAt,
        lines: (r.items || []).map((it: any) => ({
          label: materialMap.get(it.materialId) || 'Material',
          qty: it.quantity,
        })),
      })),
  [materialRequests, materialMap, userMap]);

  const purchaseItems: ApprovableRequest[] = useMemo(() =>
    (purchaseRequests || [])
      // Un requerimiento de arriendo ya viaja en la pestaña "Arriendo" a través
      // de su solicitud: si apareciera también acá, el ADC vería el mismo
      // pedido dos veces y lo autorizaría dos veces (RFC-004 F3).
      .filter((r: any) => r.status === 'pending' && !r.adcAuthorizedAt && !r.rentalRequestId)
      .map((r: any) => ({
        id: r.id,
        code: r.internalCode || r.id,
        requesterName: r.requesterName || userMap.get(r.supervisorId),
        contractName: r.contractName,
        date: r.createdAt,
        justification: r.justification,
        // RFC-004 F1: urgencia, tipo de gasto y proveedor sugerido viajan al
        // inbox para que el ADC autorice con el contexto completo a la vista.
        meta: r,
        lines: [{
          label: r.materialName,
          qty: r.quantity,
          // Deja explícito cuando el destino es el CLIENTE del contrato (el
          // cliente proporciona el material) — el ADC autoriza sabiendo qué firma.
          // La partida es la otra mitad del CeCo: sin ella no se sabe de qué
          // bolsillo sale lo que se está autorizando.
          meta: [
            r.itemDescription,
            r.requestTarget === 'client'
              ? `${r.unit} · Suministro del cliente ${r.clientName || ''}`.trim()
              : r.unit,
            r.category,
          ].filter(Boolean).join(' · '),
        }],
      }))
      // Lo más urgente arriba: primero lo atrasado, después por fecha requerida.
      // Sin esto la urgencia sería un adjetivo que no cambia nada de la bandeja.
      .sort((a: any, b: any) => {
        const av = a.meta?.neededBy || '9999-12-31';
        const bv = b.meta?.neededBy || '9999-12-31';
        return av.localeCompare(bv);
      }),
  [purchaseRequests, userMap]);

  const rentalItems: ApprovableRequest[] = useMemo(() =>
    (rentalRequests || [])
      .filter((r: any) => r.status === 'pending' && !r.adcAuthorizedAt)
      .map((r: any) => ({
        id: r.id,
        code: r.internalCode,
        requesterName: r.supervisorName || userMap.get(r.supervisorId),
        contractName: r.contractName,
        date: r.createdAt,
        justification: r.justification,
        lines: (r.items || []).map((it: any) => ({
          label: it.name,
          qty: it.quantity,
          meta: rentalCategoryLabel(it.category),
        })),
      })),
  [rentalRequests, userMap]);

  return (
    <PageShell
      title="Autorizaciones"
      description="Autoriza las solicitudes de terreno (material, compra y arriendo) antes de que Abastecimiento las gestione."
    >
      <Tabs defaultValue="material" className="space-y-6">
        <TabsList>
          <TabsTrigger value="material">Material ({materialItems.length})</TabsTrigger>
          <TabsTrigger value="compra">Compra ({purchaseItems.length})</TabsTrigger>
          <TabsTrigger value="arriendo">Arriendo ({rentalItems.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="material">
          <AuthorizationInbox
            items={materialItems}
            canAuthorize={canMaterial}
            typeLabel="Material"
            typeBadgeClass="badge-info"
            lineIcon={<Package className="h-3.5 w-3.5" />}
            emptyTitle="Sin solicitudes de material por autorizar"
            emptyDescription="Cuando terreno pida materiales, aparecerán aquí para tu visto bueno."
            onApprove={(id) => authorizeMaterialRequest(id)}
            onReject={(id) => updateMaterialRequestStatus(id, 'rejected')}
          />
        </TabsContent>

        <TabsContent value="compra">
          <AuthorizationInbox
            items={purchaseItems}
            canAuthorize={canPurchase}
            typeLabel="Compra"
            typeBadgeClass="badge-success"
            lineIcon={<ShoppingCart className="h-3.5 w-3.5" />}
            emptyTitle="Sin requerimientos por autorizar"
            emptyDescription="Cuando terreno pida una compra, aparecerá aquí para tu visto bueno."
            onApprove={(id) => authorizePurchaseRequest(id)}
            onReject={(id, reason) => updatePurchaseRequestStatus(id, 'rejected', { notes: reason })}
          />
        </TabsContent>

        <TabsContent value="arriendo">
          <AuthorizationInbox
            items={rentalItems}
            canAuthorize={canRental}
            typeLabel="Arriendo"
            typeBadgeClass="badge-warning"
            lineIcon={<Truck className="h-3.5 w-3.5" />}
            emptyTitle="Sin solicitudes de arriendo por autorizar"
            emptyDescription="Cuando terreno pida un arriendo, aparecerá aquí para tu visto bueno."
            onApprove={(id) => authorizeRentalRequest(id)}
            onReject={(id, reason) => updateRentalRequestStatus(id, 'rejected', reason)}
          />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
