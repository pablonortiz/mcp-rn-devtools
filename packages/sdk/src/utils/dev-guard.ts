declare const __DEV__: boolean;

export function isDev(): boolean {
  try {
    return typeof __DEV__ !== 'undefined' && __DEV__;
  } catch {
    return false;
  }
}
