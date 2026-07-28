/**
 * 论文热点：CCF A 会刊相关 + Hugging Face Daily Papers 热门
 * 主题：大模型 / AI / DL / NLP / Agent；每周一 08:30 更新最新一批
 */
const { makeId, todayKey, savePapers, findLatestSection } = require('./store');
const { enrichItemsZh } = require('./translate-research');

const UA = 'TechNewsBot/1.0 (research digest; +http://local/technews)';

const CCF_A_VENUES = [
  'neurips',
  'nips',
  'icml',
  'iclr',
  'cvpr',
  'iccv',
  'eccv',
  'acl',
  'emnlp',
  'naacl',
  'aaai',
  'ijcai',
  'kdd',
  'www',
  'sigir',
  'jmlr',
  'tpami',
  'tacl',
  'icme',
  'siggraph'
];

const TOPIC_KEYWORDS = [
  'large language model',
  'language model',
  'llm',
  'gpt',
  'transformer',
  'attention',
  'agent',
  'agentic',
  'multi-agent',
  'reinforcement learning',
  'deep learning',
  'neural',
  'diffusion',
  'multimodal',
  'multi-modal',
  'nlp',
  'natural language',
  'rag',
  'retrieval-augmented',
  'instruction tuning',
  'rlhf',
  'alignment',
  'foundation model',
  'vision-language',
  'vlm',
  'reasoning',
  'pretrain',
  'pre-train',
  'fine-tun',
  'prompt',
  'in-context',
  'chain-of-thought',
  'cot',
  'moe',
  'mixture of experts'
];

function stripXml(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchAny(text, list) {
  const t = String(text || '').toLowerCase();
  return list.some((k) => t.includes(String(k).toLowerCase()));
}

function isTopicPaper(title, summary) {
  return matchAny(`${title} ${summary}`, TOPIC_KEYWORDS);
}

function detectVenue(text) {
  const t = String(text || '').toLowerCase();
  for (const v of CCF_A_VENUES) {
    if (t.includes(v)) {
      if (v === 'nips') return 'NeurIPS';
      if (v === 'www') return 'WWW';
      return v.toUpperCase();
    }
  }
  return '';
}

function parseAtomEntries(xml) {
  const entries = [];
  const blocks = String(xml || '').split(/<entry>/i).slice(1);
  for (const block of blocks) {
    const title = stripXml((block.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
    const id = stripXml((block.match(/<id>([\s\S]*?)<\/id>/i) || [])[1] || '');
    const summary = stripXml((block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i) || [])[1] || '').slice(
      0,
      450
    );
    const published =
      stripXml((block.match(/<published>([\s\S]*?)<\/published>/i) || [])[1] || '') ||
      stripXml((block.match(/<updated>([\s\S]*?)<\/updated>/i) || [])[1] || '');
    const comment = stripXml((block.match(/<arxiv:comment[^>]*>([\s\S]*?)<\/arxiv:comment>/i) || [])[1] || '');
    const journal = stripXml(
      (block.match(/<arxiv:journal_ref[^>]*>([\s\S]*?)<\/arxiv:journal_ref>/i) || [])[1] || ''
    );
    const cats = [];
    const catRe = /term="([^"]+)"/gi;
    let m;
    while ((m = catRe.exec(block))) cats.push(m[1]);
    if (!title || !id) continue;
    const abs = id.replace('http://', 'https://');
    const venueHint = `${comment} ${journal} ${title}`;
    entries.push({
      rawId: id,
      title,
      summary,
      comment,
      journal,
      categories: cats,
      publishedAt: published ? new Date(published).toISOString() : new Date().toISOString(),
      url: abs.includes('arxiv.org') ? abs : `https://arxiv.org/abs/${id.split('/').pop()}`,
      venue: detectVenue(venueHint)
    });
  }
  return entries;
}

async function fetchArxivQuery(searchQuery, maxResults = 40) {
  const url =
    'https://export.arxiv.org/api/query?' +
    `search_query=${encodeURIComponent(searchQuery)}&sortBy=submittedDate&sortOrder=descending&max_results=${maxResults}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': UA, Accept: 'application/atom+xml, application/xml' }
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    return parseAtomEntries(await res.text());
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCcfAPapers() {
  const venueOr = CCF_A_VENUES.map((v) => `all:${v}`).join('+OR+');
  // arxiv API uses + for AND/OR in some forms; use formal query
  const query = `(cat:cs.AI OR cat:cs.LG OR cat:cs.CL OR cat:cs.CV) AND (${CCF_A_VENUES.map((v) => `all:${v}`).join(' OR ')})`;
  let rows = [];
  try {
    rows = await fetchArxivQuery(query, 60);
    console.log(`  [papers] CCF-A query: ${rows.length}`);
  } catch (err) {
    console.error('  [papers] CCF-A query fail:', err.message || err);
  }

  // venue-specific fallbacks for recall
  if (rows.length < 20) {
    for (const v of ['neurips', 'icml', 'iclr', 'acl', 'emnlp', 'cvpr', 'aaai']) {
      try {
        const more = await fetchArxivQuery(
          `(cat:cs.AI OR cat:cs.LG OR cat:cs.CL) AND all:${v}`,
          15
        );
        rows.push(...more);
        console.log(`  [papers] venue ${v}: ${more.length}`);
      } catch (err) {
        console.error(`  [papers] venue ${v} fail:`, err.message || err);
      }
    }
  }

  const items = [];
  for (const r of rows) {
    if (!isTopicPaper(r.title, r.summary)) continue;
    const venue = r.venue || detectVenue(`${r.comment} ${r.journal} ${r.title}`) || 'CCF-A相关';
    items.push({
      id: makeId(r.url || r.rawId),
      title: r.title,
      summary: r.summary,
      url: r.url,
      source: 'CCF A / arXiv',
      sourceId: 'arxiv-ccf',
      channel: 'paper',
      venue,
      heat: '',
      categories: (r.categories || []).filter((c) => String(c).startsWith('cs.')),
      publishedAt: r.publishedAt,
      collectedAt: new Date().toISOString()
    });
  }
  return items;
}

async function fetchHfDailyHot() {
  const items = [];
  const endpoints = [
    'https://huggingface.co/api/daily_papers',
    'https://huggingface.co/api/papers/trending'
  ];
  for (const url of endpoints) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25000);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': UA, Accept: 'application/json' }
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      const list = Array.isArray(data) ? data : data.papers || data.items || [];
      list.forEach((row, idx) => {
        const paper = row.paper || row;
        const title = paper.title || row.title || '';
        const summary = paper.summary || paper.abstract || row.summary || '';
        const pid = paper.id || paper.paperId || row.id || '';
        if (!title || !isTopicPaper(title, summary)) return;
        const arxivUrl = pid
          ? `https://arxiv.org/abs/${String(pid).replace(/^arxiv:/i, '')}`
          : paper.url || row.url || '';
        if (!arxivUrl) return;
        items.push({
          id: makeId(arxivUrl),
          title,
          summary: String(summary).slice(0, 450),
          url: arxivUrl,
          source: 'arXiv热门(HF)',
          sourceId: 'hf-daily',
          channel: 'paper',
          venue: detectVenue(`${title} ${summary}`) || 'arXiv Hot',
          heat: String(row.upvotes || paper.upvotes || row.numComments || idx + 1),
          categories: [],
          publishedAt: paper.publishedAt || row.publishedAt || new Date().toISOString(),
          collectedAt: new Date().toISOString()
        });
      });
      if (items.length) {
        console.log(`  [papers] HF hot via ${url}: ${items.length}`);
        break;
      }
    } catch (err) {
      console.error(`  [papers] HF fail ${url}:`, err.message || err);
    }
  }

  // fallback: recent cs.AI/LG/CL with topic filter as "latest hot candidates"
  if (items.length < 10) {
    try {
      const recent = await fetchArxivQuery('cat:cs.AI OR cat:cs.LG OR cat:cs.CL', 40);
      for (const r of recent) {
        if (!isTopicPaper(r.title, r.summary)) continue;
        items.push({
          id: makeId(r.url),
          title: r.title,
          summary: r.summary,
          url: r.url,
          source: 'arXiv最新',
          sourceId: 'arxiv-latest',
          channel: 'paper',
          venue: r.venue || 'arXiv',
          heat: '',
          categories: (r.categories || []).filter((c) => String(c).startsWith('cs.')),
          publishedAt: r.publishedAt,
          collectedAt: new Date().toISOString()
        });
      }
      console.log(`  [papers] arxiv latest fallback added, total=${items.length}`);
    } catch (err) {
      console.error('  [papers] latest fallback fail:', err.message || err);
    }
  }
  return items;
}

async function collectPapers() {
  const [ccf, hot] = await Promise.all([fetchCcfAPapers(), fetchHfDailyHot()]);
  const byId = new Map();
  for (const it of [...ccf, ...hot]) {
    if (!byId.has(it.id)) byId.set(it.id, it);
    else {
      // prefer CCF tagged venue
      const prev = byId.get(it.id);
      if (it.sourceId === 'arxiv-ccf' && prev.sourceId !== 'arxiv-ccf') byId.set(it.id, it);
    }
  }
  return Array.from(byId.values())
    .sort((a, b) => {
      const rank = (it) =>
        it.sourceId === 'arxiv-ccf' ? 0 : it.sourceId === 'hf-daily' ? 1 : 2;
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      return Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
    })
    .slice(0, 80);
}

async function buildPapers(dateKey, options = {}) {
  const key = dateKey || todayKey();
  let items = [];
  if (options.force !== false) {
    items = await collectPapers();
  }
  if (!items.length) {
    const latest = findLatestSection('papers');
    if (latest) {
      items = latest.data.items;
      console.log(`[papers] using cache from ${latest.date}`);
    }
  }
  if (items.length && options.translate !== false) {
    items = await enrichItemsZh(items, 'paper');
  }
  const papers = {
    items,
    note: 'CCF A 相关会刊/期刊（NeurIPS/ICML/ICLR/ACL等）+ Hugging Face Daily Papers 社区热度（arXiv无官方浏览量）；主题：大模型/AI/DL/NLP/Agent；每周一 08:30 更新。非更新日展示最近一次。点击卡片查看中文简介。',
    updatedAt: new Date().toISOString()
  };
  savePapers(key, papers);
  return papers;
}

module.exports = { buildPapers, collectPapers, CCF_A_VENUES };
