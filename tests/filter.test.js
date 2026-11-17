// Regression tests for Unreel/Resources/filter.js.
//
// Each file in filter/ loads filter.js into a mock Instagram page (jsdom),
// exercises one behaviour and prints what happened. This runner compares that
// output with the saved, known-good output in filter/expected/.
//
//   node filter.test.js            run and compare
//   node filter.test.js --update   accept the current output as the new expected
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = path.join(__dirname, 'filter');
const expectedDir = path.join(dir, 'expected');
const update = process.argv.includes('--update');
const root = path.join(__dirname, '..');

// Stack-trace lines and absolute paths differ between machines.
const normalize = (text) => text.split('\n')
  .filter((line) => !/^\s+at /.test(line))
  .map((line) => line.split(root).join('<repo>').replace(/\s+$/, ''))
  .join('\n').trim() + '\n';

let failed = 0;
for (const file of fs.readdirSync(dir).filter((f) => /^case\d+\.js$/.test(f)).sort()) {
  const run = spawnSync(process.execPath, [path.join(dir, file)], { encoding: 'utf8', timeout: 120000 });
  const actual = normalize((run.stdout || '') + (run.stderr || ''));
  const expectedFile = path.join(expectedDir, file.replace('.js', '.txt'));
  if (update) { fs.writeFileSync(expectedFile, actual); console.log('  saved ' + file); continue; }
  const expected = fs.existsSync(expectedFile) ? fs.readFileSync(expectedFile, 'utf8') : null;
  if (actual === expected) { console.log('  ok   ' + file); continue; }
  failed++;
  console.log('  FAIL ' + file);
  const a = actual.split('\n'), e = (expected || '').split('\n');
  for (let i = 0; i < Math.max(a.length, e.length); i++) {
    if (a[i] !== e[i]) { console.log('       line ' + (i + 1) + '\n         expected: ' + e[i] + '\n         actual:   ' + a[i]); break; }
  }
}
console.log(update ? '\nexpected output saved' : failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
