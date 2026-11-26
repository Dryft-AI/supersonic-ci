import { describe, expect, it, vi } from "vitest";
import { laneHash, passKey } from "../src/lanes.js";
import "../src/check.js";

const saved = vi.hoisted(() => [] as string[]);

vi.mock("@actions/cache", () => ({
  isFeatureAvailable: () => true,
  restoreCache: async () => undefined,
}));

vi.mock("@actions/core", () => {
  const inputs: Record<string, string> = { lanes: "self: [src]", "key-prefix": "ss", shared: "true" };
  const summary = { addHeading: () => summary, addTable: () => summary, write: async () => summary };
  return { getInput: (name: string) => inputs[name] ?? "", setOutput: () => {}, setFailed: () => {}, info: () => {}, warning: () => {}, summary };
});

vi.mock("../src/shared.js", () => ({ sharedPassExists: async () => true }));

vi.mock("../src/notes.js", () => ({ saveNote: async (key: string) => void saved.push(key) }));

describe("check", () => {
  it("saves a pass found in the shared store to the cache", async () => {
    const key = passKey("ss", "self", laneHash({ name: "self", paths: ["src"], salt: "" }, process.cwd()));
    await vi.waitFor(() => expect(saved).toEqual([key]));
  });
});
