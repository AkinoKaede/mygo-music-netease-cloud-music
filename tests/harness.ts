// SPDX-FileCopyrightText: 2026 Kaede Akino
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type * as Plugin from "../src/index.js";
import type { ServiceSong } from "../src/service-types.js";
import type { Host, ID, StorageSchema } from "../src/types.js";
import { EAPI_KEY } from "./fixtures/protocol.ts";

export const pluginDirectory = resolve(
  process.env.PLUGIN_DIR || fileURLToPath(new URL("../dist/plugin", import.meta.url)),
);
const source = await readFile(resolve(pluginDirectory, "index.js"), "utf8");
const hash = (text: string) => createHash("md5").update(text).digest("hex");
export interface Call {
  path: string;
  params: Record<string, unknown>;
  options: RequestInit & { headers: Record<string, string> };
  url: URL;
}
type MockResponse = Record<string, unknown> | Response | undefined;
type Handler = (call: Call) => MockResponse | Promise<MockResponse>;
interface HarnessOptions {
  signedIn?: boolean;
  settings?: Record<string, string>;
  storage?: Record<string, unknown>;
  fastLogin?: boolean;
  live?: boolean;
}
class TestStorage extends Map<string, unknown> {
  get<K extends keyof StorageSchema>(key: K): StorageSchema[K] | undefined;
  get(key: string): unknown;
  get(key: string) {
    return super.get(key);
  }
}
export async function harness(
  handler: Handler,
  {
    signedIn = false,
    settings = {},
    storage = {},
    fastLogin = false,
    live = false,
  }: HarnessOptions = {},
) {
  const state = new TestStorage(Object.entries(storage));
  if (signedIn) {
    state.set("account", { id: "7", name: "Listener" });
    state.set("cookies", { MUSIC_U: "test-session", __csrf: "test-csrf" });
  }
  const calls: Call[] = [],
    prompts: Parameters<Host["signInPrompt"]>[0][] = [];
  const host = {
    storage: {
      get: (k: string) => structuredClone(state.get(k)),
      set: (k: string, v: unknown) => {
        state.set(k, structuredClone(v));
      },
      remove: (k: string) => {
        state.delete(k);
      },
    },
    setting: (k: string) => settings[k] || "",
    language: () => "en",
    t: (text: string) => text,
    crypto: {
      md5: hash,
      aesEcbEncrypt: (key: string, text: string) => {
        const cipher = createCipheriv("aes-128-ecb", Buffer.from(key), null);
        return Buffer.concat([cipher.update(text), cipher.final()]).toString("hex");
      },
    },
    signInPrompt: (prompt: Parameters<Host["signInPrompt"]>[0]) => {
      prompts.push(prompt);
    },
    webSignIn: async () => ({ cookie: "MUSIC_U=test-session; __csrf=test-csrf" }),
    timer: (fn: () => void, ms: number) => setTimeout(fn, fastLogin && ms === 2000 ? 0 : ms),
    fetch: async (address: string, options: Call["options"]) => {
      if (live) return fetch(address, options);
      const url = new URL(address);
      let path = url.pathname;
      let params: Record<string, unknown> = Object.fromEntries(
        new URLSearchParams(String(options.body || url.search)),
      );
      if (path.startsWith("/eapi/")) {
        const decipher = createDecipheriv("aes-128-ecb", Buffer.from(EAPI_KEY), null);
        const plain = Buffer.concat([
          decipher.update(Buffer.from(String(params.params), "hex")),
          decipher.final(),
        ]).toString();
        const parts = plain.split("-36cd479b6b5-");
        assert.equal(parts.length, 3);
        const [encryptedPath, text, digest] = parts;
        path = path.replace("/eapi/", "/api/");
        assert.equal(encryptedPath, path);
        assert.equal(digest, hash(`nobody${path}use${text}md5forencrypt`));
        params = JSON.parse(text) as Record<string, unknown>;
        assert.equal(params.e_r, false);
        assert.equal((params.header as { deviceId: string }).deviceId.length, 52);
      }
      const call = { path, params, options, url };
      calls.push(call);
      const result = await handler(call);
      if (result instanceof Response) return result;
      assert.notEqual(result, undefined, `Unmocked request: ${path}`);
      return Response.json({ code: 200, ...result });
    },
  } satisfies Host & { timer: unknown; fetch: unknown };
  const globalKey = `__netease_test_${randomUUID().replaceAll("-", "")}`;
  const globals = globalThis as unknown as Record<string, unknown>;
  globals[globalKey] = host;
  const prefix = `const host = globalThis.${globalKey}; const fetch = host.fetch; const setTimeout = host.timer;\n`;
  let plugin: typeof Plugin;
  try {
    plugin = (await import(
      `data:text/javascript;base64,${Buffer.from(prefix + source + "\n//# sourceURL=netease-plugin-test.js").toString("base64")}`
    )) as typeof Plugin;
  } finally {
    delete globals[globalKey];
  }
  return { plugin, state, calls, prompts, settings, host };
}

export const song = (id: ID, extra: Partial<ServiceSong> = {}): ServiceSong => ({
  id,
  name: `Song ${id}`,
  ar: [{ id: 10, name: "Artist" }],
  al: { id: 20, name: "Album", picUrl: "http://p.example/cover.jpg" },
  dt: 123000,
  ...extra,
});
export function songDetails(params: Record<string, unknown>) {
  const ids = (JSON.parse(String(params.c)) as { id: number }[]).map((t) => t.id);
  return {
    songs: ids.toReversed().map((n) => song(n, { fee: 1 })),
    privileges: ids.map((id) => ({ id, st: 0, pl: 320000 })),
  };
}

export function present<T>(value: T): NonNullable<T> {
  assert.ok(value !== undefined && value !== null, "Expected fixture value to exist");
  return value;
}
