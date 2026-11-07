// SPDX-FileCopyrightText: 2026 Kaede Akino
// SPDX-License-Identifier: AGPL-3.0-or-later

import { web } from "./api.js";
import { toPlaylist, toTrack } from "./models.js";
import type { ServiceChart, ServicePlaylist, ServiceSong } from "./service-types.js";
import { accountNow, load, requireAccount, session } from "./session.js";
import { hydrate } from "./tracks.js";
import type { Section } from "./types.js";
import { retrySection, tr } from "./utils.js";

export async function daily() {
  const generation = session.epoch;
  const result = await web<{ data?: { dailySongs?: ServiceSong[] } }>(
    "/api/v3/discovery/recommend/songs",
  );
  if (generation !== session.epoch) throw new Error(tr("The account changed. Reload this page."));
  const songs = result.data?.dailySongs || [];
  let tracks;
  try {
    tracks = await hydrate(songs);
  } catch {
    tracks = songs.map((song) => toTrack(song));
  }
  if (generation !== session.epoch) throw new Error(tr("The account changed. Reload this page."));
  return tracks;
}

export function dailyBlurb() {
  return load("cookies", {}).MUSIC_U
    ? tr("Picked for your taste, updated daily at 06:00")
    : tr("Songs everyone is listening to. Sign in for your own recommendations");
}

export async function pickedForYou() {
  const generation = session.epoch;
  // The public "personalized" endpoint is not the listener's daily recommendations.
  // Cookies may already be restored while the host is still loading the profile.
  const signedIn = !!load("cookies", {}).MUSIC_U;
  if (!signedIn && accountNow()) requireAccount();
  if (!signedIn) return [];
  const result = await web<{ recommend?: ServicePlaylist[] }>(
    "/api/v1/discovery/recommend/resource",
  );
  if (generation !== session.epoch) throw new Error(tr("The account changed. Reload this page."));
  return result.recommend || [];
}

export async function recommendedPlaylists() {
  const generation = session.epoch;
  const result = await web<{ result?: ServicePlaylist[] }>("/api/personalized/playlist", {
    limit: 30,
  });
  if (generation !== session.epoch) throw new Error(tr("The account changed. Reload this page."));
  return result.result || [];
}

export function toChart(playlist: ServiceChart) {
  return {
    ...toPlaylist(playlist),
    description: [
      playlist.updateFrequency,
      ...(playlist.tracks || [])
        .slice(0, 3)
        .map((track, index) => `${index + 1}. ${track.first} · ${track.second}`),
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export async function charts() {
  return ((await web<{ list?: ServiceChart[] }>("/api/toplist/detail")).list || []).map(toChart);
}

export async function home() {
  const generation = session.epoch;
  const [songs, picks, rankings, playlists] = await Promise.allSettled([
    daily(),
    pickedForYou(),
    charts(),
    recommendedPlaylists(),
  ]);
  if (generation !== session.epoch) throw new Error(tr("The account changed. Reload this page."));
  const results = [songs, picks, rankings, playlists];
  if (!results.some((result) => result.status === "fulfilled" && result.value.length)) {
    const failed = results.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
  }
  const sections: Section[] = [];
  // The host renders the first track section with its native daily recommendation card.
  if (songs.status === "fulfilled" && songs.value.length) {
    sections.push({
      title: tr("Daily Recommendations"),
      pageTitle: tr("Daily Song Recommendations"),
      subtitle: dailyBlurb(),
      tracks: songs.value,
    });
  } else if (songs.status === "rejected") {
    sections.push(retrySection(tr("Daily Recommendations"), "daily", songs.reason));
  }
  if (picks.status === "fulfilled" && picks.value.length) {
    sections.push({ title: tr("Picked for You Today"), playlists: picks.value.map(toPlaylist) });
  } else if (picks.status === "rejected") {
    sections.push(retrySection(tr("Picked for You Today"), "picked-for-you", picks.reason));
  }
  if (rankings.status === "fulfilled" && rankings.value.length) {
    sections.push({
      title: tr("Official Charts"),
      playlists: rankings.value.slice(0, 4),
      morePage: "charts",
    });
  } else if (rankings.status === "rejected") {
    sections.push(retrySection(tr("Official Charts"), "charts", rankings.reason));
  }
  if (playlists.status === "fulfilled" && playlists.value.length) {
    sections.push({
      title: tr("Recommended Playlists"),
      playlists: playlists.value.map(toPlaylist),
    });
  } else if (playlists.status === "rejected") {
    sections.push(retrySection(tr("Recommended Playlists"), "recommended", playlists.reason));
  }
  return { title: tr("For You"), sections };
}
