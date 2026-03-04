const PREFIX = '[mcp-rn-devtools]';

export const logger = {
  info: (...args: unknown[]) => {
    console.error(PREFIX, ...args);
  },
  warn: (...args: unknown[]) => {
    console.error(PREFIX, 'WARN', ...args);
  },
  error: (...args: unknown[]) => {
    console.error(PREFIX, 'ERROR', ...args);
  },
  debug: (...args: unknown[]) => {
    if (process.env.MCP_RN_DEBUG) {
      console.error(PREFIX, 'DEBUG', ...args);
    }
  },
};
