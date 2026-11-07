// SPDX-FileCopyrightText: 2026 Kaede Akino
// SPDX-License-Identifier: AGPL-3.0-or-later

import { EAPI, EAPI_KEY, EAPI_UA, SITE, UA } from "./constants.js";
import type { ApiStatus } from "./service-types.js";
import { cookieHeader, load, save, session, storeCookies } from "./session.js";
import type { Params } from "./types.js";
import { check, tr } from "./utils.js";

export async function request<T extends ApiStatus>(
  url: string,
  options: RequestInit,
  generation = session.epoch,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, redirect: "error" });
    if (!response.ok)
      throw new Error(tr("NetEase request failed (HTTP {status})", { status: response.status }));
    const result = (await response.json()) as T;
    storeCookies(response.headers, generation);
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

export async function web<T = object>(
  path: string,
  data: Params = {},
  method = "GET",
  options: { cookie?: string; generation?: number } = {},
) {
  const params = new URLSearchParams(Object.entries(data).map(([k, v]) => [k, String(v)]));
  const csrf = load("cookies", {}).__csrf;
  if (csrf && method === "POST") params.set("csrf_token", csrf);
  const query = params.toString();
  const result = await request<ApiStatus & T>(
    SITE + path + (method === "GET" && query ? `?${query}` : ""),
    {
      method,
      headers: {
        "User-Agent": UA,
        Referer: `${SITE}/`,
        Cookie: options.cookie ?? cookieHeader(),
        ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      ...(method === "POST" ? { body: query } : {}),
    },
    options.generation ?? session.epoch,
  );
  return check(result, path);
}

export function deviceID() {
  let device = load("device", "");
  if (!device) {
    // This is a stable client identifier, not a credential.
    device = Array.from({ length: 52 }, () => Math.floor(Math.random() * 16).toString(16))
      .join("")
      .toUpperCase();
    save("device", device);
  }
  return device;
}

export async function eapi<T = object>(path: string, data: Params = {}, allowed = [200]) {
  const cookies = load("cookies", {});
  const header: Record<string, string> = {
    osver: "Microsoft-Windows-10-Professional-build-19045-64bit",
    deviceId: deviceID(),
    os: "pc",
    appver: "3.1.17.204416",
    versioncode: "140",
    mobilename: "",
    buildver: String(Math.floor(Date.now() / 1000)),
    resolution: "1920x1080",
    channel: "netease",
    requestId: `${Date.now()}_${String(Math.floor(Math.random() * 1000)).padStart(4, "0")}`,
    __csrf: cookies.__csrf || "",
  };
  for (const key of ["MUSIC_U", "NMTID"]) if (cookies[key]) header[key] = cookies[key];
  const text = JSON.stringify({ ...data, header, e_r: false });
  const digest = host.crypto.md5(`nobody${path}use${text}md5forencrypt`);
  const plain = `${path}-36cd479b6b5-${text}-36cd479b6b5-${digest}`;
  const params = host.crypto.aesEcbEncrypt(EAPI_KEY, plain).toUpperCase();
  const result = await request<ApiStatus & T>(EAPI + path.replace(/^\/api\//, "/eapi/"), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": EAPI_UA,
      Cookie: Object.entries(header)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("; "),
    },
    body: new URLSearchParams({ params }).toString(),
  });
  return check(result, path, allowed);
}
