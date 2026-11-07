// SPDX-FileCopyrightText: 2026 Kaede Akino
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { format, resolveConfig } from "prettier";
import { readMetadata, root, validateVersion } from "./metadata.ts";

export async function setVersion(version: string, directory = root) {
  validateVersion(version);
  const { pkg } = await readMetadata(directory);
  const previous = pkg.version.split(".").map(BigInt);
  const next = version.split(".").map(BigInt);
  const difference = next.map((part, i) => part - previous[i]).find((part) => part !== 0n);
  if (difference === undefined || difference < 0n) throw new Error("Version must increase");
  const paths = ["package.json", "plugin.json"].map((name) => resolve(directory, name));
  const originals = await Promise.all(paths.map((path) => readFile(path, "utf8")));
  try {
    for (const [i, path] of paths.entries()) {
      const document = JSON.parse(originals[i]) as { version: string };
      document.version = version;
      const options = await resolveConfig(root + "/package.json");
      await writeFile(path, await format(JSON.stringify(document), { ...options, parser: "json" }));
    }
  } catch (error) {
    await Promise.all(paths.map((path, i) => writeFile(path, originals[i])));
    throw error;
  }
  // pnpm's importer records dependency specifiers, not the root package version.
  console.log(`Version set to ${version}; review and commit both manifest changes.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await setVersion(process.argv[2]);
}
