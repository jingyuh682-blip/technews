/**
 * 自定义抓取源（爬虫）
 * 用于没有RSS但可通过API/HTML抓取的网站
 */
const cloudscraper = require("cloudscraper");
const cheerio = require("cheerio");
const { makeId } = require("./store");
const { KEYWORDS } = require("./sources");

// 中文检测
function hasChinese(text) {
  const m = String(text || "").match(/[\u4e00-\u9fff\u3400-\u4dbf]/g);
  return m ? m.length : 0;
}

// 关键词匹配
function matchKeywordsTitle(title) {
  const t = String(title || "").toLowerCase();
  return KEYWORDS.filter(function(k) {
    return t.indexOf(String(k).toLowerCase()) !== -1;
  });
}

// 去HTML标签
function stripTags(html) {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

// ===== 机器之心 jiqizhixin.com =====
async function fetchJiqizhixin() {
  const articles = [];
  const perPage = 15;
  const maxPages = 3; // fetch up to 3 pages (45 articles)

  try {
    for (var page = 1; page <= maxPages; page++) {
      const url = "https://www.jiqizhixin.com/api/article_library/articles.json?sort=time&page=" + page + "&per=" + perPage;
      const body = await cloudscraper.get(url, {
        headers: {
          "Accept": "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
          "Referer": "https://www.jiqizhixin.com/articles"
        }
      });

      const data = JSON.parse(body);
      if (!data.success || !Array.isArray(data.articles)) break;

      for (var i = 0; i < data.articles.length; i++) {
        var a = data.articles[i];
        if (!a.title || !a.slug) continue;

        // Filter: keyword in title
        if (matchKeywordsTitle(a.title).length === 0) continue;

        // Filter: Chinese content
        var summary = stripTags((a.content || "").slice(0, 320));
        if (hasChinese(a.title + summary) < 2) continue;

        var articleUrl = "https://www.jiqizhixin.com/articles/" + a.slug;
        articles.push({
          id: makeId(articleUrl),
          title: stripTags(a.title).slice(0, 240),
          summary: summary,
          contentHtml: String(a.content || "").slice(0, 50000),
          image: a.coverImageUrl || "",
          sourceId: "jiqizhixin",
          source: "机器之心",
          url: articleUrl,
          publishedAt: a.publishedAt
            ? new Date(a.publishedAt.replace(/\//g, "-") + ":00+08:00").toISOString()
            : new Date().toISOString(),
          collectedAt: new Date().toISOString()
        });
      }

      if (!data.hasNextPage) break;
      // Small delay between pages
      await new Promise(function(r) { setTimeout(r, 500); });
    }

    return { ok: true, source: "jiqizhixin", count: articles.length, items: articles };
  } catch (err) {
    return {
      ok: false,
      source: "jiqizhixin",
      error: String(err && err.message ? err.message : err),
      items: []
    };
  }
}

// ===== 自定义源注册表 =====
const CUSTOM_SOURCES = {
  jiqizhixin: fetchJiqizhixin
};

module.exports = { CUSTOM_SOURCES };
