// SPDX-FileCopyrightText: 2026 Kaede Akino
// SPDX-License-Identifier: AGPL-3.0-or-later

import { eapi, web } from "./api.js";
import { PAGE } from "./constants.js";
import { toPlaylist, toTrack, trackIdentity } from "./models.js";
import type { ServicePlaylist } from "./service-types.js";
import { accountNow, requireAccount, session } from "./session.js";
import { details } from "./tracks.js";
import type { ByID, ID, Named, Toggle, Track, TrackIDs } from "./types.js";
import { check, fail, id, offsetOf, tr } from "./utils.js";

export async function userPlaylists(uid: string) {
  const generation = session.epoch;
  const all = [];
  for (let offset = 0; ; offset += 200) {
    const result = await web<{ playlist?: ServicePlaylist[]; more?: boolean }>(
      "/api/user/playlist",
      { uid: id(uid), limit: 200, offset },
    );
    if (generation !== session.epoch) throw new Error(tr("The account changed. Reload this page."));
    const page = result.playlist || [];
    all.push(...page);
    if (!result.more || !page.length) return all;
  }
}

export async function playlists() {
  return (await userPlaylists(requireAccount().id)).map(toPlaylist);
}

export async function playlistRaw(pid: string) {
  const generation = session.epoch,
    target = id(pid);
  const result = await web<{ playlist?: ServicePlaylist }>("/api/v6/playlist/detail", {
    id: target,
    n: 1000,
  });
  if (generation !== session.epoch) throw new Error(tr("The account changed. Reload this page."));
  if (String(result.playlist?.id) !== target)
    throw fail("unavailable", tr("This playlist is missing or private"));
  return result.playlist!;
}

export async function editablePlaylist(pid: string) {
  requireAccount();
  const generation = session.epoch;
  const p = await playlistRaw(pid);
  if (generation !== session.epoch) throw new Error(tr("The account changed. Reload this page."));
  // Protect source-managed lists even when a caller bypasses the host's fixed controls.
  if (p.specialType === 5)
    throw fail("unsupported", tr("Use song hearts to change your liked songs"));
  return p;
}

export async function playlist({ id: pid }: ByID) {
  const generation = session.epoch;
  const p = await playlistRaw(pid);
  const original = new Map((p.tracks || []).map((t) => [String(t.id), toTrack(t)]));
  const ids = (p.trackIds?.length ? p.trackIds : p.tracks || []).map((t) => String(t.id));
  const enriched = new Map((await details(ids)).map((t) => [t.id, t]));
  if (generation !== session.epoch) throw new Error(tr("The account changed. Reload this page."));
  // Keep the playlist order and any usable original metadata missing from song detail.
  const tracks = ids
    .map((id) => enriched.get(id) || original.get(id))
    .filter((track): track is Track => !!track);
  return { ...toPlaylist(p), tracks };
}

export async function likedIDs(refresh = false): Promise<string[]> {
  const me = requireAccount();
  if (
    !session.likedPending &&
    !refresh &&
    session.likedCache &&
    Date.now() - session.likedCache.time < 60000
  )
    return session.likedCache.ids;
  if (!session.likedPending) {
    const generation = session.epoch;
    const revision = session.likesRevision;
    const pending = eapi<{ ids?: ID[] }>("/api/song/like/get", { uid: me.id })
      .then((result) => {
        if (generation !== session.epoch)
          throw new Error(tr("The account changed. Reload this page."));
        const ids = (result.ids || []).map(String);
        if (revision === session.likesRevision) session.likedCache = { time: Date.now(), ids };
        return ids;
      })
      .finally(() => {
        if (session.likedPending === pending) session.likedPending = null;
      });
    session.likedPending = pending;
  }
  return session.likedPending;
}

export async function liked({ offset = 0 } = {}) {
  offsetOf(offset);
  // A first-page request is also the host's refresh after changes in the service.
  const ids = await likedIDs(offset === 0);
  return {
    tracks: await details(ids.slice(offset, offset + PAGE)),
    more: offset + PAGE < ids.length,
  };
}

export async function isLiked({ ids }: { ids: string[] }) {
  const result = Object.fromEntries(ids.map((n) => [n, false]));
  if (!accountNow()) return result;
  const songs = ids.filter((n) => !trackIdentity(n).program);
  if (songs.length) {
    const liked = new Set(await likedIDs());
    for (const n of songs) result[n] = liked.has(n);
  }
  const episodes = ids.filter((n) => trackIdentity(n).program);
  for (let i = 0; i < episodes.length; i += 100) {
    const batch = episodes.slice(i, i + 100);
    const response = await eapi<{ data?: { resourceId: ID; liked?: boolean }[] }>(
      "/api/resource/commentInfo/list",
      {
        resourceType: "1",
        resourceIds: JSON.stringify(batch.map((n) => Number(trackIdentity(n).program))),
      },
    );
    const likes = new Map((response.data || []).map((p) => [String(p.resourceId), !!p.liked]));
    for (const n of batch) result[n] = likes.get(trackIdentity(n).program!) || false;
  }
  return result;
}

export async function like({ id: song, on }: Toggle) {
  requireAccount();
  if (trackIdentity(song).program) return likeEpisode({ id: song, on });
  await eapi("/api/radio/like", {
    alg: "itembased",
    trackId: id(song),
    like: String(!!on),
    time: "3",
  });
  session.likesRevision++;
  session.likedCache = null;
  session.likedPending = null;
}

export async function likeEpisode({ id: episode, on }: Toggle) {
  requireAccount();
  const identity = trackIdentity(episode);
  if (!identity.program) throw fail("unsupported", tr("This is not a podcast episode"));
  await eapi(`/api/resource/${on ? "like" : "unlike"}`, { threadId: identity.thread });
}

export async function createPlaylist({ name }: Named) {
  requireAccount();
  if (!name.trim()) throw new Error(tr("Playlist name cannot be empty"));
  const result = await eapi<{ playlist?: ServicePlaylist; id: ID }>("/api/playlist/create", {
    name: name.trim(),
    privacy: "0",
    type: "NORMAL",
  });
  const p = result.playlist || { id: result.id, name: name.trim() };
  return { ...toPlaylist(p), mine: true, tracks: [] };
}

export async function renamePlaylist({ id: pid, name }: ByID & Named) {
  requireAccount();
  if (!name.trim()) throw new Error(tr("Playlist name cannot be empty"));
  await editablePlaylist(pid);
  await eapi("/api/playlist/update/name", { id: id(pid), name: name.trim() });
}

export async function deletePlaylist({ id: pid }: ByID) {
  await editablePlaylist(pid);
  await eapi("/api/playlist/remove", { ids: JSON.stringify([Number(id(pid))]) });
}

export async function manipulate(op: string, pid: string, trackIds: string[]) {
  requireAccount();
  const ids = trackIds.map((n) => Number(id(n)));
  if (!ids.length) return;
  await editablePlaylist(pid);
  const send = (items: number[]) =>
    eapi(
      "/api/playlist/manipulate/tracks",
      { op, pid: id(pid), trackIds: JSON.stringify(items), imme: "true" },
      [200, 502, 512],
    );
  let result = await send(ids);
  if (result.code === 512) result = await send([...ids, ...ids]);
  if (result.code === 502) throw new Error(tr("This song is already in the playlist"));
  check(result, "playlist/manipulate/tracks");
}

export function addToPlaylist({ id, trackIds }: TrackIDs) {
  return manipulate("add", id, trackIds);
}

export function removeFromPlaylist({ id, trackIds }: TrackIDs) {
  return manipulate("del", id, trackIds);
}

export async function movePlaylistTrack({
  id: pid,
  from,
  to,
}: ByID & { from: number; to: number }) {
  const p = await editablePlaylist(pid);
  // Never reorder a partial playlist: missing IDs could discard unseen tracks.
  const ids = (p.trackIds || []).map((t) => Number(id(t.id)));
  if (ids.length !== p.trackCount)
    throw new Error(tr("The track list is incomplete. Reordering was cancelled."));
  if (![from, to].every((n) => Number.isSafeInteger(n) && n >= 0 && n < ids.length))
    throw new Error(tr("Invalid track position"));
  if (from === to) return;
  ids.splice(to, 0, ids.splice(from, 1)[0]);
  await eapi("/api/playlist/manipulate/tracks", {
    pid: id(pid),
    trackIds: JSON.stringify(ids),
    op: "update",
  });
}

export async function savePlaylist({ id: pid, on }: Toggle) {
  await editablePlaylist(pid);
  await eapi(`/api/playlist/${on ? "subscribe" : "unsubscribe"}`, { id: id(pid) });
}
