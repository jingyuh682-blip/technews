#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { purgeExpired, DATA_DIR } = require('./store');

const n = purgeExpired();
console.log(`[cleanup] removed ${n} expired day files`);

// purge image cache older than 14 days
const imgDir = path.join(DATA_DIR, 'imgcache');
if (fs.existsSync(imgDir)) {
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const name of fs.readdirSync(imgDir)) {
    const full = path.join(imgDir, name);
    try {
      const st = fs.statSync(full);
      if (st.mtimeMs < cutoff) {
        fs.unlinkSync(full);
        removed += 1;
      }
    } catch (_e) {}
  }
  console.log(`[cleanup] removed ${removed} cached images`);
}
