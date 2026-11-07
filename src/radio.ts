// SPDX-FileCopyrightText: 2026 Kaede Akino
// SPDX-License-Identifier: AGPL-3.0-or-later

import { eapi } from "./api.js";
import { likedIDs, userPlaylists } from "./playlists.js";
import type { ServiceSong } from "./service-types.js";
import { load, requireAccount, save, session } from "./session.js";
import { details, hydrate } from "./tracks.js";
import type { ByID, Track } from "./types.js";
import { fail, https, tr } from "./utils.js";

export function coverURLs(urls: (string | undefined)[]) {
  return [...new Set(urls.map(https).filter((url) => url.startsWith("https://")))].slice(0, 4);
}

export function stations() {
  const covers = load("stationCovers", {});
  return [
    {
      id: "fm:DEFAULT",
      name: tr("Recommended"),
      description: tr("Music picked for your taste, one song after another"),
    },
    {
      id: "fm:FAMILIAR",
      name: tr("Familiar"),
      description: tr("Music picked for your taste, one song after another"),
    },
    {
      id: "fm:EXPLORE",
      name: tr("Explore"),
      description: tr("Music picked for your taste, one song after another"),
    },
    {
      id: "heart",
      name: tr("Heart Mode"),
      description: tr(
        "Start with the music you love\nDiscover similar music based on the songs you've liked, mixed with your favourites",
      ),
    },
  ].map((station) => ({
    ...station,
    imageUrl: covers[station.id] || "",
  }));
}

export function rememberStationCover(station: string, tracks: Track[], generation: number) {
  if (generation !== session.epoch) return;
  const [cover] = coverURLs(
    tracks.filter((track) => !track.unavailable).map((track) => track.album?.imageUrl),
  );
  if (cover) save("stationCovers", { ...load("stationCovers", {}), [station]: cover });
}

export async function stationNext({ id: station }: ByID) {
  const me = requireAccount();
  const generation = session.epoch;
  if (station === "heart") {
    let state = session.heart;
    let seed: Track | undefined;
    if (!state) {
      const p = (await userPlaylists(me.id)).find((p) => p.specialType === 5);
      if (!p) throw fail("unavailable", tr("Your liked-songs playlist was not found"));
      const ids = await likedIDs();
      if (generation !== session.epoch)
        throw new Error(tr("The account changed. Reload this page."));
      if (!ids.length) throw fail("unavailable", tr("Like a few songs before starting Heart mode"));
      const playable = (await details(ids)).filter((t) => !t.unavailable);
      if (generation !== session.epoch)
        throw new Error(tr("The account changed. Reload this page."));
      if (!playable.length)
        throw fail("unavailable", tr("Heart Mode can't start right now. Try again later."));
      seed = playable[Math.floor(Math.random() * playable.length)];
      state = { playlist: String(p.id), start: seed.id, current: seed.id };
    }
    const result = await eapi<{ data?: { songInfo: ServiceSong }[] }>(
      "/api/playmode/intelligence/list",
      {
        songId: state.current,
        startMusicId: state.start,
        playlistId: state.playlist,
        type: "fromPlayOne",
        count: 1,
      },
    );
    if (generation !== session.epoch) throw new Error(tr("The account changed. Reload this page."));
    const more = (await hydrate((result.data || []).map((x) => x.songInfo).filter(Boolean))).filter(
      (t) => !t.unavailable && t.id !== seed?.id,
    );
    if (generation !== session.epoch) throw new Error(tr("The account changed. Reload this page."));
    const tracks = seed ? [seed, ...more] : more;
    session.heart = { ...state, current: tracks.at(-1)?.id || state.current };
    rememberStationCover(station, tracks, generation);
    return tracks;
  }
  const mode = station.replace(/^fm:/, "");
  if (!["DEFAULT", "FAMILIAR", "EXPLORE"].includes(mode))
    throw fail("unavailable", tr("Unknown station"));
  const result = await eapi<{ data?: ServiceSong[] }>("/api/v1/radio/get", { mode, limit: 3 });
  if (generation !== session.epoch) throw new Error(tr("The account changed. Reload this page."));
  // The host retries empty/unplayable batches up to three times.
  const tracks = (await details((result.data || []).map((t) => t.id))).filter(
    (t) => !t.unavailable,
  );
  if (generation !== session.epoch) throw new Error(tr("The account changed. Reload this page."));
  rememberStationCover(station, tracks, generation);
  return tracks;
}
