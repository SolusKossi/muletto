/*
 * Muletto stage 2: rule validation, natural-language rule parsing,
 * and plan evaluation. Zero dependencies.
 *
 * Data contract (see project docs):
 *   rules.json: { version: 1, rules: [ { id, text, enabled, match, action, destination } ] }
 *   match keys (all optional, all present conditions must hold):
 *     categories, older_than_days, newer_than_days, larger_than_mb,
 *     smaller_than_mb, name_glob, duplicates_only
 *   Semantics: any enabled keep rule matching a file makes it untouchable.
 *   Otherwise the first matching enabled delete/move/transfer rule decides.
 *   Files matching no rule are left alone.
 */

'use strict';

const path = require('node:path');

const ACTIONS = ['delete', 'move', 'transfer', 'keep'];
const CATEGORIES = ['junk', 'chat_media', 'screenshot', 'live_photo_pair', 'camera_photo', 'camera_video', 'other', 'error'];
const MATCH_KEYS = ['categories', 'older_than_days', 'newer_than_days', 'larger_than_mb', 'smaller_than_mb', 'name_glob', 'duplicates_only'];

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateRules(rulesObj) {
  const errors = [];
  if (rulesObj === null || typeof rulesObj !== 'object' || Array.isArray(rulesObj)) {
    return { ok: false, errors: ['rules must be an object'] };
  }
  if (rulesObj.version !== 1) {
    errors.push('version must be 1');
  }
  if (!Array.isArray(rulesObj.rules)) {
    errors.push('rules must be an array');
    return { ok: false, errors };
  }
  const seenIds = new Set();
  rulesObj.rules.forEach(function (rule, i) {
    const where = 'rules[' + i + ']';
    if (rule === null || typeof rule !== 'object' || Array.isArray(rule)) {
      errors.push(where + ': must be an object');
      return;
    }
    if (typeof rule.id !== 'string' || rule.id.length === 0) {
      errors.push(where + ': id must be a non-empty string');
    } else if (seenIds.has(rule.id)) {
      errors.push(where + ': duplicate id "' + rule.id + '"');
    } else {
      seenIds.add(rule.id);
    }
    if (typeof rule.text !== 'string') {
      errors.push(where + ': text must be a string');
    }
    if (typeof rule.enabled !== 'boolean') {
      errors.push(where + ': enabled must be a boolean');
    }
    if (ACTIONS.indexOf(rule.action) === -1) {
      errors.push(where + ': action must be one of ' + ACTIONS.join('/'));
    }
    if (rule.action === 'move' || rule.action === 'transfer') {
      if (typeof rule.destination !== 'string' || rule.destination.length === 0) {
        errors.push(where + ': destination is required for action "' + rule.action + '"');
      }
    }
    if (rule.match === null || typeof rule.match !== 'object' || Array.isArray(rule.match)) {
      errors.push(where + ': match must be an object');
      return;
    }
    const m = rule.match;
    Object.keys(m).forEach(function (k) {
      if (MATCH_KEYS.indexOf(k) === -1) {
        errors.push(where + ': unknown match key "' + k + '"');
      }
    });
    if (m.categories !== undefined) {
      if (!Array.isArray(m.categories) || m.categories.length === 0) {
        errors.push(where + ': match.categories must be a non-empty array');
      } else {
        m.categories.forEach(function (c) {
          if (CATEGORIES.indexOf(c) === -1) {
            errors.push(where + ': unknown category "' + c + '"');
          }
        });
      }
    }
    ['older_than_days', 'newer_than_days', 'larger_than_mb', 'smaller_than_mb'].forEach(function (k) {
      if (m[k] !== undefined && (typeof m[k] !== 'number' || !isFinite(m[k]) || m[k] < 0)) {
        errors.push(where + ': match.' + k + ' must be a non-negative number');
      }
    });
    if (m.name_glob !== undefined && (typeof m.name_glob !== 'string' || m.name_glob.length === 0)) {
      errors.push(where + ': match.name_glob must be a non-empty string');
    }
    if (m.duplicates_only !== undefined && typeof m.duplicates_only !== 'boolean') {
      errors.push(where + ': match.duplicates_only must be a boolean');
    }
    if (Object.keys(m).length === 0) {
      errors.push(where + ': match must contain at least one condition');
    }
  });
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Natural-language rule parsing (best effort)
// ---------------------------------------------------------------------------

const UNIT_DAYS = { day: 1, week: 7, month: 30, year: 365 };

// Returns a rule object { text, match, action, destination } or null when the
// text cannot be parsed with confidence.
function parseRuleText(text) {
  if (typeof text !== 'string') return null;
  const original = text.trim();
  if (original.length === 0) return null;
  const lower = original.toLowerCase();

  // Action detection. Keep words win over delete words so phrases like
  // "never touch ..." are not misread.
  let action = null;
  let destination = null;
  if (/\b(keep|never touch|protect|do not touch|don't touch)\b/.test(lower)) {
    action = 'keep';
  } else if (/\bmove\b/.test(lower) || /\btransfer\b/.test(lower)) {
    action = /\btransfer\b/.test(lower) ? 'transfer' : 'move';
    // Destination: everything after the last " to ", preserving original case.
    const toMatch = /\bto\s+(.+)$/i.exec(original);
    if (!toMatch) return null;
    destination = toMatch[1].trim().replace(/^["']|["']$/g, '').replace(/[.,;]$/, '');
    if (destination.length === 0) return null;
  } else if (/\b(delete|remove|clean)\b/.test(lower)) {
    action = 'delete';
  }
  if (action === null) return null;

  const match = {};

  // Quoted glob, e.g. "IMG_*.PNG" or 'IMG_*.PNG'.
  const globMatch = /["']([^"']+)["']/.exec(original);
  if (globMatch && /[*?]/.test(globMatch[1])) {
    match.name_glob = globMatch[1];
  }

  // Categories. Order matters: "chat videos" must not fall through to videos.
  if (/\bscreenshots?\b/.test(lower)) {
    match.categories = ['screenshot'];
  } else if (/\bchat (media|videos?|photos?|images?)\b/.test(lower)) {
    match.categories = ['chat_media'];
  } else if (/\bjunk\b/.test(lower)) {
    match.categories = ['junk'];
  } else if (/\bvideos?\b/.test(lower)) {
    match.categories = ['camera_video'];
  } else if (/\bphotos?\b/.test(lower) || /\bpictures?\b/.test(lower)) {
    match.categories = ['camera_photo'];
  }

  // Duplicates.
  if (/\bduplicates?\b/.test(lower) || /\bdupes?\b/.test(lower)) {
    match.duplicates_only = true;
  }

  // Age: "older than N days/weeks/months/years".
  const older = /\bolder than\s+(\d+(?:\.\d+)?)\s*(day|week|month|year)s?\b/.exec(lower);
  if (older) {
    match.older_than_days = Math.round(parseFloat(older[1]) * UNIT_DAYS[older[2]]);
  }
  const newer = /\bnewer than\s+(\d+(?:\.\d+)?)\s*(day|week|month|year)s?\b/.exec(lower);
  if (newer) {
    match.newer_than_days = Math.round(parseFloat(newer[1]) * UNIT_DAYS[newer[2]]);
  }

  // Size: "larger than N mb/gb", "smaller than N mb/gb" (also bigger/over,
  // under as loose synonyms).
  const larger = /\b(?:larger|bigger|greater)\s+than\s+(\d+(?:\.\d+)?)\s*(mb|gb)\b/.exec(lower);
  if (larger) {
    match.larger_than_mb = parseFloat(larger[1]) * (larger[2] === 'gb' ? 1024 : 1);
  }
  const smaller = /\bsmaller\s+than\s+(\d+(?:\.\d+)?)\s*(mb|gb)\b/.exec(lower);
  if (smaller) {
    match.smaller_than_mb = parseFloat(smaller[1]) * (smaller[2] === 'gb' ? 1024 : 1);
  }

  // Refuse rules with no condition at all: they would match everything.
  if (Object.keys(match).length === 0) return null;

  return { text: original, match, action, destination };
}

// ---------------------------------------------------------------------------
// Glob matching (name only, case-insensitive)
// ---------------------------------------------------------------------------

function globToRegExp(glob) {
  let re = '^';
  for (const ch of glob) {
    if (ch === '*') re += '.*';
    else if (ch === '?') re += '.';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(re + '$', 'i');
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

function fileMatches(file, match, nowMs, globCache) {
  if (match.categories !== undefined) {
    if (match.categories.indexOf(file.category) === -1) return false;
  }
  if (match.duplicates_only === true) {
    if (file.duplicate !== true) return false;
  }
  if (match.older_than_days !== undefined || match.newer_than_days !== undefined) {
    // Files with unknown mtime never match age conditions.
    if (file.mtime === null || file.mtime === undefined) return false;
    const mtimeMs = Date.parse(file.mtime);
    if (isNaN(mtimeMs)) return false;
    const ageDays = (nowMs - mtimeMs) / 86400000;
    if (match.older_than_days !== undefined && !(ageDays > match.older_than_days)) return false;
    if (match.newer_than_days !== undefined && !(ageDays < match.newer_than_days)) return false;
  }
  if (match.larger_than_mb !== undefined) {
    if (typeof file.bytes !== 'number' || !(file.bytes > match.larger_than_mb * 1048576)) return false;
  }
  if (match.smaller_than_mb !== undefined) {
    if (typeof file.bytes !== 'number' || !(file.bytes < match.smaller_than_mb * 1048576)) return false;
  }
  if (match.name_glob !== undefined) {
    let re = globCache.get(match.name_glob);
    if (!re) {
      re = globToRegExp(match.name_glob);
      globCache.set(match.name_glob, re);
    }
    if (!re.test(path.basename(file.path))) return false;
  }
  return true;
}

// evaluate(scanObj, rulesObj) -> planObj. Assumes rulesObj already passed
// validateRules. Untouched files are omitted from the plan entirely.
function evaluate(scanObj, rulesObj) {
  const nowMs = Date.now();
  const globCache = new Map();
  const enabled = rulesObj.rules.filter(function (r) { return r.enabled; });
  const keepRules = enabled.filter(function (r) { return r.action === 'keep'; });
  const actRules = enabled.filter(function (r) { return r.action !== 'keep'; });

  const items = [];
  const keepExceptions = [];

  for (const file of scanObj.files) {
    // Keep priority: any matching enabled keep rule makes the file untouchable.
    let kept = null;
    for (const rule of keepRules) {
      if (fileMatches(file, rule.match, nowMs, globCache)) { kept = rule; break; }
    }
    if (kept) {
      keepExceptions.push({ path: file.path, rule_id: kept.id, rule_text: kept.text });
      continue;
    }
    // First matching enabled delete/move/transfer rule decides.
    for (const rule of actRules) {
      if (fileMatches(file, rule.match, nowMs, globCache)) {
        const item = {
          path: file.path,
          bytes: file.bytes,
          category: file.category,
          mtime: file.mtime === undefined ? null : file.mtime,
          action: rule.action,
          rule_id: rule.id,
          rule_text: rule.text
        };
        if (rule.action === 'move' || rule.action === 'transfer') {
          item.destination = rule.destination;
        }
        items.push(item);
        break;
      }
    }
    // No rule matched: file is left alone and omitted from the plan.
  }

  const summary = {};
  let totalBytes = 0;
  for (const a of ['delete', 'move', 'transfer']) {
    summary[a] = { count: 0, bytes: 0 };
  }
  for (const item of items) {
    summary[item.action].count += 1;
    const b = typeof item.bytes === 'number' ? item.bytes : 0;
    summary[item.action].bytes += b;
    totalBytes += b;
  }
  summary.total_bytes_freed = totalBytes;

  return {
    version: 1,
    generated: new Date(nowMs).toISOString(),
    root: scanObj.root,
    items,
    keep_exceptions: keepExceptions,
    summary
  };
}

module.exports = { validateRules, parseRuleText, evaluate, globToRegExp };
