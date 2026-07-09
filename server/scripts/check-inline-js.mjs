#!/usr/bin/env node
/**
 * check-inline-js.mjs
 *
 * The workshop server has a single HTML page with an inline <script> block
 * generated at runtime by the renderWebPage() function in src/routes/web.ts.
 * That script is NOT parsed by TypeScript (the TS compiler treats template
 * literal contents as opaque strings) and NOT parsed by esbuild (esbuild
 * only handles src/web/x402-client.ts).
 *
 * This script extracts the inline <script> content from web.ts and runs
 * `node --check` against it so syntax errors fail the build instead of
 * reaching participants in the browser.
 *
 * History: 2026-07-09 — a \n inside a string literal inside the TS template
 * literal produced a real newline in the served HTML, which made the page JS
 * a syntax error. The error broke every event listener on the page, including
 * the "Connect wallet" button visibility logic. This lint step would have
 * caught it at build time.
 */
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const WEB_TS = "src/routes/web.ts";

function extractInlineScripts() {
  const src = readFileSync(WEB_TS, "utf8");
  // We only care about template literals (backtick strings).
  // Walk char by char so we don't get confused by backticks inside strings.
  const scripts = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "`") {
      const end = findClosingBacktick(src, i + 1);
      if (end === -1) break;
      const block = src.slice(i + 1, end);
      // Extract every <script>...</script> body in this template literal.
      const re = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g;
      let m;
      while ((m = re.exec(block)) !== null) {
        scripts.push(m[1]);
      }
      i = end + 1;
    } else {
      i++;
    }
  }
  return scripts;
}

function findClosingBacktick(src, start) {
  // Skip escaped backticks \`. Also skip ${...} template substitutions
  // (we don't expect any in our HTML template, but be safe).
  let depth = 0;
  let i = start;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\") { i += 2; continue; }
    if (ch === "$" && src[i + 1] === "{") {
      depth++;
      i += 2;
      continue;
    }
    if (ch === "}" && depth > 0) { depth--; i++; continue; }
    if (ch === "`" && depth === 0) return i;
    i++;
  }
  return -1;
}

function main() {
  const scripts = extractInlineScripts();
  if (scripts.length === 0) {
    console.log("[check-inline-js] No inline <script> blocks found in " + WEB_TS);
    return;
  }
  const tmp = mkdtempSync(join(tmpdir(), "check-inline-js-"));
  let failed = false;
  for (let n = 0; n < scripts.length; n++) {
    const file = join(tmp, `script-${n}.js`);
    writeFileSync(file, scripts[n]);
    const result = spawnSync(process.execPath, ["--check", file], {
      encoding: "utf8",
    });
    if (result.status !== 0) {
      failed = true;
      console.error(`[check-inline-js] FAIL inline script #${n} (${scripts[n].length} bytes):`);
      console.error(result.stderr);
    } else {
      console.log(`[check-inline-js] OK   inline script #${n} (${scripts[n].length} bytes)`);
    }
  }
  // Cleanup
  for (let n = 0; n < scripts.length; n++) {
    try { unlinkSync(join(tmp, `script-${n}.js`)); } catch {}
  }
  if (failed) {
    console.error("[check-inline-js] One or more inline scripts failed to parse.");
    process.exit(1);
  }
  console.log("[check-inline-js] All inline scripts parse cleanly.");
}

main();
