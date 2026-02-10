# Contributing to On This Chat

Thanks for your interest in contributing.

## Setup

1. **Fork and clone** the repo.
2. **Load the extension in Chrome**
   - Open `chrome://extensions`
   - Enable **Developer mode**
   - Click **Load unpacked** and select this repo’s root directory.

## Making changes

- **Branch**: Create a branch from `main` for your work (e.g. `feature/short-name` or `fix/issue-description`).
- **Scope**: Prefer small, focused changes. For larger work, consider breaking it into a few PRs.
- **Code style**: Match the existing style (plain JS, no build step). Keep the content script and styles maintainable.

## Testing

There is no automated test suite. Please verify manually:

1. Reload the extension in `chrome://extensions` after code changes.
2. Open [chatgpt.com](https://chatgpt.com) and start or open a conversation with several messages and headings (H1/H2 in assistant replies).
3. Check:
   - TOC appears and lists user messages and assistant headings.
   - Clicking TOC items scrolls to the right section and highlights the active item.
   - On a narrow viewport, the compact rail and popover work and animate smoothly.
   - No console errors on the page.

## Submitting changes

1. **Commit**: Use clear commit messages (e.g. “Add slide-in for TOC list”, “Fix popover exit animation”).
2. **Push** your branch and open a **Pull Request** against `main`.
3. Describe what changed and how you tested it. Link any related issue.

## Using Superpowers

This project is set up to work well with [Superpowers](https://github.com/obra/superpowers) (an agentic skills framework for design, planning, TDD, and code review). If you use Claude Code, Codex, or OpenCode with Superpowers:

- You can use **brainstorming** and **writing-plans** for new features or refactors.
- **test-driven-development** applies where tests are added (e.g. if we add a test harness later).
- **requesting-code-review** and **receiving-code-review** align with our PR process.

Project-specific context for humans and agents is in [AGENTS.md](AGENTS.md).
