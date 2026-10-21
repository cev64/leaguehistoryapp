const fs = require('fs'), vm = require('vm');
const R = require('path').resolve(__dirname, '../..') + '/';
const store = {};
const ctx = { console, setTimeout, clearTimeout, Promise, URL, URLSearchParams, Intl, JSON, Math, Date, TextDecoder,
  location: { search: '?league=' + (process.argv[2] || 'demo'), href: 'https://pigskinpantheon.com/season.html?league=demo' },
  localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
  addEventListener() {}, document: undefined,
  fetch: async (u, i) => fetch(new URL(u, 'https://pigskinpantheon.com/'), i),
};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
// The app's copy of account-config.js (no plans or prices), as the app bundles it.
const appConfig = require('path').join(require('os').tmpdir(), 'pp-app-account-config.js');
require('child_process').execFileSync('sh', [R + 'ios/tools/app-account-config.sh', R + 'account-config.js', appConfig]);
const files = [appConfig,'ios/PigskinPantheon/Engine/engine-core.js','sleeper.js','espn.js','demo.js','insights.js','ios/PigskinPantheon/Engine/season-engine.js','clubhouse.js', ...fs.readdirSync(R+'ios/PigskinPantheon/Engine').filter(f=>f.startsWith('bridge-')).sort().map(f=>'ios/PigskinPantheon/Engine/'+f)];
for (const f of files) vm.runInContext(fs.readFileSync(f.startsWith('/') ? f : R + f, 'utf8'), ctx, { filename: f });
globalThis.B = ctx.Bridge;
const expr = process.argv[3];
(async () => {
  const s = await ctx.Bridge.load();
  const out = await vm.runInContext(`(async () => (${expr}))()`, ctx);
  const text = JSON.stringify(out);
  console.log(text.length > 3000 ? text.slice(0, 3000) + ` …(${text.length} bytes)` : text);
})().catch(e => { console.error('FAIL', e); });
