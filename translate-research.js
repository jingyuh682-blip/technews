/**
 * Translate paper / GitHub items to Simplified Chinese (title + summary).
 * Caches titleZh / summaryZh on each item.
 */
const { chat, extractJson, getApiKey } = require('./llm');

function hasChinese(s, min = 4) {
  const n = (String(s || '').match(/[\u4e00-\u9fff]/g) || []).length;
  return n >= min;
}

function needsPaperZh(it) {
  return !!(it && (!String(it.titleZh || '').trim() || !String(it.summaryZh || '').trim()));
}

function needsGithubZh(it) {
  return !!(it && !String(it.summaryZh || '').trim());
}

async function translateBatch(items, kind) {
  if (!items.length) return [];
  if (!getApiKey()) {
    console.warn('[translate] DEEPSEEK_API_KEY missing, skip');
    return [];
  }

  const payload = items.map((it) => ({
    id: it.id,
    title: it.title || '',
    summary: String(it.summary || '').slice(0, 900)
  }));

  const sys =
    kind === 'paper'
      ? '你是科研资讯翻译助手。将英文论文标题与摘要译为简体中文。标题译文要准确简洁；简介控制在 120～220 字，突出问题、方法与贡献。只返回 JSON 数组，不要 Markdown。'
      : '你是开源项目资讯翻译助手。将 GitHub 仓库英文简介译为简体中文（80～160 字），说明项目用途与亮点。仓库名 title 一般是 full_name，不必翻译，titleZh 返回空字符串。只返回 JSON 数组，不要 Markdown。';

  const user =
    kind === 'paper'
      ? `请翻译以下论文，返回 JSON 数组，每项含 id、titleZh、summaryZh：\n${JSON.stringify(payload, null, 0)}`
      : `请翻译以下 GitHub 项目简介，返回 JSON 数组，每项含 id、titleZh（空串）、summaryZh：\n${JSON.stringify(payload, null, 0)}`;

  const text = await chat(
    [
      { role: 'system', content: sys },
      { role: 'user', content: user }
    ],
    { temperature: 0.2, maxTokens: 4096, timeoutMs: 120000 }
  );

  let arr;
  try {
    arr = extractJson(text);
  } catch (err) {
    // fallback: try each {...} block
    const objs = [];
    const re = /\{[^{}]*\}/g;
    let m;
    while ((m = re.exec(text))) {
      try {
        objs.push(JSON.parse(m[0]));
      } catch (_e) {
        /* ignore */
      }
    }
    if (!objs.length) throw err;
    arr = objs;
  }
  if (!Array.isArray(arr)) arr = arr && arr.items ? arr.items : [];
  return Array.isArray(arr) ? arr : [];
}

async function enrichItemsZh(items, kind, options = {}) {
  const list = Array.isArray(items) ? items : [];
  const needFn = kind === 'paper' ? needsPaperZh : needsGithubZh;
  const pending = list.filter(needFn);
  if (!pending.length) return list;

  // 若原文已是中文，直接复用
  for (const it of pending) {
    if (kind === 'paper') {
      if (!it.titleZh && hasChinese(it.title, 6)) it.titleZh = it.title;
      if (!it.summaryZh && hasChinese(it.summary, 10)) it.summaryZh = it.summary;
    } else if (!it.summaryZh && hasChinese(it.summary, 8)) {
      it.summaryZh = it.summary;
    }
  }

  const still = list.filter(needFn);
  if (!still.length) return list;

  const batchSize = options.batchSize || 6;
  const byId = new Map(list.map((it) => [it.id, it]));

  for (let i = 0; i < still.length; i += batchSize) {
    const batch = still.slice(i, i + batchSize);
    try {
      const rows = await translateBatch(batch, kind);
      for (const row of rows) {
        if (!row || !row.id || !byId.has(row.id)) continue;
        const cur = byId.get(row.id);
        if (kind === 'paper') {
          if (row.titleZh) cur.titleZh = String(row.titleZh).trim();
          if (row.summaryZh) cur.summaryZh = String(row.summaryZh).trim();
        } else if (row.summaryZh) {
          cur.summaryZh = String(row.summaryZh).trim();
        }
      }
      console.log(`[translate] ${kind} batch ${i / batchSize + 1}: ${batch.length}`);
    } catch (err) {
      console.error(`[translate] ${kind} batch fail:`, err.message || err);
    }
  }

  return list;
}

async function enrichOneZh(item) {
  if (!item) return item;
  const kind = item.category === 'github' || item.channel === 'github' ? 'github' : 'paper';
  const [out] = await enrichItemsZh([{ ...item }], kind === 'github' ? 'github' : 'paper');
  return out || item;
}

module.exports = {
  enrichItemsZh,
  enrichOneZh,
  needsPaperZh,
  needsGithubZh,
  hasChinese
};
