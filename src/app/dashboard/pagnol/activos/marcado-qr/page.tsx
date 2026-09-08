"use client";

// Prepara el lote de archivos para la pistola marcadora: un BMP por herramienta,
// numerados IMG001.bmp en adelante, más la hoja índice que dice qué archivo es
// qué equipo — la pantalla de la pistola sólo muestra nombres de archivo.

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Download, Search, Loader2, AlertCircle, Wrench, Info } from "lucide-react";

import { useAppState } from "@/modules/core/contexts/app-provider";
import { PageShell } from "@/components/page-shell";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/modules/core/hooks/use-toast";
import { isMarkable, materialKind } from "@/modules/core/lib/material-kind";
import { qrToBmp, validarPayload, nombreArchivoLote } from "@/lib/qrBmp";
import type { Material } from "@/modules/core/lib/data";

const MICRO_LABEL = "text-[10px] font-black uppercase tracking-widest text-muted-foreground";

/** La pistola numera los archivos con tres dígitos: IMG001 … IMG999. */
const MAX_POR_LOTE = 999;

interface Fila {
  material: Material;
  /** Contenido del QR, ya normalizado. Vacío si el equipo no se puede marcar. */
  codigo: string;
  /** Por qué este equipo no puede entrar al lote. */
  problema?: string;
}

export default function MarcadoQrPage() {
  const { materials, isLoading, can, currentTenant } = useAppState();
  const router = useRouter();
  const { toast } = useToast();

  const [busqueda, setBusqueda] = useState("");
  const [categoria, setCategoria] = useState("TODAS");
  const [excluidos, setExcluidos] = useState<Set<string>>(new Set());
  const [generando, setGenerando] = useState(false);

  // ── Universo: qué se marca, qué no, y por qué ─────────────────────────────
  const { listos, conProblema, fuera } = useMemo(() => {
    const vivos = (materials || []).filter((m: Material) => !m.archived);
    const listos: Fila[] = [];
    const conProblema: Fila[] = [];
    const fuera = { ajenos: 0, epp: 0, consumibles: 0 };

    for (const material of vivos) {
      if (!isMarkable(material)) {
        if (material.ownership && material.ownership !== "propio") fuera.ajenos++;
        else if (materialKind(material) === "ppe") fuera.epp++;
        else fuera.consumibles++;
        continue;
      }
      const revision = validarPayload(material.internalCode);
      if (revision.ok) listos.push({ material, codigo: revision.payload });
      else conProblema.push({ material, codigo: "", problema: revision.motivo });
    }

    listos.sort((a, b) => a.codigo.localeCompare(b.codigo));
    return { listos, conProblema, fuera };
  }, [materials]);

  // Los problemas se repiten (decenas de equipos sin código, por ejemplo), así
  // que se agrupan por motivo: una lista de 56 líneas idénticas no se lee.
  const problemasAgrupados = useMemo(() => {
    const porMotivo = new Map<string, Map<string, number>>();
    for (const fila of conProblema) {
      const nombres = porMotivo.get(fila.problema!) || new Map<string, number>();
      // El mismo equipo suele estar repetido (una ficha por contrato o faena);
      // listarlo ocho veces no aporta, se muestra con su cuenta.
      nombres.set(fila.material.name, (nombres.get(fila.material.name) || 0) + 1);
      porMotivo.set(fila.problema!, nombres);
    }
    return [...porMotivo.entries()]
      .map(([motivo, nombres]) => ({
        motivo,
        total: [...nombres.values()].reduce((s, n) => s + n, 0),
        equipos: [...nombres.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([nombre, veces]) => (veces > 1 ? `${nombre} (×${veces})` : nombre)),
      }))
      .sort((a, b) => b.total - a.total);
  }, [conProblema]);

  const categorias = useMemo(
    () => [...new Set(listos.map((f) => f.material.category).filter(Boolean))].sort() as string[],
    [listos]
  );

  const visibles = useMemo(() => {
    const termino = busqueda.trim().toLowerCase();
    return listos.filter((f) => {
      if (categoria !== "TODAS" && f.material.category !== categoria) return false;
      if (!termino) return true;
      return (
        f.material.name.toLowerCase().includes(termino) ||
        f.codigo.toLowerCase().includes(termino) ||
        (f.material.brand || "").toLowerCase().includes(termino)
      );
    });
  }, [listos, busqueda, categoria]);

  // Todo entra al lote salvo lo que se destilde: evita tener que marcar 116
  // casillas para el caso normal, que es "grabar todo lo que falta".
  const seleccionadas = useMemo(
    () => visibles.filter((f) => !excluidos.has(f.material.id)),
    [visibles, excluidos]
  );
  const todasMarcadas = visibles.length > 0 && seleccionadas.length === visibles.length;

  const alternarUna = (id: string) =>
    setExcluidos((previo) => {
      const siguiente = new Set(previo);
      if (siguiente.has(id)) siguiente.delete(id);
      else siguiente.add(id);
      return siguiente;
    });

  const alternarVisibles = () =>
    setExcluidos((previo) => {
      const siguiente = new Set(previo);
      visibles.forEach((f) => (todasMarcadas ? siguiente.add(f.material.id) : siguiente.delete(f.material.id)));
      return siguiente;
    });

  // ── Generación del lote ───────────────────────────────────────────────────
  const descargarLote = async () => {
    if (seleccionadas.length === 0) return;
    if (seleccionadas.length > MAX_POR_LOTE) {
      toast({
        variant: "destructive",
        title: "El lote es muy grande",
        description: `La pistola numera hasta ${MAX_POR_LOTE} archivos. Filtra por categoría y descarga en tandas.`,
      });
      return;
    }

    setGenerando(true);
    try {
      const [{ default: JSZip }, ExcelJS] = await Promise.all([import("jszip"), import("exceljs")]);
      const zip = new JSZip();

      const filas = seleccionadas.map((fila, indice) => {
        const archivo = nombreArchivoLote(indice + 1);
        zip.file(archivo, qrToBmp(fila.codigo));
        return { archivo, fila };
      });

      // La hoja índice: sin ella, el operador ve "IMG047.bmp" y no sabe a qué
      // equipo corresponde. Se imprime y se lleva a terreno.
      const libro = new ExcelJS.Workbook();
      const hoja = libro.addWorksheet("Lote de marcado");
      hoja.columns = [
        { header: "Archivo", key: "archivo", width: 14 },
        { header: "Código grabado", key: "codigo", width: 20 },
        { header: "Equipo", key: "equipo", width: 45 },
        { header: "Marca", key: "marca", width: 18 },
        { header: "Categoría", key: "categoria", width: 30 },
        { header: "Marcado ✓", key: "hecho", width: 12 },
      ];
      hoja.getRow(1).font = { bold: true };
      hoja.addRows(
        filas.map(({ archivo, fila }) => ({
          archivo,
          codigo: fila.codigo,
          equipo: fila.material.name,
          marca: fila.material.brand || "",
          categoria: fila.material.category || "",
          hecho: "",
        }))
      );
      zip.file("INDICE.xlsx", await libro.xlsx.writeBuffer());

      const paquete = await zip.generateAsync({ type: "blob" });
      const direccion = URL.createObjectURL(paquete);
      const enlace = document.createElement("a");
      enlace.href = direccion;
      enlace.setAttribute(
        "download",
        `Marcado_QR_${(currentTenant?.name || "PAGNOL").replace(/[^\w-]+/g, "_")}_${new Date().toISOString().split("T")[0]}.zip`
      );
      document.body.appendChild(enlace);
      enlace.click();
      document.body.removeChild(enlace);
      // Liberar el enlace de inmediato cancela la descarga a medio empezar: el
      // navegador todavía está leyendo el blob. Se suelta cuando ya terminó.
      setTimeout(() => URL.revokeObjectURL(direccion), 60_000);

      toast({
        variant: "info",
        title: `Lote de ${filas.length} equipos listo`,
        description: "Copia los .bmp a la raíz del pendrive e imprime el índice antes de salir a terreno.",
      });
    } catch (error) {
      console.error("Error al generar el lote de marcado:", error);
      toast({
        variant: "destructive",
        title: "No se pudo generar el lote",
        description: error instanceof Error ? error.message : "Revisa la consola para el detalle.",
      });
    } finally {
      setGenerando(false);
    }
  };

  // ── Permisos ──────────────────────────────────────────────────────────────
  if (!can("users:print_qr")) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Acceso Denegado</AlertTitle>
        <AlertDescription>No tienes los permisos necesarios para acceder a esta sección.</AlertDescription>
      </Alert>
    );
  }

  const columnas: DataTableColumn<Fila>[] = [
    {
      key: "seleccion",
      header: (
        <Checkbox
          checked={todasMarcadas}
          onCheckedChange={alternarVisibles}
          aria-label="Incluir o quitar todos los equipos de la lista"
        />
      ),
      headerClassName: "w-12",
      className: "w-12",
      cell: (fila) => (
        <Checkbox
          checked={!excluidos.has(fila.material.id)}
          onCheckedChange={() => alternarUna(fila.material.id)}
          aria-label={`Incluir ${fila.material.name} en el lote`}
        />
      ),
    },
    {
      key: "codigo",
      header: "Código a grabar",
      cell: (fila) => <span className="font-mono text-xs font-black tracking-tight">{fila.codigo}</span>,
    },
    {
      key: "equipo",
      header: "Equipo",
      cell: (fila) => (
        <div>
          <p className="font-bold text-foreground leading-tight">{fila.material.name}</p>
          {fila.material.brand && <p className="text-xs text-muted-foreground">{fila.material.brand}</p>}
        </div>
      ),
    },
    {
      key: "categoria",
      header: "Categoría",
      cell: (fila) => <span className="text-xs text-muted-foreground">{fila.material.category}</span>,
    },
  ];

  const totalFuera = fuera.consumibles + fuera.epp + fuera.ajenos;

  return (
    <PageShell
      title="Marcado con Pistola"
      description="Genera los archivos que la pistola graba sobre el equipo. Sólo entran las herramientas que salen del pañol y tienen que volver."
      toolbar={
        <>
          <div className="flex flex-col sm:flex-row gap-4 w-full xl:w-auto">
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
              <Input
                placeholder="Buscar por equipo, código o marca..."
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                className="pl-12 pr-6 py-4 h-auto rounded-[1.5rem]"
              />
            </div>
            <Select value={categoria} onValueChange={setCategoria}>
              <SelectTrigger className="w-full sm:w-64 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TODAS">Todas las categorías</SelectItem>
                {categorias.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col sm:flex-row gap-4 w-full xl:w-auto">
            <Button variant="outline" onClick={() => router.back()} className="rounded-[1.5rem] px-6 py-5 sm:py-4">
              <ArrowLeft size={18} className="mr-2" /> Volver
            </Button>
            <Button
              onClick={descargarLote}
              disabled={generando || seleccionadas.length === 0}
              className="rounded-[1.5rem] px-8 py-5 sm:py-4 shadow-lg shadow-primary/10 transform hover:scale-105 active:scale-95"
            >
              {generando ? (
                <>
                  <Loader2 size={18} className="mr-2 animate-spin" /> Generando…
                </>
              ) : (
                <>
                  <Download size={18} className="mr-2" /> Descargar lote ({seleccionadas.length})
                </>
              )}
            </Button>
          </div>
        </>
      }
    >
      {/* Resumen del universo */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="rounded-[1.5rem]">
          <CardContent className="p-6">
            <p className={MICRO_LABEL}>Herramientas marcables</p>
            <p className="text-3xl font-black text-foreground mt-1">{listos.length}</p>
          </CardContent>
        </Card>
        <Card className="rounded-[1.5rem]">
          <CardContent className="p-6">
            <p className={MICRO_LABEL}>En este lote</p>
            <p className="text-3xl font-black text-primary mt-1">{seleccionadas.length}</p>
          </CardContent>
        </Card>
        <Card className="rounded-[1.5rem]">
          <CardContent className="p-6">
            <p className={MICRO_LABEL}>No se marcan</p>
            <p className="text-3xl font-black text-muted-foreground mt-1">{totalFuera}</p>
            <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
              {fuera.consumibles} se {fuera.consumibles === 1 ? "consume" : "consumen"} · {fuera.epp}{" "}
              {fuera.epp === 1 ? "es EPP" : "son EPP"} · {fuera.ajenos}{" "}
              {fuera.ajenos === 1 ? "no es de la empresa" : "no son de la empresa"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Equipos que no pueden entrar al lote */}
      {conProblema.length > 0 && (
        <Card className="rounded-[1.5rem] border-warning">
          <CardHeader>
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              <AlertCircle size={18} className="text-warning" />
              {conProblema.length} {conProblema.length === 1 ? "herramienta queda" : "herramientas quedan"} fuera del lote
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {problemasAgrupados.map(({ motivo, total, equipos }) => {
              const muestra = equipos.slice(0, 8);
              const restantes = equipos.length - muestra.length;
              return (
                <div key={motivo}>
                  <p className={MICRO_LABEL}>
                    {total} {total === 1 ? "equipo" : "equipos"}
                  </p>
                  <p className="text-sm font-bold text-foreground mt-1">{motivo}</p>
                  <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                    {muestra.join(" · ")}
                    {restantes > 0 && ` · y ${restantes} ${restantes === 1 ? "modelo" : "modelos"} más`}
                  </p>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Cómo se usa el lote */}
      <Alert className="rounded-[1.5rem]">
        <Info className="h-4 w-4" />
        <AlertTitle>Qué hacer con el archivo</AlertTitle>
        <AlertDescription className="leading-relaxed">
          El ZIP trae un <strong>.bmp por equipo</strong> —numerados IMG001 en adelante— y un{" "}
          <strong>INDICE.xlsx</strong>. Copia los .bmp a la raíz del pendrive: la pistola los lista en ese orden, y
          como en pantalla sólo se ven los nombres de archivo, <strong>imprime el índice</strong> para saber cuál va en
          cada equipo. Cada lote empieza de nuevo en IMG001, así que el índice sirve sólo para su propio lote.
        </AlertDescription>
      </Alert>

      <DataTable
        columns={columnas}
        data={visibles}
        rowKey={(fila) => fila.material.id}
        isLoading={isLoading}
        loadingLabel="Cargando herramientas…"
        minWidth="700px"
        empty={{
          icon: <Wrench size={24} />,
          title: listos.length === 0 ? "No hay herramientas para marcar" : "Ningún equipo calza con el filtro",
          description:
            listos.length === 0
              ? "Se marcan sólo las herramientas propias que salen del pañol y vuelven. Revisa el tipo de uso de tus activos."
              : "Prueba con otra categoría o limpia la búsqueda.",
        }}
      />
    </PageShell>
  );
}
