const cloudscraper = require("cloudscraper");

async function test() {
  try {
    const body = await cloudscraper.get("https://www.jiqizhixin.com/articles", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
      }
    });
    console.log("OK - LENGTH:", body.length);
    // Check if we got real content or the landing page
    const hasArticles = body.includes("article") || body.includes("文章") || body.includes("title");
    console.log("HAS_ARTICLES:", hasArticles);
    console.log("FIRST 400:", body.slice(0, 400));
  } catch(e) {
    console.log("ERROR:", String(e.message||e).slice(0, 300));
  }
}
test();