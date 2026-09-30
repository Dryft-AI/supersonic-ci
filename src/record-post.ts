import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import * as cache from "@actions/cache";
import * as core from "@actions/core";
import { PASS_PATH } from "./lanes.js";

async function run(): Promise<void> {
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
}

run().catch((error) => core.warning(`supersonic-ci record failed: ${error}`));
