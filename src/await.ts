import * as core from "@actions/core";
import { waitForResult, waitInputs } from "./inflight.js";

async function run(): Promise<void> {
  const lane = core.getInput("lane", { required: true });
  const hash = core.getInput("hash");
  const prefix = core.getInput("key-prefix") || "supersonic-ci";
  if (!hash) {
    core.setOutput("run", "true");
    core.info("run: no hash");
    return;
  }
  const result = await waitForResult(prefix, lane, hash, core.getInput("github-token"), waitInputs(), true);
  core.setOutput("run", String(result.run));
  core.info(`${result.run ? "run" : "skip"}: ${result.reason}`);
  if (result.failed) core.setFailed(result.reason);
}

run().catch((error) => {
  core.warning(`supersonic-ci await failed, so the job will run: ${error}`);
  core.setOutput("run", "true");
});
