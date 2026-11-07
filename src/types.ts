// SPDX-FileCopyrightText: 2026 Kaede Akino
// SPDX-License-Identifier: AGPL-3.0-or-later

export type ID = string | number;
export type Params = Record<string, string | number | boolean>;
export type Cookies = Record<string, string>;

export interface Account {
  id: string;
  name: string;
  imageUrl?: string;
  page?: string;
}
export interface Artist {
  id: string;
  name: string;
  imageUrl?: string;
  following?: boolean;
}
export interface Album {
  id: string;
  name: string;
  imageUrl?: string;
  artists?: Artist[];
  released?: string;
  saved?: boolean;
}
export interface Track {
  id: string;
  name: string;
  artists: Artist[];
  album: Album;
  duration: number;
  url: string;
  unavailable?: boolean;
  showId?: string;
  description?: string;
  published?: string;
}
export interface Playlist {
  id: string;
  name: string;
  imageUrl: string;
  description: string;
  owner: string;
  trackCount: number;
  mine: boolean;
  fixed: boolean;
  saved: boolean;
  tracks?: Track[];
}
export interface Show {
  id: string;
  name: string;
  imageUrl: string;
  description: string;
  publisher: string;
  publisherPage: string;
  episodeCount: number;
  subscribed: boolean;
}
export interface Link {
  title: string;
  subtitle?: string;
  imageUrl?: string;
  page: string;
}
export interface Section {
  title?: string;
  pageTitle?: string;
  subtitle?: string;
  tracks?: Track[];
  playlists?: Playlist[];
  albums?: Album[];
  artists?: Artist[];
  shows?: Show[];
  links?: Link[];
  morePage?: string;
  empty?: string;
}
export interface Browse {
  title?: string;
  subtitle?: string;
  description?: string;
  imageUrl?: string;
  sections: Section[];
}
export interface LyricWord {
  start: number;
  end: number;
  text: string;
}
export interface LyricLine extends LyricWord {
  words: LyricWord[];
  translation?: string;
}
export interface HeartState {
  playlist: string;
  start: string;
  current: string;
}
export interface StorageSchema {
  account: Account | null;
  cookies: Cookies;
  device: string;
  recent: Track[];
  lastArtists: Artist[];
  stationCovers: Record<string, string>;
  stationFallbacks: Record<string, string>;
  discoveryCovers: Record<string, string>;
}
export interface Host {
  storage: {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
    remove(key: string): void;
  };
  setting(key: string): string;
  language(): string;
  t(text: string): string;
  crypto: {
    md5(text: string): string;
    aesEcbEncrypt(key: string, text: string): string;
  };
  signInPrompt(prompt: { qr?: string; text: string }): void;
  webSignIn(options: {
    url: string;
    cookiesOf: string;
    until: string[];
    userAgent: string;
  }): Promise<{ cookie: string }>;
}
declare global {
  const host: Host;
}

export interface ByID {
  id: string;
}
export interface Toggle extends ByID {
  on: boolean;
}
export interface PageOptions {
  offset?: number;
}
export interface TrackIDs extends ByID {
  trackIds: string[];
}
export interface Named {
  name: string;
}
export interface CommentTarget {
  trackId: string;
}
