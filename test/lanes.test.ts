import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { laneHash, parseLanes, passKey } from "../src/lanes.js";

function git(cwd: string, ...args: string[]) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function write(cwd: string, file: string, content: string) {
  mkdirSync(join(cwd, file, ".."), { recursive: true });
  writeFileSync(join(cwd, file), content);
  git(cwd, "add", file);
}

describe("parseLanes", () => {
  it("takes a list of paths or a map with paths and salt", () => {
    expect(parseLanes("backend: [backend, common]\nintegration:\n  paths: [backend]\n  salt: seed-true\n")).toEqual([
      { name: "backend", paths: ["backend", "common"], salt: "" },
      { name: "integration", paths: ["backend"], salt: "seed-true" },
    ]);
  });

  it("rejects a lane with no paths", () => {
    expect(() => parseLanes("backend: []")).toThrow(/non-empty list of paths/);
  });

  it("rejects a lane name that would break a cache key", () => {
    expect(() => parseLanes('"a b": [x]')).toThrow(/may only use/);
  });

  it("rejects a list at the top level", () => {
    expect(() => parseLanes("- backend")).toThrow(/YAML map/);
  });
});

describe("laneHash", () => {
  let repo: string;
  const backend = { name: "backend", paths: ["backend", ".github/workflows/ci.yml"], salt: "" };

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "supersonic-"));
    git(repo, "init", "-q");
    write(repo, "backend/app.py", "print(1)\n");
    write(repo, "frontend/app.ts", "export {}\n");
    write(repo, ".github/workflows/ci.yml", "on: push\n");
  });

  it("ignores changes outside the lane", () => {
    const before = laneHash(backend, repo);
    write(repo, "frontend/app.ts", "export const x = 1\n");
    expect(laneHash(backend, repo)).toBe(before);
  });

  it("changes when a file in the lane changes", () => {
    const before = laneHash(backend, repo);
    write(repo, "backend/app.py", "print(2)\n");
    expect(laneHash(backend, repo)).not.toBe(before);
  });

  it("changes when a file is added to the lane", () => {
    const before = laneHash(backend, repo);
    write(repo, "backend/new.py", "\n");
    expect(laneHash(backend, repo)).not.toBe(before);
  });

  it("changes with the lane salt and the global salt", () => {
    const plain = laneHash(backend, repo);
    expect(laneHash({ ...backend, salt: "seed-true" }, repo)).not.toBe(plain);
    expect(laneHash(backend, repo, "v2")).not.toBe(plain);
  });

  it("accepts glob pathspecs", () => {
    const glob = { name: "py", paths: ["backend/**"], salt: "" };
    const before = laneHash(glob, repo);
    write(repo, "backend/deep/x.py", "\n");
    expect(laneHash(glob, repo)).not.toBe(before);
  });

  it("refuses a lane that matches nothing, instead of hashing an empty list", () => {
    expect(() => laneHash({ name: "typo", paths: ["backnd"], salt: "" }, repo)).toThrow(/matches no tracked files/);
  });
});

describe("passKey", () => {
  it("joins prefix, lane and hash", () => {
    expect(passKey("supersonic-ci", "backend", "abc")).toBe("supersonic-ci-backend-abc");
  });
});
