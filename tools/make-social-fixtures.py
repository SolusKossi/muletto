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


# ---------------------------------------------------------------- WhatsApp

def whatsapp():
    """Four transcripts, because a WhatsApp export is written for a person to
    read and its shape depends on the phone and the phone's locale.

    The fourth one is the interesting one. Every date in it is on or before
    the twelfth, so day-first and month-first are both consistent with every
    line and no amount of parsing can tell them apart. A reader that silently
    picks one spreads a fortnight of messages across a year and every date it
    prints looks plausible. It has to say so instead."""
    lrm = chr(0x200e)   # iOS sprinkles these through the line, invisibly
    eol = chr(10)

    ios = eol.join([
        "[" + lrm + "06/08/2026, 14:32:11] Alice: hello there",
        "[06/08/2026, 14:32:40] Bob: hi - this message",
        "carries on over two lines",
        "[13/08/2026, 09:05:00] Alice: " + lrm + "<attached: 00000042-PHOTO-2026-08-13.jpg>",
        "[24/12/2026, 18:00:00] Bob: happy christmas",
    ]) + eol

    android = eol.join([
        "06/08/2026, 14:32 - Messages are end-to-end encrypted.",
        "06/08/2026, 14:33 - Alice: morning",
        "31/08/2026, 20:10 - Bob: IMG-20260831-WA0001.jpg (file attached)",
        "31/08/2026, 20:11 - Bob: <Media omitted>",
    ]) + eol

    iso = eol.join([
        "[2026-08-06, 14:32:11] Alice: iso locale",
        "[2026-11-30, 08:00:00] Bob: still iso",
    ]) + eol

    # Nothing above the twelfth anywhere: genuinely undecidable.
    short = eol.join([
        "[03/04/2026, 10:00:00] Alice: is this March or April",
        "[05/04/2026, 10:01:00] Bob: nobody can tell",
        "[07/04/2026, 10:02:00] Alice: not from this file",
    ]) + eol

    write("whatsapp.zip", {
        "WhatsApp Chat with Alice/_chat.txt": ios,
        "WhatsApp Chat with Alice/00000042-PHOTO-2026-08-13.jpg": png_bytes(),
        "WhatsApp Chat - Bob.txt": android,
        "WhatsApp Chat with Carol/_chat.txt": iso,
        "WhatsApp Chat with Dave/_chat.txt": short,
    })


def png_bytes():
    """The smallest valid PNG, so the media path has a real file to classify
    rather than a text file wearing a .jpg name."""
    import base64
    return base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk"
        "YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")


# ---------------------------------------------------------------- Amazon

def amazon():
    """The generic-reader traps, taken from TESTPLAN section 9.

    None of these are Amazon-specific in their effect - a byte-order mark on
    one file and not the next, a sentinel string where a date belongs, several
    timestamps joined by the word "and", a .schema.json sidecar next to the
    data it describes. They are listed under Amazon because that is the export
    they were found in, by byte inspection of real files, but every one of them
    reaches any service with no reader of its own. Fixing them in the generic
    reader fixes them everywhere at once, which is why this fixture is worth
    more than its provider.

    So this is deliberately not a full Amazon export. It is the smallest thing
    that reproduces the four traps."""
    eol = chr(10)
    bom = chr(0xfeff)

    # A BOM on this one. If it survives, the first column is not called
    # "Order ID" any more and nothing that looks for that column finds it.
    orders = bom + eol.join([
        "Order ID,Order Date,Ship Date,Total Owed",
        # Four parcels, four timestamps, joined by the word "and".
        '111-0000001,2026-01-04T09:00:00Z,'
        '"2026-01-05T10:00:00Z and 2026-01-06T10:00:00Z and '
        '2026-01-07T10:00:00Z and 2026-01-08T10:00:00Z",41.50',
        # Sentinels where a date and a number belong, two spellings of it.
        "111-0000002,2026-02-11T09:00:00Z,Not Available,19.99",
        "111-0000003,2026-03-02T09:00:00Z,unknown,Not Applicable",
        "111-0000004,2026-04-20T09:00:00Z,2026-04-21T10:00:00Z,7.25",
    ]) + eol

    # No BOM on this one, in the same export. That mixture is the documented
    # observation, not an invention.
    returns = eol.join([
        "Order ID,Return Date,Reason",
        "111-0000002,2026-02-20T12:00:00Z,Did not fit",
    ]) + eol

    return write("amazon.zip", {
        "Retail.OrderHistory.1/Retail.OrderHistory.1.csv": orders,
        # The sidecar. It is valid JSON and holds none of your data.
        "Retail.OrderHistory.1/Retail.OrderHistory.1.schema.json": {
            "fields": [{"name": "Order ID", "type": "string"},
                       {"name": "Order Date", "type": "timestamp"}]},
        "Retail.OrdersReturned.1/Retail.OrdersReturned.1.csv": returns,
    })


# ---------------------------------------------------------------- Fitbit

def fitbit():
    """Three traps, all the same trap: the filename lies.

    sleep-2026-01-05.json holds about a month of nights in reverse order and
    the date in its name is only where the block starts. The two folders come
    from the migration to Google, and hold the same metrics in different
    shapes - counted per file that doubles everything. And the minute-level
    files date themselves US-first with a two-digit year while the sleep files
    use ISO, in one export.

    So the fixture puts a day in two folders at once and dates one night far
    from the name of the file it sits in. A reader that trusts either filename
    gets a different, plausible, wrong answer."""
    # 01/05/26 is the fifth of January, not the first of May. Fitbit does not
    # follow the reader's locale, so this order is known rather than guessed.
    hr = [{"dateTime": "01/05/26 %02d:00:00" % h,
           "value": {"bpm": 60 + h, "confidence": 2}} for h in range(6)]
    steps = [{"dateTime": "01/05/26 %02d:00:00" % h, "value": str(100 * h)}
             for h in range(6)]
    # The same day again, in the other folder and the other shape.
    steps_google = [{"dateTime": "01/05/26 %02d:00:00" % h, "value": str(100 * h)}
                    for h in range(6)]

    # Named the fifth of January; the nights inside are in March, reversed.
    sleep = [
        {"logId": 3, "dateOfSleep": "2026-03-03", "minutesAsleep": 401,
         "startTime": "2026-03-02T23:10:00.000"},
        {"logId": 2, "dateOfSleep": "2026-03-02", "minutesAsleep": 388,
         "startTime": "2026-03-01T23:40:00.000"},
        {"logId": 1, "dateOfSleep": "2026-03-01", "minutesAsleep": 377,
         "startTime": "2026-02-28T23:05:00.000"},
    ]

    write("fitbit.zip", {
        "Fitbit/Global Export Data/heart_rate-2026-01-05.json": hr,
        "Fitbit/Global Export Data/steps-2026-01-05.json": steps,
        "Fitbit/Global Export Data/sleep-2026-01-05.json": sleep,
        # The second folder the Google migration leaves behind.
        "Takeout/Fitbit/Activity/steps-2026-01-05.json": steps_google,
        # Numbered, not dated, and holding no timestamps this reader can use.
        "Fitbit/Global Export Data/exercise-100.json": [
            {"activityName": "Run", "logType": "auto_detected"}],
    })


# ---------------------------------------------------------------- LinkedIn

def linkedin():
    """Connections.csv does not start with its header.

    It starts with a line saying Notes:, then a paragraph explaining that some
    email addresses are missing, then a blank line, and only then the real
    columns. Read straight the whole file becomes one column of that
    paragraph. It is also translated, so a reader that looks for the English
    word works on one account and not the next - the fixture keeps it in
    English because that is what an English account produces, and the reader
    has to recognise it by its shape rather than its words.

    messages.csv is flat, with a conversation id on every row, so the
    conversations have to be rebuilt from it. Two of the three here share an
    id and neither has a title, which is the ordinary case: grouping by title
    would merge them into one."""
    eol = chr(10)

    connections = eol.join([
        "Notes:",
        '"When exporting your connection data, you may notice that some of the '
        'email addresses are missing. Members can choose whether or not to '
        'share their email address."',
        "",
        "First Name,Last Name,Email Address,Company,Position,Connected On",
        "Ada,Lovelace,ada@example.invalid,Analytical Engines,Engineer,04 Jan 2026",
        "Grace,Hopper,,Navy,Rear Admiral,11 Feb 2026",
        "Alan,Turing,,NPL,Mathematician,02 Mar 2026",
    ]) + eol

    messages = eol.join([
        "CONVERSATION ID,CONVERSATION TITLE,FROM,TO,DATE,SUBJECT,CONTENT,FOLDER",
        "conv-1,,Ada Lovelace,You,2026-01-05 09:00:00,,Hello there,INBOX",
        "conv-1,,You,Ada Lovelace,2026-01-05 09:04:00,,Hello back,INBOX",
        "conv-2,,Grace Hopper,You,2026-02-12 14:00:00,,About the role,INBOX",
    ]) + eol

    shares = eol.join([
        "Date,ShareLink,ShareCommentary,SharedUrl,MediaUrl,Visibility",
        "2026-01-20 08:00:00,https://example.invalid/1,A post about something,,,MEMBER_NETWORK",
        "2026-04-02 08:00:00,https://example.invalid/2,Another post,,,MEMBER_NETWORK",
    ]) + eol

    write("linkedin.zip", {
        "Connections.csv": connections,
        "messages.csv": messages,
        "Shares.csv": shares,
        "Registration.csv": "Registered At,Registration Ip\n2011-06-01 10:00:00,203.0.113.9\n",
    })


# ---------------------------------------------------------------- Microsoft

def microsoft():
    """The privacy dashboard archive: activity records in a mixture of CSV and
    JSON, in one download. What it is not is the point - your files and your
    email are separate downloads from separate places, and this reader says so
    because that is what people open it expecting to find."""
    eol = chr(10)
    search = eol.join([
        "Date (UTC),Search Terms,Device",
        "2026-05-01 08:00:00,how to export my data,Windows",
        "2026-05-02 09:30:00,gdpr subject access request,Windows",
    ]) + eol
    location = eol.join([
        "Date (UTC),Latitude,Longitude,Accuracy",
        "2026-05-03 12:00:00,59.913868,10.752245,40",
        "2026-05-04 12:00:00,60.391262,5.322054,55",
    ]) + eol
    return write("microsoft.zip", {
        "Search history.csv": search,
        "Location history.csv": location,
        # The JSON half of the same archive.
        "Browse history.json": {"BrowseHistory": [
            {"Date": "2026-05-05T10:00:00Z", "Url": "https://example.invalid/a",
             "Title": "A page"},
            {"Date": "2026-05-06T10:00:00Z", "Url": "https://example.invalid/b",
             "Title": "Another page"},
        ]},
        "App and service usage.json": {"Usage": [
            {"Date": "2026-05-07T10:00:00Z", "Name": "Edge", "Type": "launch"},
        ]},
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
    whatsapp()
    amazon()
    fitbit()
    linkedin()
    microsoft()
    print("Run them with:  node tools/check-export.js tests/fixtures/social")
