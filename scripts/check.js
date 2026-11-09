// Перевірка синтаксису кожного файлу (node --check). shortcut: це не повноцінний лінтер, ESLint + Prettier варто додати, коли знадобляться правила стилю.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const files = [];
(function walk(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'data', '.git'].includes(f.name)) continue;
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p);
    else if (f.name.endsWith('.js')) files.push(p);
  }
})(root);

for (const f of files) execFileSync(process.execPath, ['--check', f], { stdio: 'inherit' });
console.log(`syntax ok: ${files.length} files`);
