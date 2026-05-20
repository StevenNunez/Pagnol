"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle, VideoOff } from "lucide-react";
import type { Html5Qrcode } from "html5-qrcode";

interface QrScannerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScan: (qrCode: string) => void;
  title: string;
  description: string;
}

// QrDimensions is not exported anymore, so we define it locally.
interface LocalQrDimensions {
  width: number;
  height: number;
}


export function QrScannerDialog({
  open,
  onOpenChange,
  onScan,
  title,
  description,
}: QrScannerDialogProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [scanResult, setScanResult] = useState<"success" | "fail" | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoContainerId = "qr-reader";

  useEffect(() => {
    if (open) {
      // Import the library only on the client-side
      import("html5-qrcode").then(({ Html5Qrcode }) => {
        setCameraError(null);
        setScanResult(null);

        const qrScanner = new Html5Qrcode(videoContainerId);
        scannerRef.current = qrScanner;

        const startScanner = async () => {
          try {
            const cameras = await Html5Qrcode.getCameras();
            if (cameras && cameras.length) {
              const qrboxFunction = (viewfinderWidth: number, viewfinderHeight: number): LocalQrDimensions => {
                const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
                const qrboxSize = Math.floor(minEdge * 0.9);
                return { width: qrboxSize, height: qrboxSize };
              };

              await qrScanner.start(
                { facingMode: "environment" },
                {
                  fps: 10,
                  qrbox: qrboxFunction,
                  aspectRatio: 1.0,
                },
                (decodedText) => {
                  setScanResult("success");
                  if(qrScanner.isScanning) {
                    qrScanner.pause(true);
                  }
                  setTimeout(() => {
                    onScan(decodedText);
                    onOpenChange(false);
                  }, 1000);
                },
                (errorMessage) => {
                  // Ignore errors, they happen continuously.
                }
              );
            } else {
                setCameraError("No se encontraron cámaras en este dispositivo.");
            }
          } catch (err: any) {
            console.error("Error al iniciar el escaner:", err);
            let message = "Hubo un error al iniciar la cámara.";
            if(err.name === 'NotAllowedError') {
                message = "Permiso de cámara denegado. Por favor, habilita el acceso en tu navegador.";
            } else if (err.name === 'NotFoundError') {
                 message = "No se encontró una cámara compatible.";
            }
            setCameraError(message);
          }
        };

        startScanner();
      });

      return () => {
        if (scannerRef.current && scannerRef.current.isScanning) {
            scannerRef.current.stop().catch(err => console.error("Error al detener el escaner:", err));
        }
        setScanResult(null);
        setCameraError(null);
      };
    }
  }, [open, onScan, onOpenChange]);

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
       if (scannerRef.current && scannerRef.current.isScanning) {
          scannerRef.current.stop().catch(err => console.error("Error al detener escaner al cerrar", err));
       }
       setScanResult(null);
       setCameraError(null);
    }
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent onInteractOutside={(e) => { if(scannerRef.current?.isScanning) e.preventDefault(); }} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="my-4 flex aspect-square w-full items-center justify-center rounded-lg bg-slate-900 overflow-hidden">
            <div id={videoContainerId} className="w-full h-full relative">
                {cameraError && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center text-white p-4">
                        <VideoOff className="h-16 w-16 text-destructive mb-4"/>
                        <p className="font-semibold">Error de Cámara</p>
                        <p className="text-sm">{cameraError}</p>
                    </div>
                )}
                {scanResult === 'success' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-green-500/80">
                        <CheckCircle className="h-24 w-24 text-white" />
                    </div>
                )}
            </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => handleClose(false)}>
            Cancelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
