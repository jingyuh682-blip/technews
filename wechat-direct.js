/**
 * 微信公众号采集（基于微信读书开放代理，扫码登录）
 * 平台：PLATFORM_URL，默认 https://weread.111965.xyz
 */
const fs = require('fs');
const path = require('path');
const { makeId } = require('./store');
const { isContentNoise, hasTechOrProductSignal } = require('./content-filter');
const { autoResolveAccounts, resolveOneAccount, SEED_MP_IDS } = require('./wechat-auto-resolve');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const AUTH_FILE = path.join(DATA_DIR, 'wechat-auth.json');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'wechat-accounts.json');
const PLATFORM_URL = (process.env.WEREAD_PLATFORM_URL || 'https://weread.111965.xyz').replace(
  /\/$/,
  ''
);

let pullProgress = {
  phase: 'idle',
  pct: 0,
  message: '',
  updatedAt: null,
  count: 0,
  matched: 0,
  total: 0,
  error: ''
};

function setPullProgress(partial) {
  pullProgress = {
    ...pullProgress,
    ...partial,
    updatedAt: new Date().toISOString()
  };
  return pullProgress;
}

function getPullProgress() {
  return { ...pullProgress };
}

const DEFAULT_ACCOUNTS = [
  { name: '新智元', tier: 'ai' },
  { name: '量子位', tier: 'ai' },
  { name: '机器之心', tier: 'ai' },
  { name: 'AI科技大本营', tier: 'ai' },
  { name: '人工智能头条', tier: 'ai' },
  { name: 'AI研习社', tier: 'ai' },
  { name: '有三AI', tier: 'ai' },
  { name: 'AI有道', tier: 'ai' },
  { name: 'AINLP', tier: 'ai' },
  { name: 'AI派', tier: 'ai' },
  { name: 'AI蜗牛车', tier: 'ai' },
  { name: 'AI算法之心', tier: 'ai' },
  { name: 'AI算法与图像处理', tier: 'ai' },
  { name: 'AI小白入门', tier: 'ai' },
  { name: '和武博士一起学AI', tier: 'ai' },
  { name: '深度学习专栏', tier: 'ai' },
  { name: '机器学习实验室', tier: 'ai' },
  { name: '机器学习blog', tier: 'ai' },
  { name: '机器学习与python集中营', tier: 'ai' },
  { name: '计算机视觉life', tier: 'ai' },
  { name: '计算机视觉联盟', tier: 'ai' },
  { name: '我爱计算机视觉', tier: 'ai' },
  { name: 'CVer', tier: 'ai' },
  { name: 'Datawhale', tier: 'ai' },
  { name: '视学算法', tier: 'ai' },
  { name: '算法与数学之美', tier: 'ai' },
  { name: '算法二三事', tier: 'ai' },
  { name: '腾讯技术工程', tier: 'tech' },
  { name: 'CSDN', tier: 'tech' },
  { name: '51CTO技术栈', tier: 'tech' },
  { name: '51CTO官微', tier: 'tech' },
  { name: 'SegmentFault', tier: 'tech' },
  { name: 'GitChat', tier: 'tech' },
  { name: '程序员小灰', tier: 'tech' },
  { name: '程序人生', tier: 'tech' },
  { name: '小詹学Python', tier: 'tech' },
  { name: 'Python爬虫与数据挖掘', tier: 'tech' },
  { name: 'Python数据之道', tier: 'tech' },
  { name: '数据管道', tier: 'tech' },
  { name: '数据分析1480', tier: 'tech' },
  { name: '小象学院', tier: 'tech' },
  { name: '数学建模', tier: 'tech' },
  { name: '搜云库技术团队', tier: 'tech' },
  { name: 'strongerHuang', tier: 'tech' },
  { name: 'spacedong', tier: 'tech' },
  { name: '表哥有话讲', tier: 'tech' },
  { name: '七天小码哥', tier: 'tech' },
  { name: '程序猿', tier: 'tech' },
  { name: '神奇的战士', tier: 'tech' }
];

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function isWithinLastDays(isoOrDate, days = 2) {
  const t = Date.parse(isoOrDate);
  if (Number.isNaN(t)) return false;
  const age = Date.now() - t;
  return age >= -60 * 60 * 1000 && age <= days * 24 * 60 * 60 * 1000;
}

/** 当天或前一天（Asia/Shanghai 自然日） */
function isTodayOrYesterday(isoOrDate) {
  const t = Date.parse(isoOrDate);
  if (Number.isNaN(t)) return false;
  if (t - Date.now() > 60 * 60 * 1000) return false;
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const day = fmt.format(new Date(t));
  const today = fmt.format(new Date());
  const yesterday = fmt.format(new Date(Date.now() - 24 * 60 * 60 * 1000));
  return day === today || day === yesterday;
}

function emptyAuth(status = 'missing') {
  return {
    mode: 'weread',
    vid: '',
    token: '',
    username: '',
    status,
    updatedAt: null,
    lastError: ''
  };
}

function loadAuth() {
  ensureDataDir();
  if (!fs.existsSync(AUTH_FILE)) return emptyAuth('missing');
  try {
    const raw = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    // 兼容旧 profile_ext 字段：视为失效，引导重新扫码
    if (raw.uin || raw.key || raw.cookie) {
      return emptyAuth('missing');
    }
    const has = Boolean(raw.vid && raw.token);
    return {
      mode: 'weread',
      vid: String(raw.vid || raw.id || ''),
      token: String(raw.token || ''),
      username: String(raw.username || ''),
      status: raw.status || (has ? 'ok' : 'missing'),
      updatedAt: raw.updatedAt || null,
      lastError: raw.lastError || ''
    };
  } catch (_e) {
    return emptyAuth('missing');
  }
}

function saveAuth(auth) {
  ensureDataDir();
  fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), 'utf8');
  return auth;
}

function loadAccounts() {
  ensureDataDir();
  if (!fs.existsSync(ACCOUNTS_FILE)) {
    const seeded = DEFAULT_ACCOUNTS.map((a) => ({
      name: a.name,
      tier: a.tier || 'tech',
      mpId: '',
      biz: '',
      shareUrl: ''
    }));
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(seeded, null, 2), 'utf8');
    return seeded;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
    if (!Array.isArray(raw)) return [];
    return raw
      .map((a) => ({
        name: String(a.name || '').trim(),
        tier: a.tier === 'ai' ? 'ai' : 'tech',
        mpId: String(a.mpId || a.id || '').trim(),
        biz: String(a.biz || '').trim(),
        shareUrl: String(a.shareUrl || '').trim()
      }))
      .filter((a) => a.name);
  } catch (_e) {
    return [];
  }
}

function saveAccounts(accounts) {
  ensureDataDir();
  const list = (accounts || []).map((a) => ({
    name: String(a.name || '').trim(),
    tier: a.tier === 'ai' ? 'ai' : 'tech',
    mpId: String(a.mpId || '').trim(),
    biz: String(a.biz || '').trim(),
    shareUrl: String(a.shareUrl || '').trim()
  }));
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(list, null, 2), 'utf8');
  return list;
}

function mergeAccountUpdates(updates) {
  const accounts = loadAccounts();
  const byName = new Map(accounts.map((a) => [a.name, a]));
  for (const u of updates || []) {
    const name = String(u.name || '').trim();
    if (!name) continue;
    const cur = byName.get(name) || { name, tier: 'tech', mpId: '', biz: '', shareUrl: '' };
    if (u.tier) cur.tier = u.tier === 'ai' ? 'ai' : 'tech';
    if (u.mpId != null) cur.mpId = String(u.mpId || '').trim();
    if (u.biz != null) cur.biz = String(u.biz || '').trim();
    if (u.shareUrl != null) cur.shareUrl = String(u.shareUrl || '').trim();
    byName.set(name, cur);
  }
  return saveAccounts(Array.from(byName.values()));
}

function getAuthStatus() {
  const auth = loadAuth();
  const accounts = loadAccounts();
  const missingMp = accounts.filter((a) => !a.mpId).map((a) => a.name);
  return {
    mode: 'weread',
    status: auth.status || 'missing',
    updatedAt: auth.updatedAt,
    lastError: auth.lastError || '',
    hasCredentials: Boolean(auth.vid && auth.token),
    username: auth.username || '',
    accountsTotal: accounts.length,
    accountsWithMpId: accounts.filter((a) => a.mpId).length,
    accountsMissingBiz: missingMp,
    accountsMissingMpId: missingMp,
    accounts,
    platformUrl: PLATFORM_URL,
    hint:
      auth.status === 'ok'
        ? `微信读书已授权${auth.username ? ' · ' + auth.username : ''}，可拉取公众号`
        : auth.status === 'expired'
          ? '微信读书登录已失效，请重新扫码'
          : '请使用微信扫码登录「微信读书」账号后拉取公众号'
  };
}

/** 旧接口兼容：若提交的是 weread 字段则保存；忽略 uin/key/cookie */
function saveAuthFromBody(body) {
  const prev = loadAuth();
  if (Array.isArray(body && body.accounts)) {
    mergeAccountUpdates(body.accounts);
  }
  const vid = String((body && (body.vid || body.id)) || prev.vid || '').trim();
  const token = String((body && body.token) || prev.token || '').trim();
  const username = String((body && body.username) || prev.username || '').trim();
  const has = Boolean(vid && token);
  return saveAuth({
    mode: 'weread',
    vid,
    token,
    username,
    status: has ? 'ok' : 'missing',
    updatedAt: new Date().toISOString(),
    lastError: has ? '' : '尚未扫码登录微信读书'
  });
}

function markAuthExpired(errMsg) {
  const auth = loadAuth();
  auth.status = 'expired';
  auth.lastError = String(errMsg || '登录失效').slice(0, 400);
  saveAuth(auth);
  return auth;
}

async function platformFetch(pathname, { method = 'GET', headers = {}, body, timeoutMs = 20000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(PLATFORM_URL + pathname, {
      method,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...headers
      },
      body: body != null ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (_e) {
      data = null;
    }
    return { ok: res.ok, status: res.status, data, text };
  } finally {
    clearTimeout(timer);
  }
}

function authHeaders(auth) {
  return {
    xid: String(auth.vid),
    Authorization: `Bearer ${auth.token}`
  };
}

async function createLoginSession() {
  const res = await platformFetch('/api/v2/login/platform');
  if (!res.ok || !res.data || !res.data.uuid) {
    throw new Error((res.data && res.data.message) || `创建登录失败 HTTP ${res.status}`);
  }
  const uuid = res.data.uuid;
  const scanUrl = res.data.scanUrl || `https://open.weixin.qq.com/connect/confirm?uuid=${uuid}`;
  // 微信官方二维码图，不依赖第三方 QR 服务
  return {
    uuid,
    scanUrl,
    qrImageUrl: `https://open.weixin.qq.com/connect/qrcode/${uuid}`
  };
}

async function pollLoginSession(uuid) {
  const id = String(uuid || '').trim();
  if (!id) throw new Error('缺少 uuid');
  // 控制在常见反代超时（60s）以内，由前端连续轮询
  const res = await platformFetch(`/api/v2/login/platform/${encodeURIComponent(id)}`, {
    timeoutMs: 50000
  });
  const data = res.data || {};
  const message = String(data.message || '');
  if (data.token && (data.vid != null || data.id != null)) {
    const vid = String(data.vid != null ? data.vid : data.id);
    const token = String(data.token);
    const username = String(data.username || '');
    const auth = saveAuth({
      mode: 'weread',
      vid,
      token,
      username,
      status: 'ok',
      updatedAt: new Date().toISOString(),
      lastError: ''
    });
    // 后台尝试按名称匹配核心公众号 mpId（不阻塞登录返回）
    setImmediate(() => {
      ensureAccountMpIds(auth).catch((err) =>
        console.warn('[weread] post-login resolve:', err.message || err)
      );
    });
    return { done: true, message: 'ok', vid, token, username, auth: getAuthStatus() };
  }
  if (/expire|失效|超时|invalid/i.test(message)) {
    return { done: false, expired: true, message: message || '二维码已过期' };
  }
  return { done: false, message: message || 'waiting' };
}

async function searchMpByName(auth, name) {
  const q = encodeURIComponent(name);
  const paths = [
    `/api/v2/platform/mps/search?name=${q}`,
    `/api/v2/platform/mps/search?keyword=${q}`,
    `/api/v2/platform/search/mps?keyword=${q}`
  ];
  for (const p of paths) {
    const res = await platformFetch(p, { headers: authHeaders(auth) });
    if (!res.ok) {
      if (res.status === 401) {
        const err = new Error('WeReadError401');
        err.code = 'AUTH_EXPIRED';
        throw err;
      }
      continue;
    }
    const list = Array.isArray(res.data)
      ? res.data
      : (res.data && (res.data.list || res.data.items || res.data.data)) || [];
    if (!list.length) continue;
    const exact =
      list.find((x) => String(x.name || x.mpName || '') === name) ||
      list.find((x) => String(x.name || x.mpName || '').indexOf(name) >= 0) ||
      list[0];
    const mpId = String(exact.id || exact.mpId || '');
    if (mpId) {
      return {
        mpId,
        name: String(exact.name || exact.mpName || name),
        cover: exact.cover || ''
      };
    }
  }
  return null;
}

async function resolveMpFromShareUrl(auth, shareUrl) {
  const res = await platformFetch('/api/v2/platform/wxs2mp', {
    method: 'POST',
    headers: authHeaders(auth),
    body: { url: String(shareUrl || '').trim() }
  });
  if (!res.ok) {
    if (res.status === 401 || /WeReadError401/i.test(res.text || '')) {
      const err = new Error('WeReadError401');
      err.code = 'AUTH_EXPIRED';
      throw err;
    }
    throw new Error((res.data && res.data.message) || `解析公众号失败 HTTP ${res.status}`);
  }
  const list = Array.isArray(res.data) ? res.data : [];
  const first = list[0];
  if (!first || !first.id) throw new Error('未解析到公众号');
  return { mpId: String(first.id), name: String(first.name || ''), cover: first.cover || '' };
}

async function ensureAccountMpIds(auth) {
  const accounts = loadAccounts();
  let changed = false;

  // 种子 mpId 先写入
  for (const a of accounts) {
    if (!a.mpId && SEED_MP_IDS[a.name]) {
      a.mpId = SEED_MP_IDS[a.name];
      changed = true;
    }
  }
  if (changed) saveAccounts(accounts);

  const helpers = {
    searchMp: async (_auth, name) => searchMpByName(auth, name),
    wxs2mp: async (_auth, url) => resolveMpFromShareUrl(auth, url),
    probeArticles: async (_auth, mpId) => {
      try {
        const rows = await fetchMpArticles(auth, mpId, 1);
        return Array.isArray(rows) ? rows.length : 0;
      } catch (_e) {
        return 0;
      }
    },
    onProgress: (message, pct) => {
      const cur = getPullProgress();
      // 仅在匹配阶段更新进度条；拉文阶段不抢占
      if (cur.phase === 'fetch' || cur.phase === 'done' || cur.phase === 'error') return;
      const matched = accounts.filter((a) => a.mpId).length;
      setPullProgress({
        phase: 'resolve',
        pct: pct != null ? pct : cur.pct,
        message: message || '自动匹配公众号…',
        matched,
        total: accounts.length
      });
    },
    onMatched: () => {
      saveAccounts(accounts);
      changed = true;
      setPullProgress({
        matched: accounts.filter((a) => a.mpId).length,
        total: accounts.length
      });
    }
  };

  // 已有 shareUrl 的优先
  for (const a of accounts) {
    if (a.mpId || !a.shareUrl) continue;
    try {
      const info = await resolveMpFromShareUrl(auth, a.shareUrl);
      a.mpId = info.mpId;
      changed = true;
      saveAccounts(accounts);
    } catch (err) {
      if (err && err.code === 'AUTH_EXPIRED') throw err;
      console.warn(`[weread] shareUrl ${a.name}:`, err.message || err);
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  const need = accounts
    .filter((a) => !a.mpId)
    .sort((a, b) => (a.tier === 'ai' ? 0 : 1) - (b.tier === 'ai' ? 0 : 1));

  // 全量自动匹配全部未绑定公众号（不截断）
  if (need.length) {
    const cur = getPullProgress();
    if (cur.phase !== 'fetch' && cur.phase !== 'done' && cur.phase !== 'error') {
      setPullProgress({
        phase: 'resolve',
        pct: 8,
        message: `自动匹配全部公众号（0/${need.length}）…`
      });
    }
    try {
      const { results } = await autoResolveAccounts(auth, accounts, helpers);
      if ((results || []).some((r) => r.mpId)) changed = true;
    } catch (err) {
      if (err && err.code === 'AUTH_EXPIRED') throw err;
      console.warn('[weread] autoResolve:', err.message || err);
    }
  }

  if (changed) saveAccounts(accounts);
  const matched = accounts.filter((a) => a.mpId).length;
  setPullProgress({
    phase: 'resolve',
    pct: 22,
    message: `已匹配 ${matched}/${accounts.length} 个公众号，开始拉取…`,
    matched,
    total: accounts.length
  });
  return accounts;
}

function makeItem({ title, url, source, sourceId, summary, image, publishedAt, rank }) {
  const now = new Date().toISOString();
  let pub = now;
  if (publishedAt) {
    const t = Date.parse(publishedAt);
    if (!Number.isNaN(t)) pub = new Date(t).toISOString();
  }
  const link = url || `https://weread.qq.com`;
  return {
    id: makeId(`weread:${link}:${title}`),
    title: String(title).slice(0, 240),
    summary: String(summary || '').slice(0, 320),
    contentHtml: '',
    image: image || '',
    sourceId,
    source,
    channel: 'wechat-mirror',
    url: link,
    rank: rank != null ? rank : null,
    heatHint: '',
    publishedAt: pub,
    collectedAt: now
  };
}

function keepItem(it, tier) {
  if (isContentNoise(it.title, it.summary)) return false;
  if (!it.publishedAt || !isTodayOrYesterday(it.publishedAt)) return false;
  if (tier === 'ai') return true;
  return hasTechOrProductSignal(it.title, it.summary);
}

async function fetchMpArticles(auth, mpId, page = 1) {
  const res = await platformFetch(
    `/api/v2/platform/mps/${encodeURIComponent(mpId)}/articles?page=${page}`,
    { headers: authHeaders(auth) }
  );
  if (!res.ok) {
    if (res.status === 401 || /WeReadError401/i.test(res.text || '')) {
      const err = new Error('WeReadError401');
      err.code = 'AUTH_EXPIRED';
      throw err;
    }
    throw new Error((res.data && res.data.message) || `拉文章失败 HTTP ${res.status}`);
  }
  return Array.isArray(res.data) ? res.data : [];
}

async function collectWechatDirect() {
  setPullProgress({ phase: 'start', pct: 5, message: '检查登录状态…', count: 0, error: '' });
  const auth = loadAuth();
  if (!auth.vid || !auth.token) {
    if (auth.status !== 'missing') {
      auth.status = 'missing';
      auth.lastError = '尚未扫码登录微信读书';
      saveAuth(auth);
    }
    setPullProgress({ phase: 'error', pct: 0, message: '尚未登录', error: 'missing weread login' });
    return {
      ok: false,
      source: 'wechat-direct',
      count: 0,
      items: [],
      error: 'missing weread login'
    };
  }

  // 每次点击：对名单中全部公众号做匹配 + 拉取（不截断）
  let accounts = loadAccounts();
  const total = accounts.length;
  setPullProgress({
    phase: 'resolve',
    pct: 8,
    message: `全量匹配 ${total} 个公众号…`,
    count: 0,
    matched: accounts.filter((a) => a.mpId).length,
    total
  });

  try {
    await ensureAccountMpIds(auth);
  } catch (err) {
    if (err && err.code === 'AUTH_EXPIRED') {
      markAuthExpired(err.message);
      setPullProgress({ phase: 'error', pct: 0, message: '登录已失效', error: 'auth expired' });
      return { ok: false, source: 'wechat-direct', count: 0, items: [], error: 'auth expired' };
    }
    console.warn('[weread] ensureAccountMpIds:', err.message || err);
  }

  accounts = loadAccounts();
  const resolveHelpers = {
    searchMp: async (_auth, name) => searchMpByName(auth, name),
    wxs2mp: async (_auth, url) => resolveMpFromShareUrl(auth, url),
    probeArticles: async (_auth, mpId) => {
      try {
        const rows = await fetchMpArticles(auth, mpId, 1);
        return Array.isArray(rows) ? rows.length : 0;
      } catch (_e) {
        return 0;
      }
    }
  };

  const items = [];
  let fetchedAccounts = 0;
  try {
    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i];
      const pct = 18 + Math.floor((i / Math.max(1, accounts.length)) * 77);
      setPullProgress({
        phase: 'fetch',
        pct,
        message: `处理 ${account.name}（${i + 1}/${accounts.length}）…`,
        count: items.length,
        matched: accounts.filter((a) => a.mpId).length,
        total: accounts.length
      });

      if (!account.mpId) {
        try {
          const info = await resolveOneAccount(auth, account.name, resolveHelpers);
          if (info && info.mpId) {
            account.mpId = info.mpId;
            if (info.shareUrl) account.shareUrl = info.shareUrl;
            if (info.biz) account.biz = info.biz;
            saveAccounts(accounts);
          }
        } catch (err) {
          if (err && err.code === 'AUTH_EXPIRED') throw err;
          console.warn(`[weread] resolve ${account.name}:`, err.message || err);
        }
      }

      if (!account.mpId) continue;

      setPullProgress({
        phase: 'fetch',
        pct,
        message: `拉取 ${account.name}（${i + 1}/${accounts.length}）…`,
        count: items.length,
        matched: accounts.filter((a) => a.mpId).length,
        total: accounts.length
      });

      try {
        const rows = await fetchMpArticles(auth, account.mpId, 1);
        fetchedAccounts += 1;
        let rank = 1;
        for (const row of rows) {
          const publishTime = Number(row.publishTime || row.publish_time || 0);
          if (!publishTime) continue;
          const publishedAt =
            publishTime > 1e12
              ? new Date(publishTime).toISOString()
              : new Date(publishTime * 1000).toISOString();
          if (!isTodayOrYesterday(publishedAt)) continue;
          const title = String(row.title || '').trim();
          if (!title) continue;
          const url =
            row.url ||
            row.link ||
            (row.id ? `https://mp.weixin.qq.com/s/${row.id}` : '') ||
            `https://weread.qq.com/web/book/read?mpId=${encodeURIComponent(account.mpId)}`;
          const it = makeItem({
            title,
            url,
            source: account.name,
            sourceId: `wechat-direct-${String(account.mpId).slice(0, 16)}`,
            summary: '',
            image: row.picUrl || row.cover || '',
            publishedAt,
            rank: rank++
          });
          if (keepItem(it, account.tier)) items.push(it);
        }
      } catch (err) {
        if (err && err.code === 'AUTH_EXPIRED') throw err;
        console.warn(`[weread] articles ${account.name}:`, err.message || err);
      }
      await new Promise((r) => setTimeout(r, 600));
    }
  } catch (err) {
    if (err && err.code === 'AUTH_EXPIRED') {
      markAuthExpired(err.message);
      setPullProgress({ phase: 'error', pct: 0, message: '登录已失效', error: 'auth expired' });
      return { ok: false, source: 'wechat-direct', count: 0, items: [], error: 'auth expired' };
    }
    setPullProgress({ phase: 'error', pct: 0, message: err.message || String(err), error: 'fetch' });
    throw err;
  }

  if (auth.status !== 'ok') {
    auth.status = 'ok';
    auth.lastError = '';
    auth.updatedAt = new Date().toISOString();
    saveAuth(auth);
  }

  setPullProgress({
    phase: 'done',
    pct: 100,
    message: items.length
      ? `已处理 ${accounts.length} 个号 · 拉取 ${fetchedAccounts} 个 · ${items.length} 条（当天+昨天）`
      : `已处理 ${accounts.length} 个号 · 当天与昨天暂无匹配文章`,
    count: items.length,
    matched: accounts.filter((a) => a.mpId).length,
    total: accounts.length,
    error: items.length ? '' : 'no articles in today/yesterday'
  });

  return {
    ok: items.length > 0,
    source: 'wechat-direct',
    count: items.length,
    items,
    error: items.length ? '' : 'no articles in today/yesterday'
  };
}

/** 用一篇分享链接绑定某个核心号的 mpId */
async function bindAccountByShareUrl(name, shareUrl) {
  const auth = loadAuth();
  if (!auth.vid || !auth.token) throw new Error('请先扫码登录微信读书');
  const info = await resolveMpFromShareUrl(auth, shareUrl);
  mergeAccountUpdates([{ name, mpId: info.mpId, shareUrl }]);
  return { ...info, auth: getAuthStatus() };
}

/** 批量粘贴分享链接：按返回的公众号名自动匹配核心名单 */
async function bindAccountsByShareUrls(shareUrls) {
  const auth = loadAuth();
  if (!auth.vid || !auth.token) throw new Error('请先扫码登录微信读书');
  const urls = (shareUrls || []).map((u) => String(u || '').trim()).filter(Boolean);
  if (!urls.length) throw new Error('请粘贴至少一条公众号文章分享链接');
  const accounts = loadAccounts();
  const bound = [];
  setPullProgress({ phase: 'resolve', pct: 10, message: '解析分享链接…', count: 0, error: '' });
  for (let i = 0; i < urls.length; i++) {
    const shareUrl = urls[i];
    setPullProgress({
      phase: 'resolve',
      pct: 10 + Math.floor((i / urls.length) * 40),
      message: `解析链接 ${i + 1}/${urls.length}…`
    });
    try {
      const info = await resolveMpFromShareUrl(auth, shareUrl);
      const exact =
        accounts.find((a) => a.name === info.name) ||
        accounts.find((a) => info.name && a.name.indexOf(info.name) >= 0) ||
        accounts.find((a) => info.name && info.name.indexOf(a.name) >= 0);
      if (exact) {
        exact.mpId = info.mpId;
        exact.shareUrl = shareUrl;
        bound.push({ name: exact.name, mpId: info.mpId, resolvedName: info.name });
      } else {
        // 不在核心名单也写入，便于展示
        accounts.push({
          name: info.name || `未命名${i + 1}`,
          tier: 'tech',
          mpId: info.mpId,
          biz: '',
          shareUrl
        });
        bound.push({ name: info.name, mpId: info.mpId, resolvedName: info.name, extra: true });
      }
    } catch (err) {
      if (err && err.code === 'AUTH_EXPIRED') {
        markAuthExpired(err.message);
        throw err;
      }
      console.warn('[weread] bind url fail:', err.message || err);
      bound.push({ shareUrl, error: err.message || String(err) });
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  saveAccounts(accounts);
  return { bound, auth: getAuthStatus() };
}

module.exports = {
  DEFAULT_ACCOUNTS,
  WECHAT_HEAD_ACCOUNTS: DEFAULT_ACCOUNTS,
  getAuthStatus,
  saveAuthFromBody,
  loadAuth,
  loadAccounts,
  saveAccounts,
  mergeAccountUpdates,
  mergeAccountBizUpdates: mergeAccountUpdates,
  markAuthExpired,
  collectWechatDirect,
  createLoginSession,
  pollLoginSession,
  bindAccountByShareUrl,
  bindAccountsByShareUrls,
  getPullProgress,
  setPullProgress,
  isWithinLastDays,
  isTodayOrYesterday,
  PLATFORM_URL
};
