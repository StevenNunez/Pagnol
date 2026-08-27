"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider, type ThemeProviderProps } from "next-themes";

/**
 * El tema por defecto es **claro en toda la aplicación**, para todo el mundo:
 * `defaultTheme="light"` + `enableSystem={false}` (en el layout raíz) hacen que
 * quien entra por primera vez vea claro, sin importar cómo tenga configurado su
 * sistema operativo.
 *
 * A partir de ahí manda la elección de la persona, y vale en todas las páginas
 * por igual — landing, Centro de Ayuda y dashboard. Antes las páginas públicas
 * forzaban el claro, y eso hacía que la app "saltara" de un modo al otro al
 * navegar entre ellas.
 */
export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
