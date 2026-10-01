import { describe, expect, it } from "vitest";
import { headKey, headPrefix, parseHeadKey, parseStartedKey, startedKey, startedPrefix } from "../src/notes.js";

describe("head notes", () => {
  it("round-trips time and hash, and sorts by time as text", () => {
    const key = headKey("ss", "backend", 1790700000000, "abc123");
    expect(key.startsWith(headPrefix("ss", "backend"))).toBe(true);
    expect(parseHeadKey(key, "ss", "backend")).toEqual({ epochMs: 1790700000000, hash: "abc123" });
    expect(headKey("ss", "backend", 999, "a") < headKey("ss", "backend", 1000, "a")).toBe(true);
  });

  it("ignores keys for another lane", () => {
    expect(parseHeadKey(headKey("ss", "frontend", 1, "a"), "ss", "backend")).toBeUndefined();
  });
});

describe("started notes", () => {
  it("round-trips run id and a runner name with odd characters", () => {
    const key = startedKey("ss", "backend", "h1", "36652701814", "blacksmith 4vcpu/xyz", 5);
    expect(key.startsWith(startedPrefix("ss", "backend", "h1"))).toBe(true);
    expect(parseStartedKey(key, "ss", "backend", "h1")).toEqual({ runId: "36652701814", runner: "blacksmith_4vcpu_xyz" });
  });

  it("ignores a note for another hash", () => {
    expect(parseStartedKey(startedKey("ss", "backend", "h1", "1", "r", 5), "ss", "backend", "h2")).toBeUndefined();
  });
});
