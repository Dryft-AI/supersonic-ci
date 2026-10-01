import * as core from "@actions/core";
import { passKey } from "./lanes.js";
import { exists, newestWithPrefix, parseStartedKey, startedPrefix } from "./notes.js";

export type JobState = "running" | "done" | "unknown";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function githubApi(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  const api = process.env.GITHUB_API_URL ?? "https://api.github.com";
  return fetch(`${api}/repos/${process.env.GITHUB_REPOSITORY}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

export async function jobState(runId: string, runner: string, token: string): Promise<JobState> {
  for (let page = 1; page <= 5; page++) {
    const response = await githubApi(`/actions/runs/${runId}/jobs?filter=latest&per_page=100&page=${page}`, token);
    if (!response.ok) return "unknown";
    const body = (await response.json()) as { jobs: { runner_name: string | null; status: string }[] };
    const job = body.jobs.find((j) => (j.runner_name ?? "").replace(/[^A-Za-z0-9_.-]/g, "_") === runner);
    if (job) return job.status === "completed" ? "done" : "running";
    if (body.jobs.length < 100) break;
  }
  return "done";
}

export async function hasPassed(prefix: string, lane: string, hash: string): Promise<boolean> {
  return exists(passKey(prefix, lane, hash));
}

export async function inFlight(prefix: string, lane: string, hash: string, token: string): Promise<string | undefined> {
  const key = await newestWithPrefix(startedPrefix(prefix, lane, hash));
  const started = key ? parseStartedKey(key, prefix, lane, hash) : undefined;
  if (!started) return undefined;
  return (await jobState(started.runId, started.runner, token)) === "running" ? started.runId : undefined;
}

export type Wait = { pollMs: number; settleMs: number; deadline: number };

export async function waitForResult(
  prefix: string,
  lane: string,
  hash: string,
  token: string,
  wait: Wait,
  settleEvenIfIdle = false,
): Promise<{ run: boolean; reason: string }> {
  let waited = settleEvenIfIdle;
  let quietSince: number | undefined;
  while (Date.now() < wait.deadline) {
    if (await hasPassed(prefix, lane, hash)) {
      return { run: false, reason: waited ? `the earlier job passed on ${hash} while this one waited` : `already passed on ${hash}` };
    }
    const runId = await inFlight(prefix, lane, hash, token);
    if (runId) {
      if (!waited) core.info(`Run ${runId} is already testing ${hash}, waiting for its result.`);
      waited = true;
      quietSince = undefined;
    } else {
      if (!waited) return { run: true, reason: `nothing has passed on ${hash} and nothing is testing it` };
      quietSince ??= Date.now();
      if (Date.now() - quietSince >= wait.settleMs) {
        return { run: true, reason: `the earlier job on ${hash} ended without passing` };
      }
    }
    await sleep(wait.pollMs);
  }
  return { run: true, reason: "gave up waiting for the earlier job" };
}

export function waitInputs(): Wait {
  return {
    pollMs: Number(core.getInput("poll-seconds") || "10") * 1000,
    settleMs: Number(core.getInput("settle-seconds") || "30") * 1000,
    deadline: Date.now() + Number(core.getInput("max-wait-minutes") || "45") * 60_000,
  };
}
