const cloudscraper = require("cloudscraper");
const cheerio = require("cheerio");

async function parse() {
  const body = await cloudscraper.get("https://www.jiqizhixin.com/articles", {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
    }
  });
  
  const $ = cheerio.load(body);
  
  // Find article links
  const articles = [];
  $("a[href]").each(function() {
    const href = $(this).attr("href");
    const text = $(this).text().trim();
    if (href && text && text.length > 10 && href.includes("/articles/")) {
      articles.push({ title: text.slice(0, 80), url: href });
    }
  });
  
  console.log("Found", articles.length, "articles:");
  articles.slice(0, 10).forEach((a, i) => {
    console.log(i+1 + ".", a.title);
    console.log("   URL:", a.url);
  });
  
  // Also dump relevant HTML structure
  console.log("\n--- HTML structure ---");
  // Look for article containers
  const selectors = ["article", ".article", ".post", ".item", "[class*=article]", "[class*=post]", "[class*=list]"];
  selectors.forEach(sel => {
    const count = $(sel).length;
    if (count > 0) console.log("  " + sel + ": " + count + " elements");
  });
  
  // Show body classes/structure
  console.log("\n--- Body classes ---");
  console.log($("body").attr("class") || "(none)");
  
  // Show main content area
  const main = $("main, #app, .app, .content, .container").first();
  if (main.length) {
    console.log("\n--- Main content ---");
    console.log(main.html().slice(0, 1000));
  } else {
    console.log("\n--- Body snippet ---");
    console.log($("body").html().slice(0, 1000));
  }
}
parse().catch(e => console.error(e));