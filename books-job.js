#!/usr/bin/env node
/**
 * 图书洞察：每周一 08:30 执行一次
 * crontab: 30 8 * * 1
 */
const { ensureDataDir, todayKey, purgeExpired } = require('./store');
const { buildBooksInsight } = require('./books');

async function main() {
  ensureDataDir();
  console.log('[books-job] start', new Date().toISOString());
  purgeExpired();
  const books = await buildBooksInsight(todayKey(), { forceCrawl: true });
  console.log(
    '[books-job] done bestsellers=' +
      ((books && books.bestsellers) || []).length +
      ' planning=' +
      ((books && books.planning) || []).length
  );
}

main().catch((err) => {
  console.error('[books-job] fatal', err);
  process.exit(1);
});
