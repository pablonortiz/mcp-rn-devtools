import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node18',
  banner: {
    js: "// mcp-rn-devtools server",
  },
  noExternal: ['@mcp-rn-devtools/shared'],
});
