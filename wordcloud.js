/**
 * 词云可视化 + 高频专有名词讲解
 * 名词选自：新闻 / 热点 / 论文 / GitHub 中相对出现频次高的科技专有名词
 * 讲解针对这些跨栏目高频词及其当日语境，不是「词云本身」的解说
 */
const { SPECIFIC_TERMS, GENERIC_TERMS, NOISE_TERMS } = require('./sources');
const {
  readDay,
  todayKey,
  saveWordcloud
} = require('./store');
const { chat, extractJson, getApiKey } = require('./llm');

const STOP = new Set(
  [
    ...GENERIC_TERMS.map((t) => String(t).toLowerCase()),
    ...NOISE_TERMS.map((t) => String(t).toLowerCase()),
    '的',
    '了',
    '在',
    '是',
    '和',
    '与',
    'the',
    'a',
    'an',
    'and',
    'or',
    'of',
    'to',
    'in',
    'for',
    'on',
    'with',
    'from',
    'using',
    'based',
    'via',
    'new',
    '最新',
    '发布',
    '上线',
    '支持'
  ].map((s) => s.toLowerCase())
);

function normalizeTerm(t) {
  return String(t || '')
    .trim()
    .toLowerCase()
    .replace(/^[#＃@]+/, '')
    .replace(/\s+/g, ' ');
}

function isNoisy(term) {
  const t = normalizeTerm(term);
  if (!t || t.length < 2) return true;
  if (STOP.has(t)) return true;
  for (const n of NOISE_TERMS) {
    if (t.includes(String(n).toLowerCase())) return true;
  }
  if (/关注|公众号|微信|欢迎|官网|订阅|邀请语|官方账号/.test(term)) return true;
  if (/^[\u4e00-\u9fff]{1}$/.test(term)) return true;
  if (/^\d+(\.\d+)?[kmb]?$/i.test(t)) return true;
  if (/^(python|javascript|typescript|java|rust|go|c\+\+|php|ruby|swift|kotlin)$/i.test(t)) return true;
  if (/^[a-z]{1,2}$/i.test(t)) return true;
  return false;
}

function parseHeat(raw) {
  const s = String(raw == null ? '' : raw)
    .trim()
    .toLowerCase()
    .replace(/,/g, '')
    .replace(/\s+/g, '');
  if (!s) return 0;
  const m = s.match(/^([\d.]+)\s*([kmb])?/);
  if (!m) {
    const digits = s.replace(/[^\d.]/g, '');
    return digits ? Number(digits) || 0 : 0;
  }
  let n = Number(m[1]);
  if (!Number.isFinite(n)) return 0;
  const unit = m[2];
  if (unit === 'k') n *= 1e3;
  else if (unit === 'm') n *= 1e6;
  else if (unit === 'b') n *= 1e9;
  return n;
}

function paperHeat(it, idx, total) {
  const h = parseHeat(it.heat);
  if (h > 0) return h;
  const base = it.sourceId === 'hf-daily' ? 80 : it.sourceId === 'arxiv-ccf' ? 45 : 20;
  const rank = idx + 1;
  return Math.max(8, base * (1 - ((rank - 1) / Math.max(total, 1)) * 0.7));
}

function githubHeat(it, idx, total) {
  const stars = parseHeat(it.stars);
  if (stars > 0) return stars;
  const rank = it.rank != null ? Number(it.rank) : idx + 1;
  return Math.max(10, 200 * (1 - (rank - 1) / Math.max(total, 1)));
}

function heatWeight(heat) {
  return 1 + Math.log10(1 + Math.max(0, heat)) * 18;
}

function ensureEntry(map, display) {
  const k = normalizeTerm(display);
  if (!k || isNoisy(display)) return null;
  const prev = map.get(k) || {
    term: display,
    count: 0,
    score: 0,
    newsCount: 0,
    hotCount: 0,
    paperCount: 0,
    githubCount: 0,
    paperHeat: 0,
    githubHeat: 0,
    channels: new Set()
  };
  if (display.length > String(prev.term).length) prev.term = display;
  map.set(k, prev);
  return prev;
}

function bump(map, term, weight, meta = {}) {
  const display = String(term || '').trim();
  const prev = ensureEntry(map, display);
  if (!prev) return;
  prev.count += 1;
  prev.score += weight;
  const ch = meta.channel || meta.from || '';
  if (ch === 'news') prev.newsCount += 1;
  if (ch === 'hot') prev.hotCount += 1;
  if (ch === 'paper') {
    prev.paperCount += 1;
    prev.paperHeat += meta.heat || 0;
  }
  if (ch === 'github') {
    prev.githubCount += 1;
    prev.githubHeat += meta.heat || 0;
  }
  if (ch) prev.channels.add(ch);
}

function matchCatalogInText(text, catalog, weight, map, meta) {
  const hay = String(text || '').toLowerCase();
  if (!hay) return;
  for (const kw of catalog) {
    const k = normalizeTerm(kw);
    if (!k || isNoisy(kw)) continue;
    if (hay.includes(k)) bump(map, kw, weight, meta);
  }
}

function extractModelLike(text, weight, map, meta) {
  const corpus = String(text || '');
  const patterns = [
    /\b(?:gpt|claude|gemini|llama|qwen|mistral|deepseek|grok|kimi)[-\w.]*\b/gi,
    /\b(?:neurips|icml|iclr|cvpr|iccv|eccv|acl|emnlp|aaai|ijcai|kdd|siggraph)\b/gi,
    /\b(?:h100|h200|b100|b200|a100)\b/gi,
    /\b(?:rag|rlhf|dpo|graphrag|lora|qlora|moe|vllm|ollama|langchain|llamaindex)\b/gi,
    /\b(?:openai|anthropic|deepmind|nvidia|huggingface)\b/gi
  ];
  for (const re of patterns) {
    let m;
    const r = new RegExp(re.source, re.flags);
    while ((m = r.exec(corpus))) {
      bump(map, m[0], weight, meta);
    }
  }
}

function extractRepoTokens(title, weight, map, meta) {
  const full = String(title || '');
  const name = full.includes('/') ? full.split('/').pop() : full;
  const raw = String(name || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim();
  if (!raw) return;
  if (raw.length >= 4 && !isNoisy(raw)) bump(map, raw, weight * 1.2, meta);
  for (const part of raw.split(/\s+/)) {
    if (part.length < 4 || isNoisy(part)) continue;
    if (/^(app|api|lib|sdk|core|web|ui|cli|demo|test|docs)$/i.test(part)) continue;
    bump(map, part, weight * 0.6, meta);
  }
}

function researchCatalog() {
  return [...SPECIFIC_TERMS]
    .filter((t) => !isNoisy(t))
    .sort((a, b) => String(b).length - String(a).length);
}

/** 四栏目语料条目：用于频次统计与讲解语境 */
function collectCorpus(day) {
  const news = (day.items || []).map((it, idx) => ({
    channel: 'news',
    idx,
    total: (day.items || []).length,
    title: it.title,
    summary: it.summary,
    heat: 0
  }));
  const hot = (day.hotspots || []).map((it, idx) => ({
    channel: 'hot',
    idx,
    total: (day.hotspots || []).length,
    title: it.title,
    summary: it.summary,
    heat: 0
  }));
  const papers = ((day.papers && day.papers.items) || []).map((it, idx, arr) => ({
    channel: 'paper',
    idx,
    total: arr.length,
    title: [it.title, it.titleZh].filter(Boolean).join(' / '),
    summary: [it.summary, it.summaryZh].filter(Boolean).join(' '),
    heat: paperHeat(it, idx, arr.length),
    venue: it.venue,
    categories: it.categories
  }));
  const githubItems = ((day.github && day.github.items) || []).slice(0, 100);
  const github = githubItems.map((it, idx, arr) => ({
    channel: 'github',
    idx,
    total: arr.length,
    title: it.title,
    summary: [it.summary, it.summaryZh].filter(Boolean).join(' '),
    heat: githubHeat(it, idx, arr.length)
  }));
  return { news, hot, papers, github, all: [...news, ...hot, ...papers, ...github] };
}

/**
 * 按「新闻+热点+论文+GitHub」出现频次为主选专有名词
 * 跨栏目命中加分；论文/GitHub 热度作次要加权
 */
function scoreByFrequency(day) {
  const map = new Map();
  const catalog = researchCatalog();
  const { news, hot, papers, github } = collectCorpus(day);

  const scanList = (list, channel, baseW) => {
    list.forEach((it) => {
      const meta = { channel, heat: it.heat || 0 };
      const text = [it.title, it.summary, it.venue, (it.categories || []).join(' ')]
        .filter(Boolean)
        .join('\n');
      // 频次为主：每命中一次固定加分
      const w = baseW + (it.heat ? heatWeight(it.heat) * 0.35 : 0);
      matchCatalogInText(text, catalog, w, map, meta);
      extractModelLike(text, w * 1.05, map, meta);
      if (channel === 'github') extractRepoTokens(it.title, w, map, meta);
    });
  };

  scanList(news, 'news', 55);
  scanList(hot, 'hot', 55);
  scanList(papers, 'paper', 50);
  scanList(github, 'github', 50);

  return Array.from(map.values()).map((t) => {
    const channelCount = t.channels instanceof Set ? t.channels.size : 0;
    // 跨栏目出现的词优先（真正的「相对频次高」）
    const crossBonus = channelCount >= 2 ? 180 * (channelCount - 1) : 0;
    const freqScore = (t.count || 0) * 70 + crossBonus;
    const heatBoost =
      Math.log10(1 + (t.paperHeat || 0)) * 40 + Math.log10(1 + (t.githubHeat || 0)) * 35;
    return {
      ...t,
      channels: channelCount,
      score: Math.round(freqScore + heatBoost + (t.score || 0) * 0.15)
    };
  });
}

async function llmMineKeywords(chunks, sourceLabel) {
  if (!getApiKey() || !chunks.length) return [];
  const sample = chunks.slice(0, 28).join('\n---\n').slice(0, 7000);
  const prompt = `从以下${sourceLabel}标题/简介中，提取 14～22 个「科技专有名词」。
要求：
1. 只要具体实体：模型名、产品名、公司名、芯片型号、顶会名、算法缩写（如 RLHF/LoRA/GraphRAG）、知名框架。
2. 严禁泛词：AI、大模型、深度学习、机器学习、LLM、Agent、神经网络、开源、数据、算法、框架、训练、推理、Python 等。
3. 中英文保留原文常见写法，词长尽量短（1～4 词）。
只返回 JSON：{"terms":["词1","词2"]}`;
  try {
    const text = await chat(
      [
        { role: 'system', content: '你只输出合法 JSON，不要 Markdown。' },
        { role: 'user', content: `${prompt}\n\n语料：\n${sample}` }
      ],
      { temperature: 0.2, maxTokens: 1200, timeoutMs: 90000 }
    );
    const parsed = extractJson(text);
    const arr = parsed.terms || parsed.keywords || parsed.words || parsed;
    if (!Array.isArray(arr)) return [];
    return arr.map((x) => String(x || '').trim()).filter(Boolean);
  } catch (err) {
    console.error(`[wordcloud] llm mine ${sourceLabel} fail:`, err.message || err);
    return [];
  }
}

async function mineSpecialtyTerms(day) {
  const { news, hot, papers, github } = collectCorpus(day);
  const pack = (list, n) =>
    list.slice(0, n).map((it) => `[${it.channel}] ${it.title}\n${String(it.summary || '').slice(0, 160)}`);

  const [n1, h1, p1, g1] = await Promise.all([
    llmMineKeywords(pack(news, 36), '科技新闻'),
    llmMineKeywords(pack(hot, 36), '科技热点'),
    llmMineKeywords(pack(papers, 40), '论文'),
    llmMineKeywords(pack(github, 36), 'GitHub')
  ]);

  const mined = [...n1, ...h1, ...p1, ...g1];
  const map = new Map();
  for (const t of mined) {
    if (isNoisy(t)) continue;
    const k = normalizeTerm(t);
    if (!map.has(k)) map.set(k, t);
  }
  return Array.from(map.values());
}

function applyMinedTerms(day, terms, mined) {
  const map = new Map(terms.map((t) => [normalizeTerm(t.term), { ...t, channels: t.channels || 0 }]));
  const { all } = collectCorpus(day);

  for (const term of mined) {
    const k = normalizeTerm(term);
    if (!k || isNoisy(term)) continue;
    let hits = 0;
    const channelSet = new Set();
    all.forEach((it) => {
      const blob = `${it.title} ${it.summary}`.toLowerCase();
      if (!blob.includes(k)) return;
      hits += 1;
      channelSet.add(it.channel);
      const prev = map.get(k) || {
        term,
        count: 0,
        score: 0,
        newsCount: 0,
        hotCount: 0,
        paperCount: 0,
        githubCount: 0,
        paperHeat: 0,
        githubHeat: 0,
        channels: 0
      };
      prev.count += 1;
      prev.score += 70;
      if (it.channel === 'news') prev.newsCount += 1;
      if (it.channel === 'hot') prev.hotCount += 1;
      if (it.channel === 'paper') {
        prev.paperCount += 1;
        prev.paperHeat += it.heat || 0;
      }
      if (it.channel === 'github') {
        prev.githubCount += 1;
        prev.githubHeat += it.heat || 0;
      }
      if (String(term).length >= String(prev.term).length) prev.term = term;
      map.set(k, prev);
    });
    if (!hits && !map.has(k)) {
      map.set(k, {
        term,
        count: 1,
        score: 90,
        newsCount: 0,
        hotCount: 0,
        paperCount: 0,
        githubCount: 0,
        paperHeat: 0,
        githubHeat: 0,
        channels: 0
      });
    } else if (map.has(k)) {
      const prev = map.get(k);
      prev.channels = Math.max(prev.channels || 0, channelSet.size);
      if (channelSet.size >= 2) prev.score += 180 * (channelSet.size - 1);
    }
  }
  return Array.from(map.values());
}

function finalizeScores(terms) {
  return terms
    .filter((t) => !isNoisy(t.term))
    .map((t) => {
      const channelCount =
        typeof t.channels === 'number'
          ? t.channels
          : [t.newsCount, t.hotCount, t.paperCount, t.githubCount].filter((n) => n > 0).length;
      const crossBonus = channelCount >= 2 ? 180 * (channelCount - 1) : 0;
      const freqScore = (t.count || 0) * 70 + crossBonus;
      const heatBoost =
        Math.log10(1 + (t.paperHeat || 0)) * 40 + Math.log10(1 + (t.githubHeat || 0)) * 35;
      return {
        ...t,
        channels: channelCount,
        score: Math.round(freqScore + heatBoost + (t.score || 0) * 0.1)
      };
    });
}

function buildContextSnippets(day, terms) {
  const { all } = collectCorpus(day);
  const channelLabel = { news: '新闻', hot: '热点', paper: '论文', github: 'GitHub' };
  return terms.map((t) => {
    const k = normalizeTerm(t.term);
    const hits = [];
    for (const it of all) {
      const blob = `${it.title} ${it.summary}`.toLowerCase();
      if (!blob.includes(k)) continue;
      hits.push(`【${channelLabel[it.channel] || it.channel}】${String(it.title || '').slice(0, 80)}`);
      if (hits.length >= 4) break;
    }
    return {
      term: t.term,
      count: t.count,
      channels: t.channels,
      newsCount: t.newsCount || 0,
      hotCount: t.hotCount || 0,
      paperCount: t.paperCount || 0,
      githubCount: t.githubCount || 0,
      snippets: hits
    };
  });
}

async function explainTerms(terms, day) {
  if (!getApiKey() || !terms.length) {
    return terms.map((t) => ({ ...t, explain: t.explain || '' }));
  }
  const contexts = buildContextSnippets(day, terms);
  const payload = contexts
    .map((c) => {
      const freq = `出现约${c.count}次（新闻${c.newsCount}/热点${c.hotCount}/论文${c.paperCount}/GitHub${c.githubCount}，跨${c.channels}个栏目）`;
      const snip = c.snippets.length ? `\n相关标题：${c.snippets.join('；')}` : '';
      return `- ${c.term}｜${freq}${snip}`;
    })
    .join('\n');

  const prompt = `你是科技编辑。下面这些词是「今日科技新闻、科技热点、论文、GitHub」里相对出现频次较高的科技专有名词（不是为词云凑词）。

请针对每个专有名词写一段较完整的通俗中文讲解（约 180～320 字，3～5 句）：
1. 它是什么（模型/算法/芯片/公司产品/顶会等）
2. 结合给出的相关标题，说明它今天为什么会被频繁提到
3. 点到产业/研究影响，不要空泛口号
4. 不要写「词云」「热搜词」「过于宽泛」「不适用」「已剔除」；不要营销话术

只返回 JSON：{"explanations":[{"term":"词","explain":"讲解"}]}

词与语境：
${payload}`;

  try {
    const text = await chat(
      [
        { role: 'system', content: '你输出严格 JSON，不要额外说明。' },
        { role: 'user', content: prompt }
      ],
      { temperature: 0.3, maxTokens: 4000, timeoutMs: 120000 }
    );
    const parsed = extractJson(text);
    const arr = parsed.explanations || parsed.words || parsed;
    const explainMap = new Map();
    if (Array.isArray(arr)) {
      for (const row of arr) {
        if (row && row.term) explainMap.set(normalizeTerm(row.term), String(row.explain || '').trim());
      }
    }
    return terms
      .map((t) => ({
        ...t,
        explain: explainMap.get(normalizeTerm(t.term)) || t.explain || ''
      }))
      .filter((t) => !/过于宽泛|已剔除|已从词云剔除/.test(t.explain || ''));
  } catch (err) {
    console.error('[wordcloud] explain failed:', err.message || err);
    return terms.map((t) => ({ ...t, explain: t.explain || '' }));
  }
}

function mapTermRow(t) {
  return {
    term: t.term,
    score: t.score,
    count: t.count,
    channels: t.channels || 0,
    newsCount: t.newsCount || 0,
    hotCount: t.hotCount || 0,
    paperCount: t.paperCount || 0,
    githubCount: t.githubCount || 0,
    paperHeat: Math.round(t.paperHeat || 0),
    githubHeat: Math.round(t.githubHeat || 0),
    explain: t.explain || ''
  };
}

function isEligibleTerm(t) {
  if (!t || isNoisy(t.term)) return false;
  const news = t.newsCount || 0;
  const hot = t.hotCount || 0;
  const paper = t.paperCount || 0;
  const github = t.githubCount || 0;
  const total = news + hot + paper + github;
  // 任一栏目≥2，或跨栏目合计≥2
  if (news >= 2 || hot >= 2 || paper >= 2 || github >= 2 || total >= 2) return true;
  if ((t.channels || 0) >= 2) return true;
  // 专有名词挖掘命中至少一次且分数够，也入池（靠排序控质量）
  if (total >= 1 && (t.score || 0) >= 100) return true;
  return false;
}

async function explainOneTerm(term, day) {
  const display = String(term || '').trim();
  if (!display) throw new Error('缺少词语');
  if (!getApiKey()) throw new Error('DEEPSEEK_API_KEY not set');

  const fake = {
    term: display,
    count: 0,
    channels: 0,
    newsCount: 0,
    hotCount: 0,
    paperCount: 0,
    githubCount: 0
  };
  // 用当日语料回填计数/标题
  const { all } = collectCorpus(day);
  const k = normalizeTerm(display);
  const channelLabel = { news: '新闻', hot: '热点', paper: '论文', github: 'GitHub' };
  const snippets = [];
  for (const it of all) {
    const blob = `${it.title} ${it.summary}`.toLowerCase();
    if (!blob.includes(k)) continue;
    fake.count += 1;
    if (it.channel === 'news') fake.newsCount += 1;
    if (it.channel === 'hot') fake.hotCount += 1;
    if (it.channel === 'paper') fake.paperCount += 1;
    if (it.channel === 'github') fake.githubCount += 1;
    if (snippets.length < 6) {
      snippets.push(`【${channelLabel[it.channel] || it.channel}】${String(it.title || '').slice(0, 90)}`);
    }
  }
  fake.channels = [fake.newsCount, fake.hotCount, fake.paperCount, fake.githubCount].filter((n) => n > 0)
    .length;

  const freq = `出现约${fake.count}次（新闻${fake.newsCount}/热点${fake.hotCount}/论文${fake.paperCount}/GitHub${fake.githubCount}）`;
  const snip = snippets.length ? `\n相关标题：${snippets.join('；')}` : '';
  const prompt = `你是科技编辑。请讲解下列科技专有名词（来自今日新闻/热点/论文/GitHub 语料）。

要求写一段较完整的通俗中文讲解（约 220～420 字，分 4～6 句，可用自然段）：
1. 它是什么：模型/算法/芯片/公司产品/顶会/开源项目/技术概念等，说清定位
2. 关键背景：结合相关标题，说明它今天为何被反复提到、卡在什么议题上
3. 影响与外延：对产业、开发者或研究意味着什么（可点到对手/生态/落地场景）
4. 若语料不足，基于公认常识补全，但不要编造具体未给出的数据
5. 不要提「词云」，不要营销话术，不要写「过于宽泛」「不适用」「已剔除」

只返回 JSON：{"term":"${display.replace(/"/g, '')}","explain":"讲解正文"}

词语：${display}
语境：${freq}${snip}`;

  const text = await chat(
    [
      { role: 'system', content: '你输出严格 JSON，不要额外说明。讲解要具体、可读、信息密度高。' },
      { role: 'user', content: prompt }
    ],
    { temperature: 0.35, maxTokens: 1600, timeoutMs: 120000 }
  );
  const parsed = extractJson(text);
  const explain = String(parsed.explain || parsed.explanation || '').trim();
  if (!explain) throw new Error('DeepSeek empty explain');
  return { term: display, explain, meta: fake };
}

let rebuildTimer = null;
let rebuildPendingKey = null;

function scheduleWordcloudRebuild(dateKey, { delayMs = 20000 } = {}) {
  const key = dateKey || todayKey();
  rebuildPendingKey = key;
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    const target = rebuildPendingKey || todayKey();
    rebuildTimer = null;
    rebuildPendingKey = null;
    console.log('[wordcloud] scheduled rebuild for', target);
    buildWordcloud(target).catch((err) =>
      console.error('[wordcloud] scheduled rebuild fail:', err.message || err)
    );
  }, delayMs);
}

function cacheExplainOnWordcloud(dateKey, term, explain) {
  const day = readDay(dateKey);
  const wc = day.wordcloud;
  if (!wc || !Array.isArray(wc.words)) return null;
  const k = normalizeTerm(term);
  let hit = false;
  const words = wc.words.map((w) => {
    if (normalizeTerm(w.term) !== k) return w;
    hit = true;
    return { ...w, explain };
  });
  const candidates = Array.isArray(wc.candidates)
    ? wc.candidates.map((w) => (normalizeTerm(w.term) === k ? { ...w, explain } : w))
    : wc.candidates;
  if (!hit && !(candidates || []).some((w) => normalizeTerm(w.term) === k)) return null;
  const next = { ...wc, words, candidates, updatedAt: new Date().toISOString() };
  saveWordcloud(dateKey, next);
  return next;
}

function deleteWordFromCloud(dateKey, term) {
  // 仅当次从当前词云移除并由候补顶上；不写永久黑名单，下次重建可再出现
  const k = normalizeTerm(term);
  if (!k) throw new Error('缺少词语');

  const day = readDay(dateKey);
  const wc = day.wordcloud || { words: [], candidates: [], note: '', updatedAt: null };
  const words = (wc.words || []).filter((w) => normalizeTerm(w.term) !== k);
  let candidates = (wc.candidates || []).filter((w) => normalizeTerm(w.term) !== k);

  while (words.length < 36 && candidates.length) {
    words.push(candidates.shift());
  }

  const next = {
    ...wc,
    words,
    candidates,
    updatedAt: new Date().toISOString()
  };
  saveWordcloud(dateKey, next);
  return next;
}

async function buildWordcloud(dateKey) {
  const key = dateKey || todayKey();
  const day = readDay(key);

  let terms = scoreByFrequency(day);
  const mined = await mineSpecialtyTerms(day);
  console.log(`[wordcloud] mined specialty terms: ${mined.length}`);
  terms = applyMinedTerms(day, terms, mined);
  terms = finalizeScores(terms);
  terms.sort((a, b) => b.score - a.score || b.count - a.count);

  const pool = terms.filter(isEligibleTerm).slice(0, 56).map(mapTermRow);
  const words = pool.slice(0, 36);
  const candidates = pool.slice(36);

  const wordcloud = {
    words,
    candidates,
    note: '点击词云中的词查看讲解；悬停词右上角 × 可当次移除并由候补顶上。',
    updatedAt: new Date().toISOString()
  };
  saveWordcloud(key, wordcloud);
  return wordcloud;
}

module.exports = {
  buildWordcloud,
  scheduleWordcloudRebuild,
  explainOneTerm,
  cacheExplainOnWordcloud,
  deleteWordFromCloud,
  normalizeTerm,
  isEligibleTerm
};
