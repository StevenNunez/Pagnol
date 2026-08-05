"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoadingState } from "@/components/loading-state";

/**
 * RFC-004 F3 — Puerta única.
 *
 * Pedir un arriendo dejó de tener formulario propio: se pide desde el
 * Requerimiento (RQ), eligiendo "Contratar servicio → Arriendo". Así el
 * arriendo nace con CeCo, partida, urgencia y motivo —que este formulario no
 * capturaba— y con UN solo código para toda la cadena.
 *
 * El flujo de gestión NO cambió: al enviar se crea la misma solicitud de
 * arriendo de siempre y sigue por cotización, comparador, adjudicación, OC y
 * calendario de ciclos.
 *
 * Se conserva la ruta —en vez de borrarla— porque está enlazada desde el hub de
 * Supervisor, el sidebar y enlaces que la gente ya tiene guardados: un 404
 * habría sido peor que una redirección.
 */
export default function RentalRequestRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/dashboard/purchasing/purchase-request-form?tipo=arriendo");
  }, [router]);

  return <LoadingState fullHeight label="Las solicitudes de arriendo ahora se piden desde Requerimientos…" />;
}
