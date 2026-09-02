import type { CDPTarget } from './discovery.js';

/**
 * Identity of "this app on this device" — the unit Hermes' single debugger
 * applies to. RN derives logicalDeviceId from package + ANDROID_ID, so it is
 * stable across relaunches and distinct for two emulators of the same model;
 * both runtimes of an app (main and Reanimated) share it.
 */
export function targetKey(target: CDPTarget): string {
  return target.reactNative?.logicalDeviceId ?? `${target.appId ?? target.title}@${target.deviceName ?? ''}`;
}

export function describeTargetApp(target: CDPTarget): string {
  return `${target.appId ?? target.title} @ ${target.deviceName ?? 'unknown device'}`;
}
