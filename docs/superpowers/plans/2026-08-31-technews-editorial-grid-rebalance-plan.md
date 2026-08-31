# TechNews Editorial Grid Rebalance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorder the TechNews desktop dashboard into the approved four-column editorial reading layout.

**Architecture:** The dashboard's existing source stylesheet is a pre-existing, unstaged redesign. To preserve it, a new stylesheet loaded after the calm theme owns the approved `.dash-wrap` grid override. Existing named areas, panel markup, JavaScript, routes, and server process remain unchanged.

**Tech Stack:** CSS Grid, Node.js built-in test runner, Chrome visual verification, Git.

## Global Constraints

- Work only in `/var/www/technews` on Alibaba Cloud.
- Use exactly `0.86fr 1.08fr 1.08fr 1.08fr` columns.
- Use exactly `cloud news hot ghs` and `books papers hot ghr` areas.
- Do not stage existing changes in `public/styles.css`, `public/index.html`, or unrelated server files.
- Do not restart or reconfigure the existing service.

---

### Task 1: Add a failing isolated grid test

**Files:**
- Create: `tests/editorial-grid-rebalance.test.mjs`
- Read: `public/index.html`
- Read: `public/layout-editorial-grid.css`

- [ ] **Step 1: Write the failing test**

```js
assert.equal(fs.existsSync(layoutPath), true, 'editorial grid stylesheet must be present');
assert.ok(html.indexOf('theme-calm-graphite.css') < html.indexOf('layout-editorial-grid.css'));
assert.match(css, /grid-template-columns:\s*0\.86fr\s+1\.08fr\s+1\.08fr\s+1\.08fr;/);
assert.match(css, /grid-template-areas:\s*"cloud news hot ghs"\s*"books papers hot ghr";/s);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/editorial-grid-rebalance.test.mjs`

Expected: FAIL because the isolated layout stylesheet does not yet exist.

### Task 2: Add the isolated layout override

**Files:**
- Create: `public/layout-editorial-grid.css`
- Modify: `public/index.html` by adding one stylesheet reference after the calm theme reference.
- Test: `tests/editorial-grid-rebalance.test.mjs`

- [ ] **Step 1: Add the CSS grid override**

```css
.dash-wrap {
  grid-template-columns: 0.86fr 1.08fr 1.08fr 1.08fr;
  grid-template-areas:
    "cloud news hot ghs"
    "books papers hot ghr";
}
```

- [ ] **Step 2: Add the link**

```html
<link rel="stylesheet" href="/technews/layout-editorial-grid.css" />
```

- [ ] **Step 3: Restore the pre-existing source stylesheet's original grid declarations**

Keep the source stylesheet unstaged. The later-loaded override retains the approved rendered grid.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/theme-calm-graphite.test.mjs tests/editorial-grid-rebalance.test.mjs`

Expected: four passing subtests.

### Task 3: Verify and sync only layout work

**Files:**
- Verify: `public/layout-editorial-grid.css`
- Verify: `tests/editorial-grid-rebalance.test.mjs`
- Verify: `docs/superpowers/plans/2026-08-31-technews-editorial-grid-rebalance-plan.md`

- [ ] **Step 1: Verify the deployed page**

Reload `http://39.96.71.50/technews/`. Confirm the requested four columns and inspect console errors.

- [ ] **Step 2: Stage only layout assets**

Stage the new layout stylesheet, test, plan, and a generated one-line index patch. Confirm no pre-existing source stylesheet changes are staged.

- [ ] **Step 3: Commit and push**

```bash
git commit -m "style: rebalance editorial dashboard grid"
git push origin main
```