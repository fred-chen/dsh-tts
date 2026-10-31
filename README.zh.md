# dsh-tts

> DeepSeek Harness 语音合成插件 — 把 OpenAI 兼容的 `/v1/audio/speech` TTS 服务（默认 `http://ai4090:8080/v1/audio`，Qwen3-TTS 家族）接进 DSH 对话。

装好后，直接对 AI 说「用福伯的声音把这段话念一遍」即可生成音频：文件自动落盘到会话工作目录，返回本地路径 + 浏览器内联播放链接。

## 特性

- **`tts_generate` 工具**：文本 → 语音，一次调用完成合成、落盘、播放链接
- **端点可自定义**：设置页改 endpoint 即可对接任意 OpenAI 兼容 TTS 服务
- **9 个预置音色**（CustomVoice）：大小写/驼峰写法都能识别（`Uncle_Fu` → `uncle_fu`），并按音色母语自动推断 `language`
- **VoiceDesign 也支持**：模型是 `…-VoiceDesign` 时，`voice` 字段按自由音色描述使用（如「一位低沉沙哑的中年男声」）
- **风格控制**：`instructions` 调情绪/语气/语速（CustomVoice 实测生效，同一音色不同情绪音色身份不变）
- **其他可调参数**：模型、输出格式（wav/mp3/flac/pcm/aac/opus）、采样率、超时、输出目录，以及 `extraParams` JSON 透传任意服务端参数

## 预置音色（Qwen3-TTS CustomVoice）

| voice | 描述 | 母语 |
|---|---|---|
| `vivian` | 明亮、略带锋锐的年轻女声 | 中文 |
| `serena` | 温暖柔和的年轻女声 | 中文 |
| `uncle_fu` | 低沉醇厚的成熟男声 | 中文 |
| `dylan` | 清亮自然的北京年轻男声 | 中文（北京） |
| `eric` | 略带沙哑明亮感的成都男声 | 中文（四川） |
| `ryan` | 节奏感强的动态男声 | 英文 |
| `aiden` | 中频清晰的阳光美式男声 | 英文 |
| `ono_anna` | 轻快俏皮的日语女声 | 日文 |
| `sohee` | 情感丰富的温暖韩语女声 | 韩文 |

## 安装

### 从 GitHub 安装（推荐）

```bash
cd ~/.dsh/profiles/desktop        # 或你正在使用的 profile 目录
pnpm add github:fred-chen/dsh-tts
```

然后把 `dsh-tts` 加入该 profile `package.json` 的 `dsh.profile.bundles`：

```json
{
  "dsh": {
    "profile": {
      "bundles": ["...", "dsh-tts"]
    }
  }
}
```

重启 DSH 生效。

### 从本地源码安装

```bash
cd ~/.dsh/profiles/desktop
cp -R /path/to/dsh-tts node_modules/dsh-tts
```

同样编辑 `package.json` 的 `dependencies`（`"dsh-tts": "file:/path/to/dsh-tts"`）与 `dsh.profile.bundles`。

## 配置

Plugins → dsh-tts（设置 ns：`dsh-tts`）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 是否注册 `tts_generate` 工具 |
| `endpoint` | `http://ai4090:8080/v1/audio` | 接受 origin / `/v1` / `/v1/audio` / `/v1/audio/speech` 写法，自动归一 |
| `apiKey` | （空，secret） | 需要时以 `Authorization: Bearer` 发送 |
| `model` | `Qwen3-TTS-12Hz-1.7B-CustomVoice` | 也可切 `…-VoiceDesign`；以服务端 `/v1/models` 实际加载为准 |
| `voice` | `uncle_fu` | 预置 id 或自由音色描述；留空时按模型类型兜底 |
| `language` | （空=自动） | 显式指定可提升准确率 |
| `instructions` | （空） | 全局默认风格指令 |
| `format` | `wav` | wav / mp3 / flac / pcm / aac / opus |
| `sampleRate` | `0` | 0=服务端原生，可选 8000 / 24000 |
| `outputDir` | `.dsh-tts` | 相对会话工作目录 |
| `timeoutSec` | `300` | 单次合成超时 |

设置桥还提供 HTTP 接口（宿主端口）：`GET/POST /api/dsh-tts/config`、`POST /api/dsh-tts/test`（探测可用模型与音色列表）。

## 工具用法示例

```json
// 预置音色 + 情绪指令
{ "text": "这个方案，我再说最后一遍，重写。", "voice": "uncle_fu", "instructions": "用特别愤怒的语气说" }

// 英文音色 + mp3
{ "text": "Hi, I'm Aiden.", "voice": "aiden", "format": "mp3" }

// VoiceDesign 自由造声
{ "model": "Qwen3-TTS-12Hz-1.7B-VoiceDesign", "voice": "一位年轻活泼的女声，语速偏快", "text": "测试一下自由音色设计！" }
```

## 已知边界

- CustomVoice 与 VoiceDesign 是两个独立 checkpoint，服务端一次只加载一个；切错模型会报 `no router for requested model` 或音色不对版，可先用 `POST /api/dsh-tts/test` 或 `/v1/models` 确认加载状态
- CustomVoice 代理（实测 llama-swap）对 `voice` 做**严格校验**：传非预置值直接返回 `HTTP 400 unsupported speaker` 并附可用列表；自由音色描述需要改用 VoiceDesign checkpoint
- `instructions` 是否生效取决于服务端适配层（实测 llama-swap 的 CustomVoice 代理生效；VoiceDesign 代理通常忽略它，改用 `voice` 传描述）
- 浏览器播放链接走 `http://127.0.0.1:<宿主端口>`，远程访问 GUI 时请用返回的本地 `filePath`
- artifact token 为进程内映射，重启后旧链接失效，本地文件不受影响

## 开发与测试

```bash
cd dsh-tts
node test/core.test.mjs
```

纯逻辑在 `lib/core.js`（可独立测试）；宿主装配在 `lib/index.js`。

## License

MIT
