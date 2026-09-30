import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { parse } from "yaml";

export const PASS_PATH = ".supersonic-ci/pass";

export type Lane = { name: string; paths: string[]; salt: string };

export function parseLanes(text: string): Lane[] {
  const doc: unknown = parse(text);
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error("`lanes` must be a YAML map of lane name to a list of paths");
  }
  return Object.entries(doc).map(([name, spec]) => {
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
      throw new Error(`lane name "${name}" may only use letters, digits, '.', '_' and '-'`);
    }
    const { paths, salt } = Array.isArray(spec)
      ? { paths: spec as unknown, salt: undefined }
      : ((spec ?? {}) as { paths?: unknown; salt?: unknown });
    if (!Array.isArray(paths) || paths.length === 0 || !paths.every((p) => typeof p === "string")) {
      throw new Error(`lane "${name}" needs a non-empty list of paths`);
    }
    return { name, paths, salt: salt == null ? "" : String(salt) };
  });
}

export function laneHash(lane: Lane, cwd: string, globalSalt = ""): string {
  const listing = execFileSync("git", ["ls-files", "--stage", "--", ...lane.paths], {
    cwd,
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
  if (!listing) {
    throw new Error(`lane "${lane.name}" matches no tracked files`);
  }
  return createHash("sha256")
    .update(JSON.stringify({ paths: lane.paths, salt: lane.salt, globalSalt }))
    .update("\0")
    .update(listing)
    .digest("hex")
    .slice(0, 32);
}

export function passKey(prefix: string, lane: string, hash: string): string {
  return `${prefix}-${lane}-${hash}`;
}
