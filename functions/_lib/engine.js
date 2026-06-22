// Translyo translation engine (Cloudflare Workers compatible — no Node Buffer).
import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";

const ARK_URL = "https://ark.cn-beijing.volces.com/api/v3/chat/completions";

async function translateBatch(segments, target, source, { apiKey, model }) {
  const sys =
    "You are a professional document translator. Translate each string in the JSON array " +
    `into ${target}. ` +
    (source && source !== "auto" ? `The source language is ${source}. ` : "") +
    "Rules: return ONLY a JSON array of strings, same length and order as the input. " +
    "Preserve numbers, punctuation, line breaks, and placeholder tokens exactly. " +
    "No explanations. If a string has no translatable text, return it unchanged.";

  const r = await fetch(ARK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: JSON.stringify(segments) },
      ],
      temperature: 0.2,
    }),
  });
  if (!r.ok) throw new Error(`Ark API error ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const data = await r.json();
  let content = (data?.choices?.[0]?.message?.content || "[]").trim();
  if (content.startsWith("```")) content = content.replace(/^```[a-z]*\n?/i, "").replace(/```$/, "").trim();
  let out;
  try {
    out = JSON.parse(content);
  } catch (e) {
    const m = content.match(/\[[\s\S]*\]/);
    out = m ? JSON.parse(m[0]) : segments;
  }
  if (!Array.isArray(out) || out.length !== segments.length) return segments;
  return out.map((x) => (typeof x === "string" ? x : String(x)));
}

async function translateAll(segments, target, source, opts) {
  const idx = [];
  segments.forEach((s, i) => { if (s && s.trim()) idx.push(i); });
  const result = segments.slice();
  const BUDGET = 4000;
  let batch = [], map = [], size = 0;
  const flush = async () => {
    if (!batch.length) return;
    const t = await translateBatch(batch, target, source, opts);
    t.forEach((v, k) => (result[map[k]] = v));
    batch = []; map = []; size = 0;
  };
  for (const i of idx) {
    const s = segments[i];
    if (size + s.length > BUDGET && batch.length) await flush();
    batch.push(s); map.push(i); size += s.length;
  }
  await flush();
  return result;
}

export async function processTxt(buf, target, source, opts) {
  const text = strFromU8(buf);
  const lines = text.split(/\r?\n/);
  const translated = await translateAll(lines, target, source, opts);
  return strToU8(translated.join("\n"));
}

const XML_TARGETS = {
  docx: (n) => /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(n),
  pptx: (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n) || /^ppt\/notesSlides\/.+\.xml$/.test(n),
  xlsx: (n) => n === "xl/sharedStrings.xml",
};
const TEXT_TAG = { docx: "w:t", pptx: "a:t", xlsx: "t" };

function decodeEntities(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
function encodeEntities(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function processOfficeXml(buf, ext, target, source, opts) {
  const files = unzipSync(buf);
  const tag = TEXT_TAG[ext];
  // match <tag> or <tag attr...> but NOT siblings like <w:tbl>/<w:tc> that share the prefix
  const re = new RegExp(`(<${tag}(?:\\s[^>]*)?>)([\\s\\S]*?)(</${tag}>)`, "g");

  const fileSegs = {};
  const collected = [];
  for (const name of Object.keys(files)) {
    if (!XML_TARGETS[ext](name)) continue;
    const xml = strFromU8(files[name]);
    const segs = [];
    xml.replace(re, (full, open, inner) => { segs.push(decodeEntities(inner)); return full; });
    if (segs.length) { fileSegs[name] = { xml, segs }; collected.push(...segs); }
  }
  if (!collected.length) return buf;

  const translated = await translateAll(collected, target, source, opts);

  let cursor = 0;
  for (const name of Object.keys(fileSegs)) {
    const { xml, segs } = fileSegs[name];
    let i = 0;
    const newXml = xml.replace(re, (full, open, inner, close) => {
      const t = translated[cursor + i]; i++;
      return `${open}${encodeEntities(t == null ? inner : t)}${close}`;
    });
    cursor += segs.length;
    files[name] = strToU8(newXml);
  }
  return zipSync(files);
}

export async function translateDocument(buf, filename, target, source, opts) {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  if (ext === "txt") return { buffer: await processTxt(buf, target, source, opts), ext };
  if (ext === "docx" || ext === "pptx" || ext === "xlsx")
    return { buffer: await processOfficeXml(buf, ext, target, source, opts), ext };
  throw new Error(`Unsupported format in v1: .${ext}. Supported: docx, pptx, xlsx, txt.`);
}
