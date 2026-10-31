// dsh-tts 客户端半：在插件管理里渲染配置页，在会话里渲染可播放的语音卡片。
// 遵循宿主 slot 约定（与 dsh-video-gen / dsh-free-search 一致）：
//   plugins.row.config  key = "dsh-tts#dsh-tts"   → 配置卡片
//   tool.call.toolview  key = "tts_generate"      → 音频播放卡片
window.__ModuleLoader__.load({
  id: "dsh-tts",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const React = require("react");
    const h = React.createElement;
    const { useState, useEffect, useCallback } = React;

    const BRIDGE_PREFIX = "/api/dsh-tts";
    const PRESETS = [
      { value: "uncle_fu", label: "uncle_fu · 低沉醇厚成熟男声（中文）" },
      { value: "vivian", label: "vivian · 明亮微锋锐年轻女声（中文）" },
      { value: "serena", label: "serena · 温暖柔和年轻女声（中文）" },
      { value: "dylan", label: "dylan · 清亮北京年轻男声（中文·北京）" },
      { value: "eric", label: "eric · 沙哑明亮成都男声（中文·四川）" },
      { value: "ryan", label: "ryan · 节奏感动态男声（英文）" },
      { value: "aiden", label: "aiden · 阳光美式男声（英文）" },
      { value: "ono_anna", label: "ono_anna · 轻快俏皮女声（日语）" },
      { value: "sohee", label: "sohee · 温暖情感丰富女声（韩语）" },
    ];
    const FORMATS = ["wav", "mp3", "flac", "pcm", "aac", "opus"];
    const LANGUAGES = ["", "Auto", "Chinese", "English", "Japanese", "Korean", "German", "French", "Russian", "Portuguese", "Spanish", "Italian"];

    //#region styles
    (function injectStyles() {
      if (typeof document === "undefined") return;
      if (document.getElementById("dts-styles")) return;
      const style = document.createElement("style");
      style.id = "dts-styles";
      style.textContent = [
        ".dts-set-page{display:flex;flex-direction:column;gap:16px;color:inherit;font-size:14px;line-height:1.55}",
        ".dts-set-card{border:1px solid rgba(0,0,0,.08);border-radius:12px;background:rgba(255,255,255,.72);padding:14px 16px;display:flex;flex-direction:column;gap:10px}",
        "@media (prefers-color-scheme: dark){.dts-set-card{background:rgba(30,30,32,.7);border-color:rgba(255,255,255,.08)}}",
        ".dts-set-title{font-weight:600;font-size:14px;margin:0}",
        ".dts-set-hint{color:#6e6e73;font-size:12px;margin:0}",
        "@media (prefers-color-scheme: dark){.dts-set-hint{color:#a1a1a6}}",
        ".dts-set-error{color:#dc2626;font-size:12px;margin:0;white-space:pre-wrap}",
        "@media (prefers-color-scheme: dark){.dts-set-error{color:#f87171}}",
        ".dts-set-ok{color:#16a34a;font-size:12px;margin:0;white-space:pre-wrap}",
        "@media (prefers-color-scheme: dark){.dts-set-ok{color:#4ade80}}",
        ".dts-set-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}",
        ".dts-set-field{display:flex;flex-direction:column;gap:4px;min-width:0}",
        ".dts-set-label{font-size:12px;font-weight:500;color:#3a3a3c;display:flex;align-items:center;gap:6px}",
        "@media (prefers-color-scheme: dark){.dts-set-label{color:#d1d1d6}}",
        ".dts-set-input,.dts-set-select{width:100%;box-sizing:border-box;border:1px solid rgba(0,0,0,.12);border-radius:8px;padding:6px 10px;font:inherit;font-size:13px;color:inherit;background:rgba(0,0,0,.03)}",
        "@media (prefers-color-scheme: dark){.dts-set-input,.dts-set-select{border-color:rgba(255,255,255,.12);background:rgba(255,255,255,.05)}}",
        ".dts-set-input:focus-visible,.dts-set-select:focus-visible{outline:none;border-color:#0071e3}",
        ".dts-set-btn{border:1px solid rgba(0,0,0,.14);border-radius:8px;padding:6px 14px;font:inherit;font-size:13px;cursor:pointer;background:transparent;color:inherit}",
        ".dts-set-btn:hover:not(:disabled){background:rgba(0,0,0,.05)}",
        "@media (prefers-color-scheme: dark){.dts-set-btn:hover:not(:disabled){background:rgba(255,255,255,.07)}}",
        ".dts-set-btnPrimary{background:#0071e3;border-color:#0071e3;color:#fff}",
        ".dts-set-btnPrimary:hover:not(:disabled){background:#0a84ff}",
        ".dts-set-btn:disabled{opacity:.5;cursor:default}",
        ".dts-set-toggle{display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer}",
        ".dts-set-chip{font-size:11px;padding:2px 8px;border-radius:999px;background:rgba(0,113,227,.12);color:#0071e3}",
        "@media (prefers-color-scheme: dark){.dts-set-chip{color:#60a5fa}}",
        ".dts-set-result{border:1px dashed rgba(0,0,0,.15);border-radius:10px;padding:10px 12px;font-size:12px;white-space:pre-wrap;word-break:break-word;color:inherit}",
        "@media (prefers-color-scheme: dark){.dts-set-result{border-color:rgba(255,255,255,.18)}}",
        ".dts-audio{display:block;width:100%;max-width:520px;margin:2px 0}",
        ".dts-card{display:flex;flex-direction:column;gap:8px;padding:8px 0 4px;max-width:640px}",
        ".dts-meta{display:flex;gap:6px;flex-wrap:wrap;align-items:center}",
        ".dts-chip{font-size:11px;padding:2px 8px;border-radius:999px;background:rgba(0,0,0,.06);color:#3a3a3c}",
        "@media (prefers-color-scheme: dark){.dts-chip{background:rgba(255,255,255,.08);color:#d1d1d6}}",
        ".dts-chipOk{background:rgba(22,163,74,.12);color:#15803d}",
        "@media (prefers-color-scheme: dark){.dts-chipOk{color:#4ade80}}",
        ".dts-chipWarn{background:rgba(245,158,11,.14);color:#b45309}",
        "@media (prefers-color-scheme: dark){.dts-chipWarn{color:#f59e0b}}",
        ".dts-path{font-family:monospace;font-size:11px;color:#6e6e73;overflow-wrap:anywhere}",
        "@media (prefers-color-scheme: dark){.dts-path{color:#a1a1a6}}",
        ".dts-pending{display:flex;flex-direction:column;gap:4px;padding:4px 0}",
        ".dts-pending-title{font-weight:600;font-size:13px}",
        ".dts-hint{color:#6e6e73;font-size:12px;white-space:pre-wrap}",
        "@media (prefers-color-scheme: dark){.dts-hint{color:#a1a1a6}}",
        ".dts-error{color:#dc2626;font-size:12px;white-space:pre-wrap}",
        "@media (prefers-color-scheme: dark){.dts-error{color:#f87171}}",
        ".dts-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}",
        ".dts-link,.dts-btn{font:inherit;font-size:12px;padding:4px 10px;border-radius:8px;cursor:pointer;text-decoration:none;border:1px solid rgba(0,113,227,.35);color:#0071e3;background:rgba(0,113,227,.06)}",
      ].join("\n");
      document.head.appendChild(style);
    })();
    //#endregion

    //#region bridge
    async function bridgeCall(path, options) {
      let response;
      try {
        response = await fetch(`${BRIDGE_PREFIX}${path}`, options);
      } catch (error) {
        return { ok: false, code: "network", message: "无法连接宿主接口：" + (error && error.message ? error.message : String(error)) };
      }
      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      if (!response.ok) {
        const detail = body && (body.message || body.error);
        return { ok: false, code: "http-" + response.status, message: `接口返回 ${response.status}${detail ? "：" + detail : ""}` };
      }
      if (body === null || typeof body !== "object") {
        return { ok: false, code: "bad-response", message: "接口返回了无法解析的内容（宿主插件版本与页面不一致，请重载后重试）" };
      }
      return body;
    }
    const bridgeDescribe = () => bridgeCall("/config", { method: "GET" });
    const bridgeSave = (payload) => bridgeCall("/save", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload ?? {}) });
    const bridgeTest = (payload) => bridgeCall("/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload ?? {}) });
    //#endregion

    function Field(label, control, hint) {
      return h("div", { className: "dts-set-field" },
        h("label", { className: "dts-set-label" }, label, hint ? h("span", { className: "dts-set-chip" }, hint) : null),
        control);
    }

    function SettingsCard() {
      const [config, setConfig] = useState(null);
      const [revision, setRevision] = useState(0);
      const [version, setVersion] = useState("");
      const [secretSet, setSecretSet] = useState(false);
      const [status, setStatus] = useState({ kind: "", text: "" });
      const [busy, setBusy] = useState(false);
      const [probe, setProbe] = useState(null);

      const load = useCallback(async () => {
        const out = await bridgeDescribe();
        if (!out.ok) { setStatus({ kind: "error", text: out.message }); return; }
        let cfg = out.value.config || {};
        // 自定义音色描述（不在预置表里）→ 切到“自定义”哨兵并回填文本，避免下拉吞值
        if (cfg.voice && !PRESETS.some((p) => p.value === cfg.voice)) {
          cfg = { ...cfg, voice: "__custom__", _customVoiceHint: cfg.voice };
        }
        setConfig(cfg);
        setRevision(out.value.revision ?? 0);
        setVersion(out.value.version ?? "");
        const secrets = Array.isArray(out.value.secrets) ? out.value.secrets : [];
        setSecretSet(secrets.some((s) => s && Array.isArray(s.path) && s.path.join(".") === "apiKey" && s.set));
      }, []);
      useEffect(() => { load(); }, [load]);

      if (!config) {
        return h("div", { className: "dts-set-card" },
          h("p", { className: "dts-set-hint" }, status.kind === "error" ? status.text : "正在读取配置…"));
      }

      const patch = (key) => (event) => setConfig({ ...config, [key]: event.target.value });
      const input = (key, props) => h("input", { className: "dts-set-input", value: config[key] ?? "", onInput: patch(key), onChange: patch(key), ...props });
      const select = (key, options, props) => h("select", { className: "dts-set-select", value: config[key] ?? "", onChange: patch(key), ...props },
        options.map((o) => h("option", { key: String(typeof o === "string" ? o : o.value), value: typeof o === "string" ? o : o.value }, typeof o === "string" ? o : o.label)));

      const save = async () => {
        setBusy(true);
        // __custom__ 是 UI 哨兵：保存时换成自由描述文本；瞬态字段不下发
        const { _customVoiceHint, ...rest } = config;
        const payload = {
          ...rest,
          voice: rest.voice === "__custom__" ? String(_customVoiceHint || "").trim() : rest.voice,
          sampleRate: Number(rest.sampleRate) || 0,
          timeoutSec: Math.round(Number(rest.timeoutSec) || 300),
          expectedRevision: revision,
        };
        const out = await bridgeSave(payload);
        setBusy(false);
        if (!out.ok) { setStatus({ kind: "error", text: out.message || "保存失败" }); return; }
        setStatus({ kind: "ok", text: "已保存，立即生效。" });
        await load();
      };

      const test = async () => {
        setBusy(true);
        setStatus({ kind: "", text: "" });
        const out = await bridgeTest({ endpoint: config.endpoint, model: config.model });
        setBusy(false);
        if (!out.ok) { setStatus({ kind: "error", text: out.message || "测试失败" }); return; }
        setProbe(out.value);
      };

      return h("div", { className: "dts-set-page" },
        h("div", { className: "dts-set-card" },
          h("p", { className: "dts-set-title" }, "dsh-tts 设置 ", h("span", { className: "dts-set-chip" }, "v" + version)),
          h("p", { className: "dts-set-hint" }, "OpenAI 兼容 /v1/audio/speech 语音合成端点。改完点「保存」，无需重启。"),
          h("label", { className: "dts-set-toggle" },
            h("input", { type: "checkbox", checked: config.enabled !== false, onChange: (e) => setConfig({ ...config, enabled: e.target.checked }) }),
            "启用 tts_generate 工具"),
          Field("API 端点 URL", input("endpoint", { placeholder: "http://ai4090:8080/v1/audio", spellCheck: false }),
            "接受 origin / /v1 / /v1/audio / /speech 写法"),
          Field("模型", input("model", { placeholder: "Qwen3-TTS-12Hz-1.7B-CustomVoice", spellCheck: false })),
          Field("默认音色", select("voice", [{ value: "", label: "（留空：按模型类型兜底）" }, ...PRESETS, { value: "__custom__", label: "（自定义描述：VoiceDesign 用）" }]),
            "CustomVoice 用预置；VoiceDesign 可填自由描述"),
          config.voice === "__custom__"
            ? Field("自定义音色描述", input("_customVoiceHint", { placeholder: "一位低沉沙哑的中年男声，语速偏慢" }))
            : null,
          Field("默认语言", select("language", LANGUAGES.map((l) => ({ value: l, label: l === "" ? "（自动）" : l })))),
          Field("默认风格指令", input("instructions", { placeholder: "用温和从容的语气说 / speak cheerfully" })),
          h("div", { className: "dts-set-grid" },
            Field("输出格式", select("format", FORMATS)),
            Field("采样率", select("sampleRate", [
              { value: 0, label: "原生（默认）" },
              { value: 8000, label: "8000 Hz" },
              { value: 24000, label: "24000 Hz" },
            ])),
            Field("输出目录", input("outputDir", { placeholder: ".dsh-tts", spellCheck: false })),
            Field("超时（秒）", input("timeoutSec", { type: "number", min: 10, max: 3600 }))),
          Field("API Key（可选，secret）", input("apiKey", {
            type: "password",
            placeholder: secretSet ? "已保存（留空保持不变，输入新值覆盖）" : "留空 = 不发送鉴权头",
            spellCheck: false, autoComplete: "off",
          })),
          h("div", { className: "dts-actions" },
            h("button", { className: "dts-set-btn dts-set-btnPrimary", type: "button", disabled: busy, onClick: save }, "保存"),
            h("button", { className: "dts-set-btn", type: "button", disabled: busy, onClick: test }, "测试连通性"),
            h("button", { className: "dts-set-btn", type: "button", disabled: busy, onClick: load }, "重新读取")),
          status.kind === "error" ? h("p", { className: "dts-set-error" }, status.text) : null,
          status.kind === "ok" ? h("p", { className: "dts-set-ok" }, status.text) : null,
          probe ? h("div", { className: "dts-set-result" },
            `端点：${probe.base}`, "\n",
            probe.modelsError ? `模型列表失败：${probe.modelsError}` : `已加载音频模型：${(probe.models || []).map((m) => `${m.id}(${m.status})`).join("、") || "无"}`, "\n",
            probe.voicesError ? `音色列表失败：${probe.voicesError}（VoiceDesign 无预置属正常）` : `预置音色：${(probe.voices || []).join("、") || "无"}`) : null));
    }

    function summaryText() {
      return "文本生成语音 · 端点、模型、预置音色、风格指令可配置";
    }

    //#region 工具卡片
    function flattenText(block) {
      const content = block && block.content;
      if (!Array.isArray(content)) return "";
      return content.filter((part) => part && part.type === "text").map((part) => part.text).join("\n");
    }

    function TtsToolView(props) {
      const { phase, block, openFile } = props;
      if (phase !== "result") {
        const args = block && block.args && typeof block.args === "object" ? block.args : {};
        const text = typeof args.text === "string" ? args.text : "";
        return h("div", { className: "dts-pending" },
          h("div", { className: "dts-pending-title" }, "生成语音"),
          text ? h("div", { className: "dts-hint" }, text.slice(0, 200)) : null,
          h("div", { className: "dts-hint" }, "正在合成…"));
      }
      if (block && block.isError) {
        return h("div", { className: "dts-pending" },
          h("div", { className: "dts-pending-title" }, "语音生成失败"),
          h("div", { className: "dts-error" }, flattenText(block) || "unknown error"));
      }
      const meta = block && block.meta && typeof block.meta === "object" ? block.meta : null;
      if (!meta || typeof meta.url !== "string" || !meta.url) {
        return h("div", { className: "dts-pending" }, h("div", { className: "dts-hint" }, "语音已生成。"));
      }
      return h("div", { className: "dts-card" },
        h("audio", { className: "dts-audio", controls: true, preload: "metadata", src: meta.url }),
        h("div", { className: "dts-meta" },
          h("span", { className: "dts-chip dts-chipOk" }, "完成"),
          meta.voice ? h("span", { className: "dts-chip" }, String(meta.voice)) : null,
          Number.isFinite(Number(meta.durationSeconds)) ? h("span", { className: "dts-chip" }, `${Number(meta.durationSeconds)}s`) : null,
          meta.format ? h("span", { className: "dts-chip" }, String(meta.format)) : null,
          meta.model ? h("span", { className: "dts-chip" }, String(meta.model)) : null),
        meta.filePath ? h("div", { className: "dts-path" }, String(meta.filePath)) : null,
        h("div", { className: "dts-actions" },
          h("a", { className: "dts-link", href: meta.url, download: true }, "下载音频"),
          typeof openFile === "function" && meta.filePath
            ? h("button", { className: "dts-btn", type: "button", onClick: () => openFile(meta.filePath) }, "打开文件")
            : null));
    }
    //#endregion

    const inject = ["slots"];

    function apply(ctx) {
      ctx.slots.inject("plugins.row.config", () =>
        ctx.slots.register(
          {
            name: "plugins.row.config",
            key: "dsh-tts#dsh-tts",
          },
          (slotProps) =>
            slotProps && slotProps.view === "summary"
              ? summaryText()
              : h(SettingsCard, null)
        )
      );
      ctx.slots.inject("tool.call.toolview", () =>
        ctx.slots.register(
          {
            name: "tool.call.toolview",
            key: "tts_generate",
            priority: -10,
          },
          TtsToolView
        )
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
