import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // Motor offline + matemática del ledger financiero (no hay suite global en el resto).
    include: [
      'src/modules/offline/**/*.test.ts',
      'src/modules/data/mutations/financeMath.test.ts',
      'src/lib/finance-periods.test.ts',
    ],
  },
});
