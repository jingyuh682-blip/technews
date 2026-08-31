# 科技热点第二列调整 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将仪表盘的科技热点移至第二列，同时保持其他栏目关系和列宽不变。

**Architecture:** 网格顺序由独立覆盖样式 `public/layout-editorial-grid.css` 唯一控制。将两行 `grid-template-areas` 的槽位重排，使 `hot` 同列跨行，`news`、`papers` 顺移到第三列；测试直接读取该隔离样式，防止以后回退。

**Tech Stack:** CSS Grid、Node.js 内置 `node:test`、Node.js 内置 `assert`。

## Global Constraints

- 全部代码、测试、Git 操作仅在阿里云服务器执行。
- 仅改动 `public/layout-editorial-grid.css` 与 `tests/editorial-grid-rebalance.test.mjs`。
- 保持列宽为 `0.86fr 1.08fr 1.08fr 1.08fr`。
- 不修改现有未提交的 `public/styles.css`、`public/app.js`、`public/index.html` 或业务文件。
- 不在网页代码中处理外部浏览器/远程控制鼠标指针。

---

### Task 1: 更新科技热点的网格归属

**Files:**
- Modify: `tests/editorial-grid-rebalance.test.mjs:17-18`
- Modify: `public/layout-editorial-grid.css:1-5`

**Interfaces:**
- Consumes: `.dash-wrap` 已定义的 `cloud`、`books`、`news`、`papers`、`hot`、`ghs`、`ghr` 命名网格区域。
- Produces: 两行网格 `"cloud hot news ghs"` 与 `"books hot papers ghr"`。

- [ ] **Step 1: 写入失败测试**

将测试中的区域断言更新为：

```js
assert.match(
  css,
  /grid-template-areas:\\s*"cloud hot news ghs"\\s*"books hot papers ghr";/s
);
```

- [ ] **Step 2: 运行失败测试**

运行：

```bash
node --test tests/editorial-grid-rebalance.test.mjs
```

预期：测试失败，原因是样式仍包含旧顺序 `"cloud news hot ghs" "books papers hot ghr"`。

- [ ] **Step 3: 写入最小实现**

将 `public/layout-editorial-grid.css` 的区域替换为：

```css
grid-template-areas:
  "cloud hot news ghs"
  "books hot papers ghr";
```

- [ ] **Step 4: 运行完整验证**

运行：

```bash
node --test tests/*.test.mjs
```

预期：全部测试通过。

- [ ] **Step 5: 浏览器验证与提交**

在浏览器读取 `.dash-wrap` 的计算网格区域，确认 `hot` 的第二列跨两行，随后只暂存两个本任务文件：

```bash
git add public/layout-editorial-grid.css tests/editorial-grid-rebalance.test.mjs
git commit -m "style: move technology hotspot to second column"
git push origin main
```