import { describe, expect, it } from "vite-plus/test";

import manifest from "../src/manifest.json";

/**
 * Ticket 0002 — Configure cross-browser manifests.
 *
 * The single source manifest uses Extension.js prefixed keys (`chromium:`,
 * `firefox:`) that are filtered per build target. These tests guard the
 * source-of-truth contracts so a regression (dropping the offscreen
 * permission, losing the Android minimum version, etc.) fails fast.
 */

// The manifest is a JSON document whose keys vary by build target; treat it
// as an opaque record and narrow each field at the point of use.
const m = manifest as Record<string, unknown>;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === "string");

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

describe("cross-browser manifest (ticket 0002)", () => {
  it("targets Manifest V3 on both Chromium and Gecko (Firefox)", () => {
    expect(m["chromium:manifest_version"]).toBe(3);
    expect(m["firefox:manifest_version"]).toBe(3);
  });

  it("declares the offscreen permission for Chromium targets", () => {
    const permissions = m["chromium:permissions"];
    expect(isStringArray(permissions)).toBe(true);
    expect(permissions).toContain("offscreen");
  });

  it("declares host permissions for content-script injection on both targets", () => {
    const chromiumHosts = m["chromium:host_permissions"];
    expect(isStringArray(chromiumHosts)).toBe(true);
    expect(chromiumHosts).toContain("<all_urls>");

    const firefoxPerms = m["firefox:permissions"];
    expect(isStringArray(firefoxPerms)).toBe(true);
    expect(firefoxPerms).toContain("<all_urls>");
  });

  it("registers a content script matched against all URLs", () => {
    expect(Array.isArray(m["content_scripts"])).toBe(true);
    const first = (m["content_scripts"] as unknown[])[0];
    expect(isObject(first)).toBe(true);
    expect(isStringArray(first.matches)).toBe(true);
    expect(first.matches).toContain("<all_urls>");
    expect(isStringArray(first.js)).toBe(true);
    expect(first.js.length).toBeGreaterThan(0);
  });

  it("sets a Firefox for Android minimum version for mobile support", () => {
    const settings = m["firefox:browser_specific_settings"];
    expect(isObject(settings)).toBe(true);
    const geckoAndroid = settings.gecko_android;
    expect(isObject(geckoAndroid)).toBe(true);
    expect(geckoAndroid.strict_min_version).toMatch(/^\d+\.\d+$/);
  });
});
