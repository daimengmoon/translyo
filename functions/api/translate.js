// POST /api/translate  (Cloudflare Pages Function)
// Body = raw file bytes. Headers: x-filename, x-target, x-source, x-license.
// All quota / paid / size checks run HERE on the server.
import { translateDocument } from "../_lib/engine.js";
import { clientIp, getPlan, checkAndCountFree } from "../_lib/quota.js";

const json = (o, status) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

export async function onRequestPost({ request, env }) {
  const apiKey = env.ARK_API_KEY;
  const model = env.ARK_MODEL || "doubao-seed-2-0-lite";
  if (!apiKey) return json({ error: "Server not configured: missing ARK_API_KEY" }, 500);

  const filename = request.headers.get("x-filename") || "document";
  const target = request.headers.get("x-target") || "English";
  const source = request.headers.get("x-source") || "auto";
  const license = request.headers.get("x-license") || "";

  try {
    const buf = new Uint8Array(await request.arrayBuffer());
    if (!buf.length) return json({ error: "Empty file" }, 400);

    const { plan, maxBytes } = await getPlan(env, license);
    if (buf.length > maxBytes) return json({ error: `File too large for ${plan} plan.`, plan }, 413);

    if (plan === "free") {
      const q = await checkAndCountFree(env, clientIp(request));
      if (!q.ok) return json({ error: "Daily free limit reached. Upgrade to Pro for unlimited.", code: "QUOTA" }, 402);
    }

    const { buffer, ext } = await translateDocument(buf, filename, target, source, { apiKey, model });
    const types = {
      txt: "text/plain; charset=utf-8",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
    const base = filename.replace(/\.[^.]+$/, "");
    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": types[ext] || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(base)}-translated.${ext}"`,
      },
    });
  } catch (e) {
    return json({ error: e.message || "Translation failed" }, 500);
  }
}
