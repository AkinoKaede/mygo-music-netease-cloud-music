// SPDX-FileCopyrightText: 2026 Kaede Akino
// SPDX-License-Identifier: AGPL-3.0-or-later

import { web } from "./api.js";
import { PAGE } from "./constants.js";
import { toAlbum, toArtist, toPlaylist, toShow } from "./models.js";
import type { SearchData } from "./service-types.js";
import { save } from "./session.js";
import { hydrate } from "./tracks.js";
import type { Album, Artist, Playlist, Show, Track } from "./types.js";
import { fail, offsetOf, tr } from "./utils.js";

type SearchItems = {
  tracks: Track;
  albums: Album;
  artists: Artist;
  playlists: Playlist;
  shows: Show;
};
type SearchKind = keyof SearchItems;
type SearchOptions<K extends SearchKind> = { query: string; kind?: K; offset?: number };
type SearchResult<K extends SearchKind> = { [P in K]: SearchItems[P][] } & { more: boolean };
const SEARCH = {
  tracks: { type: 1, count: "songCount" },
  albums: { type: 10, count: "albumCount" },
  artists: { type: 100, count: "artistCount" },
  playlists: { type: 1000, count: "playlistCount" },
  shows: { type: 1009, count: "djRadiosCount" },
} as const;
function resultPage<K extends SearchKind>(kind: K, items: SearchItems[K][], more: boolean) {
  return { [kind]: items, more } as SearchResult<K>;
}
export function search<K extends SearchKind = "tracks">(
  options: SearchOptions<K>,
): Promise<SearchResult<K>>;
export async function search({
  query,
  kind = "tracks",
  offset = 0,
}: SearchOptions<SearchKind>): Promise<
  { more: boolean } & Partial<{ [K in SearchKind]: SearchItems[K][] }>
> {
  const shape = SEARCH[kind];
  if (!shape) throw fail("unsupported", tr("This search type is not supported."));
  offsetOf(offset);
  query = query.trim();
  if (!query) return resultPage(kind, [], false);
  const result =
    (
      await web<{ result?: SearchData }>("/api/cloudsearch/pc", {
        s: query,
        type: shape.type,
        limit: PAGE,
        offset,
        total: true,
      })
    ).result || {};
  const more = (length: number) => length > 0 && offset + length < (result[shape.count] || 0);
  switch (kind) {
    case "tracks": {
      const songs = result.songs || [];
      return resultPage(kind, await hydrate(songs), more(songs.length));
    }
    case "artists": {
      const items = (result.artists || []).map(toArtist);
      if (offset === 0) save("lastArtists", items.slice(0, 20));
      return resultPage(kind, items, more(items.length));
    }
    case "albums": {
      const items = (result.albums || []).map(toAlbum);
      return resultPage(kind, items, more(items.length));
    }
    case "playlists": {
      const items = (result.playlists || []).map(toPlaylist);
      return resultPage(kind, items, more(items.length));
    }
    case "shows": {
      const items = (result.djRadios || []).map(toShow);
      return resultPage(kind, items, more(items.length));
    }
  }
}
export async function suggest({ query }: { query: string }) {
  if (!query.trim()) return [];
  const result =
    (
      await web<{
        result?: {
          order?: string[];
          [key: string]: { name: string }[] | string[] | undefined;
        };
      }>("/api/search/suggest/web", { s: query })
    ).result || {};
  return [
    ...new Set(
      (result.order || ["songs", "artists", "albums", "playlists"])
        .flatMap((key) => ((result[key] || []) as { name: string }[]).map((item) => item.name))
        .filter(Boolean),
    ),
  ].slice(0, 12);
}
