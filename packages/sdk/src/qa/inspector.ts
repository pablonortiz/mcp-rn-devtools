import { findNodeHandle } from 'react-native';

/**
 * Element inspection via the React DevTools hook. Mirrors what RN's private
 * getInspectorDataForViewAtPoint module does (read the renderers off
 * __REACT_DEVTOOLS_GLOBAL_HOOK__) without importing private paths, which move
 * between RN versions.
 */

export interface InspectorSource {
  fileName?: string;
  lineNumber?: number;
  columnNumber?: number;
}

export interface HierarchyLevelData {
  props: Record<string, unknown>;
  source?: InspectorSource | null;
  measure: (
    callback: (
      x: number,
      y: number,
      width: number,
      height: number,
      left: number,
      top: number,
    ) => void,
  ) => void;
}

export interface HierarchyItem {
  name: string | null;
  getInspectorData: (findNodeHandleFn: typeof findNodeHandle) => HierarchyLevelData;
}

export interface ElementFrame {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface TouchedViewData {
  frame: ElementFrame;
  hierarchy: HierarchyItem[];
  selectedIndex: number | null;
  props: Record<string, unknown>;
  componentStack: string;
  pointerY: number;
  touchedViewTag?: number;
}

interface RendererLike {
  rendererConfig?: {
    getInspectorDataForViewAtPoint?: (
      inspectedView: null,
      locationX: number,
      locationY: number,
      callback: (viewData: TouchedViewData) => boolean,
    ) => void;
  };
}

interface DevToolsHook {
  renderers?: Map<number, RendererLike>;
}

function getRenderers(): RendererLike[] {
  const hook = (globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: DevToolsHook })
    .__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!hook?.renderers) return [];
  return Array.from(hook.renderers.values());
}

const INSPECT_TIMEOUT_MS = 500;

/**
 * Hit-tests the app's view tree at a screen point. Resolves null when no
 * renderer answers (hook missing, or the point hits nothing).
 */
export function inspectViewAtPoint(
  locationX: number,
  locationY: number,
): Promise<TouchedViewData | null> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (data: TouchedViewData | null) => {
      if (settled) return;
      settled = true;
      resolve(data);
    };

    const timer = setTimeout(() => settle(null), INSPECT_TIMEOUT_MS);

    for (const renderer of getRenderers()) {
      const inspect = renderer.rendererConfig?.getInspectorDataForViewAtPoint;
      if (!inspect) continue;

      try {
        inspect(null, locationX, locationY, (viewData) => {
          if (viewData && viewData.hierarchy.length > 0) {
            clearTimeout(timer);
            settle(viewData);
            return true;
          }
          return false;
        });
      } catch {
        // a renderer without this view — keep trying the rest
      }

      if (settled) break;
    }
  });
}

export interface MeasuredLevel {
  frame: ElementFrame;
  props: Record<string, unknown>;
  source: InspectorSource | null;
}

/** Resolves the screen-absolute frame and props of one hierarchy level. */
export function measureHierarchyLevel(item: HierarchyItem): Promise<MeasuredLevel | null> {
  return new Promise((resolve) => {
    let data: HierarchyLevelData;
    try {
      data = item.getInspectorData(findNodeHandle);
    } catch {
      resolve(null);
      return;
    }

    const timer = setTimeout(() => resolve(null), INSPECT_TIMEOUT_MS);
    try {
      data.measure((_x, _y, width, height, left, top) => {
        clearTimeout(timer);
        resolve({
          frame: { top, left, width, height },
          props: data.props ?? {},
          source: data.source ?? null,
        });
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}
