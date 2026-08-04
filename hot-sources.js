/**
 * 科技热点源：知乎 / 热搜 / 公众号官网 RSS / 机器之心 / 微信直采
 * 全通道严格限定 AI / 大模型相关
 */
const Parser = require('rss-parser');
const { makeId } = require('./store');
const { CUSTOM_SOURCES } = require('./custom-sources');
const { isContentNoise, hasTechOrProductSignal } = require('./content-filter');
const { WECHAT_HEAD_ACCOUNTS, collectWechatDirect, isTodayOrYesterday } = require('./wechat-direct');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** 热点严格白名单：AI / 大模型 / Agent / DL / NLP */
const AI_HOT_KEYWORDS = [
  '人工智能',
  '大模型',
  '大语言模型',
  '语言模型',
  'llm',
  'llms',
  'gpt',
  'chatgpt',
  'claude',
  'gemini',
  'deepseek',
  'llama',
  'qwen',
  'mistral',
  'openai',
  'anthropic',
  '智能体',
  'agent',
  'agents',
  'agentic',
  'multi-agent',
  '多智能体',
  'rag',
  '检索增强',
  'transformer',
  '多模态',
  'multimodal',
  '深度学习',
  'deep learning',
  '神经网络',
  '强化学习',
  'nlp',
  '自然语言',
  '提示工程',
  'prompt',
  '微调',
  '预训练',
  'rlhf',
  '具身智能',
  'world model',
  '世界模型',
  '文生图',
  '文生视频',
  '扩散模型',
  'diffusion',
  'sora',
  'midjourney',
  'stable diffusion',
  'copilot',
  'codex',
  'cursor',
  '通义千问',
  '文心一言',
  '豆包',
  'kimi',
  '混元',
  '智谱',
  '月之暗面',
  '深度求索',
  'huggingface',
  'hugging face',
  'nvidia',
  '英伟达',
  'gpu',
  '算力',
  'aigc',
  '生成式',
  'foundation model',
  '基座模型',
  '推理模型',
  '对齐',
  'alignment',
  '机器学习',
  'machine learning',
  'computer vision',
  '计算机视觉'
];

const parser = new Parser({
  timeout: 12000,
  headers: {
    'User-Agent': UA,
    Accept: 'application/rss+xml, application/xml, text/xml, */*'
  }
});

const WECHAT_MIRROR_FEEDS = [
  { id: 'qbitai-hot', name: '量子位', url: 'https://qbitai.com/feed', channel: 'wechat-mirror' },
  { id: 'leiphone-hot', name: '雷锋网', url: 'https://www.leiphone.com/feed', channel: 'wechat-mirror' },
  { id: 'ifanr-hot', name: '爱范儿', url: 'https://www.ifanr.com/feed', channel: 'wechat-mirror' },
  { id: 'sspai-hot', name: '少数派', url: 'https://sspai.com/feed', channel: 'wechat-mirror' },
  { id: 'jiemian-hot', name: '界面新闻', url: 'https://a.jiemian.com/index.php?m=article&a=rss&type=3', channel: 'wechat-mirror' },
  { id: 'infoq-cn-hot', name: 'InfoQ', url: 'https://www.infoq.cn/feed', channel: 'wechat-mirror' },
  { id: 'kr36-video', name: '36氪', url: 'https://36kr.com/feed', channel: 'video-proxy' }
];

/**
 * 核心公众号名单（biz / 登录态见 wechat-direct.js）
 */
const WECHAT_AI_NAMES = new Set(
  WECHAT_HEAD_ACCOUNTS.filter((a) => a.tier === 'ai').map((a) => a.name)
);

const CHANNEL_PRIORITY = { zhihu: 0, hotsearch: 1, 'wechat-mirror': 2, 'video-proxy': 3 };

function isAiHotRelated(title, extra = '') {
  const t = `${title || ''} ${extra || ''}`.toLowerCase();
  if (/(^|[^a-z])ai([^a-z]|$)/i.test(t) && /模型|智能|大|agent|gpt|生成|训练|芯片|算力|算法/.test(t)) {
    return true;
  }
  return AI_HOT_KEYWORDS.some((k) => t.indexOf(String(k).toLowerCase()) !== -1);
}

/**
 * 热点入选：AI 相关 + 非广告八卦；时间须为昨天或今天（上海自然日）
 * 公众号通道还须偏技术/产品
 */
function keepHotspotItem(it) {
  const title = it.title || '';
  const summary = it.summary || '';
  if (isContentNoise(title, summary)) return false;

  // 公众号 / 镜像：必须有发布时间，且为昨天或今天
  if (it.channel === 'wechat-mirror' || it.channel === 'video-proxy') {
    if (!it.publishedAt || !isTodayOrYesterday(it.publishedAt)) return false;
  } else if (it.publishedAt && !isTodayOrYesterday(it.publishedAt)) {
    // 其它通道：有时间戳则同样限制在昨天+今天
    return false;
  }

  const fromAiWechat =
    WECHAT_AI_NAMES.has(it.source) ||
    it.sourceId === 'jiqizhixin-hot' ||
    it.source === '量子位' ||
    it.source === '机器之心';

  const aiOk = fromAiWechat || isAiHotRelated(title, summary);
  if (!aiOk) return false;

  // AI 媒体公众号：近一周本号稿已在采集侧校验，这里只挡广告八卦
  if (fromAiWechat) return true;

  if (it.channel === 'wechat-mirror' || it.channel === 'video-proxy') {
    return hasTechOrProductSignal(title, summary);
  }
  return true;
}

function stripTags(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms))
  ]);
}

async function fetchJson(url, timeoutMs = 15000, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        ...extraHeaders
      }
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function hotspotItem({ title, url, source, sourceId, channel, summary, rank, heatHint, image, publishedAt }) {
  const link = url || `https://www.baidu.com/s?wd=${encodeURIComponent(title)}`;
  const now = new Date().toISOString();
  let pub = now;
  if (publishedAt) {
    const t = Date.parse(publishedAt);
    if (!Number.isNaN(t)) pub = new Date(t).toISOString();
  }
  return {
    id: makeId(`${channel}:${link}:${title}`),
    title: String(title).slice(0, 240),
    summary: String(summary || '').slice(0, 320),
    contentHtml: '',
    image: image || '',
    sourceId,
    source,
    channel,
    url: link,
    rank: rank != null ? rank : null,
    heatHint: heatHint || '',
    publishedAt: pub,
    collectedAt: now
  };
}

/** 近 N 天内（含今天），用于公众号/RSS 时效过滤 */
function isWithinLastDays(isoOrDate, days = 7) {
  const t = Date.parse(isoOrDate);
  if (Number.isNaN(t)) return false;
  const ms = days * 24 * 60 * 60 * 1000;
  const age = Date.now() - t;
  return age >= -60 * 60 * 1000 && age <= ms;
}

function unwrapBaiduList(data) {
  const cards = (data && data.data && data.data.cards) || [];
  let list = [];
  for (const card of cards) {
    let content = card.content || [];
    if (content.length && content[0] && Array.isArray(content[0].content)) {
      content = content[0].content;
    }
    if (Array.isArray(content) && content.length) {
      list = content;
      break;
    }
  }
  if (!list.length) {
    for (const card of cards) {
      if (card.component === 'hotList' && Array.isArray(card.content)) {
        list = card.content;
        break;
      }
    }
  }
  return list;
}

async function fetchBaiduHot() {
  const items = [];
  const urls = [
    'https://top.baidu.com/api/board?platform=wise&tab=realtime',
    'https://top.baidu.com/api/board?platform=pc&tab=realtime'
  ];
  let lastErr = null;
  for (const url of urls) {
    try {
      const data = await fetchJson(url, 15000, { Referer: 'https://top.baidu.com/board' });
      const list = unwrapBaiduList(data);
      list.forEach((row, idx) => {
        const title = row.word || row.query || row.title || '';
        if (!title || !isAiHotRelated(title, row.desc || '')) return;
        items.push(
          hotspotItem({
            title,
            url: row.url || row.appUrl || `https://www.baidu.com/s?wd=${encodeURIComponent(title)}`,
            source: '百度热搜',
            sourceId: 'baidu-hot',
            channel: 'hotsearch',
            summary: row.desc || '',
            rank: Number(row.index != null ? row.index : idx) + 1,
            heatHint: String(row.hotScore || row.rawHot || row.hotTag || ''),
            image: row.img || ''
          })
        );
      });
      if (items.length) break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!items.length && lastErr) {
    return { ok: false, source: 'baidu-hot', error: String(lastErr.message || lastErr), items: [] };
  }
  return { ok: true, source: 'baidu-hot', count: items.length, items };
}

async function fetchWeiboHot() {
  try {
    const data = await fetchJson('https://weibo.com/ajax/side/hotSearch', 15000, {
      Referer: 'https://weibo.com/',
      Cookie: 'SUB=; _T_WM=;'
    });
    const list = (data.data && data.data.realtime) || [];
    const items = [];
    list.forEach((row, idx) => {
      const title = row.word || row.note || '';
      if (!title || !isAiHotRelated(title)) return;
      items.push(
        hotspotItem({
          title,
          url: `https://s.weibo.com/weibo?q=${encodeURIComponent(title)}`,
          source: '微博热搜',
          sourceId: 'weibo-hot',
          channel: 'hotsearch',
          summary: row.category || '',
          rank: Number(row.realpos || row.rank || idx) + 1,
          heatHint: String(row.num || row.raw_hot || '')
        })
      );
    });
    return { ok: true, source: 'weibo-hot', count: items.length, items };
  } catch (err) {
    return { ok: false, source: 'weibo-hot', error: String(err.message || err), items: [] };
  }
}

function makeZhihuItem(row, idx) {
  const target = row.target || row;
  const title = target.title || target.titleArea?.text || row.title || row.detail_text || '';
  if (!title) return null;
  let url = '';
  if (target.link && target.link.url) url = target.link.url;
  else if (target.url) url = String(target.url).replace('api.zhihu.com/questions', 'www.zhihu.com/question');
  else if (row.id || target.id) {
    const id = String(row.card_id || row.id || target.id).replace(/^Q_/, '');
    url = `https://www.zhihu.com/question/${id}`;
  } else {
    url = `https://www.zhihu.com/search?q=${encodeURIComponent(title)}`;
  }
  return hotspotItem({
    title: stripTags(title),
    url,
    source: '知乎热榜',
    sourceId: 'zhihu-hot',
    channel: 'zhihu',
    summary: stripTags(target.excerpt || target.excerpt_area?.text || row.detail_text || ''),
    rank: idx + 1,
    heatHint: String(row.detail_text || target.metrics_area?.text || row.hot || '')
  });
}

async function fetchZhihuHot() {
  let rawRows = [];
  let lastErr = null;

  try {
    const data = await fetchJson(
      'https://api.zhihu.com/topstory/hot-list?limit=50&reverse_order=0',
      12000,
      {
        Referer: 'https://www.zhihu.com/',
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
      }
    );
    rawRows = data.data || [];
  } catch (err) {
    lastErr = err;
  }

  if (!rawRows.length) {
    try {
      const data = await fetchJson('https://newsnow.busiyi.world/api/s?id=zhihu', 12000);
      const list = data.items || data.data || [];
      rawRows = (Array.isArray(list) ? list : []).map((row) => ({
        title: row.title,
        detail_text: String(row.hot || ''),
        target: {
          title: row.title,
          url: row.url || `https://www.zhihu.com/question/${row.id || ''}`,
          id: row.id
        }
      }));
    } catch (err) {
      lastErr = err;
    }
  }

  const items = [];
  rawRows.forEach((row, idx) => {
    const target = row.target || row;
    const title = target.title || row.title || '';
    const extra = target.excerpt || row.detail_text || '';
    if (!isAiHotRelated(title, extra)) return;
    const item = makeZhihuItem(row, idx);
    if (item) items.push(item);
  });

  const seen = new Set();
  const unique = [];
  for (const it of items) {
    const k = it.title.replace(/\s+/g, '').slice(0, 40);
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(it);
  }

  if (!unique.length) {
    return {
      ok: false,
      source: 'zhihu-hot',
      error: String((lastErr && lastErr.message) || 'no AI items'),
      items: []
    };
  }
  return { ok: true, source: 'zhihu-hot', count: unique.length, items: unique.slice(0, 30) };
}

async function fetchMirrorFeed(feed) {
  try {
    const parsed = await withTimeout(parser.parseURL(feed.url), 15000);
    const items = [];
    for (let i = 0; i < (parsed.items || []).length && i < 25; i++) {
      const raw = parsed.items[i];
      const title = stripTags(raw.title || '');
      const summary = stripTags(raw.contentSnippet || raw.summary || '');
      if (!title || !isAiHotRelated(title, summary)) continue;
      const url = raw.link || raw.guid || '';
      if (!url) continue;
      const publishedAt = raw.isoDate || raw.pubDate || null;
      // 镜像 RSS：只要当天与昨天真实发布的稿
      if (!publishedAt || !isTodayOrYesterday(publishedAt)) continue;
      items.push(
        hotspotItem({
          title,
          url,
          source: feed.name,
          sourceId: feed.id,
          channel: feed.channel,
          summary: summary.slice(0, 320),
          publishedAt
        })
      );
    }
    return { ok: true, source: feed.id, count: items.length, items };
  } catch (err) {
    return { ok: false, source: feed.id, error: String(err.message || err), items: [] };
  }
}

async function fetchJiqizhixinHot() {
  try {
    if (!CUSTOM_SOURCES.jiqizhixin) {
      return { ok: false, source: 'jiqizhixin-hot', error: 'missing custom source', items: [] };
    }
    const result = await CUSTOM_SOURCES.jiqizhixin();
    const items = [];
    for (const it of result.items || []) {
      if (!isAiHotRelated(it.title, it.summary || '')) continue;
      const publishedAt = it.publishedAt || it.isoDate || it.pubDate || null;
      // 机器之心：必须有真实发布时间且为当天或昨天
      if (!publishedAt || !isTodayOrYesterday(publishedAt)) continue;
      items.push(
        hotspotItem({
          title: it.title,
          url: it.url,
          source: '机器之心',
          sourceId: 'jiqizhixin-hot',
          channel: 'wechat-mirror',
          summary: it.summary || '',
          image: it.image || '',
          publishedAt
        })
      );
    }
    return { ok: true, source: 'jiqizhixin-hot', count: items.length, items };
  } catch (err) {
    return { ok: false, source: 'jiqizhixin-hot', error: String(err.message || err), items: [] };
  }
}

async function collectHotspots() {
  const results = [];
  const [zhihu, baidu, weibo, jqzx, direct] = await Promise.all([
    fetchZhihuHot(),
    fetchBaiduHot(),
    fetchWeiboHot(),
    fetchJiqizhixinHot(),
    collectWechatDirect()
  ]);
  results.push(zhihu, baidu, weibo, jqzx, direct);

  const mirrorResults = await Promise.all(WECHAT_MIRROR_FEEDS.map(fetchMirrorFeed));
  results.push(...mirrorResults);

  let all = [];
  for (const r of results) {
    all = all.concat(r.items || []);
    console.log(
      r.ok ? `  [hot] OK ${r.source}: ${r.count}` : `  [hot] FAIL ${r.source}: ${r.error}`
    );
  }

  all = all.filter(keepHotspotItem);

  const byId = new Map();
  const byTitle = new Map();
  for (const it of all) {
    const tkey = it.title.replace(/\s+/g, '').slice(0, 40);
    if (byId.has(it.id) || byTitle.has(tkey)) continue;
    byId.set(it.id, it);
    byTitle.set(tkey, it);
  }
  const unique = Array.from(byId.values());
  unique.sort((a, b) => {
    const pa = CHANNEL_PRIORITY[a.channel] != null ? CHANNEL_PRIORITY[a.channel] : 9;
    const pb = CHANNEL_PRIORITY[b.channel] != null ? CHANNEL_PRIORITY[b.channel] : 9;
    if (pa !== pb) return pa - pb;
    const ta = Date.parse(a.publishedAt || a.collectedAt || 0) || 0;
    const tb = Date.parse(b.publishedAt || b.collectedAt || 0) || 0;
    if (ta !== tb) return tb - ta;
    const ra = a.rank != null ? a.rank : 999;
    const rb = b.rank != null ? b.rank : 999;
    if (ra !== rb) return ra - rb;
    return Date.parse(b.collectedAt) - Date.parse(a.collectedAt);
  });

  return { results, items: unique };
}

module.exports = {
  collectHotspots,
  WECHAT_MIRROR_FEEDS,
  WECHAT_HEAD_ACCOUNTS,
  isAiHotRelated,
  isHotNoise: isContentNoise,
  hasTechOrProductSignal,
  keepHotspotItem,
  isWithinLastDays,
  AI_HOT_KEYWORDS
};
