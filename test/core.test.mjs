// dsh-tts core 层单测：node test/core.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import {
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
  textSlug,
} from "../lib/core.js";

let n = 0;
const t = (name, fn) => {
  n++;
  try {
    fn();
    console.log(`  ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}: ${e.message}`);
    process.exitCode = 1;
  }
};

// ---- endpoint 归一化
t("endpoint: v1/audio base kept", () =>
  assert.equal(normalizeEndpoint("http://ai4090:8080/v1/audio"), "http://ai4090:8080/v1/audio"));
t("endpoint: full speech url folds back", () =>
  assert.equal(normalizeEndpoint("http://ai4090:8080/v1/audio/speech"), "http://ai4090:8080/v1/audio"));
t("endpoint: origin expands", () =>
  assert.equal(normalizeEndpoint("http://host:1234"), "http://host:1234/v1/audio"));
t("endpoint: /v1 expands", () =>
  assert.equal(normalizeEndpoint("http://host:1234/v1"), "http://host:1234/v1/audio"));
t("endpoint: trailing slash trimmed", () =>
  assert.equal(normalizeEndpoint("http://h:1/v1/audio///"), "http://h:1/v1/audio"));
t("endpoint: custom path passthrough", () =>
  assert.equal(normalizeEndpoint("http://h:1/relay/tts"), "http://h:1/relay/tts"));
t("endpoint: rejects non-http", () => assert.throws(() => normalizeEndpoint("ftp://x")));
t("endpoint: rejects empty", () => assert.throws(() => normalizeEndpoint("  ")));

t("derived urls", () => {
  const base = "http://ai4090:8080/v1/audio";
  assert.equal(deriveSpeechUrl(base), "http://ai4090:8080/v1/audio/speech");
  assert.equal(deriveVoicesUrl(base), "http://ai4090:8080/v1/audio/voices");
  assert.equal(deriveModelsUrl(base), "http://ai4090:8080/v1/models");
});

// ---- 音色
t("voice: lowercase preset", () => {
  const r = normalizeVoice("uncle_fu");
  assert.equal(r.voice, "uncle_fu");
  assert.equal(r.preset, true);
  assert.equal(r.inferredLanguage, "Chinese");
});
t("voice: official display casing Uncle_Fu folds", () => {
  assert.equal(normalizeVoice("Uncle_Fu").voice, "uncle_fu");
});
t("voice: space/dash variants fold", () => {
  assert.equal(normalizeVoice("Ono Anna").voice, "ono_anna");
  assert.equal(normalizeVoice("ono-anna").voice, "ono_anna");
});
t("voice: freeform description passes through", () => {
  const r = normalizeVoice("一位低沉沙哑的中年男声");
  assert.equal(r.voice, "一位低沉沙哑的中年男声");
  assert.equal(r.preset, false);
  assert.equal(r.inferredLanguage, "");
});
t("voice: all 9 presets present", () => assert.equal(Object.keys(VOICE_PRESETS).length, 9));
t("voicedesign detection", () => {
  assert.ok(isVoiceDesignModel("Qwen3-TTS-12Hz-1.7B-VoiceDesign"));
  assert.ok(!isVoiceDesignModel("Qwen3-TTS-12Hz-1.7B-CustomVoice"));
});

// ---- payload
t("payload: omits empty optional fields", () => {
  const p = buildSpeechPayload({ model: "m", input: "hi", voice: "aiden", language: "", instructions: "", format: "wav", sampleRate: 0 });
  assert.deepEqual(p, { model: "m", input: "hi", voice: "aiden", response_format: "wav" });
});
t("payload: includes all fields + extra merge", () => {
  const p = buildSpeechPayload({ model: "m", input: "你好", voice: "uncle_fu", language: "Chinese", instructions: "慢一点", format: "mp3", sampleRate: 24000, extra: { temperature: 0.3 } });
  assert.deepEqual(p, { model: "m", input: "你好", voice: "uncle_fu", response_format: "mp3", language: "Chinese", instructions: "慢一点", sample_rate: 24000, temperature: 0.3 });
});
t("extraParams: parse json string", () => assert.deepEqual(parseExtraParams('{"seed":7}'), { seed: 7 }));
t("extraParams: rejects array", () => assert.throws(() => parseExtraParams("[1,2]")));
t("extraParams: rejects bad json", () => assert.throws(() => parseExtraParams("{oops")));

// ---- format / sample rate
t("format: defaults and validation", () => {
  assert.equal(normalizeFormat(""), "wav");
  assert.equal(normalizeFormat("MP3"), "mp3");
  assert.throws(() => normalizeFormat("ogg-vorbis"));
});
t("sampleRate: 0/8000/24000 only", () => {
  assert.equal(normalizeSampleRate(""), 0);
  assert.equal(normalizeSampleRate(24000), 24000);
  assert.throws(() => normalizeSampleRate(48000));
});

// ---- 文件名
t("filename: explicit name gets extension", () =>
  assert.equal(outputFileName({ text: "x", voice: "v", format: "mp3", fileName: "hello" }), "hello.mp3"));
t("filename: explicit name keeps own extension", () =>
  assert.equal(outputFileName({ text: "x", voice: "v", format: "mp3", fileName: "a.wav" }), "a.wav"));
t("filename: auto name is safe", () => {
  const name = outputFileName({ text: "你好，世界！/ path:test", voice: "uncle_fu", format: "wav", fileName: "" });
  assert.match(name, /^tts_\d{14}_uncle_fu_.*\.wav$/);
  assert.ok(!name.includes("/"), "no path separators");
});
t("slug keeps CJK", () => assert.equal(textSlug("你好，世界", 10), "你好-世界"));

// ---- 错误格式化 / 模型筛选
t("formatApiError: llama-swap style", () => {
  const s = formatApiError(404, { error: "no router for requested model", src: "llama-swap" });
  assert.match(s, /HTTP 404/);
  assert.match(s, /no router/);
  assert.match(s, /src=llama-swap/);
});
t("pickAudioModels: filters tts by capability and name", () => {
  const out = pickAudioModels({
    data: [
      { id: "Qwen3-TTS-12Hz-1.7B-CustomVoice", capabilities: { audio_speech: true }, status: { value: "loaded" } },
      { id: "DeepSeek-V4.1-Flash", status: { value: "loaded" } },
      { id: "some-tts-extra", status: { value: "unloaded" } },
    ],
  });
  assert.deepEqual(out.map((m) => m.id), ["Qwen3-TTS-12Hz-1.7B-CustomVoice", "some-tts-extra"]);
});

// 版本一致性：package.json 与 lib/index.js 的 PLUGIN_VERSION 必须同步
// （0.1.2 就因忘改常量让设置页徽章显示成了 v0.1.1）
t("version parity package.json <-> PLUGIN_VERSION", () => {
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const src = fs.readFileSync(new URL("../lib/index.js", import.meta.url), "utf8");
  const m = src.match(/const PLUGIN_VERSION = "([^"]+)"/);
  assert.ok(m, "PLUGIN_VERSION constant found");
  assert.equal(m[1], pkg.version, `PLUGIN_VERSION ${m[1]} != package.json ${pkg.version}`);
});

console.log(`\n${n} tests, exit=${process.exitCode || 0}`);
