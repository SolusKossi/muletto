#!/usr/bin/env python3
"""Build a photo library big enough to make the grid recycle tiles.

    python tools/make-large-library.py [count]

Writes apps/web/_local/large-library.zip, which is gitignored. The archive is
not committed and does not need to be: it is a few hundred identical-shaped
JPEGs, and the generator is smaller than its output.

---- what this is for ----

`explorer.js` virtualises the photo grid - it keeps a window of tiles in the
DOM and recycles the rest as you scroll, so a library of fifty thousand
photographs does not become fifty thousand elements. TESTPLAN has carried
"tile recycling past 400 photographs" as untested since it was written, for
the plain reason that the sample library is smaller than the window.

Needs ffmpeg, which produces several hundred distinct frames in one pass. The
frames are a test pattern rather than photographs, which is all this needs:
the grid does not care what is in a tile, only how many there are.

---- and what it cannot do ----

The recycling itself has to be watched in a real browser window. It is driven
by an IntersectionObserver, and in a browser pane that is not compositing
frames, IntersectionObserver never fires at all - measured, along with
requestAnimationFrame and requestIdleCallback, all three silent. A tile count
taken there would say nothing was recycled, which is what a broken grid would
also say. The measuring script is apps/web/_local/measure-tiles.js, pasted into the
console on app.html with the Photos view open.
"""

import os
import subprocess
import sys
import zipfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
LOCAL = os.path.join(ROOT, "apps", "web", "_local")
COUNT = int(sys.argv[1]) if len(sys.argv) > 1 else 520

def main():
    if not LOCAL or not os.path.isdir(os.path.dirname(LOCAL)):
        print("apps/web is missing")
        return 1
    os.makedirs(LOCAL, exist_ok=True)
    frames = os.path.join(LOCAL, "_frames")
    os.makedirs(frames, exist_ok=True)
    for old in os.listdir(frames):
        os.remove(os.path.join(frames, old))

    # One ffmpeg pass rather than one per file. Small and heavily compressed:
    # the point is the count, not the picture.
    cmd = ["ffmpeg", "-loglevel", "error", "-y",
           "-f", "lavfi", "-i",
           "testsrc=size=160x120:rate=1:duration=" + str(COUNT),
           "-q:v", "18", os.path.join(frames, "f_%04d.jpg")]
    try:
        subprocess.run(cmd, check=True)
    except (OSError, subprocess.CalledProcessError) as err:
        print("ffmpeg is needed and did not run: %s" % err)
        return 1

    made = sorted(f for f in os.listdir(frames) if f.endswith(".jpg"))
    out = os.path.join(LOCAL, "large-library.zip")
    # Dated names, so the timeline and the date rail have something to group
    # by as well - a grid of undated photographs exercises less than it looks.
    with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED) as z:
        for i, f in enumerate(made):
            day = 1 + (i % 28)
            month = 1 + ((i // 28) % 12)
            year = 2019 + (i // (28 * 12))
            name = "memories/%04d-%02d-%02d_frame%04d-main.jpg" % (year, month, day, i)
            z.write(os.path.join(frames, f), name)

    for f in made:
        os.remove(os.path.join(frames, f))
    os.rmdir(frames)

    size = os.path.getsize(out)
    print("wrote apps/web/_local/large-library.zip")
    print("  %d photographs, %.1f MB, gitignored" % (len(made), size / 1048576.0))
    print("")
    print("  To measure, in a real browser window (not a preview pane):")
    print("    1. open http://localhost:5173/app.html")
    print("    2. switch to the Photos view")
    print("    3. paste this into the console:")
    print('       fetch("_local/measure-tiles.js").then(r => r.text()).then(eval)')
    return 0

if __name__ == "__main__":
    sys.exit(main())
