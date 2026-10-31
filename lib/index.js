// dsh-tts — DeepSeek Harness 宿主插件
//
// 文本 → 语音：调用 OpenAI 兼容 /v1/audio/speech 端点（Qwen3-TTS 家族实测可用），
// 把生成的音频落盘到会话工作目录，并注册浏览器内联播放路由。
//
// 默认端点：http://ai4090:8080/v1/audio
// 默认模型：Qwen3-TTS-12Hz-1.7B-CustomVoice（9 个预置音色 + instructions 调风格）
// 也支持：  Qwen3-TTS-12Hz-1.7B-VoiceDesign（voice 字段 = 自由音色描述）
//
// 实测的响应头：X-Audio-Duration-Seconds、X-Audio-Sample-Rate（llama-swap / vLLM-Omni 代理）。

import { SettingsConflictError } from "@deepseek-ai/dsh-settings";
import { defineTool } from "@deepseek-ai/dsh-tools";
import z from "@deepseek-ai/schemastery";

import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

import {
  FORMATS,
  MIME_BY_FORMAT,
  VOICE_PRESETS,
  buildSpeechPayload,
  deriveModelsUrl,
  deriveSpeechUrl,
  deriveVoicesUrl,
  formatApiError,
  isVoiceDesignModel,
  normalizeEndpoint,
  normalizeFormat,
  normalizeSampleRate,
  normalizeVoice,
  outputFileName,
  parseExtraParams,
  pickAudioModels,
} from "./core.js";

const PLUGIN_VERSION = "0.1.1";
const NS = "dsh-tts";
const BRIDGE_PREFIX = "/api/dsh-tts";
const ARTIFACT_PREFIX = "/api/dsh-tts/artifacts";
const DEFAULT_ENDPOINT = "http://ai4090:8080/v1/audio";
const DEFAULT_MODEL = "Qwen3-TTS-12Hz-1.7B-CustomVoice";
const DEFAULT_OUTPUT_DIR = ".dsh-tts";
const MAX_TEXT_CHARS = 16000;

//#region 配置

function resolveConfig(config) {
  if (config === null || typeof config !== "object") return {};
  const out = {};
  for (const [key, value] of Object.entries(config)) {
    out[key] = value !== null && typeof value === "object" && typeof value.get === "function" ? value.get() : value;
  }
  return out;
}

function normalizeConfig(raw) {
  const cfg = raw && typeof raw === "object" ? raw : {};
  return {
    enabled: cfg.enabled !== false,
    endpoint: String(cfg.endpoint || DEFAULT_ENDPOINT).trim() || DEFAULT_ENDPOINT,
    apiKey: typeof cfg.apiKey === "string" ? cfg.apiKey : "",
    model: String(cfg.model ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL,
    voice: String(cfg.voice ?? "").trim(),
    language: String(cfg.language ?? "").trim(),
    instructions: String(cfg.instructions ?? "").trim(),
    format: String(cfg.format || "wav").trim(),
    sampleRate: Number(cfg.sampleRate ?? 0) || 0,
    outputDir: String(cfg.outputDir || DEFAULT_OUTPUT_DIR).trim() || DEFAULT_OUTPUT_DIR,
    timeoutSec: Number(cfg.timeoutSec ?? 300),
  };
}

function publicConfig(cfg) {
  const { apiKey, ...rest } = cfg;
  return rest;
}

const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  endpoint: z.string().default(DEFAULT_ENDPOINT).volatile(),
  apiKey: z.string().role("secret").volatile(),
  model: z.string().default(DEFAULT_MODEL).volatile(),
  voice: z.string().default("").volatile(),
  language: z.string().default("").volatile(),
  instructions: z.string().default("").volatile(),
  format: z.string().default("wav").volatile(),
  sampleRate: z.number().default(0).volatile(), // 0 = 服务端原生
  outputDir: z.string().default(DEFAULT_OUTPUT_DIR).volatile(),
  timeoutSec: z.number().default(300).volatile(),
});

//#endregion
//#region HTTP helpers

function writeJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
  });
  res.end(text);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) return undefined;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return undefined;
  }
}

function requestHeaders(apiKey, json) {
  const headers = {};
  if (json) headers["content-type"] = "application/json";
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  return headers;
}

async function fetchWithTimeout(url, init = {}, timeoutMs = 30_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readMaybeJson(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

//#endregion
//#region 音频流路由

const AUDIO_MIME_FALLBACK = "application/octet-stream";

function handleArtifactRequest(req, res, artifacts) {
  const token = decodeURIComponent(req.url.slice(ARTIFACT_PREFIX.length + 1).split("?")[0]);
  if (!token || token.includes("..")) {
    writeJson(res, 404, { ok: false, code: "not-found", message: "artifact not found" });
    return;
  }
  const entry = artifacts.get(token);
  if (!entry || !existsSync(entry.path)) {
    writeJson(res, 404, { ok: false, code: "not-found", message: "artifact file not found" });
    return;
  }
  const size = statSync(entry.path).size;
  res.writeHead(200, {
    "content-type": entry.mime || AUDIO_MIME_FALLBACK,
    "content-length": size,
    "cache-control": "no-store",
  });
  createReadStream(entry.path).pipe(res);
}

//#endregion
//#region tts_generate 工具

function buildTtsTool({ current, publicBase, registerArtifact, logger }) {
  return defineTool({
    name: "tts_generate",
    description:
      "Generate speech audio via the configured OpenAI-compatible /v1/audio/speech endpoint (default http://ai4090:8080/v1/audio, Qwen3-TTS). Saves the audio into the session workspace and returns the local file path plus a browser-playable URL. For the CustomVoice checkpoint pick one of the 9 preset voices (vivian, serena, uncle_fu, dylan, eric, ryan, aiden, ono_anna, sohee — case-insensitive) and optionally steer style/emotion/pace with `instructions`. For the VoiceDesign checkpoint put a free-form voice description in `voice` (e.g. 一位低沉沙哑的中年男声). language/instructions default to plugin settings; omit language to auto-match the preset's native language.",
    parameters: {
      text: {
        type: "string",
        required: true,
        description: "Text to speak. Up to 16000 characters.",
      },
      voice: {
        type: "string",
        description:
          "Preset voice id for CustomVoice models (uncle_fu / vivian / serena / dylan / eric / ryan / aiden / ono_anna / sohee), or a free-form voice description for VoiceDesign models. Defaults to the plugin setting.",
      },
      language: {
        type: "string",
        description: "Language: Chinese / English / Japanese / Korean / ... . Empty = auto (preset native language, then server Auto).",
      },
      instructions: {
        type: "string",
        description: "Style/emotion/pace instruction, e.g. 用温和从容的语气说 / speak cheerfully. Empty = plugin setting.",
      },
      model: {
        type: "string",
        description: "Model id served by the endpoint (…-CustomVoice or …-VoiceDesign). Defaults to the plugin setting.",
      },
      format: {
        type: "string",
        enum: FORMATS,
        description: "Audio output format. Default wav.",
      },
      sampleRate: {
        type: "integer",
        description: "Output sample rate Hz: 0 = server native (default), 8000 or 24000.",
      },
      fileName: {
        type: "string",
        description: "Output file name (extension optional). Auto-named when omitted.",
      },
      extraParams: {
        type: "string",
        description: 'Extra server params as a JSON object string, merged into the request body, e.g. {"temperature":0.3,"max_new_tokens":2048}.',
      },
    },
    presentation: {
      presentResult(args, value) {
        const lines = [
          `语音已生成：${value.filePath}`,
          `时长 ${value.durationSeconds ?? "?"}s · ${value.sampleRate ?? "?"} Hz · ${value.bytes} 字节 · ${value.format}`,
          `模型 ${value.model} · 音色 ${value.voice}${value.language ? ` · 语言 ${value.language}` : ""}`,
          `浏览器播放：${value.url}`,
        ];
        for (const note of value.notes || []) lines.push(`注意：${note}`);
        return [{ type: "text", text: lines.join("\n") }];
      },
      presentationMeta(args, value) {
        return {
          url: value.url,
          filePath: value.filePath,
          model: value.model,
          voice: value.voice,
          language: value.language || "",
          format: value.format,
          durationSeconds: value.durationSeconds ?? null,
          bytes: value.bytes,
        };
      },
    },
    presentCall(args) {
      return {
        card: "generic",
        kind: "other",
        title: "生成语音",
        rawInput: { text: args.text, voice: args.voice, model: args.model },
      };
    },
    async execute(args, exec) {
      const cfg = current();
      if (!cfg.enabled) throw new Error("tts_generate 已在插件设置中禁用");

      const text = String(args.text ?? "").trim();
      if (!text) throw new Error("text 不能为空");
      if (text.length > MAX_TEXT_CHARS) {
        throw new Error(`text 超过 ${MAX_TEXT_CHARS} 字符上限（当前 ${text.length}）`);
      }

      const notes = [];
      const model = String(args.model || cfg.model).trim() || DEFAULT_MODEL;
      let base;
      try {
        base = normalizeEndpoint(cfg.endpoint);
      } catch (e) {
        throw new Error(`插件设置里的 endpoint 不合法: ${e.message}`);
      }

      // voice：设置缺省 → 按模型类型兜底
      let voiceRaw = String(args.voice ?? cfg.voice ?? "").trim();
      if (!voiceRaw) {
        voiceRaw = isVoiceDesignModel(model) ? "一个自然沉稳的中文男声" : "uncle_fu";
        notes.push(`未指定 voice，已按模型类型使用默认值 "${voiceRaw}"`);
      }
      const { voice, preset, inferredLanguage } = normalizeVoice(voiceRaw);
      if (!preset && !isVoiceDesignModel(model) && /customvoice/i.test(model)) {
        notes.push(`"${voice}" 不在 CustomVoice 预置音色里；部分服务端会直接拒绝（报错会带上可用列表），自由音色描述请改用 VoiceDesign 模型`);
      }

      const language = String(args.language ?? cfg.language ?? "").trim() || (preset ? inferredLanguage : "");
      const instructions = args.instructions !== undefined ? String(args.instructions).trim() : cfg.instructions;
      const format = normalizeFormat(args.format ?? cfg.format);
      const sampleRate = normalizeSampleRate(args.sampleRate ?? cfg.sampleRate);
      const extra = parseExtraParams(args.extraParams);

      const payload = buildSpeechPayload({ model, input: text, voice, language, instructions, format, sampleRate, extra });

      const speechUrl = deriveSpeechUrl(base);
      logger?.info?.(`tts_generate → POST ${speechUrl} model=${model} voice=${voice} format=${format}`);
      const t0 = Date.now();
      const res = await fetchWithTimeout(
        speechUrl,
        { method: "POST", headers: requestHeaders(cfg.apiKey, true), body: JSON.stringify(payload) },
        Math.max(30, cfg.timeoutSec) * 1000,
      );
      if (!res.ok) {
        const body = await readMaybeJson(res);
        throw new Error(`语音合成失败 — ${formatApiError(res.status, body)}`);
      }
      const audio = Buffer.from(await res.arrayBuffer());
      if (!audio.length) throw new Error("服务端返回了空音频");

      const cwd = exec.agent?.session?.header?.cwd || process.cwd();
      const outputDir = path.resolve(cwd, cfg.outputDir || DEFAULT_OUTPUT_DIR);
      await mkdir(outputDir, { recursive: true });
      const fileName = outputFileName({
        text,
        voice,
        format,
        fileName: args.fileName ? String(args.fileName) : "",
      });
      const filePath = path.join(outputDir, fileName);
      await writeFile(filePath, audio);

      const token = registerArtifact(filePath, fileName, MIME_BY_FORMAT[format] || AUDIO_MIME_FALLBACK);
      const duration = Number(res.headers.get("x-audio-duration-seconds"));
      const outSampleRate = Number(res.headers.get("x-audio-sample-rate"));

      return {
        filePath,
        url: `${publicBase}${ARTIFACT_PREFIX}/${token}`,
        fileName,
        bytes: audio.length,
        format,
        model,
        voice,
        language,
        instructions: instructions || undefined,
        durationSeconds: Number.isFinite(duration) ? duration : null,
        sampleRate: Number.isFinite(outSampleRate) ? outSampleRate : undefined,
        elapsedSeconds: Number(((Date.now() - t0) / 1000).toFixed(2)),
        ...(notes.length ? { notes } : {}),
      };
    },
  });
}

//#endregion
//#region 插件

function apply(ctx, config) {
  const logger = ctx.logger;
  const current = () => normalizeConfig(resolveConfig(config));
  const artifacts = new Map();

  const registerArtifact = (filePath, name, mime) => {
    const token = randomBytes(18).toString("base64url");
    artifacts.set(token, { path: path.resolve(filePath), name, mime });
    while (artifacts.size > 200) {
      const oldest = artifacts.keys().next().value;
      artifacts.delete(oldest);
    }
    return token;
  };

  const getDescriptor = () => {
    let settings;
    try {
      settings = ctx.get("settings");
    } catch {
      settings = undefined;
    }
    if (!settings || typeof settings.describe !== "function") return undefined;
    try {
      return settings.describe({ redactSecrets: true }).find((candidate) => String(candidate.ns) === NS);
    } catch {
      return undefined;
    }
  };

  const describe = async () => {
    const descriptor = getDescriptor();
    let toolNames = [];
    let toolError = "";
    try {
      const toolRuntime = ctx.get("tools");
      toolNames = toolRuntime && typeof toolRuntime.schemas === "function"
        ? toolRuntime.schemas().map((schema) => schema.name)
        : [];
    } catch (error) {
      toolError = error instanceof Error ? error.message : String(error);
    }
    return {
      ok: true,
      value: {
        ns: NS,
        version: PLUGIN_VERSION,
        revision: descriptor ? descriptor.revision : 0,
        config: descriptor ? descriptor.value : publicConfig(current()),
        secrets: descriptor && Array.isArray(descriptor.secrets) ? descriptor.secrets : [],
        presets: VOICE_PRESETS,
        formats: FORMATS,
        defaultEndpoint: DEFAULT_ENDPOINT,
        defaultModel: DEFAULT_MODEL,
        toolRegistered: toolNames.includes("tts_generate"),
        toolNames,
        toolError,
      },
    };
  };

  const save = async (body) => {
    if (body === null || typeof body !== "object") {
      return { ok: false, code: "bad-request", message: "malformed save request" };
    }
    const cfg = current();
    let endpoint, format, sampleRate;
    try {
      endpoint = normalizeEndpoint(body.endpoint ?? cfg.endpoint);
      format = normalizeFormat(body.format ?? cfg.format);
      sampleRate = normalizeSampleRate(body.sampleRate ?? cfg.sampleRate);
    } catch (error) {
      return { ok: false, code: "invalid-config", message: error instanceof Error ? error.message : String(error) };
    }
    const timeoutSec = Number(body.timeoutSec ?? cfg.timeoutSec);
    if (!Number.isInteger(timeoutSec) || timeoutSec < 10 || timeoutSec > 3600) {
      return { ok: false, code: "invalid-config", message: "timeoutSec 必须是 10–3600 的整数" };
    }
    const outputDir = String(body.outputDir ?? cfg.outputDir).trim();
    if (!outputDir) return { ok: false, code: "invalid-config", message: "outputDir 不能为空" };
    const model = String(body.model ?? cfg.model).trim();
    const voice = body.voice !== undefined ? String(body.voice).trim() : cfg.voice;
    const language = body.language !== undefined ? String(body.language).trim() : cfg.language;
    const instructions = body.instructions !== undefined ? String(body.instructions).trim() : cfg.instructions;

    const ops = [
      { op: "set", path: ["enabled"], value: body.enabled !== false },
      { op: "set", path: ["endpoint"], value: endpoint },
      { op: "set", path: ["model"], value: model },
      { op: "set", path: ["voice"], value: voice },
      { op: "set", path: ["language"], value: language },
      { op: "set", path: ["instructions"], value: instructions },
      { op: "set", path: ["format"], value: format },
      { op: "set", path: ["sampleRate"], value: sampleRate },
      { op: "set", path: ["outputDir"], value: outputDir },
      { op: "set", path: ["timeoutSec"], value: timeoutSec },
    ];
    if (typeof body.apiKey === "string" && body.apiKey.trim()) {
      ops.push({ op: "set", path: ["apiKey"], value: body.apiKey.trim() });
    } else if (body.clearApiKey === true) {
      ops.push({ op: "unset", path: ["apiKey"] });
    }

    const expectedRevision = typeof body.expectedRevision === "number" ? body.expectedRevision : undefined;
    try {
      await ctx.get("settings").mutate(NS, ops, expectedRevision);
    } catch (error) {
      if (error instanceof SettingsConflictError) {
        return { ok: false, code: "settings-conflict", message: error.message };
      }
      return { ok: false, code: "internal", message: error instanceof Error ? error.message : String(error) };
    }
    return describe();
  };

  // 探测端点：加载了哪些 TTS 模型、CustomVoice 有哪些预置音色。
  const test = async (body) => {
    const cfg = current();
    let base;
    try {
      base = normalizeEndpoint((body && body.endpoint) || cfg.endpoint);
    } catch (error) {
      return { ok: false, code: "invalid-endpoint", message: error instanceof Error ? error.message : String(error) };
    }
    const apiKey = body && typeof body.apiKey === "string" && body.apiKey.trim() ? body.apiKey.trim() : cfg.apiKey;
    const headers = requestHeaders(apiKey, false);
    const model = String((body && body.model) || cfg.model || DEFAULT_MODEL).trim();

    let models = [];
    let modelsError = "";
    try {
      const res = await fetchWithTimeout(deriveModelsUrl(base), { headers }, 10_000);
      const payload = await readMaybeJson(res);
      if (res.ok && payload && Array.isArray(payload.data)) models = pickAudioModels(payload);
      else modelsError = formatApiError(res.status, payload);
    } catch (error) {
      modelsError = error instanceof Error ? error.message : String(error);
    }

    let voices = [];
    let voicesError = "";
    try {
      const res = await fetchWithTimeout(`${deriveVoicesUrl(base)}?model=${encodeURIComponent(model)}`, { headers }, 10_000);
      const payload = await readMaybeJson(res);
      if (res.ok && payload) voices = payload.voices || payload.data || [];
      else voicesError = formatApiError(res.status, payload);
    } catch (error) {
      voicesError = error instanceof Error ? error.message : String(error);
    }

    return { ok: true, value: { base, model, models, modelsError, voices, voicesError } };
  };

  const makeBridgeRoutes = () => [
    {
      kind: "exact",
      method: "GET",
      path: `${BRIDGE_PREFIX}/config`,
      handler: async (req, res) => writeJson(res, 200, await describe()),
    },
    {
      kind: "exact",
      method: "POST",
      path: `${BRIDGE_PREFIX}/config`,
      handler: async (req, res) => {
        const body = await readJsonBody(req);
        const out = await save(body);
        writeJson(res, out.ok ? 200 : 400, out);
      },
    },
    {
      kind: "exact",
      method: "POST",
      path: `${BRIDGE_PREFIX}/test`,
      handler: async (req, res) => {
        const body = (await readJsonBody(req)) || {};
        const out = await test(body);
        writeJson(res, out.ok ? 200 : 400, out);
      },
    },
  ];

  // 设置桥 + 音频流路由
  ctx.inject(["webServer", "settings"], (sctx) => {
    // auto: true → 宿主设置页按 Config schema 自动生成配置表单。
    // dsh-settings.configure 的文档：auto 默认为 true；dsh-video-gen 是因为自带
    // 自定义客户端设置页才关掉它——本插件没有自定义 UI，必须保持 true，
    // 否则插件管理界面里会没有可进入的配置页。
    sctx.effect(() => sctx.settings.configure({ auto: true }, ctx.fiber), "dsh-tts: settings page policy");

    sctx.effect(() => {
      const disposers = makeBridgeRoutes().map((route) => sctx.webServer.register(route));
      disposers.push(
        sctx.webServer.register({
          kind: "prefix",
          path: ARTIFACT_PREFIX,
          handler: (req, res) => handleArtifactRequest(req, res, artifacts),
        }),
      );
      return () => {
        for (const dispose of disposers) dispose();
      };
    }, "dsh-tts: settings and artifact routes");

    logger.info(`dsh-tts: bridge ready at ${BRIDGE_PREFIX} (${PLUGIN_VERSION})`);
  });

  // 工具注册
  ctx.inject(["tools", "webServer", "settings"], (sctx) => {
    let disposeTool = null;
    const refresh = () => {
      if (disposeTool) {
        disposeTool();
        disposeTool = null;
      }
      if (!current().enabled) return;
      const publicBase = `http://127.0.0.1:${sctx.webServer.port}`;
      disposeTool = sctx.tools.register(buildTtsTool({ current, publicBase, registerArtifact, logger }));
    };

    sctx.effect(() => {
      refresh();
      return () => {
        if (disposeTool) {
          disposeTool();
          disposeTool = null;
        }
      };
    }, "dsh-tts: tts_generate tool");

    sctx.on("settings/document-updated", (ns) => {
      if (String(ns) === NS) refresh();
    });
  });

  logger.info(
    `dsh-tts: ready (${PLUGIN_VERSION}) — configure at Plugins → dsh-tts → ${NS}; tool: tts_generate`,
  );
}

export { Config, apply, buildTtsTool, PLUGIN_VERSION, NS, BRIDGE_PREFIX, ARTIFACT_PREFIX };
