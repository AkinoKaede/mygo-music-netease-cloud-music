// SPDX-FileCopyrightText: 2026 Kaede Akino
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { harness, present, song, songDetails, type Call } from "./harness.ts";

function discovery({ path, params }: Call) {
  if (path === "/api/v3/discovery/recommend/songs")
    return { data: { dailySongs: [song(2), song(1)] } };
  if (path === "/api/v3/song/detail") return songDetails(params);
  if (path === "/api/v1/discovery/recommend/resource") return { recommend: [{ id: 20 }] };
  if (path === "/api/toplist/detail") return { list: [30, 31, 32, 33, 34].map((id) => ({ id })) };
  if (path === "/api/personalized/playlist") return { result: [{ id: 40 }] };
}

// Personalized playlist picks and public recommendations must remain distinct and in reference order.
test("home distinguishes daily songs, personal picks, official charts and public playlists", async () => {
  const h = await harness(discovery, { signedIn: true });
  const page = await h.plugin.home();
  assert.deepEqual(
    present(page.sections[0].tracks).map((t) => t.id),
    ["2", "1"],
  );
  assert.deepEqual(
    page.sections.slice(1).map((s) => present(s.playlists).map((p) => p.id)),
    [["20"], ["30", "31", "32", "33"], ["40"]],
  );
  const direct = await h.plugin.browse({ page: "daily" });
  assert.equal(page.sections[0].pageTitle, direct.title);
  assert.equal(page.sections[0].title, direct.subtitle);
  assert.ok(present(direct.description).includes(present(page.sections[0].subtitle)));
  assert.deepEqual(direct.sections[0].tracks, page.sections[0].tracks);
  const charts = await h.plugin.browse({ page: present(page.sections[2].morePage) });
  assert.deepEqual(
    charts.sections.flatMap((s) => present(s.playlists).map((p) => p.id)),
    ["30", "31", "32", "33", "34"],
  );
});

// Restored cookies determine personalization even before account() has completed.
test("home omits personal picks for guests but keeps them for restored sessions", async () => {
  for (const restored of [false, true]) {
    const h = await harness(discovery, {
      storage: restored ? { cookies: { MUSIC_U: "restored" } } : {},
    });
    const page = await h.plugin.home();
    assert.equal(
      h.calls.some((c) => c.path === "/api/v1/discovery/recommend/resource"),
      restored,
    );
    assert.equal(
      page.sections.some((s) => s.playlists?.some((p) => p.id === "20")),
      restored,
    );
    const direct = await h.plugin.browse({ page: "daily" });
    assert.ok(present(direct.description).includes(present(page.sections[0].subtitle)));
    assert.ok(present(page.sections[0].tracks).length);
  }
});

// Daily-song and chart failures must stay visible and retryable instead of vanishing from Home.
test("home keeps independent daily and chart retry links", async () => {
  let failing = true;
  const h = await harness(
    (call) => {
      if (
        failing &&
        ["/api/v3/discovery/recommend/songs", "/api/toplist/detail"].includes(call.path)
      )
        throw new Error("offline");
      return discovery(call);
    },
    { signedIn: true },
  );
  const page = await h.plugin.home();
  assert.deepEqual(
    present(page.sections[1].playlists).map((p) => p.id),
    ["20"],
  );
  assert.deepEqual(
    present(page.sections[3].playlists).map((p) => p.id),
    ["40"],
  );
  failing = false;
  for (const index of [0, 2]) {
    const target = present(page.sections[index].links)[0].page;
    assert.ok(new URL(target, "https://plugin.invalid/").searchParams.has("retry"));
    const recovered = await h.plugin.browse({ page: target });
    assert.ok(recovered.sections.some((s) => s.tracks?.length || s.playlists?.length));
  }
});

// A completely failed discovery load should trigger the host's whole-page retry.
test("home rejects a total discovery outage", async () => {
  const h = await harness(() => {
    throw new Error("offline");
  });
  await assert.rejects(h.plugin.home(), /offline/);
});

// Missing enriched metadata must not remove a song already present in the playlist payload.
test("playlist retains original metadata for omitted details without changing song order", async () => {
  const h = await harness(
    ({ path }) => {
      if (path === "/api/v6/playlist/detail")
        return {
          playlist: {
            id: 9,
            name: "Playlist",
            creator: { userId: 7, nickname: "Creator" },
            subscribed: true,
            description: "Description",
            trackCount: 3,
            trackIds: [3, 1, 2].map((id) => ({ id })),
            tracks: [song(2, { name: "Original song", privilege: { st: -1, pl: 0 } })],
          },
        };
      if (path === "/api/v3/song/detail")
        return {
          songs: [song(1), song(3)],
          privileges: [1, 3].map((id) => ({ id, st: 0, pl: 320000 })),
        };
    },
    { signedIn: true },
  );
  const page = await h.plugin.playlist({ id: "9" });
  assert.deepEqual(
    page.tracks.map((t) => t.id),
    ["3", "1", "2"],
  );
  assert.equal(page.tracks[2].name, "Original song");
  assert.equal(page.tracks[2].unavailable, true);
  assert.equal(page.mine, true);
  assert.equal(page.owner, "Creator");
  assert.equal(page.description, "Description");
});

// An old account's long playlist must stop requesting song batches after logout.
test("logout interrupts long playlist hydration before the next batch", async () => {
  let release!: () => void, started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const h = await harness(
    async ({ path, params }) => {
      if (path === "/api/logout") return {};
      if (path === "/api/v6/playlist/detail")
        return {
          playlist: {
            id: 9,
            trackIds: Array.from({ length: 501 }, (_, i) => ({ id: i + 1 })),
          },
        };
      if (path === "/api/v3/song/detail") {
        started();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return songDetails(params);
      }
    },
    { signedIn: true },
  );
  const pending = h.plugin.playlist({ id: "9" });
  const rejected = assert.rejects(pending, /account changed/i);
  await ready;
  await h.plugin.signOut();
  release();
  await rejected;
  assert.equal(h.calls.filter((c) => c.path === "/api/v3/song/detail").length, 1);
});
