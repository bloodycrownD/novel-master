const fs = require('fs');
const cp = require('child_process');
const p = 'apps/mobile/src/services/session-stream-unit-manager.service.ts';
const raw = fs.readFileSync(p, 'utf8');
const crlf = raw.includes('\r\n');
const nl = crlf ? '\r\n' : '\n';
const norm = s => s.replace(/\r\n/g, '\n');
const muts = [
  ['runId同值守卫', ' ||\n        unit.getRunId() === payload.runId', '', 'F-B3'],
  ['settled守卫', '        !isSessionStreamUnitSettled(unit.getStatus()) ||\n', '', 'F-B3'],
  ['consumptive守卫', '        !this.consumptiveSessions.has(payload.sessionId) ||\n', '', 'F-B3'],
  ['runId回填', '      if (!unit.markRunning(payload.runId)) {\n        return;\n      }\n      // 新单元 messages', '      // 新单元 messages', 'F-B3'],
];
const out = [];
const base = norm(raw);
for (const [name, from, to, pat] of muts) {
  if (!base.includes(from)) {
    out.push(name + ': ANCHOR_MISS');
    continue;
  }
  const mutated = base.replace(from, to);
  fs.writeFileSync(p, crlf ? mutated.replace(/\n/g, nl) : mutated);
  let r;
  try {
    r = cp.execSync('node ../../node_modules/jest/bin/jest.js __tests__/session-stream-unit-messages.test.ts -t "' + pat + '" --maxWorkers=1 --silent', {cwd: 'apps/mobile', encoding: 'utf8', stdio: 'pipe'});
  } catch (e) {
    r = (e.stdout || '') + (e.stderr || '');
  }
  const line = (r.match(/Tests:.*/) || ['?'])[0].trim();
  out.push(name + ': ' + line);
}
fs.writeFileSync(p, raw);
console.log(out.join('\n'));
console.log('RESTORED', fs.readFileSync(p, 'utf8') === raw, 'crlf=' + crlf);
