// SPDX-FileCopyrightText: 2026 Kaede Akino
// SPDX-License-Identifier: AGPL-3.0-or-later

import { eapi, retry, web } from "./api.js";
import { LEVELS, SITE, UA } from "./constants.js";
import { trackIdentity } from "./models.js";
import type { ServiceLyrics, ServiceStream } from "./service-types.js";
import type { ByID, LyricLine, LyricWord } from "./types.js";
import { fail, https, transient, tr } from "./utils.js";

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

// NetEase's v1 endpoint refuses a request now and then with -460, "the network
// environment looks risky". That is a risk check on the request, not the song:
// the same song answers on the next one, and the older endpoint, which takes a
// bitrate instead of a level, is not covered by it. Ask again, a little later,
// and keep the older endpoint as the last resort, so a refusal no longer costs
// the listener the song.
const BITRATES: Record<string, number> = {
  standard: 128000,
  higher: 192000,
  exhigh: 320000,
  lossless: 999000,
  hires: 999000,
};

async function serviceStream(audio: string, level: string) {
  const encodeType = ["lossless", "hires"].includes(level) ? "flac" : "mp3";
  try {
    const result = await retry(
      () =>
        eapi<{ data?: ServiceStream[] }>("/api/song/enhance/player/url/v1", {
          ids: `[${audio}]`,
          level,
          encodeType,
        }),
      3,
      `stream ${audio}`,
    );
    return { endpoint: "v1", result };
  } catch (error) {
    if (!transient(error)) throw error;
    const result = await retry(
      () =>
        eapi<{ data?: ServiceStream[] }>("/api/song/enhance/player/url", {
          ids: `[${audio}]`,
          br: BITRATES[level] || 320000,
        }),
      2,
      `stream ${audio} (older endpoint)`,
    );
    return { endpoint: "older", result };
  }
}

export async function stream({ id: value, quality = "standard" }: ByID & { quality?: string }) {
  const identity = trackIdentity(value);
  const level = host.setting("quality") || (quality === "high" ? "exhigh" : quality);
  if (!LEVELS.includes(level)) throw fail("setup", tr("Invalid quality setting"));
  const { endpoint, result } = await serviceStream(identity.audio, level);
  const item = (result.data || []).find((t) => String(t.id) === identity.audio) || result.data?.[0];
  if (!item?.url || item.freeTrialInfo != null) {
    console.log(
      `stream ${identity.audio} via ${endpoint}: no full stream (id ${item?.id ?? "none"}, ` +
        `url ${Boolean(item?.url)}, trial ${item?.freeTrialInfo != null}, ` +
        `level ${item?.level || "?"})`,
    );
    throw fail(
      "unavailable",
      tr("Full playback is unavailable. A subscription or purchase may be required."),
    );
  }
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
