import * as cache from "@actions/cache";
import * as core from "@actions/core";
import { laneHash, parseLanes } from "./lanes.js";
import { waitForResult, waitInputs } from "./inflight.js";
import { headKey, saveNote } from "./notes.js";

function decide(run: boolean, hash: string, reason: string): void {
  core.setOutput("run", String(run));
  core.setOutput("hash", hash);
  core.setOutput("reason", reason);
  core.info(`${run ? "run" : "skip"}: ${reason}`);
}

async function run(): Promise<void> {
  const lane = core.getInput("lane", { required: true });
  const pathsInput = core.getInput("paths", { required: true });
  const prefix = core.getInput("key-prefix") || "supersonic-ci";
  const cwd = core.getInput("working-directory") || process.env.GITHUB_WORKSPACE || process.cwd();

  if (!cache.isFeatureAvailable()) return decide(true, "", "the Actions cache is not available");

  const paths = pathsInput.trim().startsWith("[") ? parseLanes(`${lane}: ${pathsInput}`)[0].paths : pathsInput.split(/\s+/).filter(Boolean);
  let hash: string;
  try {
    hash = laneHash({ name: lane, paths, salt: core.getInput("salt") }, cwd);
  } catch (error) {
    return decide(true, "", `could not hash the lane: ${error}`);
  }
  await saveNote(headKey(prefix, lane, Date.now(), hash));
  const result = await waitForResult(prefix, lane, hash, core.getInput("github-token"), waitInputs());
  decide(result.run, hash, result.reason);
}

run().catch((error) => {
  core.warning(`supersonic-ci gate failed, so the job will run: ${error}`);
  core.setOutput("run", "true");
  core.setOutput("hash", "");
});
