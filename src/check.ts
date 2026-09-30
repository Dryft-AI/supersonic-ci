import * as cache from "@actions/cache";
import * as core from "@actions/core";
import { laneHash, parseLanes, PASS_PATH, passKey } from "./lanes.js";

async function hasPassed(key: string): Promise<boolean> {
  try {
    const hit = await cache.restoreCache([PASS_PATH], key, [], { lookupOnly: true });
    return hit === key;
  } catch (error) {
    core.warning(`Could not look up ${key}, so the job will run: ${error}`);
    return false;
  }
}

async function run(): Promise<void> {
  const lanes = parseLanes(core.getInput("lanes", { required: true }));
  const prefix = core.getInput("key-prefix") || "supersonic-ci";
  const salt = core.getInput("salt");
  const cwd = core.getInput("working-directory") || process.env.GITHUB_WORKSPACE || process.cwd();
  const cacheAvailable = cache.isFeatureAvailable();
  if (!cacheAvailable) {
    core.warning("The Actions cache is not available here, so every job will run.");
  }

  const hashes: Record<string, string> = {};
  const passed: Record<string, boolean> = {};
  const rows: string[][] = [];
  for (const lane of lanes) {
    let hash = "";
    try {
      hash = laneHash(lane, cwd, salt);
    } catch (error) {
      core.warning(`Could not hash lane "${lane.name}", so it will run: ${error}`);
    }
    const ok = cacheAvailable && hash !== "" && (await hasPassed(passKey(prefix, lane.name, hash)));
    hashes[lane.name] = hash;
    passed[lane.name] = ok;
    core.setOutput(`${lane.name}-hash`, hash);
    core.setOutput(`${lane.name}-passed`, String(ok));
    core.info(`${lane.name}: ${ok ? "already passed, skip" : "not passed yet, run"} (${hash || "no hash"})`);
    rows.push([lane.name, hash || "none", ok ? "skip, already passed" : "run"]);
  }
  core.setOutput("hashes", JSON.stringify(hashes));
  core.setOutput("passed", JSON.stringify(passed));
  await core.summary
    .addHeading("supersonic-ci", 3)
    .addTable([[{ data: "Lane", header: true }, { data: "Inputs hash", header: true }, { data: "Decision", header: true }], ...rows])
    .write();
}

run().catch((error) => core.setFailed(`supersonic-ci check failed: ${error}`));
