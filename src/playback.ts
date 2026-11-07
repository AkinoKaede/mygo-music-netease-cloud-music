// SPDX-FileCopyrightText: 2026 Kaede Akino
// SPDX-License-Identifier: AGPL-3.0-or-later

import { eapi, web } from "./api.js";
import { LEVELS, SITE, UA } from "./constants.js";
import { trackIdentity } from "./models.js";
import type { ServiceLyrics, ServiceStream } from "./service-types.js";
import type { ByID, LyricLine, LyricWord } from "./types.js";
import { fail, https, tr } from "./utils.js";

export function timedTranslations(text: string) {
  const out = [];
  let offset = 0;
  const offsetMatch = /\[offset:([+-]?\d+)\]/i.exec(text);
  if (offsetMatch) offset = Number(offsetMatch[1]);
  for (const raw of text.split(/\r?\n/)) {
    const tags = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    const words = raw.replace(/\[[^\]]*\]/g, "").trim();
    if (!words) continue;
    for (const tag of tags)
      out.push({
        start: Math.round(Number(tag[1]) * 60000 + Number(tag[2]) * 1000) + offset,
        text: words,
      });
  }
  return out;
}

export function parseYRC(text: string, translation: string) {
  const lines: LyricLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const timing = /^\[(\d+),(\d+)\]/.exec(raw);
    if (!timing) continue;
    const words: LyricWord[] = [];
    for (const m of raw
      .slice(timing[0].length)
      .matchAll(/\((\d+),(\d+),\d+\)(.*?)(?=\(\d+,\d+,\d+\)|$)/g)) {
      if (!m[3].trim()) {
        if (words.length) words[words.length - 1].text += m[3];
      } else words.push({ start: Number(m[1]), end: Number(m[1]) + Number(m[2]), text: m[3] });
    }
    const lyric = words
      .map((w) => w.text)
      .join("")
      .trim();
    if (lyric)
      lines.push({
        start: Number(timing[1]),
        end: Number(timing[1]) + Number(timing[2]),
        text: lyric,
        words,
      });
  }
  lines.sort((a, b) => a.start - b.start);
  for (const t of timedTranslations(translation)) {
    let best = null,
      gap = 1500;
    for (const line of lines) {
      const distance = Math.abs(line.start - t.start);
      if (distance < gap) {
        best = line;
        gap = distance;
      }
    }
    if (best && !best.translation) best.translation = t.text;
  }
  return lines;
}

export async function lyrics({ id: value }: ByID) {
  const identity = trackIdentity(value);
  if (identity.program) return { lrc: "" };
  const base = await web<ServiceLyrics>("/api/song/lyric", { id: identity.audio, lv: 1, tv: -1 });
  let words: ServiceLyrics = {};
  try {
    words = await eapi<ServiceLyrics>("/api/song/lyric/v1", {
      id: identity.audio,
      cp: false,
      tv: 0,
      lv: 0,
      rv: 0,
      kv: 0,
      yv: 0,
      ytv: 0,
      yrv: 0,
    });
  } catch {
    /* Plain LRC remains usable when word timings are unavailable. */
  }
  const lrc = base.lrc?.lyric || "";
  const translation = words.ytlrc?.lyric || base.tlyric?.lyric || "";
  const lines = parseYRC(words.yrc?.lyric || "", translation);
  return lines.length ? { lrc, translation, lines } : { lrc, translation };
}

export async function stream({ id: value, quality = "standard" }: ByID & { quality?: string }) {
  const identity = trackIdentity(value);
  const level = host.setting("quality") || (quality === "high" ? "exhigh" : quality);
  if (!LEVELS.includes(level)) throw fail("setup", tr("Invalid quality setting"));
  const result = await eapi<{ data?: ServiceStream[] }>("/api/song/enhance/player/url/v1", {
    ids: `[${identity.audio}]`,
    level,
    encodeType: ["lossless", "hires"].includes(level) ? "flac" : "mp3",
  });
  const item = (result.data || []).find((t) => String(t.id) === identity.audio) || result.data?.[0];
  if (!item?.url || item.freeTrialInfo != null)
    throw fail(
      "unavailable",
      tr("Full playback is unavailable. A subscription or purchase may be required."),
    );
  const type = (
    item.type || (["lossless", "hires"].includes(item.level ?? "") ? "flac" : "mp3")
  ).toLowerCase();
  if (!["mp3", "flac", "ogg", "wav", "m4a", "aac"].includes(type))
    throw fail("unsupported", tr("Unsupported audio format: {type}", { type }));
  const url = new URL(https(item.url));
  if (url.protocol !== "https:")
    throw fail("unavailable", tr("The audio URL is not a secure network address"));
  return {
    url: url.href,
    type,
    quality: item.level || level,
    bitRate: item.br || 0,
    size: item.size || 0,
    gain: Number(item.gain) || 0,
    peak: Number(item.peak) || 0,
    headers: { "User-Agent": UA, Referer: `${SITE}/` },
  };
}
