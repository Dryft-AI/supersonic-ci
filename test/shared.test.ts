import { describe, expect, it } from "vitest";
import { hasLivePass } from "../src/shared.js";

describe("shared pass lookup", () => {
  const key = "supersonic-ci-backend-abc";

  it("accepts an unexpired artifact with exactly the pass key", () => {
    expect(hasLivePass({ artifacts: [{ name: key, expired: false }] }, key)).toBe(true);
  });

  it("ignores an expired pass", () => {
    expect(hasLivePass({ artifacts: [{ name: key, expired: true }] }, key)).toBe(false);
  });

  it("ignores a name that only starts with the key", () => {
    expect(hasLivePass({ artifacts: [{ name: `${key}-extra`, expired: false }] }, key)).toBe(false);
  });

  it("treats an empty listing as not passed", () => {
    expect(hasLivePass({}, key)).toBe(false);
  });
});
