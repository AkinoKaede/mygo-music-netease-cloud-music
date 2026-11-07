// SPDX-FileCopyrightText: 2026 Kaede Akino
// SPDX-License-Identifier: AGPL-3.0-or-later

import { eapi, web } from "./api.js";
import { toEpisode, trackIdentity } from "./models.js";
import type { ServiceProgram, ServiceSong } from "./service-types.js";
import { accountNow, load, save, session } from "./session.js";
import { details, hydrate } from "./tracks.js";
import type { ByID, Track } from "./types.js";
import { tr } from "./utils.js";

export async function recent() {
  return recentTracks(100);
}

export async function recentTracks(limit: number) {
  const generation = session.epoch;
  const local = load("recent", []).slice(0, limit);
  if (!accountNow()) return local;
  const result = await eapi<{ data?: { list?: { data: ServiceSong }[] } }>(
    "/api/play-record/song/list",
    { limit },
  );
  if (generation !== session.epoch) throw new Error(tr("The account changed. Reload this page."));
  const remote = await hydrate((result.data?.list || []).slice(0, limit).map((row) => row.data));
  if (generation !== session.epoch) throw new Error(tr("The account changed. Reload this page."));
  return [...local, ...remote]
    .filter((t, i, all) => all.findIndex((x) => x.id === t.id) === i)
    .slice(0, limit);
}

export async function played({ id: value }: ByID) {
  const generation = session.epoch;
  const identity = trackIdentity(value);
  let track;
  if (identity.program) {
    const result = await web<{ program?: ServiceProgram }>("/api/dj/program/detail", {
      id: identity.program,
    });
    if (result.program?.radio && result.program?.mainSong)
      track = toEpisode(result.program, result.program.radio);
  } else {
    [track] = await details([value]);
  }
  if (generation === session.epoch && track) rememberTrack(track);
}

export function rememberTrack(track: Track) {
  save("recent", [track, ...load("recent", []).filter((t) => t.id !== track.id)].slice(0, 100));
}
