# What Muletto reads, service by service

What each service sends, what Muletto currently does with it, and what it does
not. Written so you can tell before you spend an afternoon requesting an export
whether it will be worth opening.

Two rules for this file. Anything marked **measured** was counted in a real
export on a real machine. Anything else is from the service's own
documentation, and says so. Where Muletto reads something badly, that is
written down here rather than left to be discovered.

## How to read the table

| Mark | Meaning |
|---|---|
| **View** | A screen built for this kind of data |
| **Read** | Parsed into the library - searchable, in the timeline, exportable |
| **Listed** | Shown as a table or a file, as the service wrote it |
| **-** | Not handled |

A "Listed" is not a failure. A table of settings is a table of settings, and
dressing it up would be worse. It is marked as a gap only where the data
deserves better.

---

## Google (Takeout)

Google exports **more than seventy products** - Access Log Activity through
YouTube Music. The full list is on
[Wikipedia](https://en.wikipedia.org/wiki/Google_Takeout), and it grows.

**Measured, in a real 38 GB Takeout of 6,524 entries:**

| Area | Entries | What Muletto does |
|---|---|---|
| Google Photos | 5,041 | **Read** - photos, videos, and the sidecar JSON that carries the date and place |
| Drive | 845 | Listed |
| Google Play Games Services | 273 | Listed |
| YouTube and YouTube Music | 192 | **View** - comments, with replies threaded. Playlists, subscriptions and video metadata are **Read** |
| My Activity | 31 | **View** - Search and watch history, parsed from Google HTML |
| Keep | 14 | Listed |
| Maps | 10 | **Read** - places |
| Chrome, Contacts, Calendar, Play Store, Pay, and 30 more areas | ~60 | Listed |
| Mail (mbox) | 1 file | **View** - Mail. Headers only, streamed, so a 776 MB mbox becomes searchable without holding a message |

**What works well.** Photos is the strongest path in the product: the sidecar
JSON gives back the date and the location that the file itself lost, and that
is the whole reason to open a Takeout.

**`.tgz` works.** Google offers tgz next to zip on the same screen and it used
to be refused outright. It is unpacked in one streaming pass, each member into
its own blob - gzip is not seekable, so unlike a zip it cannot be read lazily.
A `.zip` is still the better choice for a very large Takeout, because it is
read without unpacking anything.

**Known gaps, in the order they hurt:**

- **Mail is headers only.** Who, what and when - no bodies, no attachments, no
  thread view.
- **The YouTube history file is skipped above 20 MB.** In a real Takeout it is
  48 MB on its own; the other ten products read fine.
- Chrome history and Keep are listed rather than read. Contacts (`.vcf`) and
  Calendar (`.ics`) now have views, and Google ships both.

---

## Apple

Apple's Data & Privacy export covers account and sign-in records, iCloud
contents, app and purchase history, and marketing and support history. Photos
and Drive files come through a **separate** iCloud download, which catches
people out - see [Apple's own
page](https://support.apple.com/en-us/HT208502).

**Measured, in a real export of 18 archives and 1,020 entries - which becomes
1,414 once the archives inside archives are opened:**

| Area | Entries | What Muletto does |
|---|---|---|
| iCloud Notes | 860 | **View** - Notes, with the first line as the title |
| iCloud Contacts | 112 | **View** - Contacts, one card each |
| Apple Media Services | 67 after nesting | **Read** - purchase and store history |
| Apple Account and device information | 14 | **Read** |
| Apple Features Using iCloud | 323 after nesting | **View** - Audio. The 319 Siri recordings play here, from the archive |
| Calendars and Reminders | 5 | **View** - Calendar, events and reminders together |
| Wallet, AppleCare, Bookmarks | ~10 | **Read** |

**What works well.** Nested archives. Seven of the eighteen archives contain
more archives, and 394 entries were invisible until that was handled.

**Known gaps:**

- `.pages` and `.numbers` are zip containers we deliberately do not open.

---

## Samsung

Samsung's privacy portal sends one archive per service, and **every entry in
every archive is encrypted** - WinZip AES-256, with the password sent
separately. Muletto handles that, including the legacy ZipCrypto that one
service still uses.

**Measured, in a real export of 9 archives and 57 entries, all encrypted:**

| Area | What Muletto does |
|---|---|
| Samsung Health - Heart Rate, Weight, Goal, Food Goal, Device Profile, User Profile | **View** - Health, with a panel per kind found and a list of the kinds that are absent |
| Samsung Account, Galaxy Store, Samsung Cloud, SmartThings Find, PENUP | **Read** as tables |
| S-Note3 | **Read** - `.spd` is a zip, so the 21 notes open and the **21 pictures inside them** come out. The handwriting itself is a proprietary binary and stays unread |
| S-Browser Tabs, Subscription Hub | **Read** |
| `.xlsx` (Samsung Account, ANS tickets) | **Read** as tables - shared strings resolved, absent cells placed by reference |

**What works well.** The Health view, and the catalogue of seventeen health
kinds behind it - so an export that contains two of them says which fifteen are
missing and what each would need.

**Known gaps:** the S Note page format itself. It is proprietary, so the words
and strokes of a handwritten note stay unread - the pictures in them do not.

---

## Instagram and Facebook (Meta)

Meta lets you choose categories, so two exports of the same account can look
nothing alike. JSON and HTML are both offered; **choose JSON** - it is the one
Muletto reads, and the HTML is the same data with the structure thrown away.

**Measured, in a real partial Instagram export of 42 entries:**

| Area | What Muletto does |
|---|---|
| `messages/inbox/` | **Read** - conversations, grouped by person |
| `personal_information/`, `login_and_profile_creation/` | **Read** as tables |
| `followers_and_following/`, `past_instagram_insights/`, `shopping/`, `monetization/` | Listed |

Facebook is the same parser. **It has never been run on a real Facebook
export** - that is the single biggest untested claim in this file.

**Known gaps:**

- **No dedicated view for anything.** Meta ships posts, reels, stories,
  comments, likes, saved items and ad interests, and every one of them lands in
  a table.
- **The mojibake claim is unverified.** Meta writes UTF-8 escaped byte by byte,
  so Norwegian text arrives mangled. Muletto has a repair for it that has never
  been run against a real Norwegian export.

---

## Snapchat

**Not measured. No real export has been opened.** From Snapchat's format and
from third-party tooling: `memories_history.json` carries the capture time and
GPS for each memory, `chat_history.json` carries saved messages only, and the
media themselves are largely **download links rather than files**.

| Area | What Muletto does |
|---|---|
| Chat history | **Read** - conversations |
| Memories metadata | **Read** - events and places |
| Split captions | **Merged** - see below |

**Split captions.** A memory with a caption, sticker or drawing on it is
exported as two files, not one: `<id>-main.jpg` and `<id>-overlay.png`, the
second being the caption alone on a transparent background. Import the folder
anywhere else and every overlay arrives as white writing on a black square,
sitting beside the memory it belonged to. Muletto pairs them by the name they
share and draws the caption back on, so the picture you see and the picture you
save are the one you wrote.

A video cannot be merged - burning a caption into an mp4 means re-encoding it -
so those keep the overlay and it is written beside the memory as
`-caption.png`. An overlay whose memory is not in the export is left alone and
named in a note, because it is a real file and quietly dropping it would be
worse.

**Verified on the sample export only.** The pairing, the merge and the export
have been run and measured; no real Snapchat export has been opened, so the
naming is from Snapchat's documented convention rather than from a file that
came out of Snapchat.

**Known gaps:** the media are links, and a link is not your data. Worth saying
loudly in the guide, because a Snapchat export is far emptier than people
expect.

---

## Reddit

**Not measured against a real export.** Written from the format and tested
against a sample built to match it. A Reddit export is a flat bag of CSVs with
no folder, no manifest and no index page - the plainest thing any of these
services ships.

| Area | What Muletto does |
|---|---|
| Posts and comments | **Read** - timeline entries, labelled with the subreddit |
| Private messages | **Read** - conversations, grouped by the other person |
| Votes, saved, hidden | **Read** - as tables |
| Subscribed subreddits | **Read** |
| Everything else | Listed and shown as written |

**Columns are matched by pattern, never by position.** Reddit has changed these
before and will again, and a reader that assumes column four is the subreddit
becomes silent nonsense the day a column is inserted.

**Worth knowing:** Reddit puts the internet address you were connected from on
every post and every comment. Muletto says so on opening rather than filing it
as a column in a table nobody scrolls to.

**On borrowing.** There is a good open-source viewer for these exports -
`guilamu/reddit-gdpr-export-viewer` - and it is AGPL-3.0, which this
licence cannot take. None of its code is here. The shape of a CSV is a fact and
not its author's to license, so the format is all that is shared, and saying so
seems the least we owe them.

---

## Anything else

An export from a service with no reader still opens. Files are listed, tables
are shown as written, and any comments-shaped table gets the Comments view.

The app says so on screen rather than pretending, and offers to open a
pre-filled issue. If you have an export from something not on this list, that
issue is the single most useful thing you can send - it needs folder names,
file types and column headers, and **no values at all**.
