# What Muletto reads, service by service

What each service sends, what Muletto does with it, and what it does not. Read
this before spending an afternoon requesting an export.

**Measured** means counted in a real export on a real machine. Everything else
comes from the service's documentation and is marked as such.

| Mark | Meaning |
|---|---|
| **View** | A screen built for this kind of data |
| **Read** | Parsed into the library: searchable, in the timeline, exportable |
| **Listed** | Shown as a table or a file, as the service wrote it |
| **-** | Not handled |

Listed is not a failure. A table of settings is a table of settings. It counts
as a gap only where the data deserves better, and those are named below.

---

## Google (Takeout)

Google exports [more than seventy
products](https://en.wikipedia.org/wiki/Google_Takeout), and the list grows.
`.tgz` and `.zip` are offered on the same screen. Both work, but prefer `.zip`
for a large Takeout: gzip is not seekable, so a `.tgz` has to be unpacked in
one pass while a `.zip` is read where it sits.

**Measured** in a real 37 GB Takeout, 6 archives, 6,524 entries.

| Area | Entries | What Muletto does |
|---|---|---|
| Google Photos | 5,041 | **Read**. Photos, videos, and the sidecar JSON carrying the date and place. 2,514 of 2,524 media dated |
| Drive | 845 | Listed, and dated from the archive's own timestamps, which Drive writes truthfully |
| Google Play Games Services | 273 | Listed |
| YouTube and YouTube Music | 192 | **View**. Comments, with replies threaded. Playlists, subscriptions and video metadata are **Read** |
| My Activity | 31 | **View**. Search and watch history, parsed from Google's HTML |
| Keep | 14 | Listed |
| Maps | 10 | **Read**. Places |
| Chrome, Contacts, Calendar, Play Store, Pay and 30 more | ~60 | Listed |
| Mail (mbox) | 1 file | **View**. Headers only, streamed, so a 776 MB mbox is searchable without holding a message |

Photos is the reason to open a Takeout: the sidecar gives back the date and
location the file itself lost, and half the library depends on it. Measured
over 2,344 photographs, 49.1% still carry `DateTimeOriginal`, 50.2% have the
date only in the sidecar, and 0.8% have it nowhere.

**Google Fit is written from documentation and has never seen a real export.**
The Takeout here has no `Fit/` folder. If the format matches the docs, it
reads `Fit/Daily activity metrics/` and splits each wide row into one series
per measurement, so steps, calories, distance, active minutes, heart rate and
weight each get a panel. Average, maximum and minimum heart rate collapse to
the average. `Fit/Activities/` holds a TCX per session and is not read. Treat
all of it as a guess; `TESTPLAN.md` marks it `S`.

**Gaps, in the order they hurt:**

- **Mail is headers only.** Who, what and when. No bodies, no attachments, no
  thread view.
- **The YouTube history file is skipped above 20 MB.** It is 48 MB on its own
  in a real Takeout. The other ten products read fine.
- Chrome history and Keep are listed rather than read.
- Location History arrives as an empty Timeline folder. Google moved Timeline
  onto the phone and shut the server-side one down in June 2025, so there is
  nothing left for a Takeout to include.

---

## Apple

Apple's Data and Privacy export covers account and sign-in records, iCloud
contents, purchase history, and marketing and support history. **Photos and
Drive files are a separate iCloud download**, which is the thing that catches
people out. See [Apple's page](https://support.apple.com/en-us/HT208502).

**Measured** in a real export of 18 archives and 1,020 entries, which becomes
1,414 once the archives inside archives are opened. Seven of the eighteen
contain further archives, and 394 entries were invisible until that was
handled.

| Area | Entries | What Muletto does |
|---|---|---|
| iCloud Notes | 860 | **View**. Notes, with the first line as the title |
| iCloud Contacts | 112 | **View**. Contacts, one card each |
| Apple Features Using iCloud | 323 after nesting | **View**. Audio. The 319 Siri recordings play from the archive |
| Apple Media Services | 67 after nesting | **Read**. Purchase and store history |
| Apple Account and device information | 14 | **Read** |
| Calendars and Reminders | 5 | **View**. Calendar, events and reminders together |
| Wallet, AppleCare, Bookmarks | ~10 | **Read** |

**Gaps:** `.pages` and `.numbers` are zip containers and are deliberately not
opened.

---

## Apple Health

A different export from a different place, and worth being careful about.
Apple's support pages say health data can be included in a Data and Privacy
request, but the real eighteen-archive export measured here arrived without
any, so this file is written against the phone's own export: one XML document
with an element per reading, off the device in about a minute. Whether the
account request can also deliver it has not been tested.

**Measured** in a real export: a 6.8 MB zip holding 161 MB of `export.xml`,
385,299 readings across four years, read in about a second. The XML is
streamed and each reading folded into a daily figure as it goes past, so the
whole document costs about 10 MB of memory. A day is the unit these are read
in anyway; 87,000 individual basal energy readings would be a block of ink.

| Area | What Muletto does |
|---|---|
| Steps, distance, floors | **View**. Health, one panel each |
| Active energy | **View**, as Calories. Basal energy stays a table under Resting energy so the two do not collide |
| Heart rate, weight | **View** |
| Walking speed | **View**. Step length, asymmetry, double support and steadiness stay tables |
| Headphone audio exposure | **View**, as Headphone volume |
| Sleep | **View**, named for what was measured: a watch gives Sleep, a phone alone gives **Time in bed** |
| `export_cda.xml`, workout GPX | Listed |

**Gaps:** four of the five gait metrics are readable as tables but get no
panel. Workouts and activity summaries are not read; this export held one
workout and 1,449 daily summaries.

---

## Samsung

Samsung's privacy portal sends one archive per service, and **every entry in
every archive is encrypted**: WinZip AES-256, password emailed separately.
Muletto handles that, including the legacy ZipCrypto one service still uses,
and verifies each entry's authentication code, so a damaged download is named
as damaged instead of parsed into nonsense.

**Measured** in a real export of 9 archives and 57 entries, all encrypted.

| Area | What Muletto does |
|---|---|
| Samsung Health: heart rate, weight, goal, food goal, device profile, user profile | **View**. Health, a panel per kind found and a list of the kinds that are absent |
| Samsung Account, Galaxy Store, Samsung Cloud, SmartThings Find, PENUP | **Read** as tables |
| S-Note3 | **Read**. `.spd` is a zip, so 21 notes open and the **21 pictures inside them** come out |
| S-Browser Tabs, Subscription Hub | **Read** |
| `.xlsx` (Samsung Account, ANS tickets) | **Read** as tables. Shared strings resolved, absent cells placed by reference, and stacked tables split: the account dump is five tables in one sheet |

The health catalogue lists seventeen kinds, so an export containing two of them
says which fifteen are missing and what each would need.

**Gaps:** the S Note page format is proprietary, so the words and strokes of a
handwritten note stay unread. The pictures in them do not.

---

## Instagram and Facebook (Meta)

Meta lets you choose categories, so two exports of the same account can look
nothing alike. JSON and HTML are both offered. **Choose JSON**: it is the one
Muletto reads, and the HTML is the same data with the structure removed.

**Measured** in a real partial Instagram export of 42 entries.

| Area | What Muletto does |
|---|---|
| `messages/inbox/` | **Read**. Conversations, grouped by person |
| `personal_information/`, `login_and_profile_creation/` | **Read** as tables |
| `followers_and_following/`, `past_instagram_insights/`, `shopping/`, `monetization/` | Listed |

Facebook uses the same parser. A real Facebook export has been opened in it,
but from an account with almost nothing in it, so it shows the parser opens
one and nothing about how it copes with a full account. **A Facebook export
with years of posts and messages in it is the most useful thing anyone could
send this project.**

**Gaps:**

- **No dedicated view for anything.** Posts, reels, stories, comments, likes,
  saved items and ad interests all land in tables.
- **The mojibake repair now has a populated fixture, not a real export.**
  Meta writes UTF-8 escaped byte by byte, so Norwegian text arrives mangled.
  That transformation is exact rather than approximate, so it can be
  generated: 2,100 messages of Norwegian and emoji, with the thread titles and
  sender names mangled too, all of it repaired with nothing left broken. A
  real export with accented text in it has still never been opened.

---

## Snapchat

**Measured** in a real export: 2 archives, 2.1 GB, 608 entries. That download
is memories only, so the chat and location files are still unmeasured.

| Area | What Muletto does |
|---|---|
| Memories | **Read**. 480 memories, every one dated |
| Split captions | **Merged**. 126 overlays, all paired, no orphans |
| Chat history | **Read**, from the format. No real file has been opened |
| Memories metadata | **Read**. Events and places, from the format |

**Dates.** Snapchat strips the metadata out of a memory and writes the date
into the filename instead. Reading only the files, 45% of this export had a
date; reading the names as well, all of it does.

**Split captions.** A memory with a caption, sticker or drawing on it arrives
as two files: `<id>-main.jpg` and `<id>-overlay.png`, the second being the
caption alone on transparency. Import that folder anywhere else and every
overlay shows up as white writing on a black square, sitting beside the memory
it belonged to. Muletto pairs them on the shared name and draws the caption
back on. Of the 126 pairs here, 94 are pictures, which composite, and 32 are
videos, which do not: burning a caption into an mp4 means re-encoding it, so
those keep the overlay and it is written beside the memory as `-caption.png`.
An overlay whose memory is absent is kept and named in a note.

**Gaps:** memories can arrive as time-limited download links rather than
files, in which case there is nothing in the archive to read and Muletto says
so on opening. This export contained real files. Chat and location history are
read from the documented format and have not been seen.

---

## Reddit

**Not measured against a real export.** Written from the format and tested
against a sample built to match it. A Reddit export is a flat bag of CSVs with
no folder, no manifest and no index page.

| Area | What Muletto does |
|---|---|
| Posts and comments | **Read**. Timeline entries, labelled with the subreddit |
| Private messages | **Read**. Conversations, grouped by the other person |
| Votes, saved, hidden | **Read** as tables |
| Subscribed subreddits | **Read** |
| Everything else | Listed and shown as written |

Columns are matched by pattern, never by position. Reddit has changed these
before, and a reader that assumes column four is the subreddit becomes silent
nonsense the day a column is inserted.

Reddit puts the internet address you posted from on every post and comment.
Muletto says so on opening rather than filing it in a column nobody scrolls to.

**On borrowing.** There is a good open-source viewer for these exports,
`guilamu/reddit-gdpr-export-viewer`, and it is AGPL-3.0, which this licence
cannot take. None of its code is here. The shape of a CSV is a fact and not
its author's to license, so the format is all that is shared.

---

## Spotify

Two exports, confusingly named. The one that arrives in a few days is your
last year; the extended history, which goes back to the start of the account,
is a separate request on the same page and takes up to thirty days. People who
asked for the second and got the first have no way to tell from the file names
which one they are holding, so Muletto says which it found.

**Not measured.** Written from Spotify's documented format and exercised
against a fixture built to it. No real Spotify export has been opened.

| Area | What Muletto does |
|---|---|
| Streaming history | **Read**. Every play on the timeline, both file formats |
| Playlists, library, follows | Listed |
| Profile and payments | Listed |

Two things worth knowing before you spend the wait:

- **Anything under thirty seconds is a skip, not a play.** Spotify's own
  threshold. Counting skips is what makes these exports look like you listened
  to four thousand things in a week, so both numbers are shown.
- **Your IP address is on every row of the extended history**, along with the
  country and the device. Nobody expects that in a music export.

## X (Twitter)

Every data file is JSON with a line of JavaScript stuck to the front, so that
the bundled `index.html` can load them as scripts. The variable name has
changed between archives - `tweets`, `tweet`, and a `tweet-part1.js` once it
is large - which is why the reader cuts at the first bracket instead of
matching a prefix. A reader that matches the exact name works on the archive
its author had and fails on everybody else's.

**Not measured.** Written from the documented archive format and exercised
against a fixture built to it. No real X archive has been opened.

| Area | What Muletto does |
|---|---|
| Posts | **Read**. On the timeline, with likes and reposts |
| Direct messages | **Read**. As conversations |
| Media | **Read**. The pictures and video in `data/tweets_media/` |
| Likes, followers, following, blocks | Listed |

The gap is X's, not ours: **a conversation is titled with a number.** The
archive records account ids and never the other person's handle, anywhere. So
"Conversation with 222222" is not a failure to look something up, it is
everything the export contains.

## Discord

Every conversation is a folder named after its channel id, and the readable
names live in one file, `messages/index.json`. Without reading that first the
whole export is folders called `c1122334455`, which is how these get written
off as empty when they are not.

Discord has also changed format: older packages ship `messages.csv`, newer
ones `messages.json`. Both are read, because somebody holding either is
holding a real export.

**Not measured.** Written from Discord's documented package and exercised
against a fixture built to it. No real package has been opened.

| Area | What Muletto does |
|---|---|
| Messages | **Read**. As conversations, named from the index |
| Account and relationships | Listed |
| Servers | Listed |
| Activity analytics | Listed |

The thing to know before requesting one: **a Discord package contains only
what you sent.** The replies are not in it. A conversation here is one side of
one, and reading it without knowing that is baffling.

Attachments are not in it either - messages link to pictures by address, and
those files stay on Discord's servers.

## Strava

`activities.csv` is the index and the GPS files are the data. Strava sends
each activity in whatever format it was recorded in, so a real export is a
mixture of `.gpx`, `.gpx.gz` and Garmin `.fit.gz`.

**Not measured.** Written from Strava's documented export and exercised
against a fixture built to it. No real Strava export has been opened.

| Area | What Muletto does |
|---|---|
| activities.csv | **Read**. Every activity on the timeline |
| Plain `.gpx` tracks | **Read**. The start of each one goes on the map |
| Gzipped and `.fit` tracks | Listed. Kept whole, not read yet |
| Posts, comments, clubs, gear, profile | Listed |

One trap in Strava's own file: **the distance column mixes metres and
kilometres**, under the same heading, in the same file. Muletto says so when
it sees both rather than adding them up.

## TikTok

One enormous JSON file, and almost every key in it has been renamed at least
once. The root went from `Activity` to `Your Activity`; `Video Browsing
History` became `Watch History`; `Search History` became `Searches`; `Follower
List` became `Follower`; likes sometimes sit under a third root of their own.
Casing is inconsistent inside a single file - `Link` beside `link`, `Date`
beside `date` - and a feature not offered in your region is simply absent
rather than empty.

So nothing here looks for a path. Sections are found by matching normalised
names anywhere in the tree, which survives the next rename.

**Not measured.** Written from what TikTok's exports are documented and
reported to contain, and exercised against three fixtures: one using the old
names throughout, one using the new ones, and one TXT export.

| Area | What Muletto does |
|---|---|
| Watch history | **Read**. On the timeline |
| Likes and favourites | **Read**. On the timeline |
| Searches | **Read**. On the timeline |
| Videos you posted | **Read**, when the export has them |
| Direct messages | **Read**. As conversations |
| Everything else | Listed |

Three things to know before you spend the wait:

- **There is no media in it at all.** Not the videos, not your profile
  picture, not a single message attachment. Every one is a web address
  pointing back at TikTok. Muletto will not fetch them, because it makes no
  network requests whatsoever - so what you get is the record of the account
  rather than its contents. If you want the videos, save them from the app.
- **Choose JSON, not TXT.** The choice is made when you request it, the two
  are not the same data, and the TXT shape is documented nowhere. Muletto
  recognises a TXT export and says so rather than reading it as empty.
- **Ask for everything, not for one category.** Requesting only "Activity" is
  reported to drop the watch history, which is usually the part people wanted.

Dates are the other trap, and it is TikTok's: five formats appear in one file
- space-separated, ISO with a T, ISO with a Z, epoch seconds and epoch
milliseconds - and none of them carries a timezone offset. All five are read.
Whether they are UTC or local is undocumented, so nothing is shifted to
correct for it: a date out by your own offset is still the right day, and
guessing would be worse than the error it fixed. A row whose date is in none
of the five stays in its table and off the timeline, and is counted.

## Anything else

An export from a service with no reader still opens. Files are listed, tables
are shown as written, and any comments-shaped table gets the Comments view.
The app says on screen that it has no reader for this one, and offers a
pre-filled issue.

If you have an export from something not on this list, that issue is the most
useful thing you can send. It needs folder names, file types and column
headers, and **no values at all**.
