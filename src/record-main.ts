import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@actions/core";
import { passKey } from "./lanes.js";
import { saveNote, startedKey } from "./notes.js";

async function run(): Promise<void> {
  const lane = core.getInput("lane", { required: true });
  const hash = core.getInput("hash");
  const prefix = core.getInput("key-prefix") || "supersonic-ci";
  const save = core.getInput("save") !== "false";
  const watch = core.getInput("watch") !== "false";

  if (!hash) {
    core.info(`No hash for lane "${lane}", so this job is neither recorded nor watched.`);
    return;
  }
  if (save) {
    core.saveState("key", passKey(prefix, lane, hash));
    core.info(`If this job succeeds, ${passKey(prefix, lane, hash)} will be recorded as passed.`);
  }

  const now = Date.now();
  await saveNote(startedKey(prefix, lane, hash, process.env.GITHUB_RUN_ID ?? "0", process.env.RUNNER_NAME ?? "runner", now));

  if (watch && process.platform === "linux") {
    const watcher = spawn(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), "watch.mjs")], {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        SUPERSONIC_LANE: lane,
        SUPERSONIC_HASH: hash,
        SUPERSONIC_PREFIX: prefix,
        SUPERSONIC_SINCE: String(now),
        SUPERSONIC_POLL_SECONDS: core.getInput("poll-seconds") || "15",
      },
    });
    watcher.unref();
    core.saveState("watcher", String(watcher.pid ?? ""));
    core.info(`Watching for a newer push that changes lane "${lane}" (watcher pid ${watcher.pid}).`);
  }
}

run().catch((error) => core.warning(`supersonic-ci record failed to start: ${error}`));
