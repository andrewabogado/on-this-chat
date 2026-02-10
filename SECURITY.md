# Security

## Overview

This extension runs only on `https://chatgpt.com/*` and `https://chat.openai.com/*`. It uses minimal permissions: **activeTab** and **scripting** (scripting is for potential future use; the background does not currently inject scripts).

## Practices

- **No eval or dynamic code**: No `eval()`, `new Function()`, or script injection. No `innerHTML` with user- or page-derived content.
- **Safe DOM output**: User/assistant text is shown only via `innerText` or `textContent`, and `aria-label`/`data-*` attributes, so it is not interpreted as HTML.
- **Selector safety**: Any ID used in `querySelector`/`querySelectorAll` (e.g. for `data-target`) is escaped with `CSS.escape()` to avoid selector injection if IDs ever contained special characters.
- **Message handling**: The content script only handles the `TOGGLE_SIDEBAR` action from the extension background; other actions are ignored. No remote or page-origin messages are processed.
- **No network**: The extension does not perform `fetch`, XHR, or load external scripts. The only “external” reference is an SVG `href` pointing to the host page’s own origin (`/cdn/...` on ChatGPT).
- **Permissions**: No access to cookies, storage, or other sites. No `tabs` permission (only `activeTab` when the user invokes the extension).

## Reporting a vulnerability

If you find a security issue, please report it responsibly. You can open a GitHub issue or contact the maintainer (see [README](README.md)) and allow time for a fix before any public disclosure.
