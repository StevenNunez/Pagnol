"use client";

import React, { useState, useRef, useMemo, useCallback, useEffect } from "react";
import { useAppState } from "@/modules/core/contexts/app-provider";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { QRCodeCanvas } from "qrcode.react";
import { QRWithPagnolLogo } from "@/components/qr-with-pagnol-logo";
import {
  Printer,
  Download,
  Search,
  CheckCircle2,
  AlertCircle,
  Copy,
  RotateCw,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Package,
  Grid,
  List as ListIcon,
  Loader2,
} from "lucide-react";
import { useToast } from "@/modules/core/hooks/use-toast";
import { Material } from "@/modules/core/lib/data";
import Image from "next/image";

// ─── Label dimensions ────────────────────────────────────────────────────────
const LABEL_W_MM = 22;
const LABEL_H_MM = 32;

// ─── Page ────────────────────────────────────────────────────────────────────
const LabelPrintingPage: React.FC = () => {
  const { materials } = useAppState();
  const { toast } = useToast();

  const [selectedAssets, setSelectedAssets] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [copiesPerAsset, setCopiesPerAsset] = useState(1);
  const [expandedAsset, setExpandedAsset] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  // Absolute logo URL needed by QRCodeCanvas imageSettings (avoids canvas CORS taint)
  const [logoUrl, setLogoUrl] = useState("/logo1.png");
  useEffect(() => { setLogoUrl(`${window.location.origin}/logo1.png`); }, []);

  // Refs to hidden QRCodeCanvas elements — used for PDF generation
  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());

  const filteredAssets = useMemo(() => {
    return (materials || []).filter(
      (asset) =>
        !asset.archived &&
        (asset.name.toLowerCase().includes(filter.toLowerCase()) ||
          asset.id.toLowerCase().includes(filter.toLowerCase()) ||
          asset.category.toLowerCase().includes(filter.toLowerCase()))
    );
  }, [materials, filter]);

  const assetsToPrint = useMemo(
    () => filteredAssets.filter((asset) => selectedAssets.has(asset.id)),
    [filteredAssets, selectedAssets]
  );

  const toggleAssetSelection = (assetId: string) => {
    setSelectedAssets((prev) => {
      const next = new Set(prev);
      next.has(assetId) ? next.delete(assetId) : next.add(assetId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedAssets(
      selectedAssets.size === filteredAssets.length
        ? new Set()
        : new Set(filteredAssets.map((a) => a.id))
    );
  };

  // ── Print via browser ──────────────────────────────────────────────────────
  const handlePrint = () => {
    if (assetsToPrint.length === 0) {
      toast({ variant: "destructive", title: "Sin activos seleccionados" });
      return;
    }
    window.print();
  };

  // ── PDF export via jsPDF + canvas QR data URLs ─────────────────────────────
  const handleExportPDF = useCallback(async () => {
    if (assetsToPrint.length === 0) {
      toast({ variant: "destructive", title: "Sin activos seleccionados" });
      return;
    }
    setIsGeneratingPdf(true);
    try {
      const { default: jsPDF } = await import("jspdf");

      const PAGE_W = 210; // A4 portrait mm
      const PAGE_H = 297;
      const MARGIN_X = (PAGE_W - Math.floor(PAGE_W / LABEL_W_MM) * LABEL_W_MM) / 2;
      const MARGIN_Y = (PAGE_H - Math.floor(PAGE_H / LABEL_H_MM) * LABEL_H_MM) / 2;
      const COLS = Math.floor((PAGE_W - MARGIN_X * 2) / LABEL_W_MM);
      const ROWS = Math.floor((PAGE_H - MARGIN_Y * 2) / LABEL_H_MM);
      const PER_PAGE = COLS * ROWS;

      const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

      const labels: Material[] = assetsToPrint.flatMap((asset) =>
        Array.from({ length: copiesPerAsset }, () => asset)
      );

      labels.forEach((asset, idx) => {
        if (idx > 0 && idx % PER_PAGE === 0) doc.addPage();

        const pos = idx % PER_PAGE;
        const col = pos % COLS;
        const row = Math.floor(pos / COLS);
        const x = MARGIN_X + col * LABEL_W_MM;
        const y = MARGIN_Y + row * LABEL_H_MM;

        // Border
        doc.setDrawColor(220, 220, 220);
        doc.setLineWidth(0.15);
        doc.rect(x, y, LABEL_W_MM, LABEL_H_MM);

        // QR code image from canvas ref
        const canvas = canvasRefs.current.get(asset.id);
        if (canvas) {
          const dataUrl = canvas.toDataURL("image/png");
          const QR_SIZE = 17;
          const qrX = x + (LABEL_W_MM - QR_SIZE) / 2;
          doc.addImage(dataUrl, "PNG", qrX, y + 1.5, QR_SIZE, QR_SIZE);
        }

        // ID — bold (prefer internalCode, fallback to uuid)
        const displayId = asset.internalCode || asset.id;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(5);
        doc.setTextColor(30, 30, 30);
        doc.text(displayId, x + LABEL_W_MM / 2, y + 20.5, { align: "center" });

        // Name — truncated
        doc.setFont("helvetica", "normal");
        doc.setFontSize(4);
        doc.setTextColor(60, 60, 60);
        const name =
          asset.name.length > 22 ? asset.name.substring(0, 20) + "…" : asset.name;
        doc.text(name, x + LABEL_W_MM / 2, y + 24, { align: "center" });

        // Category
        doc.setFontSize(3.5);
        doc.setTextColor(100, 100, 100);
        doc.text(
          asset.category.toUpperCase(),
          x + LABEL_W_MM / 2,
          y + 27,
          { align: "center" }
        );

        // Footer branding
        doc.setFontSize(3);
        doc.setTextColor(160, 160, 160);
        doc.text("PAGNOL · TRAZABILIDAD", x + LABEL_W_MM / 2, y + 30.5, {
          align: "center",
        });
      });

      doc.save("etiquetas-pagnol.pdf");
      toast({ title: "PDF generado", description: `${labels.length} etiquetas exportadas.` });
    } catch (err) {
      console.error(err);
      toast({ variant: "destructive", title: "Error al generar PDF" });
    } finally {
      setIsGeneratingPdf(false);
    }
  }, [assetsToPrint, copiesPerAsset, toast]);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Impresión de Etiquetas"
        description="Genera e imprime etiquetas adhesivas (22×32mm) con códigos QR para tus activos."
      />

      {/* Hidden QR canvases — used by handleExportPDF */}
      <div style={{ position: "absolute", left: "-9999px", top: 0, visibility: "hidden" }}>
        {filteredAssets.map((asset) => (
          <QRCodeCanvas
            key={asset.id}
            value={asset.internalCode || asset.id}
            size={200}
            level="H"
            imageSettings={{
              src: logoUrl,
              height: 56,
              width: 56,
              excavate: true,
              crossOrigin: "anonymous",
            }}
            ref={(el) => {
              if (el) canvasRefs.current.set(asset.id, el);
              else canvasRefs.current.delete(asset.id);
            }}
          />
        ))}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <Card className="rounded-[2.5rem] border-none shadow-xl bg-gradient-to-br from-blue-50 to-indigo-50">
          <CardContent className="p-8">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-black uppercase text-muted-foreground tracking-widest mb-2">Activos Totales</p>
                <p className="text-4xl font-black text-slate-900">{filteredAssets.length}</p>
              </div>
              <Package className="h-12 w-12 text-blue-600 opacity-20" />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[2.5rem] border-none shadow-xl bg-gradient-to-br from-green-50 to-emerald-50">
          <CardContent className="p-8">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-black uppercase text-muted-foreground tracking-widest mb-2">Seleccionados</p>
                <p className="text-4xl font-black text-green-600">{selectedAssets.size}</p>
              </div>
              <CheckCircle2 className="h-12 w-12 text-green-600 opacity-20" />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[2.5rem] border-none shadow-xl bg-gradient-to-br from-orange-50 to-amber-50">
          <CardContent className="p-8">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-black uppercase text-muted-foreground tracking-widest mb-2">Etiquetas a Imprimir</p>
                <p className="text-4xl font-black text-orange-600">{selectedAssets.size * copiesPerAsset}</p>
              </div>
              <Printer className="h-12 w-12 text-orange-600 opacity-20" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Controls */}
      <Card className="rounded-[2.5rem] border-none shadow-xl bg-slate-100">
        <CardHeader className="p-8">
          <CardTitle className="text-xl font-black uppercase flex items-center gap-3">
            <Printer className="h-5 w-5 text-primary" />
            Configuración de Impresión
          </CardTitle>
        </CardHeader>
        <CardContent className="p-8 space-y-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por ID, nombre o categoría..."
                className="pl-10 h-11 rounded-xl"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
            <Button
              variant={viewMode === "grid" ? "default" : "outline"}
              onClick={() => setViewMode("grid")}
              className="h-11 rounded-xl"
            >
              <Grid className="h-4 w-4 mr-2" /> Cuadrícula
            </Button>
            <Button
              variant={viewMode === "list" ? "default" : "outline"}
              onClick={() => setViewMode("list")}
              className="h-11 rounded-xl"
            >
              <ListIcon className="h-4 w-4 mr-2" /> Lista
            </Button>
          </div>

          {/* Copies + actions */}
          <div className="flex items-end gap-4 flex-wrap">
            <div>
              <label className="text-xs font-black uppercase text-muted-foreground tracking-widest mb-2 block">
                Copias por Etiqueta
              </label>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCopiesPerAsset(Math.max(1, copiesPerAsset - 1))}
                  className="h-10 px-3 rounded-lg"
                >
                  −
                </Button>
                <Input
                  type="number"
                  min="1"
                  max="10"
                  value={copiesPerAsset}
                  onChange={(e) =>
                    setCopiesPerAsset(Math.max(1, parseInt(e.target.value) || 1))
                  }
                  className="w-16 h-10 text-center rounded-lg"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCopiesPerAsset(Math.min(10, copiesPerAsset + 1))}
                  className="h-10 px-3 rounded-lg"
                >
                  +
                </Button>
              </div>
            </div>

            <div className="ml-auto flex gap-2">
              <Button
                variant="outline"
                onClick={() => setSelectedAssets(new Set())}
                className="h-11 rounded-xl"
                disabled={selectedAssets.size === 0}
              >
                <RotateCw className="h-4 w-4 mr-2" /> Limpiar
              </Button>
              <Button
                onClick={toggleSelectAll}
                className="h-11 rounded-xl bg-slate-600 hover:bg-slate-700"
              >
                <Copy className="h-4 w-4 mr-2" />
                {selectedAssets.size === filteredAssets.length
                  ? "Deseleccionar Todo"
                  : "Seleccionar Todo"}
              </Button>
            </div>
          </div>

          {/* Print / Export actions */}
          <div className="flex flex-col sm:flex-row gap-4 pt-4 border-t">
            <Button
              onClick={() => setPreviewOpen(!previewOpen)}
              variant="outline"
              className="h-12 rounded-xl flex-1 sm:flex-none"
            >
              {previewOpen ? (
                <><EyeOff className="h-4 w-4 mr-2" /> Ocultar Vista Previa</>
              ) : (
                <><Eye className="h-4 w-4 mr-2" /> Ver Vista Previa</>
              )}
            </Button>

            <Button
              onClick={handleExportPDF}
              variant="outline"
              className="h-12 rounded-xl flex-1 sm:flex-none"
              disabled={selectedAssets.size === 0 || isGeneratingPdf}
            >
              {isGeneratingPdf ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              {isGeneratingPdf ? "Generando PDF…" : "Descargar PDF"}
            </Button>

            <Button
              onClick={handlePrint}
              className="h-12 rounded-xl flex-1 sm:flex-none bg-primary hover:bg-primary/90 text-white font-black uppercase tracking-widest"
              disabled={selectedAssets.size === 0}
            >
              <Printer className="h-4 w-4 mr-2" /> Imprimir Etiquetas
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Asset selector */}
      <Card className="rounded-[2.5rem] border-none shadow-xl bg-slate-100">
        <CardHeader className="p-8">
          <CardTitle className="text-xl font-black uppercase">
            Activos Disponibles ({filteredAssets.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-8">
          {filteredAssets.length === 0 ? (
            <div className="text-center py-12">
              <AlertCircle className="h-12 w-12 text-slate-300 mx-auto mb-4" />
              <p className="text-muted-foreground font-bold">No hay activos disponibles</p>
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {filteredAssets.map((asset) => (
                <div
                  key={asset.id}
                  onClick={() => toggleAssetSelection(asset.id)}
                  className={`rounded-[2rem] border-2 cursor-pointer transition-all p-6 ${
                    selectedAssets.has(asset.id)
                      ? "border-primary bg-primary/5 shadow-xl"
                      : "border-slate-200 hover:border-slate-300 bg-slate-100"
                  }`}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div
                      className={`w-5 h-5 rounded-md border-2 flex items-center justify-center ${
                        selectedAssets.has(asset.id)
                          ? "bg-primary border-primary"
                          : "border-slate-300"
                      }`}
                    >
                      {selectedAssets.has(asset.id) && (
                        <CheckCircle2 className="h-4 w-4 text-white" />
                      )}
                    </div>
                    {asset.photos?.[0] && (
                      <div className="w-12 h-12 rounded-lg overflow-hidden">
                        <Image
                          src={asset.photos[0]}
                          alt={asset.name}
                          width={48}
                          height={48}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <h4 className="font-black text-sm uppercase line-clamp-2">{asset.name}</h4>
                    <p className="text-xs text-muted-foreground font-mono">{asset.id}</p>
                    <p className="text-xs text-muted-foreground">{asset.category}</p>
                    <span className="inline-block text-[10px] font-black bg-slate-100 text-slate-600 px-2 py-1 rounded-md uppercase">
                      CLASE {asset.class}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredAssets.map((asset) => (
                <div
                  key={asset.id}
                  className={`rounded-xl border-2 p-4 cursor-pointer transition-all ${
                    selectedAssets.has(asset.id)
                      ? "border-primary bg-primary/5"
                      : "border-slate-200 hover:border-slate-300 bg-slate-100"
                  }`}
                  onClick={() => toggleAssetSelection(asset.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4 flex-1">
                      <div
                        className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 ${
                          selectedAssets.has(asset.id)
                            ? "bg-primary border-primary"
                            : "border-slate-300"
                        }`}
                      >
                        {selectedAssets.has(asset.id) && (
                          <CheckCircle2 className="h-4 w-4 text-white" />
                        )}
                      </div>
                      <div className="flex-1">
                        <h4 className="font-black text-sm uppercase mb-1">{asset.name}</h4>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-mono">{asset.id}</span>
                          <span>•</span>
                          <span>{asset.category}</span>
                          <span>•</span>
                          <span>Clase {asset.class}</span>
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedAsset(expandedAsset === asset.id ? null : asset.id);
                      }}
                      className="h-8 w-8 p-0"
                    >
                      {expandedAsset === asset.id ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  {expandedAsset === asset.id && (
                    <div className="mt-4 pt-4 border-t grid grid-cols-2 gap-4 text-xs">
                      <div>
                        <p className="font-bold text-muted-foreground uppercase">S/N</p>
                        <p className="text-slate-900">{asset.serialNumber || "N/A"}</p>
                      </div>
                      <div>
                        <p className="font-bold text-muted-foreground uppercase">Tipo Uso</p>
                        <p className="text-slate-900">{asset.usageType}</p>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Screen preview */}
      {previewOpen && assetsToPrint.length > 0 && (
        <Card className="rounded-[2.5rem] border-none shadow-xl bg-slate-50">
          <CardHeader className="p-8">
            <CardTitle className="text-xl font-black uppercase">Vista Previa</CardTitle>
            <CardDescription>Tamaño real: 22×32mm · {assetsToPrint.length * copiesPerAsset} etiquetas</CardDescription>
          </CardHeader>
          <CardContent className="p-8">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))",
                gap: "12px",
                padding: "20px",
                backgroundColor: "white",
                borderRadius: "16px",
              }}
            >
              {Array.from({ length: assetsToPrint.length * copiesPerAsset }).map((_, idx) => {
                const asset = assetsToPrint[Math.floor(idx / copiesPerAsset)];
                return (
                  <div
                    key={idx}
                    style={{
                      width: "88px",
                      height: "128px",
                      border: "1px dashed #cbd5e1",
                      borderRadius: "6px",
                      padding: "6px",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      backgroundColor: "#fff",
                    }}
                  >
                    <QRWithPagnolLogo value={asset.internalCode || asset.id} size={64} />
                    <p
                      style={{
                        fontSize: "6px",
                        fontWeight: "bold",
                        textAlign: "center",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: "100%",
                        marginTop: "4px",
                      }}
                    >
                      {asset.internalCode || asset.id}
                    </p>
                    <p
                      style={{
                        fontSize: "5px",
                        color: "#64748b",
                        textAlign: "center",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: "100%",
                        marginTop: "2px",
                      }}
                    >
                      {asset.name}
                    </p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Print area — hidden on screen, visible only when printing */}
      <div id="print-area">
        <LabelsPrintSheet assets={assetsToPrint} copiesPerAsset={copiesPerAsset} logoUrl={logoUrl} />
      </div>

      <style>{`
        /* Screen: hide print area */
        #print-area {
          display: none;
        }

        @media print {
          /* Hide everything except the print area */
          body * {
            visibility: hidden !important;
          }
          #print-area,
          #print-area * {
            visibility: visible !important;
          }
          #print-area {
            display: block !important;
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 210mm !important;
            margin: 0 !important;
            padding: 0 !important;
            background: white !important;
          }
          @page {
            size: A4 portrait;
            margin: 4mm;
          }
        }
      `}</style>
    </div>
  );
};

// ─── Print Sheet ─────────────────────────────────────────────────────────────
const LabelsPrintSheet: React.FC<{
  assets: Material[];
  copiesPerAsset: number;
  logoUrl: string;
}> = ({ assets, copiesPerAsset, logoUrl }) => {
  const labels = assets.flatMap((asset) =>
    Array.from({ length: copiesPerAsset }, () => asset)
  );

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fill, ${LABEL_W_MM}mm)`,
        gap: "0mm",
        width: "210mm",
        padding: "4mm",
        boxSizing: "border-box",
        background: "white",
      }}
    >
      {labels.map((asset, idx) => (
        <PrintLabel key={`${asset.id}-${idx}`} asset={asset} logoUrl={logoUrl} />
      ))}
    </div>
  );
};

// ─── Single Print Label ───────────────────────────────────────────────────────
const PrintLabel: React.FC<{ asset: Material; logoUrl: string }> = ({ asset, logoUrl }) => {
  const displayId = asset.internalCode || asset.id;
  return (
    <div
      style={{
        width: `${LABEL_W_MM}mm`,
        height: `${LABEL_H_MM}mm`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-start",
        padding: "1mm 1.5mm",
        boxSizing: "border-box",
        pageBreakInside: "avoid",
        border: "0.3pt dashed #d1d5db",
        overflow: "hidden",
      }}
    >
      {/* QR con logo */}
      <div style={{ marginTop: "0.5mm" }}>
        <QRCodeCanvas
          value={displayId}
          size={56}
          level="H"
          imageSettings={{
            src: logoUrl,
            height: 16,
            width: 16,
            excavate: true,
            crossOrigin: "anonymous",
          }}
        />
      </div>
      {/* ID */}
      <p
        style={{
          fontSize: "5.5pt",
          fontWeight: "900",
          fontFamily: "monospace",
          textAlign: "center",
          margin: "1mm 0 0.5mm",
          letterSpacing: "-0.02em",
          lineHeight: 1,
          overflow: "hidden",
          maxWidth: "100%",
          whiteSpace: "nowrap",
        }}
      >
        {displayId}
      </p>
      {/* Name */}
      <p
        style={{
          fontSize: "4pt",
          fontFamily: "sans-serif",
          textAlign: "center",
          color: "#374151",
          margin: 0,
          lineHeight: 1.1,
          overflow: "hidden",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          maxWidth: "100%",
          wordBreak: "break-word",
        }}
      >
        {asset.name}
      </p>
      {/* Category */}
      <p
        style={{
          fontSize: "3pt",
          fontFamily: "sans-serif",
          textAlign: "center",
          color: "#9ca3af",
          margin: "0.5mm 0 0",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          maxWidth: "100%",
          overflow: "hidden",
          whiteSpace: "nowrap",
        }}
      >
        {asset.category}
      </p>
    </div>
  );
};

export default LabelPrintingPage;
