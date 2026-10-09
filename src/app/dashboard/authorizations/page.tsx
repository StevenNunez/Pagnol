'use client';

import React, { useMemo } from 'react';
import { PageShell } from '@/components/page-shell';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { AuthorizationInbox, type ApprovableRequest } from '@/components/operations/authorization-inbox';
import { OpsReviewInbox, type OpsReviewGroup } from '@/components/operations/ops-review-inbox';
import { ProposalSignInbox, useProposalsToSign } from '@/components/approvals/proposal-sign-inbox';
import { UrgentPurchasesReport } from '@/components/approvals/urgent-purchases-report';
import { isWaitingOps, isWaitingAdc } from '@/components/supervisor-purchases/purchase-pipeline';
import { resolveSigners, withdrawalValueNet } from '@/modules/data/mutations/approvalMath';
import { rentalCategoryLabel } from '@/modules/core/lib/data';
import { exceptionStatus } from '@/modules/data/mutations/biometricMutations';
import { useAuth } from '@/modules/core/contexts/app-provider';
import { Package, ShoppingCart, Truck, ScanFace } from 'lucide-react';
import type { PurchaseRequest } from '@/modules/core/lib/data';

export default function AuthorizationsPage() {
  const {
    requests: materialRequests, purchaseRequests, rentalRequests, materials, users,
    authorizeMaterialRequest, updateMaterialRequestStatus,
    authorizePurchaseRequest, updatePurchaseRequestStatus,
    authorizeRentalRequest, updateRentalRequestStatus,
    reviewPurchaseRequests, reviewRentalRequest,
    biometricVerifications, resolveBiometricException,
    contracts, currentTenant,
    can,
  } = useAppState();
  const { user } = useAuth();

  const canMaterial = can('material_requests:authorize');
  // RFC-006 F6: el Gerente firma retiros sobre el tope, pero las entregas sin
  // biometría son de la operación diaria del pañol (ADC / administración).
  const canBiometric = canMaterial && user?.role !== 'gerente-general';
  const canPurchase = can('purchase_requests:authorize');
  const canRental = can('rentals:authorize');
  // RFC-006 F1: el Jefe de Operaciones revisa compras y arriendos antes del ADC.
  const canReviewPurchase = can('purchase_requests:review_operations');
  const canReviewRental = can('rentals:review_operations');
  // RFC-006 F2: firma de compras según el monto (ADC del contrato / Gerente).
  const canSign = can('approvals:sign_adc') || can('approvals:sign_gerente');
  const toSign = useProposalsToSign();

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

  // RFC-006 F5: con la exigencia encendida, el retiro lo firma el ADC de su
  // contrato (bajo el tope) o el Gerente General (sobre el tope), según su valor.
  const enforced = !!currentTenant?.approvalSettings?.enforced;
  const isAdminRole = ['administrador', 'soporte-pagnol', 'super-admin'].includes(user?.role || '');
  const unitCost = useMemo(() => new Map((materials || []).map((m: any) => [m.id, m.unitCost])), [materials]);
  const contractById = useMemo(() => new Map((contracts || []).map((c: any) => [c.id, c])), [contracts]);

  // RFC-006 F6: con la exigencia encendida, un ADC ve sólo los pedidos de los
  // contratos donde él es el ADC asignado (la base no le deja autorizar otros).
  const onlyMyContracts = enforced && user?.role === 'adc';
  const isMyContract = (contractId?: string | null) =>
    !onlyMyContracts || (!!contractId && contractById.get(contractId)?.adcUserId === user?.id);

  // Solo pendientes SIN autorizar (gate del ADC abajo).
  const materialItems: ApprovableRequest[] = useMemo(() =>
    (materialRequests || [])
      .filter((r: any) => r.status === 'pending' && !r.adcAuthorizedAt)
      .map((r: any) => {
        const c = r.contractId ? contractById.get(r.contractId) : null;
        const res = resolveSigners({
          net: withdrawalValueNet(r.items, unitCost),
          settings: currentTenant?.approvalSettings,
          contracts: c ? [{ id: c.id, name: c.name, adcUserId: c.adcUserId }] : [],
        });
        const signer = res.tier === 'gerente' ? 'Gerente General'
          : c?.adcUserId ? `${userMap.get(c.adcUserId) || 'ADC'} (ADC ${c.name})`
          : c ? `ADC de ${c.name} (sin asignar)` : 'administración (sin contrato)';
        const mine = isAdminRole
          || (res.tier === 'gerente' && user?.role === 'gerente-general')
          || (res.tier === 'adc' && !!c?.adcUserId && c.adcUserId === user?.id);
        return {
          id: r.id,
          code: r.internalCode,
          requesterName: r.userName || userMap.get(r.supervisorId),
          contractName: r.contractName,
          date: r.createdAt,
          valueNote: enforced ? `Valor ${'$' + res.gross.toLocaleString('es-CL')} con IVA · firma: ${signer}` : null,
          _mine: mine,
          lines: (r.items || []).map((it: any) => ({
            label: materialMap.get(it.materialId) || 'Material',
            qty: it.quantity,
          })),
        };
      })
      // Cada firmante ve lo suyo (administración, todo).
      .filter((x: any) => !enforced || x._mine),
  [materialRequests, materialMap, userMap, contractById, unitCost, currentTenant?.approvalSettings, enforced, isAdminRole, user?.id, user?.role]);

  const purchaseItems: ApprovableRequest[] = useMemo(() =>
    (purchaseRequests || [])
      // Un requerimiento de arriendo ya viaja en la pestaña "Arriendo" a través
      // de su solicitud: si apareciera también acá, el ADC vería el mismo
      // pedido dos veces y lo autorizaría dos veces (RFC-004 F3).
      .filter((r: any) => isWaitingAdc(r) && !r.rentalRequestId && isMyContract(r.contractId))
      .map((r: any) => ({
        id: r.id,
        code: r.internalCode || r.id,
        reviewedBy: r.opsReviewedByName ? { name: r.opsReviewedByName, note: r.opsReviewNote } : null,
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
          originalQty: r.originalQuantity ?? null,
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [purchaseRequests, userMap, onlyMyContracts, contractById, user?.id]);

  const rentalItems: ApprovableRequest[] = useMemo(() =>
    (rentalRequests || [])
      // `opsReviewedAt === undefined` = migración sin aplicar: se comporta como antes.
      .filter((r: any) => r.status === 'pending' && !r.adcAuthorizedAt && r.opsReviewedAt !== null && isMyContract(r.contractId))
      .map((r: any) => ({
        id: r.id,
        code: r.internalCode,
        requesterName: r.supervisorName || userMap.get(r.supervisorId),
        contractName: r.contractName,
        date: r.createdAt,
        justification: r.justification,
        reviewedBy: r.opsReviewedByName ? { name: r.opsReviewedByName, note: r.opsReviewNote } : null,
        lines: (r.items || []).map((it: any) => ({
          label: it.name,
          qty: it.quantity,
          originalQty: it.originalQuantity ?? null,
          meta: rentalCategoryLabel(it.category),
        })),
      })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [rentalRequests, userMap, onlyMyContracts, contractById, user?.id]);

  // ── RFC-006 F1: bandeja del Jefe de Operaciones ────────────────────────────
  // Un pedido de compra son varias filas con el mismo batch_id: se revisa entero.
  const opsPurchaseGroups: OpsReviewGroup[] = useMemo(() => {
    const groups = new Map<string, PurchaseRequest[]>();
    for (const r of (purchaseRequests || []) as PurchaseRequest[]) {
      if (!isWaitingOps(r)) continue;
      const k = r.batchId || r.id;
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    return [...groups.entries()].map(([key, unsorted]) => {
      // En el orden en que se pidieron: la tarjeta muestra el primer código.
      const rows = [...unsorted].sort((a, b) => (a.internalCode || '').localeCompare(b.internalCode || ''));
      const first = rows[0];
      return {
        key,
        code: rows.length > 1 ? `${first.internalCode || ''} +${rows.length - 1}` : (first.internalCode || undefined),
        requesterName: first.requesterName || userMap.get(first.supervisorId),
        contractName: first.contractName || undefined,
        date: first.createdAt,
        justification: first.justification || undefined,
        meta: first as any,
        lines: rows.map(r => ({
          key: r.id,
          label: r.materialName,
          meta: [r.itemDescription, r.category].filter(Boolean).join(' · ') || undefined,
          quantity: Number(r.quantity) || 1,
          unit: r.unit,
        })),
      };
    }).sort((a, b) => ((a.meta as any)?.neededBy || '9999-12-31').localeCompare((b.meta as any)?.neededBy || '9999-12-31'));
  }, [purchaseRequests, userMap]);

  const opsRentalGroups: OpsReviewGroup[] = useMemo(() =>
    (rentalRequests || [])
      .filter((r: any) => r.status === 'pending' && r.opsReviewedAt === null && !r.adcAuthorizedAt)
      .map((r: any) => ({
        key: r.id,
        code: r.internalCode,
        requesterName: r.supervisorName || userMap.get(r.supervisorId),
        contractName: r.contractName,
        date: r.createdAt,
        justification: r.justification,
        lines: (r.items || []).map((it: any, i: number) => ({
          key: String(i),
          label: it.name,
          meta: rentalCategoryLabel(it.category),
          quantity: Number(it.quantity) || 1,
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

  // La pestaña sugerida depende de datos que llegan después del primer render
  // (si se fijara al montar, la ADC abriría en "Material" con algo por firmar).
  // Se sigue la sugerencia hasta que la persona elige una pestaña.
  const [tab, setTab] = React.useState<string | null>(null);

  // Abre en la primera pestaña que le toca a quien entra.
  const defaultTab = canSign && toSign.length > 0 ? 'firmar'
    : canReviewPurchase ? 'revisar-compra'
    : canReviewRental ? 'revisar-arriendo'
    : canMaterial ? 'material'
    : canPurchase ? 'compra'
    : canRental ? 'arriendo'
    : 'material';

  return (
    <PageShell
      title="Autorizaciones"
      description="Revisa y autoriza lo que pide terreno (material, compras y arriendos) antes de que Abastecimiento lo gestione."
    >
      <Tabs value={tab ?? defaultTab} onValueChange={setTab} className="space-y-6">
        <TabsList className="flex-wrap h-auto">
          {canSign && <TabsTrigger value="firmar">Por firmar ({toSign.length})</TabsTrigger>}
          {canSign && <TabsTrigger value="urgentes">Compras urgentes</TabsTrigger>}
          {canReviewPurchase && <TabsTrigger value="revisar-compra">Revisar compras ({opsPurchaseGroups.length})</TabsTrigger>}
          {canReviewRental && <TabsTrigger value="revisar-arriendo">Revisar arriendos ({opsRentalGroups.length})</TabsTrigger>}
          {canMaterial && <TabsTrigger value="material">Material ({materialItems.length})</TabsTrigger>}
          {canPurchase && <TabsTrigger value="compra">Compra ({purchaseItems.length})</TabsTrigger>}
          {canRental && <TabsTrigger value="arriendo">Arriendo ({rentalItems.length})</TabsTrigger>}
          {canBiometric && <TabsTrigger value="biometria">Sin biometría ({excepcionesPendientes.length})</TabsTrigger>}
        </TabsList>

        <TabsContent value="firmar">
          <ProposalSignInbox proposals={toSign} />
        </TabsContent>

        <TabsContent value="urgentes">
          <UrgentPurchasesReport />
        </TabsContent>

        <TabsContent value="revisar-compra">
          <OpsReviewInbox
            groups={opsPurchaseGroups}
            canReview={canReviewPurchase}
            allowRemoveLines
            typeLabel="Compra"
            typeBadgeClass="badge-success"
            lineIcon={<ShoppingCart className="h-3.5 w-3.5" />}
            emptyTitle="Sin compras por revisar"
            emptyDescription="Cuando terreno pida una compra, la revisas aquí antes de que pase al ADC."
            onApprove={(g, res) => reviewPurchaseRequests({
              decision: 'approve',
              note: res.note,
              lines: g.lines.map(ln => ({ id: ln.key, quantity: res.quantities[ln.key], remove: res.removed.includes(ln.key) })),
            })}
            onReject={(g, note) => reviewPurchaseRequests({ decision: 'reject', note, lines: g.lines.map(ln => ({ id: ln.key })) })}
          />
        </TabsContent>

        <TabsContent value="revisar-arriendo">
          <OpsReviewInbox
            groups={opsRentalGroups}
            canReview={canReviewRental}
            allowRemoveLines={false}
            typeLabel="Arriendo"
            typeBadgeClass="badge-warning"
            lineIcon={<Truck className="h-3.5 w-3.5" />}
            emptyTitle="Sin arriendos por revisar"
            emptyDescription="Cuando terreno pida un arriendo, lo revisas aquí antes de que pase al ADC."
            onApprove={(g, res) => reviewRentalRequest({ id: g.key, decision: 'approve', note: res.note, quantities: g.lines.map(ln => res.quantities[ln.key]) })}
            onReject={(g, note) => reviewRentalRequest({ id: g.key, decision: 'reject', note })}
          />
        </TabsContent>

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
            canAuthorize={canBiometric}
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
