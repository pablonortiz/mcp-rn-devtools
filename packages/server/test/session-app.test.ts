import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { detectSessionApp, matchesSessionApp } from '../src/session-app.js';

describe('session app detection', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), 'rn-app-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('reads applicationId and namespace from android/app/build.gradle', () => {
    mkdirSync(path.join(cwd, 'android/app'), { recursive: true });
    writeFileSync(
      path.join(cwd, 'android/app/build.gradle'),
      `android {\n    namespace "in.janis.picking"\n    defaultConfig {\n        applicationId "in.janis.picking"\n    }\n    productFlavors { beta { applicationIdSuffix ".beta" } }\n}\n`,
    );
    expect(detectSessionApp(cwd, {})).toEqual({ ids: ['in.janis.picking'], source: 'android/app/build.gradle' });
  });

  it('reads the Kotlin DSL too', () => {
    mkdirSync(path.join(cwd, 'android/app'), { recursive: true });
    writeFileSync(path.join(cwd, 'android/app/build.gradle.kts'), `defaultConfig {\n    applicationId = "com.acme.shop"\n}\n`);
    expect(detectSessionApp(cwd, {}).ids).toEqual(['com.acme.shop']);
  });

  it('falls back to the iOS bundle id, skipping template placeholders', () => {
    mkdirSync(path.join(cwd, 'ios/Shop.xcodeproj'), { recursive: true });
    writeFileSync(
      path.join(cwd, 'ios/Shop.xcodeproj/project.pbxproj'),
      `PRODUCT_BUNDLE_IDENTIFIER = "org.reactjs.native.example.$(PRODUCT_NAME:rfc1034identifier)";\nPRODUCT_BUNDLE_IDENTIFIER = in.janis.picking.testing;\n`,
    );
    expect(detectSessionApp(cwd, {})).toEqual({ ids: ['in.janis.picking.testing'], source: 'ios/Shop.xcodeproj/project.pbxproj' });
  });

  it('uses app.json only as the last resort', () => {
    writeFileSync(path.join(cwd, 'app.json'), JSON.stringify({ expo: { android: { package: 'com.expo.app' }, ios: { bundleIdentifier: 'com.expo.app' } } }));
    expect(detectSessionApp(cwd, {})).toEqual({ ids: ['com.expo.app'], source: 'app.json' });
  });

  it('MCP_RN_APP overrides everything', () => {
    mkdirSync(path.join(cwd, 'android/app'), { recursive: true });
    writeFileSync(path.join(cwd, 'android/app/build.gradle'), `applicationId "in.janis.picking"`);
    expect(detectSessionApp(cwd, { MCP_RN_APP: 'in.janis.wms, com.other' })).toEqual({ ids: ['in.janis.wms', 'com.other'], source: 'MCP_RN_APP' });
  });

  it('returns nothing outside an app repo', () => {
    expect(detectSessionApp(cwd, {})).toEqual({ ids: [], source: null });
  });

  it('matches flavors by prefix, not by substring', () => {
    expect(matchesSessionApp('in.janis.picking.beta', ['in.janis.picking'])).toBe(true);
    expect(matchesSessionApp('in.janis.picking', ['in.janis.picking'])).toBe(true);
    expect(matchesSessionApp('in.janis.pickingpro', ['in.janis.picking'])).toBe(false);
    expect(matchesSessionApp('in.janis.wms.beta', ['in.janis.picking'])).toBe(false);
    expect(matchesSessionApp(undefined, ['in.janis.picking'])).toBe(false);
  });
});
