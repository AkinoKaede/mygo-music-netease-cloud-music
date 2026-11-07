// SPDX-FileCopyrightText: 2026 Kaede Akino
// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readMetadata, releaseNames, root, type Manifest, type Package } from "./metadata.ts";

export interface ReleaseInfo {
  version: string;
  minAppVersion: string;
  tag: string;
  sha: string;
  zip: string;
  checksum: string;
  digest: string;
}
export interface Draft {
  id: number;
  draft: boolean;
  target_commitish: string;
  html_url: string;
}
export interface Asset {
  id: number;
  name: string;
  size: number;
  digest?: string;
}
export interface Upload {
  name: string;
  bytes: Uint8Array;
}
export interface ReleaseClient {
  tagSHA(tag: string): Promise<string | null>;
  release(tag: string): Promise<Draft | null>;
  createTag(tag: string, sha: string): Promise<void>;
  notes(tag: string, sha: string): Promise<string>;
  createDraft(info: ReleaseInfo, body: string): Promise<Draft>;
  assets(id: number): Promise<Asset[]>;
  upload(id: number, file: Upload): Promise<Asset>;
  deleteAsset(id: number): Promise<void>;
  renameAsset(id: number, name: string): Promise<void>;
}
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export function validateReleaseInfo(
  info: ReleaseInfo,
  pkg: Package,
  manifest: Manifest,
  expectedSHA: string,
) {
  const names = releaseNames(pkg);
  if (!/^[a-f0-9]{40}$/.test(expectedSHA) || info.sha !== expectedSHA) {
    throw new Error("Release artifact does not match the triggering commit");
  }
  if (
    info.version !== pkg.version ||
    info.minAppVersion !== manifest.minAppVersion ||
    info.tag !== names.tag ||
    info.zip !== names.zip ||
    info.checksum !== names.checksum ||
    !/^[a-f0-9]{64}$/.test(info.digest)
  ) {
    throw new Error("Release artifact metadata does not match the committed manifests");
  }
}

export async function loadRelease(directory: string, expectedSHA: string) {
  const { pkg, manifest } = await readMetadata();
  const info = JSON.parse(
    await readFile(resolve(directory, "release.json"), "utf8"),
  ) as ReleaseInfo;
  validateReleaseInfo(info, pkg, manifest, expectedSHA);
  const names = await readdir(directory);
  if (
    JSON.stringify(names.sort()) !==
    JSON.stringify([info.zip, info.checksum, "release.json"].sort())
  ) {
    throw new Error("Unexpected release artifact files");
  }
  const zip = await readFile(resolve(directory, info.zip));
  const checksum = await readFile(resolve(directory, info.checksum));
  if (digest(zip) !== info.digest || checksum.toString() !== `${info.digest}  ${info.zip}\n`) {
    throw new Error("Release ZIP checksum mismatch");
  }
  return {
    info,
    files: [
      { name: info.zip, bytes: zip },
      { name: info.checksum, bytes: checksum },
    ],
  };
}

async function ensureAsset(client: ReleaseClient, release: Draft, file: Upload) {
  const expected = `sha256:${digest(file.bytes)}`;
  const assets = await client.assets(release.id);
  const current = assets.find((asset) => asset.name === file.name);
  if (current?.digest === expected && current.size === file.bytes.length) return;
  // Stage before removing the old asset. A failed upload leaves a usable draft.
  const stagedName = `${file.name}.pending-${expected.slice(-12)}`;
  let staged = assets.find((asset) => asset.name === stagedName);
  if (staged && (staged.digest !== expected || staged.size !== file.bytes.length)) {
    await client.deleteAsset(staged.id);
    staged = undefined;
  }
  staged ??= await client.upload(release.id, { ...file, name: stagedName });
  if (staged.size !== file.bytes.length || (staged.digest && staged.digest !== expected)) {
    throw new Error("Uploaded release asset failed integrity verification");
  }
  if (current) await client.deleteAsset(current.id);
  await client.renameAsset(staged.id, file.name);
}

export async function createDraftRelease(
  client: ReleaseClient,
  info: ReleaseInfo,
  files: Upload[],
) {
  const [tagSHA, existing] = await Promise.all([client.tagSHA(info.tag), client.release(info.tag)]);
  if (existing && !existing.draft) throw new Error(`${info.tag} is already published`);
  if (tagSHA !== null && tagSHA !== info.sha)
    throw new Error("Existing tag points to another commit");
  if (existing && existing.target_commitish !== info.sha) {
    throw new Error("Existing draft targets another commit");
  }
  let draft = existing;
  if (!draft) {
    const generated = await client.notes(info.tag, info.sha);
    const body =
      `Requires **MyGo Music ${info.minAppVersion} or later**.\n\n` +
      `Source commit: \`${info.sha}\`.\n\n` +
      "Install the attached plugin ZIP, not GitHub's source archive. " +
      "The workflow verified types, lint, formatting, regression tests and the extracted ZIP; " +
      "live playback has not been manually verified.\n\n" +
      generated;
    if (tagSHA === null) await client.createTag(info.tag, info.sha);
    draft = await client.createDraft(info, body);
  } else if (tagSHA === null) {
    await client.createTag(info.tag, info.sha);
  }
  for (const file of files) {
    // A human may have published the draft since the job started. Never clobber it.
    const current = await client.release(info.tag);
    if (!current?.draft || current.id !== draft.id) {
      throw new Error("Release is no longer the expected draft");
    }
    await ensureAsset(client, draft, file);
  }
  return draft;
}

export class GitHub implements ReleaseClient {
  private repo: string;
  private token: string;
  private send: typeof fetch;
  constructor(repo: string, token: string, send: typeof fetch = fetch) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("Invalid repository");
    this.repo = repo;
    this.token = token;
    this.send = send;
  }
  private async request<T>(
    path: string,
    method = "GET",
    body?: unknown,
    optional = false,
  ): Promise<T> {
    const response = await this.send(`https://api.github.com/repos/${this.repo}/${path}`, {
      method,
      redirect: "error",
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (optional && response.status === 404) return null as T;
    if (!response.ok) throw new Error(`GitHub ${method} ${path}: HTTP ${response.status}`);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
  async tagSHA(tag: string) {
    type GitObject = { sha: string; type: string };
    const ref = await this.request<{ object: GitObject } | null>(
      `git/ref/tags/${encodeURIComponent(tag)}`,
      "GET",
      undefined,
      true,
    );
    if (!ref) return null;
    let object = ref.object;
    for (let depth = 0; object.type === "tag" && depth < 8; depth++) {
      object = (await this.request<{ object: GitObject }>(`git/tags/${object.sha}`)).object;
    }
    if (object.type !== "commit") throw new Error("Tag does not resolve to a commit");
    return object.sha;
  }
  release(tag: string) {
    return this.request<Draft | null>(
      `releases/tags/${encodeURIComponent(tag)}`,
      "GET",
      undefined,
      true,
    );
  }
  async createTag(tag: string, sha: string) {
    await this.request("git/refs", "POST", { ref: `refs/tags/${tag}`, sha });
  }
  async notes(tag: string, sha: string) {
    const result = await this.request<{ body: string }>("releases/generate-notes", "POST", {
      tag_name: tag,
      target_commitish: sha,
    });
    return result.body;
  }
  createDraft(info: ReleaseInfo, body: string) {
    return this.request<Draft>("releases", "POST", {
      tag_name: info.tag,
      target_commitish: info.sha,
      name: info.tag,
      body,
      draft: true,
      prerelease: false,
      make_latest: "false",
    });
  }
  async assets(id: number) {
    const all: Asset[] = [];
    for (let page = 1; ; page++) {
      const assets = await this.request<Asset[]>(`releases/${id}/assets?per_page=100&page=${page}`);
      all.push(...assets);
      if (assets.length < 100) return all;
    }
  }
  async upload(id: number, file: Upload) {
    const response = await this.send(
      `https://uploads.github.com/repos/${this.repo}/releases/${id}/assets?name=${encodeURIComponent(file.name)}`,
      {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/octet-stream",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: new Uint8Array(file.bytes),
      },
    );
    if (!response.ok) throw new Error(`GitHub asset upload: HTTP ${response.status}`);
    return (await response.json()) as Asset;
  }
  async deleteAsset(id: number) {
    await this.request(`releases/assets/${id}`, "DELETE");
  }
  async renameAsset(id: number, name: string) {
    await this.request(`releases/assets/${id}`, "PATCH", { name });
  }
}

async function main() {
  const env = process.env;
  if (env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_REF !== "refs/heads/main") {
    throw new Error("Draft releases must be dispatched manually from main");
  }
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  if (sha !== env.GITHUB_SHA) throw new Error("Checkout does not match the triggering commit");
  const { info, files } = await loadRelease(resolve(root, "dist/release"), sha);
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPOSITORY)
    throw new Error("GitHub credentials are missing");
  const draft = await createDraftRelease(
    new GitHub(env.GITHUB_REPOSITORY, env.GITHUB_TOKEN),
    info,
    files,
  );
  const summary =
    `## Draft ${info.tag}\n\n${draft.html_url}\n\n` +
    `Commit: \`${sha}\`\n\nSHA-256: \`${info.digest}\`\n\n` +
    "Review the notes and attachments, then publish manually. This workflow never publishes.\n";
  console.log(summary);
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, summary);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
