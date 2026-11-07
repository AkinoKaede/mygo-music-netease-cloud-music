// SPDX-FileCopyrightText: 2026 Kaede Akino
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { harness, present, song, songDetails, type Call } from "./harness.ts";

const artist = {
  id: 10,
  name: "Artist",
  img1v1Url: "http://image.example/square",
  picUrl: "http://image.example/wide",
  followed: true,
  trans: "Alias",
  alias: ["Alias", "Other", ""],
  musicSize: 123,
  albumSize: 201,
  briefDesc: " First line\nSecond line ",
};
const albums = Array.from({ length: 201 }, (_, i) => ({ id: i + 1000, name: `Album ${i}` }));

function response({ path, params }: Call) {
  if (path === "/api/v1/artist/10") return { artist, hotSongs: [song(9), song(3), song(5)] };
  if (path === "/api/artist/albums/10") {
    const offset = Number(params.offset),
      end = offset + Number(params.limit);
    return { hotAlbums: albums.slice(offset, end), more: end < albums.length };
  }
  if (path === "/api/v3/song/detail") return songDetails(params);
}

// Artist albums must not stop at 100, and detail hydration must preserve hot-song order.
test("native artist returns all albums, ranked songs, square portrait and follow state", async () => {
  const h = await harness(response);
  const result = await h.plugin.artist({ id: "10" });
  assert.deepEqual(
    result.albums.map((a) => a.id),
    albums.map((a) => String(a.id)),
  );
  assert.deepEqual(
    result.tracks.map((t) => t.id),
    ["9", "3", "5"],
  );
  assert.ok(result.tracks.every((t) => !t.unavailable));
  assert.equal(result.artist.imageUrl, "https://image.example/square");
  assert.equal(result.artist.following, true);
  assert.deepEqual(
    h.calls.filter((c) => c.path === "/api/artist/albums/10").map((c) => c.params.offset),
    ["0", "100", "200"],
  );
  assert.deepEqual(h.state.get("lastArtists"), [result.artist]);
});

// Empty album pages terminate pagination even if NetEase incorrectly advertises more.
test("artist stops at an empty album page and falls back to the wide portrait", async () => {
  const h = await harness((call) => {
    if (call.path === "/api/v1/artist/10")
      return { artist: { ...artist, img1v1Url: "", followed: false } };
    if (call.path === "/api/artist/albums/10")
      return {
        hotAlbums: Number(call.params.offset) === 0 ? albums.slice(0, 1) : [],
        more: true,
      };
  });
  const result = await h.plugin.artist({ id: "10" });
  assert.equal(result.artist.imageUrl, "https://image.example/wide");
  assert.equal(result.artist.following, false);
  assert.deepEqual(
    result.albums.map((a) => a.id),
    ["1000"],
  );
  assert.equal(h.calls.filter((c) => c.path === "/api/artist/albums/10").length, 2);
});

// A failed album continuation must be retryable, not silently published as a complete catalog.
test("artist album failures do not save partial pages or artist history", async () => {
  let fail = true;
  const h = await harness((call) => {
    if (call.path === "/api/artist/albums/10" && call.params.offset === "100" && fail)
      throw new Error("offline");
    return response(call);
  });
  await assert.rejects(h.plugin.artist({ id: "10" }), /offline/);
  assert.equal(h.state.has("lastArtists"), false);
  fail = false;
  const result = await h.plugin.artist({ id: "10" });
  assert.equal(result.albums.length, 201);
  assert.equal(new Set(result.albums.map((a) => a.id)).size, 201);
  assert.equal(present(h.state.get("lastArtists")).length, 1);
});

// Optional privilege hydration may fail without hiding the artist's existing hot songs.
test("artist falls back to original song metadata when detail hydration fails", async () => {
  const h = await harness((call) => {
    if (call.path === "/api/v3/song/detail") throw new Error("offline");
    if (call.path === "/api/v1/artist/10")
      return {
        artist,
        hotSongs: [song(9, { privilege: { st: -1, pl: 0 } }), song(3)],
      };
    return response(call);
  });
  const result = await h.plugin.artist({ id: "10" });
  assert.deepEqual(
    result.tracks.map((t) => t.id),
    ["9", "3"],
  );
  assert.equal(result.tracks[0].unavailable, true);
  assert.equal(result.tracks[1].name, "Song 3");
});

// A missing or mismatched artist must not become a placeholder page for the wrong person.
test("artist rejects missing or mismatched identities on native and supplementary pages", async () => {
  for (const raw of [undefined, { ...artist, id: 11 }]) {
    for (const page of ["native", "artist-extra?id=10", "artist-albums?id=10"]) {
      const h = await harness(({ path }) => {
        if (path === "/api/v1/artist/10") return { artist: raw };
        if (path === "/api/artist/albums/10") return { hotAlbums: [] };
        if (path === "/api/v1/artist/songs") return { songs: [] };
      });
      await assert.rejects(
        page === "native" ? h.plugin.artist({ id: "10" }) : h.plugin.browse({ page }),
        { code: "unavailable" },
      );
      assert.equal(h.state.has("lastArtists"), false);
    }
  }
});

// Logout during albums or hydration must neither save stale artist history nor request another page.
test("artist rejects responses from an earlier account during pagination and hydration", async () => {
  for (const stage of ["albums", "hydrate"]) {
    let release!: () => void, started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const h = await harness(
      async (call) => {
        if (call.path === "/api/logout") return {};
        const delayed =
          stage === "albums"
            ? call.path === "/api/artist/albums/10" && call.params.offset === "100"
            : call.path === "/api/v3/song/detail";
        if (delayed) {
          started();
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return response(call);
      },
      { signedIn: true },
    );
    const pending = h.plugin.artist({ id: "10" });
    const rejected = assert.rejects(pending, /account changed/i);
    await ready;
    await h.plugin.signOut();
    release();
    await rejected;
    assert.equal(h.state.has("lastArtists"), false);
    if (stage === "albums") {
      assert.ok(
        !h.calls.some((c) => c.path === "/api/artist/albums/10" && c.params.offset === "200"),
      );
      assert.ok(!h.calls.some((c) => c.path === "/api/v3/song/detail"));
    }
  }
});

// Following uses the working web endpoint and asks guests to sign in before any request.
test("artist follow actions preserve the web API contract", async () => {
  const h = await harness(
    ({ path, params, options }) => {
      assert.ok(["/api/artist/sub", "/api/artist/unsub"].includes(path));
      assert.equal(params.artistId, "10");
      assert.equal(params.artistIds, "[10]");
      assert.equal(options.method, "POST");
      return {};
    },
    { signedIn: true },
  );
  await h.plugin.followArtist({ id: "10", on: true });
  await h.plugin.followArtist({ id: "10", on: false });
  assert.deepEqual(
    h.calls.map((c) => c.path),
    ["/api/artist/sub", "/api/artist/unsub"],
  );
  const guest = await harness(() => assert.fail("Guest follow must not request data"));
  await assert.rejects(guest.plugin.followArtist({ id: "10", on: true }), { code: "signIn" });
});

// Latest-song continuations must not also advance the unrelated album collection.
test("supplementary artist pages use native headers and independent continuations", async () => {
  const h = await harness((call) => {
    if (call.path === "/api/v1/artist/songs") {
      assert.equal(call.params.order, "time");
      assert.equal(call.params.limit, "100");
      const offset = Number(call.params.offset);
      return { songs: [{ id: offset + 2 }, { id: offset + 1 }], more: offset < 200 };
    }
    return response(call);
  });
  const extra = await h.plugin.browse({ page: "artist-extra?id=10&offset=100" });
  assert.equal(extra.title, artist.name);
  assert.equal(extra.imageUrl, "https://image.example/square");
  assert.ok(!present(extra.subtitle).includes(artist.briefDesc));
  assert.equal(present(extra.description).split("\n")[1], "First line Second line");
  assert.equal(present(present(extra.description).match(/Alias/g)).length, 1);
  assert.ok(present(extra.description).includes("Other"));
  assert.ok(present(extra.description).includes("123"));
  assert.ok(present(extra.description).includes("201"));
  assert.deepEqual(
    present(extra.sections[0].tracks).map((t) => t.id),
    ["102", "101"],
  );
  assert.equal(present(h.calls.find((c) => c.path === "/api/artist/albums/10")).params.offset, "0");
  const before = h.calls.length;
  const latest = await h.plugin.browse({ page: present(extra.sections[0].morePage) });
  assert.deepEqual(
    present(latest.sections[0].tracks).map((t) => t.id),
    ["202", "201"],
  );
  assert.ok(!h.calls.slice(before).some((c) => c.path === "/api/artist/albums/10"));
  assert.equal(latest.sections.length, 1);
  const albumPage = await h.plugin.browse({ page: present(extra.sections[1].morePage) });
  assert.equal(present(albumPage.sections[0].albums)[0].id, "1050");
  const next = await h.plugin.browse({ page: present(albumPage.sections[1].links)[0].page });
  assert.equal(present(next.sections[0].albums)[0].id, "1100");
});

// One failed supplementary collection must not hide its sibling or retry the wrong offset.
test("supplementary artist collections fail independently and retry the requested page", async () => {
  for (const failed of ["latest", "albums"]) {
    let fail = true;
    const h = await harness((call) => {
      if (call.path === "/api/v1/artist/songs") {
        if (failed === "latest" && fail) throw new Error("offline");
        return { songs: [] };
      }
      if (call.path === "/api/artist/albums/10" && failed === "albums" && fail)
        throw new Error("offline");
      return response(call);
    });
    const extra = await h.plugin.browse({ page: "artist-extra?id=10&offset=100" });
    const index = failed === "latest" ? 0 : 1;
    assert.equal(extra.sections[index].empty, undefined);
    assert.equal(extra.sections[1 - index].links, undefined);
    const target = present(extra.sections[index].links)[0].page;
    const url = new URL(target, "https://plugin.invalid/");
    assert.equal(url.pathname, failed === "latest" ? "/artist-latest" : "/artist-albums");
    assert.equal(url.searchParams.get("offset") || "0", failed === "latest" ? "100" : "0");
    fail = false;
    const result = await h.plugin.browse({ page: target });
    assert.equal(result.sections[0].links, undefined);
    assert.equal(result.title, artist.name);
  }
});

// Empty supplementary lists must not emit endless continuation links.
test("empty supplementary artist collections keep empty states without next pages", async () => {
  const h = await harness(({ path }) => {
    if (path === "/api/v1/artist/10") return { artist: { id: 10, name: "Artist" } };
    if (path === "/api/artist/albums/10") return { hotAlbums: [], more: true };
    if (path === "/api/v1/artist/songs") return { songs: [], more: true };
  });
  for (const page of ["artist-extra?id=10", "artist-latest?id=10", "artist-albums?id=10"]) {
    const result = await h.plugin.browse({ page });
    assert.equal(result.description, "");
    assert.equal(result.imageUrl, "");
    for (const section of result.sections) {
      assert.ok(section.empty);
      assert.ok(!section.morePage);
      assert.equal(section.links, undefined);
    }
  }
});
