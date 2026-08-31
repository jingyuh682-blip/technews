# TechNews Calm Graphite Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the eye-fatiguing black-and-gold dashboard palette with a calm graphite and jade theme without changing TechNews behavior or layout.

**Architecture:** Add one override stylesheet after the existing stylesheet. It owns semantic color tokens and the few selectors that contain hard-coded amber or near-black colors. Existing markup, JavaScript, API routes, service process, and current dashboard grid remain untouched.

**Tech Stack:** Static HTML, CSS custom properties, Node.js built-in test runner, Chrome visual verification, Git.

## Global Constraints

- Work only in `/var/www/technews` on the Alibaba Cloud server.
- Keep `/technews/` URL paths, copy, API endpoints, scripts, and dashboard structure unchanged.
- Use a single jade accent: `#4FA88C`.
- Use the tokens approved in `docs/superpowers/specs/2026-08-31-technews-calm-graphite-theme-design.md`.
- Do not stage or commit pre-existing changes in `collector.js`, `github-hot.js`, `hot-sources.js`, `public/app.js`, `public/index.html`, `public/styles.css`, `research-job.js`, `server.js`, or `keyword-sync.js`.
- Do not restart or reconfigure the running Node service. Static assets are served from the existing process.

---

### Task 1: Lock the theme contract with a failing static test

**Files:**
- Create: `tests/theme-calm-graphite.test.mjs`
- Read: `public/index.html`
- Read: `public/theme-calm-graphite.css`

**Interfaces:**
- Consumes: static asset paths under `public/`.
- Produces: `node --test tests/theme-calm-graphite.test.mjs` validation for the theme link, token values, single accent, and grain removal.

- [ ] **Step 1: Write the failing test**

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const indexPath = path.join(root, 'public', 'index.html');
const themePath = path.join(root, 'public', 'theme-calm-graphite.css');

test('loads the calm graphite theme after the base stylesheet', () => {
  const html = fs.readFileSync(indexPath, 'utf8');
  assert.ok(fs.existsSync(themePath), 'calm theme stylesheet must be present');
  assert.ok(html.indexOf('styles.css') < html.indexOf('theme-calm-graphite.css'));
});

test('defines the approved calm palette and removes page grain', () => {
  const css = fs.readFileSync(themePath, 'utf8');
  for (const token of ['--void: #151B20', '--panel: #202A31', '--ink: #E8F0F2', '--accent: #4FA88C']) {
    assert.match(css, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(css, /body::before\s*\{[^}]*opacity:\s*0/s);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/theme-calm-graphite.test.mjs`

Expected: FAIL with `calm theme stylesheet must be present`.

- [ ] **Step 3: Commit**

Do not commit until Task 2 has passed. The test and production stylesheet are one theme contract.

### Task 2: Add the isolated calm graphite stylesheet

**Files:**
- Create: `public/theme-calm-graphite.css`
- Modify: `public/index.html` by adding one stylesheet link immediately after the existing `styles.css` link.
- Test: `tests/theme-calm-graphite.test.mjs`

**Interfaces:**
- Consumes: variables and class names already defined in `public/styles.css`.
- Produces: a later-loaded stylesheet that overrides visual tokens without changing HTML structure or JavaScript.

- [ ] **Step 1: Implement the stylesheet**

```css
:root {
  --void: #151B20;
  --void-2: #1B242B;
  --panel: #202A31;
  --panel-2: #27343C;
  --ink: #E8F0F2;
  --ink-soft: #B8C7CC;
  --muted: #84979F;
  --line: rgba(151, 177, 185, 0.16);
  --line-strong: rgba(151, 177, 185, 0.28);
  --accent: #4FA88C;
  --accent-dim: rgba(79, 168, 140, 0.12);
  --danger: #D98072;
  --gutter: #11171B;
  --shadow: 0 12px 28px rgba(5, 10, 13, 0.24);
}

body::before { opacity: 0; }
.pane { border-color: var(--line); }
.pane-b::-webkit-scrollbar-thumb { background: rgba(151, 177, 185, 0.34); }
.cloud-stage { background: var(--panel); }
.cloud-word-hit { outline-color: var(--line-strong); }
.word-detail { background: rgba(32, 42, 49, 0.94); }
.card { border-bottom-color: var(--line); }
.thumb { background: linear-gradient(135deg, rgba(79, 168, 140, 0.22), var(--panel-2)); }
```

- [ ] **Step 2: Add the page reference**

Insert exactly one line after the existing base stylesheet reference:

```html
<link rel="stylesheet" href="/technews/theme-calm-graphite.css" />
```

- [ ] **Step 3: Run the static test to verify it passes**

Run: `node --test tests/theme-calm-graphite.test.mjs`

Expected: PASS with two passing subtests.

### Task 3: Validate the rendered page and sync only theme work

**Files:**
- Verify: `public/theme-calm-graphite.css`
- Verify: `public/index.html`
- Verify: `tests/theme-calm-graphite.test.mjs`
- Verify: `docs/superpowers/plans/2026-08-31-technews-calm-graphite-theme-plan.md`

**Interfaces:**
- Consumes: existing TechNews Node service on port 3001, Nginx `/technews/` proxy, and GitHub `origin`.
- Produces: browser evidence, a targeted Git commit, and a push from Alibaba Cloud.

- [ ] **Step 1: Verify desktop rendering and browser logs**

Open `http://39.96.71.50/technews/`, capture a desktop screenshot, and read browser console errors. Confirm every panel loads and primary action controls remain visible.

- [ ] **Step 2: Verify narrow viewport behavior**

Set browser viewport to 768px wide, reload the page, and capture a screenshot. Confirm content remains reachable and no horizontal page-level overflow is introduced by the new stylesheet.

- [ ] **Step 3: Verify source and test output**

Run:

```bash
node --test tests/theme-calm-graphite.test.mjs
git diff --check
git status --short
```

Expected: two test passes, no whitespace errors in the targeted files, and all pre-existing changes still unstaged.

- [ ] **Step 4: Stage exact theme files without staging existing work**

Stage the new stylesheet, test, and plan file. Generate a one-line patch against the Git index for `public/index.html` that contains only the new theme link, then apply that patch to the index. Confirm with `git diff --cached --name-only` that only the theme link, theme stylesheet, static test, and plan are staged.

- [ ] **Step 5: Commit and push from Alibaba Cloud**

```bash
git commit -m "style: adopt calm graphite theme"
git push origin main
```

Expected: GitHub accepts the commit and `git status --short` still lists the pre-existing files as unstaged.