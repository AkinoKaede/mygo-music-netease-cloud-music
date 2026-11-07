// SPDX-FileCopyrightText: 2026 Kaede Akino
// SPDX-License-Identifier: AGPL-3.0-or-later

import { unzipSync, zipSync, type Zippable } from "fflate";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildPlugin } from "./build.ts";
import { pluginFiles, readMetadata, releaseNames, root } from "./metadata.ts";

export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export async function archivePlugin(directory: string) {
  const files: Zippable = {};
  for (const name of pluginFiles) {
    files[name] = [
      await readFile(resolve(directory, name)),
      {
        mtime: new Date(1980, 0, 1),
        os: 3,
        attrs: 0o100644 << 16,
      },
    ];
  }
  return zipSync(files, { level: 9 });
}
export function verifyArchive(bytes: Uint8Array, expectedManifest: unknown) {
  const files = unzipSync(bytes);
  if (JSON.stringify(Object.keys(files).sort()) !== JSON.stringify([...pluginFiles].sort())) {
    throw new Error("Unexpected files in the plugin ZIP");
  }
  const manifest: unknown = JSON.parse(Buffer.from(files["plugin.json"]).toString());
  if (JSON.stringify(manifest) !== JSON.stringify(expectedManifest)) {
    throw new Error("Packaged manifest differs from the source manifest");
  }
  JSON.parse(Buffer.from(files["locales/zh-CN.json"]).toString());
  return files;
}
export async function packagePlugin() {
  const { pkg, manifest } = await readMetadata();
  const output = resolve(root, "dist/release");
  await rm(output, { recursive: true, force: true });
  const directory = await buildPlugin();
  const bytes = await archivePlugin(directory);
  await buildPlugin();
  if (sha256(bytes) !== sha256(await archivePlugin(directory))) {
    throw new Error("Two builds produced different ZIP bytes");
  }
  const files = verifyArchive(bytes, manifest);
  const extracted = await mkdtemp(resolve(tmpdir(), "mygo-plugin-test-"));
  try {
    for (const [name, contents] of Object.entries(files)) {
      const path = resolve(extracted, name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, contents);
    }
    const tests = (await readdir(resolve(root, "tests")))
      .filter((name) => name.endsWith(".test.ts"))
      .sort()
      .map((name) => resolve(root, "tests", name));
    execFileSync(process.execPath, ["--import", "tsx", "--test", ...tests], {
      cwd: root,
      env: { ...process.env, PLUGIN_DIR: extracted },
      stdio: "inherit",
    });
  } finally {
    await rm(extracted, { recursive: true, force: true });
  }
  const names = releaseNames(pkg);
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, names.zip), bytes);
  await writeFile(resolve(output, names.checksum), `${sha256(bytes)}  ${names.zip}\n`);
  console.log(`Verified ${names.zip}: ${sha256(bytes)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await packagePlugin();
}
