// SPDX-FileCopyrightText: 2026 Kaede Akino
// SPDX-License-Identifier: AGPL-3.0-or-later

export { account, setSetting, signIn, signOut } from "./auth.js";
export { browse } from "./browse.js";
export { album, artist, followArtist, saveAlbum, savedAlbums } from "./catalog.js";
export { comments, likeComment, postComment } from "./comments.js";
export { home } from "./discovery.js";
export { lyrics, stream } from "./playback.js";
export {
  addToPlaylist,
  createPlaylist,
  deletePlaylist,
  isLiked,
  like,
  likeEpisode,
  liked,
  movePlaylistTrack,
  playlist,
  playlists,
  removeFromPlaylist,
  renamePlaylist,
  savePlaylist,
} from "./playlists.js";
export { show, shows, subscribeShow } from "./podcasts.js";
export { stationNext, stations } from "./radio.js";
export { played, recent } from "./recent.js";
export { search, suggest } from "./search.js";
