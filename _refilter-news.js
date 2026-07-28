
const fs = require('fs');
const path = require('path');
const { keepNewsItem } = require('./content-filter');
const dir = '/var/www/technews/data';
const f = fs.readdirSync(dir).filter((x) => /^\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort().pop();
const p = path.join(dir, f);
const d = JSON.parse(fs.readFileSync(p, 'utf8'));
const before = (d.items || []).length;
d.items = (d.items || []).filter(keepNewsItem);
fs.writeFileSync(p, JSON.stringify(d));
console.log(f, 'news before', before, 'after', d.items.length);
d.items.slice(0, 20).forEach((h, i) => {
  console.log(String(i + 1).padStart(2), (h.source || '').slice(0, 12), '|', (h.title || '').slice(0, 72));
});
