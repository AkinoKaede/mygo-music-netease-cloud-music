// SPDX-FileCopyrightText: 2026 Kaede Akino
// SPDX-License-Identifier: AGPL-3.0-or-later

import { eapi, web } from "./api.js";
import { ARTIST_PAGE, PAGE } from "./constants.js";
import { toAlbum, toArtist, toTrack } from "./models.js";
import { show } from "./podcasts.js";
import type { ServiceAlbum, ServiceArtist, ServiceSong } from "./service-types.js";
import { load, requireAccount, save, session } from "./session.js";
import { details, hydrate } from "./tracks.js";
import type { ByID, Toggle } from "./types.js";
import { fail, id, offsetOf, tr } from "./utils.js";

export async function album({ id: aid }: ByID) {
  if (String(aid).startsWith("show:")) {
    const page = await show({ id: aid.slice(5) });
    return {
      album: { id: aid, name: page.show.name, imageUrl: page.show.imageUrl },
      tracks: page.episodes,
    };
  }
  const result = await web<{ album?: ServiceAlbum; songs?: ServiceSong[] }>(
    `/api/v1/album/${id(aid)}`,
  );
  if (!result.album) throw fail("unavailable", tr("Album not found"));
  return { album: toAlbum(result.album), tracks: await hydrate(result.songs || []) };
}

export async function artistDetail(aid: string) {
  const generation = session.epoch;
  const result = await web<{ artist?: ServiceArtist; hotSongs?: ServiceSong[] }>(
    `/api/v1/artist/${aid}`,
  );
  if (generation !== session.epoch) throw new Error(tr("The account changed. Reload this page."));
  if (String(result.artist?.id) !== aid) throw fail("unavailable", tr("Artist not found"));
  return { ...result, artist: result.artist! };
}

export async function artistAlbums(aid: string, offset = 0, limit = PAGE) {
  const generation = session.epoch;
  const result = await web<{ hotAlbums?: ServiceAlbum[]; more?: boolean }>(
    `/api/artist/albums/${aid}`,
    { limit, offset },
  );
  if (generation !== session.epoch) throw new Error(tr("The account changed. Reload this page."));
  const albums = (result.hotAlbums || []).map(toAlbum);
  return { albums, more: !!result.more && albums.length > 0 };
}

export async function allArtistAlbums(aid: string) {
  const albums = [];
  for (let offset = 0; ; offset += ARTIST_PAGE) {
    const page = await artistAlbums(aid, offset, ARTIST_PAGE);
    albums.push(...page.albums);
    if (!page.more) return albums;
  }
}

export async function artistLatest(aid: string, offset: number) {
  const generation = session.epoch;
  const result = await web<{ songs?: ServiceSong[]; more?: boolean }>(
    "/api/v1/artist/songs",
    { id: aid, order: "time", limit: ARTIST_PAGE, offset },
    "POST",
  );
  if (generation !== session.epoch) throw new Error(tr("The account changed. Reload this page."));
  const songs = result.songs || [];
  const tracks = await details(songs.map((t) => t.id));
  if (generation !== session.epoch) throw new Error(tr("The account changed. Reload this page."));
  return { tracks, more: !!result.more && songs.length > 0 };
}

export function artistBrowseHeader(a: ServiceArtist) {
  const aliases = [...new Set([a.trans, ...(a.alias || [])].map((s) => s?.trim()).filter(Boolean))];
  const meta = [
    aliases.join(" / "),
    (a.musicSize ?? 0) > 0 ? tr("{count} songs", { count: a.musicSize }) : "",
    (a.albumSize ?? 0) > 0 ? tr("{count} albums", { count: a.albumSize }) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    title: a.name,
    subtitle: tr("Artist"),
    imageUrl: toArtist(a).imageUrl,
    description: [meta, (a.briefDesc || "").trim().replace(/\r?\n/g, " ")]
      .filter(Boolean)
      .join("\n"),
  };
}

export async function artist({ id: value }: ByID) {
  const aid = id(value),
    generation = session.epoch;
  const [result, albums] = await Promise.all([artistDetail(aid), allArtistAlbums(aid)]);
  if (generation !== session.epoch) throw new Error(tr("The account changed. Reload this page."));
  const songs = result.hotSongs || [];
  let tracks;
  try {
    tracks = await hydrate(songs);
  } catch {
    tracks = songs.map((song) => toTrack(song));
  }
  if (generation !== session.epoch) throw new Error(tr("The account changed. Reload this page."));
  const a = toArtist(result.artist);
  save("lastArtists", [a, ...load("lastArtists", []).filter((x) => x.id !== a.id)].slice(0, 20));
  return { artist: a, tracks, albums };
}

export async function followArtist({ id: aid, on }: Toggle) {
  requireAccount();
  // NetEase rejects some eapi follows with -460; the original client uses web.
  await web(
    `/api/artist/${on ? "sub" : "unsub"}`,
    { artistId: id(aid), artistIds: `[${id(aid)}]` },
    "POST",
  );
}

export async function saveAlbum({ id: aid, on }: Toggle) {
  requireAccount();
  await eapi(`/api/album/${on ? "sub" : "unsub"}`, { id: id(aid) });
}

export async function savedAlbums({ offset = 0 } = {}) {
  requireAccount();
  const result = await web<{ data?: ServiceAlbum[]; hasMore?: boolean }>("/api/album/sublist", {
    limit: PAGE,
    offset: offsetOf(offset),
    total: true,
  });
  return {
    albums: (result.data || []).map((a) => ({ ...toAlbum(a), saved: true })),
    more: !!result.hasMore,
  };
}

export async function followedArtists(offset = 0) {
  requireAccount();
  const generation = session.epoch;
  const result = await web<{ data?: ServiceArtist[]; hasMore?: boolean }>("/api/artist/sublist", {
    limit: PAGE,
    offset: offsetOf(offset),
    total: true,
  });
  if (generation !== session.epoch) throw new Error(tr("The account changed. Reload this page."));
  const artists = (result.data || []).map((artist) => ({ ...toArtist(artist), following: true }));
  return { artists, more: !!result.hasMore && artists.length > 0 };
}

export async function allFollowedArtists() {
  const all = [];
  for (let offset = 0; ; offset += PAGE) {
    const result = await followedArtists(offset);
    all.push(...result.artists);
    if (!result.more) return all;
  }
}
