import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DefaultArtifactClient } from "@actions/artifact";
import { PASS_PATH } from "./lanes.js";

const RETENTION_DAYS = 7;

type ArtifactList = { artifacts?: { name: string; expired: boolean }[] };

export function hasLivePass(list: ArtifactList, key: string): boolean {
  return (list.artifacts ?? []).some((a) => a.name === key && !a.expired);
}

export async function sharedPassExists(key: string, token: string): Promise<boolean> {
  const api = process.env.GITHUB_API_URL ?? "https://api.github.com";
  const url = `${api}/repos/${process.env.GITHUB_REPOSITORY}/actions/artifacts?name=${encodeURIComponent(key)}&per_page=10`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`artifacts lookup returned ${res.status}`);
  return hasLivePass((await res.json()) as ArtifactList, key);
}

export async function uploadSharedPass(key: string): Promise<void> {
  const file = resolve(PASS_PATH);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${process.env.GITHUB_SHA ?? ""}\n`);
  await new DefaultArtifactClient().uploadArtifact(key, [file], dirname(file), { retentionDays: RETENTION_DAYS });
}
