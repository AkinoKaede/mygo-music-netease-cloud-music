// SPDX-FileCopyrightText: 2026 Kaede Akino
// SPDX-License-Identifier: AGPL-3.0-or-later

import { cbc } from "@noble/ciphers/aes.js";
import type { Params } from "./types.js";

const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const base64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const presetKey = "0CoJUm6Qyw8W8jud";
const iv = "0102030405060708";
const modulus = BigInt(
  "0xe0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7",
);

const bytes = (text: string) => Uint8Array.from(Array.from(text, (c) => c.charCodeAt(0)));

function toBase64(data: Uint8Array) {
  let result = "";
  for (let i = 0; i < data.length; i += 3) {
    const word = (data[i] << 16) | ((data[i + 1] || 0) << 8) | (data[i + 2] || 0);
    result +=
      base64[(word >>> 18) & 63] +
      base64[(word >>> 12) & 63] +
      (i + 1 < data.length ? base64[(word >>> 6) & 63] : "=") +
      (i + 2 < data.length ? base64[word & 63] : "=");
  }
  return result;
}

function aes(text: string, key: string) {
  return toBase64(cbc(bytes(key), bytes(iv)).encrypt(bytes(text)));
}

function rsa(key: string) {
  // NetEase uses raw RSA on the reversed ASCII key, left-padded to 128 bytes.
  const hex = Array.from(key)
    .reverse()
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("");
  let value = BigInt(`0x${hex}`),
    result = 1n;
  for (let exponent = 65537n; exponent; exponent >>= 1n) {
    if (exponent & 1n) result = (result * value) % modulus;
    value = (value * value) % modulus;
  }
  return result.toString(16).padStart(256, "0");
}

export function encodeWeapi(data: Params) {
  const key = Array.from(
    { length: 16 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)],
  ).join("");
  // Escaped JSON stays ASCII without requiring TextEncoder in the plugin host.
  const text = JSON.stringify(data).replace(
    /[\u007f-\uffff]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  // The browser protocol encrypts base64(AES-CBC(JSON)) with a fresh second key.
  return { params: aes(aes(text, presetKey), key), encSecKey: rsa(key) };
}
