// SPDX-FileCopyrightText: 2026 Kaede Akino
// SPDX-License-Identifier: AGPL-3.0-or-later

import { SITE } from "./constants.js";
import type {
  ServiceAlbum,
  ServiceArtist,
  ServiceComment,
  ServicePlaylist,
  ServiceProgram,
  ServiceShow,
  ServiceSong,
} from "./service-types.js";
import { accountNow } from "./session.js";
import type { Album, Artist, Playlist, Show, Track } from "./types.js";
import { date, id, picture, route, tr } from "./utils.js";

export function toArtist(a: ServiceArtist = {}): Artist {
  return {
    id: a.id ? String(a.id) : "",
    name: a.name || "",
    imageUrl: picture(a.img1v1Url || a.picUrl),
    following: !!a.followed,
  };
}

export function toAlbum(a: ServiceAlbum = {}): Album {
  return {
    id: a.id ? String(a.id) : "",
    name: a.name || "",
    imageUrl: picture(a.picUrl),
    artists: (a.artists || (a.artist ? [a.artist] : [])).map(toArtist),
    released: date(a.publishTime),
    saved: !!(a.isSub || a.subscribed),
  };
}

export function toTrack(t: ServiceSong, privilege = t.privilege): Track {
  return {
    id: String(t.id),
    name: t.name || "",
    artists: (t.ar || t.artists || []).map(toArtist),
    album: toAlbum(t.al || t.album),
    duration: t.dt ?? t.duration ?? 0,
    url: `${SITE}/song?id=${t.id}`,
    unavailable: privilege ? privilege.st < 0 || privilege.pl <= 0 : t.fee === 1 || t.fee === 4,
  };
}

export function toPlaylist(p: Omit<ServicePlaylist, "tracks">): Playlist {
  return {
    id: String(p.id),
    name: p.name || "",
    imageUrl: picture(p.coverImgUrl || p.picUrl),
    description: p.description || "",
    owner: p.creator?.nickname || "",
    trackCount: p.trackCount || 0,
    mine: !!accountNow() && String(p.creator?.userId) === accountNow()!.id,
    fixed: p.specialType === 5,
    saved: !!p.subscribed,
  };
}

export function toShow(s: ServiceShow): Show {
  let publisherPage = "";
  try {
    publisherPage = route("user", { id: id(s.dj?.userId) });
  } catch {
    /* A missing or invalid publisher ID must not hide the podcast. */
  }
  return {
    id: String(s.id),
    name: s.name,
    imageUrl: picture(s.picUrl),
    description: s.desc || "",
    publisher: s.dj?.nickname || "",
    publisherPage,
    episodeCount: s.programCount || 0,
    subscribed: !!s.subed,
  };
}

export function toEpisode(p: ServiceProgram, show: ServiceShow): Track {
  return {
    id: `program:${id(p.id)}:${id(p.mainSong.id)}`,
    name: p.name,
    artists: show.dj?.nickname ? [{ id: "", name: show.dj.nickname }] : [],
    album: { id: `show:${show.id}`, name: show.name, imageUrl: picture(p.coverUrl || show.picUrl) },
    duration: p.duration || p.mainSong.duration || 0,
    showId: String(show.id),
    description: p.description || "",
    published: date(p.createTime),
    url: `${SITE}/program?id=${p.id}`,
  };
}

export function trackIdentity(value: unknown) {
  const match = /^program:(\d+):(\d+)$/.exec(String(value));
  if (match)
    return { program: id(match[1]), audio: id(match[2]), thread: `A_DJ_1_${id(match[1])}` };
  const song = id(value);
  return { audio: song, thread: `R_SO_4_${song}` };
}

export function toComment(c: ServiceComment) {
  const quote = (c.beReplied || [])
    .map((r) => `${r.user?.nickname || ""}: ${r.content || ""}`)
    .join("\n");
  return {
    id: String(c.commentId),
    author: c.user?.nickname || "",
    avatarUrl: picture(c.user?.avatarUrl),
    text: c.content + (quote ? "\n\n" + tr("Replying to: {quote}", { quote }) : ""),
    time: c.time || 0,
    likes: c.likedCount || 0,
    liked: !!c.liked,
  };
}
