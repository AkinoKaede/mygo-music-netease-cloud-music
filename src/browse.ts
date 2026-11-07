// SPDX-FileCopyrightText: 2026 Kaede Akino
// SPDX-License-Identifier: AGPL-3.0-or-later

import { web } from "./api.js";
import {
  allFollowedArtists,
  artistAlbums,
  artistBrowseHeader,
  artistDetail,
  artistLatest,
  followedArtists,
  savedAlbums,
} from "./catalog.js";
import { ARTIST_PAGE, PAGE } from "./constants.js";
import { charts, daily, dailyBlurb, pickedForYou, recommendedPlaylists } from "./discovery.js";
import { toPlaylist, toShow, trackIdentity } from "./models.js";
import { userPlaylists } from "./playlists.js";
import { shows } from "./podcasts.js";
import { recent } from "./recent.js";
import type { ServiceComment, ServicePlaylist, ServiceShow, ServiceUser } from "./service-types.js";
import { accountNow, load, requireAccount, session } from "./session.js";
import type { Artist, Browse, Section } from "./types.js";
import {
  date,
  fail,
  id,
  nextSection,
  offsetOf,
  picture,
  retrySection,
  route,
  tr,
} from "./utils.js";

export async function browse({ page }: { page: string }): Promise<Browse> {
  const url = new URL(page, "https://plugin.invalid/");
  const name = url.pathname.slice(1);
  const q = url.searchParams;
  const offset = offsetOf(Number(q.get("offset") || 0));
  if (name === "daily") {
    const tracks = await daily();
    return {
      title: tr("Daily Song Recommendations"),
      subtitle: tr("Daily Recommendations"),
      description: tr("{count} songs · {description}", {
        count: tracks.length,
        description: dailyBlurb(),
      }),
      sections: [{ tracks }],
    };
  }
  if (name === "recommended")
    return {
      title: tr("Recommended Playlists"),
      sections: [{ playlists: (await recommendedPlaylists()).map(toPlaylist) }],
    };
  if (name === "picked-for-you") {
    requireAccount();
    return {
      title: tr("Picked for You Today"),
      sections: [{ playlists: (await pickedForYou()).map(toPlaylist) }],
    };
  }
  if (name === "charts") {
    const lists = await charts();
    return {
      title: tr("Charts"),
      subtitle: tr("Updated Daily"),
      sections: [
        { title: tr("Official Charts"), playlists: lists.slice(0, 4) },
        ...(lists.length > 4 ? [{ title: tr("All Charts"), playlists: lists.slice(4) }] : []),
      ],
    };
  }
  if (name === "recent")
    return { title: tr("Recently Played"), sections: [{ tracks: await recent() }] };
  if (name === "saved-albums") {
    const result = await savedAlbums({ offset });
    return {
      title: tr("Saved Albums"),
      sections: [
        { albums: result.albums },
        ...nextSection(name, { offset: offset + PAGE }, result.more && result.albums.length),
      ],
    };
  }
  if (name === "following") {
    const result = await followedArtists(offset);
    return {
      title: tr("Followed Artists"),
      sections: [
        { artists: result.artists, empty: tr("No followed artists yet") },
        { title: tr("New Releases"), links: result.artists.map(artistLink) },
        ...nextSection(name, { offset: offset + PAGE }, result.more),
      ],
    };
  }
  if (name === "subscriptions")
    return {
      title: tr("Subscribed Podcasts"),
      sections: [{ shows: await shows(), empty: tr("No subscribed podcasts yet") }],
    };
  if (name === "podcasts") {
    const generation = session.epoch;
    const [subscriptions, picks, hot] = await Promise.allSettled([
      !offset && accountNow() ? shows() : Promise.resolve([]),
      !offset
        ? web<{ djRadios?: ServiceShow[] }>("/api/djradio/recommend/v1")
        : Promise.resolve<{ djRadios?: ServiceShow[] }>({}),
      web<{ djRadios?: ServiceShow[]; hasMore?: boolean }>("/api/djradio/hot/v1", {
        limit: PAGE,
        offset,
      }),
    ]);
    if (generation !== session.epoch) throw new Error(tr("The account changed. Reload this page."));
    const sections: Section[] = [];
    if (subscriptions.status === "fulfilled" && subscriptions.value.length) {
      sections.push({ title: tr("My Subscriptions"), shows: subscriptions.value });
    } else if (subscriptions.status === "rejected") {
      sections.push(retrySection(tr("My Subscriptions"), "subscriptions", subscriptions.reason));
    }
    if (picks.status === "fulfilled" && picks.value.djRadios?.length) {
      sections.push({ title: tr("Recommended Podcasts"), shows: picks.value.djRadios.map(toShow) });
    } else if (picks.status === "rejected") {
      sections.push(retrySection(tr("Recommended Podcasts"), "podcasts", picks.reason));
    }
    if (hot.status === "fulfilled") {
      if (hot.value.djRadios?.length)
        sections.push({ title: tr("Popular Podcasts"), shows: hot.value.djRadios.map(toShow) });
      sections.push(
        ...nextSection(
          name,
          { offset: offset + PAGE },
          hot.value.hasMore && hot.value.djRadios?.length,
        ),
      );
    } else
      sections.push(
        retrySection(tr("Popular Podcasts"), route("podcasts", { offset }), hot.reason),
      );
    return { title: tr("Podcasts"), sections };
  }
  if (name === "explore") {
    return {
      title: tr("Explore"),
      subtitle: tr("More from NetEase Cloud Music"),
      sections: [
        {
          title: tr("Recently Viewed or Searched Artists"),
          links: load("lastArtists", []).map(artistLink),
        },
        {
          title: tr("Top Comments"),
          links: load("recent", [])
            .slice(0, 20)
            .map((t) => ({
              title: t.name,
              subtitle: tr("Read Top Comments"),
              imageUrl: t.album?.imageUrl,
              page: route("hot-comments", { id: t.id }),
            })),
        },
      ],
    };
  }
  if (name === "profile") return profilePage(requireAccount().id);
  if (name === "profile-playlists") {
    return profilePlaylistsPage(
      q.has("id") ? id(q.get("id")) : requireAccount().id,
      q.get("kind"),
      offset,
    );
  }
  if (name === "user") return profilePage(id(q.get("id")));
  if (name === "artist-extra") {
    const aid = id(q.get("id")),
      generation = session.epoch;
    const [person, latest, records] = await Promise.allSettled([
      artistDetail(aid),
      artistLatest(aid, offset),
      artistAlbums(aid),
    ]);
    if (generation !== session.epoch) throw new Error(tr("The account changed. Reload this page."));
    if (person.status === "rejected") throw person.reason;
    return {
      ...artistBrowseHeader(person.value.artist),
      sections: [
        latest.status === "fulfilled"
          ? {
              title: tr("Latest Songs"),
              tracks: latest.value.tracks,
              empty: tr("No songs"),
              morePage: latest.value.more
                ? route("artist-latest", { id: aid, offset: offset + ARTIST_PAGE })
                : "",
            }
          : retrySection(
              tr("Latest Songs"),
              route("artist-latest", { id: aid, offset }),
              latest.reason,
            ),
        records.status === "fulfilled"
          ? {
              title: tr("Albums"),
              albums: records.value.albums,
              empty: tr("No albums"),
              morePage: records.value.more ? route("artist-albums", { id: aid, offset: PAGE }) : "",
            }
          : retrySection(tr("Albums"), route("artist-albums", { id: aid }), records.reason),
      ],
    };
  }
  if (name === "artist-latest" || name === "artist-albums") {
    const aid = id(q.get("id")),
      generation = session.epoch;
    const latest = name === "artist-latest";
    const [person, result] = await Promise.all([
      artistDetail(aid),
      latest ? artistLatest(aid, offset) : artistAlbums(aid, offset),
    ]);
    if (generation !== session.epoch) throw new Error(tr("The account changed. Reload this page."));
    return {
      ...artistBrowseHeader(person.artist),
      sections: [
        "tracks" in result
          ? { title: tr("Latest Songs"), tracks: result.tracks, empty: tr("No songs") }
          : { title: tr("Albums"), albums: result.albums, empty: tr("No albums") },
        ...nextSection(
          name,
          { id: aid, offset: offset + (latest ? ARTIST_PAGE : PAGE) },
          result.more,
        ),
      ],
    };
  }
  if (name === "hot-comments") {
    const result = await web<{
      comments?: ServiceComment[];
      hotComments?: ServiceComment[];
      total?: number;
      more?: boolean;
    }>(`/api/v1/resource/comments/${trackIdentity(q.get("id")).thread}`, { limit: 1, offset: 0 });
    return {
      title: tr("Top Comments"),
      subtitle: tr("Like and post comments from the Now Playing comments panel"),
      sections: (result.hotComments || []).map((c) => ({
        title: tr("{name} · {likes} likes", {
          name: c.user?.nickname || tr("Listener"),
          likes: c.likedCount || 0,
        }),
        links: [
          {
            title: c.content,
            subtitle: date(c.time),
            imageUrl: picture(c.user?.avatarUrl),
            page: route("user", { id: c.user!.userId }),
          },
        ],
      })),
    };
  }
  throw fail("unavailable", tr("Page not found"));
}

export function profileCount(value = 0) {
  if (host.language() !== "zh-CN") return String(value);
  if (value >= 1e8) return `${(value / 1e8).toFixed(1)}\u4ebf`;
  if (value >= 1e4) return `${(value / 1e4).toFixed(value < 1e6 ? 1 : 0)}\u4e07`;
  return String(value);
}

export function profilePlaylistGroups(lists: ServicePlaylist[], uid: string) {
  const own = accountNow()?.id === uid;
  const visible = own ? lists : lists.filter((playlist) => playlist.privacy !== 10);
  return {
    created: visible
      .filter((playlist) => String(playlist.creator?.userId) === uid && playlist.privacy !== 10)
      .map(toPlaylist),
    saved: visible.filter((playlist) => String(playlist.creator?.userId) !== uid).map(toPlaylist),
  };
}

export async function profilePlaylistsPage(uid: string, kind: string | null, offset: number) {
  if (kind !== "created" && kind !== "saved") throw fail("unavailable", tr("Page not found"));
  const generation = session.epoch;
  const groups = profilePlaylistGroups(await userPlaylists(uid), uid);
  if (generation !== session.epoch) throw new Error(tr("The account changed. Reload this page."));
  const playlists = groups[kind];
  const own = accountNow()?.id === uid;
  return {
    title: tr(kind === "created" ? "Created Playlists" : "Saved Playlists"),
    subtitle: playlists.length
      ? tr("{count} playlists", { count: playlists.length })
      : tr(kind === "created" ? "No public playlists" : "No saved playlists yet"),
    sections: [
      {
        playlists: playlists.slice(offset, offset + PAGE),
        empty: tr(kind === "created" ? "No public playlists" : "No saved playlists yet"),
      },
      ...nextSection(
        "profile-playlists",
        { ...(own ? {} : { id: uid }), kind, offset: offset + PAGE },
        offset + PAGE < playlists.length,
      ),
    ],
  };
}

export async function profilePage(uid: string) {
  const generation = session.epoch;
  const own = accountNow()?.id === uid;
  const [person, lists, subscriptions, artists] = await Promise.allSettled([
    web<{ profile?: ServiceUser }>(`/api/v1/user/detail/${uid}`),
    userPlaylists(uid),
    own ? shows() : Promise.resolve([]),
    own ? allFollowedArtists() : Promise.resolve([]),
  ]);
  if (generation !== session.epoch) throw new Error(tr("The account changed. Reload this page."));
  if (person.status === "rejected") throw person.reason;
  const p = person.value.profile;
  if (!p) throw fail("unavailable", tr("User not found"));
  const sections: Section[] = [];
  const retryPage = own ? "profile" : route("user", { id: uid });
  if (lists.status === "fulfilled") {
    const groups = profilePlaylistGroups(lists.value, uid);
    sections.push({
      title: tr("Created Playlists"),
      playlists: groups.created,
      empty: tr("No public playlists"),
    });
  } else {
    sections.push(retrySection(tr("Created Playlists"), retryPage, lists.reason));
  }
  if (own) {
    sections.push(
      subscriptions.status === "fulfilled"
        ? {
            title: tr("Subscribed Podcasts"),
            shows: subscriptions.value,
            empty: tr("No subscribed podcasts yet"),
          }
        : retrySection(tr("Subscribed Podcasts"), retryPage, subscriptions.reason),
    );
    sections.push(
      artists.status === "fulfilled"
        ? {
            title: tr("Followed Artists"),
            artists: artists.value,
            empty: tr("No followed artists yet"),
          }
        : retrySection(tr("Followed Artists"), retryPage, artists.reason),
    );
  }
  // The host places subtitle above the name and description lines below it.
  const stats = tr("Following {following} · Followers {followers}", {
    following: profileCount(p.follows || 0),
    followers: profileCount(p.followeds || 0),
  });
  return {
    title: p.nickname,
    imageUrl: picture(p.avatarUrl),
    subtitle: tr("User"),
    description: [stats, p.signature].filter(Boolean).join("\n"),
    sections,
  };
}

export function artistLink(a: Artist) {
  return {
    title: a.name,
    subtitle: tr("Latest Songs / All Albums"),
    imageUrl: a.imageUrl,
    page: route("artist-extra", { id: a.id }),
  };
}
