// SPDX-FileCopyrightText: 2026 Kaede Akino
// SPDX-License-Identifier: AGPL-3.0-or-later

import { eapi, web } from "./api.js";
import { PAGE } from "./constants.js";
import { toEpisode, toShow } from "./models.js";
import type { ServiceProgram, ServiceShow } from "./service-types.js";
import { requireAccount, session } from "./session.js";
import type { ByID, PageOptions, Toggle } from "./types.js";
import { fail, id, offsetOf, tr } from "./utils.js";

export async function shows() {
  requireAccount();
  const generation = session.epoch;
  const all = [];
  for (let offset = 0; ; offset += 100) {
    const result = await web<{ djRadios?: ServiceShow[]; hasMore?: boolean }>(
      "/api/djradio/get/subed",
      { limit: 100, offset, total: true },
    );
    if (generation !== session.epoch) throw new Error(tr("The account changed. Reload this page."));
    const page = result.djRadios || [];
    all.push(...page.map((s) => ({ ...toShow(s), subscribed: true })));
    if (!result.hasMore || !page.length) return all;
  }
}

export async function show({ id: sid, offset = 0 }: ByID & PageOptions) {
  const [detail, programs] = await Promise.all([
    web<{ data?: ServiceShow }>("/api/djradio/v2/get", { id: id(sid) }),
    web<{ programs?: ServiceProgram[]; more?: boolean }>("/api/dj/program/byradio", {
      radioId: id(sid),
      limit: PAGE,
      offset: offsetOf(offset),
      asc: false,
    }),
  ]);
  if (!detail.data) throw fail("unavailable", tr("Podcast not found"));
  return {
    show: toShow(detail.data),
    episodes: (programs.programs || []).map((p) => toEpisode(p, detail.data!)),
    more: !!programs.more,
  };
}

export async function subscribeShow({ id: sid, on }: Toggle) {
  requireAccount();
  await eapi(`/api/djradio/${on ? "sub" : "unsub"}`, { id: id(sid) });
}
