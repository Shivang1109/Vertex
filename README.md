# PrivateIDE

**100% on-device AI for developers. No API keys. No cloud. No data leaves your browser.**

Runs a full LLM (Liquid AI LFM2) in-browser via WebAssembly + WebGPU. Every inference happens locally — open DevTools → Network and watch: zero requests to any AI endpoint.

---

## Quick Start

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

> Requires a modern browser with WebAssembly support. Chrome 113+ or Edge 113+ recommended for WebGPU acceleration. Firefox works via WASM fallback.

---

## Demo Script (for judges / presentations)

### 1. First load (~3s)
The app initializes the WebAssembly runtime. No model is downloaded yet — that only happens when you click a feature.

### 2. Dev Mode — Private Code Analysis
1. Click **💻 Dev** in the header
2. Paste any code into the editor (or use the default factorial example)
3. Click **📖 Explain** — the model downloads (~250MB, cached after first time) and runs locally
4. Watch the HUD at the bottom: **tok/s**, **latency**, **0 bytes sent**
5. Try **🐛 Debug** with an error message, or **✨ Refactor**

**Ghost AI Autocomplete:** Type a comment like `// sort the array by` and pause 300ms — the model completes it inline. Press `Tab` to accept.

### 3. Research Mode — Private Document Q&A
1. Click **🔬 Research** in the header
2. Drag any PDF onto the drop zone (thesis draft, paper, confidential doc)
3. Type a question and click **💬 Ask Question**
4. The PDF is parsed entirely in-browser — never uploaded anywhere

### 4. Prove It
Click **🔍 Prove It** in the header. A live network monitor opens — interact with the AI and watch the counter stay at **0**.

Or open DevTools → Network → filter Fetch/XHR → run any inference. Zero AI requests.

---

## Architecture

```
Browser
├── React 19 + Vite 6 + TypeScript
├── Monaco Editor (VS Code editor engine)
├── PDF.js (client-side PDF parsing)
└── RunAnywhere SDK
    ├── LlamaCPP WASM backend (WebGPU accelerated)
    ├── LFM2-350M-Q4_K_M (default, ~250MB)
    └── LFM2-1.2B-Tool-Q4_K_M (optional, ~800MB)
```

All model weights are cached in the browser's Cache API after first download. Subsequent loads are instant and work fully offline.

---

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Explain code | `⌘E` / `Ctrl+E` |
| Generate docstring | `⌘D` / `Ctrl+D` |
| Debug code | `⌘G` / `Ctrl+G` |
| Refactor | `⌘⇧R` / `Ctrl+Shift+R` |
| Ask question (Research) | `⌘↵` / `Ctrl+Enter` |
| Open shortcuts modal | `⌘/` / `Ctrl+/` |

---

## Privacy Guarantee

- **Zero telemetry** — no analytics, no error reporting, no usage tracking
- **Zero cloud inference** — all AI runs in your browser process
- **Model weights cached locally** — downloaded once from HuggingFace, then fully offline
- **No API keys required** — ever

---

## Models

| Model | Size | Context | Best for |
|-------|------|---------|----------|
| LFM2 350M Q4_K_M | ~250MB | 2048 tokens | Fast tasks, quick explanations |
| LFM2 1.2B Tool Q4_K_M | ~800MB | 4096 tokens | Complex code, better reasoning |

Switch models via the dropdown in Dev or Research mode. The 1.2B model downloads on demand.
