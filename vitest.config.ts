import { readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
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
    // Servers created without an explicit stateDir must never touch the real instance registry
    env: { MCP_RN_STATE_DIR: path.join(tmpdir(), 'mcp-rn-devtools-test-registry') },
  },
});
