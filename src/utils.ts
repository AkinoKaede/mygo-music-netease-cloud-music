// SPDX-FileCopyrightText: 2026 Kaede Akino
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ApiStatus } from "./service-types.js";
import type { Params } from "./types.js";

// Translate the template before inserting service content; replacements are not re-parsed.
export function tr(text: string, values?: Record<string, unknown>) {
  const translated = host.t(text);
  if (!values) return translated;
  return translated.replace(/\{(\w+)\}/g, (token, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : token,
  );
}

export function fail(code: string, message: string) {
  const error = Object.assign(new Error(message), { code });
  return error;
}

export function check<T extends ApiStatus>(data: T, path: string, allowed = [200]): T {
  if (!allowed.includes(Number(data?.code))) {
    const code = Number(data?.code);
    throw fail(
      code === 301 || code === 302 || code === 401 ? "signIn" : "",
      tr("NetEase {path}: {message} ({code})", {
        path,
        message: data?.message || data?.msg || tr("Request failed"),
        code,
      }),
    );
  }
  return data;
}

export function id(value: unknown) {
  const text = String(value);
  if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text))) {
    throw fail("unavailable", tr("Invalid NetEase ID"));
  }
  return text;
}

export function offsetOf(value = 0) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(tr("Invalid page offset"));
  return value;
}

export function https(value = "") {
  return String(value || "").replace(/^http:\/\//, "https://");
}

// Pictures on the image CDN come at the size MyGo Music shows them: it fills in
// {size} (0.1.20 and later) for each place, instead of fetching and decoding a
// cover thousands of pixels across for a 40-pixel row.
export function picture(value = "") {
  const url = https(value);
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!/(^|\.)music\.126\.net$/.test(parsed.hostname)) return url;
  parsed.searchParams.delete("param");
  const query = parsed.search ? `${parsed.search.slice(1)}&` : "";
  return `${parsed.origin}${parsed.pathname}?${query}param={size}y{size}`;
}

export function date(value?: number) {
  return value !== undefined && value > 0 ? new Date(value).toISOString().slice(0, 10) : "";
}

export function route(page: string, params: Params = {}) {
  const query = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)]),
  ).toString();
  return page + (query ? `?${query}` : "");
}

export function nextSection(page: string, params: Params, more: unknown) {
  return more ? [{ links: [{ title: tr("Next Page"), page: route(page, params) }] }] : [];
}

export let retryID = 0;

export function retrySection(title: string, page: string, error: unknown) {
  // Browse pages are cached by their full route; retry must request a fresh one.
  const target = `${page}${page.includes("?") ? "&" : "?"}retry=${++retryID}`;
  return {
    title,
    links: [
      {
        title: tr("Retry"),
        subtitle: error instanceof Error ? error.message : String(error),
        page: target,
      },
    ],
  };
}
