import { describe, it, expect, beforeEach } from 'vitest';
import { NetworkManager } from '../src/managers/network-manager.js';

describe('NetworkManager', () => {
  let manager: NetworkManager;

  beforeEach(() => {
    manager = new NetworkManager();
  });

  it('should add network requests from SDK', () => {
    manager.addFromSDK({
      id: 'req-1',
      url: 'https://api.example.com/users',
      method: 'GET',
      status: 200,
      startTime: Date.now() - 100,
      endTime: Date.now(),
      duration: 100,
    });

    const requests = manager.getRequests();
    expect(requests).toHaveLength(1);
    expect(requests[0].source).toBe('sdk');
    expect(requests[0].status).toBe(200);
  });

  it('should filter failed requests', () => {
    manager.addFromSDK({
      id: 'req-1',
      url: 'https://api.example.com/success',
      method: 'GET',
      status: 200,
      startTime: Date.now(),
    });
    manager.addFromSDK({
      id: 'req-2',
      url: 'https://api.example.com/not-found',
      method: 'GET',
      status: 404,
      startTime: Date.now(),
    });
    manager.addFromSDK({
      id: 'req-3',
      url: 'https://api.example.com/error',
      method: 'POST',
      status: null,
      error: 'Network error',
      startTime: Date.now(),
    });

    const failed = manager.getFailedRequests();
    expect(failed).toHaveLength(2);
    expect(failed[0].url).toContain('not-found');
    expect(failed[1].error).toBe('Network error');
  });

  it('should filter by URL search', () => {
    manager.addFromSDK({
      id: 'req-1',
      url: 'https://api.example.com/users',
      method: 'GET',
      status: 200,
      startTime: Date.now(),
    });
    manager.addFromSDK({
      id: 'req-2',
      url: 'https://api.example.com/posts',
      method: 'GET',
      status: 200,
      startTime: Date.now(),
    });

    const results = manager.getRequests({ search: 'users' });
    expect(results).toHaveLength(1);
  });

  it('should respect limit', () => {
    for (let i = 0; i < 10; i++) {
      manager.addFromSDK({
        id: `req-${i}`,
        url: `https://api.example.com/${i}`,
        method: 'GET',
        status: 200,
        startTime: Date.now(),
      });
    }

    const results = manager.getRequests({ limit: 3 });
    expect(results).toHaveLength(3);
  });

  it('should track total and failed counts', () => {
    manager.addFromSDK({
      id: 'req-1',
      url: 'https://api.example.com/ok',
      method: 'GET',
      status: 200,
      startTime: Date.now(),
    });
    manager.addFromSDK({
      id: 'req-2',
      url: 'https://api.example.com/fail',
      method: 'GET',
      status: 500,
      startTime: Date.now(),
    });

    expect(manager.totalCount).toBe(2);
    expect(manager.failedCount).toBe(1);
  });

  it('should respect buffer limit', () => {
    for (let i = 0; i < 600; i++) {
      manager.addFromSDK({
        id: `req-${i}`,
        url: `https://api.example.com/${i}`,
        method: 'GET',
        status: 200,
        startTime: Date.now(),
      });
    }

    expect(manager.totalCount).toBe(500);
  });
});
