import { format } from "date-fns";
import type { Material } from "@/modules/core/lib/data";
import type { ReviewableWithdrawal, WithdrawalObservation } from "./use-reviewable-withdrawals";

const STATUS_LABEL = { open: "Abierta", returned: "Devuelta", justified: "Justificada" } as const;

/**
 * Excel con una fila por línea de cada retiro con revisión posterior: qué se
 * llevó, si correspondía y, lo que no, en qué quedó. Se carga `exceljs` recién
 * al descargar para no sumarle peso a la página en el celular.
 */
export async function downloadWithdrawalReport({
    withdrawals, observations, workerName, materialMap, companyName,
}: {
    withdrawals: ReviewableWithdrawal[];
    observations: WithdrawalObservation[];
    workerName: (w: ReviewableWithdrawal) => string;
    materialMap: Map<string, Material>;
    companyName?: string;
}) {
    const ExcelJS = await import("exceljs");
    const obsByReview = new Map(observations.map(o => [o.fact.id, o]));

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Retiros revisados");
    ws.columns = [
        { header: "Fecha retiro", key: "date", width: 17 },
        { header: "Código", key: "code", width: 16 },
        { header: "Trabajador", key: "worker", width: 26 },
        { header: "Contrato", key: "contract", width: 30 },
        { header: "Destino", key: "area", width: 24 },
        { header: "Material", key: "material", width: 36 },
        { header: "Código material", key: "mcode", width: 16 },
        { header: "Cantidad", key: "qty", width: 10 },
        { header: "Revisión", key: "decision", width: 16 },
        { header: "Motivo", key: "reason", width: 30 },
        { header: "Revisó", key: "reviewer", width: 22 },
        { header: "Fecha revisión", key: "reviewedAt", width: 17 },
        { header: "Estado de lo no autorizado", key: "status", width: 24 },
        { header: "Cierre", key: "closure", width: 40 },
    ];
    ws.getRow(1).font = { bold: true };

    for (const w of withdrawals) {
        const factByMaterial = new Map(w.facts.filter(f => f.materialId).map(f => [f.materialId as string, f]));
        const qtyByMaterial = new Map<string, number>();
        for (const it of w.req.items || []) qtyByMaterial.set(it.materialId, (qtyByMaterial.get(it.materialId) || 0) + (Number(it.quantity) || 0));

        for (const [materialId, qty] of qtyByMaterial) {
            const m = materialMap.get(materialId);
            const fact = factByMaterial.get(materialId);
            const obs = fact ? obsByReview.get(fact.id) : undefined;
            const closure = obs?.resolution
                ? `Justificada por ${obs.resolution.resolvedByName}: ${obs.resolution.note}`
                : obs?.state.status === "returned" && obs.state.closingReturn
                    ? `Devuelta${obs.state.closingReturn.internalCode ? ` (${obs.state.closingReturn.internalCode})` : ""} el ${format(obs.state.closingReturn.at, "dd-MM-yyyy HH:mm")}`
                    : obs && obs.state.returnedQty > 0 ? `Devolvió ${obs.state.returnedQty} de ${fact!.quantity}` : "";
            ws.addRow({
                date: format(new Date(w.req.createdAt as any), "dd-MM-yyyy HH:mm"),
                code: w.req.internalCode || "",
                worker: workerName(w),
                contract: w.req.contractName || "",
                area: w.req.area || "",
                material: m?.name || fact?.materialName || "",
                mcode: m?.internalCode || "",
                qty,
                decision: !fact ? "Pendiente" : fact.decision === "authorized" ? "Corresponde" : "No corresponde",
                reason: fact?.reason || "",
                reviewer: fact?.reviewerName || "",
                reviewedAt: fact ? format(fact.createdAt, "dd-MM-yyyy HH:mm") : "",
                status: obs ? STATUS_LABEL[obs.state.status] : "",
                closure,
            });
        }
    }
    ws.autoFilter = { from: "A1", to: "N1" };
    ws.views = [{ state: "frozen", ySplit: 1 }];

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `retiros-revisados${companyName ? `-${companyName.replace(/[^\w-]+/g, "_")}` : ""}-${format(new Date(), "yyyy-MM-dd")}.xlsx`;
    a.click();
    // Revocar en el mismo tick puede cancelar la descarga en algunos navegadores.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
