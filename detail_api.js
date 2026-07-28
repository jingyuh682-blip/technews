const cloudscraper = require("cloudscraper");

async function main() {
  const body = await cloudscraper.get("https://www.jiqizhixin.com/api/v1/articles", {
    headers: {
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      "Referer": "https://www.jiqizhixin.com/articles"
    }
  });
  
  const data = JSON.parse(body);
  console.log("Total articles:", data.length);
  
  // Show first 3 articles fully
  data.slice(0, 3).forEach((a, i) => {
    console.log("\n--- Article", i+1, "---");
    console.log(JSON.stringify(a, null, 2));
  });
}
main().catch(e => console.error(e));