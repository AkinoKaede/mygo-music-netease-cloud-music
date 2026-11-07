# NetEase Cloud Music for MyGo Music

A NetEase Cloud Music plugin for [MyGo Music](https://github.com/egoist/mygo-music). No API server or extra programs are needed.

## Install

[Install in MyGo Music](mygo-music://install-plugin?repo=AkinoKaede/mygo-music-netease-cloud-music), or add this repository in **Settings > Plugins > +**:

```text
https://github.com/AkinoKaede/mygo-music-netease-cloud-music
```

Use the plugin ZIP attached to a release for manual installation, not GitHub's source ZIP. The minimum supported MyGo Music version is listed in [`plugin.json`](plugin.json) as `minAppVersion`.

## Use

- **Sign in:** scan the QR code with the NetEase Cloud Music app. If needed, set **Sign-in Method** to `web` for website sign-in.
- **Browse and play:** search, playlists, albums, artists, charts, podcasts, lyrics and comments. Signing in adds your library, daily recommendations, likes, playlist editing, Personal FM and Heart Mode.
- **Quality:** leave **Quality Override** empty to follow the player, or choose `standard`, `higher`, `exhigh`, `lossless` or `hires`.
- **Language:** follows MyGo Music's English or Simplified Chinese setting.

Subscription, purchase and regional restrictions still apply. Trial previews are not played as full songs. Liked songs are managed with song hearts, not playlist editing. Video playback and FM dislike/trash actions are not supported.

Sessions are stored **unencrypted** in the host's plugin data files, not the system keychain. Session cookies go only to `music.163.com` and `interfacepc.music.163.com`.

## Development

Source and tests use TypeScript. The build produces one standalone JavaScript module plus the plugin manifest and locale files.

```sh
pnpm install --frozen-lockfile
pnpm check
```

Install `dist/plugin/` locally, or use the verified ZIP in `dist/release/`.

To prepare a release, run `pnpm version:set <version>`, commit and push the changes, then run **Actions > Draft Release > Run workflow** on `main`. The workflow creates a draft with the installation ZIP and checksum; review it and publish manually. It never publishes automatically.

## License

[AGPL-3.0-or-later](LICENSE). Not affiliated with or endorsed by NetEase. This plugin uses private APIs that may change without notice.
