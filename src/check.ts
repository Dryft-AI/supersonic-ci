import * as cache from "@actions/cache";
import * as core from "@actions/core";
import { laneHash, parseLanes, PASS_PATH, passKey } from "./lanes.js";
import { sharedPassExists } from "./shared.js";

async function inCache(key: string): Promise<boolean> {
  try {
    return (await cache.restoreCache([PASS_PATH], key, [], { lookupOnly: true })) === key;
  } catch (error) {
    core.warning(`Could not look up ${key} in the cache: ${error}`);
    return false;
  }
}

async function inSharedStore(key: string, token: string): Promise<boolean> {
  try {
    return await sharedPassExists(key, token);
  } catch (error) {
    core.warning(`Could not look up ${key} in the shared store: ${error}`);
    return false;
  }
}

async function run(): Promise<void> {
  const lanes = parseLanes(core.getInput("lanes", { required: true }));
  const prefix = core.getInput("key-prefix") || "supersonic-ci";
  const salt = core.getInput("salt");
  const cwd = core.getInput("working-directory") || process.env.GITHUB_WORKSPACE || process.cwd();
  const shared = core.getInput("shared") === "true";
  const token = core.getInput("github-token");
  const cacheAvailable = cache.isFeatureAvailable();
  if (!cacheAvailable && !shared) {
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
    const key = passKey(prefix, lane.name, hash);
    const source =
      hash === ""
        ? undefined
        : cacheAvailable && (await inCache(key))
          ? "cache"
          : shared && (await inSharedStore(key, token))
            ? "shared store"
            : undefined;
    const ok = source !== undefined;
    hashes[lane.name] = hash;
    passed[lane.name] = ok;
    core.setOutput(`${lane.name}-hash`, hash);
    core.setOutput(`${lane.name}-passed`, String(ok));
    core.info(`${lane.name}: ${ok ? `ci went supersonic (pass was previously cached)` : "not passed yet, run"} (${hash || "no hash"})`);
    rows.push([lane.name, hash || "none", ok ? `skip, already passed (${source})` : "run"]);
  }
  core.setOutput("hashes", JSON.stringify(hashes));
  core.setOutput("passed", JSON.stringify(passed));
  await core.summary
    .addHeading("supersonic-ci", 3)
    .addTable([[{ data: "Lane", header: true }, { data: "Inputs hash", header: true }, { data: "Decision", header: true }], ...rows])
    .write();
}

run().catch((error) => core.setFailed(`supersonic-ci check failed: ${error}`));
