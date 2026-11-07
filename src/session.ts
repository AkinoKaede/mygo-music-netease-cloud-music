// SPDX-FileCopyrightText: 2026 Kaede Akino
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Account, HeartState, StorageSchema } from "./types.js";
import { fail, tr } from "./utils.js";

export const session: {
  epoch: number;
  likesRevision: number;
  likedCache: { time: number; ids: string[] } | null;
  likedPending: Promise<string[]> | null;
  heart: HeartState | null;
  loginPending: Promise<Account> | null;
} = {
  epoch: 0,
  likesRevision: 0,
  likedCache: null,
  likedPending: null,
  heart: null,
  loginPending: null,
};

export const load = <K extends keyof StorageSchema>(
  key: K,
  fallback: StorageSchema[K],
): StorageSchema[K] => (host.storage.get(key) as StorageSchema[K] | undefined) ?? fallback;

export const save = <K extends keyof StorageSchema>(key: K, value: StorageSchema[K]) =>
  host.storage.set(key, value);

export function accountNow() {
  return load("account", null);
}

export function requireAccount() {
  const me = accountNow();
  if (!me || !load("cookies", {}).MUSIC_U)
    throw fail("signIn", tr("Sign in to NetEase Cloud Music first"));
  return me;
}

export function resetSession() {
  session.epoch++;
  session.likesRevision++;
  session.likedCache = null;
  session.likedPending = null;
  session.heart = null;
  for (const key of [
    "cookies",
    "account",
    "recent",
    "lastArtists",
    "stationCovers",
    "stationFallbacks",
    "discoveryCovers",
  ])
    host.storage.remove(key);
}

export function cookieHeader(cookies = load("cookies", {})) {
  return Object.entries(cookies)
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
}

export function storeCookies(headers: Headers, generation: number) {
  if (generation !== session.epoch) return;
  const values =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : (headers.get("set-cookie") || "").split(/,(?=\s*[^;,\s]+=)/);
  const cookies = load("cookies", {});
  let changed = false;
  for (const line of values) {
    const match = /^\s*(MUSIC_U|__csrf|NMTID)=([^;]*)/.exec(line);
    if (!match) continue;
    if (!match[2] || /;\s*max-age=0(?:;|$)/i.test(line)) delete cookies[match[1]];
    else cookies[match[1]] = match[2];
    changed = true;
  }
  if (changed) save("cookies", cookies);
}
