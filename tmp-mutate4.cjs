const fs = require('fs');
const cp = require('child_process');
const p = 'apps/mobile/src/components/chat/native-composer/token-ranges.ts';
const raw = fs.readFileSync(p, 'utf8');
const crlf = raw.includes('\r\n');
const nl = crlf ? '\r\n' : '\n';
const base = raw.replace(/\r\n/g, '\n');
const from = '  if (token.length < 3 || token[0] !== token[token.length - 1]) {\n    return token;\n  }\n';
if (!base.includes(from)) {
  console.log('ANCHOR_MISS');
  process.exit(1);
}
fs.writeFileSync(p, crlf ? base.replace(from, '').replace(/\n/g, nl) : base.replace(from, ''));
let r;
try {
  r = cp.execSync('node ../../node_modules/jest/bin/jest.js __tests__/native-composer.test.tsx --maxWorkers=1 --silent', {cwd: 'apps/mobile', encoding: 'utf8', stdio: 'pipe'});
} catch (e) {
  r = (e.stdout || '') + (e.stderr || '');
}
console.log('GUARD_REMOVED: ' + (r.match(/Tests:.*/) || ['?'])[0].trim());
fs.writeFileSync(p, raw);
console.log('RESTORED', fs.readFileSync(p, 'utf8') === raw);
