# NetEase Cloud Music for MyGo Music

Plays NetEase Cloud Music in [MyGo Music](https://github.com/egoist/mygo-music). It isn't affiliated with or endorsed by NetEase, uses NetEase's private API, and may stop working at any time.

## Install

In **Settings > Plugins > +**, install this folder from your computer. You can also choose **Show Plugins Folder** and place this folder there, with `plugin.json` and `index.js` at its root.

No build step, external API server, Node.js installation or process permission is needed to run the plugin.

To get your library, select NetEase Cloud Music and click **Sign In**.

## Signing In

By default, scan the QR code with the NetEase Cloud Music app and confirm on your phone. If QR sign-in doesn't work, set **Sign-in Method** to `web` in the plugin's settings and sign in through the window that opens.

The session is kept unencrypted in the host's plugin data files, not the system keychain. Session cookies are sent only to `music.163.com` and `interfacepc.music.163.com`. Signing out forgets the local session and attempts to end it on NetEase's side.

## Features

- Signed out: recommended playlists, charts, search, albums, artists, public playlists, podcast discovery, comments and lyrics. Playback depends on the track's availability.
- Signed in: daily recommendations, your playlists and liked songs, saved albums, followed artists, subscribed podcasts and recently played music.
- Library actions: create, rename and delete playlists; add, remove and reorder songs; save playlists and albums; follow artists; subscribe to podcasts; like songs and episodes.
- Radio: Personal FM, Familiar, Explore and Heart Mode.
- Comments: read, like and post comments. Top comments are available through **Explore** for recently played tracks.
- Extra pages: find people, browse user profiles, see artist releases and read updates. **Find People** uses your last music search, or **People Search Query** in the plugin's settings.

The plugin supplies data to MyGo Music's native UI. Playback controls, queues, shuffle, repeat, audio caching, session restore, the notch player and on-device podcast captions are provided by the host.

## How It Plays

Audio streams directly from NetEase's media servers. The plugin requests complete tracks and rejects trial previews; it does not bypass subscription, purchase or regional restrictions.

Leave **Quality Override** empty to follow the player: `standard`, `high` and `lossless` map to NetEase's `standard`, `exhigh` and `lossless`. To request a specific level, enter `standard`, `higher`, `exhigh`, `lossless` or `hires`.

The quality actually served depends on your account and the recording. NetEase may return a lower level. Gain and peak metadata are passed to the host for loudness normalization.

## Lyrics

Uses NetEase's word-timed YRC lyrics and translations when available, with plain LRC as a fallback. Podcast transcription is handled by MyGo Music, not the plugin.

## Limitations

- Plugin text is English. Chinese source wording is retained in JavaScript comments for a possible future localization pass.
- The host's plugin API cannot reproduce every interaction from the original client. People search and artist updates use browse pages rather than dedicated tabs.
- Updates show text, the first image and shared music. Full image galleries, video playback and FM dislike/trash actions are not implemented.
- Comments from the service, music metadata and other user-generated content retain their original language.
- Offline protocol and behavior tests pass, but signed-in live API behavior and end-to-end desktop UI have not yet been fully verified.

## Development

Node.js 22 or newer is needed only for tests. There are no npm dependencies to install.

```bash
npm run check
```

This checks JavaScript syntax and runs mocked tests for authentication, request encryption, pagination, playlist editing, podcast IDs, stream quality and lyrics. It does not contact NetEase.

## License

Licensed under the GNU Affero General Public License version 3 or later (`AGPL-3.0-or-later`). See [LICENSE](LICENSE) for the full license text.
