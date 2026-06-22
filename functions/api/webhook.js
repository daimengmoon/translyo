// POST /api/webhook  (Cloudflare Pages Function) — Creem payment events.
// Verifies the HMAC signature, then writes the subscription to KV.
// Trusts ONLY this verified server-to-server call.

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function onRequestPost({ request, env }) {
  const raw = new Uint8Array(await request.arrayBuffer());
  const secret = env.CREEM_WEBHOOK_SECRET;
  const sig = request.headers.get("creem-signature") || request.headers.get("x-creem-signature") || "";

  if (secret) {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const mac = await crypto.subtle.sign("HMAC", key, raw);
    if (toHex(mac) !== sig)
      return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 401 });
  }

  let evt;
  try {
    evt = JSON.parse(new TextDecoder().decode(raw));
  } catch (e) {
    return new Response("Bad JSON", { status: 400 });
  }

  const type = evt.eventType || evt.type || "";
  const obj = evt.object || evt.data || evt;
  const email = obj.customer?.email || obj.customer_email || obj.email || null;
  const license = obj.license_key || obj.id || obj.subscription_id || email;

  if (env.KV && license) {
    if (/active|paid|completed|created|renew/i.test(type))
      await env.KV.put("sub:" + license, JSON.stringify({ plan: "pro", status: "active", email }));
    else if (/cancel|expire|refund|failed/i.test(type))
      await env.KV.put("sub:" + license, JSON.stringify({ plan: "pro", status: "canceled", email }));
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
