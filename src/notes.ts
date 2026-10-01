import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import * as cache from "@actions/cache";
import { PASS_PATH } from "./lanes.js";

export function headPrefix(prefix: string, lane: string): string {
  return `${prefix}-head-${lane}-`;
}

export function headKey(prefix: string, lane: string, epochMs: number, hash: string): string {
  return `${headPrefix(prefix, lane)}${String(epochMs).padStart(15, "0")}-${hash}`;
}

export function parseHeadKey(key: string, prefix: string, lane: string): { epochMs: number; hash: string } | undefined {
  const rest = key.startsWith(headPrefix(prefix, lane)) ? key.slice(headPrefix(prefix, lane).length) : "";
  const match = /^(\d{15})-([0-9a-f]+)$/.exec(rest);
  return match ? { epochMs: Number(match[1]), hash: match[2] } : undefined;
}

export function startedPrefix(prefix: string, lane: string, hash: string): string {
  return `${prefix}-started-${lane}-${hash}-`;
}

export function startedKey(prefix: string, lane: string, hash: string, runId: string, runner: string, epochMs: number): string {
  const safeRunner = runner.replace(/[^A-Za-z0-9_.-]/g, "_");
  return `${startedPrefix(prefix, lane, hash)}${String(epochMs).padStart(15, "0")}-${runId}-${safeRunner}`;
}

export function parseStartedKey(key: string, prefix: string, lane: string, hash: string): { runId: string; runner: string } | undefined {
  const p = startedPrefix(prefix, lane, hash);
  const rest = key.startsWith(p) ? key.slice(p.length) : "";
  const match = /^\d{15}-(\d+)-(.+)$/.exec(rest);
  return match ? { runId: match[1], runner: match[2] } : undefined;
}

export async function saveNote(key: string): Promise<void> {
  mkdirSync(dirname(PASS_PATH), { recursive: true });
  writeFileSync(PASS_PATH, `${process.env.GITHUB_SHA ?? ""}\n`);
  try {
    await cache.saveCache([PASS_PATH], key);
  } catch {
    // A note that already exists, or a cache hiccup, only costs a duplicate run.
  }
}

export async function exists(key: string): Promise<boolean> {
  try {
    return (await cache.restoreCache([PASS_PATH], key, [], { lookupOnly: true })) === key;
  } catch {
    return false;
  }
}

export async function newestWithPrefix(keyPrefix: string): Promise<string | undefined> {
  try {
    return await cache.restoreCache([PASS_PATH], `${keyPrefix}~none`, [keyPrefix], { lookupOnly: true });
  } catch {
    return undefined;
  }
}
