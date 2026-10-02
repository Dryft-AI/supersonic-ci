import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import * as cache from "@actions/cache";
import * as core from "@actions/core";
import { PASS_PATH } from "./lanes.js";
import { uploadSharedPass } from "./shared.js";

function stopWatcher(): void {
  const pid = Number(core.getState("watcher"));
  if (!pid) return;
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
}

async function run(): Promise<void> {
  stopWatcher();
  const key = core.getState("key");
  if (!key) return;
  mkdirSync(dirname(PASS_PATH), { recursive: true });
  writeFileSync(PASS_PATH, `${process.env.GITHUB_SHA ?? ""}\n`);
  try {
    await cache.saveCache([PASS_PATH], key);
    core.info(`Recorded ${key} as passed.`);
  } catch (error) {
    core.info(`Did not record ${key}: ${error}`);
  }
  if (core.getState("shared") !== "true") return;
  try {
    await uploadSharedPass(key);
    core.info(`Shared ${key} with every branch.`);
  } catch (error) {
    core.info(`Did not share ${key}: ${error}`);
  }
}

run().catch((error) => core.warning(`supersonic-ci record failed: ${error}`));
