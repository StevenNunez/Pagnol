'use client';

import React from 'react';
import { ActiveProjectProvider } from '@/components/operations/active-project';

/**
 * Todo el módulo Control de Obras trabaja sobre **una obra a la vez** (RFC-006 F1).
 * El proveedor vive en el layout y no en cada página para que la obra elegida
 * sobreviva a la navegación entre Panel, EDT, Gantt y Protocolos.
 */
export default function ConstructionControlLayout({ children }: { children: React.ReactNode }) {
  return <ActiveProjectProvider>{children}</ActiveProjectProvider>;
}
