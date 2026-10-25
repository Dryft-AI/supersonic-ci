import { afterEach, describe, expect, it, vi } from "vitest";
import { hasLivePass, sharedPassExists } from "../src/shared.js";

describe("shared pass lookup", () => {
  const key = "supersonic-ci-backend-abc";
  const repoId = 42;
  const sameRepo = { repository_id: repoId, head_repository_id: repoId };

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("accepts an unexpired artifact with exactly the pass key", () => {
    expect(hasLivePass({ artifacts: [{ name: key, expired: false, workflow_run: sameRepo }] }, key, repoId)).toBe(true);
  });

  it("ignores an expired pass", () => {
    expect(hasLivePass({ artifacts: [{ name: key, expired: true, workflow_run: sameRepo }] }, key, repoId)).toBe(false);
  });

  it("ignores a name that only starts with the key", () => {
    expect(hasLivePass({ artifacts: [{ name: `${key}-extra`, expired: false, workflow_run: sameRepo }] }, key, repoId)).toBe(false);
  });

  it("ignores a pass uploaded by a pull request from a fork", () => {
    const fromFork = { repository_id: repoId, head_repository_id: 7 };
    expect(hasLivePass({ artifacts: [{ name: key, expired: false, workflow_run: fromFork }] }, key, repoId)).toBe(false);
  });

  it("treats an empty listing as not passed", () => {
    expect(hasLivePass({}, key, repoId)).toBe(false);
  });

  it("never counts a pass when the repository id is unknown", async () => {
    vi.stubEnv("GITHUB_REPOSITORY_ID", "");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ artifacts: [{ name: key, expired: false, workflow_run: null }] })));
    await expect(sharedPassExists(key, "token")).rejects.toThrow("GITHUB_REPOSITORY_ID");
  });
});
