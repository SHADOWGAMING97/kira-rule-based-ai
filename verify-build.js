#!/usr/bin/env node
/**
 * verify-build.js — run this AFTER `npx cap sync android`, BEFORE
 * installing the APK on a device. Same 3-stage pattern proven on the
 * LSA_Life_Change_Backend Capacitor port, where it caught two real
 * bugs: (1) synced assets missing real logic entirely (bundler
 * incompatibility), and (2) source living outside webDir so `cap
 * sync` could never copy it regardless of any bundler question.
 * Kira's services/ was co-located inside src/www/ from the very
 * start of this build specifically to avoid repeating bug #2 — this
 * script still checks for it, since "designed correctly" and
 * "verified correctly" are not the same claim.
 *
 * Stages:
 * 1. Every relative import inside src/www/ resolves to a file INSIDE
 *    src/www/ (webDir). An import resolving outside webDir will not
 *    exist after a real `cap sync`, regardless of anything else.
 * 2. Synced Android assets actually contain real app-logic markers,
 *    not just HTML/CSS shell.
 * 3. Synced assets are byte-identical to source (staleness check).
 *
 * Usage: node verify-build.js
 * Exit code 0 = safe to build, non-zero = do NOT build/install yet.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, dirname } from 'path';

const ANDROID_ASSETS = 'android/app/src/main/assets/public';
const SOURCE_WWW = 'src/www';

const REQUIRED_MARKERS = [
  'runSecurityGate',
  'routeNeed',
  'categorizeWord',
  'MarkovEngine',
  'validateLearnUrl',
  'class Brain1',
  'nativePromise',
];

function collectFiles(dir, exts) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...collectFiles(full, exts));
    else if (exts.some(ext => entry.endsWith(ext))) out.push(full);
  }
  return out;
}

function checkImportsStayInsideWebDir() {
  const problems = [];
  const files = collectFiles(SOURCE_WWW, ['.js', '.html', '.mjs']);
  const importRe = /from\s+['"](\.[^'"]+)['"]/g;

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    let match;
    while ((match = importRe.exec(content)) !== null) {
      const importPath = match[1];
      const resolved = join(dirname(file), importPath);
      const rel = relative(SOURCE_WWW, resolved);
      if (rel.startsWith('..')) {
        problems.push(`${file}: imports '${importPath}' -> resolves OUTSIDE ${SOURCE_WWW}/ (${resolved})`);
      } else if (!existsSync(resolved)) {
        problems.push(`${file}: imports '${importPath}' -> ${resolved}, which does not exist.`);
      }
    }
  }
  return problems;
}

function checkMissingLogic(assetFiles) {
  let combined = '';
  for (const f of assetFiles) combined += readFileSync(f, 'utf8');
  return REQUIRED_MARKERS.filter(marker => !combined.includes(marker));
}

function checkStaleness() {
  const problems = [];
  const files = collectFiles(SOURCE_WWW, ['.js', '.html', '.mjs']);
  for (const src of files) {
    const relPath = relative(SOURCE_WWW, src);
    const target = join(ANDROID_ASSETS, relPath);
    if (!existsSync(target)) {
      problems.push(`${src} -> not found at ${target} (did you run \`npx cap sync android\`?)`);
      continue;
    }
    if (readFileSync(src, 'utf8') !== readFileSync(target, 'utf8')) {
      problems.push(`${src} differs from ${target} — source was edited after the last sync`);
    }
  }
  return problems;
}

function checkNoBareCapacitorImports() {
  const problems = [];
  const files = collectFiles(SOURCE_WWW, ['.js', '.html', '.mjs']);
  // Matches only a real import statement at the start of a line
  // (optionally indented) — deliberately does NOT match the same
  // text appearing inside a comment or string, so this doesn't
  // false-positive on files that document the bug in a code example.
  const bareImportRe = /^[ \t]*import\s+.*?from\s+['"](@capacitor\/[^'"]+)['"]/gm;
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    let match;
    while ((match = bareImportRe.exec(content)) !== null) {
      problems.push(
        `${file}: imports '${match[1]}' as a bare specifier. This project has no ` +
        `bundler, so this will throw "Failed to resolve module specifier" at runtime ` +
        `in a real WebView (Node's module resolution masks this — it only fails in an ` +
        `actual browser). Use window.Capacitor.Plugins.<Name> or ` +
        `Capacitor.nativePromise(...) directly instead (see nativeHttp.js / storage.js).`
      );
    }
  }
  return problems;
}

function main() {
  console.log('Step 1/4: checking for bare @capacitor/* imports (these cannot resolve without a bundler)...\n');
  const bareImportProblems = checkNoBareCapacitorImports();
  if (bareImportProblems.length > 0) {
    console.error(`FAIL: found bare @capacitor/* import(s).\n\n${bareImportProblems.join('\n\n')}\n\nDO NOT proceed until this passes.`);
    process.exit(1);
  }
  console.log('PASS: no bare @capacitor/* imports found.\n');

  console.log('Step 2/4: checking all imports inside src/www/ stay inside webDir...\n');
  const importProblems = checkImportsStayInsideWebDir();
  if (importProblems.length > 0) {
    console.error(
      `FAIL: found import(s) resolving outside ${SOURCE_WWW}/ (webDir).\n\n${importProblems.join('\n\n')}\n\n` +
      `Fix: move the file(s) inside ${SOURCE_WWW}/ and update the relative import to match.\n\nDO NOT proceed until this passes.`
    );
    process.exit(1);
  }
  console.log('PASS: all imports resolve inside webDir.\n');

  console.log(`Step 3/4: checking ${ANDROID_ASSETS} contains real app logic...\n`);
  if (!existsSync(ANDROID_ASSETS)) {
    console.error(`FAIL: ${ANDROID_ASSETS} does not exist yet. Run \`npx cap sync android\` first.`);
    process.exit(1);
  }
  const assetFiles = collectFiles(ANDROID_ASSETS, ['.js', '.html', '.mjs']);
  if (assetFiles.length === 0) {
    console.error(`FAIL: no .js/.html files found under ${ANDROID_ASSETS}.`);
    process.exit(1);
  }
  const missing = checkMissingLogic(assetFiles);
  if (missing.length > 0) {
    console.error(
      `FAIL: missing app-logic markers: ${missing.join(', ')}\n\n` +
      `This project has no bundler — src/www/ is self-contained with plain relative\n` +
      `imports. \`npx cap sync android\` should copy it unmodified. Do not run any\n` +
      `bundling step before \`cap sync\`.\n\nDO NOT build/install until this passes.`
    );
    process.exit(1);
  }
  console.log(`PASS: all required markers found across ${assetFiles.length} synced file(s).\n`);

  console.log('Step 4/4: checking synced assets are not stale...\n');
  const stale = checkStaleness();
  if (stale.length > 0) {
    console.error(`FAIL: synced assets are STALE.\n\nMismatches:\n  ${stale.join('\n  ')}\n\nRun \`npx cap sync android\` again.`);
    process.exit(1);
  }
  console.log('PASS: synced assets exactly match source.\n');
  console.log('All checks passed — safe to proceed with `npm run build:android` / installing the APK.');
}

main();
