#!/usr/bin/env node
/**
 * 论文 / GitHub 定时任务
 *   node research-job.js papers   # 每周一 08:30
 *   node research-job.js github   # 每周一 08:30
 *   node research-job.js all
 */
const mode = String(process.argv[2] || 'all').toLowerCase();
const { ensureDataDir, todayKey, purgeExpired } = require('./store');
const { buildPapers } = require('./papers');
const { buildGithub } = require('./github-hot');

async function main() {
  ensureDataDir();
  purgeExpired();
  console.log('[research-job] start', mode, new Date().toISOString());
  if (mode === 'papers' || mode === 'all') {
    const papers = await buildPapers(todayKey(), { force: true });
    console.log('[research-job] papers', (papers.items || []).length);
  }
  if (mode === 'github' || mode === 'all') {
    const github = await buildGithub(todayKey(), { force: true });
    console.log('[research-job] github', (github.items || []).length);
  }
  console.log('[research-job] done');
}

main().catch((err) => {
  console.error('[research-job] fatal', err);
  process.exit(1);
});
