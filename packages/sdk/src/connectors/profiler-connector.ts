import React from 'react';
import type { ProfilerOnRenderCallback } from 'react';
import type { SDKMessage } from '@mcp-rn-devtools/shared';
import type { WSClient } from '../bridge/ws-client.js';
import { uuid } from '../utils/uuid.js';

let renderCounter = 0;

export function createProfilerCallback(client: WSClient): ProfilerOnRenderCallback {
  return (
    id: string,
    phase: 'mount' | 'update' | 'nested-update',
    actualDuration: number,
    baseDuration: number,
    startTime: number,
    commitTime: number,
  ) => {
    const msg: SDKMessage = {
      type: 'render:profile',
      payload: {
        entry: {
          id: `render-${++renderCounter}`,
          component: id,
          phase,
          actualDuration,
          baseDuration,
          startTime,
          commitTime,
          timestamp: Date.now(),
        },
      },
      timestamp: Date.now(),
      id: uuid(),
    };
    client.send(msg);
  };
}

export interface RNDevtoolsProfilerProps {
  id: string;
  children: React.ReactNode;
  client: WSClient;
}

export function RNDevtoolsProfiler({ id, children, client }: RNDevtoolsProfilerProps) {
  const callback = React.useMemo(() => createProfilerCallback(client), [client]);

  return React.createElement(
    React.Profiler,
    { id, onRender: callback },
    children,
  );
}
