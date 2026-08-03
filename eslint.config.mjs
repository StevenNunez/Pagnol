import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

// ESLint 9 exige "flat config" y Next 16 eliminó `next lint`, así que el script
// `next lint` del package.json llevaba tiempo fallando en silencio: el proyecto
// estaba SIN linter. `eslint-config-next` 16 ya exporta flat config nativa, así
// que no hace falta FlatCompat (que además revienta con esta versión por una
// referencia circular en sus plugins).
//
// Se conserva `next/core-web-vitals`, la config que el proyecto ya tenía en
// `.eslintrc.json`: el objetivo era recuperar la herramienta, no cambiar reglas.
export default [
    {
        ignores: [
            '.next/**',
            'node_modules/**',
            'out/**',
            'build/**',
            'next-env.d.ts',
            'public/**',
            'supabase/**',  // SQL
            'scripts/**',   // utilidades sueltas y SQL legacy
            '.claude/**',   // worktrees y config local: copias, no código del proyecto
        ],
    },
    ...nextCoreWebVitals,
    {
        rules: {
            // La app está en español: apóstrofes y comillas en texto JSX son
            // constantes y no son un defecto. Esta regla sola aportaba 108 de los
            // 138 errores y hacía inútil el resultado del linter.
            'react/no-unescaped-entities': 'off',
        },
    },
];
