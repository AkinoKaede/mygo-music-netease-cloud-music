// SPDX-FileCopyrightText: 2026 Kaede Akino
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ID } from "./types.js";

export interface ApiStatus {
  code: number;
  message?: string;
  msg?: string;
}
export interface ServiceUser {
  userId: ID;
  nickname: string;
  avatarUrl?: string;
  follows?: number;
  followeds?: number;
  signature?: string;
}
export interface ServiceArtist {
  id?: ID;
  name?: string;
  img1v1Url?: string;
  picUrl?: string;
  followed?: boolean;
  trans?: string;
  alias?: string[];
  musicSize?: number;
  albumSize?: number;
  briefDesc?: string;
}
export interface ServiceAlbum {
  id?: ID;
  name?: string;
  picUrl?: string;
  artists?: ServiceArtist[];
  artist?: ServiceArtist;
  publishTime?: number;
  isSub?: boolean;
  subscribed?: boolean;
}
export interface Privilege {
  id?: ID;
  st: number;
  pl: number;
}
export interface ServiceSong {
  id: ID;
  name?: string;
  ar?: ServiceArtist[];
  artists?: ServiceArtist[];
  al?: ServiceAlbum;
  album?: ServiceAlbum;
  dt?: number;
  duration?: number;
  fee?: number;
  privilege?: Privilege;
}
export interface ServicePlaylist {
  id: ID;
  name?: string;
  coverImgUrl?: string;
  picUrl?: string;
  description?: string;
  creator?: ServiceUser;
  trackCount?: number;
  specialType?: number;
  subscribed?: boolean;
  privacy?: number;
  trackIds?: { id: ID }[];
  tracks?: ServiceSong[];
}
export interface ServiceChart extends Omit<ServicePlaylist, "tracks"> {
  updateFrequency?: string;
  tracks?: { first: string; second: string }[];
}
export interface ServiceShow {
  id: ID;
  name: string;
  picUrl?: string;
  desc?: string;
  dj?: ServiceUser;
  programCount?: number;
  subed?: boolean;
}
export interface ServiceProgram {
  id: ID;
  name: string;
  mainSong: ServiceSong;
  radio: ServiceShow;
  coverUrl?: string;
  duration?: number;
  description?: string;
  createTime?: number;
}
export interface ServiceComment {
  commentId: ID;
  user?: ServiceUser;
  content: string;
  time?: number;
  likedCount?: number;
  liked?: boolean;
  beReplied?: { user?: ServiceUser; content?: string }[];
}
export interface ServiceLyrics {
  lrc?: { lyric?: string };
  tlyric?: { lyric?: string };
  yrc?: { lyric?: string };
  ytlrc?: { lyric?: string };
}
export interface ServiceStream {
  id: ID;
  url?: string;
  type?: string;
  level?: string;
  br?: number;
  size?: number;
  gain?: number | string;
  peak?: number | string;
  freeTrialInfo?: unknown;
}
export interface SearchData {
  songs?: ServiceSong[];
  songCount?: number;
  albums?: ServiceAlbum[];
  albumCount?: number;
  artists?: ServiceArtist[];
  artistCount?: number;
  playlists?: ServicePlaylist[];
  playlistCount?: number;
  djRadios?: ServiceShow[];
  djRadiosCount?: number;
}
