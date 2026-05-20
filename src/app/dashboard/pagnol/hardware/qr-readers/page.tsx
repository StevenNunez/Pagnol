"use client";

import React, { useState, useRef, useEffect } from "react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  QrCode,
  Play,
  Square,
  Copy,
  Check,
  AlertCircle,
  Zap,
  Shield,
  Smartphone,
  Gamepad2,
} from "lucide-react";
import { useToast } from "@/modules/core/hooks/use-toast";

const QRReadersPage: React.FC = () => {
  const { toast } = useToast();
  const [isListening, setIsListening] = useState(false);
  const [scannedCode, setScannedCode] = useState("");
  const [scanHistory, setScanHistory] = useState<Array<{ code: string; time: Date }>>([]);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Simulate USB/Bluetooth QR reader input
  useEffect(() => {
    if (!isListening) return;

    const handleKeyPress = (e: KeyboardEvent) => {
      // Typical QR scanner sends Enter at the end
      if (e.code === "Enter" && scannedCode.trim()) {
        const newEntry = {
          code: scannedCode,
          time: new Date(),
        };
        setScanHistory((prev) => [newEntry, ...prev.slice(0, 49)]);
        toast({
          title: "Código Escaneado",
          description: `${scannedCode}`,
        });
        setScannedCode("");
      } else if (e.code !== "Enter") {
        setScannedCode((prev) => prev + e.key);
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [isListening, scannedCode, toast]);

  const copyToClipboard = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Lectores de Códigos QR/Barras"
        description="Integración con lectores USB/Bluetooth para identificación en tiempo real."
      />

      {/* Device Status */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <Card className="rounded-[2.5rem] border-none shadow-xl bg-gradient-to-br from-green-50 to-emerald-50">
          <CardContent className="p-8">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-black uppercase text-muted-foreground tracking-widest mb-2">
                  Estado
                </p>
                <p className="text-2xl font-black text-green-600">
                  {isListening ? "Escuchando" : "Detenido"}
                </p>
              </div>
              <Zap className="h-12 w-12 text-green-600 opacity-20" />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[2.5rem] border-none shadow-xl bg-gradient-to-br from-blue-50 to-indigo-50">
          <CardContent className="p-8">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-black uppercase text-muted-foreground tracking-widest mb-2">
                  Códigos Escaneados Hoy
                </p>
                <p className="text-2xl font-black text-blue-600">{scanHistory.length}</p>
              </div>
              <QrCode className="h-12 w-12 text-blue-600 opacity-20" />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[2.5rem] border-none shadow-xl bg-gradient-to-br from-orange-50 to-amber-50">
          <CardContent className="p-8">
            <div>
              <p className="text-xs font-black uppercase text-muted-foreground tracking-widest mb-2">
                Conexión
              </p>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse"></div>
                <p className="text-sm font-black text-orange-600">Conectado</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Scanner Controls */}
      <Card className="rounded-[2.5rem] border-none shadow-xl bg-slate-100">
        <CardHeader className="p-8">
          <CardTitle className="text-xl font-black uppercase flex items-center gap-3">
            <Gamepad2 className="h-5 w-5 text-primary" />
            Panel de Escaneo
          </CardTitle>
          <CardDescription>
            Posiciona el lector de códigos QR/Barras para captura automática
          </CardDescription>
        </CardHeader>
        <CardContent className="p-8 space-y-6">
          {/* Control Buttons */}
          <div className="flex flex-col sm:flex-row gap-4">
            <Button
              onClick={() => {
                setIsListening(!isListening);
                if (!isListening) {
                  inputRef.current?.focus();
                }
              }}
              className={`flex-1 h-12 rounded-xl font-black uppercase tracking-widest text-sm transition-all ${
                isListening
                  ? "bg-red-600 hover:bg-red-700 text-white"
                  : "bg-green-600 hover:bg-green-700 text-white"
              }`}
            >
              {isListening ? (
                <>
                  <Square className="h-4 w-4 mr-2" /> Detener Escaneo
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" /> Iniciar Escaneo
                </>
              )}
            </Button>

            <Button
              onClick={() => setScanHistory([])}
              variant="outline"
              className="h-12 rounded-xl"
              disabled={scanHistory.length === 0}
            >
              Limpiar Historial
            </Button>
          </div>

          {/* Live Input Field */}
          <div className="p-6 bg-slate-50 rounded-xl border-2 border-dashed border-slate-300">
            <p className="text-xs font-black uppercase text-muted-foreground tracking-widest mb-3">
              Entrada en Vivo
            </p>
            <Input
              ref={inputRef}
              type="text"
              value={scannedCode}
              onChange={(e) => setScannedCode(e.target.value)}
              placeholder={isListening ? "Escaneando... (Presiona Enter para confirmar)" : "Inicia escaneo para recibir códigos"}
              className="h-12 text-lg font-mono bg-slate-100"
              disabled={!isListening}
              onKeyDown={(e) => {
                if (e.key === "Enter" && scannedCode.trim()) {
                  const newEntry = {
                    code: scannedCode,
                    time: new Date(),
                  };
                  setScanHistory((prev) => [newEntry, ...prev.slice(0, 49)]);
                  setScannedCode("");
                }
              }}
            />
          </div>

          {/* Device Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t">
            <div className="space-y-2">
              <p className="text-xs font-black uppercase text-muted-foreground tracking-widest">
                Protocolos Soportados
              </p>
              <ul className="text-sm space-y-1 text-slate-700">
                <li>✓ HID USB (Emulador de Teclado)</li>
                <li>✓ Bluetooth Classic</li>
                <li>✓ Bluetooth Low Energy</li>
              </ul>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-black uppercase text-muted-foreground tracking-widest">
                Códigos Soportados
              </p>
              <ul className="text-sm space-y-1 text-slate-700">
                <li>✓ QR Code</li>
                <li>✓ Code128, Code39</li>
                <li>✓ EAN13, UPC</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Scan History */}
      <Card className="rounded-[2.5rem] border-none shadow-xl bg-slate-100">
        <CardHeader className="p-8">
          <CardTitle className="text-xl font-black uppercase">
            Historial de Escaneos ({scanHistory.length})
          </CardTitle>
          <CardDescription>Últimos 50 códigos escaneados en esta sesión</CardDescription>
        </CardHeader>
        <CardContent className="p-8">
          {scanHistory.length === 0 ? (
            <div className="text-center py-12">
              <AlertCircle className="h-12 w-12 text-slate-300 mx-auto mb-4" />
              <p className="text-muted-foreground font-bold">Sin escaneos registrados</p>
              <p className="text-sm text-muted-foreground">
                Inicia el escaneo para comienza a capturar códigos
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {scanHistory.map((scan, idx) => (
                <div key={idx} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors">
                  <div>
                    <p className="font-mono font-black text-sm text-slate-900">{scan.code}</p>
                    <p className="text-xs text-muted-foreground">
                      {scan.time.toLocaleTimeString("es-CL")}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyToClipboard(scan.code)}
                    className="h-8 w-8 p-0"
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-green-600" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Connection Guide */}
      <Card className="rounded-[2.5rem] border-none shadow-xl bg-gradient-to-br from-slate-900 to-slate-800 text-white">
        <CardHeader className="p-8">
          <CardTitle className="text-xl font-black uppercase flex items-center gap-3">
            <Shield className="h-5 w-5 text-pagnol-orange" />
            Guía de Conexión
          </CardTitle>
        </CardHeader>
        <CardContent className="p-8 space-y-4">
          <div className="space-y-3">
            <div>
              <p className="font-bold mb-2 flex items-center gap-2">
                <Smartphone className="h-4 w-4 text-pagnol-orange" />
                Pistola USB (HID)
              </p>
              <ul className="text-sm space-y-1 ml-6 text-slate-300">
                <li>1. Conecta la pistola al puerto USB del equipo</li>
                <li>2. El driver se instalará automáticamente</li>
                <li>3. Haz clic en "Iniciar Escaneo"</li>
                <li>4. Empieza a escanear códigos</li>
              </ul>
            </div>

            <div>
              <p className="font-bold mb-2 flex items-center gap-2">
                <Bluetooth /> Pistola Bluetooth
              </p>
              <ul className="text-sm space-y-1 ml-6 text-slate-300">
                <li>1. Empareja la pistola en Configuración de Bluetooth</li>
                <li>2. Asegúrate que esté visible y en modo de escaneo</li>
                <li>3. Esta interfaz recibirá datos automáticamente</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default QRReadersPage;

// Bluetooth icon component
const Bluetooth = () => (
  <svg className="h-4 w-4 text-pagnol-orange" fill="currentColor" viewBox="0 0 24 24">
    <path d="M17.71 7.71L12 2h-1v7.59L6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 11 14.41V22h1l5.71-5.71-4.3-4.29 4.3-4.29zM13 5.83l1.88 1.88L13 9.59V5.83zm1.88 10.46L13 18.17v-3.76l1.88 1.88z"/>
  </svg>
);
