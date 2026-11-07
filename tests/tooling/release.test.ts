// SPDX-FileCopyrightText: 2026 Kaede Akino
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  createDraftRelease,
  GitHub,
  loadRelease,
  validateReleaseInfo,
  type Asset,
  type Draft,
  type ReleaseClient,
  type ReleaseInfo,
  type Upload,
} from "../../scripts/release.ts";
import { readMetadata, releaseNames } from "../../scripts/metadata.ts";

const { pkg, manifest } = await readMetadata();
const bytes = Buffer.from("verified fixture archive");
const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const info: ReleaseInfo = {
  ...releaseNames(pkg),
  version: pkg.version,
  minAppVersion: manifest.minAppVersion,
  sha: "a".repeat(40),
  digest: hash(bytes),
};
const files: Upload[] = [
  { name: info.zip, bytes },
  { name: info.checksum, bytes: Buffer.from(`${info.digest}  ${info.zip}\n`) },
];

class MemoryGitHub implements ReleaseClient {
  tag: string | null = null;
  draft: Draft | null = null;
  body = "Human-written notes";
  uploaded: Asset[] = [];
  events: string[] = [];
  failUpload = false;
  failRename = false;
  nextID = 1;
  async tagSHA() {
    return this.tag;
  }
  async release() {
    return this.draft;
  }
  async createTag(_tag: string, sha: string) {
    this.events.push("tag");
    this.tag = sha;
  }
  async notes() {
    this.events.push("notes");
    return "Generated changes";
  }
  async createDraft(data: ReleaseInfo, body: string) {
    this.events.push("draft");
    this.body = body;
    return (this.draft = {
      id: 1,
      draft: true,
      target_commitish: data.sha,
      html_url: "https://example.test/draft",
    });
  }
  async assets() {
    return this.uploaded;
  }
  async upload(_id: number, file: Upload) {
    this.events.push("upload");
    if (this.failUpload) throw new Error("upload failed");
    const asset = {
      id: this.nextID++,
      name: file.name,
      size: file.bytes.length,
      digest: `sha256:${hash(file.bytes)}`,
    };
    this.uploaded.push(asset);
    return asset;
  }
  async deleteAsset(id: number) {
    this.events.push("delete");
    this.uploaded = this.uploaded.filter((asset) => asset.id !== id);
  }
  async renameAsset(id: number, name: string) {
    this.events.push("rename");
    if (this.failRename) throw new Error("rename failed");
    const asset = this.uploaded.find((asset) => asset.id === id);
    assert.ok(asset);
    asset.name = name;
  }
}
test("draft release targets the exact commit and attaches both verified files", async () => {
  const client = new MemoryGitHub();
  const draft = await createDraftRelease(client, info, files);
  assert.equal(draft.draft, true);
  assert.equal(draft.target_commitish, info.sha);
  assert.equal(client.tag, info.sha);
  assert.deepEqual(
    client.uploaded.map((file) => file.name),
    files.map((file) => file.name),
  );
  assert.match(client.body, /Generated changes/);
  assert.ok(client.body.includes(info.minAppVersion));
});
test("published releases and mismatched tags or drafts cause no writes", async () => {
  for (const mode of ["published", "tag-conflict", "draft-conflict"]) {
    const client = new MemoryGitHub();
    if (mode === "tag-conflict") client.tag = "b".repeat(40);
    else
      client.draft = {
        id: 1,
        draft: mode !== "published",
        target_commitish: mode === "draft-conflict" ? "b".repeat(40) : info.sha,
        html_url: "",
      };
    await assert.rejects(createDraftRelease(client, info, files));
    assert.deepEqual(client.events, []);
  }
});
test("rerunning a same-commit draft preserves manual notes and identical attachments", async () => {
  const client = new MemoryGitHub();
  await createDraftRelease(client, info, files);
  client.body = "Reviewed by the maintainer";
  client.events = [];
  await createDraftRelease(client, info, files);
  assert.equal(client.body, "Reviewed by the maintainer");
  assert.deepEqual(client.events, []);
});
test("failed uploads keep the existing asset and a rerun repairs the draft", async () => {
  const client = new MemoryGitHub();
  await createDraftRelease(client, info, files);
  const originalID = client.uploaded[0].id;
  client.uploaded[0].digest = `sha256:${"b".repeat(64)}`;
  client.failUpload = true;
  await assert.rejects(createDraftRelease(client, info, files), /upload failed/);
  assert.ok(client.uploaded.some((asset) => asset.id === originalID));
  assert.equal(client.draft?.draft, true);
  client.failUpload = false;
  await createDraftRelease(client, info, files);
  assert.equal(client.uploaded.length, 2);
  assert.equal(
    client.uploaded.find((asset) => asset.name === info.zip)?.digest,
    `sha256:${info.digest}`,
  );
});
test("a staged upload survives rename failure and can be finalized without reuploading", async () => {
  const client = new MemoryGitHub();
  client.failRename = true;
  await assert.rejects(createDraftRelease(client, info, files), /rename failed/);
  client.failRename = false;
  client.events = [];
  await createDraftRelease(client, info, files);
  assert.equal(client.events.filter((event) => event === "upload").length, 1);
  assert.deepEqual(
    client.uploaded.map((asset) => asset.name),
    files.map((file) => file.name),
  );
});
test("a release published during the job is never uploaded to", async () => {
  const client = new MemoryGitHub();
  await createDraftRelease(client, info, files);
  let reads = 0;
  client.release = async () => {
    if (++reads > 1 && client.draft) client.draft.draft = false;
    return client.draft;
  };
  client.events = [];
  await assert.rejects(createDraftRelease(client, info, files), /no longer/);
  assert.deepEqual(client.events, []);
});
test("release metadata rejects wrong versions, commits, names and digests", () => {
  validateReleaseInfo(info, pkg, manifest, info.sha);
  for (const change of [
    { version: "invalid" },
    { minAppVersion: "invalid" },
    { tag: "other" },
    { sha: "b".repeat(40) },
    { zip: "../payload.zip" },
    { checksum: "other" },
    { digest: "bad" },
  ])
    assert.throws(() => validateReleaseInfo({ ...info, ...change }, pkg, manifest, info.sha));
});
test("release input verifies file names, artifact checksums and triggering commit", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "mygo-release-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(resolve(directory, "release.json"), JSON.stringify(info));
  for (const file of files) await writeFile(resolve(directory, file.name), file.bytes);
  assert.equal((await loadRelease(directory, info.sha)).info.sha, info.sha);
  await assert.rejects(loadRelease(directory, "b".repeat(40)), /triggering commit/);
  await writeFile(resolve(directory, info.zip), "tampered");
  await assert.rejects(loadRelease(directory, info.sha), /checksum mismatch/);
  await writeFile(resolve(directory, "extra.zip"), bytes);
  await assert.rejects(loadRelease(directory, info.sha), /Unexpected/);
});
test("GitHub adapter creates drafts only and resolves annotated tags", async () => {
  const requests: { url: string; options?: RequestInit }[] = [];
  const client = new GitHub("owner/repo", "test-token", async (address, options) => {
    const url = String(address);
    requests.push({ url, options });
    if (url.includes("/git/ref/"))
      return Response.json({ object: { sha: "c".repeat(40), type: "tag" } });
    if (url.includes("/git/tags/"))
      return Response.json({ object: { sha: info.sha, type: "commit" } });
    return Response.json({ id: 1, draft: true });
  });
  assert.equal(await client.tagSHA(info.tag), info.sha);
  await client.createDraft(info, "notes");
  const body = JSON.parse(String(requests.at(-1)?.options?.body)) as Record<string, unknown>;
  assert.equal(body.draft, true);
  assert.equal(body.prerelease, false);
  assert.equal(body.make_latest, "false");
  assert.equal(body.target_commitish, info.sha);
  assert.ok(requests.every((request) => request.options?.redirect === "error"));
});
test("GitHub transport errors are not mistaken for missing releases", async () => {
  const missing = new GitHub(
    "owner/repo",
    "token",
    async () => new Response(null, { status: 404 }),
  );
  assert.equal(await missing.release(info.tag), null);
  const denied = new GitHub("owner/repo", "token", async () => new Response(null, { status: 403 }));
  await assert.rejects(denied.release(info.tag), /HTTP 403/);
});
