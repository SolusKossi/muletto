#!/usr/bin/env node
// muletto.js - thin CLI dispatcher. node muletto.js <command> [args]

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const HERE = __dirname;

function delegate(script, args) {
  const full = path.join(HERE, script);
  const res = spawnSync(process.execPath, [full, ...args], { stdio: "inherit" });
  process.exit(res.status === null ? 1 : res.status);
}

function usage() {
  console.log(
    [
      "muletto - gallery cleanup with plain-language rules",
      "",
      "usage: node muletto.js <command> [args]",
      "",
      "commands:",
      "  scan <dir> [args]   scan a directory, write scan.json",
      "  rule \"text\"         parse a plain-language rule, append to rules.json",
      "  plan [args]         apply rules.json to scan.json, write plan.json",
      "  review              print path of the browser review page",
      "  execute [args]      run a plan (dry-run by default, --commit to act)",
      "  undo [args]         restore from a run manifest",
      "  help                this text",
    ].join("\n")
  );
}

function cmdReview() {
  const page = path.join(HERE, "ui", "review.html");
  console.log(page);
  console.log("Open the file above in a browser, then drop plan.json onto the page.");
  console.log("Approve or reject items and export the approved plan for execute.");
}

function cmdRule(args) {
  const text = args.join(" ").trim();
  if (!text) {
    console.error("usage: node muletto.js rule \"delete screenshots older than 365 days\"");
    process.exit(1);
  }
  const { parseRuleText } = require(path.join(HERE, "src", "rules.js"));
  const parsed = parseRuleText(text);
  if (!parsed) {
    console.error("could not parse rule: " + text);
    console.error("");
    console.error("supported patterns (combine freely in one rule):");
    console.error("  action:     delete | keep | move to <dest> | transfer to <dest>");
    console.error("  categories: screenshots, chat media, junk, live photo pairs,");
    console.error("              camera photos, camera videos");
    console.error("  age:        older than N days/months/years, newer than N days/months/years");
    console.error("  size:       larger than N mb, smaller than N mb");
    console.error("  name:       named IMG_*.PNG (glob)");
    console.error("  duplicates: duplicates only");
    process.exit(1);
  }

  const rulesPath = path.resolve(process.cwd(), "rules.json");
  let doc = { version: 1, rules: [] };
  if (fs.existsSync(rulesPath)) {
    doc = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
    if (!Array.isArray(doc.rules)) doc.rules = [];
  }
  let maxId = 0;
  for (const r of doc.rules) {
    const m = /^rule-(\d+)$/.exec(String(r.id || ""));
    if (m) maxId = Math.max(maxId, Number(m[1]));
  }
  const rule = {
    id: "rule-" + (maxId + 1),
    text: text,
    enabled: true,
    match: parsed.match,
    action: parsed.action,
  };
  if (parsed.destination) rule.destination = parsed.destination;
  doc.rules.push(rule);
  fs.writeFileSync(rulesPath, JSON.stringify(doc, null, 2) + "\n");

  console.log("added " + rule.id + " to " + rulesPath);
  console.log("parsed as: " + JSON.stringify({ match: rule.match, action: rule.action, destination: rule.destination }, null, 2));
}

const [, , command, ...rest] = process.argv;

switch (command) {
  case "scan":
    delegate(path.join("scanner", "scan.js"), rest);
    break;
  case "plan":
    delegate(path.join("src", "plan.js"), rest);
    break;
  case "execute":
    delegate(path.join("src", "execute.js"), rest);
    break;
  case "undo":
    delegate(path.join("src", "undo.js"), rest);
    break;
  case "review":
    cmdReview();
    break;
  case "rule":
    cmdRule(rest);
    break;
  case "help":
  case undefined:
    usage();
    break;
  default:
    console.error("unknown command: " + command);
    usage();
    process.exit(1);
}
