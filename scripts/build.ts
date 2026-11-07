// SPDX-FileCopyrightText: 2026 Kaede Akino
// SPDX-License-Identifier: AGPL-3.0-or-later

import { build } from "esbuild";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { pluginFiles, readMetadata, root } from "./metadata.ts";

export async function buildPlugin() {
  const { manifest } = await readMetadata();
  const directory = resolve(root, "dist/plugin");
  await rm(directory, { recursive: true, force: true });
  await mkdir(resolve(directory, "locales"), { recursive: true });
  const result = await build({
    absWorkingDir: root,
    entryPoints: ["src/index.ts"],
    outfile: "dist/plugin/index.js",
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    minify: false,
    splitting: false,
    sourcemap: false,
    metafile: true,
    legalComments: "inline",
    banner: {
      js: "// SPDX-FileCopyrightText: 2026 Kaede Akino\n// SPDX-License-Identifier: AGPL-3.0-or-later",
    },
  });
  const outputs = Object.values(result.metafile.outputs);
  if (outputs.length !== 1 || outputs[0].imports.length !== 0) {
    throw new Error("The plugin must be a single self-contained JavaScript module");
  }
  const expected: string[] = JSON.parse(
    await readFile(resolve(root, "tests/fixtures/exports.json"), "utf8"),
  );
  if (JSON.stringify([...outputs[0].exports].sort()) !== JSON.stringify(expected)) {
    throw new Error("Plugin exports differ from the public API contract");
  }
  for (const file of pluginFiles) {
    if (file !== manifest.main) await copyFile(resolve(root, file), resolve(directory, file));
  }
  await writeFile(
    resolve(root, "dist/metafile.json"),
    JSON.stringify(result.metafile, null, 2) + "\n",
  );
  return directory;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await buildPlugin();
}
