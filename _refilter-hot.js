
const fs = require('fs');
const path = require('path');
const { keepHotspotItem } = require('./hot-sources');
const dir = '/var/www/technews/data';
const f = fs.readdirSync(dir).filter((x) => /^\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort().pop();
const p = path.join(dir, f);
const d = JSON.parse(fs.readFileSync(p, 'utf8'));
const before = (d.hotspots || []).length;
d.hotspots = (d.hotspots || []).filter(keepHotspotItem);
fs.writeFileSync(p, JSON.stringify(d));
console.log(f, 'before', before, 'after', d.hotspots.length);
d.hotspots.slice(0, 18).forEach((h, i) => {
  console.log(String(i + 1).padStart(2), (h.source || '').slice(0, 14), '|', (h.title || '').slice(0, 72));
});
