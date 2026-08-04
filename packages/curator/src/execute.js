#!/usr/bin/env node
/*
 * Muletto executor.
 *
 * Usage: node execute.js <approved-plan.json> [--commit]
 *
 * Dry run by default: prints what would happen and writes nothing.
 * With --commit, applies plan items sequentially and records every item in
 * <root>/.muletto/runs/<runstamp>-manifest.json.
 *
 * Safety model: nothing is ever OS-deleted. "delete" moves a file into
 * <root>/.muletto/trash/<runstamp>/<original relative path>. The only
 * file this program unlinks is a bad copy it itself just wrote (plus the
 * source unlink that completes a verified cross-device move).
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PROGRESS_EVERY = 25;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage() {
  process.stdout.write('Usage: node execute.js <approved-plan.json> [--commit]\n');
}

function fail(msg) {
  process.stderr.write('error: ' + msg + '\n');
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { plan: null, commit: false };
  for (const a of argv) {
    if (a === '--commit') {
      opts.commit = true;
    } else if (a === '--help' || a === '-h') {
      usage();
      process.exit(0);
    } else if (a.startsWith('--')) {
      fail('unknown option: ' + a);
    } else if (opts.plan === null) {
      opts.plan = a;
    } else {
      fail('unexpected argument: ' + a);
    }
  }
  if (opts.plan === null) {
    usage();
    process.exit(1);
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runstamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    p(d.getMonth() + 1) +
    p(d.getDate()) +
    '-' +
    p(d.getHours()) +
    p(d.getMinutes()) +
    p(d.getSeconds()) +
    String(d.getMilliseconds()).padStart(3, '0')
  );
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

function hashFile(absPath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(absPath);
    stream.on('data', (c) => hash.update(c));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

// Stream-copy src to dst (dst must not exist; wx flag) and return the sha256
// of the bytes read from src.
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

// Remove a copy this program itself just created. This is the only unlink
// applied to anything other than a verified cross-device move source.
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
    return { sha256_src: null, sha256_dst: null };
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
  return { sha256_src: sha256Src, sha256_dst: sha256Dst };
}

// First free path for name in dir, appending " (2)", " (3)", ... on collision.
function uniquePath(dir, name) {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = path.join(dir, name);
  let n = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, stem + ' (' + n + ')' + ext);
    n++;
  }
  return candidate;
}

function resolveDest(destination, root) {
  return path.isAbsolute(destination) ? destination : path.join(root, destination);
}

function trashTarget(trashRoot, relPath) {
  const dir = path.join(trashRoot, path.dirname(relPath));
  return { dir: dir, target: uniquePath(dir, path.basename(relPath)) };
}

// ---------------------------------------------------------------------------
// Item processing (--commit)
// ---------------------------------------------------------------------------

async function applyItem(item, ctx) {
  const rec = {
    action: item.action,
    from: path.join(ctx.root, item.path),
    to: null,
    sha256_src: null,
    sha256_dst: null,
    status: 'failed',
    error: null,
  };
  try {
    if (!fs.existsSync(rec.from)) {
      rec.status = 'skipped';
      rec.error = 'source missing';
      return rec;
    }
    if (item.action === 'delete') {
      const t = trashTarget(ctx.trashRoot, item.path);
      fs.mkdirSync(t.dir, { recursive: true });
      const res = await moveFile(rec.from, t.target);
      rec.to = t.target;
      rec.sha256_src = res.sha256_src;
      rec.sha256_dst = res.sha256_dst;
      rec.status = 'ok';
    } else if (item.action === 'move') {
      if (!item.destination) throw new Error('missing destination');
      const destDir = resolveDest(item.destination, ctx.root);
      fs.mkdirSync(destDir, { recursive: true });
      const srcBytes = fs.statSync(rec.from).size;
      const target = uniquePath(destDir, path.basename(item.path));
      const res = await moveFile(rec.from, target);
      rec.to = target;
      rec.sha256_src = res.sha256_src;
      rec.sha256_dst = res.sha256_dst;
      const postBytes = fs.statSync(target).size;
      if (postBytes !== srcBytes) {
        rec.error = 'post-move size mismatch: ' + srcBytes + ' -> ' + postBytes;
      } else {
        rec.status = 'ok';
      }
    } else if (item.action === 'transfer') {
      if (!item.destination) throw new Error('missing destination');
      const destDir = resolveDest(item.destination, ctx.root);
      fs.mkdirSync(destDir, { recursive: true });
      const target = uniquePath(destDir, path.basename(item.path));
      let sha256Src;
      try {
        sha256Src = await copyWithHash(rec.from, target);
      } catch (err) {
        if (err.code !== 'EEXIST') removeOwnCopy(target);
        throw err;
      }
      const sha256Dst = await hashFile(target);
      const srcBytes = fs.statSync(rec.from).size;
      const dstBytes = fs.statSync(target).size;
      rec.sha256_src = sha256Src;
      rec.sha256_dst = sha256Dst;
      if (sha256Src !== sha256Dst || srcBytes !== dstBytes) {
        // Bad copy we just wrote; remove only that. Original untouched.
        removeOwnCopy(target);
        rec.error = 'verification mismatch after copy; copy removed, original untouched';
      } else {
        const t = trashTarget(ctx.trashRoot, item.path);
        fs.mkdirSync(t.dir, { recursive: true });
        await moveFile(rec.from, t.target);
        rec.to = target;
        rec.trashed_to = t.target;
        rec.status = 'ok';
      }
    } else {
      rec.error = 'unknown action: ' + String(item.action);
    }
  } catch (err) {
    rec.status = 'failed';
    rec.error = err.message;
  }
  return rec;
}

function writeManifest(manifestPath, manifest) {
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Dry run
// ---------------------------------------------------------------------------

function dryRun(plan, root) {
  process.stdout.write('DRY RUN: no changes will be made (use --commit to apply)\n');
  process.stdout.write('root: ' + root + '\n\n');
  const tally = {};
  const add = (key, bytes) => {
    if (!tally[key]) tally[key] = { files: 0, bytes: 0 };
    tally[key].files++;
    tally[key].bytes += bytes || 0;
  };
  for (const item of plan.items) {
    const src = path.join(root, item.path);
    let line;
    if (!fs.existsSync(src)) {
      line = 'skip     ' + item.path + ' (source missing)';
      add('skip', 0);
    } else if (item.action === 'delete') {
      line = 'delete   ' + item.path + ' -> .muletto/trash/<runstamp>/' + item.path;
      add('delete', item.bytes);
    } else if (item.action === 'move' || item.action === 'transfer') {
      if (!item.destination) {
        line = 'fail     ' + item.path + ' (missing destination)';
        add('fail', 0);
      } else {
        const destDir = resolveDest(item.destination, root);
        const target = path.join(destDir, path.basename(item.path));
        const collide = fs.existsSync(target) ? ' [name collision: would append " (n)"]' : '';
        if (item.action === 'move') {
          line = 'move     ' + item.path + ' -> ' + target + collide;
          add('move', item.bytes);
        } else {
          line =
            'transfer ' + item.path + ' -> ' + target + collide +
            ' (verify sha256, then original -> trash)';
          add('transfer', item.bytes);
        }
      }
    } else {
      line = 'fail     ' + item.path + ' (unknown action: ' + String(item.action) + ')';
      add('fail', 0);
    }
    process.stdout.write(line + '\n');
  }
  process.stdout.write('\nsummary (dry run):\n');
  for (const key of Object.keys(tally)) {
    process.stdout.write(
      '  ' + key + ': ' + tally[key].files + ' files, ' + fmtBytes(tally[key].bytes) + '\n'
    );
  }
  process.stdout.write('nothing was changed.\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const planPath = path.resolve(opts.plan);
  let plan;
  try {
    plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  } catch (err) {
    fail('cannot read plan ' + planPath + ': ' + err.message);
  }
  if (plan.version !== 1) fail('unsupported plan version: ' + String(plan.version));
  if (!plan.root || !fs.existsSync(plan.root) || !fs.statSync(plan.root).isDirectory()) {
    fail('plan root does not exist: ' + String(plan.root));
  }
  if (!Array.isArray(plan.items)) fail('plan has no items array');
  const root = path.resolve(plan.root);

  if (!opts.commit) {
    dryRun(plan, root);
    return;
  }

  const stamp = runstamp();
  const trashRoot = path.join(root, '.muletto', 'trash', stamp);
  const runsDir = path.join(root, '.muletto', 'runs');
  fs.mkdirSync(runsDir, { recursive: true });
  const manifestPath = path.join(runsDir, stamp + '-manifest.json');
  const manifest = {
    version: 1,
    runstamp: stamp,
    root: root,
    plan: planPath,
    generated: new Date().toISOString(),
    items: [],
  };
  const ctx = { root: root, trashRoot: trashRoot };
  const counts = { ok: 0, failed: 0, skipped: 0 };
  const bytesByAction = {};

  for (let i = 0; i < plan.items.length; i++) {
    const item = plan.items[i];
    const rec = await applyItem(item, ctx);
    manifest.items.push(rec);
    counts[rec.status]++;
    if (rec.status === 'ok') {
      if (!bytesByAction[rec.action]) bytesByAction[rec.action] = { files: 0, bytes: 0 };
      bytesByAction[rec.action].files++;
      bytesByAction[rec.action].bytes += item.bytes || 0;
    } else if (rec.status === 'failed') {
      process.stderr.write('failed: ' + item.path + ': ' + rec.error + '\n');
    }
    // Rewrite after every item so a crash never loses the record of what ran.
    writeManifest(manifestPath, manifest);
    if ((i + 1) % PROGRESS_EVERY === 0) {
      process.stderr.write(
        'progress: ' + (i + 1) + '/' + plan.items.length +
        ' (ok ' + counts.ok + ', failed ' + counts.failed + ', skipped ' + counts.skipped + ')\n'
      );
    }
  }

  process.stdout.write(
    '\nrun ' + stamp + ' complete: ' + plan.items.length + ' items, ok ' + counts.ok +
    ', failed ' + counts.failed + ', skipped ' + counts.skipped + '\n'
  );
  for (const action of Object.keys(bytesByAction)) {
    const b = bytesByAction[action];
    process.stdout.write('  ' + action + ': ' + b.files + ' files, ' + fmtBytes(b.bytes) + '\n');
  }
  process.stdout.write('trash: ' + trashRoot + '\n');
  process.stdout.write('manifest: ' + manifestPath + '\n');
}

main().catch((err) => {
  process.stderr.write('fatal: ' + (err && err.stack ? err.stack : err) + '\n');
  process.exit(1);
});
