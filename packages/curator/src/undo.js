#!/usr/bin/env node
/*
 * Muletto undo.
 *
 * Usage: node undo.js <run-manifest.json> [--commit]
 *
 * Dry run by default. Restores files recorded by an execute run:
 *   delete   -> trashed file moves back to its original path
 *   move     -> file moves back from destination to its original path
 *   transfer -> original restores from trash; destination copy stays put
 * Skips with a warning anything whose current location is gone or whose
 * original path is now occupied. With --commit, appends an undo section to
 * the manifest recording what was restored.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage() {
  process.stdout.write('Usage: node undo.js <run-manifest.json> [--commit]\n');
}

function fail(msg) {
  process.stderr.write('error: ' + msg + '\n');
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { manifest: null, commit: false };
  for (const a of argv) {
    if (a === '--commit') {
      opts.commit = true;
    } else if (a === '--help' || a === '-h') {
      usage();
      process.exit(0);
    } else if (a.startsWith('--')) {
      fail('unknown option: ' + a);
    } else if (opts.manifest === null) {
      opts.manifest = a;
    } else {
      fail('unexpected argument: ' + a);
    }
  }
  if (opts.manifest === null) {
    usage();
    process.exit(1);
  }
  return opts;
}

// ---------------------------------------------------------------------------
// File helpers (same semantics as execute.js)
// ---------------------------------------------------------------------------

function hashFile(absPath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(absPath);
    stream.on('data', (c) => hash.update(c));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function copyWithHash(src, dst) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const rs = fs.createReadStream(src);
    const ws = fs.createWriteStream(dst, { flags: 'wx' });
    let failed = false;
    function onError(err) {
      if (failed) return;
      failed = true;
      rs.destroy();
      ws.destroy();
      reject(err);
    }
    rs.on('error', onError);
    ws.on('error', onError);
    rs.on('data', (c) => hash.update(c));
    ws.on('close', () => {
      if (!failed) resolve(hash.digest('hex'));
    });
    rs.pipe(ws);
  });
}

// Remove a copy this program itself just created (never a user file).
function removeOwnCopy(p) {
  try {
    fs.unlinkSync(p);
  } catch (err) {
    process.stderr.write('warn: could not remove own copy ' + p + ': ' + err.message + '\n');
  }
}

// Move src to dst. Prefers rename; on EXDEV falls back to
// copy + verify (size and sha256) + unlink of the verified source.
async function moveFile(src, dst) {
  try {
    fs.renameSync(src, dst);
    return;
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
  }
  const srcBytes = fs.statSync(src).size;
  let sha256Src;
  try {
    sha256Src = await copyWithHash(src, dst);
  } catch (err) {
    if (err.code !== 'EEXIST') removeOwnCopy(dst);
    throw err;
  }
  const sha256Dst = await hashFile(dst);
  const dstBytes = fs.statSync(dst).size;
  if (dstBytes !== srcBytes || sha256Dst !== sha256Src) {
    removeOwnCopy(dst);
    throw new Error('cross-device copy verification failed for ' + src + '; original untouched');
  }
  // Source is verified byte-for-byte at dst; unlinking it completes the move.
  fs.unlinkSync(src);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const manifestPath = path.resolve(opts.manifest);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    fail('cannot read manifest ' + manifestPath + ': ' + err.message);
  }
  if (manifest.version !== 1) fail('unsupported manifest version: ' + String(manifest.version));
  if (!Array.isArray(manifest.items)) fail('manifest has no items array');

  if (!opts.commit) {
    process.stdout.write('DRY RUN: no changes will be made (use --commit to apply)\n\n');
  }

  const records = [];
  const counts = { restored: 0, skipped: 0, failed: 0 };

  // Undo in reverse order of execution.
  const items = manifest.items.slice().reverse();
  for (const item of items) {
    if (item.status !== 'ok') continue; // nothing was changed for this item

    let src = null;
    let dst = item.from;
    let note = null;
    if (item.action === 'delete' || item.action === 'move') {
      src = item.to;
    } else if (item.action === 'transfer') {
      src = item.trashed_to;
      note = 'destination copy left in place at ' + item.to;
    } else {
      counts.skipped++;
      records.push({ action: item.action, from: null, to: dst, status: 'skipped', note: 'unknown action' });
      process.stderr.write('warn: skip ' + String(item.from) + ' (unknown action ' + String(item.action) + ')\n');
      continue;
    }

    if (!src || !fs.existsSync(src)) {
      counts.skipped++;
      records.push({ action: item.action, from: src, to: dst, status: 'skipped', note: 'current location missing' });
      process.stderr.write('warn: skip ' + String(src) + ' (current location missing)\n');
      continue;
    }
    if (fs.existsSync(dst)) {
      counts.skipped++;
      records.push({ action: item.action, from: src, to: dst, status: 'skipped', note: 'original path occupied' });
      process.stderr.write('warn: skip ' + src + ' (original path occupied: ' + dst + ')\n');
      continue;
    }

    if (!opts.commit) {
      process.stdout.write('would restore (' + item.action + '): ' + src + ' -> ' + dst +
        (note ? ' [' + note + ']' : '') + '\n');
      counts.restored++;
      continue;
    }

    try {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      await moveFile(src, dst);
      counts.restored++;
      records.push({ action: item.action, from: src, to: dst, status: 'restored', note: note });
      process.stdout.write('restored (' + item.action + '): ' + dst +
        (note ? ' [' + note + ']' : '') + '\n');
    } catch (err) {
      counts.failed++;
      records.push({ action: item.action, from: src, to: dst, status: 'failed', note: err.message });
      process.stderr.write('warn: failed to restore ' + src + ': ' + err.message + '\n');
    }
  }

  if (opts.commit) {
    if (!Array.isArray(manifest.undo)) manifest.undo = [];
    manifest.undo.push({
      generated: new Date().toISOString(),
      restored: counts.restored,
      skipped: counts.skipped,
      failed: counts.failed,
      items: records,
    });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  }

  process.stdout.write(
    '\nundo ' + (opts.commit ? 'complete' : 'dry run') + ': restored ' + counts.restored +
    ', skipped ' + counts.skipped + ', failed ' + counts.failed + '\n'
  );
  if (opts.commit) process.stdout.write('manifest updated: ' + manifestPath + '\n');
}

main().catch((err) => {
  process.stderr.write('fatal: ' + (err && err.stack ? err.stack : err) + '\n');
  process.exit(1);
});
