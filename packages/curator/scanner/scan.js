#!/usr/bin/env node
/*
 * Muletto stage 1: deterministic scanner.
 *
 * Usage: node scan.js <folder> [--out scan.json] [--recurse]
 *
 * Walks a photo folder, classifies files by filename/extension heuristics,
 * detects exact duplicates (size -> partial sha1 -> full sha256), and writes
 * a JSON report. Zero dependencies (node:fs, node:path, node:crypto only).
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PARTIAL_BYTES = 65536;
const PROGRESS_EVERY = 1000;

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { root: null, out: 'scan.json', recurse: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--recurse') {
      opts.recurse = true;
    } else if (a === '--out') {
      i++;
      if (i >= argv.length) fail('--out requires a value');
      opts.out = argv[i];
    } else if (a === '--help' || a === '-h') {
      usage();
      process.exit(0);
    } else if (a.startsWith('--')) {
      fail('unknown option: ' + a);
    } else if (opts.root === null) {
      opts.root = a;
    } else {
      fail('unexpected argument: ' + a);
    }
  }
  if (opts.root === null) {
    usage();
    process.exit(2);
  }
  return opts;
}

function usage() {
  process.stdout.write('Usage: node scan.js <folder> [--out scan.json] [--recurse]\n');
}

function fail(msg) {
  process.stderr.write('error: ' + msg + '\n');
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Walk
// ---------------------------------------------------------------------------

function walk(root, recurse) {
  const files = [];
  const dirs = ['.'];
  while (dirs.length > 0) {
    const rel = dirs.shift();
    const abs = path.join(root, rel);
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch (err) {
      process.stderr.write('warn: cannot read dir ' + abs + ': ' + err.message + '\n');
      continue;
    }
    for (const ent of entries) {
      const relPath = rel === '.' ? ent.name : rel + '/' + ent.name;
      if (ent.isDirectory()) {
        if (recurse) dirs.push(relPath);
        continue;
      }
      if (!ent.isFile()) continue;
      const rec = {
        path: relPath,
        bytes: 0,
        mtime: null,
        ext: path.extname(ent.name).toLowerCase(),
        category: null,
      };
      try {
        const st = fs.statSync(path.join(root, relPath));
        rec.bytes = st.size;
        rec.mtime = st.mtime.toISOString();
      } catch (err) {
        rec.category = 'error';
        rec.error = err.message;
      }
      files.push(rec);
      if (files.length % PROGRESS_EVERY === 0) {
        process.stderr.write('scanned ' + files.length + ' files...\n');
      }
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMG_RE = /^IMG_/i;
const SCREENSHOT_RE = /(screenshot|skjermbilde)/i;
const JUNK_EXTS = new Set(['.tmp', '.ini']);

function classify(files) {
  // Index of lowercased .heic basenames per directory, for live photo pairing.
  const heicByDir = new Map();
  for (const f of files) {
    if (f.ext === '.heic') {
      const dir = path.posix.dirname(f.path);
      const base = path.basename(f.path, path.extname(f.path)).toLowerCase();
      if (!heicByDir.has(dir)) heicByDir.set(dir, new Set());
      heicByDir.get(dir).add(base);
    }
  }

  for (const f of files) {
    if (f.category === 'error') continue;
    const name = path.basename(f.path);
    const stem = path.basename(name, path.extname(name));
    const ext = f.ext;

    // junk
    if (
      f.bytes === 0 ||
      JUNK_EXTS.has(ext) ||
      name.toLowerCase() === 'thumbs.db'
    ) {
      f.category = 'junk';
      continue;
    }

    // snapchat memories export: date-prefixed names, e.g. 2023-05-01_<id>-main.mp4,
    // optionally with a paired -overlay file (caption/sticker layer)
    if (/^\d{4}-\d{2}-\d{2}[_-]/.test(name)) {
      f.category = /-overlay\./i.test(name) ? 'snapchat_overlay' : 'snapchat_memory';
      continue;
    }

    // chat media: GUID-named videos or cm-chat-media*
    if (
      ((ext === '.mp4' || ext === '.mov') && GUID_RE.test(stem)) ||
      /^cm-chat-media/i.test(name)
    ) {
      f.category = 'chat_media';
      continue;
    }

    // screenshots
    if (
      (ext === '.png' && IMG_RE.test(name)) ||
      SCREENSHOT_RE.test(name)
    ) {
      f.category = 'screenshot';
      continue;
    }

    // live photo pair: a .mov whose basename matches a .heic in the same dir
    if (ext === '.mov') {
      const dir = path.posix.dirname(f.path);
      const set = heicByDir.get(dir);
      if (set && set.has(stem.toLowerCase())) {
        f.category = 'live_photo_pair';
        continue;
      }
    }

    // camera photo
    if (IMG_RE.test(name) && (ext === '.heic' || ext === '.jpg' || ext === '.jpeg')) {
      f.category = 'camera_photo';
      continue;
    }

    // camera video
    if ((IMG_RE.test(name) && ext === '.mov') || ext === '.mp4') {
      f.category = 'camera_video';
      continue;
    }

    f.category = 'other';
  }
}

// ---------------------------------------------------------------------------
// Duplicate detection (streaming hashes, never whole file in memory)
// ---------------------------------------------------------------------------

function hashFile(absPath, algo, maxBytes) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algo);
    const streamOpts = {};
    if (maxBytes) streamOpts.end = maxBytes - 1; // end is inclusive
    const stream = fs.createReadStream(absPath, streamOpts);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function detectDuplicates(root, files) {
  const candidates = files.filter((f) => f.category !== 'error' && f.bytes > 0);

  // 1. group by exact size
  const bySize = new Map();
  for (const f of candidates) {
    if (!bySize.has(f.bytes)) bySize.set(f.bytes, []);
    bySize.get(f.bytes).push(f);
  }

  // 2. within a size group, partial sha1 of first 64 KiB
  const byPartial = new Map(); // "size:sha1" -> [files]
  let hashed = 0;
  for (const group of bySize.values()) {
    if (group.length < 2) continue;
    for (const f of group) {
      try {
        const h = await hashFile(path.join(root, f.path), 'sha1', PARTIAL_BYTES);
        const key = f.bytes + ':' + h;
        if (!byPartial.has(key)) byPartial.set(key, []);
        byPartial.get(key).push(f);
      } catch (err) {
        f.category = 'error';
        f.error = err.message;
      }
      hashed++;
      if (hashed % PROGRESS_EVERY === 0) {
        process.stderr.write('hashed ' + hashed + ' files...\n');
      }
    }
  }

  // 3. partial collisions: confirm with full sha256
  const byFull = new Map(); // "size:sha256" -> [files]
  for (const group of byPartial.values()) {
    if (group.length < 2) continue;
    for (const f of group) {
      try {
        const h = await hashFile(path.join(root, f.path), 'sha256');
        f.sha256 = h;
        const key = f.bytes + ':' + h;
        if (!byFull.has(key)) byFull.set(key, []);
        byFull.get(key).push(f);
      } catch (err) {
        f.category = 'error';
        f.error = err.message;
      }
      hashed++;
      if (hashed % PROGRESS_EVERY === 0) {
        process.stderr.write('hashed ' + hashed + ' files...\n');
      }
    }
  }

  // 4. assign dup groups
  let groupId = 0;
  for (const group of byFull.values()) {
    if (group.length < 2) continue;
    groupId++;
    group.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    for (let i = 0; i < group.length; i++) {
      group[i].dupGroup = 'dup-' + groupId;
      group[i].duplicate = i > 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Summary + main
// ---------------------------------------------------------------------------

function buildSummary(files) {
  const categories = {};
  let duplicateFiles = 0;
  let reclaimableDuplicateBytes = 0;
  for (const f of files) {
    const c = f.category;
    if (!categories[c]) categories[c] = { files: 0, bytes: 0 };
    categories[c].files++;
    categories[c].bytes += f.bytes;
    if (f.duplicate === true) {
      duplicateFiles++;
      reclaimableDuplicateBytes += f.bytes;
    }
  }
  return {
    totalFiles: files.length,
    totalBytes: files.reduce((s, f) => s + f.bytes, 0),
    categories,
    duplicateFiles,
    reclaimableDuplicateBytes,
  };
}

function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let v = n;
  let u = -1;
  while (v >= 1024 && u < units.length - 1) {
    v = v / 1024;
    u++;
  }
  return v.toFixed(1) + ' ' + units[u];
}

function printTable(summary) {
  const rows = [['category', 'files', 'bytes']];
  const names = Object.keys(summary.categories).sort();
  for (const name of names) {
    const c = summary.categories[name];
    rows.push([name, String(c.files), fmtBytes(c.bytes)]);
  }
  rows.push(['TOTAL', String(summary.totalFiles), fmtBytes(summary.totalBytes)]);
  const widths = [0, 0, 0];
  for (const r of rows) {
    for (let i = 0; i < 3; i++) widths[i] = Math.max(widths[i], r[i].length);
  }
  const sep = '-'.repeat(widths[0] + widths[1] + widths[2] + 6);
  const lines = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    lines.push(
      r[0].padEnd(widths[0]) +
        '  ' +
        r[1].padStart(widths[1]) +
        '  ' +
        r[2].padStart(widths[2])
    );
    if (i === 0 || i === rows.length - 2) lines.push(sep);
  }
  lines.push('');
  lines.push(
    'duplicates: ' +
      summary.duplicateFiles +
      ' files, ' +
      fmtBytes(summary.reclaimableDuplicateBytes) +
      ' reclaimable'
  );
  process.stdout.write(lines.join('\n') + '\n');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const root = path.resolve(opts.root);
  let st;
  try {
    st = fs.statSync(root);
  } catch (err) {
    fail('cannot access ' + root + ': ' + err.message);
  }
  if (!st.isDirectory()) fail(root + ' is not a directory');

  const files = walk(root, opts.recurse);
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  process.stderr.write('scan complete: ' + files.length + ' files\n');

  classify(files);
  await detectDuplicates(root, files);

  const summary = buildSummary(files);
  const report = {
    generated: new Date().toISOString(),
    root: root,
    files: files,
    summary: summary,
  };
  fs.writeFileSync(opts.out, JSON.stringify(report, null, 2) + '\n');
  printTable(summary);
  process.stdout.write('report written to ' + path.resolve(opts.out) + '\n');
}

main().catch((err) => {
  process.stderr.write('fatal: ' + (err && err.stack ? err.stack : err) + '\n');
  process.exit(1);
});
