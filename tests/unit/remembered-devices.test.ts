import { describe, expect, it } from "vitest";
import {
  hashDeviceToken,
  isWellFormedDeviceToken,
  newDeviceToken,
} from "../../src/server/remembered-devices";

describe("hatırlanan cihaz token'ı", () => {
  it("32 bayt base64url üretir ve her seferinde farklıdır", () => {
    const a = newDeviceToken();
    const b = newDeviceToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(a, "base64url")).toHaveLength(32);
    expect(a).not.toBe(b);
  });

  it("özet SHA-256 hex'tir, deterministiktir ve token'ı içermez", () => {
    const t = newDeviceToken();
    const h = hashDeviceToken(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDeviceToken(t)).toBe(h);
    expect(h).not.toContain(t);
  });

  it("biçimi bozuk değerleri reddeder", () => {
    expect(isWellFormedDeviceToken(newDeviceToken())).toBe(true);
    for (const bad of [undefined, null, "", "kisa", "x".repeat(44), "a".repeat(42) + "=", 42]) {
      expect(isWellFormedDeviceToken(bad)).toBe(false);
    }
  });
});
