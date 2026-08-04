# Rules reference

Rules live in rules.json in the working directory. The `plan` command applies
them to scan.json and writes plan.json. Rules can be written by hand or added
with `node muletto.js rule "..."`.

## Schema

```json
{
  "version": 1,
  "rules": [
    {
      "id": "rule-1",
      "text": "the user's original phrasing",
      "enabled": true,
      "match": {
        "categories": ["screenshot", "junk"],
        "older_than_days": 365,
        "newer_than_days": 30,
        "larger_than_mb": 100,
        "smaller_than_mb": 1,
        "name_glob": "IMG_*.PNG",
        "duplicates_only": true
      },
      "action": "delete",
      "destination": "\\\\nas\\photos\\archive"
    }
  ]
}
```

- `version` is always 1.
- `id` is unique within the file. The CLI generates sequential `rule-N` ids.
- `text` preserves what the user typed; it is echoed in plan.json items.
- `enabled: false` skips the rule entirely.
- Every key inside `match` is optional, but ALL present conditions must hold
  for the rule to match a file.
- `destination` is required for `move` and `transfer`, ignored otherwise.

## Match conditions

| Condition        | Type            | Semantics                                                          |
| ---------------- | --------------- | ------------------------------------------------------------------ |
| categories       | array of string | file's scan category is one of these; valid values: junk, chat_media, screenshot, live_photo_pair, camera_photo, camera_video, snapchat_memory, snapchat_overlay, other, error |
| older_than_days  | number          | file mtime is more than N days before now                          |
| newer_than_days  | number          | file mtime is less than N days before now                          |
| larger_than_mb   | number          | file size in bytes is greater than N * 1024 * 1024                 |
| smaller_than_mb  | number          | file size in bytes is less than N * 1024 * 1024                    |
| name_glob        | string          | case-insensitive glob against the base filename; `*` matches any run of characters, `?` one character |
| duplicates_only  | bool            | when true, only files the scanner flagged with `duplicate: true`   |

Null-mtime behavior: some scanned files have `mtime: null` (the scanner could
not read a timestamp). Such files never satisfy `older_than_days` or
`newer_than_days`, so age-conditioned rules skip them. Conditions that do not
involve time still apply normally.

## Evaluation order

1. All enabled `keep` rules are checked first, in array order. If any keep
   rule matches a file, the file is untouchable: it appears in
   `keep_exceptions` in plan.json and never in `items`, regardless of what
   later or earlier delete/move/transfer rules would say. Keep has priority.
2. Otherwise, enabled delete/move/transfer rules are evaluated in array
   order and the FIRST match decides the action. Later matching rules are
   ignored for that file.
3. Files matching no rule at all are left alone entirely; they appear
   nowhere in the plan.

## Actions

| Action   | Effect on `--commit`                                                                 |
| -------- | ------------------------------------------------------------------------------------ |
| delete   | move into `<root>\.muletto\trash\<runstamp>\<original relative path>`; never OS-deleted |
| move     | move within or between local paths to `destination`, preserving relative path         |
| transfer | copy to `destination` with hash verification, then stage the source to trash          |
| keep     | mark the file untouchable; overrides every other rule                                 |

## Worked examples

1. Plain text: `delete screenshots older than 365 days`

```json
{
  "match": { "categories": ["screenshot"], "older_than_days": 365 },
  "action": "delete"
}
```

2. Plain text: `keep camera photos`

```json
{
  "match": { "categories": ["camera_photo"] },
  "action": "keep"
}
```

3. Plain text: `delete duplicates only`

```json
{
  "match": { "duplicates_only": true },
  "action": "delete"
}
```

4. Plain text: `move camera videos larger than 500 mb to \\nas\photos\video`

```json
{
  "match": { "categories": ["camera_video"], "larger_than_mb": 500 },
  "action": "move",
  "destination": "\\\\nas\\photos\\video"
}
```

5. Plain text: `transfer camera photos older than 730 days to \\nas\photos\archive`

```json
{
  "match": { "categories": ["camera_photo"], "older_than_days": 730 },
  "action": "transfer",
  "destination": "\\\\nas\\photos\\archive"
}
```

6. Plain text: `delete files named IMG_*.PNG smaller than 1 mb`

```json
{
  "match": { "name_glob": "IMG_*.PNG", "smaller_than_mb": 1 },
  "action": "delete"
}
```
