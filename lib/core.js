// dsh-tts — 纯逻辑层（无宿主依赖，可独立测试）
//
// 负责：端点归一化、音色预设、payload 组装、文件名、错误格式化。
// 所有对 OpenAI 兼容 /v1/audio 服务的假设都集中在这里，便于适配不同后端。

export const FORMATS = ["wav", "mp3", "flac", "pcm", "aac", "opus"];

export const MIME_BY_FORMAT = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  flac: "audio/flac",
  pcm: "application/octet-stream",
  aac: "audio/aac",
  opus: "audio/ogg",
};

// Qwen3-TTS CustomVoice 系列的 9 个预置音色（服务端 id 为小写下划线）。
export const VOICE_PRESETS = {
  vivian:   { desc: "明亮、略带锋锐的年轻女声",       lang: "Chinese",  gender: "female" },
  serena:   { desc: "温暖柔和的年轻女声",             lang: "Chinese",  gender: "female" },
  uncle_fu: { desc: "低沉醇厚的成熟男声",             lang: "Chinese",  gender: "male" },
  dylan:    { desc: "清亮自然的北京年轻男声",         lang: "Chinese",  gender: "male", dialect: "Beijing" },
  eric:     { desc: "略带沙哑明亮感的成都男声",       lang: "Chinese",  gender: "male", dialect: "Sichuan" },
  ryan:     { desc: "节奏感强的动态男声",             lang: "English",  gender: "male" },
  aiden:    { desc: "中频清晰的阳光美式男声",         lang: "English",  gender: "male" },
  ono_anna: { desc: "轻快俏皮的日语女声",             lang: "Japanese", gender: "female" },
  sohee:    { desc: "情感丰富的温暖韩语女声",         lang: "Korean",   gender: "female" },
};

// 官方模型卡里的展示写法（Uncle_Fu / Ono_Anna）也要能用。
export const VOICE_ALIASES = {
  uncle_fu: "uncle_fu",
  ono_anna: "ono_anna",
};

export function normalizeVoice(raw) {
  const v = String(raw ?? "").trim();
  if (!v) return { voice: "", preset: false, inferredLanguage: "" };
  const key = v.toLowerCase().replace(/[\s-]+/g, "_");
  if (VOICE_PRESETS[key]) {
    return { voice: key, preset: true, inferredLanguage: VOICE_PRESETS[key].lang };
  }
  const alias = VOICE_ALIASES[key];
  if (alias) return { voice: alias, preset: true, inferredLanguage: VOICE_PRESETS[alias].lang };
  return { voice: v, preset: false, inferredLanguage: "" };
}

export function isVoiceDesignModel(model) {
  return /voicedesign/i.test(String(model || ""));
}

// 接受 origin、/v1、/v1/audio、/v1/audio/speech 或自定义前缀路径，归一化为 audio 基址。
export function normalizeEndpoint(raw) {
  let s = String(raw || "").trim();
  if (!s) throw new Error("endpoint 不能为空");
  if (!/^https?:\/\//i.test(s)) throw new Error(`endpoint 必须以 http:// 或 https:// 开头: ${s}`);
  s = s.replace(/\/+$/, "");
  if (/\/speech$/i.test(s)) s = s.replace(/\/speech$/i, "");
  if (/\/v1$/i.test(s)) s = `${s}/audio`;
  else if (!/\/v1\/audio$/i.test(s)) {
    const u = new URL(s);
    if (u.pathname === "" || u.pathname === "/") s = `${s}/v1/audio`;
  }
  return s;
}

export function deriveSpeechUrl(audioBase) {
  return `${audioBase}/speech`;
}

export function deriveVoicesUrl(audioBase) {
  return `${audioBase}/voices`;
}

export function deriveModelsUrl(audioBase) {
  const u = new URL(audioBase);
  return `${u.protocol}//${u.host}/v1/models`;
}

export function normalizeFormat(raw, fallback = "wav") {
  const f = String(raw || fallback).toLowerCase().trim();
  if (!FORMATS.includes(f)) {
    throw new Error(`不支持的格式 "${raw}"，可选：${FORMATS.join(" / ")}`);
  }
  return f;
}

export function normalizeSampleRate(raw, fallback = 0) {
  if (raw === null || raw === undefined || raw === "") return 0;
  const n = Number(raw);
  if (n !== 0 && n !== 8000 && n !== 24000) {
    throw new Error(`sampleRate 只能是 0（原生）/ 8000 / 24000，收到 ${raw}`);
  }
  return n;
}

// 组装 /speech 请求体；空值一律省略，避免部分后端把 "" 当合法值。
export function buildSpeechPayload({ model, input, voice, language, instructions, format, sampleRate, extra }) {
  const payload = { model, input, voice, response_format: format };
  if (language) payload.language = language;
  if (instructions) payload.instructions = instructions;
  if (sampleRate) payload.sample_rate = sampleRate;
  if (extra && typeof extra === "object") Object.assign(payload, extra);
  return payload;
}

// 解析 --extra 风格的 JSON 字符串参数；非法或不是对象时报错。
export function parseExtraParams(raw) {
  if (raw === null || raw === undefined || raw === "") return {};
  if (typeof raw === "object") return raw;
  let parsed;
  try {
    parsed = JSON.parse(String(raw));
  } catch (e) {
    throw new Error(`extraParams 必须是合法 JSON 对象: ${e.message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("extraParams 必须是非数组的 JSON 对象");
  }
  return parsed;
}

export function sanitizeFileName(raw) {
  const name = String(raw || "").trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_");
  return name.slice(0, 120);
}

// 保留中日韩字符的文件名 slug。
export function textSlug(text, maxLength = 24) {
  const cleaned = String(text || "")
    .replace(/[^0-9A-Za-z\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (cleaned || "tts").slice(0, maxLength);
}

export function outputFileName({ text, voice, format, fileName }) {
  if (fileName) {
    const safe = sanitizeFileName(fileName);
    return /\.[a-z0-9]+$/i.test(safe) ? safe : `${safe}.${format}`;
  }
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  // voice 部分保留下划线（uncle_fu 可读性更好），其余同 slug 规则
  const voiceSlug = String(voice || "voice")
    .replace(/[^0-9A-Za-z_\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 16) || "voice";
  return `tts_${ts}_${voiceSlug}_${textSlug(text, 16)}.${format}`;
}

export function formatApiError(status, body) {
  let detail = "";
  if (typeof body === "string") detail = body;
  else if (body && typeof body === "object") {
    detail = body.error?.message || body.message || body.error || body.detail || "";
    if (typeof detail !== "string") detail = JSON.stringify(detail);
    if (body.src) detail = `${detail} (src=${body.src})`;
  }
  detail = String(detail).slice(0, 500);
  return `HTTP ${status}${detail ? `: ${detail}` : ""}`;
}

export function pickAudioModels(modelsData) {
  const out = [];
  for (const m of modelsData?.data || []) {
    const caps = m.capabilities || {};
    const arch = m.architecture || {};
    const isAudio = caps.audio_speech || (arch.output_modalities || []).includes("audio");
    if (isAudio || /tts/i.test(m.id || "")) {
      out.push({ id: m.id, status: m.status?.value || "?" });
    }
  }
  return out;
}
