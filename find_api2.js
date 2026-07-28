const cloudscraper = require("cloudscraper");

async function main() {
  // Fetch the article_library JS bundle
  const body = await cloudscraper.get("https://cdn.jiqizhixin.com/assets/packs/js/article_library-a750dbef77bf6572295b.js", {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
    }
  });
  
  console.log("Bundle size:", body.length);
  
  // Find API URLs in the bundle
  const apiMatches = body.match(/https?:\/\/[^"'\s]*(?:api|articles|graphql)[^"'\s]*/gi) || [];
  const unique = [...new Set(apiMatches)].slice(0, 20);
  console.log("\nAPI URLs:");
  unique.forEach(u => console.log("  ", u));
  
  // Find paths like /api/...
  const pathMatches = body.match(/["'`]\/(?:api|graphql)[^"'`]*["'`]/gi) || [];
  console.log("\nAPI paths:");
  [...new Set(pathMatches)].slice(0, 20).forEach(p => console.log("  ", p));
}
main().catch(e => console.error(e));