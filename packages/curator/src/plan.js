#!/usr/bin/env node
/*
 * Muletto stage 2 CLI: build a plan from a scan and a rule set.
 *
 * Usage: node src/plan.js <scan.json> <rules.json> [--out plan.json]
 *
 * Loads both files, validates the rules, evaluates them against the scan,
 * writes plan.json, and prints a terse summary. The plan is only a proposal;
 * nothing touches the filesystem until the execute stage runs with --commit.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { validateRules, evaluate } = require('./rules');

function fail(msg) {
  process.stderr.write('error: ' + msg + '\n');
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { scan: null, rules: null, out: 'plan.json' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') {
      i++;
      if (i >= argv.length) fail('--out requires a value');
      opts.out = argv[i];
    } else if (a === '--help' || a === '-h') {
      process.stdout.write('usage: node src/plan.js <scan.json> <rules.json> [--out plan.json]\n');
      process.exit(0);
    } else if (a.startsWith('--')) {
      fail('unknown option: ' + a);
    } else if (opts.scan === null) {
      opts.scan = a;
    } else if (opts.rules === null) {
      opts.rules = a;
    } else {
      fail('unexpected argument: ' + a);
    }
  }
  if (opts.scan === null || opts.rules === null) {
    fail('usage: node src/plan.js <scan.json> <rules.json> [--out plan.json]');
  }
  return opts;
}

function loadJson(file, label) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    fail('cannot read ' + label + ' file "' + file + '": ' + err.message);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    fail(label + ' file "' + file + '" is not valid JSON: ' + err.message);
  }
}

function gb(bytes) {
  return (bytes / (1024 * 1024 * 1024)).toFixed(2);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  const scan = loadJson(opts.scan, 'scan');
  if (scan === null || typeof scan !== 'object' || !Array.isArray(scan.files)) {
    fail('scan file "' + opts.scan + '" has no files array');
  }
  if (typeof scan.root !== 'string') {
    fail('scan file "' + opts.scan + '" has no root');
  }

  const rules = loadJson(opts.rules, 'rules');
  const check = validateRules(rules);
  if (!check.ok) {
    process.stderr.write('error: rules file "' + opts.rules + '" is invalid:\n');
    for (const e of check.errors) {
      process.stderr.write('  - ' + e + '\n');
    }
    process.exit(1);
  }

  const plan = evaluate(scan, rules);

  try {
    fs.writeFileSync(opts.out, JSON.stringify(plan, null, 2) + '\n');
  } catch (err) {
    fail('cannot write plan to "' + opts.out + '": ' + err.message);
  }

  // Terse summary table.
  const rows = [['action', 'files', 'GB']];
  for (const a of ['delete', 'move', 'transfer']) {
    rows.push([a, String(plan.summary[a].count), gb(plan.summary[a].bytes)]);
  }
  rows.push(['total', String(plan.items.length), gb(plan.summary.total_bytes_freed)]);
  const widths = [0, 0, 0];
  for (const r of rows) {
    for (let i = 0; i < 3; i++) widths[i] = Math.max(widths[i], r[i].length);
  }
  for (const r of rows) {
    process.stdout.write(
      r[0].padEnd(widths[0]) + '  ' +
      r[1].padStart(widths[1]) + '  ' +
      r[2].padStart(widths[2]) + '\n');
  }
  process.stdout.write('keep exceptions: ' + plan.keep_exceptions.length + '\n');
  process.stdout.write('plan written to ' + path.resolve(opts.out) + '\n');
}

main();
