#!/usr/bin/env python3
"""Build a populated Meta export, at a scale no real one here reaches.

    python tools/make-meta-fixture.py

Writes tests/fixtures/meta-populated/ - two parts, committed, small.

---- why this is a fixture and not a wish ----

Three things about Meta exports are unexercised, and none of them can be
fixed by requesting another export from the accounts on this machine, because
those accounts are empty:

  volume            a few dozen entries proves nothing about a few thousand
  multi-part        Meta repeats the same JSON across parts; dedup is by
                    content and has only ever run on sample data
  mangled text      every accented character in a Norwegian export arrives
                    broken, and no real export here contains one

Normally a generated fixture would be a guess, and this project has a rule
against those. This one is not, and the reason is worth stating: Meta's
mangling is not a quirk to be approximated, it is a defined transformation.
Meta serialises JSON by escaping the UTF-8 *bytes* of a string one at a time,
so a correct parser hands back the latin-1 misreading of those bytes. That is
exactly:

    text.encode("utf-8").decode("latin-1")

and it is invertible. Before this file was written, that transformation was
run over Norwegian, over emoji, and over two strings that were never broken,
and handed to the shipped repair in apps/web/mojibake.js: seven of seven
round-tripped, and the two that were already correct came back untouched. So
the fixture is faithful rather than plausible.

What it still cannot prove is that Meta's real exports look like this in every
other respect - the folder layout and file naming here follow Meta's
documented shape and a real (if nearly empty) export, not a populated one.
TESTPLAN says so rather than dressing it up.
"""

import io
import json
import os
import random
import zipfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "tests", "fixtures", "meta-populated")

# Fixed, so the fixture is byte-stable and a diff means something changed.
random.seed(20260819)

# Meta writes the UTF-8 bytes one at a time, so a correct JSON parser returns
# the latin-1 misreading. Verified invertible by mojibake.js before use.
def mangle(s):
    return s.encode("utf-8").decode("latin-1")

PEOPLE = [
    ("Ingrid Kvam", True), ("Bjorn Aasen", True), ("Sanne Moller", True),
    ("Ase Ostgard", True), ("Elena Rossi", True), ("Takeshi Nakamura", True),
    # The negative: a thread whose text never contained a non-ASCII byte, so
    # the repair must leave every word of it alone.
    ("Plain Ascii", False),
]

# The characters this fixture exists to test cannot appear in this file: the
# project rule is plain ASCII everywhere and check.js enforces it, which it
# duly did on the first draft of this line. Built from code points instead,
# which is what the house rule says to do and is unambiguous besides.
AE, OE, AA = chr(0xE6), chr(0xF8), chr(0xE5)          # ae, oe, aa
AE_, OE_, AA_ = chr(0xC6), chr(0xD8), chr(0xC5)       # the capitals
GRIN, HEART = chr(0x1F600), chr(0x2764) + chr(0xFE0F)

ACCENTED = [
    "Kj" + AE + "re deg, takk for sist!",
    "Vi sees p" + AA + " Bl" + AA + "fjellet i morgen tidlig",
    "Det ble gr" + AA + "tt v" + AE + "r, s" + AA + " vi snudde ved broa",
    "Har du sett de sm" + AA + " " + OE + "yene utenfor Stavanger?",
    OE_ + "stfold er finere enn folk tror om v" + AA + "ren",
    "Jeg tar med kaffe og noe " + AA + " spise",
    "B" + AA + "ten g" + AA + "r klokka " + AA + "tte",
    AE_ + "resmedlem siden 2019",
    "God tur! " + GRIN,
    "Hjertelig takk " + HEART,
]
ASCII_ONLY = [
    "sounds good, see you then",
    "i will bring the coffee",
    "running ten minutes late",
    "no worries at all",
]

def thread(name, accented, n):
    lines = ACCENTED if accented else ASCII_ONLY
    msgs = []
    t = 1600000000000
    for i in range(n):
        t += random.randint(60000, 7200000)
        text = lines[i % len(lines)]
        msgs.append({
            "sender_name": mangle(name) if (i % 2 == 0 and accented) else (
                name if i % 2 == 0 else "Nora"),
            "timestamp_ms": t,
            "content": mangle(text) if accented else text,
        })
    return {
        # The thread title is mangled too. A conversation keyed by a broken
        # name is as unreadable as a broken message, and the repair has to
        # reach dictionary keys as well as values.
        "participants": [{"name": mangle(name) if accented else name},
                         {"name": "Nora"}],
        "title": mangle(name) if accented else name,
        "messages": msgs,
    }

def slug(name):
    return name.lower().replace(" ", "_") + "_17842"

def write_part(path, threads, extras):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in threads:
            z.writestr("your_facebook_activity/messages/inbox/" + slug(name) +
                       "/message_1.json",
                       json.dumps(data, ensure_ascii=True, indent=1))
        for rel, data in extras:
            z.writestr(rel, json.dumps(data, ensure_ascii=True, indent=1))

def main():
    os.makedirs(OUT, exist_ok=True)

    built = [(name, thread(name, accented, 320 if accented else 180))
             for name, accented in PEOPLE]
    total = sum(len(t[1]["messages"]) for t in built)

    profile = {"profile_v2": {
        "name": {"full_name": mangle("Nora Vik")},
        "registration_timestamp": 1500000000,
        "emails": {"emails": ["nora@example.com"]},
    }}
    logins = {"account_accesses_v2": [
        {"action": "Login", "timestamp": 1600000000 + i * 86400,
         "ip_address": "203.0.113." + str(10 + i), "user_agent": "Mozilla/5.0"}
        for i in range(40)]}

    # Part one holds everything. Part two repeats four of the threads
    # byte-for-byte, which is what Meta does across a split export and what
    # the content dedup has to notice. If dedup fails, the message total
    # doubles for those threads and the assertion catches it.
    write_part(os.path.join(OUT, "facebook-part-1.zip"), built,
               [("personal_information/personal_information/personal_information.json", profile),
                ("security_and_login_information/login_and_profile_creation/login_activity.json", logins)])
    write_part(os.path.join(OUT, "facebook-part-2.zip"), built[:4], [])

    repeated = sum(len(t[1]["messages"]) for t in built[:4])
    print("wrote " + os.path.relpath(OUT, ROOT))
    for f in sorted(os.listdir(OUT)):
        p = os.path.join(OUT, f)
        print("  %-24s %8.1f KB" % (f, os.path.getsize(p) / 1024.0))
    print("  %d threads, %d messages, %d of them repeated in part two"
          % (len(built), total, repeated))
    print("  distinct messages once dedup has run: %d" % total)

if __name__ == "__main__":
    main()
