# dsh-tts

> DeepSeek Harness TTS plugin — connect any OpenAI-compatible `/v1/audio/speech` server (default `http://ai4090:8080/v1/audio`, Qwen3-TTS family) to your DSH conversations.

Ask the agent "speak this in Uncle Fu's voice" and get an audio file in your session workspace plus an in-browser playback link.

- **`tts_generate` tool**: text → speech in one call (synthesize, save, playback URL)
- **Configurable endpoint URL** for any OpenAI-compatible TTS server
- **9 preset voices** (CustomVoice): case-insensitive ids (`Uncle_Fu` → `uncle_fu`), language auto-inferred from the preset's native language
- **VoiceDesign support**: with a `…-VoiceDesign` checkpoint, `voice` is a free-form voice description
- **Style control**: `instructions` for emotion / tone / speaking pace
- **Tunable parameters**: model, output format (wav/mp3/flac/pcm/aac/opus), sample rate, timeout, output dir, and `extraParams` raw JSON passthrough

## Install (from GitHub)

```bash
cd ~/.dsh/profiles/desktop
pnpm add github:fred-chen/dsh-tts
```

Then add `dsh-tts` to `dsh.profile.bundles` in the profile `package.json` and restart DSH.

See [README.zh.md](./README.zh.md) for the full (Chinese) docs: settings table, preset voice roster, usage examples, troubleshooting.

## Tests

```bash
node test/core.test.mjs
```

MIT licensed.
