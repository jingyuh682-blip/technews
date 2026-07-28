(function () {
  const BASE = '/technews';
  const app = document.getElementById('app');
  const TABS = [
    { id: 'news', label: '科技新闻' },
    { id: 'hot', label: '科技热点' },
    { id: 'papers', label: '论文热点' },
    { id: 'github', label: 'GitHub' },
    { id: 'cloud', label: '热点词云' },
    { id: 'books', label: '图书洞察' }
  ];

  function qs(sel, el = document) { return el.querySelector(sel); }

  function formatTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${mm}-${dd} ${hh}:${mi}`;
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function proxyImage(url) {
    if (!url) return '';
    if (String(url).startsWith(BASE + '/api/img')) return url;
    return BASE + '/api/img?u=' + encodeURIComponent(url);
  }

  /** 把搜狗加密 token / 相对链修成可外跳的绝对地址，避免点成站内 technews 页 */
  function externalArticleUrl(url) {
    let u = String(url || '').trim();
    if (!u || /^(javascript:|#)/i.test(u)) return '';
    if (u.startsWith('//')) u = 'https:' + u;
    if (/^https?:\/\/(mp\.weixin\.qq\.com|weixin\.sogou\.com)\//i.test(u)) return u;
    if (/^\/?link\?url=/i.test(u)) return 'https://weixin.sogou.com/' + u.replace(/^\//, '');
    if (/weixin\.sogou\.com\/link/i.test(u)) return u;
    if (!/^https?:\/\//i.test(u) && (/^dn9a_/i.test(u) || /^[A-Za-z0-9_=~+\-]{60,}$/.test(u))) {
      return 'https://weixin.sogou.com/link?url=' + encodeURIComponent(u);
    }
    if (/^https?:\/\//i.test(u)) return u;
    return '';
  }

  function rewriteContentImages(html) {
    return String(html || '').replace(/<img\b([^>]*?)src=(["'])([^"']+)\2/gi, function (_m, attrs, q, src) {
      if (!src || src.indexOf('/api/img') >= 0) return _m;
      return '<img' + attrs + 'src="' + proxyImage(src) + '" referrerpolicy="no-referrer"';
    });
  }

  function parseRoute() {
    const path = location.pathname.replace(/\/+$/, '') || '/';
    const m = path.match(/\/technews\/article\/([a-z0-9]+)$/i);
    if (m) return { name: 'detail', id: m[1] };
    return { name: 'home' };
  }

  function getQuery(name) {
    return new URL(location.href).searchParams.get(name) || '';
  }

  function setQuery(patch, replace = false) {
    const u = new URL(location.href);
    Object.keys(patch).forEach((k) => {
      if (patch[k] == null || patch[k] === '') u.searchParams.delete(k);
      else u.searchParams.set(k, patch[k]);
    });
    history[replace ? 'replaceState' : 'pushState']({}, '', u.pathname + u.search + u.hash);
  }

  async function api(path) {
    const res = await fetch(BASE + path, { headers: { Accept: 'application/json' } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('请求失败 ' + res.status));
    return data;
  }

  function shell(inner) {
    return `<div class="app-shell">${inner}</div>`;
  }

  function renderLoading(msg, activeTab) {
    const tab = activeTab || getQuery('tab') || 'news';
    app.innerHTML = shell(`
      <header class="topbar">
        <div class="brand">Tech Publishing Assistant</div>
      </header>
      ${tabsHtml(tab)}
      <div class="loading">${escapeHtml(msg || '加载中…')}</div>
    `);
    document.querySelectorAll('.tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        setQuery({ tab: btn.getAttribute('data-tab'), date: getQuery('date') || undefined });
        route();
      });
    });
  }

  function channelLabel(ch) {
    const map = {
      zhihu: '知乎',
      hotsearch: '热搜',
      'wechat-mirror': '公众号',
      'video-proxy': '视频号代理',
      paper: '论文',
      github: 'GitHub'
    };
    return map[ch] || '';
  }

  function thumbHtml(item) {
    if (item.image) {
      const src = escapeHtml(proxyImage(item.image));
      return `<img class="thumb" src="${src}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML='<div class=\\'thumb placeholder\\'>AI</div>'" />`;
    }
    return `<div class="thumb placeholder">AI</div>`;
  }

  function tabsHtml(active) {
    return `<nav class="tabs" role="tablist">${TABS.map((t) =>
      `<button type="button" class="tab ${t.id === active ? 'active' : ''}" data-tab="${t.id}" role="tab" aria-selected="${t.id === active}">${t.label}</button>`
    ).join('')}</nav>`;
  }

  function headerHtml(datesData, date, activeTab) {
    const options = (datesData.dates || []).map((d) => {
      return `<option value="${d.date}" ${d.date === date ? 'selected' : ''}>${d.date}</option>`;
    }).join('');
    return `
      <header class="topbar">
        <div class="brand">Tech Publishing Assistant</div>
        <div class="controls">
          <label class="field">选择日期（近 14 天）
            <select id="dateSelect">${options}</select>
          </label>
          <button class="refresh" type="button" id="reloadBtn">刷新</button>
        </div>
      </header>
      ${tabsHtml(activeTab)}
    `;
  }

  function bindCommon(date, tab) {
    qs('#dateSelect').addEventListener('change', (e) => {
      setQuery({ date: e.target.value, tab });
      route();
    });
    qs('#reloadBtn').addEventListener('click', () => route());
    document.querySelectorAll('.tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        setQuery({ date, tab: btn.getAttribute('data-tab') });
        route();
      });
    });
  }

  function cardsHtml(items, date) {
    return (items || []).map((item, idx) => {
      const ch = channelLabel(item.channel);
      return `
      <a class="card" href="${BASE}/article/${encodeURIComponent(item.id)}?date=${encodeURIComponent(date)}&tab=${encodeURIComponent(getQuery('tab') || 'news')}" style="animation-delay:${Math.min(idx, 12) * 30}ms">
        ${thumbHtml(item)}
        <div class="card-body">
          <h2>${escapeHtml(item.title)}</h2>
          <p>${escapeHtml(item.summary || '')}</p>
          <div class="card-meta">
            <span class="source-pill">${escapeHtml(item.source || '')}</span>
            ${ch ? `<span class="channel-pill">${escapeHtml(ch)}</span>` : ''}
            ${item.rank != null ? `<span>排名 ${escapeHtml(String(item.rank))}</span>` : ''}
            <span>${escapeHtml(formatTime(item.publishedAt))}</span>
          </div>
        </div>
      </a>`;
    }).join('');
  }

  async function renderNewsOrHot(tab) {
    renderLoading(tab === 'hot' ? '正在汇总科技热点…' : '正在汇总科技新闻…', tab);
    try {
      const datesData = await api('/api/dates');
      let date = getQuery('date') || datesData.today;
      const valid = (datesData.dates || []).some((d) => d.date === date);
      if (!valid) date = datesData.today;
      if (!getQuery('date')) setQuery({ date, tab }, true);

      const endpoint = tab === 'hot' ? '/api/hotspots?date=' : '/api/news?date=';
      const news = await api(endpoint + encodeURIComponent(date));
      let wechatAuthHtml = '';
      if (tab === 'hot') {
        try {
          const st = await api('/api/wechat-auth/status');
          wechatAuthHtml = wechatAuthPanelHtml(st);
        } catch (_e) {
          wechatAuthHtml = '';
        }
      }
      app.innerHTML = shell(`
        ${headerHtml(datesData, date, tab)}
        ${wechatAuthHtml}
        <p class="meta-line">${escapeHtml(date)} · 共 ${news.count || 0} 条${news.updatedAt ? ' · 更新于 ' + formatTime(news.updatedAt) : ''}</p>
        <section class="list">
          ${cardsHtml(news.items, date) || `<div class="empty">${tab === 'hot' ? '这一天还没有热点，稍后再来或换一天看看。' : '这一天还没有汇总新闻，稍后再来或换一天看看。'}</div>`}
        </section>
      `);
      bindCommon(date, tab);
      if (tab === 'hot') bindWechatAuthPanel(date);
    } catch (err) {
      app.innerHTML = shell(`<div class="error">${escapeHtml(err.message || String(err))}</div>`);
    }
  }

  function isMobileUa() {
    return /Android|iPhone|iPad|iPod|Mobile|MicroMessenger/i.test(navigator.userAgent || '');
  }

  const WX_PENDING_KEY = 'technews_weread_uuid';
  const WX_AUTOPULL_KEY = 'technews_weread_autopull';

  function wechatAuthPanelHtml(st) {
    const status = (st && st.status) || 'missing';
    const needAction = status !== 'ok';
    const mobile = isMobileUa();
    return `
      <section class="wx-auth-panel ${needAction ? 'warn' : 'ok'}" id="wxAuthPanel">
        <div class="wx-auth-actions-row">
          <button type="button" class="wx-auth-toggle" id="wxAuthStart">
            ${needAction ? (mobile ? '微信登录' : '扫码授权') : (mobile ? '重新登录' : '重新扫码')}
          </button>
          ${
            !needAction
              ? `<button type="button" class="wx-auth-pull" id="wxAuthPull">后台拉取全部公众号</button>`
              : ''
          }
        </div>
        <div class="wx-bg-progress" id="wxBgProgress">
          <div class="wx-bg-progress-track"><i id="wxBgProgressBar" style="width:0%"></i></div>
          <span class="wx-bg-progress-text" id="wxBgProgressText">${
            needAction ? '请先扫码授权' : '待命 · 点击上方按钮开始全量拉取'
          }</span>
        </div>
        <p class="wx-auth-msg muted" id="wxAuthMsg" hidden></p>
      </section>
    `;
  }

  function ensureWxOverlay() {
    let el = document.getElementById('wxOverlay');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'wxOverlay';
    el.className = 'wx-overlay';
    el.hidden = true;
    el.innerHTML = `
      <div class="wx-overlay-card" role="dialog" aria-modal="true">
        <button type="button" class="wx-overlay-close" id="wxOverlayClose" aria-label="关闭">×</button>
        <div id="wxOverlayBody"></div>
      </div>
    `;
    document.body.appendChild(el);
    el.addEventListener('click', (e) => {
      if (e.target === el) hideWxOverlay();
    });
    const closeBtn = el.querySelector('#wxOverlayClose');
    if (closeBtn) closeBtn.addEventListener('click', hideWxOverlay);
    return el;
  }

  function showWxOverlay(html, { closable = true } = {}) {
    const el = ensureWxOverlay();
    const body = el.querySelector('#wxOverlayBody');
    const closeBtn = el.querySelector('#wxOverlayClose');
    if (body) body.innerHTML = html;
    if (closeBtn) closeBtn.hidden = !closable;
    el.hidden = false;
    document.body.classList.add('wx-overlay-open');
  }

  function hideWxOverlay() {
    const el = document.getElementById('wxOverlay');
    if (el) el.hidden = true;
    document.body.classList.remove('wx-overlay-open');
  }

  function ensureWxDock() {
    let el = document.getElementById('wxPullDock');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'wxPullDock';
    el.className = 'wx-pull-dock';
    el.hidden = true;
    el.innerHTML = `
      <div class="wx-pull-dock-inner">
        <div class="wx-bg-progress-track"><i id="wxDockBar"></i></div>
        <span id="wxDockText">后台拉取中…</span>
      </div>
    `;
    document.body.appendChild(el);
    return el;
  }

  function setBgProgress(pct, text) {
    const p = Math.max(0, Math.min(100, Number(pct) || 0));
    const panel = qs('#wxBgProgress');
    const bar = qs('#wxBgProgressBar');
    const label = qs('#wxBgProgressText');
    if (panel) panel.hidden = false;
    if (bar) bar.style.width = p + '%';
    if (label) label.textContent = text || '';

    const dock = ensureWxDock();
    dock.hidden = false;
    const dbar = qs('#wxDockBar', dock);
    const dtxt = qs('#wxDockText', dock);
    if (dbar) dbar.style.width = p + '%';
    if (dtxt) dtxt.textContent = text || '';
  }

  function hideBgProgress(delayMs) {
    const run = () => {
      const bar = qs('#wxBgProgressBar');
      const label = qs('#wxBgProgressText');
      if (bar) bar.style.width = '0%';
      if (label) label.textContent = '待命 · 点击上方按钮开始全量拉取';
      const dock = document.getElementById('wxPullDock');
      if (dock) dock.hidden = true;
    };
    if (delayMs) setTimeout(run, delayMs);
    else run();
  }

  let bgPullTimer = null;
  let bgPullWatching = false;

  function stopBackgroundPullWatch() {
    bgPullWatching = false;
    if (bgPullTimer) {
      clearTimeout(bgPullTimer);
      bgPullTimer = null;
    }
  }

  async function watchBackgroundPull(date) {
    if (bgPullWatching) return;
    bgPullWatching = true;
    let idleTicks = 0;
    const finish = (phase, message) => {
      stopBackgroundPullWatch();
      try { sessionStorage.removeItem(WX_AUTOPULL_KEY); } catch (_e) { /* */ }
      const msg =
        phase === 'error'
          ? '拉取失败：' + (message || '')
          : message || '拉取完成';
      setBgProgress(phase === 'error' ? 0 : 100, msg);
      hideBgProgress(2200);
      if (getQuery('tab') === 'hot' || !getQuery('tab')) {
        const qDate = getQuery('date') || date;
        setQuery({ date: qDate, tab: 'hot' }, true);
        route();
      }
    };
    const tick = async () => {
      try {
        const p = await api('/api/wechat-auth/progress');
        if (!p || !p.phase || p.phase === 'idle') {
          idleTicks += 1;
          if (idleTicks >= 2) {
            finish('done', '拉取已结束');
            return;
          }
        } else if (p.phase === 'done' || p.phase === 'error') {
          finish(p.phase, p.message || '');
          return;
        } else {
          idleTicks = 0;
          setBgProgress(p.pct || 0, p.message || '后台拉取中…');
        }
      } catch (_e) { /* ignore */ }
      if (bgPullWatching) bgPullTimer = setTimeout(tick, 900);
    };
    tick();
  }

  async function autoPullAfterLogin(date, username) {
    try { sessionStorage.removeItem(WX_PENDING_KEY); } catch (_e) { /* */ }
    try { sessionStorage.setItem(WX_AUTOPULL_KEY, '1'); } catch (_e) { /* */ }
    hideWxOverlay();
    setBgProgress(
      3,
      username ? `已登录 · ${username}，后台拉取全部公众号…` : '后台拉取全部公众号（当天+昨天）…'
    );
    try {
      await apiPost('/api/wechat-refresh', { mode: 'direct' });
      watchBackgroundPull(date);
    } catch (err) {
      setBgProgress(0, err.message || String(err));
      hideBgProgress(3200);
    }
  }

  function bindWechatAuthPanel(date) {
    const msg = qs('#wxAuthMsg');
    function setMsg(t) { if (msg) msg.textContent = t || ''; }

    let pollAbort = false;
    let pollTimer = null;

    async function pollUntilDone(uuid, { onWaiting } = {}) {
      pollAbort = false;
      let tries = 0;
      return new Promise((resolve, reject) => {
        async function tick() {
          if (pollAbort) return reject(new Error('已取消'));
          tries += 1;
          if (tries > 50) return reject(new Error('登录超时，请重试'));
          try {
            const res = await fetch(
              BASE + '/api/wechat-auth/login/poll?uuid=' + encodeURIComponent(uuid),
              { headers: { Accept: 'application/json' } }
            );
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || ('轮询失败 ' + res.status));
            if (data.done) {
              try { sessionStorage.removeItem(WX_PENDING_KEY); } catch (_e) { /* */ }
              return resolve(data);
            }
            if (data.expired) {
              try { sessionStorage.removeItem(WX_PENDING_KEY); } catch (_e) { /* */ }
              return reject(new Error(data.message || '二维码已过期'));
            }
            if (onWaiting) onWaiting(data.message || 'waiting');
          } catch (err) {
            if (onWaiting) onWaiting(err.message || String(err));
          }
          pollTimer = setTimeout(tick, 1200);
        }
        tick();
      });
    }

    async function startAuthFlow() {
      try {
        setMsg('正在准备登录…');
        pollAbort = true;
        if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
        await new Promise((r) => setTimeout(r, 40));
        pollAbort = false;

        const session = await apiPost('/api/wechat-auth/login/start', {});
        const uuid = session.uuid;
        const scanUrl = session.scanUrl;
        try {
          sessionStorage.setItem(WX_PENDING_KEY, JSON.stringify({ uuid, at: Date.now() }));
          sessionStorage.setItem(WX_AUTOPULL_KEY, '1');
        } catch (_e) { /* */ }

        if (isMobileUa()) {
          setMsg('正在跳转微信登录，完成后请回到本页…');
          showWxOverlay(
            `<div class="wx-progress">
              <h3>即将打开微信登录</h3>
              <p class="wx-progress-detail">确认后请返回本页，系统会自动拉取公众号。</p>
              <p class="muted">若未自动跳转，请点击下方按钮</p>
              <a class="wx-auth-pull wx-jump-link" href="${escapeHtml(scanUrl)}">打开微信登录</a>
            </div>`,
            { closable: true }
          );
          // 先开始轮询，再跳转
          const pending = pollUntilDone(uuid, {
            onWaiting: (m) => setMsg(m === 'waiting' ? '等待微信确认…' : m)
          }).then((data) => autoPullAfterLogin(date, data.username));
          pending.catch((err) => setMsg(err.message || String(err)));
          setTimeout(() => {
            window.location.href = scanUrl;
          }, 350);
          return;
        }

        // PC：弹窗扫码
        const qrSrc = session.qrImageUrl || '';
        showWxOverlay(
          `<div class="wx-qr-modal">
            <h3>微信扫码登录</h3>
            <p class="wx-progress-detail">请使用手机微信扫描，登录「微信读书」；勿勾选 24 小时后退出。</p>
            <div class="wx-qr-frame">
              <img id="wxModalQr" src="${escapeHtml(qrSrc)}" alt="扫码登录" width="220" height="220" />
            </div>
            <p class="muted" id="wxModalTip">等待扫码…</p>
          </div>`,
          { closable: true }
        );
        const tip = () => document.getElementById('wxModalTip');
        try {
          const data = await pollUntilDone(uuid, {
            onWaiting: (m) => {
              const el = tip();
              if (el) el.textContent = m === 'waiting' ? '等待扫码…' : m;
            }
          });
          const el = tip();
          if (el) el.textContent = '登录成功' + (data.username ? ' · ' + data.username : '');
          await autoPullAfterLogin(date, data.username);
        } catch (err) {
          const el = tip();
          if (el) el.textContent = err.message || String(err);
          setMsg(err.message || String(err));
        }
      } catch (err) {
        setMsg(err.message || String(err));
      }
    }

    const startBtn = qs('#wxAuthStart');
    if (startBtn) startBtn.addEventListener('click', startAuthFlow);

    // 手机从微信返回 / 页面刷新：后台继续确认登录与拉取，不弹进度窗
    try {
      const wantPull = sessionStorage.getItem(WX_AUTOPULL_KEY) === '1';
      const raw = sessionStorage.getItem(WX_PENDING_KEY);
      const pending = raw ? JSON.parse(raw) : null;

      // 先同步服务端进度：已完成则收起「拉取中」，避免刷新后假状态
      api('/api/wechat-auth/progress')
        .then((p) => {
          if (!p || !p.phase) return null;
          if (p.phase === 'done' || p.phase === 'error' || p.phase === 'idle') {
            try { sessionStorage.removeItem(WX_AUTOPULL_KEY); } catch (_e) { /* */ }
            hideBgProgress();
            return null;
          }
          if (p.phase === 'start' || p.phase === 'resolve' || p.phase === 'fetch' || p.phase === 'full') {
            setBgProgress(p.pct || 5, p.message || '后台拉取中…');
            watchBackgroundPull(date);
            return 'watching';
          }
          return null;
        })
        .then((watching) => {
          if (watching) return null;
          if (!wantPull) {
            if (pending && pending.uuid && Date.now() - (pending.at || 0) < 10 * 60 * 1000) {
              setMsg('正在确认微信登录…');
              setBgProgress(10, '确认登录中…');
              return pollUntilDone(pending.uuid, {
                onWaiting: (m) => setBgProgress(15, m === 'waiting' ? '等待微信确认…' : m)
              }).then((data) => autoPullAfterLogin(date, data.username));
            }
            return null;
          }
          return api('/api/wechat-auth/status').then((st) => {
            if (st && st.status === 'ok' && st.hasCredentials) {
              return autoPullAfterLogin(date, st.username);
            }
            if (pending && pending.uuid && Date.now() - (pending.at || 0) < 10 * 60 * 1000) {
              setMsg('正在确认微信登录…');
              setBgProgress(10, '确认登录中，请稍候…');
              return pollUntilDone(pending.uuid, {
                onWaiting: (m) =>
                  setBgProgress(15, m === 'waiting' ? '等待微信确认…' : m)
              }).then((data) => autoPullAfterLogin(date, data.username));
            }
            return null;
          });
        })
        .catch((err) => {
          setMsg(err.message || String(err));
          hideBgProgress(2000);
        });
    } catch (_e) { /* */ }

    const bindBtn = qs('#wxBindShares');
    if (bindBtn) {
      bindBtn.addEventListener('click', async () => {
        const inputs = document.querySelectorAll('[data-share-name]');
        setMsg('绑定中…');
        let n = 0;
        for (const inp of inputs) {
          const shareUrl = String(inp.value || '').trim();
          const name = inp.getAttribute('data-share-name');
          if (!shareUrl) continue;
          try {
            await apiPost('/api/wechat-auth/bind', { name, shareUrl });
            n += 1;
          } catch (err) {
            setMsg((name || '') + ': ' + (err.message || String(err)));
            return;
          }
        }
        setMsg(n ? `已绑定 ${n} 个号` : '未填写分享链接');
        if (n) {
          await autoPullAfterLogin(date);
        }
      });
    }

    const pullBtn = qs('#wxAuthPull');
    if (pullBtn) {
      pullBtn.addEventListener('click', () => autoPullAfterLogin(date));
    }
  }

  async function apiPost(path, body) {
    const res = await fetch(BASE + path, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('请求失败 ' + res.status));
    return data;
  }

  function drawWordCloud(canvas, words) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 340;
    const cssH = 320;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    canvas._hits = [];
    if (!words || !words.length) return;

    const max = Math.max(...words.map((w) => w.score || 1));
    const min = Math.min(...words.map((w) => w.score || 1));
    const placed = [];
    const cx = cssW / 2;
    const cy = cssH / 2;
    const colors = ['#0f8a6a', '#146c8a', '#0b1f2a', '#1c3644', '#0d6e56'];

    function collides(x, y, w, h) {
      for (let i = 0; i < placed.length; i++) {
        const p = placed[i];
        if (x < p.x + p.w && x + w > p.x && y < p.y + p.h && y + h > p.y) return true;
      }
      return false;
    }

    words.slice(0, 40).forEach((word, i) => {
      const score = word.score || 1;
      const size = 11 + ((score - min) / Math.max(1, max - min)) * 18;
      ctx.font = `600 ${size}px "IBM Plex Sans", "PingFang SC", sans-serif`;
      const text = word.term;
      const tw = ctx.measureText(text).width;
      const th = size;
      let x = cx - tw / 2;
      let y = cy;
      let found = false;
      for (let r = 0; r < 120; r++) {
        const angle = r * 0.42;
        const radius = 3 + r * 1.85;
        x = cx + Math.cos(angle) * radius - tw / 2;
        y = cy + Math.sin(angle) * radius * 0.72;
        if (x < 4 || y < th || x + tw > cssW - 4 || y > cssH - 4) continue;
        if (!collides(x, y - th, tw + 4, th + 4)) {
          found = true;
          break;
        }
      }
      if (!found) return;
      ctx.fillStyle = colors[i % colors.length];
      ctx.globalAlpha = 0.75 + (i < 5 ? 0.2 : 0);
      ctx.fillText(text, x, y);
      ctx.globalAlpha = 1;
      const box = { x: x - 2, y: y - th, w: tw + 6, h: th + 6, term: text, idx: i };
      placed.push(box);
      canvas._hits.push(box);
    });
  }

  async function renderCloud() {
    renderLoading('正在加载热点词云…', 'cloud');
    try {
      const datesData = await api('/api/dates');
      let date = getQuery('date') || datesData.today;
      const valid = (datesData.dates || []).some((d) => d.date === date);
      if (!valid) date = datesData.today;
      setQuery({ date, tab: 'cloud' }, !getQuery('date'));

      const data = await api('/api/wordcloud?date=' + encodeURIComponent(date));
      let wc = data.wordcloud || {};
      let words = wc.words || [];

      function srcLine(w) {
        return [
          w.newsCount ? `新闻${w.newsCount}` : '',
          w.hotCount ? `热点${w.hotCount}` : '',
          w.paperCount ? `论文${w.paperCount}` : '',
          w.githubCount ? `GitHub${w.githubCount}` : ''
        ].filter(Boolean).join(' · ');
      }

      app.innerHTML = shell(`
        ${headerHtml(datesData, date, 'cloud')}
        <p class="meta-line">${escapeHtml(date)} · ${words.length} 个词
          ${wc.updatedAt ? ' · 更新于 ' + formatTime(wc.updatedAt) : ''}
        </p>
        <div class="cloud-panel" id="cloudPanel">
          <canvas id="wordCanvas" class="word-canvas" aria-label="热点词云"></canvas>
          <div class="cloud-hotspots" id="cloudHotspots"></div>
        </div>
        <div id="wordDetail" class="word-detail">
          <p class="muted">点击上方词云中的词语，查看讲解</p>
        </div>
      `);
      bindCommon(date, 'cloud');

      const canvas = qs('#wordCanvas');
      const hotspots = qs('#cloudHotspots');
      const detail = qs('#wordDetail');

      function syncHotspots() {
        if (!hotspots || !canvas) return;
        hotspots.innerHTML = '';
        (canvas._hits || []).forEach((h) => {
          const hit = document.createElement('div');
          hit.className = 'cloud-word-hit';
          hit.style.left = h.x + 'px';
          hit.style.top = h.y + 'px';
          hit.style.width = Math.max(24, h.w) + 'px';
          hit.style.height = Math.max(18, h.h) + 'px';
          hit.title = h.term;
          const xbtn = document.createElement('button');
          xbtn.type = 'button';
          xbtn.className = 'cloud-word-x';
          xbtn.setAttribute('aria-label', '删除 ' + h.term);
          xbtn.textContent = '×';
          xbtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            deleteTerm(h.term);
          });
          hit.addEventListener('click', (e) => {
            if (e.target === xbtn) return;
            showExplain(h.term);
          });
          hit.appendChild(xbtn);
          hotspots.appendChild(hit);
        });
      }

      function redraw() {
        drawWordCloud(canvas, words);
        syncHotspots();
      }
      redraw();

      async function showExplain(term) {
        const w = words.find((x) => x.term === term) || { term };
        detail.hidden = false;
        detail.className = 'word-detail';
        detail.innerHTML = `<strong>${escapeHtml(w.term)}</strong>
          <span class="word-score">正在生成讲解…</span>
          <p class="muted">请稍候</p>`;
        try {
          const res = await apiPost('/api/wordcloud/explain', { term: w.term, date });
          const explain = res.explain || '';
          const idx = words.findIndex((x) => x.term === w.term);
          if (idx >= 0) words[idx] = { ...words[idx], explain };
          const src = srcLine(words[idx] || w);
          detail.innerHTML = `<strong>${escapeHtml(w.term)}</strong>
            <span class="word-score">${escapeHtml(src || '专有名词')}${res.cached ? ' · 已缓存' : ' · 刚刚生成'}</span>
            <div class="word-explain-body">${escapeHtml(explain).replace(/\n/g, '<br/>')}</div>`;
        } catch (err) {
          detail.innerHTML = `<strong>${escapeHtml(w.term)}</strong>
            <p class="error">${escapeHtml(err.message || String(err))}</p>`;
        }
      }

      async function deleteTerm(term) {
        if (!term) return;
        try {
          const res = await apiPost('/api/wordcloud/delete', { term, date });
          wc = res.wordcloud || {};
          words = wc.words || [];
          redraw();
          if (detail && detail.textContent && detail.textContent.indexOf(term) === 0) {
            detail.innerHTML = '<p class="muted">点击上方词云中的词语，查看讲解</p>';
          }
          const meta = qs('.meta-line');
          if (meta) {
            meta.innerHTML = `${escapeHtml(date)} · ${words.length} 个词${wc.updatedAt ? ' · 更新于 ' + formatTime(wc.updatedAt) : ''}`;
          }
        } catch (err) {
          detail.hidden = false;
          detail.className = 'word-detail';
          detail.innerHTML = `<p class="error">${escapeHtml(err.message || String(err))}</p>`;
        }
      }

      window.addEventListener('resize', function onR() {
        if (!document.getElementById('wordCanvas')) {
          window.removeEventListener('resize', onR);
          return;
        }
        redraw();
      });
    } catch (err) {
      app.innerHTML = shell(`<div class="error">${escapeHtml(err.message || String(err))}</div>`);
    }
  }

  async function renderBooks() {
    renderLoading('正在加载图书洞察…', 'books');
    try {
      const datesData = await api('/api/dates');
      let date = getQuery('date') || datesData.today;
      const valid = (datesData.dates || []).some((d) => d.date === date);
      if (!valid) date = datesData.today;
      setQuery({ date, tab: 'books' }, !getQuery('date'));

      const data = await api('/api/books?date=' + encodeURIComponent(date));
      const books = data.books || {};
      const carry = data.carriedForward
        ? ` · 沿用 ${escapeHtml(data.sourceDate || '')} 数据`
        : '';
      const plans = (books.planning || []).map((p) => `
        <article class="plan-card">
          <h3>${escapeHtml(p.title || '策划方向')}</h3>
          <p><span class="label">角度</span>${escapeHtml(p.angle || '')}</p>
          <p><span class="label">为何现在</span>${escapeHtml(p.why || '')}</p>
          <p><span class="label">读者</span>${escapeHtml(p.audience || '')}</p>
        </article>
      `).join('');

      app.innerHTML = shell(`
        ${headerHtml(datesData, date, 'books')}
        <p class="meta-line">${escapeHtml(date)} · 图书洞察${carry}
          ${books.updatedAt ? ' · 更新于 ' + formatTime(books.updatedAt) : ''}
        </p>

        <section class="insight-block book-plan-assistant">
          <h2 class="section-title">选题策划助手</h2>
          <p class="muted book-plan-hint">以资深科技出版编辑身份生成方案：选题思路、角度、读者对象分析、结构、市场分析（现有相关书籍）、本书卖点分析。</p>
          <textarea id="bookPlanInput" class="book-plan-input" maxlength="2000" rows="3" placeholder="请输入选题方向、关键词或素材线索…"></textarea>
          <div class="book-plan-actions">
            <button type="button" class="book-plan-btn" id="bookPlanBtn">确定</button>
          </div>
          <div id="bookPlanResult" class="book-plan-result" hidden></div>
        </section>

        <section class="insight-block">
          <h2 class="section-title">市场观察</h2>
          <p class="analysis">${escapeHtml(books.analysis || '暂无分析')}</p>
        </section>

        <section class="insight-block">
          <h2 class="section-title">AI 图书策划方向</h2>
          <div class="plan-grid">${plans || '<div class="empty">暂无策划方向</div>'}</div>
        </section>
      `);
      bindCommon(date, 'books');

      const planBtn = qs('#bookPlanBtn');
      const planInput = qs('#bookPlanInput');
      const planResult = qs('#bookPlanResult');
      if (planBtn && planInput && planResult) {
        planBtn.addEventListener('click', async () => {
          const input = String(planInput.value || '').trim();
          if (!input) {
            planResult.hidden = false;
            planResult.innerHTML = '<p class="book-plan-error">请先输入选题线索</p>';
            return;
          }
          planBtn.disabled = true;
          planBtn.textContent = '生成中…';
          planResult.hidden = false;
          planResult.innerHTML = '<p class="muted">正在生成选题方案，请稍候…</p>';
          try {
            const res = await apiPost('/api/books/plan', { input });
            const p = (res && res.plan) || {};
            planResult.innerHTML = `
              <article class="plan-card book-plan-card">
                <h3>${escapeHtml(p.title || '选题策划方案')}</h3>
                <p><span class="label">选题思路</span><span class="book-plan-field">${escapeHtml(p.topicIdea || '—')}</span></p>
                <p><span class="label">角度</span><span class="book-plan-field">${escapeHtml(p.angle || '—')}</span></p>
                <p><span class="label">读者对象分析</span><span class="book-plan-field">${escapeHtml(p.audience || '—')}</span></p>
                <p><span class="label">结构</span><span class="book-plan-field">${escapeHtml(p.structure || '—')}</span></p>
                <p><span class="label">市场分析</span><span class="book-plan-field">${escapeHtml(p.marketAnalysis || '—')}</span></p>
                <p><span class="label">本书卖点分析</span><span class="book-plan-field">${escapeHtml(p.sellingPoints || '—')}</span></p>
              </article>`;
          } catch (err) {
            planResult.innerHTML = `<p class="book-plan-error">${escapeHtml(err.message || String(err))}</p>`;
          } finally {
            planBtn.disabled = false;
            planBtn.textContent = '确定';
          }
        });
      }
    } catch (err) {
      app.innerHTML = shell(`<div class="error">${escapeHtml(err.message || String(err))}</div>`);
    }
  }

  async function renderDetail(id) {
    renderLoading('加载详情…');
    const date = getQuery('date');
    const tab = getQuery('tab') || 'news';
    const backHref = `${BASE}/?date=${encodeURIComponent(date || '')}&tab=${encodeURIComponent(tab)}`.replace('date=&', '');
    try {
      const data = await api('/api/news/' + encodeURIComponent(id));
      const item = data.item;
      const isResearch = item.category === 'paper' || item.category === 'github';
      const cover = item.image
        ? `<img class="detail-cover" src="${escapeHtml(proxyImage(item.image))}" alt="" referrerpolicy="no-referrer" onerror="this.style.display='none'" />`
        : '';
      const ch = channelLabel(item.channel);
      const titleZh =
        item.category === 'paper' && item.titleZh
          ? `<p class="title-zh">${escapeHtml(item.titleZh)}</p>`
          : '';
      const zhSummary = item.summaryZh
        ? `<div class="detail-zh"><h3>中文简介</h3><p>${escapeHtml(item.summaryZh)}</p></div>`
        : isResearch
          ? `<div class="detail-zh"><h3>中文简介</h3><p class="muted">暂无中文简介，请稍后重试或阅读原文。</p></div>`
          : '';
      const enSummary =
        item.summary && (!item.summaryZh || item.summary !== item.summaryZh)
          ? `<p class="detail-summary">${escapeHtml(item.summary)}</p>`
          : !isResearch && item.summary
            ? `<p class="detail-summary">${escapeHtml(item.summary)}</p>`
            : '';
      const bodyHtml = isResearch
        ? `${zhSummary}${enSummary ? `<details class="orig-summary"><summary>原文摘要</summary>${enSummary}</details>` : ''}`
        : `${enSummary}<div class="detail-content">${rewriteContentImages(item.contentHtml) || '<p>暂无正文摘要，请阅读原文。</p>'}</div>`;

      app.innerHTML = shell(`
        <div class="detail-top">
          <button class="back-btn" type="button" id="backBtn">← 返回列表</button>
        </div>
        <article class="detail">
          ${cover}
          <div class="detail-body">
            <h1>${escapeHtml(item.title)}</h1>
            ${titleZh}
            <div class="detail-meta">
              <span class="source-pill">${escapeHtml(item.source || '')}</span>
              ${ch ? `<span class="channel-pill">${escapeHtml(ch)}</span>` : ''}
              ${item.venue ? `<span class="channel-pill">${escapeHtml(item.venue)}</span>` : ''}
              ${item.language ? `<span class="channel-pill">${escapeHtml(item.language)}</span>` : ''}
              ${item.stars ? `<span>★ ${escapeHtml(String(item.stars))}</span>` : ''}
              <span>${escapeHtml(formatTime(item.publishedAt))}</span>
            </div>
            ${bodyHtml}
            <div class="actions">
              ${(() => {
                const ext = externalArticleUrl(item.url);
                if (!ext) return '<span class="muted">暂无可用原文链接</span>';
                return `<a class="primary" href="${escapeHtml(ext)}" target="_blank" rel="noopener noreferrer">${isResearch ? '打开原文' : '阅读原文'}</a>`;
              })()}
              <button class="secondary" type="button" id="backBtn2">返回主页</button>
            </div>
          </div>
        </article>
      `);

      const goBack = () => {
        if (history.length > 1) history.back();
        else location.href = backHref;
      };
      qs('#backBtn').addEventListener('click', goBack);
      qs('#backBtn2').addEventListener('click', goBack);
    } catch (err) {
      app.innerHTML = shell(`
        <div class="detail-top"><button class="back-btn" type="button" id="backBtn">← 返回列表</button></div>
        <div class="error">${escapeHtml(err.message || String(err))}</div>
      `);
      qs('#backBtn').addEventListener('click', () => { location.href = backHref; });
    }
  }

  async function renderPapers() {
    renderLoading('正在加载论文热点…', 'papers');
    try {
      const datesData = await api('/api/dates');
      let date = getQuery('date') || datesData.today;
      const valid = (datesData.dates || []).some((d) => d.date === date);
      if (!valid) date = datesData.today;
      setQuery({ date, tab: 'papers' }, !getQuery('date'));

      const papersRes = await api('/api/papers?date=' + encodeURIComponent(date));
      const papers = papersRes.papers || {};
      const paperItems = papers.items || [];
      const carry = papersRes.carriedForward
        ? ` · 沿用 ${escapeHtml(papersRes.sourceDate || '')} 数据`
        : '';

      const paperCards = paperItems.slice(0, 50).map((it, idx) => {
        const href = `${BASE}/article/${encodeURIComponent(it.id)}?date=${encodeURIComponent(date)}&tab=papers`;
        const blurb = it.summaryZh || it.summary || '';
        return `
        <a class="card research-card" href="${escapeHtml(href)}" style="animation-delay:${Math.min(idx, 10) * 30}ms">
          <div class="thumb placeholder">${escapeHtml((it.venue || 'Paper').slice(0, 6))}</div>
          <div class="card-body">
            <h2>${escapeHtml(it.title)}</h2>
            ${it.titleZh ? `<p class="title-zh">${escapeHtml(it.titleZh)}</p>` : ''}
            <p>${escapeHtml(blurb)}</p>
            <div class="card-meta">
              <span class="source-pill">${escapeHtml(it.source || 'arXiv')}</span>
              ${it.venue ? `<span class="channel-pill">${escapeHtml(it.venue)}</span>` : ''}
              ${it.heat ? `<span>热度 ${escapeHtml(String(it.heat))}</span>` : ''}
              <span>${escapeHtml(formatTime(it.publishedAt))}</span>
            </div>
          </div>
        </a>`;
      }).join('');

      app.innerHTML = shell(`
        ${headerHtml(datesData, date, 'papers')}
        <p class="meta-line">${escapeHtml(date)} · 论文 ${paperItems.length} 篇${carry}
          ${papers.updatedAt ? ' · 更新于 ' + formatTime(papers.updatedAt) : ''}
        </p>
        <section class="list">${paperCards || '<div class="empty">暂无论文数据，等待定时任务或稍后刷新。</div>'}</section>
      `);
      bindCommon(date, 'papers');
    } catch (err) {
      app.innerHTML = shell(`<div class="error">${escapeHtml(err.message || String(err))}</div>`);
    }
  }

  async function renderGithubTab() {
    renderLoading('正在加载 GitHub 热点…', 'github');
    try {
      const datesData = await api('/api/dates');
      let date = getQuery('date') || datesData.today;
      const valid = (datesData.dates || []).some((d) => d.date === date);
      if (!valid) date = datesData.today;
      setQuery({ date, tab: 'github' }, !getQuery('date'));

      const ghRes = await api('/api/github?date=' + encodeURIComponent(date));
      const github = ghRes.github || {};
      const carry = ghRes.carriedForward
        ? ` · 沿用 ${escapeHtml(ghRes.sourceDate || '')} 数据`
        : '';

      let topStars = github.topStars || [];
      let weeklyRising = github.weeklyRising || [];
      const allItems = github.items || [];
      if (!topStars.length && !weeklyRising.length && allItems.length) {
        topStars = allItems.slice(0, 20);
        weeklyRising = allItems.slice(0, 20);
      }

      function ghCard(it, idx, badge) {
        const href = `${BASE}/article/${encodeURIComponent(it.id)}?date=${encodeURIComponent(date)}&tab=github`;
        const blurb = it.summaryZh || it.summary || '';
        const delta =
          it.starsDelta > 0
            ? `<span class="gh-delta">↑${escapeHtml(String(it.starsDelta))}/周</span>`
            : '';
        return `
        <a class="card research-card" href="${escapeHtml(href)}" style="animation-delay:${Math.min(idx, 10) * 30}ms">
          <div class="thumb placeholder">${escapeHtml(badge || 'GH')}</div>
          <div class="card-body">
            <h2>${escapeHtml(it.title)}</h2>
            <p>${escapeHtml(blurb)}</p>
            <div class="card-meta">
              <span class="source-pill">${escapeHtml(it.source || 'GitHub')}</span>
              ${it.language ? `<span class="channel-pill">${escapeHtml(it.language)}</span>` : ''}
              ${it.stars ? `<span>★ ${escapeHtml(String(it.stars))}</span>` : ''}
              ${delta}
            </div>
          </div>
        </a>`;
      }

      const topCards = topStars.map((it, idx) => ghCard(it, idx, '★')).join('');
      const weekCards = weeklyRising.map((it, idx) => ghCard(it, idx, '↑')).join('');

      app.innerHTML = shell(`
        ${headerHtml(datesData, date, 'github')}
        <p class="meta-line">${escapeHtml(date)} · 高星 ${topStars.length} · 近一周上涨 ${weeklyRising.length}${carry}
          ${github.updatedAt ? ' · 更新于 ' + formatTime(github.updatedAt) : ''}
        </p>

        <section class="insight-block">
          <h2 class="section-title">高星仓库</h2>
          <section class="list">${topCards || '<div class="empty">暂无高星仓库</div>'}</section>
        </section>

        <section class="insight-block">
          <h2 class="section-title">近一周上涨 / 新晋</h2>
          <section class="list">${weekCards || '<div class="empty">暂无近一周上涨数据</div>'}</section>
        </section>
      `);
      bindCommon(date, 'github');
    } catch (err) {
      app.innerHTML = shell(`<div class="error">${escapeHtml(err.message || String(err))}</div>`);
    }
  }

  async function route() {
    const r = parseRoute();
    if (r.name === 'detail') {
      await renderDetail(r.id);
      return;
    }
    const tab = getQuery('tab') || 'news';
    if (tab === 'hot') await renderNewsOrHot('hot');
    else if (tab === 'papers' || tab === 'research') await renderPapers();
    else if (tab === 'github') await renderGithubTab();
    else if (tab === 'cloud') await renderCloud();
    else if (tab === 'books') await renderBooks();
    else await renderNewsOrHot('news');
  }

  window.addEventListener('popstate', route);
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (!href.startsWith(BASE)) return;
    if (a.target === '_blank') return;
    e.preventDefault();
    history.pushState({}, '', href);
    route();
  });

  route();
})();
