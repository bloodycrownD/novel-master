const fs = require('fs');
const cp = require('child_process');
const p = 'apps/mobile/src/components/chat/composer-highlight.ts';
const raw = fs.readFileSync(p, 'utf8');
const crlf = raw.includes('\r\n');
const nl = crlf ? '\r\n' : '\n';
const base = raw.replace(/\r\n/g, '\n');
const from = 'const COMPOSER_TOKEN_RE = /@([^\\s@$]+)@|\\$([^\\s$@]+)\\$/g;';
const to = 'const COMPOSER_TOKEN_RE = /@([^\\s@$]+)|\\$([^\\s$@]+)/g;';
if (!base.includes(from)) {
  console.log('ANCHOR_MISS');
  process.exit(1);
}
fs.writeFileSync(p, crlf ? base.replace(from, to).replace(/\n/g, nl) : base.replace(from, to));
let r;
try {
  r = cp.execSync('node ../../node_modules/jest/bin/jest.js __tests__/use-chat-composer-controller.test.tsx -t "T-CA3" --maxWorkers=1 --silent', {cwd: 'apps/mobile', encoding: 'utf8', stdio: 'pipe'});
} catch (e) {
  r = (e.stdout || '') + (e.stderr || '');
}
console.log('MUTATED_REGEX: ' + (r.match(/Tests:.*/) || ['?'])[0].trim());
fs.writeFileSync(p, raw);
console.log('RESTORED', fs.readFileSync(p, 'utf8') === raw);
