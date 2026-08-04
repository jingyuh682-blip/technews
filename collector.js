#!/usr/bin/env node
/**
 * 科技新闻 + 科技热点 + 词云：每天早晨 08:30 执行一次
 * crontab: 30 8 * * *
 * 新闻时间窗：昨天 00:00 → 当前时刻（Asia/Shanghai，含昨天与今天）
 */
const Parser = require("rss-parser");
const sanitizeHtml = require("sanitize-html");
const sources = require("./sources");
const { KEYWORDS, DEDUP_THRESHOLD } = require("./sources");
const { CUSTOM_SOURCES } = require("./custom-sources");
const {
  makeId,
  upsertHotspotsToday,
  purgeExpired,
  ensureDataDir,
  todayKey,
  purgeHotSourcesFromNews,
  writeDayPayload,
  collectNewsWindow,
  isTodayOrYesterday
} = require("./store");
const { collectHotspots } = require("./hot-sources");
const { buildWordcloud } = require("./wordcloud");
const { HOT_ONLY_SOURCE_IDS } = require("./sources");
const { keepNewsItem } = require("./content-filter");

/** @deprecated 使用 collectNewsWindow；保留导出兼容 */
function newsWindow(now) {
  return collectNewsWindow(now || new Date());
}

function inNewsWindow(item) {
  var publishedAt = item && item.publishedAt;
  // 无发布时间：保留（采集时刻写入当天文件，展示侧会再按两日窗口合并）
  if (!publishedAt) return true;
  return isTodayOrYesterday(publishedAt);
}

const parser = new Parser({
  timeout: 12000,
  headers: {
    "User-Agent": "Mozilla/5.0 (compatible; TechNewsBot/2.0; +http://39.96.71.50/technews)",
    Accept: "application/rss+xml, application/xml, text/xml, */*"
  },
  customFields: {
    item: [
      ["media:content", "mediaContent", { keepArray: true }],
      ["media:thumbnail", "mediaThumbnail", { keepArray: true }],
      ["content:encoded", "contentEncoded"]
    ]
  }
});

// ---- Chinese detection ----
function hasChineseContent(title, summary) {
  var text = (title || "") + " " + (summary || "");
  var m = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g);
  var chineseCount = m ? m.length : 0;
  var totalChars = text.replace(/\s/g, "").length;
  if (totalChars === 0) return false;
  return chineseCount >= 2 && (chineseCount / totalChars) >= 0.03;
}

// ---- Keyword matching ----
function matchKeywords(text) {
  var t = String(text || "").toLowerCase();
  return KEYWORDS.filter(function(k) {
    return t.indexOf(String(k).toLowerCase()) !== -1;
  });
}

// ---- Utilities ----
function stripTags(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\x22")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(base, maybe) {
  try { return new URL(maybe, base).toString(); }
  catch (_e) { return ""; }
}

function pickImage(item) {
  if (item.enclosure && item.enclosure.url &&
      /image|jpg|jpeg|png|webp|gif/i.test(String(item.enclosure.type || "") + " " + item.enclosure.url)) {
    return item.enclosure.url;
  }
  if (Array.isArray(item.mediaContent)) {
    for (var i = 0; i < item.mediaContent.length; i++) {
      var u = item.mediaContent[i] && item.mediaContent[i].$ && item.mediaContent[i].$.url;
      if (u) return u;
    }
  }
  if (Array.isArray(item.mediaThumbnail)) {
    for (var j = 0; j < item.mediaThumbnail.length; j++) {
      var t = item.mediaThumbnail[j] && item.mediaThumbnail[j].$ && item.mediaThumbnail[j].$.url;
      if (t) return t;
    }
  }
  var html = item.contentEncoded || item["content:encoded"] || item.content || item.summary || item.description || "";
  var m = String(html).match(/<img[^>]+src=["\'"]([^"\'"]+)["\'"]/i);
  return m ? m[1] : "";
}

function cleanHtml(html) {
  return sanitizeHtml(String(html || ""), {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "h1", "h2"]),
    allowedAttributes: {
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt"]
    },
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer", target: "_blank" })
    }
  });
}

// ---- Item normalization ----
function normalizeItem(raw, source) {
  var url = raw.link || raw.guid || "";
  if (!url) return null;
  var title = stripTags(raw.title || "").slice(0, 240);
  if (!title) return null;
  var rawHtml = raw.contentEncoded || raw["content:encoded"] || raw.content || raw.summary || raw.description || "";
  var summary = stripTags(raw.contentSnippet || rawHtml).slice(0, 320);

  // Filter: keyword in title
  if (source.filter) {
    var titleMatches = matchKeywords(title);
    if (titleMatches.length === 0) return null;
  }

  // Filter: Chinese content required
  if (!hasChineseContent(title, summary)) return null;

  // Filter: 偏技术/产品，去掉广告与八卦
  if (!keepNewsItem({ title: title, summary: summary })) return null;

  var publishedAt = raw.isoDate || raw.pubDate || new Date().toISOString();
  var image = pickImage(raw) || "";
  if (image) image = absoluteUrl(url, image) || image;

  return {
    id: makeId(url),
    title: title,
    summary: summary,
    contentHtml: cleanHtml(rawHtml).slice(0, 50000),
    image: image,
    sourceId: source.id,
    source: source.name,
    url: url,
    publishedAt: new Date(publishedAt).toISOString(),
    collectedAt: new Date().toISOString()
  };
}

// ---- Fetch helpers ----
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise(function(_, reject) {
      setTimeout(function() { reject(new Error("timeout " + ms + "ms")); }, ms);
    })
  ]);
}

async function fetchSource(source) {
  try {
    var feed = await withTimeout(parser.parseURL(source.url), 15000);
    var items = [];
    for (var i = 0; i < (feed.items || []).length && i < 30; i++) {
      var item = normalizeItem(feed.items[i], source);
      if (item) items.push(item);
    }
    return { ok: true, source: source.id, count: items.length, items: items };
  } catch (err) {
    return {
      ok: false,
      source: source.id,
      error: String(err && err.message ? err.message : err),
      items: []
    };
  }
}

async function fetchOgImage(pageUrl) {
  try {
    var controller = new AbortController();
    var timer = setTimeout(function() { controller.abort(); }, 5000);
    var res = await fetch(pageUrl, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml"
      }
    });
    clearTimeout(timer);
    if (!res.ok) return "";
    var html = (await res.text()).slice(0, 200000);
    var patterns = [
      /<meta[^>]+property=["\'"]og:image["\'"][^>]+content=["\'"]([^"\'"]+)["\'"]/i,
      /<meta[^>]+content=["\'"]([^"\'"]+)["\'"][^>]+property=["\'"]og:image["\'"]/i,
      /<meta[^>]+name=["\'"]twitter:image(?::src)?["\'"][^>]+content=["\'"]([^"\'"]+)["\'"]/i,
      /<meta[^>]+content=["\'"]([^"\'"]+)["\'"][^>]+name=["\'"]twitter:image(?::src)?["\'"]/i
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m = html.match(patterns[i]);
      if (m && m[1]) return absoluteUrl(pageUrl, m[1]);
    }
    return "";
  } catch (_e) { return ""; }
}

async function enrichImages(items) {
  var need = items.filter(function(it) { return !it.image; }).slice(0, 25);
  console.log("[collector] enriching og:image for " + need.length + " items");
  var idx = 0;
  async function worker() {
    while (idx < need.length) {
      var cur = need[idx++];
      var img = await fetchOgImage(cur.url);
      if (img) cur.image = img;
    }
  }
  var concurrency = 8;
  var workers = [];
  for (var w = 0; w < concurrency; w++) workers.push(worker());
  await Promise.all(workers);
  return items;
}

// ---- Title deduplication ----
function tokenizeTitle(title) {
  var stopWords = {
    "the":1,"a":1,"an":1,"is":1,"are":1,"was":1,"were":1,"be":1,"been":1,"being":1,
    "have":1,"has":1,"had":1,"do":1,"does":1,"did":1,"will":1,"would":1,"could":1,
    "should":1,"may":1,"might":1,"can":1,"shall":1,"to":1,"of":1,"in":1,"for":1,
    "on":1,"with":1,"at":1,"by":1,"from":1,"as":1,"into":1,"through":1,"during":1,
    "before":1,"after":1,"above":1,"below":1,"between":1,"under":1,"again":1,
    "further":1,"then":1,"once":1,"here":1,"there":1,"when":1,"where":1,"why":1,
    "how":1,"all":1,"both":1,"each":1,"few":1,"more":1,"most":1,"other":1,"some":1,
    "such":1,"no":1,"nor":1,"not":1,"only":1,"own":1,"same":1,"so":1,"than":1,
    "too":1,"very":1,"just":1,"now":1,"and":1,"or":1,"but":1,"if":1,"this":1,"that":1,
    "it":1,"its":1,"these":1,"those":1
  };
  return String(title || "").toLowerCase()
    .replace(/[^\u4e00-\u9fff\w\d]/g, " ")
    .split(/\s+/)
    .filter(function(w) { return w.length > 1 && !stopWords[w]; });
}

function jaccardSimilarity(a, b) {
  var setB = new Set(b);
  var intersection = a.filter(function(x) { return setB.has(x); });
  var union = new Set(a.concat(b));
  return union.size === 0 ? 0 : intersection.length / union.size;
}

function deduplicateItems(items, threshold) {
  var t = threshold || 0.55;
  var result = [];
  var skipped = [];
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var tokens = tokenizeTitle(item.title);
    var found = false;
    for (var j = 0; j < result.length; j++) {
      if (jaccardSimilarity(tokens, tokenizeTitle(result[j].title)) >= t) {
        skipped.push({
          title: item.title.slice(0, 60),
          source: item.source,
          duplicateOf: result[j].title.slice(0, 60) + " [" + result[j].source + "]"
        });
        found = true;
        break;
      }
    }
    if (!found) result.push(item);
  }
  return { items: result, skipped: skipped };
}

// ---- Main ----
async function runCollector() {
  ensureDataDir();
  console.log("[collector] start " + new Date().toISOString());
  console.log("[collector] sources=" + sources.length + " keywords=" + KEYWORDS.length);

  // RSS sources
  var rssSources = sources.filter(function(s) { return !s.custom; });
  var customSources = sources.filter(function(s) { return s.custom; });

  var results = await Promise.all(rssSources.map(function(s) { return fetchSource(s); }));

  // Custom/scraper sources
  for (var cs = 0; cs < customSources.length; cs++) {
    var csrc = customSources[cs];
    if (CUSTOM_SOURCES[csrc.id]) {
      var customResult = await CUSTOM_SOURCES[csrc.id]();
      results.push(customResult);
      console.log(customResult.ok
        ? "  OK " + customResult.source + ": " + customResult.count
        : "  FAIL " + customResult.source + ": " + customResult.error);
    }
  }
  var all = [];
  for (var r = 0; r < results.length; r++) {
    all = all.concat(results[r].items);
    console.log(results[r].ok
      ? "  OK " + results[r].source + ": " + results[r].count
      : "  FAIL " + results[r].source + ": " + results[r].error);
  }

  // URL-based dedup
  var urlMap = new Map();
  for (var a = 0; a < all.length; a++) {
    if (!urlMap.has(all[a].id)) urlMap.set(all[a].id, all[a]);
  }
  var unique = Array.from(urlMap.values());
  console.log("[collector] after URL dedup: " + unique.length);

  // Title similarity dedup
  var before = unique.length;
  var dedupResult = deduplicateItems(unique, DEDUP_THRESHOLD);
  if (dedupResult.skipped.length > 0) {
    console.log("[collector] dedup skipped " + dedupResult.skipped.length + " duplicates:");
    for (var d = 0; d < dedupResult.skipped.length; d++) {
      console.log("  - " + dedupResult.skipped[d].title + "  =>  " + dedupResult.skipped[d].duplicateOf);
    }
  }
  unique = dedupResult.items;
  console.log("[collector] after title dedup: " + unique.length + " (removed " + (before - unique.length) + ")");

  // Enrich images
  unique = await enrichImages(unique);

  // 仅保留「昨天 + 今天」（Asia/Shanghai 自然日）
  var win = collectNewsWindow(new Date());
  var beforeWindow = unique.length;
  unique = unique.filter(function(it) {
    return inNewsWindow(it);
  });
  console.log(
    "[collector] news window " + win.yesterday + " + " + win.today +
    " (" + win.start.toISOString() + " → " + win.end.toISOString() + ")" +
    "; kept " + unique.length + "/" + beforeWindow
  );

  // Sort by date
  unique.sort(function(a, b) {
    var ta = Date.parse(a.publishedAt || a.collectedAt || 0) || 0;
    var tb = Date.parse(b.publishedAt || b.collectedAt || 0) || 0;
    return tb - ta;
  });

  // Save news (exclude hotspot-only vertical media leftover); 每日全量替换当日新闻
  unique = unique.filter(function(it) {
    return HOT_ONLY_SOURCE_IDS.indexOf(it.sourceId) === -1 && keepNewsItem(it);
  });
  console.log("[collector] after quality filter: " + unique.length);
  var dateKey = todayKey();
  writeDayPayload(dateKey, { items: unique });
  // Strip any historical hotspot sources still sitting in news
  var purgedHot = purgeHotSourcesFromNews(HOT_ONLY_SOURCE_IDS);
  var removed = purgeExpired();
  var withImg = unique.filter(function(i) { return i.image; }).length;
  console.log(
    "[collector] images=" + withImg + "/" + unique.length +
    "; saved date=" + dateKey +
    " total=" + unique.length + " (daily replace) purged=" + removed +
    " strippedHotFromNews=" + purgedHot
  );

  // Hotspots（清晨快照，全量替换当日）
  console.log("[collector] collecting hotspots...");
  var hotTotal = 0;
  try {
    var hot = await collectHotspots();
    var hotSaved = upsertHotspotsToday(hot.items);
    hotTotal = hotSaved.total || 0;
    console.log(
      "[collector] hotspots saved added=" + hotSaved.added +
      " updated=" + hotSaved.updated + " total=" + hotSaved.total
    );
  } catch (hotErr) {
    console.error("[collector] hotspots failed:", hotErr && hotErr.message ? hotErr.message : hotErr);
  }

  // Wordcloud + explanations
  console.log("[collector] building wordcloud...");
  try {
    var wc = await buildWordcloud(todayKey());
    console.log("[collector] wordcloud words=" + ((wc && wc.words) || []).length);
  } catch (wcErr) {
    console.error("[collector] wordcloud failed:", wcErr && wcErr.message ? wcErr.message : wcErr);
  }

  return {
    date: todayKey(),
    news: unique.length,
    hotspots: hotTotal
  };
}

if (require.main === module) {
  runCollector().catch(function(err) {
    console.error("[collector] fatal", err);
    process.exit(1);
  });
}

module.exports = { runCollector, newsWindow };
