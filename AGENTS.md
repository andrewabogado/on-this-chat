# Agent and contributor context

This file gives coding agents and new contributors enough context to work on **On This Chat** without reading the whole codebase.

## What this project is

- **Chrome extension** (Manifest V3) that injects a **table of contents** into ChatGPT conversation pages.
- **No build step**: plain JavaScript and CSS. Edit and reload the extension to test.
- **Runtime**: Content script runs on `https://chatgpt.com/*` and `https://chat.openai.com/*` at `document_idle`.

## Repo layout

| Path             | Purpose |
|------------------|--------|
| `manifest.json`  | Extension manifest: name, permissions, content_scripts (content.js + styles.css), background service worker. |
| `background.js`  | Service worker: handles extension icon click, injects/removes script if needed. |
| `content.js`     | Main logic: finds conversation articles, parses user messages and assistant H1/H2, builds sidebar/compact TOC, scroll sync, popover, URL/chat change handling. |
| `styles.css`     | All UI: sidebar, compact rail, popover, scroll area, fade overlays, animations (slide-in from right), dark mode tweaks. |

## Key behaviors

- **TOC source**: `article[data-testid^="conversation-turn-"]` (and fallback `article`). User messages from `[data-message-author-role="user"]`; assistant headings from `h1, h2` inside assistant turns.
- **IDs**: Sections get stable IDs (e.g. `toc-sec-0`). Content script sets `scroll-margin-top` on targets for scroll-into-view.
- **Layout**: Wide viewport → sidebar with `.toc-scroll-area` and list. Below ~1660px → compact `.toc-dash-rail` + `.toc-popover` on hover.
- **Animations**: Slide-in from right (transform + opacity) for sidebar list, dash rail, and popover; `toc-loaded` class triggers after first paint; popover exit uses delayed `visibility` so the slide-out isn’t cut off.

## How to test changes

1. In Chrome: `chrome://extensions` → Load unpacked → select this repo.
2. After editing: click **Reload** on the extension.
3. Open a ChatGPT conversation with multiple messages and some H1/H2 in assistant replies; confirm TOC, scroll sync, and compact/popover behavior.

## Conventions

- **No dependencies**: Keep it a zero-build extension; no npm/Node required.
- **Compat**: Content script and CSS are written to work on the current ChatGPT DOM; selectors may need updates if OpenAI change the page.
- **Superpowers**: The repo is Superpowers-friendly; see [CONTRIBUTING.md](CONTRIBUTING.md) and [Superpowers](https://github.com/obra/superpowers).
