import * as cache from "@actions/cache";
import * as core from "@actions/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitForResult } from "../src/inflight.js";
import { laneHash, passKey } from "../src/lanes.js";
import { startedKey } from "../src/notes.js";

vi.mock("@actions/cache", () => ({
  isFeatureAvailable: () => true,
  restoreCache: vi.fn(),
  saveCache: vi.fn(),
}));

vi.mock("@actions/core", () => ({
  getInput: vi.fn(),
  setOutput: vi.fn(),
  setFailed: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

type Job = { runner_name: string; status: string; conclusion: string | null };
const prefix = "ss";
const lane = "backend";
let hash: string;
let notes: Set<string>;
let jobs: Map<string, Job[]>;

function startJob(runId = "101", runner = "runner-a") {
  const job: Job = { runner_name: runner, status: "in_progress", conclusion: null };
  jobs.set(runId, [job]);
  notes.add(startedKey(prefix, lane, hash, runId, runner, Date.now()));
  return job;
}

function finish(job: Job, conclusion: string, recordPass = false) {
  job.status = "completed";
  job.conclusion = conclusion;
  if (recordPass) notes.add(passKey(prefix, lane, hash));
}

async function wait(settleEvenIfIdle = false) {
  const result = waitForResult(prefix, lane, hash, "token", {
    pollMs: 5,
    settleMs: 10,
    deadline: Date.now() + 100,
  }, settleEvenIfIdle);
  await vi.runAllTimersAsync();
  return result;
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  vi.stubEnv("GITHUB_REPOSITORY", "owner/repo");
  vi.stubEnv("GITHUB_API_URL", "https://api.github.test");
  hash = laneHash({ name: lane, paths: ["src"], salt: "" }, process.cwd());
  notes = new Set();
  jobs = new Map();
  vi.mocked(cache.restoreCache).mockImplementation(async (_paths, key, restoreKeys = []) => {
    if (notes.has(key)) return key;
    return [...notes].sort().reverse().find((note) => restoreKeys.some((p) => note.startsWith(p)));
  });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const runId = new URL(url).pathname.match(/\/actions\/runs\/(\d+)\/jobs$/)?.[1];
    if (!runId) throw new Error(`Unexpected API request: ${url}`);
    return Response.json({ jobs: jobs.get(runId) ?? [] });
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("waiting for identical inputs", () => {
  it("skips the work when the running job records a pass", async () => {
    const job = startJob();
    setTimeout(() => finish(job, "success", true), 10);

    const result = await wait();
    expect(result.run).toBe(false);
    expect(result.failed).not.toBe(true);
  });

  it("inherits the running job's failure instead of rerunning the work", async () => {
    const job = startJob();
    setTimeout(() => finish(job, "failure"), 10);

    expect(await wait()).toMatchObject({ run: false, failed: true, reason: expect.stringContaining("run 101") });
  });

  it("keeps following the job it joined when another start note appears", async () => {
    const job = startJob();
    setTimeout(() => startJob("102", "runner-b"), 5);
    setTimeout(() => finish(job, "failure"), 10);

    expect(await wait()).toMatchObject({ run: false, failed: true, reason: expect.stringContaining("run 101") });
  });

  it("lets a fresh gate retry a failure that finished before it started", async () => {
    finish(startJob(), "failure");

    expect(await wait()).toMatchObject({ run: true });
  });

  it("inherits a failure that finishes while await is queued behind it", async () => {
    finish(startJob(), "failure");

    expect(await wait(true)).toMatchObject({ run: false, failed: true });
  });

  it.each(["cancelled", "timed_out", "neutral", "skipped", "success"])("retries after %s without a pass record", async (conclusion) => {
    const job = startJob();
    setTimeout(() => finish(job, conclusion), 10);

    expect(await wait()).toMatchObject({ run: true });
  });

  it("gives a completed job's success record time to arrive", async () => {
    const job = startJob();
    setTimeout(() => finish(job, "success"), 10);
    setTimeout(() => notes.add(passKey(prefix, lane, hash)), 15);

    expect(await wait()).toMatchObject({ run: false });
  });

  it("retries if the job disappears from the API", async () => {
    startJob();
    setTimeout(() => jobs.clear(), 10);

    expect(await wait()).toMatchObject({ run: true });
  });

  it("retries if GitHub cannot return the result", async () => {
    startJob();
    setTimeout(() => vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 403 })), 10);

    expect(await wait()).toMatchObject({ run: true });
  });

  it("runs when there is no earlier job", async () => {
    expect(await wait()).toMatchObject({ run: true });
  });

  it("does not inherit failures for a different hash", async () => {
    const key = startedKey(prefix, lane, "other-hash", "101", "runner-a", Date.now());
    notes.add(key);
    jobs.set("101", [{ runner_name: "runner-a", status: "completed", conclusion: "failure" }]);

    expect(await wait(true)).toMatchObject({ run: true });
  });

  it("runs if the earlier job outlasts the wait limit", async () => {
    startJob();

    expect(await wait()).toMatchObject({ run: true, reason: "gave up waiting for the earlier job" });
  });
});

describe.each(["gate", "await"])("%s action", (action) => {
  beforeEach(() => {
    const inputs: Record<string, string> = {
      lane, hash, paths: "src", "key-prefix": prefix, "github-token": "token",
      "working-directory": process.cwd(), "poll-seconds": "0.005", "settle-seconds": "0.01", "max-wait-minutes": "0.01",
    };
    vi.mocked(core.getInput).mockImplementation((name) => inputs[name] ?? "");
  });

  async function runAction() {
    if (action === "gate") await import("../src/gate.js");
    else await import("../src/await.js");
    await vi.runAllTimersAsync();
  }

  it("fails the action and prevents duplicate work after the earlier job fails", async () => {
    const job = startJob();
    setTimeout(() => finish(job, "failure"), 10);

    await runAction();

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining("run 101 failed"));
    expect(core.setOutput).toHaveBeenCalledWith("run", "false");
    expect(core.setOutput).not.toHaveBeenCalledWith("run", "true");
  });

  it("skips successfully after the earlier job records a pass", async () => {
    const job = startJob();
    setTimeout(() => finish(job, "success", true), 10);

    await runAction();

    expect(core.setOutput).toHaveBeenCalledWith("run", "false");
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it("runs its own work if GitHub throws while fetching the result", async () => {
    startJob();
    vi.mocked(fetch).mockRejectedValue(new Error("network unavailable"));

    await runAction();

    expect(core.setOutput).toHaveBeenCalledWith("run", "true");
    expect(core.setFailed).not.toHaveBeenCalled();
  });
});
