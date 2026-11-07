# NetEase Cloud Music for MyGo Music

Plays NetEase Cloud Music in [MyGo Music](https://github.com/egoist/mygo-music). It isn't affiliated with or endorsed by NetEase, uses NetEase's private API, and may stop working at any time.

## Install

Requires **MyGo Music 0.1.20 or later**, which fills in the size of each cover and avatar as it shows them.

Install with the deeplink:

[Install NetEase Cloud Music](mygo-music://install-plugin?repo=AkinoKaede/mygo-music-netease-cloud-music)

Or paste the GitHub URL in **Settings > Plugins > +**:

[https://github.com/AkinoKaede/mygo-music-netease-cloud-music](https://github.com/AkinoKaede/mygo-music-netease-cloud-music)

No extra programs or API server are needed.

To get your library, select NetEase Cloud Music and click **Sign In**.

## Signing In

By default, scan the QR code with the NetEase Cloud Music app and confirm on your phone. If QR sign-in doesn't work, set **Sign-in Method** to `web` in the plugin's settings and sign in through the window that opens.

The session is kept unencrypted in the host's plugin data files, not the system keychain. Session cookies are sent only to `music.163.com` and `interfacepc.music.163.com`. Signing out forgets the local session and attempts to end it on NetEase's side.

## What Works

- Signed out: recommended playlists, charts, search, albums, artists, public playlists, podcast discovery, comments and lyrics. Playback depends on the track's availability.
- Signed in: daily recommendations, your library, playlist editing, likes, saved albums, artist follows, podcast subscriptions, recently played music, Personal FM and Heart Mode.
- Comments: read, like and post comments.
- Not available: video playback, full image galleries and FM dislike/trash actions.

The sidebar has **For You**, **Daily Recommendations**, **Personal FM**, **Charts** and **Podcasts**, followed by your own and saved playlists. Your liked-songs playlist appears under **My Playlists**, rather than as a separate navigation item. It can be played but not edited like an ordinary playlist; use song hearts to like or unlike songs.

MyGo Music hides editing controls for the fixed liked-songs playlist. The plugin also rejects those operations; use song hearts instead.

When MyGo Music refreshes the first page of liked songs, the plugin fetches fresh IDs instead of reusing its local cache. Pagination and song hearts share the refreshed list.

**For You** brings together daily recommendations, **Picked for You Today** when signed in, official charts and public recommended playlists.

Open **My Page** from the account menu to see your avatar, signature, publicly created playlists, podcast subscriptions and followed artists. Other listeners' pages show only their publicly created playlists. Private playlists remain available in your own library, not on your profile.

Profiles show a User label above the name, with following/follower counts and the signature below it. Each collection is shown in full on the profile rather than as a six-item preview. Layout, card styles and loading visuals are provided by MyGo Music.

Click a podcast's host name to open their page when NetEase supplies a valid user ID.

Native artist pages show popular songs in NetEase's order and load the full album catalog, rather than stopping at 100 albums. The native artist interface does not currently expose biographies, aliases, latest-song tabs or activity feeds. Supplementary artist browse routes show biographies, aliases, song/album counts and paginated latest songs/albums, but are not linked from the native artist page.

## Interface Alignment

- Home keeps the original section order and independent retry links. Greetings, dates, card artwork and animations come from MyGo Music.
- Daily recommendations use the same songs and explanation on Home and the standalone page. The plugin supplies the card-page title and subtitle supported since MyGo Music 0.1.17.
- Playlists preserve service order, creator information, descriptions and available song metadata. The host controls the header and editing UI; play counts, chart-specific headers and an inline Heart Mode button are not exposed by the playlist interface.
- Personal FM has Recommended, Familiar and Explore modes. Heart Mode starts with a playable liked song, then continues with similar music. The host groups all four as stations: the original separate Heart Mode card and FM trash action cannot be reproduced. The plugin cannot read the current playback queue to prefer the currently playing liked song as its seed, or detect every stop/restart of Heart Mode.

## How It Plays

Audio streams directly from NetEase. Subscription, purchase and regional restrictions still apply; trial previews are not played as full tracks.

The plugin accepts the host's MP3, FLAC, OGG, WAV, M4A and AAC stream types. Requests still prefer MP3 or FLAC according to quality; accepting more formats does not change what NetEase makes available. M4A decoding depends on the codec inside it (ALAC or AAC-LC); HE-AAC is not supported by MyGo Music 0.1.19.

Leave **Quality Override** empty to follow the player, or enter `standard`, `higher`, `exhigh`, `lossless` or `hires`. The quality served depends on your account and the recording.

## Lyrics

Word-timed lyrics and translations come from NetEase when available, with line-timed lyrics as a fallback. Podcast transcription is handled by MyGo Music.

## Language

Follows MyGo Music's language setting: English or Simplified Chinese. Music titles, comments and other service content keep their original language.

## License

Licensed under the GNU Affero General Public License version 3 or later (`AGPL-3.0-or-later`). See [LICENSE](LICENSE) for the full license text.
