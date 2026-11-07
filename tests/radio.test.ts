// SPDX-FileCopyrightText: 2026 Kaede Akino
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { harness, present, song, songDetails, type Call } from "./harness.ts";

function detailsWithUnavailable(params: Call["params"], unavailable: number[]) {
  const result = songDetails(params);
  for (const p of result.privileges) if (unavailable.includes(p.id)) p.pl = 0;
  return result;
}

// Every FM switch must reach the corresponding mode and exclude unplayable tracks.
test("FM modes preserve service order and cache only playable covers", async () => {
  for (const mode of ["DEFAULT", "FAMILIAR", "EXPLORE"]) {
    const h = await harness(
      ({ path, params }) => {
        if (path === "/api/v1/radio/get") {
          assert.equal(params.mode, mode);
          assert.equal(params.limit, 3);
          return { data: [{ id: 3 }, { id: 1 }, { id: 2 }] };
        }
        if (path === "/api/v3/song/detail") return detailsWithUnavailable(params, [3]);
      },
      { signedIn: true },
    );
    const tracks = await h.plugin.stationNext({ id: `fm:${mode}` });
    assert.deepEqual(
      tracks.map((t) => t.id),
      ["1", "2"],
    );
    assert.equal(present(h.state.get("stationCovers"))[`fm:${mode}`], tracks[0].album.imageUrl);
  }
});

// Empty playable batches are returned to the host, which already owns bounded retry.
test("FM does not add a second retry loop or cache unplayable artwork", async () => {
  const h = await harness(
    ({ path, params }) => {
      if (path === "/api/v1/radio/get") return { data: [{ id: 1 }] };
      if (path === "/api/v3/song/detail") return detailsWithUnavailable(params, [1]);
    },
    { signedIn: true },
  );
  assert.deepEqual(await h.plugin.stationNext({ id: "fm:DEFAULT" }), []);
  assert.equal(h.calls.filter((c) => c.path === "/api/v1/radio/get").length, 1);
  assert.equal(h.state.has("stationCovers"), false);
  await assert.rejects(h.plugin.stationNext({ id: "invalid" }), { code: "unavailable" });
  assert.equal(h.calls.length, 2);
});

// Heart Mode begins with a playable liked song and continues from the last playable recommendation.
test("Heart Mode queues its seed once and maintains the recommendation cursor", async () => {
  let batches = 0;
  const h = await harness(
    ({ path, params }) => {
      if (path === "/api/user/playlist") return { playlist: [{ id: 9, specialType: 5 }] };
      if (path === "/api/song/like/get") return { ids: [1, 2] };
      if (path === "/api/v3/song/detail") return detailsWithUnavailable(params, [1, 4]);
      if (path === "/api/playmode/intelligence/list") {
        assert.equal(params.playlistId, "9");
        assert.equal(params.startMusicId, "2");
        assert.equal(params.songId, batches === 0 ? "2" : "3");
        assert.equal(params.type, "fromPlayOne");
        assert.equal(params.count, 1);
        return { data: (++batches === 1 ? [2, 3, 4] : [5]).map((id) => ({ songInfo: song(id) })) };
      }
    },
    { signedIn: true },
  );
  assert.deepEqual(
    (await h.plugin.stationNext({ id: "heart" })).map((t) => t.id),
    ["2", "3"],
  );
  assert.deepEqual(
    (await h.plugin.stationNext({ id: "heart" })).map((t) => t.id),
    ["5"],
  );
  assert.equal(h.calls.filter((c) => c.path === "/api/song/like/get").length, 1);
  assert.equal(h.calls.filter((c) => c.path === "/api/user/playlist").length, 1);
});

// Empty likes and entirely unavailable likes cannot provide a Heart Mode seed.
test("Heart Mode refuses to start without a playable liked song", async () => {
  for (const ids of [[], [1]]) {
    const h = await harness(
      ({ path, params }) => {
        if (path === "/api/user/playlist") return { playlist: [{ id: 9, specialType: 5 }] };
        if (path === "/api/song/like/get") return { ids };
        if (path === "/api/v3/song/detail") return detailsWithUnavailable(params, [1]);
        assert.fail(`Unexpected request: ${path}`);
      },
      { signedIn: true },
    );
    await assert.rejects(h.plugin.stationNext({ id: "heart" }), { code: "unavailable" });
    assert.equal(h.state.has("stationCovers"), false);
  }
});

// Late FM and Heart Mode answers must not return tracks or restore artwork after logout.
test("logout discards pending radio batches before further hydration", async () => {
  for (const station of ["fm:DEFAULT", "heart"]) {
    let release!: () => void, started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const h = await harness(
      async ({ path, params }) => {
        if (path === "/api/logout") return {};
        if (path === "/api/user/playlist") return { playlist: [{ id: 9, specialType: 5 }] };
        if (path === "/api/song/like/get") return { ids: [1] };
        if (path === "/api/v3/song/detail") return songDetails(params);
        if (["/api/v1/radio/get", "/api/playmode/intelligence/list"].includes(path)) {
          started();
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return { data: station === "heart" ? [{ songInfo: song(2) }] : [{ id: 2 }] };
        }
      },
      { signedIn: true },
    );
    const pending = h.plugin.stationNext({ id: station });
    const rejected = assert.rejects(pending, /account changed/i);
    await ready;
    const before = h.calls.filter((c) => c.path === "/api/v3/song/detail").length;
    await h.plugin.signOut();
    release();
    await rejected;
    assert.equal(h.calls.filter((c) => c.path === "/api/v3/song/detail").length, before);
    assert.equal(h.state.has("stationCovers"), false);
  }
});
