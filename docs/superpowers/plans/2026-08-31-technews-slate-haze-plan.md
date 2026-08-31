# TechNews Slate Haze Background Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Soften the dashboard background and text contrast while preserving the calm graphite visual language.

**Architecture:** Keep the existing semantic-token override in `public/theme-calm-graphite.css`. Update only those tokens and the theme test; do not touch layout, content, or unrelated dirty files.

**Tech Stack:** CSS custom properties and Node.js `node:test`.

## Global Constraints

- All changes, tests, commits, and pushes run on Alibaba Cloud.
- Modify only `public/theme-calm-graphite.css` and `tests/theme-calm-graphite.test.mjs`.
- Preserve the single jade accent, one dark theme, and disabled grain.
- Do not modify existing unrelated working-tree changes.

### Task 1: Replace high-contrast graphite tokens

**Files:**
- Modify: `tests/theme-calm-graphite.test.mjs`
- Modify: `public/theme-calm-graphite.css`

- [ ] Step 1: Update the test to require the literal slate haze tokens: `--void: #3E4D55`, `--panel: #50616A`, `--panel-2: #5B6D75`, `--ink: #DCE5E7`, `--ink-soft: #C0CDD0`, `--muted: #A8B7BB`, and `--accent: #7CC2A7`.
- [ ] Step 2: Run `node --test tests/theme-calm-graphite.test.mjs`; it must fail against the old palette.
- [ ] Step 3: Replace the theme `:root` tokens and related gradient, shadow, scrollbar, detail, and thumb transparency values with the slate haze values.
- [ ] Step 4: Run `node --test tests/*.test.mjs`; all tests must pass.
- [ ] Step 5: Review the staged file list, then add only the two task files, commit with `style: soften slate haze dashboard background`, and push `origin main`.