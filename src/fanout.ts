import * as cache from "@actions/cache";
import * as core from "@actions/core";
import { parse } from "yaml";
import { laneHash } from "./lanes.js";
import { githubApi, hasPassed } from "./inflight.js";
import { headKey, saveNote } from "./notes.js";

type LaneSpec = { name: string; paths: string[]; workflow: string; checks: string[] };

function parseFanout(text: string): LaneSpec[] {
  const doc = parse(text) as Record<string, { paths?: string[]; workflow?: string; checks?: string[] }>;
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Error("`lanes` must be a YAML map");
  return Object.entries(doc).map(([name, spec]) => {
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) throw new Error(`bad lane name "${name}"`);
    if (!spec?.paths?.length || !spec.workflow) throw new Error(`lane "${name}" needs paths and workflow`);
    return { name, paths: spec.paths, workflow: spec.workflow, checks: spec.checks ?? [] };
  });
}

export const runTitle = (lane: string, hash: string, headSha: string) => `supersonic ${lane} ${hash} ${headSha}`;

type ActiveRun = { id: number; display_title: string };

async function activeLaneRuns(branch: string, token: string): Promise<ActiveRun[]> {
  const runs: ActiveRun[] = [];
  for (const status of ["queued", "in_progress", "waiting", "pending"]) {
    const response = await githubApi(`/actions/runs?branch=${encodeURIComponent(branch)}&event=workflow_dispatch&status=${status}&per_page=100`, token);
    if (!response.ok) continue;
    const body = (await response.json()) as { workflow_runs: ActiveRun[] };
    runs.push(...body.workflow_runs);
  }
  return runs;
}

async function postChecks(names: string[], headSha: string, conclusion: "success" | "skipped", summary: string, token: string): Promise<void> {
  for (const name of names) {
    const response = await githubApi("/check-runs", token, {
      method: "POST",
      body: JSON.stringify({ name, head_sha: headSha, status: "completed", conclusion, output: { title: summary, summary } }),
    });
    if (!response.ok) core.warning(`Could not post check "${name}": ${response.status} ${await response.text()}`);
  }
}

async function run(): Promise<void> {
  const lanes = parseFanout(core.getInput("lanes", { required: true }));
  const prefix = core.getInput("key-prefix") || "supersonic-ci";
  const token = core.getInput("github-token");
  const sha = core.getInput("sha", { required: true });
  const headSha = core.getInput("head-sha", { required: true });
  const branch = core.getInput("ref", { required: true });
  const extraInputs = JSON.parse(core.getInput("inputs") || "{}") as Record<string, string>;
  const touched = JSON.parse(core.getInput("touched") || "{}") as Record<string, boolean | string>;
  const cwd = process.env.GITHUB_WORKSPACE || process.cwd();
  const cacheAvailable = cache.isFeatureAvailable();

  const active = await activeLaneRuns(branch, token);
  await Promise.all(
    lanes.map(async (lane) => {
      let hash = "";
      try {
        hash = laneHash({ name: lane.name, paths: lane.paths, salt: core.getInput("salt") }, cwd);
      } catch (error) {
        core.warning(`Could not hash lane "${lane.name}": ${error}`);
      }
      if (hash && cacheAvailable) await saveNote(headKey(prefix, lane.name, Date.now(), hash));

      for (const r of active) {
        const [tag, name, runHash] = r.display_title.split(" ");
        if (tag === "supersonic" && name === lane.name && runHash !== hash) {
          await githubApi(`/actions/runs/${r.id}/cancel`, token, { method: "POST" });
          core.info(`${lane.name}: cancelled stale run ${r.id} (${runHash})`);
        }
      }

      const isTouched = !(lane.name in touched) || touched[lane.name] === true || touched[lane.name] === "true";
      if (!isTouched) {
        await postChecks(lane.checks, headSha, "skipped", "This PR does not touch this lane.", token);
        core.info(`${lane.name}: untouched, posted skipped checks`);
        return;
      }
      if (hash && cacheAvailable && (await hasPassed(prefix, lane.name, hash))) {
        await postChecks(lane.checks, headSha, "success", `Already passed on inputs ${hash}.`, token);
        core.info(`${lane.name}: already passed on ${hash}, posted green checks`);
        return;
      }
      const response = await githubApi(`/actions/workflows/${lane.workflow}/dispatches`, token, {
        method: "POST",
        body: JSON.stringify({ ref: branch, inputs: { ...extraInputs, hash, sha, head_sha: headSha } }),
      });
      if (!response.ok) throw new Error(`dispatching ${lane.workflow} failed: ${response.status} ${await response.text()}`);
      core.info(`${lane.name}: dispatched ${lane.workflow} on ${hash || "no hash"}`);
    }),
  );
}

run().catch((error) => core.setFailed(`supersonic-ci fanout failed: ${error}`));
