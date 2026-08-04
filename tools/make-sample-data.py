"""Build the sample exports the site offers under "try it with sample data".

These stand in for a real export until one arrives, so they have to be real in
the ways that matter: real deflate-compressed zips, real JPEGs with real EXIF
dates and GPS, sidecar metadata in the shapes each provider actually uses, the
same photo appearing in two different exports, and enough history that the
timeline has something to scroll through.

Photos come from picsum.photos, which serves Unsplash-licensed photography.
They are cached under tools/vendor/photos, which is git-ignored: the generated
zips are committed, so a clone never needs the network unless the samples are
being rebuilt from scratch.

    python tools/make-sample-data.py

Writes to apps/web/samples/.
"""

import datetime as dt
import io
import json
import os
import random
import urllib.request
import zipfile
from fractions import Fraction

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "tools", "vendor", "photos")
# One destination. test-data/ held a byte-identical copy of the same four
# archives - 9 MB of duplication for no benefit, since the served copy under
# apps/web/samples is the one both the app and any manual test can reach.
OUTS = [os.path.join(ROOT, "apps", "web", "samples")]

# Fixed seed: the samples are checked in, so two runs must produce the same
# history or every rebuild churns the repo.
RNG = random.Random(20260728)

# Photos that exist in more than one export, byte for byte. Filled while the
# first export is built and reused by the second.
SHARED = []

# "Try it with sample data" downloads these over the network, so the whole set
# has to stay a few megabytes. 640px still fills the detail panel and the grid
# without looking soft.
PHOTO_W, PHOTO_Q = 640, 70


def _rat(v):
    return Fraction(v).limit_denominator(10000)


def dms(v):
    v = abs(v)
    d = int(v)
    m = int((v - d) * 60)
    s = ((v - d) * 60 - m) * 60
    return (_rat(d), _rat(m), _rat(round(s, 4)))


# picsum ids chosen for variety: landscape, city, interior, food, people, sea.
#
# Wider than it needs to be for the sparse months, because one month is
# deliberately dense for screenshots and a grid drawn from forty ids repeats
# visibly - repeats that read as duplicates the de-duplicator then fails to
# report, which is worse than a thin grid.
PHOTO_IDS = [
    1015, 1016, 1018, 1019, 1024, 1036, 1039, 1043, 1044, 1050,
    1051, 1057, 1059, 1060, 1069, 1074, 1080, 110, 111, 112,
    116, 122, 129, 133, 145, 152, 164, 169, 180, 184,
    190, 195, 201, 211, 225, 231, 238, 244, 250, 256,
    260, 274, 287, 292, 301, 305, 309, 314, 325, 331,
    342, 349, 357, 364, 370, 376, 385, 392, 401, 408,
    416, 421, 429, 437, 443, 450, 456, 464, 472, 481,
    490, 497, 503, 513, 521, 532, 540, 548, 556, 564,
]


def fetch_photo(pid):
    """One photo, cached. The cache is what makes rebuilds offline."""
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, "%d.jpg" % pid)
    if not os.path.exists(path):
        url = "https://picsum.photos/id/%d/1200/900.jpg" % pid
        req = urllib.request.Request(url, headers={"User-Agent": "muletto-sample-builder"})
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                data = r.read()
        except Exception as e:
            print("  skipped %d (%s)" % (pid, e))
            return None
        im = Image.open(io.BytesIO(data)).convert("RGB")
        if im.width > 1000:
            im = im.resize((1000, round(im.height * 1000 / im.width)), Image.LANCZOS)
        im.save(path, "JPEG", quality=85)
        print("  fetched %d" % pid)
    return Image.open(path).convert("RGB")


def usable_ids(ids):
    """Ids that actually resolve, so a dense month is dense."""
    out = []
    for pid in ids:
        if fetch_photo(pid) is not None:
            out.append(pid)
    return out


def jpeg(pid, when=None, gps=None, make=None, model=None, width=PHOTO_W):
    """A real JPEG, resized, with the EXIF a phone would have written."""
    im = fetch_photo(pid)
    if im is None:
        # picsum has gaps in its id space. One missing photo should not end a
        # build, so fall back to the first id that does resolve.
        for alt in PHOTO_IDS:
            im = fetch_photo(alt)
            if im is not None:
                break
    if im is None:
        raise SystemExit("No sample photos could be fetched - check the network.")
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    ex = Image.Exif()
    if make:
        ex[0x010F] = make
    if model:
        ex[0x0110] = model
    if when:
        stamp = when.strftime("%Y:%m:%d %H:%M:%S")
        ex[0x0132] = stamp
        ex[0x8769] = {0x9003: stamp, 0x9004: stamp}
    if gps:
        lat, lon = gps
        ex[0x8825] = {
            1: "N" if lat >= 0 else "S", 2: dms(lat),
            3: "E" if lon >= 0 else "W", 4: dms(lon),
        }
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=PHOTO_Q, exif=ex.tobytes() if len(ex) else b"")
    return buf.getvalue()


# ---------------------------------------------------------------- the history

HOME = (59.9139, 10.7522)        # Oslo
PLACES = [
    ("Oslo", 59.9139, 10.7522),
    ("Bergen", 60.3913, 5.3221),
    ("Berlin", 52.5200, 13.4050),
    ("Lisbon", 38.7223, -9.1393),
    ("Tromso", 69.6492, 18.9553),
    ("Copenhagen", 55.6761, 12.5683),
    ("Rome", 41.9028, 12.4964),
]

# Trips give the map and the timeline something with shape, rather than a
# uniform scatter that tells you nothing.
# (start, days, place, photos per day). The last entry is deliberately long and
# dense: May 2026 is the month the screenshots are taken from, and a half-empty
# grid undersells what the library view actually looks like for a real person.
TRIPS = [
    (dt.date(2021, 6, 11), 5, "Berlin", (2, 4)),
    (dt.date(2022, 3, 18), 4, "Lisbon", (2, 4)),
    (dt.date(2022, 9, 2), 3, "Bergen", (2, 4)),
    (dt.date(2023, 2, 10), 4, "Tromso", (2, 4)),
    (dt.date(2023, 7, 21), 6, "Rome", (2, 4)),
    (dt.date(2024, 5, 9), 3, "Copenhagen", (2, 4)),
    (dt.date(2025, 8, 14), 5, "Berlin", (2, 4)),
    (dt.date(2026, 5, 4), 16, "Rome", (4, 7)),
]

FRIENDS = [
    ("bjorn_a", "Bjorn Aasen"),
    ("ingrid.k", "Ingrid Kvam"),
    ("sanne_m", "Sanne Moller"),
    ("takeshi.n", "Takeshi Nakamura"),
    ("elena_r", "Elena Rossi"),
]

ME_SNAP, ME_META = "martin.l", "Martin"

CHAT_LINES = [
    "are we still on for saturday?", "yes! meet at 10", "sender that photo pls",
    "haha that was a good one", "im running 10 min late", "no worries",
    "did you see the weather for the weekend", "looks rough tbh",
    "wanna grab food after work", "im in", "which place", "the usual one",
    "sent you the tickets", "got them, thanks", "what time does it start",
    "doors at 7 i think", "on my way", "just landed", "how was the flight",
    "long but fine", "photos coming later", "please do", "that view though",
    "worth the early start", "same time next year?", "definitely",
]

NORSK = [
    "hei paa deg! saa du bildene fra hytta?", "ja, veldig fine",
    "sendte deg bildene fra turen", "takk, de ble fine",
    "skal du paa jobb i morgen?", "nei, har fri",
    "vi maa ta en kaffe snart", "enig, neste uke?",
]

SEARCHES = [
    "flights to berlin", "best coffee oslo", "how to fix a bike puncture",
    "weather tromso february", "pasta carbonara recipe", "train bergen to oslo",
    "lisbon viewpoints", "northern lights forecast", "camera settings low light",
    "rome opening hours colosseum", "what to pack for hiking",
    "copenhagen bike rental", "sourdough starter", "cheap flights september",
]

VIDEOS = [
    "How to shoot in manual mode", "Norway by train - full route",
    "Berlin street food tour", "Learn Portuguese in 10 minutes",
    "Everything about sourdough", "Northern lights explained",
    "Packing light for 2 weeks", "The best of Lisbon in 3 days",
]


def daterange_days(start, end):
    d = start
    while d <= end:
        yield d
        d += dt.timedelta(days=1)


def build_history():
    """One shared history, so the same day lines up across four exports."""
    start, end = dt.date(2020, 2, 14), dt.date(2026, 7, 20)

    trip_days = {}
    for begin, days, where, per_day in TRIPS:
        for i in range(days):
            trip_days[begin + dt.timedelta(days=i)] = (where, per_day)

    place_by_name = {p[0]: (p[1], p[2]) for p in PLACES}

    photos = []   # (datetime, lat, lon, place, picsum id)
    pid_i = 0
    for day, (where, per_day) in sorted(trip_days.items()):
        lat, lon = place_by_name[where]
        for _ in range(RNG.randint(*per_day)):
            when = dt.datetime.combine(day, dt.time(RNG.randint(8, 21), RNG.randint(0, 59)))
            photos.append((when, lat + RNG.uniform(-.03, .03), lon + RNG.uniform(-.03, .03),
                           where, PHOTO_IDS[pid_i % len(PHOTO_IDS)]))
            pid_i += 1
    # Ordinary days at home, so the record is not all holidays.
    home_days = [d for d in daterange_days(start, end)
                 if d not in trip_days and RNG.random() < 0.012]
    for day in home_days:
        when = dt.datetime.combine(day, dt.time(RNG.randint(9, 22), RNG.randint(0, 59)))
        photos.append((when, HOME[0] + RNG.uniform(-.05, .05), HOME[1] + RNG.uniform(-.05, .05),
                       "Oslo", PHOTO_IDS[pid_i % len(PHOTO_IDS)]))
        pid_i += 1
    photos.sort()

    locations = []
    for day in daterange_days(start, end):
        if day in trip_days:
            lat, lon = place_by_name[trip_days[day][0]]
            n = RNG.randint(3, 7)
        elif RNG.random() < 0.05:
            lat, lon = HOME
            n = RNG.randint(1, 3)
        else:
            continue
        for _ in range(n):
            locations.append((
                dt.datetime.combine(day, dt.time(RNG.randint(7, 23), RNG.randint(0, 59))),
                lat + RNG.uniform(-.04, .04), lon + RNG.uniform(-.04, .04),
                trip_days[day][0] if day in trip_days else "Oslo"))
    locations.sort()

    chats = {}
    for handle, display in FRIENDS:
        msgs = []
        for day in daterange_days(start, end):
            if RNG.random() > 0.02:
                continue
            for _ in range(RNG.randint(2, 6)):
                mine = RNG.random() < 0.5
                pool = NORSK if handle in ("bjorn_a", "ingrid.k") and RNG.random() < 0.4 else CHAT_LINES
                msgs.append({
                    "at": dt.datetime.combine(day, dt.time(RNG.randint(8, 23), RNG.randint(0, 59))),
                    "mine": mine, "text": RNG.choice(pool),
                })
        msgs.sort(key=lambda m: m["at"])
        chats[handle] = {"display": display, "messages": msgs}

    return {"start": start, "end": end, "photos": photos, "locations": locations,
            "chats": chats, "trip_days": trip_days}


# ------------------------------------------------------------------- writers

def zwrite(name, files):
    """Real deflate, so the reader's inflate path is genuinely exercised."""
    blob = io.BytesIO()
    with zipfile.ZipFile(blob, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for path, data in files:
            z.writestr(path, data if isinstance(data, bytes) else data.encode("utf-8"))
    data = blob.getvalue()
    for out in OUTS:
        os.makedirs(out, exist_ok=True)
        open(os.path.join(out, name), "wb").write(data)
    return len(data), len(files)


def js(obj):
    return json.dumps(obj, indent=1, ensure_ascii=True)


def snap_time(d):
    return d.strftime("%Y-%m-%d %H:%M:%S UTC")


def build_snapchat(h):
    files = []
    chat, snaps = [], []
    for handle, c in h["chats"].items():
        for m in c["messages"]:
            chat.append({
                "From": ME_SNAP if m["mine"] else handle,
                "Media Type": "TEXT",
                "Created": snap_time(m["at"]),
                "Content": m["text"],
                "Conversation Title": handle,
                "IsSender": m["mine"],
            })
    for when, lat, lon, place, pid in h["photos"][::3]:
        snaps.append({"From": RNG.choice(FRIENDS)[0], "Media Type": "IMAGE",
                      "Created": snap_time(when), "IsSender": False})
    chat.sort(key=lambda r: r["Created"])
    files.append(("json/chat_history.json", js({"Received Saved Chat History": chat})))
    files.append(("json/snap_history.json", js({"Received Snap History": snaps,
                                                "Sent Snap History": snaps[: len(snaps) // 3]})))
    files.append(("json/location_history.json", js({
        "Location History": [
            {"Time": snap_time(w), "Latitude, Longitude": "%.4f, %.4f" % (la, lo)}
            for w, la, lo, _ in h["locations"][::2]
        ]})))
    files.append(("json/friends.json", js({"Friends": [
        {"Username": u, "Display Name": d, "Creation Timestamp": "2019-04-02 10:00:00 UTC"}
        for u, d in FRIENDS]})))
    files.append(("json/account.json", js({"Basic Information": {
        "Username": ME_SNAP, "Creation Date": "2019-04-02 10:00:00 UTC"}})))
    # Memories arrive as an index of links, not as files. That is the thing the
    # guide warns about, so the sample has to show it too.
    files.append(("json/memories_history.json", js({"Saved Media": [
        {"Date": snap_time(w), "Media Type": "PHOTO",
         "Download Link": "https://app.snapchat.com/dmd/memories?expires=soon"}
        for w, _, _, _, _ in h["photos"][:40]]})))
    files.append(("html/chat_history.html", "<html><body><h1>Chat History</h1></body></html>"))
    for i, (when, lat, lon, place, pid) in enumerate(h["photos"][:6]):
        files.append(("memories/%s_snap_%02d.jpg" % (when.strftime("%Y-%m-%d"), i),
                      jpeg(pid, when, (lat, lon), "Snap Inc", "Snapchat", 720)))
    return files


def build_apple(h):
    """Apple's share, plus the pictures that also ended up in Google Photos.

    Real people back the same photo up twice. Those files are byte-identical
    wherever they landed, which is exactly what the duplicate finder is for -
    so the samples have to contain some, or the feature cannot be seen working.
    SHARED collects them so both exports write the same bytes.
    """
    files = []
    mine = h["photos"][1::3]
    for when, lat, lon, place, pid in mine:
        files.append(("Photos/IMG_%s.jpg" % when.strftime("%Y%m%d_%H%M%S"),
                      jpeg(pid, when, (lat, lon), "Apple", "iPhone 13 Pro")))
    # Every third one was also synced to Google, unchanged.
    for when, lat, lon, place, pid in mine[::3]:
        name = "Photos/IMG_%s.jpg" % when.strftime("%Y%m%d_%H%M%S")
        SHARED.append((when, lat, lon, place, pid, dict(files)[name]))
    # Invented titles by invented acts, but they have to read like song names.
    # "Track 0 by Artist 0" is the one row in these samples that looks like
    # unfinished test data rather than somebody's export.
    songs = ["Slow Ferry", "Kystlinje", "Halvveis hjem", "Blue Hour", "Tundra",
             "Nattbuss", "Paper Boats", "Fjellet sover", "Long Way Round", "Salt"]
    acts = ["Havbris", "The Winter Set", "Ingrid Vold", "Nordlys", "Kobb"]
    files.append(("Apple Media Services/Apple Music Play Activity.csv",
                  "Song Name,Artist,Event Start Timestamp\n" + "\n".join(
                      # Drawn, not cycled: anything reading every nth row out of
                      # this file hit the same stride and got one song back.
                      "%s,%s,%s" % (RNG.choice(songs), RNG.choice(acts),
                                    w.strftime("%Y-%m-%dT%H:%M:%SZ"))
                      for w, _, _, _, _ in h["photos"][:60])))
    files.append(("Apple ID account information/Apple ID Account Information.csv",
                  "Field,Value\nApple ID,sample.user@example.com\nCountry,Norway\n"))
    files.append(("Wallet/transactions.csv",
                  "Date,Merchant,Amount\n" + "\n".join(
                      "%s,%s,%d NOK" % (w.strftime("%Y-%m-%d"), RNG.choice(
                          ["Kaffebrenneriet", "Vinmonopolet", "Rema 1000", "Ruter", "SAS"]),
                          RNG.randint(45, 890))
                      for w, _, _, _, _ in h["photos"][:70])))
    return files


def build_google(h):
    files = []
    # The same bytes Apple already has, so the duplicate finder has something
    # real to find across two exports.
    for when, lat, lon, place, pid, blob in SHARED:
        base = "Takeout/Google Photos/%d/IMG_%s.jpg" % (when.year, when.strftime("%Y%m%d_%H%M%S"))
        files.append((base, blob))
        files.append((base + ".supplemental-metadata.json", js({
            "title": os.path.basename(base),
            "photoTakenTime": {"timestamp": str(int(when.timestamp())),
                               "formatted": when.strftime("%d %b %Y, %H:%M:%S UTC")},
            "geoData": {"latitude": lat, "longitude": lon, "altitude": 0.0},
        })))
    for when, lat, lon, place, pid in h["photos"][::3]:
        base = "Takeout/Google Photos/%d/PXL_%s.jpg" % (when.year, when.strftime("%Y%m%d_%H%M%S"))
        files.append((base, jpeg(pid, when, (lat, lon), "Google", "Pixel 7")))
        files.append((base + ".supplemental-metadata.json", js({
            "title": os.path.basename(base),
            "photoTakenTime": {"timestamp": str(int(when.timestamp())),
                               "formatted": when.strftime("%d %b %Y, %H:%M:%S UTC")},
            "geoData": {"latitude": lat, "longitude": lon, "altitude": 0.0},
        })))
    files.append(("Takeout/Location History/Records.json", js({"locations": [
        {"timestampMs": str(int(w.timestamp() * 1000)),
         "latitudeE7": int(la * 1e7), "longitudeE7": int(lo * 1e7), "accuracy": 12}
        for w, la, lo, _ in h["locations"]]})))
    files.append(("Takeout/My Activity/Search/MyActivity.json", js([
        {"header": "Search", "title": "Searched for " + RNG.choice(SEARCHES),
         "time": (dt.datetime.combine(d, dt.time(RNG.randint(7, 23), RNG.randint(0, 59)))).isoformat() + "Z"}
        for d in list(daterange_days(h["start"], h["end"]))[::9]])))
    files.append(("Takeout/YouTube and YouTube Music/history/watch-history.json", js([
        {"header": "YouTube", "title": "Watched " + RNG.choice(VIDEOS),
         "time": (dt.datetime.combine(d, dt.time(RNG.randint(18, 23), RNG.randint(0, 59)))).isoformat() + "Z"}
        for d in list(daterange_days(h["start"], h["end"]))[::13]])))
    files.append(("Takeout/Chrome/BrowserHistory.json", js({"Browser History": [
        {"title": "Example page", "url": "https://example.com/%d" % i,
         "time_usec": int(dt.datetime.combine(d, dt.time(12, 0)).timestamp() * 1e6)}
        for i, d in enumerate(list(daterange_days(h["start"], h["end"]))[::17])]})))
    return files


def build_instagram(h):
    files = []
    for handle, c in h["chats"].items():
        if handle in ("takeshi.n", "elena_r"):
            continue
        display = c["display"]
        msgs = [m for m in c["messages"] if RNG.random() < 0.45]
        if not msgs:
            continue
        thread = "messages/inbox/%s_17842/message_1.json" % handle.replace(".", "")
        files.append((thread, js({
            "participants": [{"name": display}, {"name": ME_META}],
            "title": display,
            "messages": [
                {"sender_name": ME_META if m["mine"] else display,
                 "timestamp_ms": int(m["at"].timestamp() * 1000),
                 "content": m["text"]}
                for m in reversed(msgs)],
        })))
    posts = []
    for when, lat, lon, place, pid in h["photos"][::7]:
        name = "media/posts/%s/%s.jpg" % (when.strftime("%Y%m"), when.strftime("%Y%m%d_%H%M%S"))
        files.append((name, jpeg(pid, when, (lat, lon), None, None, 720)))
        posts.append({"media": [{"uri": name, "creation_timestamp": int(when.timestamp()),
                                 "title": "In " + place}],
                      "creation_timestamp": int(when.timestamp())})
    files.append(("your_instagram_activity/content/posts_1.json", js(posts)))
    return files


def main():
    print("Building a shared history...")
    h = build_history()
    print("  %d photos, %d location points, %d conversations, %s to %s"
          % (len(h["photos"]), len(h["locations"]), len(h["chats"]), h["start"], h["end"]))

    print("Writing exports...")
    # Apple before Google: Apple fills SHARED and Google reuses it.
    for name, build in [("snapchat-export.zip", build_snapchat),
                        ("apple-export.zip", build_apple),
                        ("google-takeout.zip", build_google),
                        ("instagram-export.zip", build_instagram)]:
        size, n = zwrite(name, build(h))
        print("  %-24s %3d files  %7.1f KB" % (name, n, size / 1024))

    print("Written to " + " and ".join(os.path.relpath(o, ROOT) for o in OUTS))


if __name__ == "__main__":
    main()
