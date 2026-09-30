import * as core from "@actions/core";
import { passKey } from "./lanes.js";

const lane = core.getInput("lane", { required: true });
const hash = core.getInput("hash");
const prefix = core.getInput("key-prefix") || "supersonic-ci";

if (!hash) {
  core.info(`No hash for lane "${lane}", so this job's result will not be recorded.`);
} else {
  const key = passKey(prefix, lane, hash);
  core.saveState("key", key);
  core.info(`If this job succeeds, ${key} will be recorded as passed.`);
}
