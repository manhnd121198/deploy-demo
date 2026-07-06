// Băm PIN (PBKDF2-SHA256) và ký/verify token phiên (HMAC-SHA256).

const enc = new TextEncoder();

// Chuẩn hoá tên tài khoản: thường hoá, chỉ cho a-z 0-9 _ - , dài 3-32.
export function normalizeName(raw) {
  const name = String(raw || "").trim().toLowerCase();
  if (!/^[a-z0-9_-]{3,32}$/.test(name)) {
    throw new Error("Tên chỉ gồm a-z, 0-9, _ , - và dài 3-32 ký tự");
  }
  return name;
}

const toHex = (buf) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

function fromHex(hex) {
  const a = new Uint8Array(hex.length / 2);
  for (let i = 0; i < a.length; i++) a[i] = parseInt(hex.substr(i * 2, 2), 16);
  return a;
}

export async function hashPin(pin, saltHex) {
  const salt = saltHex ? fromHex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, key, 256
  );
  return { salt: toHex(salt), hash: toHex(bits) };
}

export async function verifyPin(pin, saltHex, expectedHash) {
  const { hash } = await hashPin(pin, saltHex);
  return timingSafeEqual(hash, expectedHash);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const b64url = (bytes) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const b64urlDecode = (s) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

const hmacKey = (secret) =>
  crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

// Token = base64url(payload).base64url(hmac). Mặc định sống 30 ngày.
export async function signToken(name, secret, ttlSec = 2592000) {
  const payload = { name, exp: Math.floor(Date.now() / 1000) + ttlSec };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body));
  return `${body}.${b64url(new Uint8Array(sig))}`;
}

// Trả về name nếu token hợp lệ và chưa hết hạn, ngược lại null.
export async function verifyToken(token, secret) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), b64urlDecode(sig), enc.encode(body));
  if (!ok) return null;
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
  } catch {
    return null;
  }
  if (!payload.name || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload.name;
}
