'use client';

import { useEffect } from "react";
import { useAuth } from "@/modules/core/contexts/app-provider";

interface PageHeaderProps {
  title: string;
  description?: string;
  className?: string; // Keep className prop to avoid breaking existing calls
}

// Espejo del `metadata` del layout raíz (src/app/layout.tsx): las rutas de
// /dashboard son "use client" y no pueden exportar `metadata`, así que el título
// de la pestaña se escribe acá imperativamente con el mismo template `%s | …`.
const DOCUMENT_TITLE_SUFFIX = 'PAGNOL ERP';
const DEFAULT_DOCUMENT_TITLE = 'PAGNOL — ERP de Gestión de Activos para Minería y Construcción';

export function PageHeader({ title, description }: PageHeaderProps) {
  const { setPageHeader } = useAuth();

  useEffect(() => {
    // Set the header details in the parent layout
    if (title || description) {
      setPageHeader(prev => {
        if (prev.title === title && prev.description === description) return prev;
        return { title, description: description || '' };
      });
    }

    // Cleanup function to reset header when component unmounts
    return () => {
      setPageHeader({ title: '', description: '' });
    };
  }, [title, description, setPageHeader]);

  // La pestaña del navegador sigue al título de la página.
  //
  // Escribirlo una sola vez NO basta: en cada navegación cliente Next vuelve a
  // aplicar el `metadata` de la ruta (el del layout raíz, porque ninguna página
  // de /dashboard puede declarar el suyo) *después* de este efecto, y pisa el
  // título — verificado en navegador: en carga directa quedaba bien y al
  // navegar por el sidebar volvía al genérico. El observer lo vuelve a poner
  // cuando eso pasa. No hace bucle: sólo escribe si el título difiere.
  useEffect(() => {
    if (!title) return;
    const desired = `${title} | ${DOCUMENT_TITLE_SUFFIX}`;
    const apply = () => {
      if (document.title !== desired) document.title = desired;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      document.title = DEFAULT_DOCUMENT_TITLE;
    };
  }, [title]);

  // This component renders nothing itself
  return null;
}
