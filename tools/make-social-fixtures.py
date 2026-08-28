#!/usr/bin/env python3
"""Build one small export for each of the four services that just got a reader.

    python tools/make-social-fixtures.py

Writes tests/fixtures/social/ - four zips, committed, a few kilobytes each.

---- what these are, and what they are not ----

There is no real Spotify, X, Discord or Strava export on this machine, and
the house rule is to say so rather than to imply an afternoon of testing that
did not happen. So be exact about what a pass here means.

These fixtures encode the *container shape* each service documents: the file
names, the folder layout, the JavaScript wrapper X puts in front of its JSON,
the id-numbered channel folders Discord uses, the two different field
vocabularies Spotify's two histories use. A green run proves the reader finds
the right things in the right places and does not fall over. It proves
nothing about whether a real export from any of these four actually matches
what the service documents - only somebody's real export can prove that, and
the contribute flow in the app exists to collect exactly that.

That gap is why all four sit at `S` in TESTPLAN section 7 and 7a - synthetic,
the bottom rung - and why PROVIDERS says "not measured" for each of them in
those words.

What each fixture does deliberately exercise, because these are the places a
reader written from documentation goes wrong:

  spotify   both history vocabularies in one export - endTime/trackName/
            msPlayed alongside ts/master_metadata_track_name/ms_played - plus
            a row under thirty seconds, which Spotify counts as a skip and a
            naive reader counts as a play.

  x         the JavaScript wrapper, with a variable name that does NOT match
            the one every blog post quotes. Real archives have shipped
            `window.YTD.tweets.part0`, `window.YTD.tweet.part0` and a
            `tweet-part1.js`, so a reader that matches the exact prefix works
            on the author's archive and fails on everybody else's. The
            fixture uses the singular spelling on purpose.

  discord   the numbered channel folder with the readable name only in
            messages/index.json, and both message formats: one channel as the
            old messages.csv, one as the new messages.json. An export has one
            or the other depending on the year it was made.

  strava    a distance column holding metres in one row and kilometres in
            another, which is what Strava writes, and a GPX beside a .gpx.gz
            so the reader has to place one and report the other rather than
            quietly dropping it.

  tiktok    the renames. TESTPLAN section 8 lists what TikTok has moved since
            these exports started: the root key, four section names, the
            casing of fields inside one file, and five date formats side by
            side. The fixture uses the OLD name everywhere the reader is most
            likely to have been written against the new one, because a reader
            that only works on the export its author happened to have is the
            failure being tested for. Messages are a map keyed by the other
            person rather than a list, which is the shape that returns nothing
            to a reader expecting an array.
"""

import io
import json
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "tests", "fixtures", "social")


def write(name, files):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for inner, body in files.items():
            if isinstance(body, (dict, list)):
                body = json.dumps(body, indent=1)
            z.writestr(inner, body)
    print("  %-34s %2d files  %5d bytes" % (name, len(files), os.path.getsize(path)))


# ---------------------------------------------------------------- Spotify

def spotify():
    # The extended history: ts, ms_played, master_metadata_*, and the address
    # Spotify writes onto every row.
    extended = []
    for i in range(12):
        extended.append({
            "ts": "2026-0%d-14T20:%02d:00Z" % (1 + i % 8, i * 3),
            "platform": "android",
            "ms_played": 30000 + i * 11000,
            "conn_country": "NO" if i % 4 else "SE",
            "ip_addr_decrypted": "10.0.0.%d" % (20 + i),
            "master_metadata_track_name": "Track %d" % i,
            "master_metadata_album_artist_name": "Artist %d" % (i % 4),
            "master_metadata_album_album_name": "Album %d" % (i % 3),
            "reason_start": "trackdone",
            "skipped": False,
        })
    # Under thirty seconds: a skip, not a play.
    extended.append({
        "ts": "2026-08-14T21:00:00Z", "ms_played": 4000,
        "master_metadata_track_name": "Skipped one",
        "master_metadata_album_artist_name": "Artist 0",
        "conn_country": "NO", "ip_addr_decrypted": "10.0.0.99",
    })
    # The one-year history, which uses entirely different field names.
    short = [{
        "endTime": "2025-11-0%d 19:%02d" % (1 + i, i * 5),
        "artistName": "Artist %d" % (i % 3),
        "trackName": "Older track %d" % i,
        "msPlayed": 180000,
    } for i in range(6)]

    write("spotify.zip", {
        "Streaming_History_Audio_2025-2026_0.json": extended,
        "StreamingHistory_music_0.json": short,
        "Playlist1.json": {"playlists": [
            {"name": "Morning", "lastModifiedDate": "2026-05-02",
             "numberOfFollowers": 0},
            {"name": "Long drive", "lastModifiedDate": "2026-06-11",
             "numberOfFollowers": 3},
        ]},
        "YourLibrary.json": {"tracks": [
            {"artist": "Artist 1", "album": "Album 1", "track": "Track 1"},
            {"artist": "Artist 2", "album": "Album 2", "track": "Track 5"},
        ]},
        "Userdata.json": {"username": "fixture", "email": "fixture@example.invalid",
                          "country": "NO", "creationTime": "2016-03-04"},
    })


# ---------------------------------------------------------------- X (Twitter)

LONG_POST = ("A post long enough that X truncates it in the main file: " +
             "the rest of this sentence only exists in note-tweet.js, and a "
             "reader that never opens that file loses it without a word.")


def x_twitter():
    def wrapped(var, rows):
        # The wrapper is a line of JavaScript, not JSON. Deliberately the
        # singular spelling, which is not the one usually quoted.
        return "window.YTD.%s.part0 = %s" % (var, json.dumps(rows, indent=1))

    tweets = [{"tweet": {
        "id_str": "10000000000000000%d" % i,
        "created_at": "Wed Oct 1%d 20:19:24 +0000 2025" % (i % 10),
        "full_text": "Post number %d, with a link https://example.invalid/%d" % (i, i),
        "favorite_count": str(i * 2),
        "retweet_count": str(i),
        "entities": {"hashtags": [], "urls": []},
    }} for i in range(9)]
    # The truncated copy of a long post. tweet.js always holds one of these
    # and never says that it is short.
    tweets.append({"tweet": {
        "id_str": "100000000000000009",
        "created_at": "Mon Jan 06 08:00:00 +0000 2025",
        "full_text": LONG_POST[:60] + "...",
        "favorite_count": "40", "retweet_count": "11",
    }})
    # A date in a shape nothing parses, which is what an unreadable one looks
    # like. It must reach the table and stay off the timeline, and be counted.
    tweets.append({"tweet": {
        "id_str": "100000000000000010",
        "created_at": "sometime last spring",
        "full_text": "Undated post", "favorite_count": "0", "retweet_count": "0",
    }})

    dms = [{"dmConversation": {
        "conversationId": "111111-222222",
        "messages": [{"messageCreate": {
            "recipientId": "222222", "senderId": "111111" if i % 2 else "222222",
            "text": "Message %d" % i,
            "createdAt": "2025-1%d-05T10:0%d:00.000Z" % (i % 2, i),
        }} for i in range(6)],
    }}]

    write("x-twitter.zip", {
        "data/account.js": wrapped("account", [{"account": {
            "accountId": "111111", "username": "fixture",
            "email": "fixture@example.invalid", "createdAt": "2011-04-02T09:00:00.000Z",
        }}]),
        "data/tweet.js": wrapped("tweet", tweets),
        "data/direct-messages.js": wrapped("direct_messages", dms),
        "data/like.js": wrapped("like", [
            {"like": {"tweetId": "900%d" % i, "fullText": "Liked %d" % i}}
            for i in range(4)]),
        "data/follower.js": wrapped("follower", [
            {"follower": {"accountId": "33333%d" % i}} for i in range(3)]),
        # Part two of a split archive, holding OLDER posts than part one.
        # Real split archives are not in date order, so appending them in file
        # order gives a shuffled timeline.
        "data/tweet-part1.js": wrapped("tweet", [{"tweet": {
            "id_str": "10000000000000002%d" % i,
            "created_at": "Tue Feb 0%d 09:00:00 +0100 2024" % (1 + i),
            "full_text": "Older post %d" % i,
            "favorite_count": "1", "retweet_count": "0",
        }} for i in range(3)]),
        # An empty list, which is what X ships for anything you never used.
        "data/mute.js": "window.YTD.mute.part0 = [ ]",
        # The filename has hyphens and the variable has underscores. A reader
        # that builds the variable name from the filename finds nothing.
        "data/account-creation-ip.js": wrapped("account_creation_ip", [
            {"accountCreationIp": {"accountId": "111111",
                                   "userCreationIp": "203.0.113.7"}}]),
        # The long post, cut off in tweet.js and whole here. Nested the way
        # the newer archives nest it.
        "data/note-tweet.js": wrapped("note_tweet", [{"noteTweet": {
            "noteTweetId": "100000000000000009",
            "noteTweetResults": {"result": {
                "id": "100000000000000009",
                "text": LONG_POST,
            }},
        }}]),
    })


# ---------------------------------------------------------------- Discord

def discord():
    # Old format: messages.csv. The header Discord writes is exactly this.
    csv_rows = ["ID,Timestamp,Contents,Attachments"]
    for i in range(7):
        csv_rows.append('90000%d,2025-06-1%d 12:0%d:00,"Said something %d",'
                        % (i, i % 9, i, i))
    csv_rows.append('900099,2025-06-19 12:30:00,"Here is a picture",'
                    'https://cdn.discordapp.com/attachments/1/2/pic.png')

    # New format: messages.json.
    json_rows = [{"ID": 91000 + i, "Timestamp": "2026-02-0%d 09:1%d:00" % (1 + i, i),
                  "Contents": "Newer message %d" % i, "Attachments": ""}
                 for i in range(5)]

    write("discord.zip", {
        "account/user.json": {"id": "444444", "username": "fixture",
                              "global_name": "Fixture", "email": "f@example.invalid"},
        "messages/index.json": {"1122334455": "general-chat",
                                "5566778899": "Direct Message with someone"},
        "messages/c1122334455/channel.json": {
            "id": "1122334455", "type": 0, "name": "general-chat",
            "guild": {"id": "77", "name": "A server"}},
        "messages/c1122334455/messages.csv": "\n".join(csv_rows),
        "messages/c5566778899/channel.json": {
            "id": "5566778899", "type": 1, "recipients": ["444444", "555555"]},
        "messages/c5566778899/messages.json": json_rows,
        "servers/index.json": {"77": "A server"},
    })


# ---------------------------------------------------------------- Strava

def strava():
    gpx = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<gpx creator="StravaGPX" version="1.1" '
        'xmlns="http://www.topografix.com/GPX/1/1">'
        '<trk><name>Morning Run</name><trkseg>'
        '<trkpt lat="59.911491" lon="10.757933">'
        '<ele>12.0</ele><time>2026-04-11T06:02:11Z</time></trkpt>'
        '<trkpt lat="59.912004" lon="10.758801">'
        '<ele>12.4</ele><time>2026-04-11T06:02:21Z</time></trkpt>'
        "</trkseg></trk></gpx>"
    )
    # Strava writes both units under one heading, in one file.
    rows = [
        "Activity ID,Activity Date,Activity Name,Activity Type,Elapsed Time,Distance",
        '4000000001,"Apr 11, 2026, 6:02:11 AM",Morning Run,Run,2711,5.2',
        '4000000002,"Apr 13, 2026, 5:40:00 PM",Evening Ride,Ride,4400,24100',
        '4000000003,"May 02, 2026, 8:15:00 AM",Lunch Walk,Walk,1800,3.1',
        '4000000004,"Jun 09, 2026, 7:05:00 AM",Long Run,Run,6100,18400',
    ]
    write("strava.zip", {
        "activities.csv": "\n".join(rows),
        "activities/4000000001.gpx": gpx,
        # Gzipped, as most of a real export is. Stored as bytes so the reader
        # has to notice it cannot read it rather than mangling it.
        "activities/4000000002.gpx.gz": gzip_bytes(gpx),
        "activities/4000000004.fit.gz": gzip_bytes("not really a fit file"),
        "profile.csv": "First Name,Last Name,City,State,Country\nFixture,User,Oslo,,Norway",
        "clubs.csv": "Club ID,Club Name,Member Count\n900,A running club,412",
    })


def gzip_bytes(text):
    import gzip
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0) as g:
        g.write(text.encode("utf-8"))
    return buf.getvalue()


# ---------------------------------------------------------------- TikTok

def tiktok():
    # Every key here is the OLD name, and the casing is deliberately mixed the
    # way a real file mixes it: Link beside link, Date beside date.
    watch = [{"Date": "2026-03-1%d 20:14:07" % i,          # space separated
              "Link": "https://www.tiktokv.com/share/video/%d/" % (7000 + i)}
             for i in range(5)]
    watch.append({"date": "2026-03-20T18:00:00Z",          # ISO with Z
                  "link": "https://www.tiktokv.com/share/video/7999/"})
    watch.append({"Date": "2026-03-21T19:30:00",           # ISO with T, no zone
                  "Link": "https://www.tiktokv.com/share/video/8000/"})
    watch.append({"create_time": 1774000000,               # epoch seconds
                  "link": "https://www.tiktokv.com/share/video/8001/"})
    watch.append({"Timestamp": 1774000000000,              # epoch milliseconds
                  "Link": "https://www.tiktokv.com/share/video/8002/"})
    watch.append({"Date": "last tuesday",                  # nothing can read it
                  "Link": "https://www.tiktokv.com/share/video/8003/"})

    return write("tiktok.zip", {
        # The older of the two names.
        "user_data.json": {
            # The old root, not "Your Activity".
            "Activity": {
                # The old section name, not "Watch History".
                "Video Browsing History": {"VideoList": watch},
                # The old section name, not "Searches".
                "Search History": {"SearchList": [
                    {"Date": "2026-02-0%d 11:00:00" % (1 + i),
                     "SearchTerm": "search %d" % i} for i in range(4)]},
                # The old section name, not "Follower".
                "Follower List": {"FansList": [
                    {"Date": "2026-01-05 09:00:00", "UserName": "someone%d" % i}
                    for i in range(3)]},
                # A map keyed by the other person, not a list.
                "Chat History": {
                    "Chat History with someone1:": [
                        {"Date": "2026-02-10 08:0%d:00" % i, "From": "someone1",
                         "Content": "message %d" % i} for i in range(4)],
                    "Chat History with someone2:": [
                        {"Date": "2026-02-11 09:00:00", "From": "you",
                         "Content": "hello"}],
                },
            },
            # Likes under a third root entirely, which some exports do.
            "Likes and Favorites": {
                "Like List": {"ItemFavoriteList": [
                    {"date": "2026-02-1%d 12:00:00" % i,
                     "link": "https://www.tiktokv.com/share/video/%d/" % (6000 + i)}
                    for i in range(6)]},
            },
            "Profile": {"Profile Information": {"ProfileMap": {
                "userName": "fixture", "emailAddress": "f@example.invalid"}}},
        },
    })


def tiktok_newer():
    """The same account, exported later: new filename, new root, new section
    names. A reader that works on one of these two and not the other is the
    exact failure TESTPLAN section 8 warns about, so both are kept."""
    write("tiktok-newer.zip", {
        "user_data_tiktok.json": {
            "Your Activity": {
                "Watch History": {"VideoList": [
                    {"Date": "2026-07-0%d 20:00:00" % (1 + i),
                     "Link": "https://www.tiktokv.com/share/video/%d/" % (9000 + i)}
                    for i in range(4)]},
                "Searches": {"SearchList": [
                    {"Date": "2026-07-10 11:00:00", "SearchTerm": "later search"}]},
                "Follower": {"FansList": [
                    {"Date": "2026-07-11 09:00:00", "UserName": "someone9"}]},
            },
            "Profile": {"Profile Information": {"ProfileMap": {
                "userName": "fixture", "emailAddress": "f@example.invalid"}}},
        },
    })


def tiktok_txt():
    """The TXT request. A different shape nobody documents, which the reader
    has to recognise and explain rather than open as nothing."""
    eol = chr(10)
    write("tiktok-txt.zip", {
        "user_data.txt": eol.join([
            "Date: 2026-07-01",
            "Video Browsing History:",
            "https://www.tiktokv.com/share/video/9000/",
        ]) + eol,
    })


if __name__ == "__main__":
    print("Writing " + os.path.normpath(OUT))
    spotify()
    x_twitter()
    discord()
    strava()
    tiktok()
    tiktok_newer()
    tiktok_txt()
    print("Run them with:  node tools/check-export.js tests/fixtures/social")
