const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const {
  readDay,
  findById,
  listLast14DateOptions,
  todayKey,
  purgeExpired,
  patchResearchItem,
  findLatestBooks,
  findLatestSection,
  upsertHotspotsToday,
  RETENTION_DAYS
} = require('./store');
const { enrichOneZh, needsPaperZh, needsGithubZh } = require('./translate-research');
const {
  explainOneTerm,
  cacheExplainOnWordcloud,
  deleteWordFromCloud
} = require('./wordcloud');
const {
  getAuthStatus,
  saveAuthFromBody,
  collectWechatDirect,
  createLoginSession,
  pollLoginSession,
  bindAccountByShareUrl,
  bindAccountsByShareUrls,
  getPullProgress,
  setPullProgress
} = require('./wechat-direct');
const { collectHotspots } = require('./hot-sources');
const { generateTopicPlan } = require('./books');

let wechatRefreshRunning = false;

const app = express();
const PORT = Number(process.env.PORT || 3001);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const IMG_CACHE = path.join(DATA_DIR, 'imgcache');

if (!fs.existsSync(IMG_CACHE)) fs.mkdirSync(IMG_CACHE, { recursive: true });

app.disable('x-powered-by');
app.use(express.json({ limit: '512kb' }));

function isSafeImageUrl(raw) {
  try {
    const u = new URL(String(raw || ''));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    if (!u.hostname) return false;
    return true;
  } catch (_e) {
    return false;
  }
}

function cacheKey(url) {
  return crypto.createHash('sha1').update(String(url)).digest('hex');
}

function extFromContentType(ct, url) {
  const t = String(ct || '').toLowerCase();
  if (t.includes('png')) return '.png';
  if (t.includes('webp')) return '.webp';
  if (t.includes('gif')) return '.gif';
  if (t.includes('jpeg') || t.includes('jpg')) return '.jpg';
  const m = String(url).toLowerCase().match(/\.(png|jpe?g|webp|gif)(?:\?|$)/);
  return m ? `.${m[1].replace('jpeg', 'jpg')}` : '.jpg';
}

async function fetchImage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
      }
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const ct = res.headers.get('content-type') || 'image/jpeg';
    if (!/^image\//i.test(ct) && !/octet-stream/i.test(ct)) {
      throw new Error(`not image: ${ct}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100 || buf.length > 8 * 1024 * 1024) {
      throw new Error(`bad size ${buf.length}`);
    }
    return { buf, contentType: ct.startsWith('image/') ? ct : 'image/jpeg' };
  } finally {
    clearTimeout(timer);
  }
}

function mapListItem(it) {
  return {
    id: it.id,
    title: it.title,
    summary: it.summary,
    image: it.image || '',
    source: it.source,
    sourceId: it.sourceId,
    channel: it.channel || '',
    heatHint: it.heatHint || '',
    rank: it.rank != null ? it.rank : null,
    url: it.url,
    publishedAt: it.publishedAt,
    collectedAt: it.collectedAt
  };
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'technews',
    retentionDays: RETENTION_DAYS,
    features: ['news', 'hotspots', 'papers', 'github', 'wordcloud', 'books', 'wechat-auth']
  });
});

app.get('/api/dates', (_req, res) => {
  purgeExpired();
  res.json({
    today: todayKey(),
    retentionDays: RETENTION_DAYS,
    dates: listLast14DateOptions()
  });
});

app.get('/api/news', (req, res) => {
  purgeExpired();
  const date = String(req.query.date || todayKey());
  const day = readDay(date);
  const items = day.items.map(mapListItem);
  res.json({
    date,
    updatedAt: day.updatedAt,
    count: items.length,
    items
  });
});

app.get('/api/hotspots', (req, res) => {
  purgeExpired();
  const date = String(req.query.date || todayKey());
  const day = readDay(date);
  const items = day.hotspots.map(mapListItem);
  res.json({
    date,
    updatedAt: day.updatedAt,
    count: items.length,
    items
  });
});

app.get('/api/papers', (req, res) => {
  purgeExpired();
  const date = String(req.query.date || todayKey());
  const day = readDay(date);
  let papers = day.papers;
  let sourceDate = date;
  let carriedForward = false;
  if (!papers || !Array.isArray(papers.items) || !papers.items.length) {
    const latest = findLatestSection('papers');
    if (latest) {
      papers = latest.data;
      sourceDate = latest.date;
      carriedForward = sourceDate !== date;
    } else {
      papers = { items: [], note: '暂无论文数据', updatedAt: null };
    }
  }
  res.json({ date, sourceDate, carriedForward, papers });
});

app.get('/api/github', (req, res) => {
  purgeExpired();
  const date = String(req.query.date || todayKey());
  const day = readDay(date);
  let github = day.github;
  let sourceDate = date;
  let carriedForward = false;
  const hasList =
    github &&
    ((Array.isArray(github.items) && github.items.length) ||
      (Array.isArray(github.topStars) && github.topStars.length) ||
      (Array.isArray(github.weeklyRising) && github.weeklyRising.length));
  if (!hasList) {
    const latest = findLatestSection('github');
    if (latest) {
      github = latest.data;
      sourceDate = latest.date;
      carriedForward = sourceDate !== date;
    } else {
      github = {
        items: [],
        topStars: [],
        weeklyRising: [],
        note: '暂无 GitHub 热点',
        updatedAt: null
      };
    }
  }
  res.json({ date, sourceDate, carriedForward, github });
});

app.get('/api/wordcloud', (req, res) => {
  purgeExpired();
  const date = String(req.query.date || todayKey());
  const day = readDay(date);
  res.json({
    date,
    wordcloud: day.wordcloud || {
      words: [],
      candidates: [],
      note: '暂无词云，请等待采集任务生成',
      updatedAt: null
    }
  });
});

app.post('/api/wordcloud/explain', async (req, res) => {
  try {
    const term = String((req.body && req.body.term) || '').trim();
    const date = String((req.body && req.body.date) || todayKey());
    if (!term) return res.status(400).json({ error: '缺少 term' });
    const day = readDay(date);
    // 已有缓存则直接返回
    const cached = ((day.wordcloud && day.wordcloud.words) || []).find(
      (w) => String(w.term || '').toLowerCase() === term.toLowerCase() && w.explain
    );
    if (cached && cached.explain) {
      return res.json({ term: cached.term, explain: cached.explain, cached: true });
    }
    const result = await explainOneTerm(term, day);
    cacheExplainOnWordcloud(date, result.term, result.explain);
    res.json({ term: result.term, explain: result.explain, cached: false, meta: result.meta });
  } catch (err) {
    console.error('[api] wordcloud explain fail:', err.message || err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.post('/api/wordcloud/delete', (req, res) => {
  try {
    const term = String((req.body && req.body.term) || '').trim();
    const date = String((req.body && req.body.date) || todayKey());
    if (!term) return res.status(400).json({ error: '缺少 term' });
    const wordcloud = deleteWordFromCloud(date, term);
    res.json({ date, wordcloud });
  } catch (err) {
    console.error('[api] wordcloud delete fail:', err.message || err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.get('/api/books', (req, res) => {
  purgeExpired();
  const date = String(req.query.date || todayKey());
  const day = readDay(date);
  let books = day.books;
  let sourceDate = date;
  let carriedForward = false;
  const empty =
    !books ||
    (!(books.bestsellers && books.bestsellers.length) &&
      !(books.planning && books.planning.length) &&
      !String(books.analysis || '').trim());
  if (empty) {
    const latest = findLatestBooks();
    if (latest) {
      books = latest.books;
      sourceDate = latest.date;
      carriedForward = sourceDate !== date;
    } else {
      books = {
        bestsellers: [],
        categories: [],
        analysis: '',
        planning: [],
        note: '暂无图书洞察，请等待采集任务生成',
        updatedAt: null
      };
    }
  }
  res.json({ date, sourceDate, carriedForward, books });
});

app.post('/api/books/plan', async (req, res) => {
  try {
    const input = String((req.body && req.body.input) || '').trim();
    if (!input) return res.status(400).json({ error: '请输入选题线索' });
    const plan = await generateTopicPlan(input);
    res.json({ ok: true, plan });
  } catch (err) {
    console.error('[api] books plan fail:', err.message || err);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || String(err) });
  }
});

app.get('/api/wechat-auth/status', (_req, res) => {
  try {
    res.json(getAuthStatus());
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.post('/api/wechat-auth/login/start', async (_req, res) => {
  try {
    const session = await createLoginSession();
    res.json({ ok: true, ...session });
  } catch (err) {
    console.error('[api] wechat login start fail:', err.message || err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.get('/api/wechat-auth/login/poll', async (req, res) => {
  try {
    const uuid = String(req.query.uuid || '').trim();
    if (!uuid) return res.status(400).json({ error: '缺少 uuid' });
    const result = await pollLoginSession(uuid);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[api] wechat login poll fail:', err.message || err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.post('/api/wechat-auth/bind', async (req, res) => {
  try {
    const name = String((req.body && req.body.name) || '').trim();
    const shareUrl = String((req.body && req.body.shareUrl) || '').trim();
    const shareUrls = Array.isArray(req.body && req.body.shareUrls) ? req.body.shareUrls : null;
    if (shareUrls && shareUrls.length) {
      const result = await bindAccountsByShareUrls(shareUrls);
      return res.json({ ok: true, ...result });
    }
    if (!name || !shareUrl) return res.status(400).json({ error: '需要 name 与 shareUrl，或 shareUrls 数组' });
    const result = await bindAccountByShareUrl(name, shareUrl);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[api] wechat bind fail:', err.message || err);
    res.status(500).json({ error: err.message || String(err), auth: getAuthStatus() });
  }
});

app.get('/api/wechat-auth/progress', (_req, res) => {
  try {
    res.json(getPullProgress());
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.post('/api/wechat-auth', (req, res) => {
  try {
    const auth = saveAuthFromBody(req.body || {});
    res.json({ ok: true, auth: getAuthStatus(), saved: { status: auth.status, updatedAt: auth.updatedAt } });
  } catch (err) {
    console.error('[api] wechat-auth save fail:', err.message || err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.post('/api/wechat-refresh', async (req, res) => {
  try {
    const mode = String((req.body && req.body.mode) || 'direct');
    const background = req.body && req.body.background === false ? false : true;

    if (mode === 'full' && !background) {
      setPullProgress({ phase: 'full', pct: 8, message: '正在汇总全部热点…', count: 0, error: '' });
      const hot = await collectHotspots();
      const result = upsertHotspotsToday(hot.items);
      setPullProgress({
        phase: 'done',
        pct: 100,
        message: `热点已更新 · ${(hot.items || []).length} 条`,
        count: (hot.items || []).length,
        error: ''
      });
      return res.json({
        ok: true,
        mode: 'full',
        count: (hot.items || []).length,
        saved: result,
        auth: getAuthStatus(),
        progress: getPullProgress()
      });
    }

    // 默认后台拉取：立即返回，不阻塞前端阅读
    if (wechatRefreshRunning) {
      return res.json({
        ok: true,
        started: false,
        running: true,
        mode,
        auth: getAuthStatus(),
        progress: getPullProgress()
      });
    }

    wechatRefreshRunning = true;
    setPullProgress({
      phase: 'start',
      pct: 2,
      message: '后台拉取已开始（可继续阅读）…',
      count: 0,
      error: ''
    });

    setImmediate(async () => {
      try {
        if (mode === 'full') {
          setPullProgress({ phase: 'full', pct: 8, message: '正在汇总全部热点…', count: 0, error: '' });
          const hot = await collectHotspots();
          upsertHotspotsToday(hot.items);
          setPullProgress({
            phase: 'done',
            pct: 100,
            message: `热点已更新 · ${(hot.items || []).length} 条`,
            count: (hot.items || []).length,
            error: ''
          });
        } else {
          const direct = await collectWechatDirect();
          const day = readDay(todayKey());
          const kept = (day.hotspots || []).filter(
            (it) => !(it.sourceId || '').startsWith('wechat-direct-')
          );
          const merged = kept.concat(direct.items || []);
          upsertHotspotsToday(merged);
          setPullProgress({
            phase: 'done',
            pct: 100,
            message: direct.count
              ? `已拉取 ${direct.count} 条（当天+昨天）`
              : direct.error || '当天与昨天暂无匹配文章',
            count: direct.count || 0,
            error: direct.error || ''
          });
          // 稍后回到 idle，避免刷新页面仍被当成进行中
          setTimeout(() => {
            if (getPullProgress().phase === 'done' || getPullProgress().phase === 'error') {
              setPullProgress({ phase: 'idle', pct: 0, message: '', error: '' });
            }
          }, 8000);
        }
      } catch (err) {
        console.error('[api] wechat-refresh background fail:', err.message || err);
        setPullProgress({
          phase: 'error',
          pct: 0,
          message: err.message || String(err),
          error: 'refresh'
        });
      } finally {
        wechatRefreshRunning = false;
      }
    });

    res.json({
      ok: true,
      started: true,
      running: true,
      mode,
      auth: getAuthStatus(),
      progress: getPullProgress()
    });
  } catch (err) {
    console.error('[api] wechat-refresh fail:', err.message || err);
    wechatRefreshRunning = false;
    setPullProgress({
      phase: 'error',
      pct: 0,
      message: err.message || String(err),
      error: 'refresh'
    });
    res.status(500).json({ error: err.message || String(err), auth: getAuthStatus() });
  }
});

app.get('/api/news/:id', async (req, res) => {
  let item = findById(req.params.id);
  if (!item) return res.status(404).json({ error: '内容不存在或已过期' });

  const isPaper = item.category === 'paper';
  const isGithub = item.category === 'github';
  if (isPaper || isGithub) {
    const need = isPaper ? needsPaperZh(item) : needsGithubZh(item);
    if (need) {
      try {
        const enriched = await enrichOneZh(item);
        const patch = {};
        if (enriched.titleZh) patch.titleZh = enriched.titleZh;
        if (enriched.summaryZh) patch.summaryZh = enriched.summaryZh;
        if (Object.keys(patch).length) {
          const saved = patchResearchItem(item.collectedDate, item.category, item.id, patch);
          item = saved
            ? { ...saved, collectedDate: item.collectedDate, category: item.category }
            : { ...item, ...patch };
        }
      } catch (err) {
        console.error('[detail] zh translate fail:', err.message || err);
      }
    }
  }

  res.json({ item });
});

app.get('/api/img', async (req, res) => {
  const url = String(req.query.u || '');
  if (!isSafeImageUrl(url)) return res.status(400).send('bad url');

  const key = cacheKey(url);
  const existing = fs.readdirSync(IMG_CACHE).find((f) => f.startsWith(key + '.'));
  if (existing) {
    const full = path.join(IMG_CACHE, existing);
    const ext = path.extname(existing).toLowerCase();
    const type =
      ext === '.png'
        ? 'image/png'
        : ext === '.webp'
          ? 'image/webp'
          : ext === '.gif'
            ? 'image/gif'
            : 'image/jpeg';
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Content-Type', type);
    return res.sendFile(full);
  }

  try {
    const { buf, contentType } = await fetchImage(url);
    const ext = extFromContentType(contentType, url);
    const file = path.join(IMG_CACHE, key + ext);
    fs.writeFileSync(file, buf);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Content-Type', contentType);
    return res.send(buf);
  } catch (err) {
    res.status(502).json({ error: 'image fetch failed', detail: String(err.message || err) });
  }
});

app.use(
  express.static(path.join(__dirname, 'public'), {
    etag: true,
    maxAge: 0,
    setHeaders(res, filePath) {
      if (/\.(html|js|css)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      }
    }
  })
);

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Technews listening on http://127.0.0.1:${PORT}`);
});
