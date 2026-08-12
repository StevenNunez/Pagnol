'use client';

import React, { useMemo } from 'react';
import { PageShell } from '@/components/page-shell';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { AuthorizationInbox, type ApprovableRequest } from '@/components/operations/authorization-inbox';
import { rentalCategoryLabel } from '@/modules/core/lib/data';
import { exceptionStatus } from '@/modules/data/mutations/biometricMutations';
import { useAuth } from '@/modules/core/contexts/app-provider';
import { Package, ShoppingCart, Truck, ScanFace } from 'lucide-react';

export default function AuthorizationsPage() {
  const {
    requests: materialRequests, purchaseRequests, rentalRequests, materials, users,
    authorizeMaterialRequest, updateMaterialRequestStatus,
    authorizePurchaseRequest, updatePurchaseRequestStatus,
    authorizeRentalRequest, updateRentalRequestStatus,
    biometricVerifications, resolveBiometricException,
    can,
  } = useAppState();
  const { user } = useAuth();

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

  // Excepciones biométricas pendientes: el pañol pidió entregar un activo sin
  // verificación facial. El estado se DERIVA de los hechos (no hay campo de
  // estado): sigue pendiente mientras su grupo no tenga una resolución.
  const excepcionesPendientes: ApprovableRequest[] = useMemo(() => {
    const porGrupo = new Map<string, typeof biometricVerifications>();
    for (const h of biometricVerifications) {
      if (!h.exceptionGroupId) continue;
      const g = porGrupo.get(h.exceptionGroupId) ?? [];
      g.push(h);
      porGrupo.set(h.exceptionGroupId, g);
    }
    return [...porGrupo.entries()]
      .filter(([, hechos]) => exceptionStatus(hechos) === 'pendiente')
      .map(([grupo, hechos]) => {
        const solicitud = hechos.find(h => h.outcome === 'exception_requested') ?? hechos[0];
        return {
          id: grupo,
          code: solicitud.transactionCode ?? undefined,
          requesterName: solicitud.operatorName,
          date: solicitud.createdAt,
          justification: solicitud.exceptionReason ?? undefined,
          lines: [{
            label: `Entregar a ${solicitud.subjectName} sin verificación biométrica`,
            qty: 1,
          }],
          // Se guarda para poder registrar el hecho de resolución con el sujeto
          // correcto: la evidencia tiene que decir a QUIÉN se le dejó retirar.
          _subject: { id: solicitud.subjectUserId ?? '', name: solicitud.subjectName },
          _requestId: solicitud.requestId,
          _transactionCode: solicitud.transactionCode,
        } as ApprovableRequest & {
          _subject: { id: string; name: string };
          _requestId: string | null;
          _transactionCode: string | null;
        };
      })
      // `date` en ApprovableRequest admite string: se normaliza antes de restar.
      .sort((a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime());
  }, [biometricVerifications]);

  const resolverExcepcion = async (grupoId: string, aprobar: boolean) => {
    const item = excepcionesPendientes.find(e => e.id === grupoId) as any;
    if (!item || !user) return;
    await resolveBiometricException({
      exceptionGroupId: grupoId,
      subject: item._subject,
      approve: aprobar,
      mode: 'remota',
      authorizedBy: { id: user.id, name: user.name },
      requestId: item._requestId,
      transactionCode: item._transactionCode,
    });
  };

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
          <TabsTrigger value="biometria">Sin biometría ({excepcionesPendientes.length})</TabsTrigger>
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

        <TabsContent value="biometria">
          <AuthorizationInbox
            items={excepcionesPendientes}
            canAuthorize={canMaterial}
            typeLabel="Excepción"
            typeBadgeClass="badge-warning"
            lineIcon={<ScanFace className="h-3.5 w-3.5" />}
            emptyTitle="Sin excepciones pendientes"
            emptyDescription="Aquí llegan los retiros que el pañol necesita hacer sin verificación facial. Aprobar deja constancia de que tú lo autorizaste."
            onApprove={(id) => resolverExcepcion(id, true)}
            onReject={(id) => resolverExcepcion(id, false)}
          />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
