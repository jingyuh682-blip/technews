const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const RETENTION_DAYS = 14;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDateKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '');
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function dateFile(dateKey) {
  return path.join(DATA_DIR, `${dateKey}.json`);
}

function makeId(url) {
  return crypto.createHash('sha1').update(String(url || '')).digest('hex').slice(0, 16);
}

function blacklistFile() {
  return path.join(DATA_DIR, 'wordcloud-blacklist.json');
}

function normalizeBlacklistTerm(t) {
  return String(t || '')
    .trim()
    .toLowerCase()
    .replace(/^[#＃@]+/, '')
    .replace(/\s+/g, ' ');
}

function loadWordcloudBlacklist() {
  ensureDataDir();
  const file = blacklistFile();
  if (!fs.existsSync(file)) return { terms: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const terms = Array.isArray(raw.terms)
      ? raw.terms.map(normalizeBlacklistTerm).filter(Boolean)
      : [];
    return { terms: Array.from(new Set(terms)) };
  } catch (_e) {
    return { terms: [] };
  }
}

function saveWordcloudBlacklist(payload) {
  ensureDataDir();
  const terms = Array.from(
    new Set((payload.terms || []).map(normalizeBlacklistTerm).filter(Boolean))
  );
  fs.writeFileSync(blacklistFile(), JSON.stringify({ terms }, null, 2), 'utf8');
  return { terms };
}

function isBlacklisted(term) {
  const k = normalizeBlacklistTerm(term);
  if (!k) return false;
  const { terms } = loadWordcloudBlacklist();
  return terms.includes(k);
}

function addWordcloudBlacklist(term) {
  const k = normalizeBlacklistTerm(term);
  if (!k) return loadWordcloudBlacklist();
  const cur = loadWordcloudBlacklist();
  if (!cur.terms.includes(k)) cur.terms.push(k);
  return saveWordcloudBlacklist(cur);
}

function emptyDay(dateKey) {
  return {
    date: dateKey,
    updatedAt: null,
    items: [],
    hotspots: [],
    wordcloud: null,
    books: null,
    papers: null,
    github: null
  };
}

function readDay(dateKey) {
  ensureDataDir();
  const file = dateFile(dateKey);
  if (!fs.existsSync(file)) return emptyDay(dateKey);
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      date: dateKey,
      updatedAt: raw.updatedAt || null,
      items: Array.isArray(raw.items) ? raw.items : [],
      hotspots: Array.isArray(raw.hotspots) ? raw.hotspots : [],
      wordcloud: raw.wordcloud || null,
      books: raw.books || null,
      papers: raw.papers || null,
      github: raw.github || null
    };
  } catch (_e) {
    return emptyDay(dateKey);
  }
}

function writeDayPayload(dateKey, payload) {
  ensureDataDir();
  const day = readDay(dateKey);
  const next = {
    date: dateKey,
    updatedAt: new Date().toISOString(),
    items: payload.items !== undefined ? payload.items : day.items,
    hotspots: payload.hotspots !== undefined ? payload.hotspots : day.hotspots,
    wordcloud: payload.wordcloud !== undefined ? payload.wordcloud : day.wordcloud,
    books: payload.books !== undefined ? payload.books : day.books,
    papers: payload.papers !== undefined ? payload.papers : day.papers,
    github: payload.github !== undefined ? payload.github : day.github
  };
  fs.writeFileSync(dateFile(dateKey), JSON.stringify(next, null, 2), 'utf8');

  // 新闻 / 热点 / 论文 / GitHub 内容变化后，延迟重建词云（避免频繁打 LLM）
  const contentChanged =
    payload.items !== undefined ||
    payload.hotspots !== undefined ||
    payload.papers !== undefined ||
    payload.github !== undefined;
  if (contentChanged) {
    try {
      const { scheduleWordcloudRebuild } = require('./wordcloud');
      scheduleWordcloudRebuild(dateKey);
    } catch (err) {
      console.warn('[store] schedule wordcloud rebuild fail:', err.message || err);
    }
  }
  return next;
}

/** @deprecated prefer writeDayPayload — kept for collector news path */
function writeDay(dateKey, items) {
  return writeDayPayload(dateKey, { items });
}

function listAvailableDates() {
  ensureDataDir();
  const files = fs.readdirSync(DATA_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));
  const keys = files.map((f) => f.replace(/\.json$/, '')).sort().reverse();
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (RETENTION_DAYS - 1));
  return keys.filter((k) => {
    const d = parseDateKey(k);
    return d && d >= cutoff;
  });
}

function listLast14DateOptions() {
  const available = new Set(listAvailableDates());
  const options = [];
  for (let i = 0; i < RETENTION_DAYS; i++) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = todayKey(d);
    const day = available.has(key) ? readDay(key) : null;
    options.push({
      date: key,
      label: key,
      hasNews: !!(day && day.items.length),
      count: day ? day.items.length : 0,
      hotCount: day ? day.hotspots.length : 0
    });
  }
  return options;
}

function findById(id) {
  for (const date of listAvailableDates()) {
    const day = readDay(date);
    const item = day.items.find((it) => it.id === id);
    if (item) return { ...item, collectedDate: date, category: 'news' };
    const hot = day.hotspots.find((it) => it.id === id);
    if (hot) return { ...hot, collectedDate: date, category: 'hot' };
    const paper = ((day.papers && day.papers.items) || []).find((it) => it.id === id);
    if (paper) return { ...paper, collectedDate: date, category: 'paper' };
    const repo = ((day.github && day.github.items) || []).find((it) => it.id === id);
    if (repo) return { ...repo, collectedDate: date, category: 'github' };
  }
  return null;
}

function purgeExpired() {
  ensureDataDir();
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (RETENTION_DAYS - 1));
  let removed = 0;
  for (const name of fs.readdirSync(DATA_DIR)) {
    if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(name)) continue;
    const key = name.replace(/\.json$/, '');
    const d = parseDateKey(key);
    if (d && d < cutoff) {
      fs.unlinkSync(path.join(DATA_DIR, name));
      removed += 1;
    }
  }
  return removed;
}

function upsertList(existing, newItems) {
  const map = new Map(existing.map((it) => [it.id, it]));
  let added = 0;
  let updated = 0;
  for (const item of newItems) {
    if (!item || !item.id) continue;
    if (map.has(item.id)) {
      const prev = map.get(item.id);
      map.set(item.id, { ...prev, ...item, id: prev.id });
      updated += 1;
    } else {
      map.set(item.id, item);
      added += 1;
    }
  }
  const items = Array.from(map.values()).sort((a, b) => {
    const ta = Date.parse(a.publishedAt || a.collectedAt || 0) || 0;
    const tb = Date.parse(b.publishedAt || b.collectedAt || 0) || 0;
    return tb - ta;
  });
  return { items, added, updated };
}

function upsertToday(newItems) {
  const key = todayKey();
  const day = readDay(key);
  const result = upsertList(day.items, newItems);
  writeDayPayload(key, { items: result.items });
  return { date: key, added: result.added, updated: result.updated, total: result.items.length };
}

function upsertHotspotsToday(newItems) {
  const key = todayKey();
  // 全量替换当日热点，避免旧的非 AI 条目残留
  const priority = { zhihu: 0, hotsearch: 1, 'wechat-mirror': 2, 'video-proxy': 3 };
  const items = (newItems || [])
    .filter((it) => it && it.id)
    .sort((a, b) => {
      const pa = priority[a.channel] != null ? priority[a.channel] : 9;
      const pb = priority[b.channel] != null ? priority[b.channel] : 9;
      if (pa !== pb) return pa - pb;
      const ra = a.rank != null ? a.rank : 999;
      const rb = b.rank != null ? b.rank : 999;
      if (ra !== rb) return ra - rb;
      const ta = Date.parse(a.publishedAt || a.collectedAt || 0) || 0;
      const tb = Date.parse(b.publishedAt || b.collectedAt || 0) || 0;
      return tb - ta;
    });
  writeDayPayload(key, { hotspots: items });
  return { date: key, added: items.length, updated: 0, total: items.length };
}

function saveWordcloud(dateKey, wordcloud) {
  return writeDayPayload(dateKey || todayKey(), { wordcloud });
}

function saveBooks(dateKey, books) {
  return writeDayPayload(dateKey || todayKey(), { books });
}

function savePapers(dateKey, papers) {
  return writeDayPayload(dateKey || todayKey(), { papers });
}

function saveGithub(dateKey, github) {
  return writeDayPayload(dateKey || todayKey(), { github });
}

/** Patch a single paper/github item (e.g. after on-demand translation). */
function patchResearchItem(dateKey, category, id, patch) {
  if (!dateKey || !id || !patch) return null;
  const day = readDay(dateKey);
  const sectionKey = category === 'github' ? 'github' : 'papers';
  const sec = day[sectionKey];
  if (!sec || !Array.isArray(sec.items)) return null;
  let found = null;
  const items = sec.items.map((it) => {
    if (it.id !== id) return it;
    found = { ...it, ...patch, id: it.id };
    return found;
  });
  if (!found) return null;
  writeDayPayload(dateKey, { [sectionKey]: { ...sec, items } });
  return found;
}

/** Find most recent day that has bestsellers data (for fallback). */
function findLatestBooks() {
  for (const date of listAvailableDates()) {
    const day = readDay(date);
    const b = day.books;
    if (!b) continue;
    const hasList = Array.isArray(b.bestsellers) && b.bestsellers.length;
    const hasPlan = Array.isArray(b.planning) && b.planning.length;
    const hasAnalysis = String(b.analysis || '').trim().length > 0;
    if (hasList || hasPlan || hasAnalysis) {
      return { date, books: b };
    }
  }
  return null;
}

function findLatestSection(field) {
  for (const date of listAvailableDates()) {
    const day = readDay(date);
    const sec = day[field];
    if (!sec) continue;
    if (Array.isArray(sec.items) && sec.items.length) return { date, data: sec };
    if (field === 'github') {
      const has =
        (Array.isArray(sec.topStars) && sec.topStars.length) ||
        (Array.isArray(sec.weeklyRising) && sec.weeklyRising.length);
      if (has) return { date, data: sec };
    }
  }
  return null;
}

/** Remove hotspot-only sources from news items across retained days. */
function purgeHotSourcesFromNews(hotSourceIds) {
  const ids = new Set(hotSourceIds || []);
  let removed = 0;
  for (const date of listAvailableDates()) {
    const day = readDay(date);
    const before = day.items.length;
    const items = day.items.filter((it) => !ids.has(it.sourceId));
    if (items.length !== before) {
      writeDayPayload(date, { items });
      removed += before - items.length;
    }
  }
  return removed;
}

module.exports = {
  DATA_DIR,
  RETENTION_DAYS,
  todayKey,
  makeId,
  readDay,
  writeDay,
  writeDayPayload,
  listAvailableDates,
  listLast14DateOptions,
  findById,
  purgeExpired,
  upsertToday,
  upsertHotspotsToday,
  saveWordcloud,
  saveBooks,
  savePapers,
  saveGithub,
  patchResearchItem,
  loadWordcloudBlacklist,
  saveWordcloudBlacklist,
  isBlacklisted,
  addWordcloudBlacklist,
  normalizeBlacklistTerm,
  findLatestBooks,
  findLatestSection,
  purgeHotSourcesFromNews,
  ensureDataDir
};
