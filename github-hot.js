/**
 * GitHub 热点（AI / 大模型 / Agent，且须有简介）
 * 两个板块：
 *   1) topStars     — 总星标高
 *   2) weeklyRising — 过去一周涨星/新晋（Trending weekly + 近 7 日新库）
 * items 为两板块合并（供词云，最多 100）
 * 每周一 08:30 更新；非更新日沿用最近一次
 */
const cheerio = require('cheerio');
const { makeId, todayKey, saveGithub, findLatestSection } = require('./store');
const { enrichItemsZh } = require('./translate-research');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const AI_GITHUB_RE =
  /\b(ai|a\.i\.|llm|llms|gpt|chatgpt|claude|gemini|deepseek|llama|qwen|mistral|openai|anthropic|huggingface|hugging\s*face|rag|transformer|multimodal|diffusion|agentic|agents?|copilot|langchain|llamaindex|vllm|ollama|pytorch|tensorflow|keras|mlx|cuda|gpu|nlp|cv|computer[\s-]?vision|deep[\s-]?learning|machine[\s-]?learning|reinforcement[\s-]?learning|rlhf|fine[\s-]?tun|prompt|embedding|vector[\s-]?db|chromadb|milvus|faiss|onnx|safetensors|gguf|moe|sora|stable[\s-]?diffusion|midjourney|whisper|tts|asr|ocr)\b|人工智能|大模型|大语言模型|语言模型|智能体|多智能体|检索增强|多模态|深度学习|机器学习|神经网络|强化学习|自然语言|提示工程|提示词|微调|预训练|具身智能|世界模型|文生图|文生视频|扩散模型|向量|推理|生成式|基座模型|对齐/i;

const TOP_STARS_LIMIT = 20;
const WEEKLY_LIMIT = 20;
const CORPUS_LIMIT = 100;

function hasRealSummary(summary) {
  const s = String(summary || '').trim();
  if (s.length < 8) return false;
  if (/^language:\s*\w+$/i.test(s)) return false;
  return true;
}

function isAiGithubItem(item) {
  if (!item || !hasRealSummary(item.summary)) return false;
  const blob = `${item.title || ''} ${item.summary || ''} ${item.language || ''}`;
  return AI_GITHUB_RE.test(blob);
}

function filterAiGithub(items) {
  return (items || []).filter(isAiGithubItem);
}

function parseStarsNum(raw) {
  const t = String(raw || '')
    .replace(/,/g, '')
    .trim();
  const m = t.match(/([\d.]+)\s*([kKmM])?/);
  if (!m) return 0;
  let n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return 0;
  const u = (m[2] || '').toLowerCase();
  if (u === 'k') n *= 1000;
  if (u === 'm') n *= 1000000;
  return Math.round(n);
}

async function fetchText(url, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/json',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    return { text: await res.text(), contentType: res.headers.get('content-type') || '' };
  } finally {
    clearTimeout(timer);
  }
}

function mergeById(base, more) {
  const seen = new Set(base.map((i) => i.id));
  for (const it of more || []) {
    if (!it || !it.id || seen.has(it.id)) continue;
    seen.add(it.id);
    base.push(it);
  }
  return base;
}

function parseTrending(html, period) {
  const $ = cheerio.load(html);
  const items = [];
  $('article.Box-row, .Box article').each((i, el) => {
    if (items.length >= 40) return;
    const h2a = $(el).find('h2 a').first();
    const href = (h2a.attr('href') || '').trim();
    const name = h2a.text().replace(/\s+/g, ' ').trim().replace(/\s*\/\s*/g, '/');
    if (!href || !name) return;
    const desc = $(el).find('p').first().text().replace(/\s+/g, ' ').trim();
    const lang = $(el).find('[itemprop="programmingLanguage"]').first().text().trim();
    // 右侧多为「N stars today/this week」
    const deltaText = $(el)
      .find('span.d-inline-block.float-sm-right, span.float-sm-right')
      .first()
      .text()
      .replace(/\s+/g, ' ')
      .trim();
    const totalStarsText = $(el).find('a[href$="/stargazers"]').first().text().replace(/\s+/g, ' ').trim();
    const starsNum = parseStarsNum(totalStarsText);
    const starsDelta = parseStarsNum(deltaText);
    const url = href.startsWith('http') ? href : `https://github.com${href}`;
    items.push({
      id: makeId(url),
      title: name,
      summary: desc || '',
      url,
      source: `GitHub Trending (${period})`,
      sourceId: `github-trending-${period}`,
      channel: 'github',
      language: lang,
      stars: starsNum ? String(starsNum) : totalStarsText,
      starsNum,
      starsDelta,
      period,
      publishedAt: new Date().toISOString(),
      collectedAt: new Date().toISOString()
    });
  });
  return items;
}

async function fetchSearch(queries, perPage = 30) {
  let all = [];
  for (const raw of queries) {
    try {
      const q = encodeURIComponent(raw);
      const url = `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=${perPage}`;
      const { text } = await fetchText(url);
      const data = JSON.parse(text);
      const batch = (data.items || []).map((repo, idx) => {
        const starsNum = Number(repo.stargazers_count || 0);
        return {
          id: makeId(repo.html_url),
          title: repo.full_name,
          summary: repo.description || '',
          url: repo.html_url,
          source: 'GitHub Search',
          sourceId: 'github-search',
          channel: 'github',
          language: repo.language || '',
          stars: String(starsNum || ''),
          starsNum,
          starsDelta: 0,
          publishedAt: repo.created_at || new Date().toISOString(),
          collectedAt: new Date().toISOString(),
          rank: idx + 1
        };
      });
      all = mergeById(all, batch);
      console.log(`  [github] search "${raw.split(' ').slice(0, 4).join(' ')}…": ${batch.length}`);
    } catch (err) {
      console.error(`  [github] search fail (${raw.slice(0, 28)}):`, err.message || err);
    }
  }
  return all;
}

async function collectTopStars() {
  const since = new Date();
  since.setDate(since.getDate() - 365);
  const day = since.toISOString().slice(0, 10);
  const queries = [
    `llm stars:>500`,
    `GPT OR ChatGPT stars:>800`,
    `"ai agent" OR agentic stars:>300`,
    `RAG OR langchain stars:>400`,
    `"large language model" OR LLM stars:>1000 pushed:>${day}`
  ];
  // 月榜 trending 也常有高星老牌库
  let items = filterAiGithub(await fetchSearch(queries, 30));
  try {
    const { text } = await fetchText('https://github.com/trending?since=monthly');
    items = mergeById(items, filterAiGithub(parseTrending(text, 'monthly')));
  } catch (err) {
    console.error('  [github] monthly trending fail:', err.message || err);
  }
  items.sort((a, b) => (b.starsNum || 0) - (a.starsNum || 0));
  return items.slice(0, TOP_STARS_LIMIT).map((it, idx) => ({
    ...it,
    bucket: 'topStars',
    rank: idx + 1
  }));
}

async function collectWeeklyRising() {
  let items = [];
  for (const period of ['weekly', 'daily']) {
    try {
      const { text } = await fetchText(`https://github.com/trending?since=${period}`);
      const more = filterAiGithub(parseTrending(text, period));
      console.log(`  [github] trending ${period}: kept ${more.length}`);
      items = mergeById(items, more);
    } catch (err) {
      console.error(`  [github] trending ${period} fail:`, err.message || err);
    }
  }
  // 近 7 日新建/活跃的新库补齐
  const since = new Date();
  since.setDate(since.getDate() - 7);
  const day = since.toISOString().slice(0, 10);
  const fill = filterAiGithub(
    await fetchSearch(
      [
        `llm created:>${day} stars:>5`,
        `agent OR agentic created:>${day} stars:>5`,
        `GPT OR RAG created:>${day} stars:>5`
      ],
      25
    )
  );
  items = mergeById(items, fill);

  items.sort((a, b) => {
    const da = b.starsDelta || 0;
    const db = a.starsDelta || 0;
    if (da !== db) return da - db;
    return (b.starsNum || 0) - (a.starsNum || 0);
  });
  return items.slice(0, WEEKLY_LIMIT).map((it, idx) => ({
    ...it,
    bucket: 'weeklyRising',
    rank: idx + 1
  }));
}

async function collectGithub() {
  const [topStars, weeklyRising] = await Promise.all([collectTopStars(), collectWeeklyRising()]);
  let corpus = [];
  corpus = mergeById(corpus, topStars);
  corpus = mergeById(corpus, weeklyRising);
  corpus = filterAiGithub(corpus).slice(0, CORPUS_LIMIT);
  console.log(
    `  [github] topStars=${topStars.length} weeklyRising=${weeklyRising.length} corpus=${corpus.length}`
  );
  return { topStars, weeklyRising, items: corpus };
}

async function translateBuckets(topStars, weeklyRising, options) {
  if (options.translate === false) return { topStars, weeklyRising };
  const need = [];
  const seen = new Set();
  for (const it of [...topStars, ...weeklyRising]) {
    if (!it || !it.id || seen.has(it.id)) continue;
    seen.add(it.id);
    need.push(it);
  }
  const topN = Math.min(30, need.length);
  const translated = await enrichItemsZh(need.slice(0, topN), 'github');
  const map = new Map(translated.map((t) => [t.id, t]));
  const apply = (list) =>
    list.map((it) => {
      const t = map.get(it.id);
      return t ? { ...it, ...t, bucket: it.bucket, rank: it.rank } : it;
    });
  return { topStars: apply(topStars), weeklyRising: apply(weeklyRising) };
}

function normalizeCachedGithub(data) {
  const rawItems = filterAiGithub((data && data.items) || []);
  let topStars = filterAiGithub((data && data.topStars) || []);
  let weeklyRising = filterAiGithub((data && data.weeklyRising) || []);
  if (!topStars.length && rawItems.length) {
    topStars = [...rawItems]
      .sort((a, b) => (b.starsNum || parseStarsNum(b.stars) || 0) - (a.starsNum || parseStarsNum(a.stars) || 0))
      .slice(0, TOP_STARS_LIMIT)
      .map((it, idx) => ({ ...it, bucket: 'topStars', rank: idx + 1 }));
  }
  if (!weeklyRising.length && rawItems.length) {
    weeklyRising = rawItems
      .filter((it) => /trending|weekly|daily/i.test(it.sourceId || it.source || '') || (it.starsDelta || 0) > 0)
      .slice(0, WEEKLY_LIMIT)
      .map((it, idx) => ({ ...it, bucket: 'weeklyRising', rank: idx + 1 }));
    if (!weeklyRising.length) {
      weeklyRising = rawItems.slice(0, WEEKLY_LIMIT).map((it, idx) => ({
        ...it,
        bucket: 'weeklyRising',
        rank: idx + 1
      }));
    }
  }
  let items = [];
  items = mergeById(items, topStars);
  items = mergeById(items, weeklyRising);
  items = items.slice(0, CORPUS_LIMIT);
  return { topStars, weeklyRising, items };
}

async function buildGithub(dateKey, options = {}) {
  const key = dateKey || todayKey();
  let topStars = [];
  let weeklyRising = [];
  let items = [];

  if (options.force !== false) {
    const collected = await collectGithub();
    topStars = collected.topStars;
    weeklyRising = collected.weeklyRising;
    items = collected.items;
  }

  if (!items.length && !topStars.length && !weeklyRising.length) {
    const latest = findLatestSection('github');
    if (latest) {
      const norm = normalizeCachedGithub(latest.data);
      topStars = norm.topStars;
      weeklyRising = norm.weeklyRising;
      items = norm.items;
      console.log(
        `[github] using filtered cache from ${latest.date}: top=${topStars.length} week=${weeklyRising.length}`
      );
    }
  }

  const translated = await translateBuckets(topStars, weeklyRising, options);
  topStars = translated.topStars;
  weeklyRising = translated.weeklyRising;
  items = [];
  items = mergeById(items, topStars);
  items = mergeById(items, weeklyRising);
  items = items.slice(0, CORPUS_LIMIT);

  const github = {
    topStars,
    weeklyRising,
    items,
    note: '分两栏：高星仓库 / 近一周上涨与新晋。仅收录有简介且 AI·大模型·Agent 相关。每周一 08:30 更新；非更新日展示最近一次。',
    updatedAt: new Date().toISOString()
  };
  saveGithub(key, github);
  return github;
}

module.exports = {
  buildGithub,
  collectGithub,
  isAiGithubItem,
  filterAiGithub
};
