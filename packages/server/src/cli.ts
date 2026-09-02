#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer, type ConnectMode } from './server.js';
import { exitWhenOrphaned } from './utils/process-lifecycle.js';
import { SERVER_VERSION } from './utils/version.js';
import { logger } from './utils/logger.js';

if (process.argv.includes('--version') || process.argv.includes('-v')) {
  console.log(SERVER_VERSION);
  process.exit(0);
}

const metroPort = parseInt(process.env.METRO_PORT ?? '8081', 10);
const sdkPort = parseInt(process.env.SDK_PORT ?? '8098', 10);
const connectMode: ConnectMode = process.env.MCP_RN_CONNECT === 'eager' ? 'eager' : 'lazy';

const { mcpServer, start, shutdown } = createServer({ metroPort, sdkPort, connectMode });

const transport = new StdioServerTransport();

process.on('SIGINT', () => {
  logger.info('Shutting down...');
  shutdown();
  process.exit(0);
});

process.on('SIGTERM', () => {
  shutdown();
  process.exit(0);
});

exitWhenOrphaned(shutdown);

async function main() {
  logger.info(`Starting mcp-rn-devtools (metro port: ${metroPort}, SDK port: ${sdkPort}, connect: ${connectMode})`);
  await start();
  await mcpServer.connect(transport);
  logger.info('MCP server connected via stdio');
}

main().catch((e) => {
  logger.error('Fatal error:', e);
  process.exit(1);
});
