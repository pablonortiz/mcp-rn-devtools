import { describe, it, expect, afterEach } from 'vitest';
import { createServer } from '../src/server.js';

describe('Server smoke test', () => {
  let server: ReturnType<typeof createServer>;

  afterEach(() => {
    server?.shutdown();
  });

  it('should create server without errors', () => {
    server = createServer({ metroPort: 19999, sdkPort: 19998 });
    expect(server.mcpServer).toBeDefined();
    expect(server.connectionManager).toBeDefined();
    expect(server.sdkBridge).toBeDefined();
  });

  it('should report disconnected state initially', () => {
    server = createServer({ metroPort: 19999, sdkPort: 19998 });
    expect(server.connectionManager.connected).toBe(false);
    expect(server.connectionManager.sdkConnected).toBe(false);
  });

  it('should track uptime', () => {
    server = createServer({ metroPort: 19999, sdkPort: 19998 });
    expect(server.connectionManager.uptime).toBeGreaterThanOrEqual(0);
  });

  it('should have empty managers initially', () => {
    server = createServer({ metroPort: 19999, sdkPort: 19998 });
    const cm = server.connectionManager;
    expect(cm.logManager.count).toBe(0);
    expect(cm.errorManager.errorsCount).toBe(0);
    expect(cm.errorManager.warningsCount).toBe(0);
    expect(cm.networkManager.totalCount).toBe(0);
  });
});
