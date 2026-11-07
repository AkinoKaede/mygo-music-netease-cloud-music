// SPDX-FileCopyrightText: 2026 Kaede Akino
// SPDX-License-Identifier: AGPL-3.0-or-later

import { eapi, web } from "./api.js";
import { LEVELS, SITE, UA } from "./constants.js";
import type { ServiceUser } from "./service-types.js";
import { cookieHeader, load, resetSession, save, session } from "./session.js";
import type { Cookies } from "./types.js";
import { fail, picture, tr } from "./utils.js";

export async function account() {
  if (!load("cookies", {}).MUSIC_U) return null;
  const generation = session.epoch;
  let result;
  try {
    result = await web<{ profile?: ServiceUser }>("/api/nuser/account/get");
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "signIn") throw error;
    if (generation === session.epoch) resetSession();
    return null;
  }
  if (generation !== session.epoch) return null;
  const p = result.profile;
  if (!p?.userId) {
    resetSession();
    return null;
  }
  const me = {
    id: String(p.userId),
    name: p.nickname,
    imageUrl: picture(p.avatarUrl),
    page: "profile",
  };
  save("account", me);
  return me;
}

export function signIn() {
  if (!session.loginPending) {
    session.loginPending = login().finally(() => {
      session.loginPending = null;
    });
  }
  return session.loginPending;
}

export async function login() {
  resetSession();
  const generation = session.epoch;
  const active = () => {
    if (generation !== session.epoch) throw new Error(tr("Sign-in cancelled"));
  };
  if (host.setting("loginMethod") === "web") {
    const result = await host.webSignIn({
      url: `${SITE}/`,
      cookiesOf: `${SITE}/`,
      until: ["MUSIC_U"],
      userAgent: UA,
    });
    active();
    const cookies: Cookies = {};
    for (const part of result.cookie.split(";")) {
      const match = /^\s*(MUSIC_U|__csrf|NMTID)=(.*)$/.exec(part);
      if (match) cookies[match[1]] = match[2];
    }
    save("cookies", cookies);
  } else {
    const started = Date.now();
    const key = (await eapi<{ unikey?: string }>("/api/login/qrcode/unikey", { type: 3 })).unikey;
    if (!key) throw new Error(tr("NetEase did not return a sign-in QR code"));
    active();
    const qr = `${SITE}/login?codekey=${encodeURIComponent(key)}`;
    host.signInPrompt({ qr, text: tr("Scan with the NetEase Cloud Music app to sign in") });
    let confirmed = false;
    while (Date.now() - started < 240000) {
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      active();
      const result = await eapi(
        "/api/login/qrcode/client/login",
        { key, type: 3 },
        [800, 801, 802, 803],
      );
      active();
      if (result.code === 800) throw new Error(tr("The QR code expired. Please sign in again."));
      if (result.code === 802)
        host.signInPrompt({ qr, text: tr("Code scanned. Confirm sign-in on your phone.") });
      if (result.code === 803) {
        confirmed = true;
        break;
      }
    }
    if (!confirmed) throw new Error(tr("Sign-in timed out. Please try again."));
  }
  active();
  const me = await account();
  if (!me)
    throw new Error(
      tr("No valid session received. Try again or choose web sign-in in plugin settings."),
    );
  host.signInPrompt({ text: tr("Welcome back, {name}", { name: me.name }) });
  return me;
}

export async function signOut() {
  const cookie = cookieHeader();
  resetSession();
  // A late logout/QR response must never restore cookies after signing out.
  try {
    await web("/api/logout", {}, "POST", { cookie, generation: -1 });
  } catch {
    /* Local sign-out still succeeds while offline. */
  }
}

export function setSetting({ key, value }: { key: string; value: string }) {
  if (key === "quality" && value && !LEVELS.includes(value)) {
    throw fail(
      "setup",
      tr("Quality must be standard / higher / exhigh / lossless / hires, or empty"),
    );
  }
  if (key === "loginMethod" && value && !["qr", "web"].includes(value)) {
    throw fail("setup", tr("Sign-in method must be qr / web, or empty"));
  }
}
