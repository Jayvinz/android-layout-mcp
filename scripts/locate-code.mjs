#!/usr/bin/env node
/**
 * Deterministic code anchors for a UI element.
 *
 * Given the evidence returned by dli (text / content-description / resource-id /
 * Compose file+line+name), scan an Android repository and rank the places that
 * most likely define or reference that element.
 *
 * Built-ins only: the plugin must run before `npm install`.
 *
 * Usage:
 *   node locate-code.mjs --root . --text "我的" --id profile_tab --json
 *   node locate-code.mjs --root . --compose-file ProfileScreen.kt --compose-line 120 --json
 */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const CODE_EXT = new Set([".kt", ".kts", ".java"]);
const MAX_FILE_BYTES = 1_500_000;
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".gradle",
  ".idea",
  ".cxx",
  "build",
  "dist",
  "out",
  "generated",
  "intermediates",
  "tmp",
  ".tmp",
]);
const TEST_DIR = /(^|\/)(test|androidTest|tests)(\/|$)/i;

function printHelp() {
  console.log(`locate-code.mjs - rank Android source anchors for a UI element

Options:
  --root <dir>                Repository root (default: current directory)
  --text <value>              Visible text; repeatable
  --desc <value>              Content description; repeatable
  --id <value>                Resource id, with or without package; repeatable
  --compose-name <name>       @Composable function name from the JVMTI tree
  --compose-file <file>       File name/path containing the composable
  --compose-line <n>          Line reported by the Compose inspector
  --class <name>              View/Compose class name; repeatable
  --limit <n>                 Maximum candidates (default: 25)
  --include-tests             Include test sources in the ranking
  --exclude <pattern>         Skip path substring; repeatable
  --max-file-bytes <n>        Skip larger files (default: 1500000)
  --json                      Machine-readable output
  --help                      Show this help

Exit codes: 0 success (even with no candidates), 2 bad arguments.`);
}

function parseArgs(argv) {
  const opts = {
    root: process.cwd(),
    texts: [],
    descs: [],
    ids: [],
    composeNames: [],
    composeFiles: [],
    composeLine: null,
    classNames: [],
    limit: 25,
    includeTests: false,
    excludes: [],
    maxFileBytes: MAX_FILE_BYTES,
    json: false,
  };
  const need = (i, flag) => {
    if (i + 1 >= argv.length) fail(`${flag} needs a value`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    let inline = null;
    const eq = arg.indexOf("=");
    if (arg.startsWith("--") && eq !== -1) {
      inline = arg.slice(eq + 1);
      arg = arg.slice(0, eq);
    }
    const value = () => (inline !== null ? inline : need(i++, arg));
    switch (arg) {
      case "--root":
        opts.root = value();
        break;
      case "--text":
        opts.texts.push(value());
        break;
      case "--desc":
        opts.descs.push(value());
        break;
      case "--id":
        opts.ids.push(value());
        break;
      case "--compose-name":
        opts.composeNames.push(value());
        break;
      case "--compose-file":
        opts.composeFiles.push(value());
        break;
      case "--compose-line": {
        const raw = value();
        const n = Number.parseInt(raw, 10);
        if (!Number.isFinite(n) || n < 0) fail(`--compose-line needs a non-negative integer, got "${raw}"`);
        opts.composeLine = n;
        break;
      }
      case "--class":
        opts.classNames.push(value());
        break;
      case "--limit": {
        const raw = value();
        const n = Number.parseInt(raw, 10);
        if (!Number.isFinite(n) || n < 1) fail(`--limit needs a positive integer, got "${raw}"`);
        opts.limit = n;
        break;
      }
      case "--include-tests":
        opts.includeTests = true;
        break;
      case "--exclude":
        opts.excludes.push(value());
        break;
      case "--max-file-bytes": {
        const n = Number.parseInt(value(), 10);
        if (!Number.isFinite(n) || n < 1) fail("--max-file-bytes needs a positive integer");
        opts.maxFileBytes = n;
        break;
      }
      case "--json":
        opts.json = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        fail(`Unknown argument "${arg}". Use --help.`);
    }
  }
  if (
    !opts.texts.length &&
    !opts.descs.length &&
    !opts.ids.length &&
    !opts.composeNames.length &&
    !opts.composeFiles.length &&
    !opts.classNames.length
  ) {
    fail("Provide at least one anchor: --text, --desc, --id, --compose-name, --compose-file, or --class.");
  }
  return opts;
}

function fail(message) {
  console.error(`locate-code: ${message}`);
  process.exit(2);
}

function normalizeText(value) {
  return decodeEntities(String(value))
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[….。]+$/, "")
    .trim();
}

function decodeEntities(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"');
}

function stripFormats(value) {
  return value
    .replace(/%(?:\d+\$)?[sdfxX]/g, "")
    .replace(/\{[^{}]*\}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function idName(value) {
  const raw = String(value).trim().replace(/^@\+?(?:android:)?id\//, "");
  const afterSlash = raw.split("/").pop() ?? raw;
  return afterSlash.replace(/^id\//, "").trim();
}

function camelCase(value) {
  return value.replace(/^_+/, "").replace(/[_-]+(\w)/g, (_, c) => c.toUpperCase());
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

function lineAt(starts, index) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

async function walk(root, opts) {
  const files = [];
  let skipped = 0;
  const excluded = (rel) => opts.excludes.some((pattern) => rel.includes(pattern));

  async function visit(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = toPosix(path.relative(root, full));
      if (entry.isSymbolicLink()) {
        skipped++;
        continue;
      }
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) {
          skipped++;
          continue;
        }
        if (excluded(rel)) {
          skipped++;
          continue;
        }
        await visit(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!CODE_EXT.has(ext) && ext !== ".xml") continue;
      let size = 0;
      try {
        size = (await stat(full)).size;
      } catch {
        continue;
      }
      if (size > opts.maxFileBytes) {
        skipped++;
        continue;
      }
      files.push({ full, rel, ext, size });
    }
  }

  await visit(root);
  return { files, skipped };
}

async function indexRepo(files, opts) {
  const repo = {
    files: [],
    strings: [],
    ids: [],
    includes: [],
    composeDefs: [],
    codeRefs: [],
    stringRefs: [],
    layoutTextRefs: [],
    classes: [],
    scanned: 0,
  };
  const layoutNames = new Map(); // layout name -> layout file record
  const includedBy = new Map(); // child layout name -> Set(parent layout names)

  for (const file of files) {
    let text;
    try {
      text = await readFile(file.full, "utf8");
    } catch {
      continue;
    }
    const isTest = TEST_DIR.test(`/${file.rel}`);
    if (isTest && !opts.includeTests) continue;
    const lines = text.split(/\r?\n/);
    const starts = lineIndex(text);
    const record = { ...file, lines, isTest };
    repo.files.push(record);
    repo.scanned++;

    if (file.ext === ".xml") indexXml(record, text, starts, repo, layoutNames, includedBy);
    else indexCode(record, lines, repo);
  }

  // Link include children to parents, then mark layouts that nothing includes.
  for (const edge of repo.includes) {
    if (!includedBy.has(edge.child)) includedBy.set(edge.child, new Set());
    includedBy.get(edge.child).add(edge.parent);
  }
  repo.layoutNames = layoutNames;
  repo.includedBy = includedBy;
  return repo;
}

function indexXml(record, text, starts, repo, layoutNames, includedBy) {
  const isValues = /\/res\/values(?:-[a-z0-9-]+)?\//i.test(`/${record.rel}`);
  const isStrings = isValues && /\/strings\.xml$/i.test(record.rel);
  const layoutName =
    /\/res\/layout(?:-[a-z0-9-]+)?\/([^/]+)\.xml$/i.exec(`/${record.rel}`)?.[1] ?? null;
  const qualifier = /\/res\/values-([a-z0-9-]+)\//i.exec(`/${record.rel}`)?.[1] ?? "default";

  if (layoutName && !layoutNames.has(layoutName)) {
    layoutNames.set(layoutName, { name: layoutName, file: record.rel });
  }

  if (isStrings) {
    const re = /<string\b([^>]*)>([\s\S]*?)<\/string>/g;
    for (const match of text.matchAll(re)) {
      const attrs = match[1] ?? "";
      const name = /\bname\s*=\s*"([^"]+)"/.exec(attrs)?.[1];
      if (!name) continue;
      const raw = match[2] ?? "";
      const value = decodeEntities(raw.replace(/<[^>]+>/g, "")).trim();
      repo.strings.push({
        name,
        value,
        plain: stripFormats(value),
        normalized: normalizeText(value),
        file: record.rel,
        line: lineAt(starts, match.index ?? 0),
        qualifier,
      });
    }
    const itemRe = /<item\b([^>]*\btype\s*=\s*"id"[^>]*)>/g;
    for (const match of text.matchAll(itemRe)) {
      const attrs = match[1] ?? "";
      const name = /\bname\s*=\s*"([^"]+)"/.exec(attrs)?.[1];
      if (name) {
        repo.ids.push({ id: name, file: record.rel, line: lineAt(starts, match.index ?? 0), layout: null, tag: "item", root: false });
      }
    }
  }

  const idRe = /android:id\s*=\s*"@\+?(?:android:)?id\/([^"]+)"/g;
  for (const match of text.matchAll(idRe)) {
    const index = match.index ?? 0;
    const before = text.slice(0, index);
    const tag = /<([A-Za-z0-9_.]+)[^<>]*$/.exec(before)?.[1] ?? null;
    repo.ids.push({
      id: match[1],
      file: record.rel,
      line: lineAt(starts, index),
      layout: layoutName,
      tag,
      root: false,
    });
  }

  const includeRe = /<include\b[^>]*\blayout\s*=\s*"@layout\/([^"]+)"/g;
  for (const match of text.matchAll(includeRe)) {
    if (!layoutName) continue;
    repo.includes.push({
      parent: layoutName,
      child: match[1],
      file: record.rel,
      line: lineAt(starts, match.index ?? 0),
    });
  }

  const stringRe = /android:(?:text|hint|contentDescription)\s*=\s*"@string\/([^"]+)"/g;
  for (const match of text.matchAll(stringRe)) {
    repo.stringRefs.push({ name: match[1], file: record.rel, line: lineAt(starts, match.index ?? 0), layout: layoutName });
  }
  const literalTextRe = /android:(?:text|contentDescription)\s*=\s*"([^"@][^"]*)"/g;
  for (const match of text.matchAll(literalTextRe)) {
    if (normalizeText(match[1] ?? "").length < 2) continue;
    repo.layoutTextRefs.push({ text: match[1], normalized: normalizeText(match[1]), file: record.rel, line: lineAt(starts, match.index ?? 0), layout: layoutName });
  }
}

function indexCode(record, lines, repo) {
  let pendingComposable = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    if (/@Composable\b/.test(line)) pendingComposable = true;
    const fun = /\bfun\s+(?:<[^>]+>\s*)?([A-Za-z_]\w*)\s*\(/.exec(line);
    if (fun) {
      if (pendingComposable) {
        repo.composeDefs.push({ name: fun[1], file: record.rel, line: lineNo });
      }
      pendingComposable = false;
    } else if (line.trim() && !/^@\w+/.test(line.trim())) {
      if (pendingComposable) pendingComposable = false;
    }

    const cls = /\b(?:class|interface|object)\s+([A-Za-z_]\w*)/.exec(line);
    if (cls) repo.classes.push({ name: cls[1], file: record.rel, line: lineNo });

    const rid = /R\.id\.([A-Za-z_]\w*)/.exec(line);
    if (rid) repo.codeRefs.push({ kind: "id", name: rid[1], file: record.rel, line: lineNo, lineText: line.trim() });
    const rstring = /R\.string\.([A-Za-z_]\w*)/.exec(line);
    if (rstring) repo.codeRefs.push({ kind: "string", name: rstring[1], file: record.rel, line: lineNo, lineText: line.trim() });
    const rlayout = /R\.layout\.([A-Za-z_]\w*)/.exec(line);
    if (rlayout) repo.codeRefs.push({ kind: "layout", name: rlayout[1], file: record.rel, line: lineNo, lineText: line.trim() });
  }
}

function findStringAnchors(repo, texts) {
  const anchors = [];
  for (const value of texts) {
    const norm = normalizeText(value);
    if (!norm) continue;
    for (const def of repo.strings) {
      const defNorm = def.normalized;
      const plainNorm = normalizeText(def.plain);
      const exact = defNorm === norm || plainNorm === norm;
      const contains = norm.length >= 2 && (defNorm.includes(norm) || plainNorm.includes(norm));
      if (exact || contains) anchors.push(def);
    }
  }
  return dedupeBy(anchors, (item) => `${item.name}|${item.file}|${item.line}`);
}

function dedupeBy(items, key) {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

function snippet(lines, line, radius = 0) {
  const start = Math.max(0, line - 1 - radius);
  const end = Math.min(lines.length, line + radius);
  return lines
    .slice(start, end)
    .map((value) => value.trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 220);
}

function buildCandidates(repo, opts) {
  const candidates = [];
  const add = (file, line, kind, score, reason, lineText) => {
    candidates.push({ file, line, kind, score, reason, snippet: (lineText ?? "").trim().slice(0, 220) });
  };

  const texts = [...opts.texts, ...opts.descs];
  const stringAnchors = findStringAnchors(repo, texts);
  const idAnchors = opts.ids.map(idName).filter(Boolean);

  // ---- Direct Compose anchors -------------------------------------------
  const composeDefs = repo.composeDefs;
  let directDefs = [];
  if (opts.composeFiles.length) {
    const wanted = opts.composeFiles.map((value) => toPosix(value));
    const inFiles = composeDefs.filter((def) =>
      wanted.some((suffix) => def.file === suffix || def.file.endsWith(`/${suffix}`) || def.file.endsWith(suffix)),
    );
    if (opts.composeLine !== null && inFiles.length) {
      const before = inFiles.filter((def) => def.line <= opts.composeLine);
      if (before.length) {
        before.sort((a, b) => b.line - a.line);
        directDefs.push(before[0]);
      } else {
        const after = inFiles.filter((def) => def.line > opts.composeLine).sort((a, b) => a.line - b.line);
        if (after.length) directDefs.push(after[0]);
      }
    } else {
      directDefs.push(...inFiles);
    }
    if (!directDefs.length) {
      for (const wantedFile of wanted) {
        const file = repo.files.find((item) => item.rel === wantedFile || item.rel.endsWith(`/${wantedFile}`));
        if (file) {
          add(file.rel, opts.composeLine ?? 1, "compose-location", 90, "File reported by the Compose inspector", file.lines[(opts.composeLine ?? 1) - 1] ?? "");
          const defsHere = composeDefs.filter((def) => def.file === file.rel);
          directDefs.push(...defsHere);
        }
      }
    }
  }
  if (opts.composeNames.length) {
    for (const name of opts.composeNames) {
      for (const def of composeDefs.filter((item) => item.name === name)) directDefs.push(def);
    }
  }
  directDefs = dedupeBy(directDefs, (item) => `${item.file}|${item.line}|${item.name}`);

  for (const def of directDefs) {
    add(def.file, def.line, "compose-definition", 100, `@Composable ${def.name} definition`, repo.files.find((f) => f.rel === def.file)?.lines[def.line - 1] ?? "");
    const callRe = new RegExp(`\\b${escapeRe(def.name)}\\s*\\(`, "g");
    for (const file of repo.files) {
      if (file.ext === ".xml") continue;
      for (let i = 0; i < file.lines.length; i++) {
        const line = file.lines[i];
        if (!callRe.test(line)) {
          callRe.lastIndex = 0;
          continue;
        }
        callRe.lastIndex = 0;
        if (file.rel === def.file && i + 1 === def.line) continue;
        add(file.rel, i + 1, "compose-callsite", 45, `Calls ${def.name}`, line);
      }
    }
  }

  // ---- Resource id -------------------------------------------------------
  const idDefs = repo.ids.filter((item) => idAnchors.includes(item.id));
  for (const def of idDefs) {
    const file = repo.files.find((f) => f.rel === def.file);
    add(def.file, def.line, "layout-id", 78, `Defines id/${def.id} on <${def.tag ?? "view"}>`, file?.lines[def.line - 1] ?? "");
    if (def.layout) addLayoutChain(repo, def.layout, add);
  }
  for (const anchor of idAnchors) {
    for (const ref of repo.codeRefs.filter((item) => item.kind === "id" && item.name === anchor)) {
      const strong = /findViewById|setOnClickListener|setOnClick|binding\./.test(ref.lineText);
      add(ref.file, ref.line, strong ? "id-usage-strong" : "id-usage", strong ? 80 : 68, `References R.id.${anchor}`, ref.lineText);
    }
    const camel = camelCase(anchor);
    const bindingRe = new RegExp(`\\b${escapeRe(camel)}\\b`);
    for (const file of repo.files) {
      if (file.ext === ".xml") continue;
      for (let i = 0; i < file.lines.length; i++) {
        const line = file.lines[i];
        if (!bindingRe.test(line)) continue;
        if (/\bfun\s+|class\s+|val\s+|var\s+/.test(line) && !line.includes(".")) continue;
        add(file.rel, i + 1, "binding-usage", 62, `Likely ViewBinding property ${camel}`, line);
      }
    }
    for (const def of repo.ids.filter((item) => item.id === anchor && item.layout && /navigation|menu/i.test(item.file))) {
      add(def.file, def.line, "navigation", 58, `Navigation/menu entry id/${anchor}`, repo.files.find((f) => f.rel === def.file)?.lines[def.line - 1] ?? "");
    }
  }

  // ---- Strings -----------------------------------------------------------
  for (const anchor of stringAnchors) {
    add(anchor.file, anchor.line, "string-definition", 54, `string/${anchor.name} "${anchor.value}" (values-${anchor.qualifier})`, repo.files.find((f) => f.rel === anchor.file)?.lines[anchor.line - 1] ?? "");
    for (const ref of repo.codeRefs.filter((item) => item.kind === "string" && item.name === anchor.name)) {
      const composeStyle = /stringResource|stringResourceById/.test(ref.lineText);
      add(ref.file, ref.line, composeStyle ? "string-usage-compose" : "string-usage", composeStyle ? 82 : 70, `References R.string.${anchor.name}`, ref.lineText);
    }
    for (const ref of repo.stringRefs.filter((item) => item.name === anchor.name)) {
      add(ref.file, ref.line, "string-usage-xml", 64, `XML layout uses @string/${anchor.name}`, repo.files.find((f) => f.rel === ref.file)?.lines[ref.line - 1] ?? "");
      if (ref.layout) addLayoutChain(repo, ref.layout, add, 50);
    }
  }

  // ---- Literal text / testTag -------------------------------------------
  for (const value of texts) {
    const norm = normalizeText(value);
    if (!norm) continue;
    for (const ref of repo.layoutTextRefs) {
      if (ref.normalized === norm || (norm.length >= 2 && ref.normalized.includes(norm))) {
        add(ref.file, ref.line, "layout-text", 62, `XML literal text "${value}"`, repo.files.find((f) => f.rel === ref.file)?.lines[ref.line - 1] ?? "");
        if (ref.layout) addLayoutChain(repo, ref.layout, add, 48);
      }
    }
    for (const file of repo.files) {
      if (file.ext === ".xml") continue;
      for (let i = 0; i < file.lines.length; i++) {
        const line = file.lines[i];
        if (!/\bText\s*\(|text\s*=|setText\s*\(|testTag\s*\(|contentDescription\s*=|label\s*=|title\s*=|placeholder\s*=|hint\s*=/.test(line)) continue;
        const literals = [...line.matchAll(/"((?:\\.|[^"\\])*)"/g)].map((match) => normalizeText(match[1] ?? ""));
        const textMatch = literals.some((literal) => literal === norm || (norm.length >= 2 && literal.includes(norm)));
        if (!textMatch) continue;
        const tagged = /\btestTag\s*\(|contentDescription\s*=/.test(line);
        add(file.rel, i + 1, tagged ? "test-tag" : "literal-text", tagged ? 86 : 48, tagged ? "testTag/contentDescription matches the element" : `Literal text "${value}" in source`, line);
      }
    }
  }

  // ---- Class anchor ------------------------------------------------------
  for (const className of opts.classNames) {
    if (!className || /^(android|androidx|java|kotlin)\b/.test(className)) continue;
    const simple = className.split(".").pop();
    if (!simple) continue;
    const matches = repo.classes.filter((item) => item.name === simple);
    for (const match of matches) {
      add(match.file, match.line, "class-definition", 66, `Defines ${simple}`, repo.files.find((f) => f.rel === match.file)?.lines[match.line - 1] ?? "");
    }
  }

  // ---- android:onClick / listeners in matching layouts --------------------
  for (const idDef of idDefs) {
    if (!idDef.layout) continue;
    const file = repo.files.find((item) => item.rel === idDef.file);
    if (!file) continue;
    const onClick = /android:onClick\s*=\s*"([^"]+)"/.exec(file.lines[idDef.line - 1] ?? "");
    if (onClick) {
      add(idDef.file, idDef.line, "on-click-attr", 72, `android:onClick="${onClick[1]}"`, file.lines[idDef.line - 1]);
      const methodRe = new RegExp(`\\bfun\\s+${escapeRe(onClick[1])}\\s*\\(|void\\s+${escapeRe(onClick[1])}\\s*\\(`);
      for (const code of repo.files) {
        if (code.ext === ".xml") continue;
        for (let i = 0; i < code.lines.length; i++) {
          if (methodRe.test(code.lines[i])) add(code.rel, i + 1, "click-handler", 74, `Handler for android:onClick="${onClick[1]}"`, code.lines[i]);
        }
      }
    }
  }

  // ---- Root layout inflation ---------------------------------------------
  for (const file of repo.files) {
    if (file.ext === ".xml") continue;
    for (let i = 0; i < file.lines.length; i++) {
      const line = file.lines[i];
      if (!/setContentView|\.inflate\s*\(|inflate\s*\(|ViewBinding|onCreateView/.test(line)) continue;
      const layout = /(?:R\.layout\.([A-Za-z_]\w*)|([A-Za-z_]\w*)Binding\s*\.\s*inflate)/.exec(line);
      if (!layout) continue;
      const name = layout[1] ?? decamel(layout[2]);
      if (!idAnchors.length && !stringAnchors.length) continue;
      add(file.rel, i + 1, "inflation", 58, `Inflates layout ${name}`, line);
    }
  }

  const filtered = candidates.filter((candidate) => opts.includeTests || !TEST_DIR.test(`/${candidate.file}`));
  filtered.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line);
  const unique = dedupeBy(filtered, (candidate) => `${candidate.file}|${candidate.line}|${candidate.kind}`);
  return {
    candidates: unique.slice(0, opts.limit),
    allCandidateCount: unique.length,
    anchors: { strings: stringAnchors, ids: idAnchors, compose: directDefs },
  };
}

function addLayoutChain(repo, layoutName, add, baseScore = 55) {
  const chain = [layoutName];
  const seen = new Set([layoutName]);
  const queue = [layoutName];
  while (queue.length) {
    const child = queue.shift();
    for (const parent of repo.includedBy.get(child) ?? []) {
      if (seen.has(parent)) continue;
      seen.add(parent);
      chain.push(parent);
      queue.push(parent);
    }
  }
  for (const name of chain.slice(1)) {
    const def = repo.layoutNames.get(name);
    if (def) add(def.file, 1, "layout-include-chain", baseScore, `Contains ${layoutName} via <include> (${layoutName} -> ${name})`, "");
  }
  // A layout that no other layout includes is an entry layout: activity,
  // fragment, dialog, or a list item inflated directly from code.
  for (const name of chain) {
    if (repo.includedBy.has(name)) continue;
    for (const ref of repo.codeRefs.filter((item) => item.kind === "layout" && item.name === name)) {
      add(ref.file, ref.line, "layout-inflation", 64, `Uses layout ${name}`, ref.lineText);
    }
  }
}

function decamel(value) {
  return value
    .replace(/Binding$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
}

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatHuman(result) {
  const lines = [];
  lines.push(`root: ${result.root}`);
  lines.push(`scanned: ${result.scanned.files} files (${result.scanned.skipped} skipped)`);
  const anchors = [];
  for (const item of result.anchors.strings) anchors.push(`string/${item.name}="${item.value}" (${item.file}:${item.line})`);
  for (const id of result.anchors.ids) anchors.push(`id/${id}`);
  for (const item of result.anchors.compose) anchors.push(`@Composable ${item.name} (${item.file}:${item.line})`);
  lines.push(`anchors: ${anchors.length ? anchors.join("; ") : "none"}`);
  if (!result.candidates.length) {
    lines.push("No code candidates. Try broader text, --include-tests, or check whether the text is server-driven.");
    return lines.join("\n");
  }
  lines.push("");
  for (const candidate of result.candidates) {
    lines.push(`${String(candidate.score).padStart(4)} ${candidate.file}:${candidate.line} [${candidate.kind}] ${candidate.reason}`);
    if (candidate.snippet) lines.push(`     ${candidate.snippet}`);
  }
  return lines.join("\n");
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const root = path.resolve(opts.root);
  let rootStat;
  try {
    rootStat = await stat(root);
  } catch {
    fail(`--root does not exist: ${root}`);
  }
  if (!rootStat.isDirectory()) fail(`--root is not a directory: ${root}`);

  const walked = await walk(root, opts);
  const repo = await indexRepo(walked.files, opts);
  const built = buildCandidates(repo, opts);
  const result = {
    root,
    scanned: { files: repo.scanned, skipped: walked.skipped },
    uiAnchors: {
      texts: opts.texts,
      descriptions: opts.descs,
      ids: opts.ids.map(idName),
      composeNames: opts.composeNames,
      composeFiles: opts.composeFiles,
      composeLine: opts.composeLine,
      classes: opts.classNames,
    },
    anchors: built.anchors,
    candidates: built.candidates,
    totalCandidates: built.allCandidateCount,
    notes: [],
  };
  if (!built.candidates.length) {
    result.notes.push("No candidates. The text may be server-driven, produced by formatting, or live in a module outside --root.");
    result.notes.push("Try a static neighboring label, a resource id, --include-tests, or a wider repo root.");
  }
  if (built.anchors.strings.length > 1) {
    result.notes.push(`Text matched ${built.anchors.strings.length} string resources; use the module, qualifier, and code call site to disambiguate.`);
  }
  if (opts.texts.some((value) => normalizeText(value).length < 2)) {
    result.notes.push("Very short text anchors match many places; prefer a resource id or Compose anchor.");
  }

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatHuman(result)}\n`);
  }
}

main().catch((error) => {
  console.error(`locate-code: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exit(1);
});
