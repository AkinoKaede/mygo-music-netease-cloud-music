// Adapted from the mygo-cloudmusic NetEase client; see README.md for attribution.
// This is deliberately one ES module: MyGo compiles the entry without a bundler.
const SITE = "https://music.163.com";
const EAPI = "https://interfacepc.music.163.com";
const EAPI_KEY = "e82ckenh8dichen8";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const EAPI_UA = "NeteaseMusic 9.0.90/5038 (iPhone; iOS 16.2; zh_CN)";
const PAGE = 50;
const LEVELS = ["standard", "higher", "exhigh", "lossless", "hires"];
const load = (key, fallback) => host.storage.get(key) ?? fallback;
const save = (key, value) => host.storage.set(key, value);
let epoch = 0;
let likedCache = null;
let likedPending = null;
let likesRevision = 0;
let heart = null;
let loginPending = null;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
function check(data, path, allowed = [200]) {
  if (!allowed.includes(Number(data?.code))) {
    const code = Number(data?.code);
    throw fail(code === 301 || code === 302 || code === 401 ? "signIn" : "",
      /* zh-CN: 网易云请求错误 */ `NetEase ${path}: ${data?.message || data?.msg || /* zh-CN: 请求失败 */ "Request failed"} (${code})`);
  }
  return data;
}
function id(value) {
  const text = String(value);
  if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text))) {
    throw fail("unavailable", /* zh-CN: 无效的网易云 ID */ "Invalid NetEase ID");
  }
  return text;
}
function offsetOf(value = 0) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(/* zh-CN: 无效的分页位置 */ "Invalid page offset");
  return value;
}
function https(value = "") {
  return String(value || "").replace(/^http:\/\//, "https://");
}
function date(value) {
  return value > 0 ? new Date(value).toISOString().slice(0, 10) : "";
}
function route(page, params = {}) {
  const query = new URLSearchParams(params).toString();
  return page + (query ? `?${query}` : "");
}
function nextSection(page, params, more) {
  return more ? [{ links: [{ title: /* zh-CN: 下一页 */ "Next Page", page: route(page, params) }] }] : [];
}
function accountNow() { return load("account", null); }
function requireAccount() {
  const me = accountNow();
  if (!me || !load("cookies", {}).MUSIC_U) throw fail("signIn", /* zh-CN: 请先登录网易云音乐 */ "Sign in to NetEase Cloud Music first");
  return me;
}
function resetSession() {
  epoch++;
  likesRevision++;
  likedCache = likedPending = heart = null;
  for (const key of ["cookies", "account", "recent", "lastArtists"]) host.storage.remove(key);
}
function cookieHeader(cookies = load("cookies", {})) {
  return Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ");
}
function storeCookies(headers, generation) {
  if (generation !== epoch) return;
  const values = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : (headers.get("set-cookie") || "").split(/,(?=\s*[^;,\s]+=)/);
  const cookies = load("cookies", {});
  let changed = false;
  for (const line of values) {
    const match = /^\s*(MUSIC_U|__csrf|NMTID)=([^;]*)/.exec(line);
    if (!match) continue;
    if (!match[2] || /;\s*max-age=0(?:;|$)/i.test(line)) delete cookies[match[1]];
    else cookies[match[1]] = match[2];
    changed = true;
  }
  if (changed) save("cookies", cookies);
}
async function request(url, options, generation = epoch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, redirect: "error" });
    if (!response.ok) throw new Error(/* zh-CN: 网易云网络请求失败 */ `NetEase request failed (HTTP ${response.status})`);
    const result = await response.json();
    storeCookies(response.headers, generation);
    return result;
  } finally {
    clearTimeout(timeout);
  }
}
async function web(path, data = {}, method = "GET", options = {}) {
  const params = new URLSearchParams(data);
  const csrf = load("cookies", {}).__csrf;
  if (csrf && method === "POST") params.set("csrf_token", csrf);
  const query = params.toString();
  const result = await request(SITE + path + (method === "GET" && query ? `?${query}` : ""), {
    method,
    headers: {
      "User-Agent": UA, Referer: `${SITE}/`,
      Cookie: options.cookie ?? cookieHeader(),
      ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    ...(method === "POST" ? { body: query } : {}),
  }, options.generation ?? epoch);
  return check(result, path);
}
function deviceID() {
  let device = load("device", "");
  if (!device) {
    // This is a stable client identifier, not a credential.
    device = Array.from({ length: 52 }, () => Math.floor(Math.random() * 16).toString(16)).join("").toUpperCase();
    save("device", device);
  }
  return device;
}
async function eapi(path, data = {}, allowed = [200]) {
  const cookies = load("cookies", {});
  const header = {
    osver: "Microsoft-Windows-10-Professional-build-19045-64bit",
    deviceId: deviceID(), os: "pc", appver: "3.1.17.204416",
    versioncode: "140", mobilename: "", buildver: String(Math.floor(Date.now() / 1000)),
    resolution: "1920x1080", channel: "netease",
    requestId: `${Date.now()}_${String(Math.floor(Math.random() * 1000)).padStart(4, "0")}`,
    __csrf: cookies.__csrf || "",
  };
  for (const key of ["MUSIC_U", "NMTID"]) if (cookies[key]) header[key] = cookies[key];
  const text = JSON.stringify({ ...data, header, e_r: false });
  const digest = host.crypto.md5(`nobody${path}use${text}md5forencrypt`);
  const plain = `${path}-36cd479b6b5-${text}-36cd479b6b5-${digest}`;
  const params = host.crypto.aesEcbEncrypt(EAPI_KEY, plain).toUpperCase();
  const result = await request(EAPI + path.replace(/^\/api\//, "/eapi/"), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded", "User-Agent": EAPI_UA,
      Cookie: Object.entries(header).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("; "),
    },
    body: new URLSearchParams({ params }).toString(),
  });
  return check(result, path, allowed);
}

export async function account() {
  if (!load("cookies", {}).MUSIC_U) return null;
  const generation = epoch;
  let result;
  try {
    result = await web("/api/nuser/account/get");
  } catch (error) {
    if (error.code !== "signIn") throw error;
    if (generation === epoch) resetSession();
    return null;
  }
  if (generation !== epoch) return null;
  const p = result.profile;
  if (!p?.userId) { resetSession(); return null; }
  const me = { id: String(p.userId), name: p.nickname, imageUrl: https(p.avatarUrl) };
  save("account", me);
  return me;
}
export function signIn() {
  if (!loginPending) {
    loginPending = login().finally(() => { loginPending = null; });
  }
  return loginPending;
}
async function login() {
  resetSession();
  const generation = epoch;
  const active = () => {
    if (generation !== epoch) throw new Error(/* zh-CN: 登录已取消 */ "Sign-in cancelled");
  };
  if (host.setting("loginMethod") === "web") {
    const result = await host.webSignIn({
      url: `${SITE}/`, cookiesOf: `${SITE}/`, until: ["MUSIC_U"], userAgent: UA,
    });
    active();
    const cookies = {};
    for (const part of result.cookie.split(";")) {
      const match = /^\s*(MUSIC_U|__csrf|NMTID)=(.*)$/.exec(part);
      if (match) cookies[match[1]] = match[2];
    }
    save("cookies", cookies);
  } else {
    const started = Date.now();
    const key = (await eapi("/api/login/qrcode/unikey", { type: 3 })).unikey;
    if (!key) throw new Error(/* zh-CN: 网易云未返回登录二维码 */ "NetEase did not return a sign-in QR code");
    active();
    const qr = `${SITE}/login?codekey=${encodeURIComponent(key)}`;
    host.signInPrompt({ qr, text: /* zh-CN: 请用网易云音乐 App 扫码登录 */ "Scan with the NetEase Cloud Music app to sign in" });
    let confirmed = false;
    while (Date.now() - started < 240000) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      active();
      const result = await eapi("/api/login/qrcode/client/login", { key, type: 3 }, [800, 801, 802, 803]);
      active();
      if (result.code === 800) throw new Error(/* zh-CN: 二维码已过期，请重新登录 */ "The QR code expired. Please sign in again.");
      if (result.code === 802) host.signInPrompt({ qr, text: /* zh-CN: 扫码成功，请在手机上确认登录 */ "Code scanned. Confirm sign-in on your phone." });
      if (result.code === 803) { confirmed = true; break; }
    }
    if (!confirmed) throw new Error(/* zh-CN: 登录超时，请重试 */ "Sign-in timed out. Please try again.");
  }
  active();
  const me = await account();
  if (!me) throw new Error(/* zh-CN: 未取得有效登录态，请重试或在设置中改用 web 登录 */ "No valid session received. Try again or choose web sign-in in plugin settings.");
  host.signInPrompt({ text: /* zh-CN: 已登录：用户名 */ `Signed in as ${me.name}` });
  return me;
}
export async function signOut() {
  const cookie = cookieHeader();
  resetSession();
  // A late logout/QR response must never restore cookies after signing out.
  try { await web("/api/logout", {}, "POST", { cookie, generation: -1 }); }
  catch { /* Local sign-out still succeeds while offline. */ }
}
export function setSetting({ key, value }) {
  if (key === "quality" && value && !LEVELS.includes(value)) {
    throw fail("setup", /* zh-CN: 音质应为 standard / higher / exhigh / lossless / hires，或留空 */ "Quality must be standard / higher / exhigh / lossless / hires, or empty");
  }
  if (key === "loginMethod" && value && !["qr", "web"].includes(value)) {
    throw fail("setup", /* zh-CN: 登录方式应为 qr / web，或留空 */ "Sign-in method must be qr / web, or empty");
  }
}

function toArtist(a = {}) {
  return { id: a.id ? String(a.id) : "", name: a.name || "",
    imageUrl: https(a.img1v1Url || a.picUrl), following: !!a.followed };
}
function toAlbum(a = {}) {
  return {
    id: a.id ? String(a.id) : "", name: a.name || "", imageUrl: https(a.picUrl),
    artists: (a.artists || (a.artist ? [a.artist] : [])).map(toArtist),
    released: date(a.publishTime), saved: !!(a.isSub || a.subscribed),
  };
}
function toTrack(t, privilege = t.privilege) {
  return {
    id: String(t.id), name: t.name || "", artists: (t.ar || t.artists || []).map(toArtist),
    album: toAlbum(t.al || t.album), duration: t.dt ?? t.duration ?? 0,
    url: `${SITE}/song?id=${t.id}`,
    unavailable: privilege ? privilege.st < 0 || privilege.pl <= 0 : t.fee === 1 || t.fee === 4,
  };
}
function toPlaylist(p) {
  return {
    id: String(p.id), name: p.name || "", imageUrl: https(p.coverImgUrl || p.picUrl),
    description: p.description || "", owner: p.creator?.nickname || "",
    trackCount: p.trackCount || 0,
    mine: !!accountNow() && String(p.creator?.userId) === accountNow().id && p.specialType !== 5,
    saved: !!p.subscribed,
  };
}
function toShow(s) {
  return {
    id: String(s.id), name: s.name, imageUrl: https(s.picUrl),
    description: s.desc || "", publisher: s.dj?.nickname || "",
    episodeCount: s.programCount || 0, subscribed: !!s.subed,
  };
}
function toEpisode(p, show) {
  return {
    id: `program:${id(p.id)}:${id(p.mainSong.id)}`, name: p.name,
    artists: show.dj?.nickname ? [{ id: "", name: show.dj.nickname }] : [],
    album: { id: `show:${show.id}`, name: show.name, imageUrl: https(p.coverUrl || show.picUrl) },
    duration: p.duration || p.mainSong.duration || 0, showId: String(show.id),
    description: p.description || "", published: date(p.createTime),
    url: `${SITE}/program?id=${p.id}`,
  };
}
function trackIdentity(value) {
  const match = /^program:(\d+):(\d+)$/.exec(String(value));
  if (match) return { program: id(match[1]), audio: id(match[2]), thread: `A_DJ_1_${id(match[1])}` };
  const song = id(value);
  return { audio: song, thread: `R_SO_4_${song}` };
}
async function details(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 400) {
    const batch = ids.slice(i, i + 400).map(id);
    const result = await eapi("/api/v3/song/detail", { c: JSON.stringify(batch.map(n => ({ id: Number(n) }))) });
    const privileges = new Map((result.privileges || []).map(p => [String(p.id), p]));
    const tracks = new Map((result.songs || []).map(t => [String(t.id), toTrack(t, privileges.get(String(t.id)))]));
    for (const n of batch) if (tracks.has(n)) out.push(tracks.get(n));
  }
  return out;
}
async function hydrate(songs) {
  if (!songs?.length) return [];
  // Keep unavailable entries visible, but prefer the eapi's account-aware privileges.
  const tracks = await details(songs.map(t => t.id));
  const byID = new Map(tracks.map(t => [t.id, t]));
  return songs.map(t => byID.get(String(t.id)) || toTrack(t));
}
async function daily() {
  requireAccount();
  const result = await web("/api/v3/discovery/recommend/songs");
  return hydrate(result.data?.dailySongs || []);
}
async function featured() {
  if (accountNow()) return (await web("/api/v1/discovery/recommend/resource")).recommend || [];
  return (await web("/api/personalized/playlist", { limit: 30 })).result || [];
}
export async function home() {
  const sections = [];
  if (accountNow()) {
    try { sections.push({ title: /* zh-CN: 每日推荐 */ "Daily Recommendations", tracks: await daily(), morePage: "daily" }); }
    catch (error) { sections.push({ title: error.message, links: [{ title: /* zh-CN: 重试每日推荐 */ "Retry Daily Recommendations", page: "daily" }] }); }
  }
  try { sections.push({ title: /* zh-CN: 推荐歌单 */ "Recommended Playlists", playlists: (await featured()).map(toPlaylist) }); }
  catch (error) { sections.push({ title: error.message, links: [{ title: /* zh-CN: 重试推荐歌单 */ "Retry Recommended Playlists", page: "recommended" }] }); }
  sections.push({ title: /* zh-CN: 为你而来 */ "Made for You", stations: stations() });
  sections.push({ title: /* zh-CN: 发现更多 */ "Discover More", links: [
    { title: /* zh-CN: 排行榜 */ "Charts", subtitle: /* zh-CN: 热门、飙升与新歌 */ "Trending, rising and new music", page: "charts" },
    { title: /* zh-CN: 发现播客 */ "Discover Podcasts", subtitle: /* zh-CN: 推荐与热门节目 */ "Recommended and popular shows", page: "podcasts" },
    { title: /* zh-CN: 探索更多 */ "Explore", subtitle: /* zh-CN: 用户、歌手新作与动态 */ "People, new releases and artist updates", page: "explore" },
  ] });
  return { title: /* zh-CN: 发现音乐 */ "Discover Music", subtitle: accountNow() ? /* zh-CN: 你好，用户名 */ `Hello, ${accountNow().name}` : /* zh-CN: 登录后获取每日推荐与个人音乐库 */ "Sign in for daily recommendations and your music library", sections };
}

const SEARCH = {
  tracks: [1, "songs", "songCount", toTrack],
  albums: [10, "albums", "albumCount", toAlbum],
  artists: [100, "artists", "artistCount", toArtist],
  playlists: [1000, "playlists", "playlistCount", toPlaylist],
  shows: [1009, "djRadios", "djRadiosCount", toShow],
};
export async function search({ query, kind = "tracks", offset = 0 }) {
  const shape = SEARCH[kind];
  if (!shape) throw fail("unsupported", /* zh-CN: 播放器不支持此搜索类型，请从探索更多搜索用户 */ "This search type is not supported. Find people from Explore.");
  offsetOf(offset);
  query = query.trim();
  if (!query) return { [kind]: [], more: false };
  save("lastQuery", query);
  const result = (await web("/api/cloudsearch/pc", { s: query, type: shape[0], limit: PAGE, offset, total: true })).result || {};
  const raw = result[shape[1]] || [];
  const items = kind === "tracks" ? await hydrate(raw) : raw.map(shape[3]);
  if (kind === "artists" && offset === 0) save("lastArtists", items.slice(0, 20));
  return { [kind]: items, more: raw.length > 0 && offset + raw.length < (result[shape[2]] || 0) };
}
export async function suggest({ query }) {
  if (!query.trim()) return [];
  const result = (await web("/api/search/suggest/web", { s: query })).result || {};
  return [...new Set((result.order || ["songs", "artists", "albums", "playlists"])
    .flatMap(key => (result[key] || []).map(item => item.name)).filter(Boolean))].slice(0, 12);
}

async function userPlaylists(uid) {
  const all = [];
  for (let offset = 0; ; offset += 200) {
    const result = await web("/api/user/playlist", { uid: id(uid), limit: 200, offset });
    const page = result.playlist || [];
    all.push(...page);
    if (!result.more || !page.length) return all;
  }
}
export async function playlists() {
  return (await userPlaylists(requireAccount().id)).map(toPlaylist);
}
async function playlistRaw(pid) {
  const result = await web("/api/v6/playlist/detail", { id: id(pid), n: 1000 });
  if (!result.playlist) throw fail("unavailable", /* zh-CN: 歌单不存在或无权访问 */ "This playlist is missing or private");
  return result.playlist;
}
export async function playlist({ id: pid }) {
  const p = await playlistRaw(pid);
  const tracks = p.trackIds?.length ? await details(p.trackIds.map(t => t.id)) : await hydrate(p.tracks || []);
  return { ...toPlaylist(p), tracks };
}
async function likedIDs() {
  const me = requireAccount();
  if (likedCache && Date.now() - likedCache.time < 60000) return likedCache.ids;
  if (!likedPending) {
    const generation = epoch;
    const revision = likesRevision;
    const pending = eapi("/api/song/like/get", { uid: me.id }).then(result => {
      const ids = (result.ids || []).map(String);
      if (generation === epoch && revision === likesRevision) likedCache = { time: Date.now(), ids };
      return ids;
    }).finally(() => { if (likedPending === pending) likedPending = null; });
    likedPending = pending;
  }
  return likedPending;
}
export async function liked({ offset = 0 } = {}) {
  offsetOf(offset);
  const ids = await likedIDs();
  return { tracks: await details(ids.slice(offset, offset + PAGE)), more: offset + PAGE < ids.length };
}
export async function isLiked({ ids }) {
  const result = Object.fromEntries(ids.map(n => [n, false]));
  if (!accountNow()) return result;
  const songs = ids.filter(n => !trackIdentity(n).program);
  if (songs.length) {
    const liked = new Set(await likedIDs());
    for (const n of songs) result[n] = liked.has(n);
  }
  const episodes = ids.filter(n => trackIdentity(n).program);
  for (let i = 0; i < episodes.length; i += 100) {
    const batch = episodes.slice(i, i + 100);
    const response = await eapi("/api/resource/commentInfo/list", {
      resourceType: "1", resourceIds: JSON.stringify(batch.map(n => Number(trackIdentity(n).program))),
    });
    const likes = new Map((response.data || []).map(p => [String(p.resourceId), !!p.liked]));
    for (const n of batch) result[n] = likes.get(trackIdentity(n).program) || false;
  }
  return result;
}
export async function like({ id: song, on }) {
  requireAccount();
  if (trackIdentity(song).program) return likeEpisode({ id: song, on });
  await eapi("/api/radio/like", { alg: "itembased", trackId: id(song), like: String(!!on), time: "3" });
  likesRevision++;
  likedCache = likedPending = null;
}
export async function likeEpisode({ id: episode, on }) {
  requireAccount();
  const identity = trackIdentity(episode);
  if (!identity.program) throw fail("unsupported", /* zh-CN: 这不是播客节目 */ "This is not a podcast episode");
  await eapi(`/api/resource/${on ? "like" : "unlike"}`, { threadId: identity.thread });
}
export async function recent() {
  const local = load("recent", []);
  if (!accountNow()) return local;
  const result = await eapi("/api/play-record/song/list", { limit: 100 });
  const remote = await hydrate((result.data?.list || []).map(row => row.data));
  return [...local, ...remote].filter((t, i, all) => all.findIndex(x => x.id === t.id) === i).slice(0, 100);
}
export async function played({ id: value }) {
  const generation = epoch;
  const identity = trackIdentity(value);
  let track;
  if (identity.program) {
    const result = await web("/api/dj/program/detail", { id: identity.program });
    if (result.program?.radio && result.program?.mainSong) track = toEpisode(result.program, result.program.radio);
  } else {
    [track] = await details([value]);
  }
  if (generation === epoch && track) rememberTrack(track);
}
function rememberTrack(track) {
  save("recent", [track, ...load("recent", []).filter(t => t.id !== track.id)].slice(0, 100));
}

export async function createPlaylist({ name }) {
  requireAccount();
  if (!name.trim()) throw new Error(/* zh-CN: 歌单名称不能为空 */ "Playlist name cannot be empty");
  const result = await eapi("/api/playlist/create", { name: name.trim(), privacy: "0", type: "NORMAL" });
  const p = result.playlist || { id: result.id, name: name.trim() };
  return { ...toPlaylist(p), mine: true, tracks: [] };
}
export async function renamePlaylist({ id: pid, name }) {
  requireAccount();
  if (!name.trim()) throw new Error(/* zh-CN: 歌单名称不能为空 */ "Playlist name cannot be empty");
  await eapi("/api/playlist/update/name", { id: id(pid), name: name.trim() });
}
export async function deletePlaylist({ id: pid }) {
  requireAccount();
  await eapi("/api/playlist/remove", { ids: JSON.stringify([Number(id(pid))]) });
}
async function manipulate(op, pid, trackIds) {
  requireAccount();
  const ids = trackIds.map(n => Number(id(n)));
  if (!ids.length) return;
  const send = items => eapi("/api/playlist/manipulate/tracks",
    { op, pid: id(pid), trackIds: JSON.stringify(items), imme: "true" }, [200, 502, 512]);
  let result = await send(ids);
  if (result.code === 512) result = await send([...ids, ...ids]);
  if (result.code === 502) throw new Error(/* zh-CN: 歌曲已在歌单中 */ "This song is already in the playlist");
  check(result, "playlist/manipulate/tracks");
}
export function addToPlaylist({ id, trackIds }) { return manipulate("add", id, trackIds); }
export function removeFromPlaylist({ id, trackIds }) { return manipulate("del", id, trackIds); }
export async function movePlaylistTrack({ id: pid, from, to }) {
  requireAccount();
  const p = await playlistRaw(pid);
  // Never reorder a partial playlist: missing IDs could discard unseen tracks.
  const ids = (p.trackIds || []).map(t => Number(id(t.id)));
  if (ids.length !== p.trackCount) throw new Error(/* zh-CN: 歌单曲目列表不完整，已取消排序 */ "The track list is incomplete. Reordering was cancelled.");
  if (![from, to].every(n => Number.isSafeInteger(n) && n >= 0 && n < ids.length)) throw new Error(/* zh-CN: 无效的歌曲位置 */ "Invalid track position");
  if (from === to) return;
  ids.splice(to, 0, ids.splice(from, 1)[0]);
  await eapi("/api/playlist/manipulate/tracks", { pid: id(pid), trackIds: JSON.stringify(ids), op: "update" });
}
export async function savePlaylist({ id: pid, on }) {
  requireAccount();
  await eapi(`/api/playlist/${on ? "subscribe" : "unsubscribe"}`, { id: id(pid) });
}
export async function album({ id: aid }) {
  if (String(aid).startsWith("show:")) {
    const page = await show({ id: aid.slice(5) });
    return { album: { id: aid, name: page.show.name, imageUrl: page.show.imageUrl }, tracks: page.episodes };
  }
  const result = await web(`/api/v1/album/${id(aid)}`);
  if (!result.album) throw fail("unavailable", /* zh-CN: 专辑不存在 */ "Album not found");
  return { album: toAlbum(result.album), tracks: await hydrate(result.songs || []) };
}
export async function artist({ id: aid }) {
  const [result, records] = await Promise.all([
    web(`/api/v1/artist/${id(aid)}`), web(`/api/artist/albums/${id(aid)}`, { limit: 100, offset: 0 }),
  ]);
  if (!result.artist) throw fail("unavailable", /* zh-CN: 歌手不存在 */ "Artist not found");
  const a = toArtist(result.artist);
  save("lastArtists", [a, ...load("lastArtists", []).filter(x => x.id !== a.id)].slice(0, 20));
  return { artist: a, tracks: await hydrate(result.hotSongs || []), albums: (records.hotAlbums || []).map(toAlbum) };
}
export async function followArtist({ id: aid, on }) {
  requireAccount();
  // NetEase rejects some eapi follows with -460; the original client uses web.
  await web(`/api/artist/${on ? "sub" : "unsub"}`, { artistId: id(aid), artistIds: `[${id(aid)}]` }, "POST");
}
export async function saveAlbum({ id: aid, on }) {
  requireAccount();
  await eapi(`/api/album/${on ? "sub" : "unsub"}`, { id: id(aid) });
}
export async function savedAlbums({ offset = 0 } = {}) {
  requireAccount();
  const result = await web("/api/album/sublist", { limit: PAGE, offset: offsetOf(offset), total: true });
  return { albums: (result.data || []).map(a => ({ ...toAlbum(a), saved: true })), more: !!result.hasMore };
}
export async function shows() {
  requireAccount();
  const all = [];
  for (let offset = 0; ; offset += 100) {
    const result = await web("/api/djradio/get/subed", { limit: 100, offset, total: true });
    const page = result.djRadios || [];
    all.push(...page.map(s => ({ ...toShow(s), subscribed: true })));
    if (!result.hasMore || !page.length) return all;
  }
}
export async function show({ id: sid, offset = 0 }) {
  const [detail, programs] = await Promise.all([
    web("/api/djradio/v2/get", { id: id(sid) }),
    web("/api/dj/program/byradio", { radioId: id(sid), limit: PAGE, offset: offsetOf(offset), asc: false }),
  ]);
  if (!detail.data) throw fail("unavailable", /* zh-CN: 播客不存在 */ "Podcast not found");
  return { show: toShow(detail.data), episodes: (programs.programs || []).map(p => toEpisode(p, detail.data)), more: !!programs.more };
}
export async function subscribeShow({ id: sid, on }) {
  requireAccount();
  await eapi(`/api/djradio/${on ? "sub" : "unsub"}`, { id: id(sid) });
}
export function stations() {
  return [
    { id: "fm:DEFAULT", name: /* zh-CN: 私人 FM */ "Personal FM", description: /* zh-CN: 为你推荐，随心而听 */ "Music picked for you" },
    { id: "fm:FAMILIAR", name: /* zh-CN: 熟悉 */ "Familiar", description: /* zh-CN: 从熟悉的旋律出发 */ "More of the sounds you know" },
    { id: "fm:EXPLORE", name: /* zh-CN: 探索 */ "Explore", description: /* zh-CN: 遇见尚未听过的好音乐 */ "Find your next favourite" },
    { id: "heart", name: /* zh-CN: 心动模式 */ "Heart Mode", description: /* zh-CN: 从喜欢的歌出发，寻找下一首心动 */ "Discover more from the songs you love" },
  ];
}
export async function stationNext({ id: station }) {
  const me = requireAccount();
  if (station === "heart") {
    const generation = epoch;
    let state = heart;
    if (!state) {
      const p = (await userPlaylists(me.id)).find(p => p.specialType === 5);
      if (!p) throw fail("unavailable", /* zh-CN: 未找到我喜欢的音乐歌单 */ "Your liked-songs playlist was not found");
      const ids = await likedIDs();
      if (!ids.length) throw fail("unavailable", /* zh-CN: 先喜欢几首歌，再开启心动模式 */ "Like a few songs before starting Heart mode");
      const seed = ids[Math.floor(Math.random() * ids.length)];
      state = { playlist: String(p.id), start: seed, current: seed };
    }
    const result = await eapi("/api/playmode/intelligence/list", {
      songId: state.current, startMusicId: state.start, playlistId: state.playlist, type: "fromPlayOne", count: 1,
    });
    const tracks = await hydrate((result.data || []).map(x => x.songInfo).filter(Boolean));
    if (generation === epoch) heart = { ...state, current: tracks.at(-1)?.id || state.current };
    return tracks;
  }
  const mode = station.replace(/^fm:/, "");
  if (!["DEFAULT", "FAMILIAR", "EXPLORE"].includes(mode)) throw fail("unavailable", /* zh-CN: 未知电台 */ "Unknown station");
  const result = await eapi("/api/v1/radio/get", { mode, limit: 3 });
  return details((result.data || []).map(t => t.id));
}
function toComment(c) {
  const quote = (c.beReplied || []).map(r => `${r.user?.nickname || ""}: ${r.content || ""}`).join("\n");
  return {
    id: String(c.commentId), author: c.user?.nickname || "", avatarUrl: https(c.user?.avatarUrl),
    text: c.content + (quote ? /* zh-CN: 回复：引用内容 */ `\n\nReplying to: ${quote}` : ""), time: c.time || 0,
    likes: c.likedCount || 0, liked: !!c.liked,
  };
}
export async function comments({ trackId, offset = 0 }) {
  const result = await web(`/api/v1/resource/comments/${trackIdentity(trackId).thread}`,
    { limit: PAGE, offset: offsetOf(offset) });
  // Only latest comments count toward the host's numeric pagination offset.
  // Hot comments have their own browse page so they cannot skip later comments.
  return { comments: (result.comments || []).map(toComment), total: result.total || 0, more: !!result.more };
}
export async function likeComment({ trackId, commentId, on }) {
  requireAccount();
  await eapi(`/api/v1/comment/${on ? "like" : "unlike"}`, { threadId: trackIdentity(trackId).thread, commentId: id(commentId) });
}
export async function postComment({ trackId, text }) {
  requireAccount();
  if (!text.trim()) throw new Error(/* zh-CN: 评论内容不能为空 */ "Comment cannot be empty");
  const result = await eapi("/api/resource/comments/add", { threadId: trackIdentity(trackId).thread, content: text.trim() });
  if (!result.comment) throw new Error(/* zh-CN: 网易云未返回已发布的评论，请刷新确认，勿重复发送 */ "NetEase did not return the posted comment. Refresh to check before posting again.");
  return toComment(result.comment);
}

function timedTranslations(text) {
  const out = [];
  let offset = 0;
  const offsetMatch = /\[offset:([+-]?\d+)\]/i.exec(text);
  if (offsetMatch) offset = Number(offsetMatch[1]);
  for (const raw of text.split(/\r?\n/)) {
    const tags = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    const words = raw.replace(/\[[^\]]*\]/g, "").trim();
    if (!words) continue;
    for (const tag of tags) out.push({ start: Math.round(Number(tag[1]) * 60000 + Number(tag[2]) * 1000) + offset, text: words });
  }
  return out;
}
function parseYRC(text, translation) {
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    const timing = /^\[(\d+),(\d+)\]/.exec(raw);
    if (!timing) continue;
    const words = [];
    for (const m of raw.slice(timing[0].length).matchAll(/\((\d+),(\d+),\d+\)(.*?)(?=\(\d+,\d+,\d+\)|$)/g)) {
      if (!m[3].trim()) {
        if (words.length) words[words.length - 1].text += m[3];
      } else words.push({ start: Number(m[1]), end: Number(m[1]) + Number(m[2]), text: m[3] });
    }
    const lyric = words.map(w => w.text).join("").trim();
    if (lyric) lines.push({ start: Number(timing[1]), end: Number(timing[1]) + Number(timing[2]), text: lyric, words });
  }
  lines.sort((a, b) => a.start - b.start);
  for (const t of timedTranslations(translation)) {
    let best = null, gap = 1500;
    for (const line of lines) {
      const distance = Math.abs(line.start - t.start);
      if (distance < gap) { best = line; gap = distance; }
    }
    if (best && !best.translation) best.translation = t.text;
  }
  return lines;
}
export async function lyrics({ id: value }) {
  const identity = trackIdentity(value);
  if (identity.program) return { lrc: "" };
  const base = await web("/api/song/lyric", { id: identity.audio, lv: 1, tv: -1 });
  let words = {};
  try {
    words = await eapi("/api/song/lyric/v1", { id: identity.audio, cp: false, tv: 0, lv: 0, rv: 0, kv: 0, yv: 0, ytv: 0, yrv: 0 });
  } catch { /* Plain LRC remains usable when word timings are unavailable. */ }
  const lrc = base.lrc?.lyric || "";
  const translation = words.ytlrc?.lyric || base.tlyric?.lyric || "";
  const lines = parseYRC(words.yrc?.lyric || "", translation);
  return lines.length ? { lrc, translation, lines } : { lrc, translation };
}
export async function stream({ id: value, quality = "standard" }) {
  const identity = trackIdentity(value);
  const level = host.setting("quality") || (quality === "high" ? "exhigh" : quality);
  if (!LEVELS.includes(level)) throw fail("setup", /* zh-CN: 无效的音质设置 */ "Invalid quality setting");
  const result = await eapi("/api/song/enhance/player/url/v1", {
    ids: `[${identity.audio}]`, level, encodeType: ["lossless", "hires"].includes(level) ? "flac" : "mp3",
  });
  const item = (result.data || []).find(t => String(t.id) === identity.audio) || result.data?.[0];
  if (!item?.url || item.freeTrialInfo != null) throw fail("unavailable", /* zh-CN: 该音频暂不可完整播放，可能需要会员或购买 */ "Full playback is unavailable. A subscription or purchase may be required.");
  const type = (item.type || (["lossless", "hires"].includes(item.level) ? "flac" : "mp3")).toLowerCase();
  if (!["mp3", "flac", "ogg"].includes(type)) throw fail("unsupported", /* zh-CN: 不支持的音频格式 */ `Unsupported audio format: ${type}`);
  const url = new URL(https(item.url));
  if (url.protocol !== "https:") throw fail("unavailable", /* zh-CN: 音频地址不是安全的网络地址 */ "The audio URL is not a secure network address");
  return {
    url: url.href, type, quality: item.level || level, bitRate: item.br || 0,
    size: item.size || 0, gain: Number(item.gain) || 0, peak: Number(item.peak) || 0,
    headers: { "User-Agent": UA, Referer: `${SITE}/` },
  };
}

export async function browse({ page }) {
  const url = new URL(page, "https://plugin.invalid/");
  const name = url.pathname.slice(1);
  const q = url.searchParams;
  const offset = offsetOf(Number(q.get("offset") || 0));
  if (name === "daily") return { title: /* zh-CN: 每日推荐 */ "Daily Recommendations", sections: [{ tracks: await daily() }] };
  if (name === "recommended") return { title: /* zh-CN: 推荐歌单 */ "Recommended Playlists", sections: [{ playlists: (await featured()).map(toPlaylist) }] };
  if (name === "charts") {
    const result = await web("/api/toplist/detail");
    return { title: /* zh-CN: 排行榜 */ "Charts", sections: [{ playlists: (result.list || []).map(p => ({
      ...toPlaylist(p), description: [p.updateFrequency, ...(p.tracks || []).map(t => `${t.first} · ${t.second}`)].filter(Boolean).join("\n"),
    })) }] };
  }
  if (name === "recent") return { title: /* zh-CN: 最近播放 */ "Recently Played", sections: [{ tracks: await recent() }] };
  if (name === "following") {
    requireAccount();
    const result = await web("/api/artist/sublist", { limit: PAGE, offset, total: true });
    const artists = (result.data || []).map(a => ({ ...toArtist(a), following: true }));
    return { title: /* zh-CN: 关注歌手 */ "Followed Artists", sections: [
      { artists }, { title: /* zh-CN: 新作与动态 */ "New Releases and Updates", links: artists.map(artistLink) },
      ...nextSection(name, { offset: offset + PAGE }, result.hasMore && artists.length),
    ] };
  }
  if (name === "podcasts") {
    const [recommended, hot] = await Promise.all([
      web("/api/djradio/recommend/v1"), web("/api/djradio/hot/v1", { limit: PAGE, offset }),
    ]);
    return { title: /* zh-CN: 发现播客 */ "Discover Podcasts", sections: [
      ...(offset ? [] : [{ title: /* zh-CN: 推荐播客 */ "Recommended Podcasts", shows: (recommended.djRadios || []).map(toShow) }]),
      { title: /* zh-CN: 热门播客 */ "Popular Podcasts", shows: (hot.djRadios || []).map(toShow) },
      ...nextSection(name, { offset: offset + PAGE }, hot.hasMore && hot.djRadios?.length),
    ] };
  }
  if (name === "explore") {
    const query = host.setting("userQuery") || load("lastQuery", "");
    return { title: /* zh-CN: 探索更多 */ "Explore", subtitle: /* zh-CN: 补充播放器标准页面之外的网易云内容 */ "More from NetEase Cloud Music", sections: [
      { title: /* zh-CN: 用户 */ "People", links: [
        { title: /* zh-CN: 搜索用户 */ "Find People", subtitle: query ? /* zh-CN: 搜索：关键词 */ `Search: ${query}` : /* zh-CN: 先搜索音乐，或在插件设置中填写用户搜索关键词 */ "Search for music first, or set a people search query in plugin settings", page: route("users", { query }) },
        ...(accountNow() ? [{ title: /* zh-CN: 我的主页与动态 */ "My Profile and Updates", page: route("user", { id: accountNow().id }) }] : []),
      ] },
      { title: /* zh-CN: 最近浏览 / 搜索的歌手 */ "Recently Viewed or Searched Artists", links: load("lastArtists", []).map(artistLink) },
      { title: /* zh-CN: 热评 */ "Top Comments", links: load("recent", []).slice(0, 20).map(t => ({
        title: t.name, subtitle: /* zh-CN: 查看热门评论 */ "Read Top Comments", imageUrl: t.album?.imageUrl, page: route("hot-comments", { id: t.id }),
      })) },
    ] };
  }
  if (name === "users") {
    const query = q.get("query") || host.setting("userQuery") || load("lastQuery", "");
    if (!query) return { title: /* zh-CN: 搜索用户 */ "Find People", subtitle: /* zh-CN: 先用顶部搜索栏搜索关键词，再返回此页；或在插件设置填写用户搜索关键词。 */ "Search using the top search bar, then return here; or set a people search query in plugin settings.", sections: [] };
    const result = (await web("/api/cloudsearch/pc", { s: query, type: 1002, limit: PAGE, offset, total: true })).result || {};
    const users = result.userprofiles || [];
    return { title: /* zh-CN: 用户：关键词 */ `People: ${query}`, sections: [
      { links: users.map(u => ({ title: u.nickname, subtitle: u.signature || "", imageUrl: https(u.avatarUrl), page: route("user", { id: u.userId }) })) },
      ...nextSection(name, { query, offset: offset + PAGE }, users.length && offset + users.length < result.userprofileCount),
    ] };
  }
  if (name === "user") {
    const uid = id(q.get("id"));
    const [result, lists] = await Promise.all([web(`/api/v1/user/detail/${uid}`), userPlaylists(uid)]);
    if (!result.profile) throw fail("unavailable", /* zh-CN: 用户不存在 */ "User not found");
    const p = result.profile;
    return { title: p.nickname, subtitle: p.signature || "", sections: [
      { links: [{ title: /* zh-CN: 动态 */ "Updates", subtitle: /* zh-CN: 关注人数 · 粉丝人数 */ `Following ${p.follows || 0} · Followers ${p.followeds || 0}`, imageUrl: https(p.avatarUrl), page: route("events", { id: uid }) }] },
      { title: /* zh-CN: 创建的歌单 */ "Created Playlists", playlists: lists.filter(p => String(p.creator?.userId) === uid).map(toPlaylist) },
      { title: /* zh-CN: 收藏的歌单 */ "Saved Playlists", playlists: lists.filter(p => String(p.creator?.userId) !== uid).map(toPlaylist) },
    ] };
  }
  if (name === "artist-extra") {
    const aid = id(q.get("id"));
    const [result, latest, records] = await Promise.all([
      web(`/api/v1/artist/${aid}`),
      web("/api/v1/artist/songs", { id: aid, order: "time", limit: PAGE, offset }, "POST"),
      web(`/api/artist/albums/${aid}`, { limit: PAGE, offset }),
    ]);
    const a = result.artist || {};
    return { title: a.name || /* zh-CN: 歌手 */ "Artist", subtitle: a.briefDesc || "", sections: [
      ...(a.accountId ? [{ links: [{ title: /* zh-CN: 歌手动态 */ "Artist Updates", page: route("events", { id: a.accountId }) }] }] : []),
      { title: /* zh-CN: 最新歌曲 */ "Latest Songs", tracks: await details((latest.songs || []).map(t => t.id)),
        morePage: latest.more ? route("artist-extra", { id: aid, offset: offset + PAGE }) : "" },
      { title: /* zh-CN: 专辑 */ "Albums", albums: (records.hotAlbums || []).map(toAlbum),
        morePage: records.more ? route("artist-albums", { id: aid, offset: offset + PAGE }) : "" },
    ] };
  }
  if (name === "artist-albums") {
    const aid = id(q.get("id"));
    const result = await web(`/api/artist/albums/${aid}`, { limit: PAGE, offset });
    return { title: /* zh-CN: 歌手专辑 */ "Artist Albums", sections: [
      { albums: (result.hotAlbums || []).map(toAlbum) },
      ...nextSection(name, { id: aid, offset: offset + PAGE }, result.more && result.hotAlbums?.length),
    ] };
  }
  if (name === "events") return eventsPage(id(q.get("id")), q.get("before") || "-1");
  if (name === "hot-comments") {
    const result = await web(`/api/v1/resource/comments/${trackIdentity(q.get("id")).thread}`, { limit: 1, offset: 0 });
    return { title: /* zh-CN: 热门评论 */ "Top Comments", subtitle: /* zh-CN: 点赞与发表评论请使用正在播放页的评论面板 */ "Like and post comments from the Now Playing comments panel", sections: (result.hotComments || []).map(c => ({
      title: `${c.user?.nickname || /* zh-CN: 听友 */ "Listener"} · ${c.likedCount || 0} likes` /* zh-CN: 用户名 · 赞数 */,
      links: [{ title: c.content, subtitle: date(c.time), imageUrl: https(c.user?.avatarUrl), page: route("user", { id: c.user.userId }) }],
    })) };
  }
  throw fail("unavailable", /* zh-CN: 页面不存在 */ "Page not found");
}
function artistLink(a) {
  return { title: a.name, subtitle: /* zh-CN: 最新歌曲 / 全部专辑 / 动态 */ "Latest Songs / All Albums / Updates", imageUrl: a.imageUrl, page: route("artist-extra", { id: a.id }) };
}
async function eventsPage(uid, before) {
  if (!/^-?\d+$/.test(before)) throw new Error(/* zh-CN: 无效的动态分页位置 */ "Invalid feed cursor");
  const result = await web(`/api/event/get/${uid}`, { time: before, limit: 20, getcounts: true, total: false });
  const sections = (result.events || []).map(event => {
    let content = {};
    try { content = JSON.parse(event.json || "{}"); } catch { /* A malformed event must not hide the feed. */ }
    let message = content.msg || "";
    if (content.event) {
      try {
        const forwarded = JSON.parse(content.event.json);
        message += /* zh-CN: 转发 用户名：原文 */ `\nShared from ${content.event.user?.nickname || ""}: ${forwarded.msg || ""}`;
      } catch { /* Forwarded content is optional. */ }
    }
    const section = { title: `${event.user?.nickname || ""} · ${date(event.eventTime)}`, links: [{
      title: message || (content.mv || content.video ? /* zh-CN: 视频动态（播放器暂不支持视频） */ "Video update (video playback is not supported)" : /* zh-CN: 分享动态 */ "Shared Update"),
      subtitle: /* zh-CN: 赞数 · 评论数 */ `${event.info?.likedCount || 0} likes · ${event.info?.commentCount || 0} comments`,
      imageUrl: https(event.pics?.[0]?.squareUrl || event.user?.avatarUrl), page: route("user", { id: uid }),
    }] };
    if (content.song?.id) section.tracks = [toTrack(content.song)];
    if (content.album?.id) section.albums = [toAlbum(content.album)];
    if (content.artist?.id) section.artists = [toArtist(content.artist)];
    if (content.playlist?.id) section.playlists = [toPlaylist(content.playlist)];
    return section;
  });
  sections.push(...nextSection("events", { id: uid, before: result.lasttime }, result.more && result.events?.length && String(result.lasttime) !== before));
  return { title: /* zh-CN: 动态 */ "Updates", subtitle: /* zh-CN: 文字、首图与分享的音乐；完整图片布局需要宿主扩展 */ "Text, first image and shared music. Full image layouts require host support.", sections };
}
