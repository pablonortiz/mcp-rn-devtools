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
      `android {\n    namespace "com.example.shop"\n    defaultConfig {\n        applicationId "com.example.shop"\n    }\n    productFlavors { beta { applicationIdSuffix ".beta" } }\n}\n`,
    );
    expect(detectSessionApp(cwd, {})).toEqual({ ids: ['com.example.shop'], source: 'android/app/build.gradle' });
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
      `PRODUCT_BUNDLE_IDENTIFIER = "org.reactjs.native.example.$(PRODUCT_NAME:rfc1034identifier)";\nPRODUCT_BUNDLE_IDENTIFIER = com.example.shop.testing;\n`,
    );
    expect(detectSessionApp(cwd, {})).toEqual({ ids: ['com.example.shop.testing'], source: 'ios/Shop.xcodeproj/project.pbxproj' });
  });

  it('uses app.json only as the last resort', () => {
    writeFileSync(path.join(cwd, 'app.json'), JSON.stringify({ expo: { android: { package: 'com.expo.app' }, ios: { bundleIdentifier: 'com.expo.app' } } }));
    expect(detectSessionApp(cwd, {})).toEqual({ ids: ['com.expo.app'], source: 'app.json' });
  });

  it('MCP_RN_APP overrides everything', () => {
    mkdirSync(path.join(cwd, 'android/app'), { recursive: true });
    writeFileSync(path.join(cwd, 'android/app/build.gradle'), `applicationId "com.example.shop"`);
    expect(detectSessionApp(cwd, { MCP_RN_APP: 'com.example.stock, com.other' })).toEqual({ ids: ['com.example.stock', 'com.other'], source: 'MCP_RN_APP' });
  });

  it('returns nothing outside an app repo', () => {
    expect(detectSessionApp(cwd, {})).toEqual({ ids: [], source: null });
  });

  it('matches flavors by prefix, not by substring', () => {
    expect(matchesSessionApp('com.example.shop.beta', ['com.example.shop'])).toBe(true);
    expect(matchesSessionApp('com.example.shop', ['com.example.shop'])).toBe(true);
    expect(matchesSessionApp('com.example.shoppro', ['com.example.shop'])).toBe(false);
    expect(matchesSessionApp('com.example.stock.beta', ['com.example.shop'])).toBe(false);
    expect(matchesSessionApp(undefined, ['com.example.shop'])).toBe(false);
  });
});
