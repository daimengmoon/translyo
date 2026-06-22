// Server-side quota using Cloudflare KV (binding name: KV).
// This is the part the browser CANNOT bypass.

export function clientIp(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown"
  );
}

export async function getPlan(env, license) {
  const free = { plan: "free", maxBytes: parseInt(env.FREE_MAX_BYTES || String(30 * 1024 * 1024), 10) };
  if (!license || !env.KV) return free;
  const v = await env.KV.get("sub:" + license);
  if (v) {
    const s = JSON.parse(v);
    if (s.status === "active")
      return { plan: s.plan || "pro", maxBytes: parseInt(env.PRO_MAX_BYTES || String(300 * 1024 * 1024), 10) };
  }
  return free;
}

export async function checkAndCountFree(env, ip) {
  const limit = parseInt(env.FREE_DAILY_LIMIT || "3", 10);
  if (!env.KV) return { ok: true, remaining: limit - 1 };
  const day = new Date().toISOString().slice(0, 10);
  const key = `usage:${ip}:${day}`;
  const cur = parseInt((await env.KV.get(key)) || "0", 10);
  if (cur >= limit) return { ok: false, remaining: 0 };
  await env.KV.put(key, String(cur + 1), { expirationTtl: 60 * 60 * 48 });
  return { ok: true, remaining: limit - (cur + 1) };
}
