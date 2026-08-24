import React, { useContext, useState } from 'react';
import { Dimensions, Keyboard, PixelRatio } from 'react-native';
import type { QAReportMode, QAReportPayload } from '@mcp-rn-devtools/shared';
import { DevtoolsContext } from '../context.js';
import { uuid } from '../utils/uuid.js';
import {
  inspectViewAtPoint,
  measureHierarchyLevel,
  type ElementFrame,
  type InspectorSource,
  type TouchedViewData,
} from './inspector.js';
import { flattenStyle, serializeProps } from './safe-props.js';
import { QAFab } from './QAFab.js';
import { SelectionLayer } from './SelectionLayer.js';
import { HighlightBox } from './HighlightBox.js';
import { AnnotationPanel } from './AnnotationPanel.js';

type Phase = 'idle' | 'selecting' | 'inspecting' | 'annotating';

interface SelectedLevel {
  index: number;
  frame: ElementFrame;
  props: Record<string, unknown>;
  source: InspectorSource | null;
}

const OWN_COMPONENTS = new Set(['QAOverlay', 'SelectionLayer', 'QAFab', 'AnnotationPanel', 'HighlightBox']);
const MAX_COMPONENT_STACK = 4000;

/**
 * On-device QA capture: a floating button opens selection mode, a tap
 * snaps to the touched element, and the annotated report travels to the
 * mcp-rn-devtools server over the SDK channel.
 */
export function QAOverlay() {
  const { connected, client } = useContext(DevtoolsContext);
  const [phase, setPhase] = useState<Phase>('idle');
  const [viewData, setViewData] = useState<TouchedViewData | null>(null);
  const [level, setLevel] = useState<SelectedLevel | null>(null);
  const [note, setNote] = useState('');
  const [sentCount, setSentCount] = useState(0);

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
      const data = await inspectPoint(pageX, pageY);
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
    client.send({ type: 'qa:report', payload: { report }, timestamp: Date.now(), id: uuid() });
    setSentCount((count) => count + 1);
    reset();
  };

  if (phase === 'selecting') {
    return <SelectionLayer onSelectPoint={handleSelectPoint} onCancel={reset} />;
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
          onChangeNote={setNote}
          onChangeLevel={handleChangeLevel}
          onSave={() => handleSubmit('queue')}
          onFixNow={() => handleSubmit('fix-now')}
          onCancel={reset}
        />
      </>
    );
  }

  return <QAFab onPress={() => setPhase('selecting')} badgeCount={sentCount} connected={connected} />;
}

/** Runs work after the current state update has been committed and mounted. */
function afterCommit(work: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(work));
}

/** Hit-tests the point, retrying once if the overlay caught its own views. */
async function inspectPoint(pageX: number, pageY: number): Promise<TouchedViewData | null> {
  const data = await inspectViewAtPoint(pageX, pageY);
  if (!data || !hitsOwnOverlay(data)) return data;

  await new Promise((resolve) => setTimeout(resolve, 60));
  const retried = await inspectViewAtPoint(pageX, pageY);
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
