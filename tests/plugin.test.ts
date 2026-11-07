// SPDX-FileCopyrightText: 2026 Kaede Akino
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { harness, pluginDirectory, present, song, songDetails } from "./harness.ts";

// QR confirmation keeps cookies, supplies them to account requests and restores the profile.
test("QR sign-in persists a session and logout clears it", async () => {
  let polls = 0;
  const h = await harness(
    ({ path, options }) => {
      if (path.endsWith("/unikey")) return { unikey: "qr-key" };
      if (path.endsWith("/client/login")) {
        if (++polls === 1) return { code: 802 };
        return Response.json(
          { code: 803 },
          { headers: { "set-cookie": "MUSIC_U=confirmed; Path=/; HttpOnly" } },
        );
      }
      if (path.endsWith("/account/get")) {
        assert.match(options.headers.Cookie, /MUSIC_U=confirmed/);
        return { profile: { userId: 7, nickname: "Person", avatarUrl: "http://image.example/a" } };
      }
      if (path === "/api/logout")
        return Response.json({ code: 200 }, { headers: { "set-cookie": "MUSIC_U=stale" } });
    },
    { fastLogin: true },
  );
  const account = await h.plugin.signIn();
  assert.equal(account.id, "7");
  assert.equal(account.page, "profile");
  assert.equal(present(await h.plugin.account()).page, "profile");
  assert.equal(h.prompts[0].qr, "https://music.163.com/login?codekey=qr-key");
  assert.equal(present(h.state.get("cookies")).MUSIC_U, "confirmed");
  await h.plugin.signOut();
  assert.equal(await h.plugin.account(), null);
  assert.equal(h.state.has("cookies"), false);
});

// A response still in flight at logout must not resurrect the old account.
test("late account response cannot restore a signed-out session", async () => {
  let release!: () => void, started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const h = await harness(
    async ({ path }) => {
      if (path.endsWith("/account/get")) {
        started();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return Response.json(
          { code: 200, profile: { userId: 7, nickname: "Old" } },
          { headers: { "set-cookie": "MUSIC_U=old" } },
        );
      }
      if (path === "/api/logout") return {};
    },
    { signedIn: true },
  );
  const pending = h.plugin.account();
  await ready;
  await h.plugin.signOut();
  release();
  assert.equal(await pending, null);
  assert.equal(h.state.has("cookies"), false);
});

// A temporary network failure does not delete a usable saved session.
test("account distinguishes network failures from expired authentication", async () => {
  const h = await harness(
    () => {
      throw new Error("offline");
    },
    { signedIn: true },
  );
  await assert.rejects(h.plugin.account(), /offline/);
  assert.equal(present(h.state.get("cookies")).MUSIC_U, "test-session");
  const expired = await harness(() => ({ code: 301 }), { signedIn: true });
  assert.equal(await expired.plugin.account(), null);
  assert.equal(expired.state.has("account"), false);
});

// Search must preserve result order and replace inaccurate web privileges with account-aware details.
test("search hydrates privileges, preserves order and computes pagination", async () => {
  const h = await harness(({ path, params }) => {
    if (path === "/api/cloudsearch/pc") {
      assert.equal(params.s, "a & b");
      assert.equal(params.offset, "50");
      return { result: { songs: [song(2), song(1)], songCount: 100 } };
    }
    if (path === "/api/v3/song/detail") return songDetails(params);
  });
  const result = await h.plugin.search({ query: "a & b", kind: "tracks", offset: 50 });
  assert.deepEqual(
    result.tracks.map((t) => t.id),
    ["2", "1"],
  );
  assert.equal(result.tracks[0].unavailable, false);
  assert.equal(result.tracks[0].album.imageUrl, "https://p.example/cover.jpg");
  assert.equal(result.more, true);
});

// A playlist longer than a detail response must not silently lose its remaining tracks.
test("playlist fetches every ID in bounded batches", async () => {
  const ids = Array.from({ length: 805 }, (_, i) => ({ id: i + 1 }));
  const h = await harness(({ path, params }) => {
    if (path === "/api/v6/playlist/detail")
      return { playlist: { id: 1, name: "Long", trackCount: 805, trackIds: ids } };
    if (path === "/api/v3/song/detail") return songDetails(params);
  });
  const result = await h.plugin.playlist({ id: "1" });
  assert.equal(result.tracks.length, 805);
  assert.equal(present(result.tracks.at(-1)).id, "805");
  assert.deepEqual(
    h.calls.filter((c) => c.params.c).map((c) => JSON.parse(String(c.params.c)).length),
    [400, 400, 5],
  );
});

// Reordering uses update, while the documented 512 retry applies only to add/remove.
test("playlist editing retries 512 and submits a complete reorder", async () => {
  let adds = 0;
  const h = await harness(
    ({ path, params }) => {
      if (path === "/api/v6/playlist/detail")
        return { playlist: { id: 9, trackCount: 3, trackIds: [1, 2, 3].map((id) => ({ id })) } };
      if (path === "/api/playlist/manipulate/tracks") {
        if (params.op === "add") {
          assert.deepEqual(JSON.parse(String(params.trackIds)), adds ? [1, 2, 1, 2] : [1, 2]);
          return { code: ++adds === 1 ? 512 : 200 };
        }
        assert.equal(params.op, "update");
        assert.deepEqual(JSON.parse(String(params.trackIds)), [2, 3, 1]);
        return {};
      }
    },
    { signedIn: true },
  );
  await h.plugin.addToPlaylist({ id: "9", trackIds: ["1", "2"] });
  await h.plugin.movePlaylistTrack({ id: "9", from: 0, to: 2 });
  await assert.rejects(
    h.plugin.movePlaylistTrack({ id: "9", from: 9, to: 0 }),
    /Invalid track position/,
  );
  await assert.rejects(
    h.plugin.addToPlaylist({ id: "9", trackIds: ["program:1:2"] }),
    /Invalid NetEase ID/,
  );
});

// A partial playlist must never be sent back as the complete new order.
test("reorder refuses incomplete track IDs", async () => {
  const h = await harness(() => ({ playlist: { id: 9, trackCount: 3, trackIds: [{ id: 1 }] } }), {
    signedIn: true,
  });
  await assert.rejects(h.plugin.movePlaylistTrack({ id: "9", from: 0, to: 0 }), /incomplete/);
  assert.equal(h.calls.length, 1);
});

// Podcast playback uses the audio ID, while hearts and comments use the program ID.
test("episodes keep distinct audio and program identities", async () => {
  const h = await harness(
    ({ path, params }) => {
      if (path === "/api/djradio/v2/get")
        return { data: { id: 30, name: "Show", dj: { nickname: "Host" } } };
      if (path === "/api/dj/program/byradio")
        return { programs: [{ id: 40, name: "Episode", mainSong: { id: 50 } }] };
      if (path === "/api/song/enhance/player/url/v1") {
        assert.equal(params.ids, "[50]");
        return {
          data: [{ id: 50, url: "http://audio.example/track.mp3", type: "mp3", level: "standard" }],
        };
      }
      if (path === "/api/resource/like") {
        assert.equal(params.threadId, "A_DJ_1_40");
        return {};
      }
      if (path === "/api/v1/resource/comments/A_DJ_1_40") return { comments: [], total: 0 };
      if (path === "/api/resource/commentInfo/list") {
        assert.equal(params.resourceIds, "[40]");
        return { data: [{ resourceId: 40, liked: true }] };
      }
    },
    { signedIn: true },
  );
  const episode = (await h.plugin.show({ id: "30" })).episodes[0];
  assert.equal(episode.id, "program:40:50");
  assert.equal(episode.showId, "30");
  assert.equal((await h.plugin.stream({ id: episode.id })).url, "https://audio.example/track.mp3");
  await h.plugin.likeEpisode({ id: episode.id, on: true });
  await h.plugin.comments({ trackId: episode.id });
  assert.deepEqual(await h.plugin.isLiked({ ids: [episode.id] }), { [episode.id]: true });
  assert.deepEqual(await h.plugin.lyrics({ id: episode.id }), { lrc: "" });
});

// The host must not play a VIP preview as if it were the complete song.
test("streams reject previews and map host quality to NetEase quality", async () => {
  const h = await harness(({ params }) => {
    assert.equal(params.level, "exhigh");
    return {
      data: [{ id: 1, url: "https://audio.example/a.mp3", freeTrialInfo: { start: 0, end: 30 } }],
    };
  });
  await assert.rejects(h.plugin.stream({ id: "1", quality: "high" }), { code: "unavailable" });
  const lossless = await harness(
    ({ params }) => {
      assert.equal(params.level, "hires");
      assert.equal(params.encodeType, "flac");
      return {
        data: [
          {
            id: 1,
            url: "http://audio.example/a.flac",
            type: "FLAC",
            level: "lossless",
            gain: -4.5,
            peak: 0.9,
          },
        ],
      };
    },
    { settings: { quality: "hires" } },
  );
  const result = await lossless.plugin.stream({ id: "1", quality: "standard" });
  assert.equal(result.type, "flac");
  assert.equal(result.quality, "lossless");
  assert.equal(result.gain, -4.5);
  assert.equal(Object.hasOwn(result.headers, "Cookie"), false);
});

test("streams accept the supported host formats without forwarding session cookies", async () => {
  for (const type of ["mp3", "flac", "ogg", "wav", "m4a", "aac"]) {
    const h = await harness(
      ({ params }) => {
        assert.equal(params.encodeType, "mp3");
        return {
          data: [
            {
              id: 1,
              url: `http://audio.example/a.${type}`,
              type: type.toUpperCase(),
              level: "standard",
              br: 192000,
              size: 12345,
            },
          ],
        };
      },
      { signedIn: true },
    );
    const result = await h.plugin.stream({ id: "1" });
    assert.equal(result.type, type);
    assert.equal(result.url, `https://audio.example/a.${type}`);
    assert.equal(result.bitRate, 192000);
    assert.equal(result.size, 12345);
    assert.deepEqual(Object.keys(result.headers).sort(), ["Referer", "User-Agent"]);
    assert.equal(result.headers.Referer, "https://music.163.com/");
  }
});

test("new stream formats still reject previews, unsafe URLs and unsupported types", async () => {
  for (const type of ["wav", "m4a", "aac"]) {
    for (const item of [
      { url: `https://audio.example/a.${type}`, freeTrialInfo: { start: 0, end: 30 } },
      { url: "file:///tmp/audio" },
      { url: "" },
    ]) {
      const h = await harness(() => ({ data: [{ id: 1, type, ...item }] }));
      await assert.rejects(h.plugin.stream({ id: "1" }), { code: "unavailable" });
    }
  }
  const h = await harness(() => ({
    data: [{ id: 1, url: "https://audio.example/a.wma", type: "wma" }],
  }));
  await assert.rejects(h.plugin.stream({ id: "1" }), { code: "unsupported" });
});

// Word timestamps are absolute milliseconds; translation alignment tolerates small timing differences.
test("YRC retains word timing, parentheses and nearby translations", async () => {
  const h = await harness(({ path }) =>
    path.endsWith("/lyric")
      ? {
          lrc: { lyric: "[00:13.00]Hello world" },
          tlyric: { lyric: "[00:13.00]Translated" },
        }
      : {
          yrc: {
            lyric:
              '{"credits":"ignored"}\n[13010,2000](13010,500,0)Hello(13510,100,0) (13610,1400,0)world (live)',
          },
        },
  );
  const result = await h.plugin.lyrics({ id: "1" });
  assert.equal(present(result.lines)[0].start, 13010);
  assert.equal(present(result.lines)[0].words[0].text, "Hello ");
  assert.equal(present(result.lines)[0].words[1].text, "world (live)");
  assert.equal(present(result.lines)[0].words[1].end, 15010);
  assert.equal(present(result.lines)[0].translation, "Translated");
});

// Failure of optional word lyrics must leave the plain timed lyrics available.
test("lyrics fall back to LRC", async () => {
  const h = await harness(({ path }) => {
    if (path.endsWith("/lyric")) return { lrc: { lyric: "[00:01]Line" } };
    throw new Error("word lyrics unavailable");
  });
  assert.deepEqual(await h.plugin.lyrics({ id: "1" }), { lrc: "[00:01]Line", translation: "" });
});

// Mixing hot comments into the paginated list used to skip later latest comments.
test("hot comments do not alter the host comment offset", async () => {
  const h = await harness(() => ({
    hotComments: [{ commentId: 9, content: "Hot", user: {} }],
    comments: [{ commentId: 1, content: "Latest", user: {} }],
    total: 51,
    more: true,
  }));
  const result = await h.plugin.comments({ trackId: "1", offset: 0 });
  assert.deepEqual(
    result.comments.map((c) => c.id),
    ["1"],
  );
  assert.equal(result.more, true);
});

// An in-flight old like list must not overwrite the cache after a successful like.
test("like invalidates an older in-flight liked list", async () => {
  let release!: () => void, started!: () => void;
  let reads = 0;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const h = await harness(
    async ({ path }) => {
      if (path === "/api/radio/like") return {};
      if (++reads === 1) {
        started();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { ids: [] };
      }
      return { ids: [1] };
    },
    { signedIn: true },
  );
  const old = h.plugin.isLiked({ ids: ["1"] });
  await ready;
  await h.plugin.like({ id: "1", on: true });
  release();
  await old;
  assert.deepEqual(await h.plugin.isLiked({ ids: ["1"] }), { 1: true });
});

test("liked first-page refresh bypasses cached IDs while pagination and hearts reuse them", async () => {
  let ids = [1];
  const h = await harness(
    ({ path, params }) => {
      if (path === "/api/song/like/get") return { ids };
      if (path === "/api/v3/song/detail") return songDetails(params);
    },
    { signedIn: true },
  );
  assert.deepEqual(await h.plugin.isLiked({ ids: ["1", "2"] }), { 1: true, 2: false });
  ids = Array.from({ length: 51 }, (_, i) => i + 2);
  const first = await h.plugin.liked();
  assert.deepEqual(
    first.tracks.map((t) => t.id),
    ids.slice(0, 50).map(String),
  );
  assert.equal(first.more, true);
  const next = await h.plugin.liked({ offset: 50 });
  assert.deepEqual(
    next.tracks.map((t) => t.id),
    ["52"],
  );
  assert.equal(next.more, false);
  assert.deepEqual(await h.plugin.isLiked({ ids: ["1", "2"] }), { 1: false, 2: true });
  assert.equal(h.calls.filter((c) => c.path === "/api/song/like/get").length, 2);
  ids = [];
  assert.deepEqual(await h.plugin.liked({ offset: 0 }), { tracks: [], more: false });
  assert.deepEqual(await h.plugin.isLiked({ ids: ["2"] }), { 2: false });
  assert.equal(h.calls.filter((c) => c.path === "/api/song/like/get").length, 3);
});

test("concurrent liked refreshes and hearts share the fresh request instead of old cached IDs", async () => {
  let release!: () => void, started!: () => void;
  let reads = 0;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const h = await harness(
    async ({ path, params }) => {
      if (path === "/api/v3/song/detail") return songDetails(params);
      if (path === "/api/song/like/get") {
        if (++reads === 1) return { ids: [1] };
        started();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { ids: [2] };
      }
    },
    { signedIn: true },
  );
  await h.plugin.isLiked({ ids: ["1"] });
  const first = h.plugin.liked();
  await ready;
  const second = h.plugin.liked();
  const hearts = h.plugin.isLiked({ ids: ["1", "2"] });
  release();
  assert.deepEqual(
    (await first).tracks.map((t) => t.id),
    ["2"],
  );
  assert.deepEqual(
    (await second).tracks.map((t) => t.id),
    ["2"],
  );
  assert.deepEqual(await hearts, { 1: false, 2: true });
  assert.equal(reads, 2);
});

test("a failed liked refresh is reported and can be retried", async () => {
  let reads = 0;
  const h = await harness(
    ({ path, params }) => {
      if (path === "/api/v3/song/detail") return songDetails(params);
      if (++reads === 1) return { ids: [1] };
      if (reads === 2) throw new Error("offline");
      return { ids: [2] };
    },
    { signedIn: true },
  );
  await h.plugin.liked();
  await assert.rejects(h.plugin.liked(), /offline/);
  assert.deepEqual(
    (await h.plugin.liked()).tracks.map((t) => t.id),
    ["2"],
  );
});

test("logout during a liked refresh prevents hydration with the old account's IDs", async () => {
  let release!: () => void, started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const h = await harness(
    async ({ path }) => {
      if (path === "/api/logout") return {};
      assert.equal(path, "/api/song/like/get");
      started();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { ids: [1] };
    },
    { signedIn: true },
  );
  const pending = h.plugin.liked();
  await ready;
  await h.plugin.signOut();
  release();
  await assert.rejects(pending, /account changed/);
  assert.equal(
    h.calls.some((c) => c.path === "/api/v3/song/detail"),
    false,
  );
});

// Guest actions need the host's sign-in flow, not a misleading successful mutation.
test("signed-out mutations report the signIn error code without requesting the API", async () => {
  const h = await harness(() => assert.fail("Unexpected network request"));
  for (const action of [
    () => h.plugin.like({ id: "1", on: true }),
    () => h.plugin.createPlaylist({ name: "New" }),
    () => h.plugin.stationNext({ id: "heart" }),
    () => h.plugin.subscribeShow({ id: "1", on: true }),
  ])
    await assert.rejects(action(), { code: "signIn" });
});

// Manifest permissions stay limited to the API hosts and never request process access.
test("manifest loads a portable entry with only required network permissions", async () => {
  const manifest = JSON.parse(await readFile(`${pluginDirectory}/plugin.json`, "utf8"));
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(manifest.version, pkg.version);
  assert.match(manifest.minAppVersion, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  assert.deepEqual(manifest.permissions.network, ["music.163.com", "interfacepc.music.163.com"]);
  assert.equal(manifest.permissions.process, undefined);
  assert.equal(manifest.main, "index.js");
  assert.equal(manifest.imageSizes, undefined);
  assert.equal(manifest.requestHeaders, undefined);
});

// Covers on the image CDN must leave their size to the app, which fills in
// {size} for each place it shows them, replacing any size the API gave.
test("CDN covers ask the app for their size", async () => {
  const cdn = (id: number, picUrl: string) =>
    song(id, { al: { id: 20 + id, name: "Album", picUrl } });
  const h = await harness(({ path }) => {
    if (path === "/api/cloudsearch/pc")
      return { result: { songs: [song(1), song(2), song(3)], songCount: 3 } };
    if (path === "/api/v3/song/detail") {
      return {
        songs: [
          cdn(1, "http://p1.music.126.net/abc==/109951.jpg"),
          cdn(2, "https://p2.music.126.net/def==/109952.jpg?param=130y130"),
          cdn(3, "http://p.example/cover.jpg"),
        ],
        privileges: [],
      };
    }
  });
  const result = await h.plugin.search({ query: "a", kind: "tracks", offset: 0 });
  assert.deepEqual(
    result.tracks.map((t) => t.album.imageUrl),
    [
      "https://p1.music.126.net/abc==/109951.jpg?param={size}y{size}",
      "https://p2.music.126.net/def==/109952.jpg?param={size}y{size}",
      "https://p.example/cover.jpg",
    ],
  );
});
