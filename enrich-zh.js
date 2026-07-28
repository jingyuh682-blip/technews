/**
 * Backfill titleZh / summaryZh for existing papers & github without full re-crawl.
 * Usage: node enrich-zh.js
 */
const { todayKey, readDay, savePapers, saveGithub, listAvailableDates } = require('./store');
const { enrichItemsZh } = require('./translate-research');

async function main() {
  const dates = listAvailableDates();
  let target = null;
  for (const d of dates) {
    const day = readDay(d);
    if ((day.papers && day.papers.items && day.papers.items.length) ||
        (day.github && day.github.items && day.github.items.length)) {
      target = d;
      break;
    }
  }
  if (!target) target = todayKey();
  const day = readDay(target);
  console.log('[enrich-zh] date', target);

  if (day.papers && Array.isArray(day.papers.items) && day.papers.items.length) {
    const items = await enrichItemsZh(day.papers.items, 'paper');
    savePapers(target, { ...day.papers, items, updatedAt: new Date().toISOString() });
    console.log('[enrich-zh] papers', items.length, 'withZh', items.filter((i) => i.titleZh && i.summaryZh).length);
  }
  if (day.github && Array.isArray(day.github.items) && day.github.items.length) {
    const items = await enrichItemsZh(day.github.items, 'github');
    saveGithub(target, { ...day.github, items, updatedAt: new Date().toISOString() });
    console.log('[enrich-zh] github', items.length, 'withZh', items.filter((i) => i.summaryZh).length);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
