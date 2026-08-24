import { readFileSync } from 'fs';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    {
      // Mirror tsup's `loader: { '.html': 'text' }` so imports like
      // cockpit.html resolve to their content in tests too.
      name: 'html-as-text',
      enforce: 'pre',
      load(id) {
        if (!id.endsWith('.html')) return null;
        return `export default ${JSON.stringify(readFileSync(id, 'utf-8'))};`;
      },
    },
  ],
  test: {
    globals: true,
    include: ['packages/*/test/**/*.test.ts'],
  },
});
