import type {
  AttachmentAdapter,
  ChatModelAdapter,
  CompleteAttachment,
  PendingAttachment,
  SuggestionAdapter,
  ThreadMessage,
} from "@assistant-ui/react";
import { getLibrary, getSettings, setCaptured, setSettings, type Settings } from "./settings";

type Session = { name: string; title: string; H: number; pieces: number; rendered: boolean };
let S: Session | null = null;

const FORMAT_LABEL: Record<Settings["format"], string> = { "5:4": "5:4 landscape", "16:9": "16:9 widescreen", "9:16": "9:16 vertical", "1:1": "1:1 square", "4:5": "4:5 portrait" };
const STYLE_LABEL: Record<Settings["style"], string> = { calm: "calm", default: "standard", energetic: "energetic" };
const musicLabel = (s: Settings) => !s.sound ? "no sound" : s.track ? `music: ${s.trackName}` : s.music ? `music: ${getLibrary().find((t) => t.id === s.music)?.name ?? s.music}` : "sound effects only";
const summary = (s: Settings) =>
  `${FORMAT_LABEL[s.format]} · ${s.quality}p ${s.fps} fps · ${s.duration ? s.duration + " s" : "auto length"} · ${STYLE_LABEL[s.style]} camera · ${musicLabel(s)}`;

const post = <T,>(path: string, body: unknown, signal?: AbortSignal): Promise<T> =>
  fetch("/api/" + path, { method: "POST", body: JSON.stringify(body), signal }).then((r) => r.json());
type Job<T> = { id: string; state: "queued" | "running" | "done" | "error"; log: string[]; result: T; error: string | null; secs: number; elapsed: number };
async function* follow<T>(job: { id: string }, signal: AbortSignal): AsyncGenerator<Job<T>> {
  for (;;) {
    const j: Job<T> = await fetch("/api/job/" + job.id, { signal }).then((r) => r.json());
    yield j;
    if (j.state === "done" || j.state === "error") return;
    await new Promise((r) => setTimeout(r, 600));
  }
}

const URL_RX = /\b((?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?)/i;
type Intent = { kind: "url"; url: string } | { kind: "render" } | { kind: "preview" } | { kind: "set"; changes: Partial<Settings>; said: string[] } | { kind: "help" };

function parse(text: string, files: { kind: "logo" | "track"; path: string; name: string }[]): Intent {
  const t = text.trim(), low = t.toLowerCase();
  const changes: Partial<Settings> = {}, said: string[] = [];
  for (const f of files) {
    if (f.kind === "logo") { changes.logo = f.path; said.push(`logo → ${f.name}`); }
    else { changes.track = f.path; changes.trackName = f.name; changes.sound = true; said.push(`music → ${f.name} (synced to the beat)`); }
  }
  const url = t.match(URL_RX);
  if (url && !/^(headline|title|tail|subtitle|brand)\b/i.test(t) && !files.length) return { kind: "url", url: url[1] };

  const KEYS = "headline|title|line ?1|tail|second line|subtitle|line ?2|italic|brand";
  const field = (keys: string) => {
    const rx = new RegExp(`(?:${keys})\\s*[:=]\\s*(.+?)(?=\\s*(?:${KEYS})\\s*[:=]|$)`, "gi");
    const all = [...t.matchAll(rx)]; return all.at(-1)?.[1]?.trim().replace(/^["“„']|["”']$/g, "") || undefined;
  };
  const h = field("headline|title|line ?1"), tl = field("tail|second line|subtitle|line ?2|italic"), br = field("brand");
  if (h) { changes.line1 = h; said.push(`headline → “${h}”`); }
  if (tl) { changes.tail = tl; said.push(`second line → “${tl}”`); }
  if (br) { changes.brand = br; said.push(`brand → ${br}`); }
  if (!h && !tl && !br) {
    const fmt: [RegExp, Settings["format"]][] = [[/9\s*[:x/]\s*16|vertical|tiktok|reels?|stor(y|ies)|shorts/, "9:16"], [/16\s*[:x/]\s*9|horizontal|widescreen|youtube|landscape|wide\b/, "16:9"],
      [/1\s*[:x/]\s*1|square/, "1:1"], [/4\s*[:x/]\s*5|instagram|portrait|feed/, "4:5"], [/5\s*[:x/]\s*4|original format|default format/, "5:4"]];
    for (const [rx, f] of fmt) if (rx.test(low)) { changes.format = f; said.push(`format → ${FORMAT_LABEL[f]}`); break; }
    const q = low.match(/\b(720|1080|1440)\s*p\b/) || (/\b2k\b/.test(low) ? [, "1440"] : /full ?hd/.test(low) ? [, "1080"] : null);
    if (q) { changes.quality = q[1] as Settings["quality"]; said.push(`quality → ${q[1]}p`); }
    const fr = low.match(/\b(24|30|60)\s*fps\b/);
    if (fr) { changes.fps = fr[1] as Settings["fps"]; said.push(`frame rate → ${fr[1]} fps`); }
    const d = low.match(/\b(\d{1,2})\s*(?:s|sec|secs|seconds?)\b/);
    if (d) { const v = String(Math.min(30, Math.max(10, +d[1]))); changes.duration = v; said.push(`length → ${v} s`); }
    else if (/auto(matic)? (length|duration)/.test(low)) { changes.duration = ""; said.push("length → automatic"); }
    if (/\bcalm|slow(er)?|gentle|relaxed/.test(low)) { changes.style = "calm"; said.push("camera → calm"); }
    else if (/energetic|fast(er)?|dynamic|punchy|bold/.test(low)) { changes.style = "energetic"; said.push("camera → energetic"); }
    else if (/standard|normal|default (camera|style)/.test(low)) { changes.style = "default"; said.push("camera → standard"); }
    const lib = getLibrary(), named = lib.find((t) => new RegExp(`\\b${t.name.toLowerCase()}\\b`).test(low) || new RegExp(`\\b${t.id}\\b`).test(low));
    if (named && /music|track|song|soundtrack|use|play|^\s*\w+(\s\w+)?\s*$/.test(low)) { Object.assign(changes, { music: named.id, track: null, trackName: null, sound: true }); said.push(`music → ${named.name}`); }
    else if (/effects only|no music|remove (the )?music|without music/.test(low)) { Object.assign(changes, { music: "", track: null, trackName: null, sound: true }); said.push("music → effects only"); }
    else if (/no sound|mute|silent|without sound/.test(low)) { changes.sound = false; said.push("sound off"); }
    else if (/sound on|with sound|unmute|add sound/.test(low)) { changes.sound = true; said.push("sound on"); }
    if (/(use|default|site|original) (logo|icon)/.test(low)) { changes.logo = null; said.push("logo → site icon"); }
  }
  if (said.length) return { kind: "set", changes, said };
  if (/\b(render|export|make (it|the video)|create (it|the video)|go|final|download|mp4)\b/.test(low)) return { kind: "render" };
  if (/\b(preview|stills?|show)\b/.test(low)) return { kind: "preview" };
  return { kind: "help" };
}

function lastUser(messages: readonly ThreadMessage[]) {
  const m = [...messages].reverse().find((x) => x.role === "user");
  const text = (m?.content ?? []).map((p) => (p.type === "text" ? p.text : "")).join(" ");
  const files: { kind: "logo" | "track"; path: string; name: string }[] = [];
  for (const a of m && "attachments" in m ? m.attachments ?? [] : []) {
    for (const c of a.content ?? []) if (c.type === "file" && c.data.startsWith("uploads/")) files.push({ kind: c.mimeType.startsWith("audio") ? "track" : "logo", path: c.data, name: a.name });
  }
  return { text, files };
}

type Json = string | number | boolean | null;
type ToolPart = { type: "tool-call"; toolCallId: string; toolName: string; args: Record<string, Json>; argsText: string; result?: unknown };
type Part = { type: "text"; text: string } | ToolPart;
const tool = (name: string, args: Record<string, Json>, result?: unknown): ToolPart => ({ type: "tool-call", toolCallId: name + "-" + Math.random().toString(36).slice(2, 8), toolName: name, args, argsText: JSON.stringify(args), result });

const HELP = [
  "Paste a landing page link and I'll turn it into a 3D fly-over video.",
  "",
  "After that you can tell me things like:",
  "- **vertical**, **square**, **16:9**",
  "- **15 seconds**, **calm** or **energetic** camera",
  "- **headline: …**, **tail: …**, **brand: …**",
  "- attach a **logo** image or a **music** track",
  "",
  "Every change makes a new video automatically.",
].join("\n");

async function* preview(parts: Part[], signal: AbortSignal) {
  const p = tool("preview", { status: "running" });
  parts.push(p); yield { content: [...parts] };
  const job = await post<{ id: string }>("preview", { name: S!.name, ...getSettings() }, signal);
  for await (const j of follow<{ images: string[]; info: { DUR: number; W: number; H: number } }>(job, signal)) {
    if (j.state === "error") { p.result = { error: j.error }; break; }
    if (j.state === "done") p.result = { images: j.result.images, seconds: j.result.info.DUR, w: j.result.info.W, h: j.result.info.H };
  }
  yield { content: [...parts] };
}

async function* renderVideo(parts: Part[], signal: AbortSignal) {
  const r = tool("render", { progress: 0, stage: "Preparing sound…" });
  parts.push(r); yield { content: [...parts] };
  const job = await post<{ id: string }>("render", { name: S!.name, ...getSettings() }, signal);
  for await (const j of follow<{ video: string; secs: number; frames: number }>(job, signal)) {
    const fr = [...j.log].reverse().map((l) => l.match(/frame (\d+)\/(\d+)/)).find(Boolean);
    r.args = { progress: fr ? +fr[1] / +fr[2] : 0, stage: fr ? "Rendering frames…" : j.log.some((l) => l.startsWith("sound")) ? "Starting the renderer…" : "Preparing sound…", elapsed: Math.round(j.elapsed) };
    r.argsText = JSON.stringify(r.args);
    if (j.state === "error") { r.result = { error: j.error }; break; }
    if (j.state === "done") r.result = { video: j.result.video, secs: j.result.secs };
    yield { content: [...parts] };
  }
  S!.rendered = true;
  yield { content: [...parts] };
}

export const flyoverAdapter: ChatModelAdapter = {
  async *run({ messages, abortSignal }) {
    const { text, files } = lastUser(messages);
    const intent = parse(text, files);
    const parts: Part[] = [];

    if (intent.kind === "url") {
      const url = intent.url.startsWith("http") ? intent.url : "https://" + intent.url;
      const cap = tool("capture", { url, progress: "Opening the page…" });
      parts.push(cap); yield { content: [...parts] };
      const job = await post<{ id: string }>("capture", { url, recapture: true }, abortSignal);
      type Cap = { name: string; title: string; H: number; pieces: unknown[]; brand: string; icon: string | null; copy: { line1: string; tail: string } };
      let res: Cap | null = null;
      for await (const j of follow<Cap>(job, abortSignal)) {
        const last = j.log.filter((l) => l && !l.startsWith("  ")).at(-1) ?? "";
        cap.args = { url, progress: last.startsWith("settled") ? "Laying out the page…" : last.startsWith("capture done") ? "Done" : "Capturing the page…" };
        cap.argsText = JSON.stringify(cap.args);
        if (j.state === "error") { cap.result = { error: j.error }; yield { content: [...parts] }; return; }
        if (j.state === "done") res = j.result;
        yield { content: [...parts] };
      }
      if (!res) return;
      S = { name: res.name, title: res.title, H: res.H, pieces: res.pieces.length, rendered: false };

      setSettings({ brand: res.brand, logo: res.icon, line1: res.copy.line1, tail: res.copy.tail });
      setCaptured(true);
      cap.result = { title: res.title, height: res.H, pieces: res.pieces.length };
      parts.push({ type: "text", text: `Here's a preview. The closing card reads:\n\n**${getSettings().line1}**  \n*${getSettings().tail}*` });
      yield* preview(parts, abortSignal);
      parts.push({ type: "text", text: `${summary(getSettings())}. Rendering the video now.` });
      yield* renderVideo(parts, abortSignal);
      parts.push({ type: "text", text: "Done. Change anything in the bar below (format, length, camera, sound) or with **+** (logo, music, text) and I'll make a new version." });
      yield { content: [...parts] };
      return;
    }

    if (!S) {
      if (intent.kind === "set") { setSettings(intent.changes); yield { content: [{ type: "text", text: `Noted: ${intent.said.join(", ")}. Now paste a landing page link.` }] }; return; }
      yield { content: [{ type: "text", text: HELP }] }; return;
    }

    if (intent.kind === "set") {
      setSettings(intent.changes);
      parts.push({ type: "text", text: `Updated: ${intent.said.join(", ")}.` });
      yield* preview(parts, abortSignal);
      parts.push({ type: "text", text: `${summary(getSettings())}. Rendering the new version.` });
      yield* renderVideo(parts, abortSignal);
      yield { content: [...parts] };
      return;
    }
    if (intent.kind === "preview") { yield* preview(parts, abortSignal); return; }

    if (intent.kind === "render") { yield* renderVideo(parts, abortSignal); return; }
    yield { content: [{ type: "text", text: HELP }] };
  },
};

export const suggestionAdapter: SuggestionAdapter = {
  async generate() {
    if (!S) return [];
    const s = getSettings(), out: { prompt: string; title?: string }[] = [];
    if (s.format !== "9:16") out.push({ prompt: "vertical", title: "Vertical 9:16" });
    if (s.format !== "16:9") out.push({ prompt: "16:9", title: "Widescreen 16:9" });
    if (s.duration !== "15") out.push({ prompt: "15 seconds", title: "15 s" });
    if (s.style !== "calm") out.push({ prompt: "calm camera", title: "Calm" });
    if (s.style !== "energetic") out.push({ prompt: "energetic camera", title: "Energetic" });
    return out;
  },
};

const uploaded = new Map<string, string>();
export const uploadAdapter: AttachmentAdapter = {
  accept: "image/*,audio/*",
  async *add({ file }) {
    const id = crypto.randomUUID(), kind = file.type.startsWith("audio") ? "track" : "logo";
    const base = { id, type: (kind === "logo" ? "image" : "file") as "image" | "file", name: file.name, file, contentType: file.type };
    yield { ...base, status: { type: "running" as const, reason: "uploading" as const, progress: 0 } } as PendingAttachment;
    const r = await fetch(`/api/upload/${kind}?name=${encodeURIComponent(file.name)}`, { method: "POST", body: file }).then((x) => x.json());
    uploaded.set(id, r.path);
    yield { ...base, status: { type: "requires-action" as const, reason: "composer-send" as const } } as PendingAttachment;
  },
  async send(a: PendingAttachment): Promise<CompleteAttachment> {
    const path = uploaded.get(a.id)!;
    return { ...a, status: { type: "complete" }, content: [{ type: "file", data: path, mimeType: a.contentType ?? "", filename: a.name }] } as CompleteAttachment;
  },
  async remove() {},
};
