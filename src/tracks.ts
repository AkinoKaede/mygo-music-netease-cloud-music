// SPDX-FileCopyrightText: 2026 Kaede Akino
// SPDX-License-Identifier: AGPL-3.0-or-later

import { eapi } from "./api.js";
import { toTrack } from "./models.js";
import type { Privilege, ServiceSong } from "./service-types.js";
import { session } from "./session.js";
import type { ID } from "./types.js";
import { id, tr } from "./utils.js";

export async function details(ids: ID[]) {
  const generation = session.epoch;
  const out = [];
  for (let i = 0; i < ids.length; i += 400) {
    const batch = ids.slice(i, i + 400).map(id);
    const result = await eapi<{ songs?: ServiceSong[]; privileges?: Privilege[] }>(
      "/api/v3/song/detail",
      { c: JSON.stringify(batch.map((n) => ({ id: Number(n) }))) },
    );
    if (generation !== session.epoch) throw new Error(tr("The account changed. Reload this page."));
    const privileges = new Map((result.privileges || []).map((p) => [String(p.id), p]));
    const tracks = new Map(
      (result.songs || []).map((t) => [String(t.id), toTrack(t, privileges.get(String(t.id)))]),
    );
    for (const n of batch) if (tracks.has(n)) out.push(tracks.get(n)!);
  }
  return out;
}

export async function hydrate(songs: ServiceSong[]) {
  if (!songs?.length) return [];
  // Keep unavailable entries visible, but prefer the eapi's account-aware privileges.
  const tracks = await details(songs.map((t) => t.id));
  const byID = new Map(tracks.map((t) => [t.id, t]));
  return songs.map((t) => byID.get(String(t.id)) || toTrack(t));
}
