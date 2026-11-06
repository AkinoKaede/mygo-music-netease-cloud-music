import { readFile } from "node:fs/promises";
import { createHash, createCipheriv, createDecipheriv, randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const source = await readFile(new URL("../index.js", import.meta.url), "utf8");
const key = /const EAPI_KEY = "([^"]+)"/.exec(source)[1];
const hash = text => createHash("md5").update(text).digest("hex");

export async function harness(handler, { signedIn = false, settings = {}, storage = {}, fastLogin = false, live = false } = {}) {
  const state = new Map(Object.entries(storage));
  if (signedIn) {
    state.set("account", { id: "7", name: "Listener" });
    state.set("cookies", { MUSIC_U: "test-session", __csrf: "test-csrf" });
  }
  const calls = [], prompts = [];
  const host = {
    storage: {
      get: k => structuredClone(state.get(k)),
      set: (k, v) => state.set(k, structuredClone(v)),
      remove: k => state.delete(k),
    },
    setting: k => settings[k] || "",
    language: () => "en",
    t: text => text,
    crypto: {
      md5: hash,
      aesEcbEncrypt: (key, text) => {
        const cipher = createCipheriv("aes-128-ecb", Buffer.from(key), null);
        return Buffer.concat([cipher.update(text), cipher.final()]).toString("hex");
      },
    },
    signInPrompt: prompt => prompts.push(prompt),
    webSignIn: async () => ({ cookie: "MUSIC_U=test-session; __csrf=test-csrf" }),
    timer: (fn, ms) => setTimeout(fn, fastLogin && ms === 2000 ? 0 : ms),
    fetch: async (address, options) => {
      if (live) return fetch(address, options);
      const url = new URL(address);
      let path = url.pathname;
      let params = Object.fromEntries(new URLSearchParams(options.body || url.search));
      if (path.startsWith("/eapi/")) {
        const decipher = createDecipheriv("aes-128-ecb", Buffer.from(key), null);
        const plain = Buffer.concat([decipher.update(Buffer.from(params.params, "hex")), decipher.final()]).toString();
        const parts = plain.split("-36cd479b6b5-");
        assert.equal(parts.length, 3);
        const [encryptedPath, text, digest] = parts;
        path = path.replace("/eapi/", "/api/");
        assert.equal(encryptedPath, path);
        assert.equal(digest, hash(`nobody${path}use${text}md5forencrypt`));
        params = JSON.parse(text);
        assert.equal(params.e_r, false);
        assert.equal(params.header.deviceId.length, 52);
      }
      const call = { path, params, options, url };
      calls.push(call);
      const result = await handler(call);
      if (result instanceof Response) return result;
      assert.notEqual(result, undefined, `Unmocked request: ${path}`);
      return Response.json({ code: 200, ...result });
    },
  };
  const globalKey = `__netease_test_${randomUUID().replaceAll("-", "")}`;
  globalThis[globalKey] = host;
  const prefix = `const host = globalThis.${globalKey}; const fetch = host.fetch; const setTimeout = host.timer;\n`;
  let plugin;
  try {
    plugin = await import(`data:text/javascript;base64,${Buffer.from(prefix + source).toString("base64")}`);
  } finally {
    delete globalThis[globalKey];
  }
  return { plugin, state, calls, prompts, settings, host };
}

export const song = (id, extra = {}) => ({
  id, name: `Song ${id}`, ar: [{ id: 10, name: "Artist" }],
  al: { id: 20, name: "Album", picUrl: "http://p.example/cover.jpg" }, dt: 123000, ...extra,
});
export function songDetails(params) {
  const ids = JSON.parse(params.c).map(t => t.id);
  return {
    songs: ids.toReversed().map(n => song(n, { fee: 1 })),
    privileges: ids.map(id => ({ id, st: 0, pl: 320000 })),
  };
}
