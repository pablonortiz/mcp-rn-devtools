import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  dts: { resolve: ['@mcp-rn-devtools/shared'] },
  clean: true,
  sourcemap: true,
  target: 'node20',
  banner: {
    js: "// mcp-rn-devtools server",
  },
  noExternal: ['@mcp-rn-devtools/shared'],
  loader: {
    '.html': 'text',
  },
});
