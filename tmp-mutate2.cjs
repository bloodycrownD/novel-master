const fs = require('fs');
const cp = require('child_process');
const p = 'apps/mobile/src/web/chat-transcript/webview/ui/render/RefTokenText.tsx';
const raw = fs.readFileSync(p, 'utf8');
const crlf = raw.includes('\r\n');
const nl = crlf ? '\r\n' : '\n';
const base = raw.replace(/\r\n/g, '\n');
const muts = [
  ['cursor未推进', '    cursor = end;', '    cursor = match.end;'],
  ['跳过相邻命中', '    if (match.index < cursor) continue;', '    if (match.index <= cursor) continue;'],
];
const out = [];
for (const [name, from, to] of muts) {
  if (!base.includes(from)) {
    out.push(name + ': ANCHOR_MISS');
    continue;
  }
  const mutated = base.replace(from, to);
  fs.writeFileSync(p, crlf ? mutated.replace(/\n/g, nl) : mutated);
  let r;
  try {
    r = cp.execSync('node ../../node_modules/jest/bin/jest.js __tests__/chat-transcript-ref-token.test.ts --maxWorkers=1 --silent', {cwd: 'apps/mobile', encoding: 'utf8', stdio: 'pipe'});
  } catch (e) {
    r = (e.stdout || '') + (e.stderr || '');
  }
  out.push(name + ': ' + (r.match(/Tests:.*/) || ['?'])[0].trim());
}
fs.writeFileSync(p, raw);
console.log(out.join('\n'));
console.log('RESTORED', fs.readFileSync(p, 'utf8') === raw);
