# Test plan

What has to work, how each thing gets proved, and where each one currently
stands. A working document: when a state changes, it changes here in the same
commit as the code.

Most rows are unstarted. What has been tested has been tested properly; the
limit is how many different people's exports one person can get hold of.

## The three states

A ladder. Each rung is worth less than the one above it, and only the top one
means "this works".

| Mark | State | What it means |
|---|---|---|
| `S` | **Synthetic** | Exercised against data this repo generated (`tools/make-sample-data.py`, or a hand-written fixture). Proves the code runs and does not crash. Proves nothing about whether a real export looks like that. |
| `R` | **Rebuilt** | Exercised against an archive rebuilt from a real person's structure report by `tools/rebuild-from-report.js`. Same folders, same file names, same columns, same row counts, invented values. Proves we read *their shape* - the one thing synthetic data cannot tell us. |
| `V` | **Verified** | Opened from a real export, on real data, and the result checked against what that person says is true. |
| `-` | Not started | |
| `X` | Known broken | With a note saying how. |

`R` is the rung with the most to give and the least on it, for the simple
reason that it needs somebody else's export to exist at all. It is why the
structure report and the rebuild tool were written: anyone can produce an `R`
without sending a single value.

A row can be `V` for one person and still be wrong for everyone else - a phone
user's Samsung Health has seven folders and a watch user's may have thirty.
Where that is the case the row says whose export proved it.

## How to run each state

```bash
# S - synthetic
python tools/make-sample-data.py            # writes apps/web/samples/
node tools/check.js                         # ASCII, syntax, staleness, links

# R - rebuilt from somebody's report
node tools/rebuild-from-report.js report.json rebuilt/
#   then open rebuilt/<name>/ with the folder picker, or zip it first to
#   exercise the archive path as well

# V - real data
#   open the real export, then compare against what the owner says is there
```

`tools/check-export.js` runs a real export through the shipped reader and
parser and prints what came out, but nothing asserts on the numbers yet. See
**Harness gaps** at the end.

---

## 1. Reading an archive

The layer everything else sits on. A failure here loses a whole export.

| What | State | Notes |
|---|---|---|
| Zip central directory, deflate | `V` | Every export opened so far |
| Zip64 (over 4 GB) | `V` | **Confirmed against the real Google Takeout.** `takeout-1-001.zip` is 12.67 GB with 5041 entries, 2362 of them past the 4 GB offset mark, and the directory reads in 21 ms. `takeout-4-001.zip` is 22.89 GB. Reading only - see the rows below for what happens when those entries are written back out |
| Over 65535 entries in one archive | `S` | Still unseen. The largest real archive here has 5041 |
| An entry larger than 2 GB | `V` | That Takeout holds a 5.31 GB `.avi` and three `.mp4` over 4 GB. They could not be exported: `extract` returns one contiguous `Uint8Array` and that throws above 2 GB, so the largest file in the library was counted as "could not be written". Anything over 64 MB is now piped from source to destination and never exists in one piece |
| Both ways of holding a large file, measured | `V` | They fail in the same place, which is why routing through a Blob fixed nothing. Contiguous `Uint8Array`: 1.5 GB OK, 2 GB `RangeError`. Single Blob: 1500 MB OK, 2048 MB `TypeError: Failed to fetch`. Reported storage quota was 5.5 GB, so the Blob ceiling is per blob rather than the quota |
| Writing an entry too big to hold | `V` | 3 GB through the real zip writer in 12.5 s with every byte accounted for, peak heap 546 MB. A 60 MB round trip reads back with the right size, the right marker bytes at the chunk edges, and a deflated entry intact |
| Thumbnail for a video over 1 GB | `V` | Skipped deliberately. A poster frame has to hand the file to a `<video>` element, so it needs a Blob and inherits the 2 GB ceiling; without the guard the tile spent a minute inflating before failing and showing nothing anyway |
| Stored (uncompressed) entries | `V` | |
| Data descriptors (general purpose bit 3) | `V` | Samsung sets it on two archives |
| WinZip AES-256 (method 99) | `V` | All nine Samsung archives, 57 entries |
| WinZip AES-128 and AES-192 | `S` | Keystream checked against a known-good implementation to 70,000 blocks; no real archive has used them |
| AES authentication code check | `V` | HMAC-SHA1 over the ciphertext of every entry. `tools/check-aes.js` verifies all 50 encrypted entries of the real Samsung export, and checks the two failures separately: a flipped ciphertext bit is reported as damage, a wrong password still as a wrong password. Costs about 1 percent of decryption |
| ZipCrypto (legacy) | `V` | Samsung `galaxyapps` |
| Wrong password, and retry | `V` | |
| Cancelling the password prompt | `V` | |
| Streamed head reads inside an encrypted entry | `V` | Was silently broken; fixed and re-checked |
| `.tgz` / `.tar.gz` Takeout | `V` | **Supported.** Confirmed in the browser against a tar built to spec and gzipped by the browser: 4 members including a 3 MB binary, every entry the right size, and a 3,145,728-byte member read back with **every marker byte correct**. Provider detection, table parsing and the Comments view all work through it |
| Reading only the head of a tar member | `V` | A tar member is stored, so its head is a slice. Without that the blob stream returns the whole file in one chunk and "read 96 KB for the EXIF date" silently becomes "read the entire photograph", once per photograph. Confirmed: `readHead(entry, 16)` returns exactly 16 bytes |
| A `.tgz` larger than blob storage | `S` | Each member becomes its own blob rather than one blob of the whole archive, so the ceiling is total quota (5.5 GB measured here) not per-file. Above it the reader stops and says to ask for the `.zip` instead. That path has not been walked |
| GNU long names in tar | `S` | Paths over 100 characters arrive as a type `L` member carrying the name for the next one. Implemented, never seen in a real export |
| Contacts view (`.vcf`) | `V` | vCard 3.0 read in the browser: FN, the `N` fallback with a prefix ("Dr. Ola Nordmann"), folded continuation lines, and an escaped comma coming back as "Storgata 1, 3B". **Now also run over the real Apple cards** by `tools/check-views.js`, reaching them inside the nested archives: 111 files, 111 cards parsed, **every one with a name**, 46% with an organisation, 9 with a note. No card came back blank, which is the failure that would show as an empty row. The real Google export passes too, and is the harder case - 4 files holding **260 cards between them**, so the multi-card-per-file path is exercised rather than assumed, and all 260 have a name |
| Calendar view (`.ics`) | `V` | Confirmed in the browser: a timed event, an all-day event with `VALUE=DATE`, an `RRULE` marked as repeating, and a `VTODO` shown as a reminder. UTC converted to local correctly (09:00Z drawn as 10:00 CET). **Now also run over the real Apple `.ics`**: 63 entries, all 63 with a summary, 56 with a usable date, 12 all-day, 3 repeating. **7 parsed with no date at all** and cannot be placed on a timeline - almost certainly `VTODO` reminders with no `DUE`, which is legitimate, but it has not been confirmed and the number is here so nobody assumes it is nothing |
| Notes view | `V` | Five notes read in the browser, first line used as the title, 50 words counted. **Now run over the real Apple notes**: 809 `.txt` files, all 809 matched by `NOTE_FILE`, 807 with content, 2 empty and correctly dropped, none needing the filename fallback, 35,197 words in total. The negative case is proved on the real Google export in the same pass - 238 `.txt` files there and **none** matched, which is right: 232 are `Takeout/Drive` documents and a text file in Drive is a document, not a note. The pattern is the whole of this view and it behaves on both sides |
| Audio view | `S` | Two recordings listed with sizes; pressing Play builds a `blob:` URL from the archive and swaps in an `<audio>` element. Confirmed the src is a blob and never `http`, so nothing is fetched. **Proved on the real export from both ends.** All 319 Siri recordings were reached inside the 1.34 GB nested archive and every one carries a valid MPEG-4 `ftyp` header, none malformed. Playback confirmed by the maintainer against the real recordings around late July 2026 - heard playing, from the archive, in the browser. That is a person listening rather than a count, so it proves the path works and not that all 319 individually do; the header check is what covers the rest |
| A topic that has to read the archive | `S` | Contacts, Calendar, Notes and Audio decompress before they can draw, so the panel says it is reading first. Blobs are made only when Play is pressed - rendering 319 audio players would decode the lot |
| **`ACTIVITY_FILE` matches the real pages** | `V` | The real Takeout holds **11** My Activity pages and the pattern matches every one. The file is called `My Activity.html` **with a space**, which the optional space in the pattern covers. Worth recording because a harness written against `MyActivity.html` matched none of them and read as a parser failure |
| **My Activity, the real pages through the real parser** | `V` | All 11 pages of the real Takeout parsed in the browser by `tools/pull-activity.js` plus its harness: **49,782 rows**, 99.6% with a usable date, 97.5% keeping their verb, 99.3% with a link, and not one file threw. The English-only date patterns were a worry on a Norwegian account and turned out to be unfounded - Google writes the dates in English regardless |
| **What the 20 MB cap was costing** | `V` | 46.1 MB of YouTube history parses in **953 ms** for **16 MB of heap**, against a 4,096 MB limit, giving 48,400 rows. The cap was buying under a second and sixteen megabytes at the price of 97% of the reader's activity history. Raised to 128 MB |
| Search and watch history (My Activity HTML) | `S` | Google keeps it as Material Design Lite markup, one file per product - eleven in a real Takeout. Parsed with `DOMParser`, not regular expressions, because the values are somebody search terms and the document must stay inert. Confirmed: verbs kept, links kept, product tagged, `5 Jul 2026, 14:03:11` parsed |
| The 48 MB YouTube history file | `S` | Skipped above 20 MB and the view says how many products it skipped. Not walked on the real file |
| Mail view (`.mbox`) | `V` | **Run on the real 777 MB mailbox** by `tools/check-views.js`, streamed out of the zip exactly as the app does it. 11,081 messages indexed in 6.7 s, every body dropped as asked. A date parsed on 100%, a sender on 100%, a subject on 99.9%, and `summarise` gave 434 senders and 11,081 timeline events. Peak heap 250 MB on one run and 474 MB on another against a 777 MB file - it varies with when the collector runs, so treat it as an order of magnitude rather than a figure, but the file is plainly never held. That is the claim the streaming design exists to make |
| Logins and devices | `S` | Recognised by column shape, because five providers describe the same thing five ways. Confirmed: 3 records collapsing to 2 distinct sign-ins, device, city, IP and time |
| `.xlsx` spreadsheets | `V` | **Both spreadsheets in the real Samsung export, by `tools/check-xlsx.js`.** A zip of XML inside an AES-encrypted zip, so the nested open, the decrypt and the parse are proved together. Shared strings resolved (a sheet read without the pool is a page of integers), `&amp;` decoded, and an **absent cell placed by its `r=` reference** rather than shifting the row |
| Several tables stacked in one `.xlsx` sheet | `V` | Samsung Account is five, each under a two-cell title row. Split on the shape; the row counts reconcile exactly against the flat reading. An ordinary irregular spreadsheet was checked as a negative and correctly stayed one table |
| `.spd` S Note containers | `V` | **Confirmed against the real Samsung export.** `.spd` is a zip - magic bytes 50 4b 03 04 - so the 21 notes open and **21 pictures inside them** are recovered. 36 entries become 184. The page format is proprietary and stays unread, which the file list shows |
| Nested archives (a zip inside a zip) | `V` | Seven of the eighteen Apple archives hold zips. Run over that export, expansion opens **all ten** and takes the listing from **1020 entries to 1414** - the full 394 that were unreachable, including the 319 `.m4a` Siri recordings. Nothing is skipped. A nested CSV was read end to end through its blob |
| A nested archive over a gigabyte | `V` | `Apple Features Using iCloud.zip` is **1.34 GB** and now opens. It is streamed into a Blob rather than inflated into an array, so the browser pages it to disk: measured in Brave, **1.5 GB costs 12 MB of JS heap**, and slices out of it still read. The old 512 MB refusal was guarding the wrong thing |
| A nested archive over 1500 MB | `X` | Unlike an exported file, a nested archive cannot stay a stream - reading its directory means slicing at arbitrary offsets, so it has to be a Blob, and a single Blob fails at 2048 MB. Capped at the 1500 MB that was measured to work. Apple's 1.34 GB clears it; a larger one would not, and is reported as too big rather than as damaged |
| Nested archive that is deflated, not stored | `V` | The real Apple shape is method 8. Confirmed in the browser with a hand-built deflated nested zip holding a 40 MB payload: expands, progress fires, heap does not grow (115 MB -> 110 MB), and both a nested CSV and the head of the nested 40 MB file read back |
| A nested archive still refused | `V` | Three reasons remain and each is confirmed in the browser: an **encrypted** nested archive over 256 MB (decryption needs a contiguous buffer and cannot stream), the **archive-count budget**, and **unreadable or damaged**. Each becomes a note on the library naming the file, its size and what to do |
| A nested archive left unopened, unpacked by hand | `X` | The note tells the user to unzip that one file and drop it in on its own. That instruction has not been walked. Now a rare path rather than the common one |
| Unpacking progress on a slow archive | `S` | The curtain names the archive being unpacked and its size. Confirmed only that the callback fires with the right name; the wording has not been seen on screen during a real import |
| `.pages`, `.numbers`, `.spd` containers | `X` | Zip containers too, but of XML rather than user files, so expansion would list parts rather than documents. Deliberately not expanded |
| Folder picked with `showDirectoryPicker` | `V` | Chromium only, and run in Brave. Firefox and Safari do not have it at all, which is what forces the untested fallback |
| Works with the server stopped | `V` | Registered, 38 files cached, then the dev server was killed and the page reloaded: HTML, all eight modules, styles, fonts and the full sample library all came back |
| Offline on Safari and Firefox | `-` | Service workers behave differently on both, and neither has ever run this |
| Folder as a streamed-archive fallback | `S` | **The path every Safari and Firefox visitor takes.** Never run on either browser |
| Multi-part archives that split a pair across parts | `-` | Google can put a photo in part 1 and its sidecar in part 4 |
| **Are the parts separate archives or one spanned set?** | `V` | Settled against the real Apple export, because the answer changes the advice completely: **18 archives, every one with its own working central directory, opening independently, 1,020 entries between them, and no `.z01`-style spanned parts at all.** So they are separate complete zips and the usual advice to merge them first is wrong for this case - it is right only for a genuine spanned archive, and it costs tens of gigabytes of scratch space to follow needlessly |

## 2. Cross-cutting behaviour

| What | State | Notes |
|---|---|---|
| Merging several exports into one library | `V` | Samsung 9 + Apple 8 |
| Same archive opened twice (`name (1).zip`) | `S` | Key now strips the copy suffix; not re-checked against the real pair |
| Multi-part grouped as one export | `S` | `Part 1 of 5` rule added, not yet re-run on the real Apple set |
| Older download superseded by a newer one | `V` | |
| Content dedup across parts | `V` | Meta repeats JSON across parts |
| Near-duplicate photo detection (dHash) | `V` | Gated on luminance after solid black and solid white collided |
| Writing the library back out to folders | `V` | Brave. A large entry is piped straight to the file handle, which is itself a `WritableStream` |
| Writing out as a single archive | `S` | |
| Dates written back into JPEG EXIF | `V` | |
| Dates written back into HEIC | `X` | Not supported; stated in the app |
| IndexedDB restore across a refresh | `V` | |
| `PARSE_VERSION` forcing a re-read | `S` | Bumped twice; the re-read path itself has not been watched on a real library |
| Library over 100,000 items | `-` | Tile recycling is untested past about 400 photographs |
| Memory held across view changes | `V` | Measured 60 object URLs held, 0 after leaving |

## 3. Samsung

The best-understood service, because a real export was opened and inspected
entry by entry. Nine archives, 57 entries, one password.

### 3a. Services

Prefix as it appears in the archive name. `V` here means an archive of that
kind was opened.

| Service | Prefix | State | Notes |
|---|---|---|---|
| Samsung Health | `samsungcloud` | `V` | Phone-only account: 7 folders |
| Samsung Cloud sync | `samsungcloud` | `V` | S Note, Pinall, browser tabs |
| Samsung Account | `SamsungAccount` | `V` | Five tables stacked in one `.xlsx` sheet: basic information, login IDs, terms accepted, registered devices, consent history. 56 rows |
| Galaxy Store | `galaxyapps` | `V` | Six sectioned tables |
| PENUP | `PENUP` | `V` | |
| SmartThings Find | `SmartThingsFind` | `V` | |
| Subscription Hub | `Subscription Hub Server` | `V` | 1 byte - empty is a valid answer |
| Support tickets | `ANS` | `V` | One `.xlsx`, 18 columns, one ticket |
| NCDM | `NCDM` | `V` | Header row only. Samsung does not document what it is |
| Samsung Members | unknown | `-` | Selected in the picker, no archive arrived |
| ConnecTime | unknown | `-` | Same |
| Samsung Internet (bookmarks, history) | unknown | `-` | Only open tabs seen, via Cloud sync |
| Samsung Notes (modern) | unknown | `-` | |
| Samsung Pass | unknown | `-` | |
| Samsung Wallet / Pay | unknown | `-` | |
| Bixby | unknown | `-` | |
| SmartThings (devices) | unknown | `-` | Reported as a separate in-app download |
| Samsung TV Plus | unknown | `-` | |
| Samsung Rewards | unknown | `-` | |
| Samsung Kids | unknown | `-` | |
| Game Launcher | unknown | `-` | |

**A service that holds nothing produces no archive at all.** Not an empty one -
none. That is why the coverage panel exists, and it is the thing most worth
explaining to a tester.

### 3b. Samsung Health data types

Two completely different export routes. Both need testing and only one is
covered.

**Route A - privacy.samsung.com** (what our guide tells people to request).
Plain-English folder per type, each holding one CSV of the same name.

| Type | Folder | State | Needs |
|---|---|---|---|
| Heart rate | `Heart Rate/` | `V` | 14 readings, 2016, phone sensor |
| Weight | `Weight/` | `V` | 2 readings |
| Goals | `Goal/`, `Food Goal/` | `V` | |
| User profile | `User Profile/` | `V` | |
| Device profile | `Device Profile/` | `V` | |
| Recommendations | `Recommendation/` | `V` | |
| Steps | unknown | `-` | **The most common data type of all and we have never seen one** |
| Sleep, sleep stages | unknown | `-` | Watch or ring |
| Workouts | unknown | `-` | |
| Stress | unknown | `-` | Watch or ring |
| Blood oxygen | unknown | `-` | Watch |
| Heart rate variability | unknown | `-` | Watch or ring |
| ECG | unknown | `-` | Watch 4+ |
| Blood pressure | unknown | `-` | |
| Skin temperature | unknown | `-` | Watch 5+ or Ring |
| Breathing rate | unknown | `-` | |
| Floors climbed | unknown | `-` | |
| Food and nutrition | unknown | `-` | |
| Water and caffeine | unknown | `-` | |
| Badges and records | unknown | `-` | |
| Challenges and friends | unknown | `-` | |

**Route B - the Samsung Health app's own download.** Settings > Download
personal data. Writes `com.samsung.shealth.*.csv` to the Downloads folder.
This is the export every parser on the internet is written for, and **we have
never opened one**.

| Trait | State | Notes |
|---|---|---|
| `com.samsung.health.<type>.<digits>.csv` naming | `S` | Prefix strip exists, never fired on real data |
| `com.samsung.shealth.<type>.<digits>.csv` naming | `S` | |
| Metadata line above the header | `V` | Handled; seen in Route A |
| Namespaced column headers (`com.samsung.health.heart_rate.start_time`) | `-` | |
| `jsons/` blobs that are gzip despite the `.json` name | `-` | |
| `files/` with ECG waveforms and a profile picture | `-` | |
| Timestamp width varying between 12 and 14 digits | `-` | |

The SDK name and the export name differ in ways nobody can predict:
`com.samsung.health.step_count` exports as
`com.samsung.shealth.tracker.pedometer_step_count`. Do not derive one from the
other.

### 3c. Samsung file formats

| Format | State | Notes |
|---|---|---|
| Sectioned CSV (title, header, rows, blank line, repeat) | `V` | Two bugs found and fixed |
| Section starting mid-file with no blank line | `V` | SmartThings Find |
| JSON stuffed into a CSV cell | `V` | S Note |
| `.spd` S Note documents | `X` | Zip containers holding a cover image and page data. 21 of them sitting unread |
| Extensionless files that are images | `V` | Six Pinall PNGs, found by first bytes |
| `.xlsx` | `V` | Two files, both read. The account dump is five tables in one sheet and was being read as one, which put a table code in the column slot and lost the other four |
| `File_Description*.pdf` | `-` | Samsung's own field documentation. Should be labelled as such, not listed as user data |

## 4. Apple

Eight archives opened. Apple publishes almost no exact filenames, so much of
this is reconstructed from parser source and first-hand reports rather than
from Apple. Rows marked "reported" have a source but no sample here.

### 4a. Categories

| Category | State | Notes |
|---|---|---|
| Apple ID account, device, sign-in | `V` | |
| Sign in with Apple, Hide My Email, Passkeys | `V` | |
| Data and Privacy request history | `V` | |
| AppleCare cases and surveys | `V` | Five near-identical survey tables, probably one per case. May be PDF-only for some accounts |
| Game Center | `X` | Arrays of objects per cell. Summarised now, not really read |
| iTunes / App Store purchase history | `V` | `Store Transaction History` arrives as several numbered files, not "Part N of M" |
| Apple Media Services | `V` | |
| Marketing communications | `V` | |
| Wallet activity, Apple Pay cards | `V` | Category name confirmed; no filename documented anywhere |
| Bookmarks | `V` | Netscape HTML format, `ADD_DATE` in epoch seconds |
| Calendar preferences and metadata | `V` | |
| Notes details, shared notes | `V` | Participants arrive as a semi-structured blob |
| Devices, paired devices, activation lock | `V` | |
| Location information | `V` | |
| Apple Music play activity | `-` | See traps below. The largest CSV in an Apple export |
| Apple Music library and playlists | `-` | Bare top-level JSON array, often on one line |
| Apple TV, Podcasts, Books | `-` | |
| iCloud Drive files | `-` | Reported as ~20 outer zips each holding ~15 nested zips |
| iCloud Photos | `-` | **The most important untested Apple category.** `Photo Details*.csv` sidecar |
| iCloud Mail | `-` | **`.eml`, one file per message - not mbox.** Commonly got wrong |
| iCloud Contacts (`.vcf`) | `-` | Base64 photos make very long folded lines |
| iCloud Calendars and Reminders (`.ics`) | `-` | VTODO and VEVENT in the same stream |
| iCloud Notes | `-` | Text plus sketch files; attachment linking undocumented |
| **Health `export.xml`** | `V` | **Read, and confirmed against a real one.** 6.8 MB zip, 161 MB of XML, **385,299 readings over four years, about a second, ~10 MB of heap** - streamed and aggregated to a day as it passes, never held. Three faults found by running it and not by reading it: records straddling a chunk boundary were counted twice, which never threw and merely inflated each day's total until the same file read in Node and in the browser disagreed; a missing field made a successful parse report itself unreadable; and the same field would have made any Takeout containing Fit data fail outright. Sleep is named for what was measured - a watch gives Sleep, a phone alone gives Time in bed |
| Apple Card / Apple Financing | `-` | **A separate request entirely.** PDF statements. Issuer changed in January 2026, so do not hard-code one |
| Maps, Siri, Screen Time, Find My, Shortcuts, HomeKit | `-` | No confirmed filenames. Some may not be categories at all |
| Messages / iMessage | `-` | No credible evidence it is offered. Confirm before building |

### 4b. Apple traps worth a test each

These come from real exported files in public repositories, so they are
observed rather than guessed.

| Trap | State | Notes |
|---|---|---|
| Split naming `<Category> Part N of M.zip` | `S` | Matches the rule now in `exportKey`. `M` is only knowable by reading a filename, so never assume all parts are present |
| Nested zip, three deep | `X` | Outer zip, then `Apple_Media_Services.zip`, then `Apple Music Library Tracks.json.zip`, then the JSON. We recurse zero levels |
| iCloud Drive as a zip of zips | `X` | Same problem, at ~300 archives |
| `Photo Details.csv` date format | `-` | `Sunday August 13,2023 4:01 PM GMT` - weekday name, **no space after the comma**, 12-hour, literal `GMT`. At least three variants exist |
| `Photo Details.csv` encodings | `-` | utf-8 with BOM, GBK and **UTF-16** all seen. We assume UTF-8 |
| Duplicate `imgName` with conflicting dates | `-` | Must be detected, not silently first-wins |
| `_Original` and `-N` filename suffixes not matching the CSV row | `-` | |
| Extracted files whose mtime is the export date, with no EXIF | `V` | Both halves are in the same real Takeout, which is what made it decidable. `Takeout/Drive` stamps 846 entries across 64 distinct days from 2016 to 2026 - those are the files. Google Photos stamps all 5,041 with one single day in 2026 - that is the afternoon the export was packed. So the archive is asked before any entry is believed: eight distinct days minimum, and no one day holding over half. Drive went from 1 of 343 media dated to 343 of 343; Photos correctly refused, staying at 2,514 of 2,524 |
| Date read out of the filename | `V` | Snapchat strips the metadata and then names the file for the day: 606 of 606 media files in the real export, being 480 memories and their 126 overlays. The library dated 45 percent before this and all of it after. Runs last, so EXIF and the sidecar always win |
| Filename dates, the guards | `V` | 19 cases in the browser, 11 of them refusals: 31 February, 1970, 1980, a year in the future, month 13, a date not anchored at the start, and bare ids. No real export contains a file called `2024-02-31`, which is why these have to be asked rather than measured |
| Compact camera filenames (`IMG_20241031_142530`, `PXL_`, `-WA0001`) | `S` | Written from the format and passing the browser cases. Measured across every export on this machine: **zero occurrences**, so nothing here exercises them on real data |
| Apple Music `Event ID` in scientific notation | `-` | `-2.60601E+18`. The int64 is already lossy in the file |
| Embedded JSON inside a quoted CSV field | `-` | `Evaluation Variant`, with doubled quotes |
| Curly apostrophe U+2019 in column names | `-` | `User's Audio Quality`. An ASCII match fails |
| Apple's own header typo `Last End Reason Tyoe` | `-` | Really in the file. Do not "correct" it |
| `Date Played` as a bare `20150630` integer | `S` | The date reader handles this shape |
| Column names drifting between vintages | `-` | `Metrics Client ID` vs `Metrics Client Id` |
| Zero-byte files as a normal result | `-` | `Additional Subscriptions` observed empty |
| Any category arriving as PDF | `-` | Apple confirms PDFs exist but never says which |

## 5. Google Takeout

| Category | State | Notes |
|---|---|---|
| Photos media | `V` | |
| Sidecar `<name>.jpg.json` | `V` | |
| Sidecar `.supplemental-metadata.json` | `V` | Appeared around October 2024 |
| Sidecar suffix truncated (`.supplemental-me.json`, `.suppl.json`) | `V` | Truncated at an arbitrary point when the whole name runs long. Match by prefix, never a fixed suffix |
| Sidecar with the duplicate counter moved (`IMG_1.JPG(1).json`) | `V` | |
| **How often the date is actually in the file** | `V` | Counted with `tools/count-exif.js` over the real Takeout, 2,344 photographs: **49.1% carry `DateTimeOriginal`, 50.9% do not.** The widespread claim that Takeout strips it from everything is wrong. Recoverability: 48.9% have it in both places, 0.1% in the file only, **50.2% in the sidecar only**, and 0.8% nowhere at all |
| Sidecar and embedded date agreeing | `V` | 1,146 photographs carried both. They agreed within a day in every one, no exceptions |
| Which sidecar names occur in practice | `V` | All 2,510 sidecars in this export are `.supplemental-metadata.json`. No plain `.json`, no basename form, no moved counter, **no truncation** - so the truncated forms remain sourced rather than seen, and the prefix matcher is still right to expect them |
| Basename sidecar (`IMG_1234.json`) | `V` | |
| Photo with no sidecar at all | `V` | `-edited` files and some videos |
| `photoTakenTime.timestamp` as epoch seconds in a string | `V` | |
| `geoData` all zeros meaning absent, not the Atlantic | `V` | And it is not a rare edge case: **1,755 of 2,510 sidecars in the real export carry it**, 70%. A reader that trusts those coordinates draws seven hundred photographs in the Gulf of Guinea |
| **How often the location is anywhere at all** | `V` | Counted over the same 2,344 photographs: 24.2% have GPS in both the file and the sidecar, 0.1% in the file only, **0% in the sidecar only**, and 75.6% have none anywhere. The sidecar never once supplied a location the file did not already carry - the opposite of the date, where it was the only copy for half the library |
| Live Photo pairs (HEIC + MP4) | `-` | |
| Album `metadata.json` | `-` | |
| Shared album comments, memory titles | `-` | |
| **Location History from Takeout** | `V` | Google moved Timeline on-device during 2024-2025 and shut the server-side one down in June 2025, so a Takeout has nothing to include. **Measured in the real export: `Takeout/Timeline/Settings.json`, 1,099 bytes, and no records at all.** The parser now notices a Timeline folder that produced no places and says why, instead of leaving an empty map with no explanation. Folder detection checked against seven paths including two decoys - `Takeout/News/followed_locations.txt` and Maps saved places - and the old `Records.json` route still matches. The guide FAQ was already right and now covers the iPhone route too |
| Legacy `Records.json` (`latitudeE7`, `timestampMs`) | `V` | Only old exports have it |
| Legacy `Semantic Location History/<year>/<year>_<MONTH>.json` | `-` | Month names are uppercase English regardless of locale |
| On-device `Timeline.json` | `X` | **Completely different schema.** `semanticSegments`, `rawSignals`, coordinates as strings with a degree sign, timestamps carrying a local offset. This is where all new location data lives |
| Gmail `All mail Including Spam and Trash.mbox` | `-` | Can be 100 GB. Must stream. Labels only via an `X-Gmail-Labels` header |
| Drive files | `-` | |
| Contacts `.vcf` | `-` | |
| Calendar `.ics` | `-` | |
| Chrome `BrowserHistory.json` | `-` | Some timestamp fields are microseconds since 1601 |
| Chrome bookmarks HTML, autofill, extensions | `-` | |
| YouTube watch and search history | `-` | **HTML or JSON depending on a toggle set at request time.** Both must work |
| YouTube playlists, subscriptions, comments | `-` | Two-table CSVs with a blank line between sections - the same shape as Samsung's |
| My Activity per product | `-` | Same HTML-or-JSON toggle. Twenty-odd product folders |
| Maps saved places, reviews | `-` | |
| Fit daily metrics | `S` | **Written from documentation, never run on a real export** - the Takeout here has no `Fit/` folder at all, so there was nothing to check it against. Column matching, the wide-row split and the average/max/min collapse were exercised against the documented column names through a Node harness: 9 documented columns produce 6 distinct panels with no duplicates, and Heart Points and latitude correctly stay tables. That tests the logic, not the format. First real Fit export settles whether the column names are right |
| Fit all-data JSON, TCX per session | `-` | Nanosecond epochs. Not read |
| Keep notes | `-` | One JSON+HTML pair per note; microsecond timestamps |
| Tasks | `-` | |
| Play Store (nine separate JSON files) | `-` | Each with a different top-level shape |
| Play Games per-game JSON | `-` | |
| Chat `messages.json` | `-` | |
| Hangouts `Hangouts.json` | `-` | Microsecond timestamps. Legacy accounts only |
| Voice - one HTML file per conversation | `-` | Tens of thousands of small files |
| Groups - mbox per topic | `-` | |
| Blogger Atom XML | `-` | |
| Access Log Activity | `-` | Filename long enough to break Windows paths |
| Android Device Configuration HTML | `-` | |
| `.tgz` instead of `.zip` | `V` | Stale `X` left over from before it was built. See section 1, which verifies it in detail |
| A photo and its sidecar landing in different parts | `-` | |

### 5a. Takeout localises its own names

**Takeout localises its own names, per string, inconsistently.** A German
archive translates `Access Log Activity` to `Zugriffsprotokollaktivitaten`,
`Saved` to `Gespeichert`, `Profile` to `Profil` and `archive_browser.html` to
`Archiv_Ubersicht.html` - while leaving `Groups`, `Classroom`, `Discover`,
`Home App` and `Search Contributions` in English **in the same archive**. A
Finnish archive localises file names as well, and lower-cases some of them.

This matters more here than anywhere else in this document, because this is a
Norwegian product and its first testers will not have English archives.

| What | State | Notes |
|---|---|---|
| Detecting a localised Takeout | `S` | Signature widened past the English index page. Still guesswork for languages nobody has sampled |
| Sidecar matching | `V` | Language-independent by luck rather than design - it matches on the file extension pattern, not the folder |
| Folder-name matching anywhere else | `-` | Anything that keys on an English folder name will fail. Worth an audit |
| Detecting the archive language | `-` | The index page name is the only reliable signal |

### 5b. The long tail

Not one of these has been opened. Listed because the shapes are unusual enough
that each needs its own test rather than a generic reader.

| Category | State | Notes |
|---|---|---|
| Google Voice | `-` | One HTML file per conversation *fragment*, tens of thousands of them. Attachment names have to be guessed by trying extensions. Base names truncated at 50 characters. The filename is UTC and the body carries a local offset, and they disagree |
| Google Chat | `-` | `Groups/DM 1pRI-QAAAAE/messages.json` - the separator is a **space**. `created_date` is a localised human sentence, not an epoch |
| Hangouts | `-` | Microsecond epochs as strings; message text is an array of segments to join; 500 MB single file |
| Play Store | `-` | Top level is a list of single-key wrapper objects. `invoicePrice` is a localised currency string, so a naive strip of non-digits mangles `1.234,56` - which is exactly the Norwegian format |
| Play Games | `-` | Four fixed HTML files per game, in a folder named after the game |
| Access Log Activity | `-` | Filename is a truncated English sentence, cut mid-word. 645,000 rows in 106 MB for 28 days |
| Android Device Configuration | `-` | Highest-PII folder in Takeout: IMEI, serials, MAC addresses. Structure entirely inferred |
| Saved | `-` | **The header row is not row 1** - a description line and a blank line come first, so a naive reader mis-keys every column |
| Blogger | `-` | `.atom`, not `.xml`, so an `*.xml` glob misses it. Images are referenced by URL and shipped separately with no documented mapping |
| Waze | `-` | Not in Takeout at all. A password-protected zip emailed separately, with whole drives packed into one CSV cell |
| Nest | `-` | Opaque generated ids, no readable device folder. Video export routinely completes with no video |
| Gemini | `-` | Chats live under My Activity; the `Gemini` category is only Gems. Both must be selected or half is silently lost |
| My Ad Center | `-` | Not a top-level category. Large activity files split into `MyActivity-1.html`, `-2.html` that must be concatenated |
| Meet, Messages, Fi, Store, News, Home App | `-` | Categories confirmed to exist, contents unknown. Messages commonly exports nothing at all |
| Podcasts, Cloud Print, Translator Toolkit | `-` | Dead products whose folders persist. Recognise and skip quietly rather than warn |

## 6. Snapchat

The request form has per-category toggles, a date range, an **Export your
Memories** checkbox and an **Export JSON Files** checkbox.

**Measured** in a real export: 2 archives, 2.1 GB, 608 entries, 606 media.
480 memories and 126 overlays, every overlay paired and no orphans. It is a
memories-only download, so everything that lives in `json/` is still unproved.

| What | State | Notes |
|---|---|---|
| `mydata~<digits>-<n>.zip` naming | `V` | The real parts are `mydata~1786696263351-8.zip` and `-9`. The account name is nowhere in them, which is why detection also needs the archive name |
| Multi-part | `V` | Confirmed: the media parts carry `memories/` and nothing else. Documentation says only part 1 has `json/` and `html/`, and neither part here does |
| `json/` present | `S` | Sample export only. Neither real part contains a `json/` folder |
| **`json/` absent entirely** | `X` | JSON is an opt-in checkbox. An HTML-only export is a first-class case, not an error. We would show nothing |
| `html/` pages | `S` | Sample export only |
| `memories_history.json` | `S` | Sample only. `Date` ends with a literal ` UTC` that must be stripped |
| Memories bundled in `memories/` | `V` | `<date>_<uuid>-main.<ext>` plus a separate `-overlay.png`. 480 and 126 of them |
| Memories as links only | `-` | `Download Link` needs a **POST**, and the reply is a plain-text URL to fetch. **The CSP forbids this and should.** We must explain the export is links-only rather than showing an empty library |
| Roughly 5% of referenced media missing | `-` | Normal, not an edge case |
| Duplicate timestamps across memories | `-` | Split video segments. Never dedup on timestamp alone |
| `chat_media/` nested zips | `-` | `media~zip-<uuid>.zip`, and `.zip.nomedia` which an extension filter skips |
| `snap_history.json` with no media ids | `-` | Snap events cannot be linked to media at all |
| `friends.json`, `location_history.json` | `S` | Sample only |
| Detected as Snapchat at all | `V` | **Was broken and nobody had opened a real export.** All four content markers live in `json/`, which the memories parts do not have, so both archives were detected as nothing: no label, no coverage panel, no Snapchat parser. Fixed by a shape test on the memory naming plus a name test on the archive, both confirmed in the browser |
| Dates | `V` | Snapchat strips the metadata and writes the date into the filename. 45 percent of this export was dated from file contents alone; reading the names as well, 480 of 480 |
| Split captions, real counts | `V` | 126 overlays, every one paired, no orphans. 94 pair with a picture, which composites; 32 with a video, which is written beside instead. The compositing output has not been looked at by eye, and the orphan path cannot be exercised by this export because it has none |

## 7. X / Twitter

Not supported at all yet, and the format is unusual enough to deserve its own row set.

| What | State | Notes |
|---|---|---|
| `Your archive.html` at the top level | `-` | With a space in the name |
| `data/*.js` are **not JSON** | `X` | Each file is `window.YTD.<name>.part0 = [ ... ]`. A JSON parser fails on every one |
| `data/manifest.js` uses a different prefix | `-` | `window.__THAR_CONFIG`. It is the authoritative index: read `globalName` from it rather than globbing |
| Filename hyphens, variable underscores | `-` | `account-creation-ip.js` holds `YTD.account_creation_ip.part0` |
| `tweets-part1.js` multi-part | `-` | **Parts are not in chronological order.** Concatenate then sort |
| `note-tweet.js` holds the full text | `-` | `tweets.js` carries a truncated copy of every long post. Join by id or silently lose the body |
| `created_at` in Twitter's legacy format | `-` | `Wed Oct 10 20:19:24 +0000 2018`. **`Date.parse` on this is not spec-guaranteed and Safari and Firefox have differed** - parse it with an explicit pattern |
| Two date formats in one archive | `-` | `account.js` uses ISO 8601 |
| `id_str` versus `id` | `-` | The numeric form overflows a double above 2^53 |
| `extended_entities` for media | `-` | `entities.media` holds only the first image of four |
| Empty files that still parse | `-` | `window.YTD.mute.part0 = [ ]` |

## 8. TikTok

Not supported. One enormous JSON file, and almost every key in it has been
renamed at least once, so a parser written against one export fails on another.

| What | State | Notes |
|---|---|---|
| `user_data_tiktok.json` | `-` | Older exports call it `user_data.json`. Both are in the wild; accept either |
| TXT instead of JSON | `-` | Chosen at request time. Structure undocumented and reportedly holds less |
| Root key renamed | `-` | `Activity` became `Your Activity`, and some exports put likes under a third root, `Likes and Favorites` |
| Section renamed | `-` | `Video Browsing History` became `Watch History`; `Search History` became `Searches`; `Follower List` became `Follower` |
| Casing inconsistent inside one file | `-` | `Link` and `link`, `Date` and `date`, camelCase in the profile, snake_case in the shop subtree |
| Maps where a list is expected | `-` | `ChatHistory` is keyed by conversation partner; `WatchLiveMap` likewise |
| Five date formats | `-` | Space-separated, ISO with T, ISO with Z, epoch seconds and epoch milliseconds. No timezone offset is carried, and whether it is UTC or local is undocumented |
| Missing keys rather than empty ones | `-` | A feature not available in a region simply is not there |
| No media at all | `-` | Videos, profile photo and message attachments are all URLs. Fetching them is a network call the policy forbids, so this needs saying rather than showing an empty library |
| One file, tens of megabytes | `-` | Nothing can be streamed per category. Measure `JSON.parse` on a real one before assuming |
| Watch history absent from a narrow request | `-` | Selecting only "Activity" instead of all data reportedly drops it. Worth a line in the guide |

## 9. Amazon

Not supported. Worth its own section because the request flow itself produces
a shape nothing else does.

**The category dropdown is single-select.** Anyone who wants orders and Kindle
and Alexa files three separate requests, which complete anywhere between six
hours and nineteen days apart. So a person's "Amazon export" on disk is very
often several unrelated archives, requested on different dates - and because
the format keeps changing, **one folder can hold two incompatible versions of
the same file**. That is our merge logic's worst case and nothing else in this
document produces it.

| What | State | Notes |
|---|---|---|
| `All Data Categories.1.zip` and `.2.zip` | `-` | A category is **not** guaranteed to sit wholly inside one part |
| One request fanning out to 50+ downloads | `-` | Reported for Kindle alone; 74 separate zips for a full request |
| The same category arriving as `.csv` **or** `.json` | `-` | Non-deterministic. The same person re-requested a day later and got the other one. The JSON carries **fewer fields** than the CSV |
| BOM present in one file, absent in another | `-` | Verified by byte inspection of two real files from one export |
| Four naming conventions in one export | `-` | `Title Case With Spaces`, `PascalCaseNoSpaces`, `snake_case`, and `camelCase` in the EU JSON build |
| Multi-valued cells joined with the literal `" and "` | `-` | A real `Ship Date` cell holds four ISO timestamps joined that way. A date reader throws on it |
| Timestamp precision varying inside one column | `-` | 1,574 rows without fractional seconds, 309 with |
| Prime Video using a different format entirely | `-` | `2019-04-08 18:48:31.276` - space separator, no `T`, no `Z`, two or three fractional digits. Audible is date-only |
| Sentinel strings in numeric and date columns | `-` | `Not Available`, `Not Applicable`, and lowercase `unknown` as a second sentinel in the same file |
| Localised enum values mixed in one file | `-` | `Product Condition` holding both `New` and `Neuf`; `Website` mixing `Amazon.it` and `Amazon.fr`. A Norwegian account will do the same |
| JSON embedded in a CSV column with doubled quotes | `-` | Alexa settings. Also a pipe-delimited key=value blob in a Kindle column |
| Values containing literal quote characters | `-` | Prime Video titles render with the quotes inside the cell. Stripping them blindly damages real titles |
| Identical filenames in different archives | `-` | `Advertising.AdvertiserAudiences.csv` exists in `Advertising.1` and `Advertising.2` with different contents. Flattening the tree silently loses one |
| `.schema.json` sidecars alongside the data | `-` | A naive `*.json` glob picks them up |
| Format changed again on 19 February 2026 | `-` | Columns alphabetised, four renamed, all-fields-quoting dropped, sort order changed, folder renamed. **Recent enough that both shapes are in the wild right now** |
| Empty archives as a normal result | `-` | Unused services ship empty zips, and Amazon creates default empty Alexa lists for accounts that never used Alexa. File present is not data present |
| Mixed separators in top-level names | `-` | Dots, hyphens, underscores and spaces all appear: `Retail.OrderHistory.1`, `Amazon-Music`, `Alexa_1`, `Audio and Transcription` |
| Non-tabular members | `-` | Addresses arrive as a **PDF**. Also `.txt` field docs, `media/` folders of emails, `.mp3` call recordings, `.wav` Alexa audio |
| Amazon Photos metadata with no photographs | `-` | The export documents the library and does not contain it. Another case where "explain, do not show an empty library" is the right answer |

Scale is lopsided in a useful way: even a twenty-five-year customer's order
history stays in single-digit megabytes. The gigabytes are Alexa `.wav` audio -
one household reported 90,000 clips over three and a half years.

## 10. Meta, and everything else

| Service | State | Notes |
|---|---|---|
| Facebook posts, photos, comments | `V` | Thin. A real export was requested and opened, but the account is barely used, so what it proves is that the parser opens a genuine Facebook export - not that it handles a populated one. No copy is kept on this machine |
| Facebook, a populated account | `-` | The gap that matters. Volume, multi-part splitting and accented text are all unexercised, and none of them can be tested against an empty account |
| Facebook multi-part with repeated JSON | `S` | Content dedup handles it, on sample data |
| Instagram posts, stories, reels | `V` | Real, but a 108 KB partial export of 42 entries. True for what was in it, which was not much |
| Instagram messages | `V` | Same caveat |
| **Meta mojibake, accented text** | `S` | Repaired. Twelve guard cases pass in the browser, including the negatives |
| **Meta mojibake, emoji** | `S` | Was broken: the old repair matched only a C2 or C3 lead byte and an emoji leads with F0, so every one stayed mangled with three of its four bytes invisible |
| Repair left off text that was never broken | `S` | Three guards: nothing above U+00FF, something above U+007F, and the bytes must decode as UTF-8 with the fatal flag set |
| Repair applied to dictionary keys | `S` | A thread keyed by a broken name is as unreadable as a broken message |
| Repair **not** applied to an HTML export | `-` | Those are already correct UTF-8 and repairing them corrupts the words it is meant to save |
| Meta fixing this unevenly | `-` | A recent Facebook export was reportedly clean while Instagram was not, so the test has to be per string rather than per service |
| Facebook / Instagram HTML instead of JSON | `-` | The user chooses at request time |
| WhatsApp | `-` | |
| Instagram not mistaken for Facebook | `V` | **It was.** `personal_information/` was a Facebook marker and is Meta's, not Facebook's: a real Instagram export has five entries under it, beating Instagram's own four markers, so the archive was labelled Facebook. Dropped from Facebook, and three Instagram-only markers added. Confirmed against the real export and in the browser |
| TikTok | `-` | |
| X / Twitter | `-` | |
| Discord | `-` | |
| Reddit | `S` | Parser written and run against `apps/web/samples/reddit-export.zip`. No real export requested yet |
| Spotify standard | `-` | |
| Spotify extended streaming history | `-` | A separate, slower request with different filenames |
| LinkedIn | `-` | |
| Microsoft / OneDrive / Outlook | `-` | |
| Amazon | `-` | |
| Netflix | `-` | |
| Strava, Garmin, Fitbit, Oura, Withings | `-` | The health-data cluster; worth doing together |
| Telegram, Signal | `-` | |

A second research pass on this group was still running when this document was
written. Fill in exact filenames when it lands.

## 11. Browsers

The most dangerous table in this document.

| Browser | State | Notes |
|---|---|---|
| **Brave desktop** | `V` | **Everything has only ever been run here.** This table said Chrome for months and it was wrong - the maintainer's browser is Brave. Worth more than the Chrome row it replaces, not less: Shields were on throughout, so the one engine that has run this code ran it with content blocking active |
| Chrome desktop | `-` | Same Chromium engine as Brave and without Shields, so the lowest risk in this table by a distance. Still, never actually run |
| Edge desktop | `-` | Same engine; low risk |
| **Firefox** | `-` | No `showDirectoryPicker`, so it takes the streamed fallback that has never been run |
| **Safari desktop** | `-` | Same, plus its own file handling |
| Safari iOS | `-` | Upload is deliberately disabled on handhelds |
| Chrome Android | `-` | Same |

Every visitor on Firefox or Safari takes the streamed-archive fallback,
because neither supports `showDirectoryPicker`. That path has no real-world
testing at all, and these rows are the largest open risk in this document.

## 12. Interface

| What | State | Notes |
|---|---|---|
| Highlights cards | `S` | Card kinds checked against the demo and against real Samsung tables through a Node harness |
| Chart at 400,000 rows | `S` | 1.09 s, after a stack overflow was fixed |
| Coverage panel | `S` | Driven with the nine real archive names; the DOM was checked, the pixels were not |
| Source tree, checkboxes, partial state | `S` | |
| Notifications capped at two | `V` | |
| Source filter applied everywhere | `S` | Report page and coverage panel fixed; the other views were already right |
| Mobile layout | `S` | Screenshots taken at several widths |
| Dark mode | `-` | Left dark deliberately; 46 hardcoded non-grey colours remain |
| Keyboard navigation | `-` | |
| Screen reader | `-` | |

Almost every `S` in this table is because **the browser preview pane will not
composite**, so no screenshot can be taken. Geometry read in that state is
unreliable. Visual confirmation is outstanding across the board.

## What the exports on this machine can and cannot prove

Checked on 3 August 2026 against the maintainer's own exports. The distinction
this section draws is between how carefully something was tested and how much
there was to test it against. They are not the same thing, and conflating them
is unfair in both directions.

Where a service could be tested, it was tested hard. The AES keystream is
checked block for block against a known-good implementation to 70,000 blocks at
three key lengths. Every entry of every Samsung archive was decrypted, its
authentication code verified, and the result run through the parser. The chart code was measured at 400,000 rows, which found a
crash nobody would have hit by clicking. The reconciliation balances to zero on
a real 38 GB Takeout. That is not thin testing.

What is thin is the **data available to test with**, and no amount of care fixes
that. One person does not have a Galaxy Watch, a decade of Instagram, and a
Facebook account with Norwegian in it.

| Folder | Archives | Size | What it proves |
|---|---|---|---|
| `samsung` | 9 | 7.5 MB | **Backed end to end.** Every entry listed, all 57 decrypted, the real CSVs through the section splitter and the card builder |
| `google` | 6 | **38 GB** | **The photo pipeline is proven.** 5,041 entries, 6 unread, zero orphan sidecars across 2,336 photographs. It is also the export that found the silent CSV cap |
| `apple` | 18 | 1.4 GB | **Structure confirmed, parsing not.** It proved the nested-zip gap, the `(1).zip` duplicate and `Part N of M` grouping. 111 vCards, 809 notes, 2 calendars and 319 Siri recordings sit unread inside it |
| `instagram` | 2 | 108 KB | Little. 42 JSON files with, measured, **no non-ASCII characters at all**. It did prove one thing: the archive was being labelled Facebook |
| `snapchat` | 2 | **2.1 GB** | **Memories only, and enough.** 480 memories and 126 overlays, all paired, all dated. It found the detection failure - both parts were recognised as nothing - and the unused date in every filename |
| `facebook` | 0 | empty | Nothing. The folder is empty |

Three things follow, and they are about coverage rather than rigour:

**The mojibake repair cannot be confirmed here.** Not because it was tested
carelessly - it passes twelve cases including the four that must be left
untouched - but because neither export on this machine contains a single
accented character or emoji to try it on. A Facebook or Instagram export with
Norwegian in it settles it in one minute.

**A library that looks complete is not evidence of one.** The Google photographs
came through, which is what made the export look finished. Counting every entry
showed a fifth of the archive producing nothing, and no view in the app said so.
Both were true at once. That is the reason the reconciliation exists, and it now
answers the question for anyone rather than only for the maintainer.

**Reading a screenshot is not verification.** Several Apple rows were marked from
what the app displayed, which shows something was read - not that it was read
correctly, and not that anything absent was noticed. The 394 entries locked
inside nested archives were on screen as nothing at all until the archives were
opened directly. Those rows say so now.

## Harness gaps

The things that would make this plan self-checking rather than a list somebody
has to remember to update:

1. **Partly closed.** `tools/check-export.js` runs a real export through the
   shipped zip reader and the shipped parser and prints what came out - what
   was detected, how much was dated, what notes the parser wrote. It is what
   found the Snapchat detection failure, the Instagram mislabel and the
   undated Drive files, none of which reading the code had suggested. What it
   still is not is an assertion layer: it prints numbers rather than failing
   on them, and it needs the maintainer's own exports to run at all.
2. **No fixture corpus.** Rebuilt exports should be committed under
   `tests/fixtures/` as they arrive, so a regression shows up immediately.
3. **No golden output.** Nothing records what a fixture *should* produce, so
   a change that quietly halves a row count passes.
4. **No performance floor.** The 400,000-row measurement is a one-off in a
   scratch script, not something that would notice a regression.
5. **Nothing checks the reconciliation stays balanced.** `unexplained`
   should be zero for every archive anyone ever opens, and only a person
   looking at the page would notice if it were not.
