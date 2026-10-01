import * as cache from "@actions/cache";
import * as core from "@actions/core";
import { laneHash, parseLanes } from "./lanes.js";
import { hasPassed, inFlight } from "./inflight.js";
import { headKey, saveNote } from "./notes.js";

export type Decision = "skip" | "wait" | "run";

async function run(): Promise<void> {
  const lanes = parseLanes(core.getInput("lanes", { required: true }));
  const prefix = core.getInput("key-prefix") || "supersonic-ci";
  const salt = core.getInput("salt");
  const token = core.getInput("github-token");
  const cwd = core.getInput("working-directory") || process.env.GITHUB_WORKSPACE || process.cwd();
  const cacheAvailable = cache.isFeatureAvailable();
  if (!cacheAvailable) core.warning("The Actions cache is not available here, so every lane will run.");

  const hashes: Record<string, string> = {};
  const decisions: Record<string, Decision> = {};
  const rows: string[][] = [];
  await Promise.all(
    lanes.map(async (lane) => {
      let hash = "";
      try {
        hash = laneHash(lane, cwd, salt);
      } catch (error) {
        core.warning(`Could not hash lane "${lane.name}", so it will run: ${error}`);
      }
      let decision: Decision = "run";
      if (cacheAvailable && hash) {
        await saveNote(headKey(prefix, lane.name, Date.now(), hash));
        if (await hasPassed(prefix, lane.name, hash)) decision = "skip";
        else if (await inFlight(prefix, lane.name, hash, token)) decision = "wait";
      }
      hashes[lane.name] = hash;
      decisions[lane.name] = decision;
      rows.push([lane.name, hash || "none", decision]);
    }),
  );
  for (const lane of lanes) {
    core.setOutput(`${lane.name}-hash`, hashes[lane.name]);
    core.setOutput(`${lane.name}-decision`, decisions[lane.name]);
    core.info(`${lane.name}: ${decisions[lane.name]} (${hashes[lane.name] || "no hash"})`);
  }
  core.setOutput("hashes", JSON.stringify(hashes));
  core.setOutput("decisions", JSON.stringify(decisions));
  await core.summary
    .addHeading("supersonic-ci plan", 3)
    .addTable([[{ data: "Lane", header: true }, { data: "Inputs hash", header: true }, { data: "Decision", header: true }], ...rows])
    .write();
}

run().catch((error) => core.setFailed(`supersonic-ci plan failed: ${error}`));
