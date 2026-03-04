#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { logger } from './utils/logger.js';

const metroPort = parseInt(process.env.METRO_PORT ?? '8081', 10);
const sdkPort = parseInt(process.env.SDK_PORT ?? '8098', 10);

const { mcpServer, start, shutdown } = createServer({ metroPort, sdkPort });

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

async function main() {
  logger.info(`Starting mcp-rn-devtools (metro port: ${metroPort}, SDK port: ${sdkPort})`);
  await start();
  await mcpServer.connect(transport);
  logger.info('MCP server connected via stdio');
}

main().catch((e) => {
  logger.error('Fatal error:', e);
  process.exit(1);
});
