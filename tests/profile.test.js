import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./harness.js";

const playlist = (id, uid = 7, extra = {}) => ({
  id, name: `Playlist ${id}`, creator: { userId: uid }, ...extra,
});
const person = { userId: 7, nickname: "Listener", avatarUrl: "http://image.example/avatar",
  signature: "First line\nSecond line", follows: 3, followeds: 9 };

function profileResponse({ path }, lists = []) {
  if (path.startsWith("/api/v1/user/detail/")) return { profile: person };
  if (path === "/api/user/playlist") return { playlist: lists };
  if (path === "/api/djradio/get/subed") return { djRadios: [] };
  if (path === "/api/artist/sublist") return { data: [] };
}

// Liked songs must stay reachable as a fixed own playlist, not a saved playlist.
test("library keeps liked and private playlists with correct ownership", async () => {
  const lists = [
    playlist(1, 7, { specialType: 5 }), playlist(2), playlist(3, 7, { privacy: 10 }),
    playlist(4, 8, { subscribed: true }),
  ];
  const h = await harness(({ path }) => {
    if (path === "/api/user/playlist") return { playlist: lists };
    if (path === "/api/v6/playlist/detail") return { playlist: lists[0] };
  }, { signedIn: true });
  const result = await h.plugin.playlists();
  assert.deepEqual(result.map(p => [p.id, p.mine, p.fixed, p.saved]), [
    ["1", true, true, false], ["2", true, false, false],
    ["3", true, false, false], ["4", false, false, true],
  ]);
  const detail = await h.plugin.playlist({ id: "1" });
  assert.equal(detail.mine, true);
  assert.equal(detail.fixed, true);
});

// Hosts without fixed-playlist support must not mutate the liked-songs playlist.
test("fixed playlist mutations are rejected before sending any write", async () => {
  const h = await harness(({ path }) => {
    assert.equal(path, "/api/v6/playlist/detail");
    return { playlist: playlist(1, 7, { specialType: 5 }) };
  }, { signedIn: true });
  for (const action of [
    () => h.plugin.renamePlaylist({ id: "1", name: "New" }),
    () => h.plugin.deletePlaylist({ id: "1" }),
    () => h.plugin.addToPlaylist({ id: "1", trackIds: ["10"] }),
    () => h.plugin.removeFromPlaylist({ id: "1", trackIds: ["10"] }),
    () => h.plugin.movePlaylistTrack({ id: "1", from: 0, to: 1 }),
    () => h.plugin.savePlaylist({ id: "1", on: true }),
  ]) await assert.rejects(action(), { code: "unsupported" });
  assert.equal(h.calls.length, 6);
});

// The fixed-playlist guard must still allow ordinary playlist mutations.
test("ordinary playlists remain editable and saveable", async () => {
  const writes = [];
  const h = await harness(({ path, params }) => {
    if (path === "/api/v6/playlist/detail") return { playlist: playlist(2) };
    writes.push({ path, params });
    return {};
  }, { signedIn: true });
  await h.plugin.renamePlaylist({ id: "2", name: " Renamed " });
  await h.plugin.removeFromPlaylist({ id: "2", trackIds: ["10"] });
  await h.plugin.savePlaylist({ id: "2", on: true });
  await h.plugin.deletePlaylist({ id: "2" });
  assert.deepEqual(writes.map(w => w.path), [
    "/api/playlist/update/name", "/api/playlist/manipulate/tracks",
    "/api/playlist/subscribe", "/api/playlist/remove",
  ]);
  assert.equal(writes[0].params.name, "Renamed");
  assert.equal(writes[1].params.op, "del");
});

// A delayed editability check must not authorize a write under a different session.
test("logout during a playlist check prevents the pending mutation", async () => {
  let release, started;
  const ready = new Promise(resolve => { started = resolve; });
  const h = await harness(async ({ path }) => {
    if (path === "/api/logout") return {};
    assert.equal(path, "/api/v6/playlist/detail");
    started();
    await new Promise(resolve => { release = resolve; });
    return { playlist: playlist(2) };
  }, { signedIn: true });
  const pending = h.plugin.deletePlaylist({ id: "2" });
  const rejected = assert.rejects(pending, /account changed/i);
  await ready;
  await h.plugin.signOut();
  release();
  await rejected;
  assert.equal(h.calls.length, 2);
});

// The profile and every continuation must exclude private and saved playlists.
test("own profile uses native header fields and public-only playlist pagination", async () => {
  const publicLists = Array.from({ length: 51 }, (_, i) => playlist(i + 10));
  const lists = [playlist(1, 7, { privacy: 10 }), playlist(2, 8), ...publicLists];
  const h = await harness(call => profileResponse(call, lists), { signedIn: true });
  const page = await h.plugin.browse({ page: "profile" });
  assert.equal(page.imageUrl, "https://image.example/avatar");
  assert.equal(page.description, person.signature);
  assert.ok(!page.subtitle.includes(person.signature));
  assert.deepEqual(page.sections[0].playlists.map(p => p.id), publicLists.slice(0, 6).map(p => String(p.id)));
  assert.equal(page.sections.length, 3);
  assert.deepEqual(page.sections[1].shows, []);
  assert.deepEqual(page.sections[2].artists, []);
  assert.ok(page.sections[1].empty);
  assert.ok(page.sections[2].empty);
  const first = await h.plugin.browse({ page: page.sections[0].morePage });
  assert.deepEqual(first.sections[0].playlists.map(p => p.id), publicLists.slice(0, 50).map(p => String(p.id)));
  const last = await h.plugin.browse({ page: first.sections[1].links[0].page });
  assert.deepEqual(last.sections[0].playlists.map(p => p.id), ["60"]);
  assert.equal(last.sections.length, 1);
  assert.ok(h.calls.every(c => [
    "/api/v1/user/detail/7", "/api/user/playlist", "/api/djradio/get/subed", "/api/artist/sublist",
  ].includes(c.path)));
});

// A public user page must never fetch the current listener's private collections.
test("other users and guests only see publicly created playlists", async () => {
  for (const signedIn of [true, false]) {
    const h = await harness(call => {
      assert.ok(["/api/v1/user/detail/8", "/api/user/playlist"].includes(call.path));
      return profileResponse(call, [
        playlist(1, 8), playlist(2, 8, { privacy: 10 }), playlist(3, 9),
      ]);
    }, { signedIn });
    const page = await h.plugin.browse({ page: "user?id=8" });
    assert.equal(page.sections.length, 1);
    assert.deepEqual(page.sections[0].playlists.map(p => p.id), ["1"]);
    const continuation = await h.plugin.browse({ page: "profile-playlists?id=8&kind=created" });
    assert.deepEqual(continuation.sections[0].playlists.map(p => p.id), ["1"]);
  }
  const guest = await harness(() => assert.fail("Guest profile must not request data"));
  await assert.rejects(guest.plugin.browse({ page: "profile" }), { code: "signIn" });
});

// Empty collections need native empty states rather than disappearing sections.
test("empty profile keeps its sections without fabricated header content", async () => {
  const h = await harness(call => call.path.startsWith("/api/v1/user/detail/")
    ? { profile: { nickname: "Listener" } } : profileResponse(call), { signedIn: true });
  const page = await h.plugin.browse({ page: "profile" });
  assert.equal(page.imageUrl, "");
  assert.equal(page.description, "");
  for (const section of page.sections) {
    assert.ok(section.empty);
    assert.equal(section.morePage, undefined);
    assert.equal(section.links, undefined);
  }
  assert.equal(page.sections.length, 3);
});

// Failed collections must remain retryable and must not masquerade as empty.
test("profile section failures lead to fresh working retry pages", async () => {
  let failing = true;
  const h = await harness(call => {
    if (failing && !call.path.startsWith("/api/v1/user/detail/")) throw new Error("offline");
    return profileResponse(call, [playlist(1)]);
  }, { signedIn: true });
  const page = await h.plugin.browse({ page: "profile" });
  failing = false;
  for (const section of page.sections) {
    assert.equal(section.empty, undefined);
    const target = section.links[0].page;
    assert.ok(new URL(target, "https://plugin.invalid/").searchParams.has("retry"));
    const recovered = await h.plugin.browse({ page: target });
    assert.ok(recovered.sections.length);
    assert.equal(recovered.sections[0].links, undefined);
  }
});

// A profile or continuation started before logout must not expose the old account.
test("in-flight profile results are rejected after logout or account switch", async () => {
  for (const route of ["profile", "profile-playlists?kind=created"]) {
    for (const switchAccount of [false, true]) {
      let release, started;
      const ready = new Promise(resolve => { started = resolve; });
      const h = await harness(async call => {
        if (call.path === "/api/logout") return {};
        if (call.path === "/api/nuser/account/get") return { profile: { userId: 8, nickname: "Next" } };
        if (call.path === "/api/user/playlist") {
          started();
          await new Promise(resolve => { release = resolve; });
        }
        return profileResponse(call, [playlist(1)]);
      }, { signedIn: true, settings: { loginMethod: "web" } });
      const pending = h.plugin.browse({ page: route });
      const rejected = assert.rejects(pending, /account changed/i);
      await ready;
      if (switchAccount) await h.plugin.signIn();
      else await h.plugin.signOut();
      release();
      await rejected;
    }
  }
});

// Every podcast surface must supply the same working publisher route.
test("podcast publisher links work in discovery, subscriptions, search and detail", async () => {
  const pod = { id: 30, name: "Podcast", dj: { userId: 8, nickname: "Host" } };
  const h = await harness(call => {
    if (call.path === "/api/djradio/v2/get") return { data: pod };
    if (call.path === "/api/dj/program/byradio") return { programs: [] };
    if (call.path.startsWith("/api/djradio/")) return { djRadios: [pod] };
    if (call.path === "/api/cloudsearch/pc") return { result: { djRadios: [pod], djRadiosCount: 1 } };
    assert.ok(["/api/v1/user/detail/8", "/api/user/playlist"].includes(call.path));
    return profileResponse(call);
  }, { signedIn: true });
  const discovery = await h.plugin.browse({ page: "podcasts" });
  const mapped = [
    ...discovery.sections.flatMap(s => s.shows || []),
    ...await h.plugin.shows(),
    ...(await h.plugin.search({ query: "Host", kind: "shows" })).shows,
    (await h.plugin.show({ id: "30" })).show,
  ];
  assert.equal(mapped.length, 6);
  for (const show of mapped) assert.equal(show.publisherPage, "user?id=8");
  const publisher = await h.plugin.browse({ page: mapped[0].publisherPage });
  assert.equal(publisher.sections.length, 1);
});

// Broken publisher IDs must not make otherwise playable podcasts unavailable.
test("invalid or absent publisher IDs leave the host name without a link", async () => {
  for (const userId of [undefined, null, 0, -1, "abc", "8&other=1", Number.MAX_SAFE_INTEGER + 1]) {
    const h = await harness(({ path }) => {
      if (path === "/api/djradio/v2/get") return { data: { id: 30, dj: { userId, nickname: "Host" } } };
      if (path === "/api/dj/program/byradio") return { programs: [] };
    });
    const { show } = await h.plugin.show({ id: "30" });
    assert.equal(show.publisher, "Host");
    assert.equal(show.publisherPage, "");
  }
});
