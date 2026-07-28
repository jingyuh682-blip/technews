const cloudscraper = require("cloudscraper");

async function findAPI() {
  const body = await cloudscraper.get("https://www.jiqizhixin.com/articles", {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
    }
  });
  
  // Look for API endpoints in the HTML
  const apiPatterns = body.match(/https?:\/\/[^"'\s]*api[^"'\s]*/gi) || [];
  const unique = [...new Set(apiPatterns)];
  console.log("API URLs found:", unique.length);
  unique.forEach(u => console.log("  ", u));
  
  // Also look for graphql or data URLs
  const gqlPatterns = body.match(/https?:\/\/[^"'\s]*(?:graphql|query|articles)[^"'\s]*/gi) || [];
  console.log("\nGraphQL/query URLs:", [...new Set(gqlPatterns)].length);
  [...new Set(gqlPatterns)].forEach(u => console.log("  ", u));
  
  // Look for __NEXT_DATA__ or similar
  if (body.includes("__NEXT_DATA__")) {
    const m = body.match(/<script id="__NEXT_DATA__"[^>]*>(.+?)<\/script>/s);
    if (m) console.log("\nFound __NEXT_DATA__:", m[1].slice(0, 1000));
  }
  if (body.includes("window.__INITIAL")) {
    const m = body.match(/window\.__INITIAL[^=]*=\s*(.+?);/s);
    if (m) console.log("\nFound __INITIAL:", m[1].slice(0, 1000));
  }
  
  // Dump all script src
  const scripts = body.match(/<script[^>]*src="([^"]+)"/g) || [];
  console.log("\nScripts:", scripts.length);
  scripts.slice(0, 10).forEach(s => console.log("  ", s));
}
findAPI().catch(e => console.error(e));