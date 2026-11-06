# NetEase Cloud Music for MyGo Music

Plays NetEase Cloud Music in [MyGo Music](https://github.com/egoist/mygo-music). It isn't affiliated with or endorsed by NetEase, uses NetEase's private API, and may stop working at any time.

## Install

Requires **MyGo Music 0.1.8 or later**.

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
- Comments: read, like and post comments; browse top comments through **Explore**.
- Not available: video playback, full image galleries and FM dislike/trash actions.

**For You** brings together daily recommendations, official charts and recommended playlists. Sign in to see playlist recommendations picked for your account. **My Profile** has your playlists, podcast subscriptions, followed artists, saved albums and recently played music.

**Explore** has artists' latest songs, albums and top comments.

## How It Plays

Audio streams directly from NetEase. Subscription, purchase and regional restrictions still apply; trial previews are not played as full tracks.

Leave **Quality Override** empty to follow the player, or enter `standard`, `higher`, `exhigh`, `lossless` or `hires`. The quality served depends on your account and the recording.

## Lyrics

Word-timed lyrics and translations come from NetEase when available, with line-timed lyrics as a fallback. Podcast transcription is handled by MyGo Music.

## Language

Follows MyGo Music's language setting: English or Simplified Chinese. Music titles, comments and other service content keep their original language.

## License

Licensed under the GNU Affero General Public License version 3 or later (`AGPL-3.0-or-later`). See [LICENSE](LICENSE) for the full license text.
