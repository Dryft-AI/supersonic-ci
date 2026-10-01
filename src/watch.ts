import { openSync, readdirSync, readFileSync, writeSync } from "node:fs";
import { headPrefix, newestWithPrefix, parseHeadKey } from "./notes.js";

const lane = process.env.SUPERSONIC_LANE ?? "";
const hash = process.env.SUPERSONIC_HASH ?? "";
const prefix = process.env.SUPERSONIC_PREFIX ?? "supersonic-ci";
const since = Number(process.env.SUPERSONIC_SINCE ?? "0");
const pollMs = Number(process.env.SUPERSONIC_POLL_SECONDS ?? "15") * 1000;

type Proc = { pid: number; ppid: number; cmd: string };

function processes(): Proc[] {
  const out: Proc[] = [];
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = readFileSync(`/proc/${entry}/stat`, "utf8");
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      const cmd = readFileSync(`/proc/${entry}/cmdline`, "utf8").replace(/\0/g, " ");
      out.push({ pid: Number(entry), ppid, cmd });
    } catch {
      // The process exited while we looked.
    }
  }
  return out;
}

function descendants(root: number, all: Proc[]): number[] {
  const found: number[] = [];
  const queue = [root];
  while (queue.length) {
    const pid = queue.shift() as number;
    for (const p of all) {
      if (p.ppid === pid) {
        found.push(p.pid);
        queue.push(p.pid);
      }
    }
  }
  return found;
}

function say(pid: number, message: string): void {
  try {
    writeSync(openSync(`/proc/${pid}/fd/1`, "w"), `\n${message}\n`);
  } catch {
    // The step's output is not writable from here.
  }
}

function haltCurrentStep(reason: string): number[] {
  const all = processes();
  const targets: number[] = [];
  for (const worker of all.filter((p) => p.cmd.includes("Runner.Worker"))) {
    for (const step of all.filter((p) => p.ppid === worker.pid && p.pid !== process.pid)) {
      say(step.pid, `::error::supersonic-ci stopped this job: ${reason}`);
      targets.push(...descendants(step.pid, all).reverse(), step.pid);
    }
  }
  for (const pid of targets) signal(pid, "SIGTERM");
  return targets;
}

function signal(pid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(pid, sig);
  } catch {
    // Already gone.
  }
}

async function main(): Promise<void> {
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    const key = await newestWithPrefix(headPrefix(prefix, lane));
    const head = key ? parseHeadKey(key, prefix, lane) : undefined;
    if (head && head.hash !== hash && head.epochMs > since) {
      const targets = haltCurrentStep(`a newer push changed lane "${lane}" (now ${head.hash}, this job tests ${hash})`);
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      for (const pid of targets) signal(pid, "SIGKILL");
      return;
    }
  }
}

main().catch(() => process.exit(0));
