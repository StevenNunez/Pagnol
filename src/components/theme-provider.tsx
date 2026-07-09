"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { ThemeProvider as NextThemesProvider, type ThemeProviderProps } from "next-themes";

// Rutas públicas/comerciales: SIEMPRE en modo claro, ignorando la preferencia
// guardada en localStorage. El toggle de tema vive solo dentro del dashboard.
const FORCED_LIGHT_ROUTES = ["/", "/pricing", "/demo"];

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  const pathname = usePathname();
  const forcedTheme = FORCED_LIGHT_ROUTES.includes(pathname ?? "") ? "light" : undefined;
  return <NextThemesProvider {...props} forcedTheme={forcedTheme}>{children}</NextThemesProvider>;
}
