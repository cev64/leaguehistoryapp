/* Parse every page's inline script and the shared scripts, without running
   them. A syntax error anywhere in a page's one big inline script stops the
   whole page from drawing, so run this before pushing a change to a page:

     node tools/check-scripts.mjs

   Exits non-zero, naming the page and the error, if anything fails to parse.
   Import maps and modules are skipped (they are not classic scripts). */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
for (const f of fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'))) {
  const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const [i, m] of [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)].entries()) {
    if (/type="(module|importmap|application\/ld\+json)"/.test(m[1])) continue;
    try { new vm.Script(m[2], { filename: `${f} (inline script ${i})` }); }
    catch (e) { failed++; console.error(`${f}: ${e.message}`); }
  }
}
for (const f of fs.readdirSync(ROOT).filter((f) => f.endsWith('.js'))) {
  try { new vm.Script(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }); }
  catch (e) { failed++; console.error(`${f}: ${e.message}`); }
}
console.log(failed ? `${failed} script(s) failed to parse` : 'all scripts parse');
process.exit(failed ? 1 : 0);
