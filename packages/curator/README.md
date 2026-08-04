# Muletto

Gallery cleanup with rules you write in plain language.

Status: v0.1. The scan -> rule -> plan -> review -> execute pipeline works
with metadata rules (category, age, size, name, duplicates). The AI
understanding pass (tagging, captioning, quality scoring) is not built yet.

## Quick start

```
node muletto.js scan D:\Photos
node muletto.js rule "delete screenshots older than 365 days"
node muletto.js rule "keep camera photos"
node muletto.js plan
node muletto.js review
node muletto.js execute approved-plan.json
node muletto.js execute approved-plan.json --commit
```

`review` prints the path of a local HTML page; open it in a browser, drop
plan.json onto it, approve items, and export approved-plan.json.

## Safety

- Execution is dry-run by default; nothing happens without `--commit`.
- Nothing is ever OS-deleted. "delete" moves files into
  `<root>\.muletto\trash\<runstamp>\<original relative path>`.
- Every run writes a manifest to `<root>\.muletto\runs\`.
- `node muletto.js undo <manifest>` restores files from that manifest.

## Rules

rules.json shape:

```json
{
  "version": 1,
  "rules": [
    {
      "id": "rule-1",
      "text": "delete screenshots older than 365 days",
      "enabled": true,
      "match": { "categories": ["screenshot"], "older_than_days": 365 },
      "action": "delete"
    }
  ]
}
```

Rules are evaluated in order. A matching enabled `keep` rule makes a file
untouchable; otherwise the first matching enabled delete/move/transfer rule
decides. Files matching no rule are left alone.

Match conditions (all present conditions must hold):

| Condition        | Type     | Meaning                                        |
| ---------------- | -------- | ---------------------------------------------- |
| categories       | array    | file category is one of these                  |
| older_than_days  | number   | mtime older than N days                        |
| newer_than_days  | number   | mtime newer than N days                        |
| larger_than_mb   | number   | file larger than N MB                          |
| smaller_than_mb  | number   | file smaller than N MB                         |
| name_glob        | string   | filename matches glob, e.g. `IMG_*.PNG`        |
| duplicates_only  | bool     | file is a flagged duplicate                    |

Actions: `delete`, `move`, `transfer` (both need `destination`), `keep`.
Full reference: [docs/rules.md](docs/rules.md).

## Licence

Source available, not open source. See `LICENSE` at the root of the repository.
