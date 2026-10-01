import * as cache from "@actions/cache";
import * as core from "@actions/core";
import { laneHash, parseLanes, passKey } from "./lanes.js";
import { exists, headKey, newestWithPrefix, parseStartedKey, saveNote, startedPrefix } from "./notes.js";

type JobState = "running" | "done" | "unknown";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function jobState(runId: string, runner: string, token: string): Promise<JobState> {
  const api = process.env.GITHUB_API_URL ?? "https://api.github.com";
  const repo = process.env.GITHUB_REPOSITORY;
  for (let page = 1; page <= 5; page++) {
    const response = await fetch(`${api}/repos/${repo}/actions/runs/${runId}/jobs?filter=latest&per_page=100&page=${page}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
    });
    if (!response.ok) return "unknown";
    const body = (await response.json()) as { jobs: { runner_name: string | null; status: string }[] };
    const job = body.jobs.find((j) => (j.runner_name ?? "").replace(/[^A-Za-z0-9_.-]/g, "_") === runner);
    if (job) return job.status === "completed" ? "done" : "running";
    if (body.jobs.length < 100) break;
  }
  return "done";
}

function decide(run: boolean, hash: string, reason: string): void {
  core.setOutput("run", String(run));
  core.setOutput("hash", hash);
  core.setOutput("reason", reason);
  core.info(`${run ? "run" : "skip"}: ${reason}`);
}

async function run(): Promise<void> {
  const lane = core.getInput("lane", { required: true });
  const pathsInput = core.getInput("paths", { required: true });
  const salt = core.getInput("salt");
  const prefix = core.getInput("key-prefix") || "supersonic-ci";
  const token = core.getInput("github-token");
  const pollMs = Number(core.getInput("poll-seconds") || "10") * 1000;
  const deadline = Date.now() + Number(core.getInput("max-wait-minutes") || "45") * 60_000;
  const settleMs = Number(core.getInput("settle-seconds") || "30") * 1000;
  const cwd = core.getInput("working-directory") || process.env.GITHUB_WORKSPACE || process.cwd();

  if (!cache.isFeatureAvailable()) return decide(true, "", "the Actions cache is not available");

  const paths = pathsInput.trim().startsWith("[") ? parseLanes(`${lane}: ${pathsInput}`)[0].paths : pathsInput.split(/\s+/).filter(Boolean);
  let hash: string;
  try {
    hash = laneHash({ name: lane, paths, salt }, cwd);
  } catch (error) {
    return decide(true, "", `could not hash the lane: ${error}`);
  }
  await saveNote(headKey(prefix, lane, Date.now(), hash));

  const pass = passKey(prefix, lane, hash);
  if (await exists(pass)) return decide(false, hash, `already passed on ${hash}`);

  let quietSince: number | undefined;
  let waited = false;
  while (Date.now() < deadline) {
    const startedKey = await newestWithPrefix(startedPrefix(prefix, lane, hash));
    const started = startedKey ? parseStartedKey(startedKey, prefix, lane, hash) : undefined;
    const state: JobState = started ? await jobState(started.runId, started.runner, token) : "done";

    if (state === "running") {
      if (!waited) core.info(`Run ${started?.runId} is already testing ${hash}, waiting for its result.`);
      waited = true;
      quietSince = undefined;
    } else {
      if (!waited) return decide(true, hash, `nothing has passed on ${hash} and nothing is testing it`);
      quietSince ??= Date.now();
      if (Date.now() - quietSince >= settleMs) {
        return decide(true, hash, `the earlier job on ${hash} ended without passing`);
      }
    }
    await sleep(pollMs);
    if (await exists(pass)) return decide(false, hash, `the earlier job passed on ${hash} while this one waited`);
  }
  return decide(true, hash, "gave up waiting for the earlier job");
}

run().catch((error) => {
  core.warning(`supersonic-ci gate failed, so the job will run: ${error}`);
  core.setOutput("run", "true");
  core.setOutput("hash", "");
});
