"use client";

import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  HelpCircle,
  BookOpen,
  Mail,
  Phone,
  ExternalLink,
  CheckCircle2,
} from "lucide-react";

const pasos = [
  {
    numero: 1,
    titulo: "Configura la Localización",
    descripcion: "Ingresa el RUT, razón social y datos tributarios de tu empresa en la sección de Localización Chilena.",
  },
  {
    numero: 2,
    titulo: "Sube tu Certificado Digital",
    descripcion: "Carga el archivo .p12 o .pfx emitido por una entidad certificadora acreditada ante el SII (e.g., E-Certchile, Acepta).",
  },
  {
    numero: 3,
    titulo: "Solicita Folios en el SII",
    descripcion: "Ingresa al portal del SII con tu RUT y solicita los folios autorizados para cada tipo de DTE que necesites emitir.",
  },
];

const faq = [
  {
    pregunta: "¿Qué es un DTE?",
    respuesta:
      "Un Documento Tributario Electrónico (DTE) es la versión digital de los documentos de respaldo de operaciones comerciales en Chile, como facturas, boletas y notas de crédito. Tienen validez legal equivalente a los documentos en papel y deben ser enviados al SII para su validación.",
  },
  {
    pregunta: "¿Cómo obtengo un certificado digital SII?",
    respuesta:
      "Debes solicitarlo a una entidad certificadora acreditada por el SII, como E-Certchile, Acepta o GlobalSign Chile. El proceso implica acreditar la identidad del representante legal de la empresa y tiene un costo anual. El archivo resultante tiene extensión .p12 o .pfx.",
  },
  {
    pregunta: "¿Qué es un folio tributario?",
    respuesta:
      "Un folio es un número de autorización otorgado por el SII que identifica de forma única cada documento tributario emitido. Debes solicitar rangos de folios en el portal del SII antes de poder emitir documentos. Cada tipo de DTE tiene su propio rango de folios.",
  },
  {
    pregunta: "¿Cuál es la diferencia entre ambiente de certificación y producción?",
    respuesta:
      "El ambiente de certificación (o pruebas) del SII permite emitir documentos de prueba sin validez tributaria real. Se usa para verificar que la integración funciona correctamente antes de pasar a producción. El ambiente de producción emite documentos con validez legal plena.",
  },
  {
    pregunta: "¿Qué hago si el SII rechaza un documento?",
    respuesta:
      "Primero revisa el código y descripción del rechazo en el log de integración. Los rechazos más comunes se deben a errores en el RUT del receptor, montos incorrectos o folio ya utilizado. Corrige el error, anula el documento si corresponde y emite uno nuevo. Si el error persiste, contacta al soporte técnico.",
  },
];

export default function SoporteDTEPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Soporte Técnico DTE"
        description="Documentación, guías paso a paso y contacto para resolver dudas sobre facturación electrónica."
      />
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="text-xs">Beta</Badge>
        <span className="text-xs text-muted-foreground">Módulo en versión preliminar</span>
      </div>

      <Card className="border-l-4 border-l-emerald-500 shadow-sm">
        <CardHeader className="flex flex-row items-center gap-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
          <div>
            <CardTitle className="text-base">Inicio Rápido</CardTitle>
            <CardDescription className="text-xs mt-0.5">Tres pasos para comenzar a emitir DTEs</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            {pasos.map((paso) => (
              <div key={paso.numero} className="flex items-start gap-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-sm font-bold">
                  {paso.numero}
                </div>
                <div className="flex flex-col gap-0.5 pt-1">
                  <p className="text-sm font-medium">{paso.titulo}</p>
                  <p className="text-xs text-muted-foreground">{paso.descripcion}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center gap-3">
          <HelpCircle className="h-5 w-5 text-slate-500 shrink-0" />
          <div>
            <CardTitle className="text-base">Preguntas Frecuentes</CardTitle>
            <CardDescription className="text-xs mt-0.5">Respuestas a las dudas más comunes sobre DTE</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible className="w-full">
            {faq.map((item, index) => (
              <AccordionItem key={index} value={`item-${index}`}>
                <AccordionTrigger className="text-sm text-left">{item.pregunta}</AccordionTrigger>
                <AccordionContent className="text-sm text-muted-foreground">
                  {item.respuesta}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>

      <Card className="border-l-4 border-l-blue-500 shadow-sm">
        <CardHeader className="flex flex-row items-center gap-3">
          <BookOpen className="h-5 w-5 text-blue-600 shrink-0" />
          <div>
            <CardTitle className="text-base">Contacto y Recursos</CardTitle>
            <CardDescription className="text-xs mt-0.5">Canales de soporte y documentación oficial</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Soporte Técnico</p>
              <div className="flex items-center gap-3">
                <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex flex-col gap-1">
                  <p className="text-sm">soporte-dte@pagnol.cl</p>
                  <Button variant="outline" size="sm" className="gap-2 w-fit" disabled>
                    <Mail className="h-3.5 w-3.5" />
                    Enviar correo
                  </Button>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex flex-col gap-1">
                  <p className="text-sm">+56 2 2345 6789</p>
                  <p className="text-xs text-muted-foreground">Lunes a viernes, 09:00 – 18:00</p>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Documentación Oficial</p>
              <div className="flex items-center gap-3">
                <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex flex-col gap-1">
                  <p className="text-sm">Portal del SII — Factura Electrónica</p>
                  <Button variant="outline" size="sm" className="gap-2 w-fit" asChild>
                    <a href="https://www.sii.cl/factura_electronica/" target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3.5 w-3.5" />
                      Ir al SII
                    </a>
                  </Button>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex flex-col gap-1">
                  <p className="text-sm">Resolución Exenta SII N° 45</p>
                  <Button variant="outline" size="sm" className="gap-2 w-fit" asChild>
                    <a href="https://www.sii.cl/normativa_legislacion/resoluciones/2003/reso45.htm" target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3.5 w-3.5" />
                      Ver resolución
                    </a>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
