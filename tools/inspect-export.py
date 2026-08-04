"""Describe what an export contains, without revealing what is in it.

Written for looking at a real export on the machine it belongs to. It reports
structure only - archive names, entry counts, formats, CSV column headers and
row counts - and never a single data value. Headers are schema; the rows under
them are somebody's life.

    python tools/inspect-export.py "C:/path/to/folder"

Nothing is written anywhere and nothing leaves the machine.
"""

import csv
import io
import os
import sys
import zipfile

SKIP_VALUES = True   # never print a cell, only the column names above them


def describe_csv(raw):
    """Column names and a row count. No values."""
    try:
        text = raw.decode("utf-8-sig", "replace")
    except Exception:
        return None
    rows = list(csv.reader(io.StringIO(text)))
    if not rows:
        return {"columns": [], "rows": 0}
    header = rows[0]
    # Samsung sometimes writes a marker line first and the real header second.
    if len(header) == 2 and header[0].lower().startswith("com."):
        header = rows[1] if len(rows) > 1 else header
        return {"columns": header, "rows": max(0, len(rows) - 2), "marker": True}
    return {"columns": header, "rows": max(0, len(rows) - 1)}


def main(folder):
    zips = sorted(f for f in os.listdir(folder) if f.lower().endswith(".zip"))
    if not zips:
        print("no .zip files in", folder)
        return
    for name in zips:
        path = os.path.join(folder, name)
        try:
            z = zipfile.ZipFile(path)
        except Exception as e:
            print("\n%s\n  cannot open: %s" % (name, e))
            continue

        entries = [e for e in z.infolist() if not e.is_dir()]
        exts = {}
        for e in entries:
            ext = os.path.splitext(e.filename)[1].lower() or "(none)"
            exts[ext] = exts.get(ext, 0) + 1

        print("\n%s" % name)
        print("  %d entries: %s" % (
            len(entries), ", ".join("%s x%d" % (k, v) for k, v in sorted(exts.items()))))

        for e in entries:
            if not e.filename.lower().endswith(".csv"):
                continue
            try:
                info = describe_csv(z.read(e))
            except Exception as err:
                print("    %-44s unreadable (%s)" % (os.path.basename(e.filename), err))
                continue
            if not info:
                continue
            cols = ", ".join(info["columns"][:8]) or "(no header)"
            print("    %-44s %5d rows  [%s]%s" % (
                os.path.basename(e.filename)[:44], info["rows"], cols,
                "  (marker line first)" if info.get("marker") else ""))
        z.close()


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
