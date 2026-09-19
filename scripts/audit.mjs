/**
 * Repeatable static audit.
 *
 * These are the checks that can be mechanised. The judgement-based ones
 * (resource lifetimes, error paths, accessibility) are listed in docs/audit.md
 * and performed by reading; this script exists so the mechanical half of an
 * audit pass is identical every time rather than depending on what I remember
 * to grep for.
 *
 * Exit code is the number of findings, so `npm run audit` fails CI-style.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const findings = [];
const finding = (check, file, message) => findings.push({ check, file, message });

/** Every source file under the given roots, by extension. */
function walk(dir, exts, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const st = statSync(full);
    if (st.isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => entry.endsWith(e))) out.push(full.replace(/\\/g, '/'));
  }
  return out;
}

const APP_TS = [...walk('src', ['.ts', '.tsx']), ...walk('electron', ['.ts']), ...walk('shared', ['.ts'])];
const UI_TSX = walk('src', ['.tsx']).filter((f) => !f.includes('/i18n/'));
const read = (f) => readFileSync(f, 'utf8');

/* ------------------------------------------------------------------ i18n */

// 1. Literals that look like user-facing English left in the UI.
{
  const allow = /^(Apache-2\.0|MIT|Images\.pdf|OFL-1\.1|PDF|A4|Letter)$/;
  for (const f of UI_TSX) {
    const src = read(f);
    for (const m of src.matchAll(/'([A-Z][a-z]+(?: [a-z]+){1,}[.!?]?)'/g)) {
      if (!allow.test(m[1])) finding('i18n.literals', f, `untranslated literal: '${m[1]}'`);
    }
    // Bare prose in JSX (a line of words with no braces or tags).
    for (const line of src.split('\n')) {
      if (/^\s{6,}[A-Z][a-z]+( [a-z]+){2,}[.,]?\s*$/.test(line) && !line.includes('//')) {
        finding('i18n.literals', f, `bare JSX prose: ${line.trim().slice(0, 50)}`);
      }
    }
  }
}

// 2. A useCallback that calls t() must list t as a dependency, or it keeps the
//    previous language after a switch.
for (const f of walk('src', ['.tsx'])) {
  const src = read(f);
  for (const m of src.matchAll(/useCallback\((.*?)\n {2}\}, \[([^\]]*)\]\);/gs)) {
    if (/\bt\('/.test(m[1]) && !/\bt\b/.test(m[2])) {
      finding('i18n.staleT', f, `useCallback near line ${src.slice(0, m.index).split('\n').length} calls t() but omits it from deps`);
    }
  }
}

// 3. Placeholder parity: a {name} present in one language but not the other
//    renders literally at run time, and nothing else catches it.
{
  const src = read('src/i18n/strings.ts');
  const section = (name) => {
    const start = src.indexOf(`export const ${name}: Strings = {`);
    const end = src.indexOf('\n};', start);
    return src.slice(start, end);
  };
  const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  const entries = (text) => {
    const map = new Map();
    // Each key, with everything up to the next top-level key.
    const re = /^ {2}'([^']+)':\s*([\s\S]*?)(?=^ {2}'|\Z)/gm;
    for (const m of text.matchAll(re)) map.set(m[1], m[2]);
    return map;
  };
  const en = entries(section('en'));
  const he = entries(section('he'));
  for (const [key, enVal] of en) {
    const heVal = he.get(key);
    if (heVal === undefined) continue; // the compiler already enforces presence
    const a = new Set(placeholders(enVal));
    const b = new Set(placeholders(heVal));
    for (const p of a) {
      if (!b.has(p)) finding('i18n.placeholders', 'src/i18n/strings.ts', `${key}: en has {${p}}, he does not`);
    }
    for (const p of b) {
      if (!a.has(p)) finding('i18n.placeholders', 'src/i18n/strings.ts', `${key}: he has {${p}}, en does not`);
    }
  }
}

/* ------------------------------------------------------------------- CSS */

// 4. Physical properties break RTL; logical ones mirror automatically.
{
  const css = read('src/styles.css');
  const rtlBlock = /\[dir="rtl"\]/;
  css.split('\n').forEach((line, i) => {
    if (rtlBlock.test(line)) return; // deliberate RTL-only overrides are fine
    const m = /(border-(left|right)(-color)?|margin-(left|right)|padding-(left|right))\s*:/.exec(line)
      || /text-align:\s*(left|right)/.exec(line)
      || /^\s+(left|right)\s*:/.exec(line);
    if (m) finding('css.physical', 'src/styles.css', `line ${i + 1}: ${line.trim().slice(0, 60)}`);
  });
}

/* --------------------------------------------------------------- hygiene */

// 5. Debug output left behind. Deliberate logging lives in scripts/ and main.
for (const f of APP_TS) {
  read(f).split('\n').forEach((line, i) => {
    if (/console\.(log|debug|dir)\(/.test(line) && !line.trim().startsWith('//')) {
      finding('hygiene.console', f, `line ${i + 1}: ${line.trim().slice(0, 50)}`);
    }
  });
}

// 6. Unfinished markers.
for (const f of APP_TS) {
  read(f).split('\n').forEach((line, i) => {
    if (/\b(TODO|FIXME|XXX|HACK)\b/.test(line)) {
      finding('hygiene.markers', f, `line ${i + 1}: ${line.trim().slice(0, 60)}`);
    }
  });
}

// 7. Literal control characters in source (they survive edits invisibly).
for (const f of APP_TS) {
  const src = read(f);
  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i);
    if (c < 9 || (c > 10 && c < 13) || (c > 13 && c < 32)) {
      finding('hygiene.controlChars', f, `control char 0x${c.toString(16)} at offset ${i}`);
      break;
    }
  }
}

// 8. Exported symbols nothing imports: either dead or an incomplete refactor.
{
  const all = APP_TS.map((f) => ({ f, src: read(f) }));
  for (const { f, src } of all) {
    if (f.endsWith('shared/types.ts') || f.endsWith('src/i18n/strings.ts')) continue;
    for (const m of src.matchAll(/^export (?:async )?(?:function|const|class) (\w+)/gm)) {
      const name = m[1];
      const used = all.some(({ f: other, src: os }) =>
        other !== f && new RegExp(`\\b${name}\\b`).test(os));
      const usedInTests = walk('test', ['.ts']).some((t) => new RegExp(`\\b${name}\\b`).test(read(t)));
      const usedInE2e = walk('e2e', ['.ts', '.tsx']).some((t) => new RegExp(`\\b${name}\\b`).test(read(t)));
      if (!used && !usedInTests && !usedInE2e) {
        finding('hygiene.deadExport', f, `export '${name}' is never imported`);
      }
    }
  }
}

// 9. A doc comment whose next line closes the block documents nothing -- it
//     describes a member that was removed or never added.
for (const f of APP_TS) {
  const lines = read(f).split(String.fromCharCode(10));
  lines.forEach((line, i) => {
    if (!line.trim().endsWith('*/')) return;
    const next = lines.slice(i + 1).find((x) => x.trim());
    if (next && ['}', '};', ')'].includes(next.trim())) {
      finding('hygiene.staleDoc', f, `line ${i + 1}: documents nothing`);
    }
  });
}

/* ------------------------------------------------------------------- ipc */

// 10. The three sides of the IPC surface must agree: a channel the renderer can
//     invoke with no handler fails only at run time, and only on that path.
{
  const preload = read('electron/preload.ts');
  const main = read('electron/main.ts');
  const invoked = new Set([...preload.matchAll(/invoke\('([^']+)'/g)].map((m) => m[1]));
  const handled = new Set([...main.matchAll(/handle\('([^']+)'/g)].map((m) => m[1]));
  for (const ch of invoked) {
    if (!handled.has(ch)) finding('ipc.surface', 'electron/main.ts', `no handler for '${ch}'`);
  }
  for (const ch of handled) {
    if (!invoked.has(ch)) finding('ipc.surface', 'electron/preload.ts', `handler '${ch}' is never invoked`);
  }

  // And the Electron platform adapter must consume exactly what preload exposes.
  // It is the only file in src/ that may touch window.api, so an channel added
  // to preload and forgotten here would be dead on arrival.
  const adapter = read('src/platform/electron.ts');
  const exposed = new Set([...preload.matchAll(/^  (\w+):/gm)].map((m) => m[1]));
  for (const name of exposed) {
    if (!adapter.includes(`window.api.${name}(`)) {
      finding('ipc.surface', 'src/platform/electron.ts', `preload exposes '${name}', the adapter never calls it`);
    }
  }

  // Nothing outside the platform layer may reach the bridge directly. Two files
  // are allowed to name it: the adapter that calls it, and the selector that
  // uses its presence to decide which host this is. Listed rather than excusing
  // the whole directory, so a third file naming it has to be a deliberate edit.
  const MAY_TOUCH_BRIDGE = ['platform/electron.ts', 'platform/select.ts'];
  for (const file of walk('src', ['.ts', '.tsx'])) {
    if (MAY_TOUCH_BRIDGE.some((allowed) => file.endsWith(allowed))) continue;
    if (read(file).includes('window.api')) {
      finding('ipc.surface', file, 'touches window.api directly; go through the platform adapter');
    }
  }
}

/* --------------------------------------------------------------- css */

// 11. A class in the stylesheet that no component uses is either dead or a
//     rename that was only half applied.
{
  const css = read('src/styles.css');
  const markup = [...walk('src', ['.tsx']), ...walk('e2e', ['.tsx']), ...walk('scripts', ['.cjs', '.mjs'])].map(read).join(String.fromCharCode(10));
  const classes = new Set([...css.matchAll(/\.([a-z][\w-]*)(?=[\s,{:.\[])/g)].map((m) => m[1]));
  for (const cls of classes) {
    // Modifier classes are built by template literals (`btn btn--${kind}`), so
    // match the stem as well before calling one unused.
    const stem = cls.split('--')[0];
    if (!markup.includes(cls) && !(cls.includes('--') && markup.includes(stem))) {
      finding('css.unused', 'src/styles.css', `.${cls} is not used by any component`);
    }
  }
}

/* --------------------------------------------------------------- scripts */

// 9. package.json must not reference a script file that no longer exists.
{
  const pkg = JSON.parse(read('package.json'));
  for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
    for (const m of String(cmd).matchAll(/(scripts\/[\w.-]+\.(?:mjs|cjs|js))/g)) {
      try { statSync(m[1]); } catch {
        finding('scripts.missing', 'package.json', `script '${name}' runs ${m[1]}, which does not exist`);
      }
    }
  }
}

/* ---------------------------------------------------------------- report */

const byCheck = new Map();
for (const f of findings) {
  if (!byCheck.has(f.check)) byCheck.set(f.check, []);
  byCheck.get(f.check).push(f);
}

const CHECKS = [
  'i18n.literals', 'i18n.staleT', 'i18n.placeholders',
  'css.physical',
  'hygiene.console', 'hygiene.markers', 'hygiene.controlChars', 'hygiene.deadExport',
  'hygiene.staleDoc', 'ipc.surface', 'css.unused',
  'scripts.missing',
];

for (const check of CHECKS) {
  const hits = byCheck.get(check) ?? [];
  if (!hits.length) {
    console.log(`OK    ${check}`);
  } else {
    console.log(`FAIL  ${check} (${hits.length})`);
    for (const h of hits.slice(0, 12)) console.log(`        ${h.file}: ${h.message}`);
    if (hits.length > 12) console.log(`        ...and ${hits.length - 12} more`);
  }
}

console.log(`\n${findings.length === 0 ? 'AUDIT CLEAN' : `AUDIT: ${findings.length} finding(s)`}`);
process.exit(findings.length === 0 ? 0 : 1);
