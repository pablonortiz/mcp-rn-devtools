import React, { useContext, useState } from 'react';
import { Dimensions, Keyboard, PixelRatio } from 'react-native';
import type { QAReportMode, QAReportPayload } from '@mcp-rn-devtools/shared';
import { DevtoolsContext } from '../context.js';
import { uuid } from '../utils/uuid.js';
import {
  inspectViewAtPoint,
  measureHierarchyLevel,
  type ElementFrame,
  type HostInstance,
  type InspectorSource,
  type TouchedViewData,
} from './inspector.js';
import { flattenStyle, serializeProps } from './safe-props.js';
import { getAppId } from '../utils/platform.js';
import type { WSClient } from '../bridge/ws-client.js';
import { QAFab } from './QAFab.js';
import { SelectionLayer } from './SelectionLayer.js';
import { HighlightBox } from './HighlightBox.js';
import { AnnotationPanel } from './AnnotationPanel.js';
import { FeedbackToast, type ToastData } from './FeedbackToast.js';

type Phase = 'idle' | 'selecting' | 'inspecting' | 'annotating';

interface SelectedLevel {
  index: number;
  frame: ElementFrame;
  props: Record<string, unknown>;
  source: InspectorSource | null;
}

const OWN_COMPONENTS = new Set(['QAOverlay', 'SelectionLayer', 'QAFab', 'AnnotationPanel', 'HighlightBox']);
const MAX_COMPONENT_STACK = 4000;

export interface QAOverlayProps {
  /** Ref to the host view whose subtree gets hit-tested (the app's root wrapper). */
  inspectedViewRef: React.RefObject<HostInstance>;
}

/**
 * On-device QA capture: a floating button opens selection mode, a tap
 * snaps to the touched element, and the annotated report travels to the
 * mcp-rn-devtools server over the SDK channel.
 */
export function QAOverlay({ inspectedViewRef }: QAOverlayProps) {
  const { connected, client } = useContext(DevtoolsContext);
  const [phase, setPhase] = useState<Phase>('idle');
  const [viewData, setViewData] = useState<TouchedViewData | null>(null);
  const [level, setLevel] = useState<SelectedLevel | null>(null);
  const [note, setNote] = useState('');
  const [sentCount, setSentCount] = useState(0);
  const [toast, setToast] = useState<ToastData | null>(null);

  const reset = () => {
    Keyboard.dismiss();
    setPhase('idle');
    setViewData(null);
    setLevel(null);
    setNote('');
  };

  const handleSelectPoint = (pageX: number, pageY: number) => {
    // Unmount the selection layer before hit-testing so it never inspects itself
    setPhase('inspecting');
    afterCommit(async () => {
      const data = await inspectPoint(inspectedViewRef.current, pageX, pageY);
      if (!data) {
        reset();
        return;
      }

      setViewData(data);
      const initialIndex = data.selectedIndex ?? data.hierarchy.length - 1;
      await selectLevel(data, initialIndex);
      setPhase('annotating');
    });
  };

  const selectLevel = async (data: TouchedViewData, index: number) => {
    const item = data.hierarchy[index];
    if (!item) return;

    const measured = await measureHierarchyLevel(item);
    setLevel({
      index,
      frame: measured?.frame ?? data.frame,
      props: measured?.props ?? data.props,
      source: measured?.source ?? null,
    });
  };

  const handleChangeLevel = (direction: -1 | 1) => {
    if (!viewData || !level) return;
    const next = level.index + direction;
    if (next < 0 || next >= viewData.hierarchy.length) return;
    void selectLevel(viewData, next);
  };

  const handleSubmit = (mode: QAReportMode) => {
    if (!viewData || !level || !client) return;

    const report = buildPayload(note, mode, viewData, level);
    const messageId = uuid();
    client.send({ type: 'qa:report', payload: { report }, timestamp: Date.now(), id: messageId });
    setSentCount((count) => count + 1);
    reset();

    void awaitAck(client, messageId).then((ack) => {
      if (!ack) {
        setToast({ kind: 'warn', text: '⚠ Enviado, sin confirmación del server' });
      } else if (mode === 'queue') {
        setToast({ kind: 'listening', text: `💾 Guardado (${ack.pendingCount} pendientes) — seguí probando` });
      } else if (ack.listenerActive) {
        setToast({ kind: 'listening', text: '🤖 Claude lo está tomando' });
      } else {
        setToast({
          kind: 'queued',
          text: `⏸ Encolado (${ack.pendingCount} pendientes) — no hay agente escuchando`,
        });
      }
    });
  };

  const handleFixPending = () => {
    if (!client) return;
    reset();
    const messageId = uuid();
    client.send({ type: 'qa:fix-pending', payload: {}, timestamp: Date.now(), id: messageId });
    void awaitFixPendingAck(client, messageId).then((ack) => {
      if (!ack) {
        setToast({ kind: 'warn', text: '⚠ Enviado, sin confirmación del server' });
      } else if (!ack.agentRunning) {
        setToast({ kind: 'queued', text: '⏸ El agente está apagado — inicialo en el cockpit' });
      } else if (ack.queued === 0) {
        setToast({ kind: 'listening', text: 'No hay reports pendientes' });
      } else {
        setToast({ kind: 'listening', text: `🤖 ${ack.queued} pendiente(s) enviados a Claude` });
      }
    });
  };

  if (phase === 'selecting') {
    return (
      <SelectionLayer
        onSelectPoint={handleSelectPoint}
        onFixPending={handleFixPending}
        onCancel={reset}
      />
    );
  }

  if (phase === 'inspecting') {
    return null;
  }

  if (phase === 'annotating' && viewData && level) {
    return (
      <>
        <HighlightBox frame={level.frame} />
        <AnnotationPanel
          levelName={viewData.hierarchy[level.index]?.name ?? 'Unknown'}
          levelIndex={level.index}
          levelCount={viewData.hierarchy.length}
          note={note}
          connected={connected}
          appLabel={getAppId()}
          onChangeNote={setNote}
          onChangeLevel={handleChangeLevel}
          onSave={() => handleSubmit('queue')}
          onFixNow={() => handleSubmit('fix-now')}
          onCancel={reset}
        />
      </>
    );
  }

  return (
    <>
      <QAFab onPress={() => setPhase('selecting')} badgeCount={sentCount} connected={connected} />
      {toast ? <FeedbackToast toast={toast} onHide={() => setToast(null)} /> : null}
    </>
  );
}

interface AckPayload {
  listenerActive: boolean;
  pendingCount: number;
}

const ACK_TIMEOUT_MS = 3000;

function awaitAck(client: WSClient, requestId: string): Promise<AckPayload | null> {
  return awaitAckOfType<AckPayload>(client, 'qa:report:ack', requestId);
}

interface FixPendingAckPayload {
  queued: number;
  agentRunning: boolean;
}

function awaitFixPendingAck(client: WSClient, requestId: string): Promise<FixPendingAckPayload | null> {
  return awaitAckOfType<FixPendingAckPayload>(client, 'qa:fix-pending:ack', requestId);
}

function awaitAckOfType<T>(client: WSClient, type: string, requestId: string): Promise<T | null> {
  return new Promise((resolve) => {
    const unsubscribe = client.onMessage((msg) => {
      if (msg.type !== type) return;
      const payload = msg.payload as unknown as { requestId?: string } & T;
      if (payload.requestId !== requestId) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(payload);
    });
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(null);
    }, ACK_TIMEOUT_MS);
  });
}

/** Runs work after the current state update has been committed and mounted. */
function afterCommit(work: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(work));
}

/** Hit-tests the point, retrying once if the overlay caught its own views. */
async function inspectPoint(
  inspectedView: HostInstance,
  pageX: number,
  pageY: number,
): Promise<TouchedViewData | null> {
  const data = await inspectViewAtPoint(inspectedView, pageX, pageY);
  if (!data || !hitsOwnOverlay(data)) return data;

  await new Promise((resolve) => setTimeout(resolve, 60));
  const retried = await inspectViewAtPoint(inspectedView, pageX, pageY);
  return retried && !hitsOwnOverlay(retried) ? retried : null;
}

function hitsOwnOverlay(data: TouchedViewData): boolean {
  return data.hierarchy.some((item) => item.name != null && OWN_COMPONENTS.has(item.name));
}

function buildPayload(
  note: string,
  mode: QAReportMode,
  viewData: TouchedViewData,
  level: SelectedLevel,
): QAReportPayload {
  const window = Dimensions.get('window');
  return {
    note: note.trim(),
    mode,
    element: {
      frame: level.frame,
      hierarchy: viewData.hierarchy.map((item) => item.name ?? 'Unknown'),
      selectedIndex: level.index,
      selectedName: viewData.hierarchy[level.index]?.name ?? 'Unknown',
      componentStack: (viewData.componentStack ?? '').slice(0, MAX_COMPONENT_STACK),
      props: serializeProps(level.props),
      style: flattenStyle(level.props?.style),
      source: level.source,
    },
    screen: { width: window.width, height: window.height, scale: PixelRatio.get() },
  };
}
