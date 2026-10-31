// 离线回归：execute 结果 / presentCall / presentationMeta 的每个返回值都必须
// 通过宿主 dsh-util-values 的 snapshotJsonValue（"lossless JSON"）——
// v0.1.3 及之前 instructions||undefined 产生的显式 undefined 键会让宿主报
// "value is not lossless JSON"，本文件是它的绊网。
// 运行：node test/execute.test.mjs （peer 依赖不可用时自动跳过，不影响 CI）
let snapshotJsonValue;
try {
  ({ snapshotJsonValue } = await import("@deepseek-ai/dsh-util-values"));
} catch {
  console.log("execute.test: @deepseek-ai/dsh-util-values 不可用，跳过（需在 DSH profile 环境或 stub node_modules 下运行）");
  process.exit(0);
}
const { buildTtsTool } = await import("../lib/index.js");
const assert = await import("node:assert/strict");
const os = await import("node:os");
const fs = await import("node:fs");
const path = await import("node:path");

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-tts-test-"));
const baseCfg = {
  enabled: true, endpoint: "http://example.invalid/v1/audio", apiKey: "",
  model: "Qwen3-TTS-12Hz-1.7B-CustomVoice", voice: "uncle_fu", language: "",
  instructions: "", format: "wav", sampleRate: 0, outputDir: ".dsh-tts", timeoutSec: 30,
};
const mkTool = () => buildTtsTool({
  current: () => baseCfg,
  publicBase: "http://127.0.0.1:1",
  registerArtifact: () => "test-token",
  logger: { info() {}, error() {} },
});

let n = 0;
const t = async (name, fn) => {
  n++;
  try { await fn(); console.log(`  ok ${name}`); }
  catch (e) { console.error(`FAIL ${name}: ${e.message}`); process.exitCode = 1; }
};

const mkFetch = (headers) => async () => new Response(Buffer.from("RIFF\0\0\0\0WAVEfmt data"), {
  status: 200, headers: { "content-type": "audio/wav", ...headers },
});
const execCtx = { agent: { session: { header: { cwd } } } };

await t("happy path: result is lossless JSON", async () => {
  globalThis.fetch = mkFetch({ "x-audio-duration-seconds": "1.5", "x-audio-sample-rate": "24000" });
  const result = await mkTool().execute({ text: "测试一下", instructions: "愤怒一点" }, execCtx);
  assert.notEqual(snapshotJsonValue(result), void 0, "result rejected by host");
  assert.ok(Object.values(result).every((v) => v !== undefined), `explicit undefined key present: ${JSON.stringify(Object.keys(result).filter((k) => result[k] === undefined))}`);
  assert.equal(result.durationSeconds, 1.5);
});

await t("no duration/sample-rate headers: still lossless", async () => {
  globalThis.fetch = mkFetch({});
  const result = await mkTool().execute({ text: "无指令无头" }, execCtx);
  assert.notEqual(snapshotJsonValue(result), void 0, "result rejected by host");
  assert.ok(!("durationSeconds" in result), "durationSeconds must be omitted");
  assert.ok(!("instructions" in result), "instructions must be omitted when empty");
});

await t("presentCall with optional args omitted is lossless", async () => {
  const tool = mkTool();
  const call = tool.presentCall({ text: "只给文本" });
  assert.notEqual(snapshotJsonValue(call), void 0, "presentCall rejected by host");
});

await t("presentationMeta is lossless on both result shapes", async () => {
  globalThis.fetch = mkFetch({ "x-audio-duration-seconds": "2" });
  const tool = mkTool();
  const withDur = await tool.execute({ text: "甲" }, execCtx);
  globalThis.fetch = mkFetch({});
  const noDur = await tool.execute({ text: "乙" }, execCtx);
  assert.notEqual(snapshotJsonValue(tool.output.presentationMeta({ text: "甲" }, withDur)), void 0);
  assert.notEqual(snapshotJsonValue(tool.output.presentationMeta({ text: "乙" }, noDur)), void 0);
});

fs.rmSync(cwd, { recursive: true, force: true });
console.log(`\n${n} execute tests, exit=${process.exitCode || 0}`);
