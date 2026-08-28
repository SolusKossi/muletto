#!/usr/bin/env node
"use strict";

/* Muletto site builder.
   Guide content is data (apps/web/guides/*.json). This turns it into real
   static HTML pages so each guide has its own crawlable URL, its own title and
   description, structured data, and internal links to related guides.

   Run: node tools/build-site.js
   Never hand-edit the generated .html files in apps/web/guides/. */

const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.join(__dirname, "..");
const WEB = path.join(ROOT_DIR, "apps", "web");
const GUIDES = path.join(WEB, "guides");
/* The one canonical host. Every canonical link, og:url and sitemap entry is
   built from this, so it has to be the host that actually answers - not one
   that redirects to it. Telling a crawler the canonical is the apex while the
   apex 308s to www is a contradiction it resolves by guessing.
   Override with MULETTO_SITE if the primary host ever changes. */
const SITE = process.env.MULETTO_SITE || "https://muletto.app";

/* Everything the generator writes is indexable.
 *
 * There used to be a build flag and a per-guide rule keeping pages out of the
 * index. Both were written before the site was live. Pages that should stay
 * out now say so in their own markup - the superseded home page is the only
 * one - so the generator has nothing left to decide. */

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

/* ---------- shared chrome ---------- */

/* How far up the tree this page sits. Was `depth ? "../" : ""`, which is
   correct for the two levels that existed and silently wrong for a third:
   a Norwegian guide lives at /no/guides/x.html and needs three. */
/* A newline, by code value. Building one inside a patch script is how this
   repository has repeatedly ended up with a real line break inside a string
   literal - there is a house rule about it and it has been broken again
   since. Naming it once removes the temptation. */
const NL = String.fromCharCode(10);

/* Which language is being written, and which guides exist in it.
 *
 * Module state rather than another parameter, because the alternative is
 * threading a language through a dozen helpers that only two of them use.
 * The build is one synchronous pass, so there is nothing to race with; both
 * are set immediately before each page is written.
 *
 * `sib` is the reason this exists. A Norwegian guide links to other guides,
 * and most of them are not translated yet. Pointing at a Norwegian sibling
 * that is not there gives the reader a 404; the honest fallback is the
 * English page, which answers their question in the wrong language rather
 * than not at all. As translations land, those links quietly become
 * Norwegian without anybody editing a href.
 */
/* Which top-level pages exist in Norwegian. Until one does, the Norwegian
   chrome points at the English page rather than at a URL that is not there -
   the same fallback `sib` makes for guides, and for the same reason.
 *
 * Declared rather than read off the disk, and that is the whole point. The
 * first version asked `fs.existsSync`, which made the build depend on what
 * the *previous* build had left lying around: the 404 was written before
 * privacy.html existed, so it linked to English, and then the next run found
 * privacy.html on disk and wrote a different 404. Two runs, two answers, from
 * one input - and the only symptom was a page reported stale forever. A build
 * has to be a function of its sources. */
const NO_PAGES = new Set(["404.html", "privacy.html", "app.html", "index.html"]);
const hasNo = (file) => NO_PAGES.has(file);

let LANG = "en";
let TRANSLATED = new Set();
/* A link from inside guides/ up to a top-level page. These were written as
   "../index.html" back when every generated page sat exactly one level down.
   A Norwegian guide sits two levels down, so the literal was quietly wrong
   the moment the /no/ tree existed - and wrong in the way that produces a
   404 rather than an error. */
const topHref = (f) => (LANG === "nb" ? "../../" : "../") +
  (LANG === "nb" && hasNo(f) ? "no/" + f : f);

/* A number as a word, in the page's language. English spells these out in
   prose; Norwegian does the same, and using the English list on a Norwegian
   page would put "eighteen" in the middle of a sentence. Above twenty both
   fall back to digits, which is what a style guide would say anyway. */
/* Norwegian numerals live in strings.nb.json, not here: "en" carries an
   accent and this file is ASCII. Above twenty both languages fall back to
   digits, which is what a style guide would say anyway. */
const EN_WORDS = { 1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six",
  7: "seven", 8: "eight", 9: "nine", 10: "ten", 11: "eleven", 12: "twelve",
  13: "thirteen", 14: "fourteen", 15: "fifteen", 16: "sixteen", 17: "seventeen",
  18: "eighteen", 19: "nineteen", 20: "twenty" };
const spelledWord = (n) =>
  String((LANG === "nb" ? (NB_STRINGS.numbers || {}) : EN_WORDS)[n] || n);

const sib = (slug) => (LANG === "nb" && !TRANSLATED.has(slug))
  ? "../../guides/" + slug + ".html" : slug + ".html";

/* "root" rather than a number, for the 404. That page is served in answer to
   any address that matched nothing, including ones several folders deep, so a
   relative link on it would resolve somewhere that does not exist either. It
   is the one page whose links have to be absolute. */
const upTo = (depth) => (depth === "root" ? "/" : "../".repeat(depth || 0));

/* The words in the furniture, per language. Only the handful that appear on
   every page live here; everything else belongs to the page that says it. */
/* The words the template says itself, as opposed to the words a guide says.
 *
 * English stays inline because this file is English and reading it in place
 * is worth more than the symmetry. Norwegian comes from strings.nb.json, for
 * the ASCII reason above.
 *
 * `T()` is checked rather than trusted: asking for a key the Norwegian file
 * does not have would return undefined and put the word "undefined" on a
 * page, or - if it fell back to English - put an English sentence in the
 * middle of a Norwegian one, which is the quieter and worse failure. Every
 * key the templates use is verified against the file at startup, so a missing
 * one stops the build instead of shipping.
 */
const EN_STRINGS = {
  guides: "Guides", privacy: "Privacy", open: "Open an export",
  openShort: "Open export", source: "Read the source",
  other: "Norsk", otherLang: "nb",

  home: "Home",
  stepByStep: "Step by step",
  worthKnowing: "Worth knowing",
  commonQuestions: "Common questions",
  whereToKeep: "Where to keep your data",
  exportGuides: "Export guides",
  everyGuide: "Every export guide",

  titleService: "{provider} GDPR data export: how to request it and open it | Muletto",
  titleDest: "{provider}: where to keep your data | Muletto",
  h1Service: "How to export your data from {provider}",
  h1Dest: "Move your data to {provider}",
  kicker: "Requesting the GDPR export, what arrives, and how to open it.",

  introService: "{provider} is required to give you a copy of the data it holds about you, " +
    "including {list}. The request itself is free, and arrives as {format}. Typical wait: {wait}.",
  introDest: "Once you have your data out of the big services and cleaned up, it needs to " +
    "live somewhere you control. This guide covers moving your archive to {provider}.",

  openHeading: "Opening your {provider} export",
  openerRead: "Muletto reads {article} {provider} export directly - the zip, without " +
    "unpacking it first - and finds the {list} inside.",
  openerGeneric: "Muletto opens {article} {provider} export and lists everything in it. " +
    "There is no reader written specifically for this service yet, so its tables are shown " +
    "as {provider} wrote them - which is still a great deal more than a folder of files.",
  openerBrowser: "It runs in the browser: the archive is never uploaded, there is no " +
    "account, and nothing is installed. Open several exports at once and they become one " +
    "library, with the photographs that appear in more than one of them found automatically.",
  openButton: "Open your {provider} export",
  openFallback: "what is in it",

  dataTypes: {
    photos: "photos", videos: "videos", messages: "messages", location: "location history",
    contacts: "contacts", email: "email", browsing: "browsing activity",
    purchases: "purchase history", social: "posts and social activity",
    health: "health data", files: "files", other: "other records",
  },

  and: "and",

  descService: "Request your {provider} GDPR data export - {list} - then open it and " +
    "read what is inside. {steps} steps, what actually arrives, and how long it takes ({wait}).",
  descDest: "Step-by-step guide to moving your cleaned photo and data archive to " +
    "{provider}. {steps} steps, written for people who want to keep their own copy.",
  howtoService: "How to request and open your {provider} GDPR data export",
  howtoDest: "How to move your data to {provider}",
  locale: "en_GB",

  nfMetaTitle: "Not here - Muletto",
  nfMetaDesc: "That page does not exist. The guides, the opener and the privacy page all do.",
  nfTitle: "Not here",
  nfLead: "Nothing lives at that address. Either it never did, or it moved and " +
    "something still points at where it was.",
  nfApp: "The app itself. Drop in an archive from any of the big services and read " +
    "it in your browser.",
  nfGuidesHead: "The export guides",
  nfGuides: "How to ask each service for your data, what comes back, and what goes " +
    "wrong on the way. {count} of them.",
  nfPrivacyHead: "Where your data goes",
  nfPrivacy: "Nowhere. The long version, because a promise you cannot check is not " +
    "worth much.",
  nfBugHead: "A link that should work",
  nfBug: "If something on this site sent you here, that is a bug and worth saying " +
    "so. It takes one sentence.",

  pvMetaTitle: "Privacy: where your data actually goes | Muletto",
  pvMetaDesc: "Nothing is uploaded. What is kept, where, and how to check the claim yourself rather than take it on trust.",
  pvTitle: "Where your data actually goes",
  pvLead: "Short version: nowhere. Everything happens in your browser, on your machine. This page is the long version, because a promise you cannot check is not worth much.",
  pvUploadH: "Your export is never uploaded",
  pvUpload1: "Your export is opened by the browser itself, the same way it would open a file you double-click. Reading it, merging services, finding duplicates, repairing dates, searching and exporting all happen on your machine. No part of the archive is sent anywhere. Open your browser's network tab on the page where your export is open and you will see it load, and then nothing at all - not one request, for as long as you use it. Do the same on this page and you will see a single count go out, which is {link} and is the only thing on this site that ever does.",
  pvDescribedBelow: "described below",
  pvUpload2: "There is no exception, and the thing enforcing that is not a paragraph on this page. {csp} in the site's headers is {self} and nothing else, so the browser would refuse to send your archive anywhere even if a future change to this site tried to. You can read that header in your own browser's network tab, and the file that sets it is in the public source.",
  pvKeptH: "Some things are kept, on your device",
  pvKeptLead: "Reading a large export takes time, and working out which photos are near-duplicates takes longer. Doing that again every visit would be a poor trade, so the results are kept - in your browser's own storage, on your own disk.",
  pvKept1H: "What is kept",
  pvKept1: "The list of what is inside your export, the dates and places read out of it, and the results of any analysis. Plus a reference to each archive, so it can be reopened without asking you to find it again.",
  pvKept2H: "What is not kept",
  pvKept2: "Copies of your photos, videos or messages. A reference to an archive is a pointer to the file already on your disk, not a second copy of it. Move or delete the archive and Muletto will tell you it is gone.",
  pvKept3H: "Who can read it",
  pvKept3: "This browser, on this machine, for this site. Not us, not another site, not another profile. It is the same storage a web app uses to remember your settings.",
  pvKept4H: "Getting rid of it",
  pvKept4: "One button. Forget this library, in the sidebar, clears everything Muletto has kept, immediately. Clearing site data in your browser does the same.",
  pvPortableH: "Work you can take with you",
  pvPortable: "Browser storage belongs to the browser, and it can be cleared - by you, or by the browser needing room. Anything that took real effort can be written out to a file you keep. It holds the results only: no photos, no messages, not even file names. Feed it back next year alongside a fresh export and everything that still applies is recognised, because results are filed against the contents of each file rather than its name.",
  pvBackgroundH: "Nothing happens in the background",
  pvBackground: "There is no telemetry and no crash reporting. Nothing is sent while you are not looking. The app makes no network requests at all - not one, with your data or without it - which is a shorter claim than any list of exceptions could be, and an easier one to check.",
  pvCountH: "The one thing we do count",
  pvCountLead: "The pages of this site - not the app - send a note that a page was read. It is worth being exact about what that is, because most sites are not.",
  pvCount1H: "What is recorded",
  pvCount1: "Which page, which site you arrived from, which country the connection came from, a browser family, and whether the screen is a phone. Added to a tally for that day and nothing else.",
  pvCount2H: "What is not",
  pvCount2: "No cookie and nothing else stored on your device - which is the entire reason this site has no consent banner, because a banner exists to ask permission for exactly that. No address is kept, hashed, or turned into an identifier, so there is no such thing here as a visitor, a session or a return visit. Only counts.",
  pvCount3H: "Never from the app",
  pvCount3: "The page where your export is open sends nothing at all. That is why you can open the Network tab, use the whole app, and see no requests - a claim with an exception in it is not worth making, so there is no exception.",
  pvCount4H: "And it is refusable",
  pvCount4: "Do Not Track and Global Privacy Control are both honoured, though neither is required of a site that stores nothing on your machine. Turn either on and even the tally stops.",

  apMetaTitle: "Open a GDPR data export - Muletto",
  apMetaDesc: "Open the GDPR data export from Apple, Google, Samsung, Snapchat, Facebook, Instagram and twelve more. Muletto reads the zip in your browser - no upload, no account - and shows you what is inside.",
  apTitle: "Open your data export",
  apLead: "Drop in the GDPR export a service sent you. {count} services have a reader - Apple, Google, Samsung, Snapchat, Facebook and Instagram among them - and an export from anything else opens too, listed and read as far as its shape allows. It is read here, in this browser, on this machine. Open several together and they become one library, with the duplicates between them found automatically.",
  apDrop: "Drop your export files here",
  apDropAlt: "or click to choose them",
  apFine: "Zip archives from any service - a folder of them at once is fine, and so is one that arrived in a dozen parts. A Muletto work file goes here too, to bring back what was worked out last time. Nothing is uploaded, and you can {link} in about four seconds.",
  apFineLink: "check that yourself",
  apSamplesLead: "Not ready to use your own?",
  apSamples: "Open {count} sample exports",
  apSamplesTail: "real archives, invented people.",
  apCheckSummary: "How to check that nothing is uploaded",
  apCheck1H: "Turn off your wifi.",
  apCheck1: "Then open an export and use everything - search it, compare photos, write the tidied copy to your disk. It all still works, because none of it ever needed the network. A page that was uploading your files could not do that.",
  apCheck2H: "Watch the network.",
  apCheck2: "Press F12, open the Network tab, then open your export. You will see this page load and then nothing further. No request carries your archive because no request is made.",
  apCheck3H: "Read the rule the browser enforces.",
  apCheck3: "This page is served with a Content-Security-Policy whose connect-src is {self} and nothing else. There is no exception to it. It is not a promise in our words - your browser blocks anything else, and it applies to the code actually running rather than to a description of it.",
  apCheckFine: "There is also nothing here to breach: no account, no email address, no password, no cookies, and no server that receives files. The one thing that is stored is your own progress, in your own browser, so a large export does not have to be read again from scratch - and one button clears it. {link}.",
  apCheckFineLink: "The privacy page spells that out",

  hmMetaTitle: "Muletto - a GDPR data export viewer that runs in your browser",
  hmMetaDesc: "Open the GDPR export from Apple, Google, Samsung, Snapchat, Facebook and Instagram in one place. Duplicates found across services, dates and locations put back, everything written out as ordinary folders. Nothing is uploaded.",
  dismiss: "Dismiss",
  vowBold: "Your files never leave this device.",
  vow: "There is no upload, no account and no server that could receive them - the browser is told to refuse it.",
  vowLink: "What is stored, and where",
  heroA: "They have to give you your data.",
  heroB: "Nobody said it had to arrive readable.",
  lede1: "Ask Apple, Google, Meta or Snapchat for everything they hold on you and a few zip files turn up. Inside: numbered folders, machine-written JSON, your messages split across services, years of locations you did not know were kept, and the same photograph four times over with the dates stripped out.",
  lede2: "Muletto opens the lot in this tab and hands back one thing you can read, search and keep.",
  ctaRequest: "I need to request one",
  ctaFine: "No account. Nothing uploaded.",
  gTimelineH: "One timeline",
  gTimeline: "Every archive on a single thread, in the order it happened, rather than four folders that share no filenames and no dates.",
  gMessagesH: "Your messages, together",
  gMessages: "Conversations that ran across Snapchat, Instagram and Messenger read as one conversation, with the person, not the platform.",
  gPlacesH: "Everywhere you have been",
  gPlaces: "The location logs each service kept, drawn on your own machine. The coastline ships with the page, so drawing your movements does not hand them to a map company as well.",
  gPhotosH: "Photos with their dates back",
  gPhotos: "Duplicates across services removed, real dates and places written into the files, ready for Photos, Immich, a NAS or a drive in a drawer.",
  gFilesH: "Files you own",
  gFiles: "Everything is written out as ordinary folders and ordinary files. Nothing needs this site to keep working - export once through Muletto, keep the organised files forever, and leave no trace behind.",
  gFreeH: "Free, and staying that way",
  gFree: "All of the above runs on your machine and costs nothing. If it saved you an afternoon, {link} - entirely optional, and nothing is held back if you do not.",
  gFreeLink: "you can buy me a coffee",
  easyHalfH: "Reading the export is the easy half",
  easyHalf: "Messages and records only have to be made legible. The pictures are a different job. There are (usually) tens of thousands, spread across every archive, most with their dates gone and plenty of them saved more than once.",
  uDupesH: "Duplicates found across services",
  uDupes1: "Any photo tool spots two copies in the same folder. The ones filling your disk sit in four different archives under four filenames with four different dates, and nothing else finds them because nothing else opens more than one export at a time.",
  uDupes2: "Muletto compares the contents, so the same picture from iCloud, Google, Snapchat and a WhatsApp re-save is one picture. It catches the near-copies too: the burst, the crop, the screenshot of the screenshot.",
  uFilesH: "The work goes into the files, not an account",
  uFiles1: "Dates and places are written into the photographs themselves, in the fields every photo application already reads. Move the library to Apple Photos, to Immich, to a NAS or to a drive in a drawer and it stays sorted and searchable.",
  uFiles2: "Nothing is held here. There is no account to lose and no library that stops working if this site does.",
  seamH: "The rest is detail",
  seam: "Worth reading if you want to know exactly what happens to a file before you point this at your own archive. Same product, told properly.",
  specH: "What happens, in order, from asking to keeping",
  spec: "One pass through the whole thing, from asking a service for your data to clearing it away again. Each step says what happens and why it works that way.",
  fAskH: "You ask them for it",
  fAsk: "Every service has to hand over what it holds on you, and every one of them has buried the button somewhere different. The guides walk each request, screen by screen, and say what the wait usually is.",
  fAskWhy: "Muletto is not involved. You are asking them directly, with your own account, and the archive arrives at your machine.",
  fOpenH: "You open it here",
  fOpen: "The zip's index is read from the end of the file, and entries are inflated one at a time with <code>DecompressionStream</code> over <code>File.slice()</code>. The archive is never held whole, so a 50 GB Takeout behaves like a small one. Archives past 2 GB arrive in a different format again, and that is read here too.",
  fOpenWhy: "Nothing is sent anywhere, and the page is served with a Content-Security-Policy whose <code>connect-src</code> lets the browser refuse it on our behalf. Turn off your wifi and every step below still runs.",
  fReadH: "It is read into one library",
  fRead: "Photographs, messages, location history, searches, watch history, payments and account tables, out of whatever shape each service chose - Snapchat's JSON, Meta's per-thread files, Google's per-product folders, Apple's and Samsung's CSVs - merged onto one timeline by the timestamps they already carry.",
  fReadWhy: "Two services that logged the same afternoon end up next to each other, which you cannot see while they sit in separate folders.",
  fThumbsH: "Small copies are made, once",
  fThumbs: "Each picture is shrunk to a 320px copy and written to your browser's own storage, on disk. Videos give up their first frame the same way.",
  fThumbsWhy: "A wall of three thousand photographs cannot open the originals every time you scroll - that is megabytes each. The copies are made once, in background threads so the page stays alive, and are still there next visit and when the same photograph turns up inside next year's export.",
  fDupesH: "Duplicates are found by content",
  fDupes: "Every file is keyed by a SHA-256 of its bytes. The archive's own checksum and length are a free first pass that only suggests a match; nothing is treated as the same photograph until the hash agrees. Near-copies are caught separately with a perceptual hash, with the flat images held back because a blank screenshot has no fingerprint worth comparing.",
  fDupesWhy: "The copies wasting your disk are in four different archives under four filenames with four dates. Only content finds those.",
  fDatesH: "Dates and places are put back",
  fDates: "Recovered from the sidecar JSON that Google and Meta ship beside each file, or from the container for video, then written into the JPEG as EXIF <code>DateTimeOriginal</code> and a GPS block - rebuilt whole rather than spliced, because inserting a tag shifts every offset after it.",
  fDatesWhy: "A half-correct EXIF loses the date and moves the location, which is worse than leaving it alone.",
  fWriteH: "You write it out and keep it",
  fWrite: "Straight to a folder through the File System Access API where the browser has it, or one streamed archive where it does not - compressed as it is written, so only the index is held. Descriptions go in as XMP <code>dc:description</code>, which Lightroom, digiKam, Immich, Bridge and Apple Photos all read.",
  fWriteWhy: "Ordinary folders and ordinary files. Move them to a NAS or a drive in a drawer and they stay sorted and searchable with nothing of ours involved.",
  fForgetH: "You forget this ever happened",
  fForget: "We hold nothing to delete - there is no account, no server and no copy of your data anywhere but your own machine. What is left after a session is a small pile of working files in your own browser: the comparisons, the repaired dates and the little thumbnail copies. Harmless, and yours.",
  fForgetWhy: "One button clears them, after saying what goes and offering to save the work to a file first. Take that option and your exported folders are all that remains; take the button and there is no trace left of any of this - not with us, because there never was any, and not on your machine either.",
  tblCaption: "What each service sends, where a real export has been opened",
  tblService: "Service",
  tblHow: "Delivered as",
  tblWait: "Typical wait",
  tblValid: "Link valid",
  tblParsed: "Parsed",
  tblApple: ".zip, often several",
  tblGoogle: ".zip, up to 50 GB each",
  tblSnap: ".zip, JSON + media",
  tblSamsung: ".zip, often several",
  tblMeta: ".zip, JSON or HTML",
  tbl7days: "up to 7 days",
  tbl30days: "up to 30 days",
  tblFewDays: "a few days",
  tblHoursDays: "hours to days",
  tbl1week: "1 week",
  tbl4days: "4 days",
  tblAppleParsed: "Photos, videos, purchases, files",
  tblGoogleParsed: "Photos, videos, location history, mail, browsing, purchases",
  tblSnapParsed: "Memories, messages, location, friends",
  tblSamsungParsed: "Photos, videos, health records, files",
  tblInstaParsed: "Photos, videos, messages, posts",
  tblFbParsed: "Photos, messages, posts",
  caveatReaders: "Apple Health has been opened for real as well - 383,000 records out of one 161 MB file - and is left out of the table only because it arrives from the phone rather than from a website. These are read too: {list}. Those readers are written from what each service documents and none of them has met a real export yet, which is a weaker thing and is said as such on {link}.",
  caveatReadersLink: "every one of their guides",
  glance: "At a glance",
  glEffort: "Effort",
  glWait: "Typical wait",
  glTime: "Time",
  glFormat: "Format",
  glDelivery: "Delivery",
  glChecked: "Checked",
  otherServices: "Other services",
  otherDests: "Other destinations",
  diff_easy: "easy",
  diff_medium: "medium",
  /* Every value the guides actually use, taken from the guides rather than
     guessed at. The first attempt invented four and missed one that was in
     use - and T() threw on the missing one rather than printing "undefined"
     into the page, which is the whole reason it throws. */
  "del_email-link": "email link",
  "del_download": "download",
  "del_download-page": "download page",
  "del_on-device": "on the device",
  confNoun: "the request flow",
  confNounDest: "this",
  confChecked: "Checked {when}",
  confBadge: "Confirmed {when}",
  confBadgeFull: "Confirmed end to end {when}",
  confPartial: "Every screenshot below is from {provider}'s own pages on {when}.",
  confStale: "{noun} was walked on {walked} and the export opened in Muletto on {opened}. That is more than {months} months ago, so {provider} may have changed the page since. If what you see does not match, trust the screenshots least.",
  confFull: "{noun} was walked on {walked}, and the real export was opened in Muletto on {opened} to check it does what this guide says. Every screenshot below is from those runs.",
  footTagline: "Built by one person. Everything runs in your browser, and the source is public.",
  feat1: "Opens GDPR export archives without unzipping them",
  feat2: "Merges exports from several services into one library",
  feat3: "Finds duplicate photos across services",
  feat4: "Repairs capture dates and locations",
  feat5: "Reads messages, health data, location history and sign-in records",
  feat6: "Writes a tidied copy back to your own disk",
  browserReq: "Requires JavaScript. No account, no installation.",
  caveatLimits: "Two honest limits. Writing a date back needs JPEG - other formats are copied untouched and reported, not silently skipped. And folder writing needs {picker}, which today means Chrome or Edge; Safari and Firefox get one streamed archive instead.",
};

const NB_STRINGS = JSON.parse(
  fs.readFileSync(path.join(__dirname, "strings.nb.json"), "utf8"));

/* Every key the English side defines has to exist on the Norwegian side, and
   the check runs once at startup rather than at the moment a page happens to
   need one. A translation missing a key is a build that stops, not a page
   that ships with a hole in it. */
(function verifyStrings() {
  const missing = [];
  for (const k of Object.keys(EN_STRINGS)) {
    if (k === "dataTypes") {
      for (const d of Object.keys(EN_STRINGS.dataTypes)) {
        if (!(NB_STRINGS.dataTypes || {})[d]) missing.push("dataTypes." + d);
      }
    } else if (!NB_STRINGS[k]) missing.push(k);
  }
  if (missing.length) {
    throw new Error("tools/strings.nb.json is missing " + missing.length +
      " key(s) the templates need: " + missing.join(", ") +
      ". Add them, or the Norwegian pages would carry English text.");
  }
})();

const STRINGS = { en: EN_STRINGS, nb: NB_STRINGS };

/* Fill {name} holes. Deliberately not a template literal: the values come
   from guide JSON and are inserted into HTML, so they go through `esc` at the
   call site the same as any other content. */
function T(key, vars) {
  const table = STRINGS[LANG] || EN_STRINGS;
  let s = table[key];
  if (s === undefined) throw new Error("no string '" + key + "' for " + LANG);
  if (vars) {
    for (const k of Object.keys(vars)) s = s.split("{" + k + "}").join(vars[k]);
  }
  return s;
}

/* A list in the reader's language: "a, b and c" / "a, b og c". */
function joinList(items) {
  if (!items.length) return "";
  if (items.length === 1) return items[0];
  return items.slice(0, -1).join(", ") + " " + T("and") + " " + items[items.length - 1];
}

const dataLabel = (k) => (STRINGS[LANG] || EN_STRINGS).dataTypes[k] || k;

/* Where the same page lives in the other language, or null if it does not
   exist yet. Null is the important case: an untranslated page must not offer
   a switch to a URL that will 404, and must not claim an hreflang alternate
   for one either. */
function nav(depth, active, lang) {
  const up = upTo(depth);
  const t = STRINGS[lang || "en"];
  const home = up + (lang === "nb" && hasNo("index.html") ? "no/index.html" : "index.html");
  const at = (f) => up + (lang === "nb" && hasNo(f) ? "no/" + f : f);
  const on = (k) => (active === k ? ' class="active"' : "");

  return `  <nav class="nav">
    <div class="wrap">
      <div class="nav-left">
        <a class="wordmark" href="${home}">muletto</a>
        <div class="nav-links">
          <a href="${at("guides.html")}"${on("guides")}>${t.guides}</a>
          <a href="${at("privacy.html")}">${t.privacy}</a>
        </div>
      </div>
      <div class="nav-right">
        <a class="btn primary" href="${at("app.html")}">${t.open}</a>
      </div>
    </div>
  </nav>`;
}

/* Which commit is running.
 *
 * "Read the source" is only a check if a reader can tell that the source they
 * are reading is the source that is deployed. A hash in the footer, linked to
 * the commit, is what closes that.
 *
 * It is only shown when this tree is the public repository, because a hash
 * from the private one points at a commit nobody can open - which is worse
 * than no hash, since it looks like proof and is not. Build the public tree
 * and it appears; build the private one and it does not.
 */
function buildCommit() {
  /* Vercel sets this and it is authoritative. Reading it also means the stamp
     works on a shallow or detached checkout, where asking git can fail. The
     repository is checked either way, so a build of the private tree still
     produces nothing. */
  const env = process.env.VERCEL_GIT_COMMIT_SHA;
  const repo = process.env.VERCEL_GIT_REPO_SLUG;
  const owner = process.env.VERCEL_GIT_REPO_OWNER;
  if (env && repo === "muletto" && owner === "SolusKossi") return env.slice(0, 7);

  try {
    const { execSync } = require("child_process");
    const run = (c) => execSync(c, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const remote = run("git config --get remote.origin.url");
    if (!/[:\/]SolusKossi\/muletto(\.git)?$/i.test(remote)) return null;
    const hash = run("git rev-parse --short HEAD");
    return /^[0-9a-f]{7,40}$/.test(hash) ? hash : null;
  } catch (e) {
    return null;   // no git, no history, or a shallow checkout
  }
}
const COMMIT = buildCommit();

/* The stamp carries its own newline and indent, so that a build with no commit
   emits nothing at all rather than a line of eight spaces where the link would
   have gone.

   That stray whitespace is why the staleness check could not be made to pass:
   stripping the stamp from a stamped page removes the whitespace with it,
   while an unstamped page keeps it, so the two could never compare equal no
   matter how good the pattern was. Two hours went into the pattern. */
function commitLink() {
  if (!COMMIT) return "";
  return '\n        <a class="foot-commit" href="https://github.com/SolusKossi/muletto/commit/'
    + COMMIT + '" target="_blank" rel="noopener noreferrer"'
    + ' title="The commit this site was built from">build ' + COMMIT + "</a>";
}

/* The language switch lives down here and is deliberately almost invisible.
 *
 * /no/ holds a handful of pages against forty-three in English, and a visitor
 * offered a switch in the nav would take it, land somewhere Norwegian, click
 * once more and be back in English - which reads as a broken site rather than
 * an unfinished translation. Until the tree is complete there is nothing to
 * gain by advertising it.
 *
 * It is not removed, because it still has to be reachable: to check the
 * Norwegian pages, and because a reader who wants it should be able to get
 * there. So it stays in the markup, stays keyboard-reachable, stays announced
 * to a screen reader, and is simply not drawn until it is focused or hovered.
 * Hidden from the eye is not the same as hidden from the page, and only the
 * first of those is wanted here.
 */
function footer(depth, lang, altHref, tagline) {
  const up = upTo(depth);
  const t = STRINGS[lang || "en"];
  const home = up + (lang === "nb" && hasNo("index.html") ? "no/index.html" : "index.html");
  const at = (f) => up + (lang === "nb" && hasNo(f) ? "no/" + f : f);
  return `  <footer class="site">
    <div class="wrap">
      <a class="wordmark" href="${home}">muletto</a>
      <div class="foot-links">
        <a href="${at("guides.html")}">${t.guides}</a>
        <a href="${at("app.html")}">${t.openShort}</a>
        <a href="${at("privacy.html")}">${t.privacy}</a>
        <a class="foot-src" href="https://github.com/SolusKossi/muletto" target="_blank" rel="noopener noreferrer">
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>
          ${t.source}
        </a>${commitLink()}${altHref ? `
        <a class="foot-lang" href="${altHref}" hreflang="${t.otherLang}" lang="${t.otherLang}">${t.other}</a>` : ""}${tagline ? `
        <span class="small">${esc(tagline)}</span>` : ""}
      </div>
    </div>
  </footer>`;
}

/* `alt` is the same page in the other language, as { href, loc, lang }, or
   null when it has not been translated yet.
 *
 * Null has to stay a real case rather than an edge one. Google treats an
 * hreflang pair as a claim that both sides exist and point back at each
 * other, and a claim pointing at a 404 is worse than no claim: it can suppress
 * the page that does exist. So a page with no counterpart declares no
 * alternates at all, offers no language switch, and is simply a page in one
 * language - which is exactly what it is. `check.js` verifies the pairing in
 * both directions rather than trusting this to stay right. */
function page({ depth, title, description, canonical, body, jsonld, active, noindex,
                extraScript, lang, alt, bodyScripts, tagline }) {
  const up = upTo(depth);
  const code = lang || "en";
  /* The head is built here rather than by the caller, so LANG has to be right
     for the strings in it - the body was rendered under the caller's setting
     and this runs afterwards. */
  LANG = code;
  /* x-default names the version to serve somebody the other two do not fit.
     English, because it is the one a reader from anywhere can probably use. */
  const hreflang = alt ? [
    `  <link rel="alternate" hreflang="${code}" href="${esc(canonical)}" />`,
    `  <link rel="alternate" hreflang="${alt.lang}" href="${esc(alt.loc)}" />`,
    `  <link rel="alternate" hreflang="x-default" href="${esc(code === "en" ? canonical : alt.loc)}" />`,
  ].join(NL) + NL : "";
  return `<!doctype html>
<html lang="${code}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <link rel="canonical" href="${esc(canonical)}" />
${hreflang}  <meta property="og:type" content="article" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:url" content="${esc(canonical)}" />
  <meta property="og:site_name" content="Muletto" />
  <meta property="og:locale" content="${T("locale")}" />${alt ? `
  <meta property="og:locale:alternate" content="${STRINGS[alt.lang].locale}" />` : ""}
  <meta property="og:image" content="${SITE}/og.png" />
  <meta name="twitter:card" content="summary_large_image" />
${noindex ? '  <meta name="robots" content="noindex,follow" />\n' : ""}  <link rel="icon" href="${up}favicon.svg" type="image/svg+xml" />
  <link rel="apple-touch-icon" href="${up}og.png" />
  <link rel="stylesheet" href="${up}styles.css" />
  <!-- Themes. In the head so a dark theme does not start as a white flash,
       and on every page so the choice follows the reader around. -->
  <script src="${up}theme.js"></script>
${(jsonld || []).map((j) => `  <script type="application/ld+json">${JSON.stringify(j)}</script>`).join("\n")}
</head>
<body>
${nav(depth, active, code)}

  <main>
${body}
  </main>

${footer(depth, code, alt && alt.href, tagline)}

${bodyScripts !== undefined ? bodyScripts : `  <!-- Every disclosure on the site opens and shuts rather than jumping. -->
  <script src="${up}disclose.js"></script>
  <!-- Counts that a guide was read. See privacy.html. -->
  <script src="${up}analytics.js"></script>
  <script src="${up}app.js"></script>
${extraScript ? `  <script src="${up}${extraScript}"></script>\n` : ""}`}
</body>
</html>
`;
}

/* ---------- translations ---------- */

/* A Norwegian guide is `<slug>.nb.json` beside the English one, holding the
 * same shape with the prose replaced. Two rules decide whether it is used,
 * and both exist because the failure they prevent is silent.
 *
 * **It must be complete.** A missing field would fall back to English, and an
 * English sentence in the middle of a Norwegian page is the kind of thing
 * that survives for months: it reads as an oversight nobody owns rather than
 * as a bug. So a translation covering less than all of its prose is not used
 * at all, and the build says which fields are missing. Half a page is worse
 * than no page, because no page is honest about being absent.
 *
 * **It must be current.** Every translation records a hash of the English
 * file it was made from. Edit the English and the hash stops matching, the
 * Norwegian page drops out of the tree until somebody retranslates it, and
 * the build says so. This is the one guarantee that matters over time: this
 * repository has a documented history of two copies of one fact drifting
 * apart, and a translation is exactly that shape - so it is not left to
 * anybody remembering.
 *
 * The cost is that /no/ is only ever a subset of the site, which is correct
 * rather than a compromise. hreflang is a claim that two pages are the same
 * page in two languages; a page with no counterpart makes no such claim, and
 * `check.js` verifies the pairing from both ends.
 */

const crypto = require("crypto");

/* Which fields hold prose. Everything not here is a slug, an enum, a brand
   name or a URL, and translating any of those would break something. */
const TRANSLATABLE = [
  "wait_time", "format", "request.label",
  "steps[].title", "steps[].detail", "steps[].note",
  "notes[]", "faq[].q", "faq[].a",
];

const enHash = (obj) =>
  crypto.createHash("sha256")
    .update(JSON.stringify(obj, Object.keys(obj).sort()))
    .digest("hex").slice(0, 12);

/* Walk one of the paths above and return every value it names, with the
   position, so the English and the translation can be compared field by
   field rather than by counting keys. */
function fieldsAt(obj, spec) {
  const out = [];
  const parts = spec.split(".");
  const dive = (node, i, trail) => {
    if (node === undefined || node === null) return;
    if (i === parts.length) {
      if (typeof node === "string" && node.trim()) out.push([trail, node]);
      return;
    }
    const part = parts[i];
    if (part.endsWith("[]")) {
      const key = part.slice(0, -2);
      const list = key ? node[key] : node;
      if (!Array.isArray(list)) return;
      list.forEach((v, n) => dive(v, i + 1, trail + "/" + (key || "") + "[" + n + "]"));
    } else {
      dive(node[part], i + 1, trail + "/" + part);
    }
  };
  /* `notes[]` is a bare array of strings: the last segment is the value. */
  if (parts.length === 1 && parts[0].endsWith("[]")) {
    const key = parts[0].slice(0, -2);
    const list = obj[key];
    if (Array.isArray(list)) {
      list.forEach((v, n) => {
        if (typeof v === "string" && v.trim()) out.push(["/" + key + "[" + n + "]", v]);
      });
    }
    return out;
  }
  dive(obj, 0, "");
  return out;
}

/* Every prose field in a guide, as path -> text. */
function prose(g) {
  const map = new Map();
  for (const spec of TRANSLATABLE) {
    for (const [where, text] of fieldsAt(g, spec)) map.set(where, text);
  }
  return map;
}

/* Load the Norwegian overlay for a guide, or explain why there is not one.
   Returns { ok: true, guide } or { ok: false, why } - never a partial. */
function translation(g, dir, lang) {
  const file = path.join(dir, g.slug + "." + lang + ".json");
  if (!fs.existsSync(file)) return { ok: false, why: "no translation yet" };

  let t;
  try { t = readJson(file); }
  catch (e) { return { ok: false, why: "the file does not parse: " + e.message }; }

  /* The English this was translated from, minus the bookkeeping. The hash is
     taken over the guide's own file rather than over the merged object,
     because the merged one carries the index entry too and that moves for
     unrelated reasons. */
  const source = readJson(path.join(dir, g.slug + ".json"));
  const want = enHash(source);
  if (t.en_hash !== want) {
    return { ok: false, why: t.en_hash
      ? "the English has changed since this was translated (" + t.en_hash +
        " -> " + want + "); retranslate it and update en_hash"
      : "it has no en_hash, so nothing can tell whether it is current" };
  }

  const need = prose(source);
  const have = prose(t);
  const missing = [...need.keys()].filter((k) => !have.has(k));
  if (missing.length) {
    return { ok: false, why: missing.length + " field" + (missing.length === 1 ? "" : "s") +
      " not translated: " + missing.slice(0, 4).join(", ") +
      (missing.length > 4 ? ", ..." : "") };
  }
  /* Anything the translation left out that is not prose - the slug, the URL,
     the enums - comes from the English, which is where it belongs. */
  return { ok: true, guide: { ...g, ...t } };
}


/* ---------- guide page ---------- */

const DATA_LABEL = {
  photos: "photos", videos: "videos", messages: "messages", location: "location history",
  contacts: "contacts", email: "email", browsing: "browsing activity", purchases: "purchase history",
  social: "posts and social activity", health: "health data", files: "files", other: "other records",
};

function isDest(g) { return g.slug.startsWith("dest-"); }

/* Screenshots a guide asks for but that are not on disk yet. */
const MISSING_SHOTS = new Set();

/* Image dimensions, read from the file itself: the IHDR chunk for PNG, the
   first frame header for JPEG. Inlining width and height stops the article
   reflowing as figures load. */
function pngSize(b) {
  if (b.length > 24 && b.readUInt32BE(12) === 0x49484452) {
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  }
  return null;
}

function jpegSize(b) {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    // SOF0/1/2/3/5/6/7/9..11/13..15 all carry the frame dimensions.
    if (marker >= 0xc0 && marker <= 0xcf &&
        marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

const SHOTS = (() => {
  const dir = path.join(GUIDES, "img");
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).filter((f) => /\.(png|jpg)$/.test(f))) {
    const b = fs.readFileSync(path.join(dir, f));
    const size = f.endsWith(".png") ? pngSize(b) : jpegSize(b);
    if (size) out[f] = size;
  }
  return out;
})();

/* A guide is finished only when two separate things have been done by hand:
   the request flow walked and screenshotted, and the resulting export opened
   in Muletto. Documentation is not evidence for either - the Snapchat docs
   never mentioned the Export JSON files toggle, and implied the date range
   needed switching off when it already defaults to off.

   The date matters as much as the fact, because a provider can redesign its
   export page at any time. Past STALE_MONTHS the page says so. */
const STALE_MONTHS = 6;
/* Month names, per language. The date on a Norwegian page was coming out as
   "28 July 2026", which is not a date in Norwegian - and the class on the
   badge beside it stays English on purpose, because that one is a CSS hook
   rather than a word anybody reads. */
const EN_MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
const monthName = (m) => (LANG === "nb"
  ? (NB_STRINGS.months || [])[m] || EN_MONTHS[m]
  : EN_MONTHS[m]);

function longDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return null;
  const d = Number(m[3]), name = monthName(Number(m[2]) - 1);
  /* Norwegian writes the day as an ordinal with a full stop after it, and
     does not capitalise the month. "28 July 2026" is not a date in Norwegian
     any more than "July 28th 2026" is one in the middle of a sentence here. */
  return LANG === "nb" ? `${d}. ${name} ${m[1]}` : `${d} ${name} ${m[1]}`;
}

function monthsSince(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return Infinity;
  return (Date.now() - new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime())
    / (1000 * 60 * 60 * 24 * 30.44);
}

/* One stage: null, or {on, by} with a parseable date. */
function stage(v) {
  const when = v && longDate(v.on);
  return when ? { when, stale: monthsSince(v.on) > STALE_MONTHS, on: v.on } : null;
}

function confirmation(g) {
  const c = g.confirmed || {};
  const flow = stage(c.flow);
  const imp = stage(c.import);

  /* What the reader is told, as against what we track.
   *
   * The tally in GUIDE-STATUS.md and the rule that keeps an unverified guide
   * out of the index both still read this, so nothing about our own standard
   * has been relaxed. What has changed is that a guide no longer editorialises
   * about its own provenance at the person trying to follow it. A guide either
   * states something we know, or does not state it.
   *
   * So an unwalked guide shows no claim at all, rather than a paragraph
   * apologising for itself, and a walked one says what was walked and when. */
  if (!flow) {
    return {
      state: "none", badge: "", cls: "", flow: null, import: null,
      short: "", line: "",
    };
  }
  if (!imp) {
    return {
      state: "partial", badge: T("confChecked", { when: flow.when }), cls: " medium",
      flow, import: null, short: flow.when,
      line: T("confPartial", { provider: g.provider, when: flow.when }),
    };
  }
  const stale = flow.stale || imp.stale;
  return {
    state: "full",
    badge: T(stale ? "confBadge" : "confBadgeFull", { when: imp.when }),
    cls: stale ? " medium" : " verified", flow, import: imp, short: imp.when,
    line: T(stale ? "confStale" : "confFull", {
      noun: cap(T(isDest(g) ? "confNounDest" : "confNoun")),
      walked: flow.when, opened: imp.when,
      months: STALE_MONTHS, provider: g.provider,
    }),
  };
}

function cap(t) { return t.charAt(0).toUpperCase() + t.slice(1); }

function guideTitle(g) {
  return T(isDest(g) ? "titleDest" : "titleService", { provider: g.provider });
}

/* What happens after the download finishes.
 *
 * Written from the guide's own data rather than from a template with the name
 * swapped in: what Muletto reads from this service, what it does about the
 * thing that service gets wrong, and the one sentence of warning that applies
 * to this export and not to the others. A page of interchangeable filler
 * helps nobody and reads as filler, which is the failure mode this is trying
 * to avoid. */
/* "a Amazon export". Every provider name went through a hard-coded "a", and
   five pages said it: Amazon, Apple, Apple Health, Instagram and X.
   Vowel-initial names are the obvious half. The other half is X, where the
   letter is read aloud as "ex" - so it takes "an" while its spelling says
   otherwise, and so would an F or an S if a provider is ever named one. */
const AN_LETTERS = "AEFHILMNORSX";
function anArticle(name) {
  const word = String(name || "").trim().split(/\s+/)[0] || "";
  if (!word) return "a";
  /* A single letter is read out as its name, not as a word. */
  if (word.length === 1) return AN_LETTERS.includes(word.toUpperCase()) ? "an" : "a";
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

function openerSection(g) {
  if (isDest(g)) return "";
  const sup = g.muletto_support || {};
  const name = esc(g.provider);

  const lines = [];
  const kinds = (g.data_types || []).map(dataLabel);
  const list = kinds.length ? joinList(kinds.slice(0, 3)) : T("openFallback");

  /* The article only exists in English. Norwegian does not put one here at
     all - "en Amazon-eksport" would be wrong - so the placeholder is filled
     with nothing and the sentence is written without it. */
  const article = LANG === "en" ? anArticle(name) : "";
  lines.push(T(sup.importable ? "openerRead" : "openerGeneric",
    { article, provider: esc(name), list: esc(list) }).replace(/  +/g, " "));
  lines.push(T("openerBrowser"));

  /* The gotcha, from the guide's own notes rather than invented. The first
     note on every guide is the thing that goes wrong, by house rule. */
  const gotcha = (g.notes && g.notes.length) ? g.notes[0] : "";

  return `
          <h2 id="open">${esc(T("openHeading", { provider: name }))}</h2>
          ${lines.map((l) => `<p>${l}</p>`).join("\n          ")}
          ${gotcha ? `<div class="note">${esc(gotcha)}</div>` : ""}
          <p><a class="btn primary" href="${topHref("app.html")}">${esc(T("openButton", { provider: name }))}
            <svg class="arrow" viewBox="0 0 20 12" aria-hidden="true" focusable="false"><path class="a-line" d="M1 6h15"/><path class="a-head" d="M12 1.6 16.4 6 12 10.4"/></svg></a></p>`;
}

/* The sentence Google prints under the link. It was the one piece of prose on
   a Norwegian page still coming out in English, which is the worst place for
   it: the page reads as Norwegian to anybody who opens it and as English to
   everybody deciding whether to. */
function guideDescription(g) {
  if (isDest(g)) {
    return T("descDest", { provider: g.provider, steps: g.steps.length });
  }
  const kinds = (g.data_types || []).map(dataLabel).slice(0, 3);
  return T("descService", {
    provider: g.provider,
    list: kinds.length ? kinds.join(", ") : "",
    steps: g.steps.length,
    wait: g.wait_time || "",
  });
}

function guideIntro(g) {
  if (isDest(g)) {
    return T("introDest", { provider: g.provider });
  }
  const list = joinList((g.data_types || []).map(dataLabel));
  return T("introService", {
    provider: g.provider, list, format: g.format || "", wait: g.wait_time || "",
  });
}

/* Screenshots are redacted crops produced by tools/redact-screenshot.py, so
   they carry no account details. Width and height are inlined to stop the
   article reflowing as they load. */
function shot(s) {
  const dim = SHOTS[s.image];
  if (!dim) MISSING_SHOTS.add(s.image);
  return `<figure class="figshot">
                <span class="figshot-frame"><img src="img/${esc(s.image)}" alt="${
    esc(s.alt || "")}" loading="lazy"` +
    (dim ? ` width="${dim.w}" height="${dim.h}"` : "") + `></span>` +
    (s.caption ? `
                <figcaption>${esc(s.caption)}</figcaption>` : "") +
    `
              </figure>`;
}

/* Sidebar links carry the same brand mark the homepage uses. app.js fills
   [data-icon] with the inline SVG, so there is one copy of each logo. */
function sideLink(r) {
  return `<li><a href="${esc(sib(r.slug))}">` +
    `<span class="side-ic" data-icon="${esc(r.icon || "box")}"></span>${esc(r.provider)}</a></li>`;
}

/* `lang` and `alt` ride along rather than being threaded through every helper
   below, which would mean touching a dozen signatures to pass a value that
   only two of them use. The page's own canonical is derived from the language
   rather than passed, so the two cannot disagree. */
function guidePage(g, all, dests, lang, alt) {
  const dest = isDest(g);
  const conf = confirmation(g);
  const canonical = lang === "nb"
    ? `${SITE}/no/guides/${g.slug}.html`
    : `${SITE}/guides/${g.slug}.html`;

  const related = (dest ? dests : all)
    .filter((x) => x.slug !== g.slug).slice(0, 5);
  const crossLabel = T(dest ? "exportGuides" : "whereToKeep");
  const cross = (dest ? all : dests).slice(0, 4);

  const howto = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: T(dest ? "howtoDest" : "howtoService", { provider: g.provider }),
    description: guideDescription(g),
    inLanguage: LANG,
    totalTime: undefined,
    dateModified: g.verified && g.verified_on ? g.verified_on : undefined,
    step: g.steps.map((s, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: s.title,
      text: s.detail || s.title,
    })),
  };
  const crumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Muletto",
        item: SITE + (LANG === "nb" ? "/no/" : "/") },
      { "@type": "ListItem", position: 2, name: T("guides"),
        item: SITE + (LANG === "nb" && hasNo("guides.html") ? "/no/guides.html" : "/guides.html") },
      { "@type": "ListItem", position: 3, name: g.provider, item: canonical },
    ],
    inLanguage: LANG,
  };

  /* FAQPage, when the guide has questions.

     This is the schema that feeds AI Overviews and the answers models give, and
     those are now a bigger share of how anybody finds a page like this than the
     ten blue links are. The questions are the ones people actually type after
     an export has already landed and gone wrong, which is a different and much
     higher-intent moment than "how do I request my data". */
  const faq = (g.faq && g.faq.length) ? {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    inLanguage: LANG,
    mainEntity: g.faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  } : null;

  const body = `    <article class="wrap article">
      <nav class="crumbs" aria-label="Breadcrumb">
        <a href="${topHref("index.html")}">${esc(T("home"))}</a>
        <span>/</span>
        <a href="${topHref("guides.html")}">${esc(T("guides"))}</a>
        <span>/</span>
        <span aria-current="page">${esc(g.provider)}</span>
      </nav>

      <header class="art-head">
        <h1>${esc(T(dest ? "h1Dest" : "h1Service", { provider: g.provider }))}</h1>
        ${dest ? "" : `<p class="art-kicker">${esc(T("kicker"))}</p>`}
        <div class="art-meta">
          <span class="badge ${esc(g.difficulty)}">${esc(T("diff_" + g.difficulty))}</span>
          <span class="muted">${dest ? "Takes" : "Wait:"} ${esc(g.wait_time)}</span>
        </div>
        <p class="art-intro">${esc(guideIntro(g))}</p>
      </header>

      <div class="art-grid">
        <div class="art-main">
          ${g.request ? `<p><a class="btn primary lg" href="${esc(g.request.url)}" target="_blank" rel="noopener noreferrer">${esc(g.request.label)} <svg class="arrow" viewBox="0 0 20 12" aria-hidden="true" focusable="false"><path class="a-line" d="M1 6h15"/><path class="a-head" d="M12 1.6 16.4 6 12 10.4"/></svg></a></p>` : ""}
          ${g.explain ? `<aside class="explain"><h2>${esc(g.explain.title)}</h2><p>${esc(g.explain.body)}</p></aside>` : ""}

          <h2>${esc(T("stepByStep"))}</h2>
          ${!dest && conf.line ? `<p class="confirmed-line">${esc(conf.line)}</p>` : ""}
          <ol class="steps-ol">
            ${g.steps.map((s) => `<li>
              <h3>${esc(s.title)}</h3>
              ${s.detail ? `<p>${esc(s.detail)}</p>` : ""}
              ${s.image ? shot(s) : ""}
            </li>`).join("\n            ")}
          </ol>

          ${openerSection(g)}

          ${(g.notes && g.notes.length) ? `<h2>${esc(T("worthKnowing"))}</h2>
          ${g.notes.map((n) => `<div class="note">${esc(n)}</div>`).join("\n          ")}` : ""}

          ${(g.faq && g.faq.length) ? `<h2>${esc(T("commonQuestions"))}</h2>
          <div class="faq">
            ${g.faq.map((f) => `<details class="faq-q">
              <summary>${esc(f.q)}</summary>
              <p>${esc(f.a)}</p>
            </details>`).join("\n            ")}
          </div>` : ""}

          ${/* The generic version of this used to sit here, at the bottom, saying
                the same four sentences on all thirty pages. openerSection()
                replaced it further up with something specific to the service -
                what is actually read out of this export, and the one thing this
                service gets wrong - and two of them was one too many. */ ""}
        </div>

        <aside class="art-side">
          <div class="side-card">
            <h4>${esc(T("glance"))}</h4>
            <dl>
              <dt>${esc(T("glEffort"))}</dt><dd>${esc(T("diff_" + g.difficulty))}</dd>
              <dt>${esc(T(dest ? "glTime" : "glWait"))}</dt><dd>${esc(g.wait_time)}</dd>
              ${g.format ? `<dt>${esc(T("glFormat"))}</dt><dd>${esc(g.format)}</dd>` : ""}
              ${g.delivery ? `<dt>${esc(T("glDelivery"))}</dt><dd>${esc(T("del_" + g.delivery))}</dd>` : ""}
              ${!dest && conf.flow ? `<dt>${esc(T("glChecked"))}</dt><dd>${esc(conf.flow.when)}</dd>` : ""}
            </dl>
          </div>
          ${related.length ? `<div class="side-card">
            <h4>${esc(T(dest ? "otherDests" : "otherServices"))}</h4>
            <ul class="side-links">
              ${related.map((r) => sideLink(r)).join("\n              ")}
            </ul>
          </div>` : ""}
          ${cross.length ? `<div class="side-card">
            <h4>${esc(crossLabel)}</h4>
            <ul class="side-links">
              ${cross.map((r) => sideLink(r)).join("\n              ")}
            </ul>
          </div>` : ""}
        </aside>
      </div>
    </article>`;

  return page({
    depth: lang === "nb" ? 2 : 1, active: "guides",
    title: guideTitle(g),
    description: guideDescription(g),
    canonical, lang, alt,
    jsonld: [howto, crumbs].concat(faq ? [faq] : []),
    body,
  });
}

/* ---------- guides index ---------- */

/* One line per service.
 *
 * The old card stacked a logo, a name, a badge and a full wait sentence, and
 * every one of them was a different height - so the index was a ragged column
 * of boxes rather than a list you could run your eye down. The name and the
 * badge are the thing being chosen between; the wait is a number, and it goes
 * on the right where numbers go. */
function card(g, href, kind) {
  const badge = g.difficulty
    ? `<span class="badge ${esc(g.difficulty)}">${esc(T("diff_" + g.difficulty))}</span>` : "";
  /* A destination's name is a phrase - "Ente (end-to-end encrypted)", "Any NAS
     (network folder)" - and it takes the whole first line, so its badge goes
     down to share the second row with the wait. A service is one word and
     keeps its badge alongside. Same card, two arrangements, decided by what is
     actually in it rather than by a flag somebody has to remember to set. */
  const dest = kind === "dest";
  return `        <a class="svc${dest ? " svc-wide" : ""}" href="${esc(href)}">
          <span class="svc-ic" data-icon="${esc(g.icon)}"></span>
          <span class="svc-name">${esc(g.provider)}${dest ? "" : badge}</span>
          <span class="svc-meta">${dest ? badge : ""}<span class="svc-time">${
            CLOCK}${esc(shortTime(g.wait_time))}</span></span>
        </a>`;
}

/* The wait, as a phrase rather than a sentence.
 *
 * The guides say things like "up to 7 days (Apple emails you when it is
 * ready)" and "about three days for the account report; chat exports are
 * instant". Both are the right thing to say on the guide itself and both wrap
 * to three lines in a list. The first clause is the answer; the rest is the
 * detail, and the detail is what the page is for. */
function shortTime(raw) {
  let t = String(raw || "").split(/[,;(]/)[0].trim();
  /* Then the trailing clause, whatever joins it on. "an hour of your
     attention" is an hour; "a weekend if you request everything at once" is a
     weekend. The qualification is worth reading - on the guide, which is what
     the guide is for - and is three wrapped lines in a list. */
  const cut = t.replace(/\s+\b(for|depending|if|when|while|but|and|spread|of your)\b.*$/i, "").trim();
  if (cut.length >= 3) t = cut;
  return t || "varies";
}

const CLOCK = '<svg class="ti" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="1.8" stroke-linecap="round" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.2 2"/></svg>';
const ARROW = '<svg viewBox="0 0 20 12" fill="none" stroke="currentColor" stroke-width="1.6" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M1 6h16"/><path d="M12.5 1.5 17 6l-4.5 4.5"/></svg>';

/* A whole job reads differently from a single guide, so it gets its own card:
   what you end up with matters more than how long the request takes. */
function flowCard(f) {
  const conf = confirmation(f);
  return `        <a class="jobcard" href="guides/${esc(f.slug)}.html">
          <span class="jobcard-ic" data-icon="${esc(f.icon || "route")}"></span>
          <span class="jobcard-body">
            <span class="jobcard-t">${esc(f.title)}</span>
            <span class="jobcard-d">${esc(f.outcome)}</span>
          </span>
          <span class="jobcard-foot">
            <span class="jobcard-time">${CLOCK}${esc(shortTime(f.effort))}</span>
            <span class="jobcard-go">${ARROW}</span>
          </span>
        </a>`;
}

const FAQ = [
  ["Does it cost anything?",
   "No. Everything is free: the guides, and every part of the app. Opening an export, merging several, finding duplicates, repairing dates and writing the library back out all run on your own machine, so there is nothing to charge for. There is no paid tier, no account and nothing to buy."],
  ["Do I need an account?",
   "No. There is no sign-up, no email address and no password, because there is no server holding anything to sign in to."],
  ["Are my files uploaded anywhere?",
   "No. Your archives are read inside your browser, on your own machine. The page is served with a Content-Security-Policy whose connect-src is 'self' and nothing else, so the browser itself refuses to send your files anywhere regardless of what the code asks for. Turn off your wifi before you drop the files in and everything still works."],
  ["How long do the exports take to arrive?",
   "It varies enormously. Meta is often minutes to hours, Google hours to days, Apple up to seven days, and Snapchat up to thirty. The waits run in parallel, so if you want several, request them all on the same day."],
  ["Which services can I open an export from?",
   "Apple, Google, Samsung, Snapchat, Facebook and Instagram each have their own guide, and the app reads the zip archives all of them produce. Several exports can be opened together and become one library."],
  ["What do I get back at the end?",
   "Ordinary folders of ordinary files, with the real dates and locations written into the photographs themselves, duplicates across services removed, and your messages, location history and account records readable. Nothing needs this site afterwards."],
];

/* ---------- the four hand-written pages, now generated ---------- */

/* These were four HTML files maintained by hand, which was fine while there
 * was one language. A second language turns each of them into two copies of
 * the same markup, and this repository has a documented history of two copies
 * of one fact drifting apart - it is the reason claims.js exists. So the
 * markup lives once, here, and the words live in the string tables.
 *
 * The bodies are still written as HTML rather than assembled from components,
 * because they are four distinct pages rather than four instances of a
 * template, and pretending otherwise would cost more than it saved.
 */

function notFoundPage(lang, alt, guideCount) {
  const A = (f) => "/" + (lang === "nb" && hasNo(f) ? "no/" + f : f);
  const body = `
    <section class="open-head wrap">
      <h1>${esc(T("nfTitle"))}</h1>
      <p>${esc(T("nfLead"))}</p>
    </section>

    <section class="wrap nf-wrap">
      <!-- The whole card is the link. A heading-sized target inside a card
           that also responds to the pointer is a card that looks clickable
           everywhere and is clickable in one place. -->
      <div class="grid cards">
        <a class="card nf-card" href="${A("app.html")}">
          <h3>${esc(T("open"))}</h3>
          <p class="muted">${esc(T("nfApp"))}</p>
        </a>
        <a class="card nf-card" href="${A("guides.html")}">
          <h3>${esc(T("nfGuidesHead"))}</h3>
          <p class="muted">${esc(T("nfGuides", { count: guideCount }))}</p>
        </a>
        <a class="card nf-card" href="${A("privacy.html")}">
          <h3>${esc(T("nfPrivacyHead"))}</h3>
          <p class="muted">${esc(T("nfPrivacy"))}</p>
        </a>
        <a class="card nf-card" href="https://github.com/SolusKossi/muletto/issues"
           target="_blank" rel="noopener noreferrer">
          <h3>${esc(T("nfBugHead"))}</h3>
          <p class="muted">${esc(T("nfBug"))}</p>
        </a>
      </div>
    </section>`;

  return page({
    depth: "root", lang, alt, noindex: true,
    title: T("nfMetaTitle"),
    description: T("nfMetaDesc"),
    canonical: SITE + (lang === "nb" ? "/no/404.html" : "/404.html"),
    body,
  });
}


function privacyPage(lang, alt) {
  /* Same rule as the chrome: climb out of /no/ first, then go to the
     Norwegian page if there is one and the English page if there is not.
     The first version forgot to climb, so a link to app.html from
     /no/privacy.html asked for /no/app.html, which does not exist. */
  const up = lang === "nb" ? "../" : "";
  const at = (f) => up + (lang === "nb" && hasNo(f) ? "no/" + f : f);
  const cardGrid = (keys) => `      <div class="grid cards">
${keys.map((k) => `        <div class="card">
          <h3>${esc(T(k + "H"))}</h3>
          <p class="muted">${esc(T(k))}</p>
        </div>`).join("\n")}
      </div>`;

  const body = `
    <section class="page-head wrap">
      <h1>${esc(T("pvTitle"))}</h1>
      <p>${esc(T("pvLead"))}</p>
    </section>

    <section class="wrap tight">
      <div class="section-head">
        <h2>${esc(T("pvUploadH"))}</h2>
        <p>${T("pvUpload1", { link: `<a href="#count">${esc(T("pvDescribedBelow"))}</a>` })}</p>
        <p>${T("pvUpload2", { csp: "<code>connect-src</code>", self: "<code>'self'</code>" })}</p>
      </div>
    </section>

    <section class="wrap tight">
      <div class="section-head">
        <h2>${esc(T("pvKeptH"))}</h2>
        <p>${esc(T("pvKeptLead"))}</p>
      </div>
${cardGrid(["pvKept1", "pvKept2", "pvKept3", "pvKept4"])}
    </section>

    <section class="wrap tight">
      <div class="section-head">
        <h2>${esc(T("pvPortableH"))}</h2>
        <p>${esc(T("pvPortable"))}</p>
      </div>
    </section>

    <section class="wrap tight">
      <div class="section-head">
        <h2>${esc(T("pvBackgroundH"))}</h2>
        <p>${esc(T("pvBackground"))}</p>
      </div>

      <div class="section-head">
        <h2 id="count">${esc(T("pvCountH"))}</h2>
        <p>${esc(T("pvCountLead"))}</p>
      </div>
${cardGrid(["pvCount1", "pvCount2", "pvCount3", "pvCount4"])}
      <p><a class="btn primary" href="${at("app.html")}">${esc(T("open"))} ${ARROW}</a></p>
    </section>
`;

  return page({
    /* One level down in Norwegian, because the page is at /no/privacy.html
       and the stylesheet is not. */
    depth: lang === "nb" ? 1 : 0, lang, alt,
    title: T("pvMetaTitle"),
    description: T("pvMetaDesc"),
    canonical: SITE + (lang === "nb" ? "/no/privacy.html" : "/privacy.html"),
    body,
  });
}


/* The opener.
 *
 * Two things about this page are deliberate and easy to undo by accident.
 *
 * It loads no analytics. Every other page counts that it was read; this one
 * does not, so "open the Network tab, use the whole app, see nothing" stays a
 * clean demonstration rather than one with a footnote. That is why the script
 * list is written out here instead of taking the default set.
 *
 * And the order of the scripts is not alphabetical or arbitrary - three of
 * them have to load before something that calls them, and the comments saying
 * so are part of the file rather than decoration.
 */
function appPage(lang, alt, sampleCount, readerCount) {
  const up = lang === "nb" ? "../" : "";
  const at = (f) => up + (lang === "nb" && hasNo(f) ? "no/" + f : f);

  const body = `
    <!-- One thing to do, made the biggest thing on the page.

         This page used to make its privacy argument three times - a red alarm
         box, the last line of the intro, and a numbered list of three long
         paragraphs - while the drop zone, which is the entire point, was the
         fourth element down and the weakest thing on screen. Five bordered
         cards of equal weight is hierarchy for nothing. The order now follows
         the decision somebody is actually making: what this is, do it, not
         ready yet, and only then why you can believe any of it. -->
    <section class="open-head wrap">
      <h1>${esc(T("apTitle"))}</h1>
      <p>${esc(T("apLead", { count: cap(spelledWord(readerCount)) }))}</p>
    </section>

    <section class="wrap open-wrap">
      <div id="resume" hidden></div>
      <!-- Offers to reopen what was kept. Nothing is read until it is clicked. -->
      <div id="restore" hidden></div>
      <!-- What is open now. Above the drop zone, because a result shown below
           the thing that produced it reads as a second, competing offer. -->
      <div id="import-result" class="import-result" hidden></div>

      <div id="drop" class="drop">
        <svg class="drop-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"/>
          <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>
        </svg>
        <p><strong>${esc(T("apDrop"))}</strong><span>${esc(T("apDropAlt"))}</span></p>
        <input id="file" type="file" accept=".zip,.tgz,.tar.gz,.muletto,.json,.gz" multiple hidden />
      </div>
      <p class="drop-fine">${T("apFine", { link: `<a href="#check">${esc(T("apFineLink"))}</a>` })}</p>

      <p class="open-alt">${esc(T("apSamplesLead"))}
        <button class="linkish" id="try-samples">${esc(T("apSamples", { count: spelledWord(sampleCount) }))}</button> -
        ${esc(T("apSamplesTail"))}</p>

      <details class="open-check" id="check">
        <summary>${esc(T("apCheckSummary"))}</summary>
        <ol>
          <li><strong>${esc(T("apCheck1H"))}</strong> ${esc(T("apCheck1"))}</li>
          <li><strong>${esc(T("apCheck2H"))}</strong> ${esc(T("apCheck2"))}</li>
          <li><strong>${esc(T("apCheck3H"))}</strong> ${T("apCheck3", { self: "<code>'self'</code>" })}</li>
        </ol>
        <p class="fine">${T("apCheckFine", {
          link: `<a href="${at("privacy.html")}">${esc(T("apCheckFineLink"))}</a>` })}</p>
      </details>
    </section>
`;

  /* Order matters in three places and the comments say where. */
  const scripts = [
    "notify.js", "tips.js", "jobs.js", "store.js", "derived.js", "donate.js",
    "zipcrypt.js", "zip.js",
    ["tar.js", "Gzipped tar, because Google offers .tgz next to .zip."],
    "zipout.js",
    ["overlay.js", "Puts a Snapchat caption back on the memory it was drawn on."],
    "exif.js", "heif.js", "video.js",
    ["applehealth.js", "Apple Health export.xml, streamed. 161 MB in a real one, so it is\n       never held. Must load before parsers.js, which calls it."],
    "mbox.js", "diagnose.js", "contribute.js", "mojibake.js", "parsers.js",
    "catalog.js", "insights.js", "basemap.js", "rail.js",
    ["charts.js", "Health charts, chosen by what the number means. Must load before\n       topics.js, which asks it to draw."],
    "topics.js", "views.js", "export.js", "explorer.js",
    ["disclose.js", "Every disclosure on the site opens and shuts rather than jumping."],
    "app.js", "swreg.js",
  ];
  const bodyScripts = scripts.map((s) => {
    const [file, note] = Array.isArray(s) ? s : [s, null];
    return (note ? "  <!-- " + note + " -->\n" : "") +
      `  <script src="${up}${file}"></script>`;
  }).join("\n");

  return page({
    depth: lang === "nb" ? 1 : 0, lang, alt,
    title: T("apMetaTitle"),
    description: T("apMetaDesc"),
    canonical: SITE + (lang === "nb" ? "/no/app.html" : "/app.html"),
    body, bodyScripts,
  });
}


/* The home page.
 *
 * The longest of the four and the one whose ordering is an argument rather
 * than a layout: headline, what you get back, the photographs (which are
 * where the real work is), then the seam, then the datasheet for anybody who
 * wants to know exactly what happens to a file before pointing this at their
 * own archive. Keep the order.
 *
 * The service table is data rather than markup, because it is the one part a
 * translation has to reach into cell by cell.
 */
const HOME_TABLE = [
  ["Apple", "tblApple", "tbl7days", "-", "tblAppleParsed"],
  ["Google", "tblGoogle", "tblHoursDays", "tbl1week", "tblGoogleParsed"],
  ["Snapchat", "tblSnap", "tbl30days", "-", "tblSnapParsed"],
  ["Samsung", "tblSamsung", "tblFewDays", "-", "tblSamsungParsed"],
  ["Instagram", "tblMeta", "tblHoursDays", "tbl4days", "tblInstaParsed"],
  ["Facebook", "tblMeta", "tblHoursDays", "tbl4days", "tblFbParsed"],
];

const HOME_GETS = ["gTimeline", "gMessages", "gPlaces", "gPhotos", "gFiles"];
const HOME_FLOW = ["fAsk", "fOpen", "fRead", "fThumbs", "fDupes", "fDates", "fWrite", "fForget"];

function homePage(lang, alt, unmeasured) {
  const up = lang === "nb" ? "../" : "";
  const at = (f) => up + (lang === "nb" && hasNo(f) ? "no/" + f : f);

  const gets = HOME_GETS.map((k) =>
    `          <li><b>${esc(T(k + "H"))}</b><span>${esc(T(k))}</span></li>`).join("\n");

  const flow = HOME_FLOW.map((k) => `          <li>
            <h3>${esc(T(k + "H"))}</h3>
            <p>${T(k)}</p>
            <p class="g-why">${T(k + "Why")}</p>
          </li>`).join("\n");

  const rows = HOME_TABLE.map(([name, how, wait, valid, parsed]) =>
    `              <tr><th scope="row">${esc(name)}</th>` +
    `<td data-label="${esc(T("tblHow"))}" class="m">${esc(T(how))}</td>` +
    `<td data-label="${esc(T("tblWait"))}" class="m">${esc(T(wait))}</td>` +
    `<td data-label="${esc(T("tblValid"))}" class="m">${valid === "-" ? "-" : esc(T(valid))}</td>` +
    `<td data-label="${esc(T("tblParsed"))}">${esc(T(parsed))}</td></tr>`).join("\n");

  const body = `
    <!-- Stays until it is dismissed, and stays dismissed after that. Not a
         cookie banner: it asks for nothing and blocks nothing, it is only the
         one fact a first-time reader most needs and least believes. -->
    <aside class="g-vow" id="g-vow" hidden>
      <p><b>${esc(T("vowBold"))}</b> ${esc(T("vow"))}
        <a href="${at("privacy.html")}">${esc(T("vowLink"))}</a></p>
      <button type="button" id="g-vow-x" aria-label="${esc(T("dismiss"))}">&times;</button>
    </aside>

    <!-- 1. Headline left, the explanation beside it. -->
    <section class="g-top">
      <div class="g-wide">
        <h1>${esc(T("heroA"))} <em>${esc(T("heroB"))}</em></h1>

        <div class="say">
          <p class="lede">${esc(T("lede1"))}</p>
          <p class="lede">${esc(T("lede2"))}</p>

          <div class="cta">
            <a class="g-btn" href="${at("app.html")}">${esc(T("open"))}</a>
            <a class="g-btn line" href="${at("guides.html")}">${esc(T("ctaRequest"))}</a>
            <span class="fine">${esc(T("ctaFine"))}</span>
          </div>
        </div>

      </div>
    </section>

    <!-- 2. What comes back out. Plain list, no widget. -->
    <section class="g-get">
      <div class="g-wide">
        <ul>
${gets}
          <li><b>${esc(T("gFreeH"))}</b><span>${T("gFree", {
            link: `<a class="g-tip" href="https://buymeacoffee.com/muletto" rel="noopener">${esc(T("gFreeLink"))}</a>` })}</span></li>
        </ul>
      </div>
    </section>

    <!-- 3. The photographs, which are where the real work is. -->
    <section class="g-s-lg" style="border-top:1px solid var(--g-line); background:var(--g-paper-2)">
      <div class="g-wide">
        <h2 style="font-size:clamp(26px,3.4vw,40px); max-width:26ch">${esc(T("easyHalfH"))}</h2>
        <p style="margin-top:18px; max-width:60ch; font-size:16.5px; line-height:1.6; color:var(--g-body)">
          ${esc(T("easyHalf"))}</p>

        <div class="g-uniques" style="margin-top:40px">
          <div class="g-unique">
            <h3>${esc(T("uDupesH"))}</h3>
            <div>
              <p>${esc(T("uDupes1"))}</p>
              <p>${esc(T("uDupes2"))}</p>
            </div>
          </div>


          <div class="g-unique">
            <h3>${esc(T("uFilesH"))}</h3>
            <div>
              <p>${esc(T("uFiles1"))}</p>
              <p>${esc(T("uFiles2"))}</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- The seam. A step wedge: six flat tones walking from paper to the
         datasheet's black, the way a printer's calibration strip does. It is
         one idea, it has no texture to be noisy with, and it is not a fade. -->
    <section class="g-seam">
      <div class="g-wide">
        <h2>${esc(T("seamH"))}</h2>
        <p>${esc(T("seam"))}</p>
      </div>
      <div class="g-steps" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>
    </section>

    <!-- 4. Datasheet. Dark and dense. -->
    <section class="g-spec">
      <div class="g-wide g-s-md">
        <h2 style="max-width:22ch">${esc(T("specH"))}</h2>
        <p class="g-lede">${esc(T("spec"))}</p>

        <ol class="g-flow">
${flow}
        </ol>

        <div class="g-tablewrap">
          <table class="g-matrix">
            <caption style="text-align:left; padding:40px 0 14px; font-size:18px; color:#fff">${esc(T("tblCaption"))}</caption>
            <thead>
              <tr>
                <th scope="col">${esc(T("tblService"))}</th>
                <th scope="col">${esc(T("tblHow"))}</th>
                <th scope="col">${esc(T("tblWait"))}</th>
                <th scope="col">${esc(T("tblValid"))}</th>
                <th scope="col">${esc(T("tblParsed"))}</th>
              </tr>
            </thead>
            <tbody>
${rows}
            </tbody>
          </table>
        </div>

        <p class="g-caveat">${T("caveatReaders", {
          list: esc(joinList(unmeasured)),
          link: `<a href="${at("guides.html")}" style="text-decoration:underline">${esc(T("caveatReadersLink"))}</a>` })}</p>

        <p class="g-caveat">${T("caveatLimits", {
          picker: "<code>showDirectoryPicker</code>" })}</p>

        <p style="margin-top:34px; font-size:14px">
          <a href="${at("app.html")}" style="text-decoration:underline">${esc(T("open"))}</a> &nbsp;/&nbsp;
          <a href="${at("privacy.html")}" style="text-decoration:underline">${esc(T("vowLink"))}</a>
          &nbsp;/&nbsp;
        </p>
      </div>
    </section>
`;

  return page({
    depth: lang === "nb" ? 1 : 0, lang, alt,
    title: T("hmMetaTitle"),
    description: T("hmMetaDesc"),
    canonical: SITE + (lang === "nb" ? "/no/index.html" : "/"),
    body,
    extraScript: "vow.js",
    tagline: T("footTagline"),
    /* Restored rather than reinvented: converting the page to the generator
       dropped this block, which is the only structured data saying what the
       thing actually is. The name and the feature list are the same in both
       languages because they name features; the description is translated
       because it is a sentence. */
    jsonld: [{
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "Muletto",
      applicationCategory: "UtilitiesApplication",
      applicationSubCategory: "GDPR data export viewer",
      operatingSystem: "Any modern web browser",
      url: SITE + (lang === "nb" ? "/no/index.html" : "/"),
      inLanguage: lang,
      description: T("hmMetaDesc"),
      featureList: [1, 2, 3, 4, 5, 6].map((i) => T("feat" + i)),
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      isAccessibleForFree: true,
      browserRequirements: T("browserReq"),
    }],
  });
}


function guidesIndex(all, dests, flows, problems) {
  const body = `    <section class="page-head wrap">
      <h1>Guides</h1>
      <p>How to get a complete copy of your data out of any major service, what you will get back, and where to put it afterwards. All free to read, no account.</p>
    </section>

    <section class="wrap gd-wrap">

      <div class="gd-sec">
        <div class="section-head">
          <h2>Whole jobs</h2>
          <p>Start to finish: request it, open it, tidy it up, put it where it is going. Begin here if you know where you want to end up.</p>
        </div>
        <div class="jobgrid">
${(flows || []).map(flowCard).join("\n")}
        </div>
      </div>

      ${(problems || []).length ? `<div class="gd-sec">
        <div class="section-head">
          <h2>When something has gone wrong</h2>
          <p>You already have the export and it will not open, or it opened and the dates are nonsense. The cause, and the fix, including the fix that does not involve us.</p>
        </div>
        <div class="probgrid">
${problems.map((p) => `          <a class="probcard" href="guides/${esc(p.slug)}.html">
            <h3>${esc(p.title)}</h3>
            <p>${esc(p.symptom.length > 150 ? p.symptom.slice(0, 147) + "..." : p.symptom)}</p>
          </a>`).join("\n")}
        </div>
      </div>` : ""}

      <div class="gd-sec">
        <div class="section-head">
          <h2>Getting your data out</h2>
          <p>One service at a time, with what to expect and the parts people get wrong.</p>
        </div>
        <div class="svcgrid">
${all.map((g) => card(g, `guides/${g.slug}.html`, "service")).join("\n")}
        </div>
      </div>

      <div class="gd-sec">
        <div class="section-head">
          <h2>Where to keep it</h2>
          <p>Once your data is cleaned up, put it somewhere you control. These guides cover network drives, external disks, self-hosted servers, and getting a tidied library back into a cloud service.</p>
        </div>
        <div class="svcgrid">
${dests.map((g) => card(g, `guides/${g.slug}.html`, "dest")).join("\n")}
        </div>
      </div>
    </section>

    <section class="wrap tight">
      <div class="section-head">
        <h2>Questions people ask first</h2>
      </div>
      <div class="faq">
${FAQ.map(([q, a]) => `        <details class="faq-item"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}
      </div>
    </section>`;

  return page({
    depth: 0, active: "guides",
    title: "GDPR export guides: request and open your data | Muletto",
    description: "Free step-by-step guides for requesting a complete copy of your data from Apple, Google, Samsung, Snapchat, Facebook and Instagram, plus how to store it on a NAS or external drive.",
    canonical: `${SITE}/guides.html`,
    jsonld: [{
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "Muletto export guides",
      description: "Guides for exporting your personal data from major services.",
      url: `${SITE}/guides.html`,
    }, {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQ.map(([q, a]) => ({
        "@type": "Question", name: q,
        acceptedAnswer: { "@type": "Answer", text: a },
      })),
    }],
    body,
  });
}

/* ---------- workflow guides ---------- */

/* A whole job on one page: request the export, open it, clean it up, put it
   where it is going.

   These exist for two reasons. "How do I move my iCloud photos to my NAS" is a
   higher-intent search than either half of it, because whoever types it has
   already decided to do the work. And the cleanup step - which is what this
   product was originally for - had quietly become a sidebar item nobody would
   find. Here it is step three of something people are already trying to do.

   A flow references the export and destination guides rather than repeating
   them, so a provider that changes its mind is fixed in one place. */
function flowPage(f, all, dests) {
  const from = f.from ? all.find((g) => g.slug === f.from) : null;
  const to = dests.find((g) => g.slug === f.to);
  const canonical = `${SITE}/guides/${f.slug}.html`;
  const conf = confirmation(f);

  const howto = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: f.title,
    description: f.outcome,
    step: [
      from ? { "@type": "HowToStep", position: 1, name: `Request your ${from.provider} export`, text: from.steps[0].detail || "" } : null,
      { "@type": "HowToStep", position: 2, name: "Open it in your browser", text: "Muletto reads the archive on your own machine." },
      { "@type": "HowToStep", position: 3, name: "Clean it up", text: "Remove duplicates and repair the dates." },
      to ? { "@type": "HowToStep", position: 4, name: `Put it on ${to.provider}`, text: to.steps[0].detail || "" } : null,
    ].filter(Boolean),
  };
  const crumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Muletto", item: SITE + "/" },
      { "@type": "ListItem", position: 2, name: "Guides", item: SITE + "/guides.html" },
      { "@type": "ListItem", position: 3, name: f.title, item: canonical },
    ],
  };

  const step = (n, title, body, link) => `
    <section class="flow-step">
      <div class="flow-n">${n}</div>
      <div class="flow-body">
        <h2>${esc(title)}</h2>
        ${body}
        ${link ? `<p><a class="btn secondary" href="${esc(link.href)}">${esc(link.label)} <svg class="arrow" viewBox="0 0 20 12" aria-hidden="true" focusable="false"><path class="a-line" d="M1 6h15"/><path class="a-head" d="M12 1.6 16.4 6 12 10.4"/></svg></a></p>` : ""}
      </div>
    </section>`;

  const body = `    <article class="wrap article flow">
      <nav class="crumbs" aria-label="Breadcrumb">
        <a href="${topHref("index.html")}">${esc(T("home"))}</a><span>/</span>
        <a href="${topHref("guides.html")}">${esc(T("guides"))}</a><span>/</span>
        <span aria-current="page">${esc(f.title)}</span>
      </nav>

      <header class="art-head">
        <h1>${esc(f.title)}</h1>
        <div class="art-meta">
          <span class="muted">Takes ${esc(f.effort)}</span>
        </div>
        <p class="art-intro">${esc(f.outcome)}</p>
      </header>

      <div class="flow-why">
        <h3>Why bother</h3>
        <p>${esc(f.why)}</p>
      </div>

      ${f.watch_out ? `<div class="note flow-warn"><strong>The bit people get wrong.</strong>
        ${esc(f.watch_out)}</div>` : ""}

      ${f.stumbles && f.stumbles.length ? `<section class="flow-stumbles">
        <h3>What actually goes wrong</h3>
        <dl>${f.stumbles.map((s) => `<dt>${esc(s.title)}</dt><dd>${esc(s.detail)}</dd>`).join("")}</dl>
      </section>` : ""}

      ${conf.line ? `<p class="confirmed-line">${esc(conf.line)}</p>` : ""}

      ${step(1,
        from ? `Ask ${from.provider} for your data` : "Ask each service for your data",
        from
          ? `<p>Free, and required by law - but it takes ${esc(from.wait_time)}, so start it now and
             come back. The full guide has the steps and the traps.</p>`
          : `<p>Every service you use, all at once. They run independently and most take days, so
             the sooner they are all requested the sooner you can do the rest in one sitting.</p>`,
        from ? { href: sib(from.slug), label: `The ${from.provider} guide` }
             : { href: topHref("guides.html"), label: T("everyGuide") })}

      ${step(2, "Open it in your browser",
        `<p>Drop the archive into Muletto. It is read on your own machine - nothing is uploaded -
         and you get a timeline, your pictures, your conversations and a map of where you have
         been. Open several exports together and they merge into one library.</p>
         <p class="muted small">Large archives are fine. They are read in pieces rather than
         loaded whole, so size is not the limit it usually is in a browser.</p>`,
        { href: topHref("app.html"), label: T("open") })}

      ${step(3, "Clean it up before you move it",
        `<p>This is the step worth not skipping, because it is far easier now than once the files
         are spread across a disk.</p>
         <ul class="flow-list">
           <li><strong>Duplicates across services.</strong> The same photo backed up to two places
             is one photo. Muletto finds byte-identical copies and near-copies - a burst, a crop, a
             re-save - and you choose what a tidied library keeps.</li>
           <li><strong>Dates that got lost.</strong> Exports routinely strip the capture date, so
             everything looks like it was taken the day you downloaded it. Muletto reads the real
             date back out and writes it into the file itself.</li>
           <li><strong>Places.</strong> Where the coordinates survived, they are written back in
             too, so whatever you import into can put things on a map.</li>
         </ul>`,
        null)}

      ${step(4, to ? `Put it on ${to.provider}` : "Put it somewhere you control",
        `<p>Muletto writes the tidied library straight out - into dated folders on a drive or a
         network share, or as a single archive. You choose the arrangement, and it writes an index
         of everything it wrote.</p>
         ${to ? `<p>The destination guide covers the part that happens at the other end.</p>` : ""}`,
        to ? { href: sib(to.slug), label: `The ${to.provider} guide` } : null)}

      <div class="flow-end">
        <h3>When it is done</h3>
        <p>${esc(f.outcome)}</p>
        ${f.done ? `<p><strong>Check it worked.</strong> ${esc(f.done)}</p>` : ""}
        <p class="muted small">Keep the work file Muletto offers at the end. Export again next
        year and it recognises everything that carried over, so none of this has to be done
        twice.</p>
      </div>
    </article>`;

  return page({
    depth: 1,
    title: `${f.title} | Muletto`,
    description: f.outcome,
    canonical,
    body,
    jsonld: [howto, crumbs],
    active: "guides",
  });
}

/* A page about one thing going wrong.
 *
 * Not a request flow, so it does not get the numbered-step template. The
 * reader here already has the export and something about it has failed; what
 * they want is the cause and the fix, in that order, and they want to know
 * whether the data is recoverable before they read anything else.
 *
 * The manual fix is a full section on purpose, naming other tools where they
 * are the better answer. A page that solves the problem outright is the one
 * that gets linked to and the one that ranks; a page that only says to use us
 * does neither, and would be worse at the job these pages exist to do. */
function problemPage(p, all) {
  const canonical = `${SITE}/guides/${p.slug}.html`;
  const paras = (v) => (Array.isArray(v) ? v : [v]).map((s) => `<p>${esc(s)}</p>`).join("\n        ");

  const article = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: p.title,
    description: p.symptom,
    mainEntityOfPage: canonical,
    author: { "@type": "Organization", name: "Muletto", url: SITE + "/" },
    publisher: { "@type": "Organization", name: "Muletto", url: SITE + "/" },
  };
  const crumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Muletto", item: SITE + "/" },
      { "@type": "ListItem", position: 2, name: "Guides", item: SITE + "/guides.html" },
      { "@type": "ListItem", position: 3, name: p.title, item: canonical },
    ],
  };

  const linkFor = (slug) => {
    const g = all.find((x) => x.slug === slug);
    return g ? { href: sib(slug), label: `The ${g.provider} guide` } : null;
  };

  const body = `    <article class="wrap article problem">
      <nav class="crumbs" aria-label="Breadcrumb">
        <a href="${topHref("index.html")}">${esc(T("home"))}</a><span>/</span>
        <a href="${topHref("guides.html")}">${esc(T("guides"))}</a><span>/</span>
        <span aria-current="page">${esc(p.title)}</span>
      </nav>

      <header class="art-head">
        <h1>${esc(p.title)}</h1>
        <p class="art-intro">${esc(p.symptom)}</p>
      </header>

      <div class="prob-verdict">
        <h2>Can you get it back?</h2>
        <p>${esc(p.recoverable)}</p>
      </div>

      <section class="prob-cause">
        <h2>What actually happened</h2>
        ${paras(p.cause)}
      </section>

      ${p.gotcha ? `<div class="note prob-gotcha">
        <strong>${esc(p.gotcha_title || "The bit people get wrong")}</strong>
        <p>${esc(p.gotcha)}</p>
      </div>` : ""}

      <section class="prob-fix">
        <h2>How to fix it</h2>
        ${p.manual_intro ? `<p>${esc(p.manual_intro)}</p>` : ""}
        <dl>${(p.manual || []).map((m) =>
          `<dt>${esc(m.title)}</dt><dd>${esc(m.detail)}</dd>`).join("")}</dl>
      </section>

      ${p.muletto ? `<section class="prob-ours">
        <h2>How Muletto does it</h2>
        <p>${esc(p.muletto)}</p>
        <p><a class="btn primary" href="${topHref('app.html')}">Open an export <svg class="arrow" viewBox="0 0 20 12" aria-hidden="true" focusable="false"><path class="a-line" d="M1 6h15"/><path class="a-head" d="M12 1.6 16.4 6 12 10.4"/></svg></a></p>
      </section>` : ""}

      ${p.prevent ? `<section class="prob-prevent">
        <h2>Stopping it happening again</h2>
        <p>${esc(p.prevent)}</p>
      </section>` : ""}

      ${p.evidence ? `<p class="confirmed-line">${esc(p.evidence)}</p>` : ""}

      ${(p.related || []).length ? `<section class="prob-related">
        <h3>Related</h3>
        <ul class="flow-list">${(p.related || []).map((slug) => {
          const g = linkFor(slug);
          if (g) return `<li><a href="${esc(g.href)}">${esc(g.label)}</a></li>`;
          return `<li><a href="${esc(sib(slug))}">${esc(slug.replace(/-/g, " "))}</a></li>`;
        }).join("")}</ul>
      </section>` : ""}
    </article>`;

  return page({
    depth: 1,
    title: `${p.title} | Muletto`,
    description: p.symptom.length > 300 ? p.symptom.slice(0, 297) + "..." : p.symptom,
    canonical,
    body,
    jsonld: [article, crumbs],
    active: "guides",
  });
}

/* ---------- status tally ---------- */

/* Generated, never hand-edited: it is derived from the guide files, so it
   cannot drift away from what the site actually claims. Two independent checks
   per guide, plus whatever is still flagged uncertain inside the steps. */
function statusReport(all, dests) {
  const rows = [...all, ...dests];
  const state = (g) => confirmation(g).state;
  const done = rows.filter((g) => state(g) === "full");
  const partial = rows.filter((g) => state(g) === "partial");
  const L = [];

  const table = (list, kind) => {
    if (!list.length) { L.push("_None yet._", ""); return; }
    L.push(`| ${kind} | Request flow walked | Export opened in Muletto | Guide written from evidence |`);
    L.push("| --- | --- | --- | --- |");
    for (const g of list) {
      const c = confirmation(g);
      /* The date, and not who. One person walks these, so a name here only
         put that person's name in a public file. */
      const f = c.flow ? c.flow.on : "no";
      const i = c.import ? c.import.on : "no";
      const w = c.state === "full" ? "yes"
        : c.state === "partial" ? "request steps only" : "no";
      L.push(`| [${g.provider}](apps/web/guides/${g.slug}.json) | ${f} | ${i} | ${w} |`);
    }
    L.push("");
  };

  L.push("# Guide status", "");
  L.push("Generated by `node tools/build-site.js`. Do not hand-edit - change the guide");
  L.push("JSON in `apps/web/guides/` instead.", "");
  L.push("A guide counts as finished only when **both** checks below are done by hand:", "");
  L.push("1. **Request flow walked** - someone went through the provider's export request");
  L.push("   from start to finish and screenshotted every stage.");
  L.push("2. **Export opened in Muletto** - the archive that came back was opened in the");
  L.push("   app, and what the guide promises was checked against what actually turned up.", "");
  L.push("Reading the provider's help pages is not evidence for either. Both of the");
  L.push("Snapchat corrections that mattered - the Export JSON files toggle, and the date");
  L.push("range already defaulting to off - contradicted the documentation.", "");
  L.push(`**${done.length} of ${rows.length} finished.** ${partial.length} part-way.`, "");
  L.push("## Export guides", "");
  table(all, "Provider");
  L.push("## Destination guides", "");
  table(dests, "Destination");

  L.push("## Still to confirm", "");
  const open = [];
  for (const g of rows) {
    g.steps.forEach((st, i) => {
      if (st.uncertain) open.push(`- **${g.provider}**, step ${i + 1} (${st.title}): ${st.uncertain}`);
    });
  }
  L.push(...(open.length ? open : ["_Nothing flagged inline._"]), "");

  return L.join("\n");
}

/* ---------- build ---------- */

function main() {
  const index = readJson(path.join(GUIDES, "index.json"));
  const destIndex = readJson(path.join(GUIDES, "destinations.json"));

  const flowIndex = readJson(path.join(GUIDES, "flows.json"));
  const problemIndex = readJson(path.join(GUIDES, "problems.json"));

  const load = (slug) => readJson(path.join(GUIDES, slug + ".json"));
  const all = index.providers.map((p) => ({ ...p, ...load(p.slug) }));
  const dests = destIndex.destinations.map((d) => ({ ...d, ...load(d.slug) }));
  const flows = flowIndex.flows;
  const problems = problemIndex.problems;

  /* Which guides have a usable Norwegian translation. Worked out before
     anything is written, because both pages need to know: the English one has
     to point at its counterpart and the Norwegian one has to exist. A guide
     that fails either test is simply English-only this build, and the reason
     is printed rather than swallowed - a translation silently dropping out
     because somebody edited the English is the whole failure this guards. */
  const NO_GUIDES = path.join(WEB, "no", "guides");
  const translated = new Map();
  const skipped = [];
  for (const g of [...all, ...dests]) {
    const t = translation(g, GUIDES, "nb");
    if (t.ok) translated.set(g.slug, t.guide);
    else if (t.why !== "no translation yet") skipped.push([g.slug, t.why]);
  }
  if (translated.size) fs.mkdirSync(NO_GUIDES, { recursive: true });
  /* NOTE rather than WARNING, and the difference is deliberate. check.js
     fails the build on anything the build warns about, which is right for a
     sitemap that lost its dates - something is damaged and shipping it makes
     it worse. A translation falling behind damages nothing: the page is not
     written, the tree is a little smaller, and every link to it falls back to
     English on its own. Failing the build for that would mean no English
     guide could be edited until its Norwegian caught up, which would get the
     rule deleted within a week rather than obeyed. It is loud and it does not
     block. */
  for (const [slug, why] of skipped) {
    console.warn("  NOTE: no/guides/" + slug + ".html not built - " + why);
  }

  /* Anything left in the Norwegian tree from a previous build whose
     translation has since gone or gone stale. Left alone it would keep being
     served, and keep being linked from a sitemap, long after the thing it
     was translated from changed. */
  if (fs.existsSync(NO_GUIDES)) {
    for (const f of fs.readdirSync(NO_GUIDES)) {
      if (!f.endsWith(".html")) continue;
      if (translated.has(f.replace(/\.html$/, ""))) continue;
      fs.unlinkSync(path.join(NO_GUIDES, f));
      console.warn("  NOTE: removed no/guides/" + f + " - it has no current translation");
    }
  }

  const altEn = (slug) => translated.has(slug)
    ? { href: "../no/guides/" + slug + ".html",
        loc: `${SITE}/no/guides/${slug}.html`, lang: "nb" } : null;
  const altNb = (slug) => ({ href: "../../guides/" + slug + ".html",
        loc: `${SITE}/guides/${slug}.html`, lang: "en" });

  TRANSLATED = new Set(translated.keys());
  let n = 0, nNo = 0;
  for (const g of [...all, ...dests]) {
    fs.writeFileSync(path.join(GUIDES, g.slug + ".html"),
      guidePage(g, all, dests, "en", altEn(g.slug)), "utf8");
    n++;
    const t = translated.get(g.slug);
    if (t) {
      LANG = "nb";
      fs.writeFileSync(path.join(NO_GUIDES, g.slug + ".html"),
        guidePage(t, all, dests, "nb", altNb(g.slug)), "utf8");
      LANG = "en";
      nNo++;
    }
  }
  for (const f of flows) {
    fs.writeFileSync(path.join(GUIDES, f.slug + ".html"), flowPage(f, all, dests), "utf8");
    n++;
  }
  for (const p of problems) {
    fs.writeFileSync(path.join(GUIDES, p.slug + ".html"), problemPage(p, all), "utf8");
    n++;
  }
  fs.writeFileSync(path.join(WEB, "guides.html"), guidesIndex(all, dests, flows, problems), "utf8");

  /* The pages that used to be hand-written HTML. Each is emitted in English
     always, and in Norwegian when its strings are there - which they are, so
     the pair exists and can declare hreflang. The Norwegian tree gets a 404 of
     its own because a wrong address under /no/ should not throw the reader
     back into English on top of being lost. */
  {
    const NO = path.join(WEB, "no");
    fs.mkdirSync(NO, { recursive: true });
    /* Counted here rather than written into the copy, for the reason the whole
       of claims.js exists: a number in a sentence is a fact that rots. */
    const sampleCount = fs.readdirSync(path.join(WEB, "samples"))
      .filter((f) => f.endsWith(".zip")).length;
    const readerCount = [...all, ...dests]
      .filter((g) => (g.muletto_support || {}).importable).length;
    /* The services with a reader that no real export has ever been run
       through, named on the home page. Taken from PROVIDERS.md, which is
       where that distinction is kept, so the page cannot drift from it. */
    const unmeasured = fs.readFileSync(path.join(ROOT_DIR, "PROVIDERS.md"), "utf8").split(/^## /m).slice(1)
      .filter((sec) => /\*\*Not measured/.test(sec))
      .map((sec) => sec.split(NL)[0].trim().replace(/ \(.*\)$/, "")
        .replace(/ and Google Health$/, ""));
    const pairs = [
      ["404.html", (lang, alt) => notFoundPage(lang, alt, n)],
      ["privacy.html", (lang, alt) => privacyPage(lang, alt)],
      ["app.html", (lang, alt) => appPage(lang, alt, sampleCount, readerCount)],
      ["index.html", (lang, alt) => homePage(lang, alt, unmeasured)],
    ];
    for (const [file, build] of pairs) {
      const enAlt = { href: "/no/" + file, loc: `${SITE}/no/${file}`, lang: "nb" };
      const nbAlt = { href: "/" + file, loc: `${SITE}/${file}`, lang: "en" };
      LANG = "en";
      fs.writeFileSync(path.join(WEB, file), build("en", enAlt), "utf8");
      LANG = "nb";
      fs.writeFileSync(path.join(NO, file), build("nb", nbAlt), "utf8");
      LANG = "en";
    }
  }

  fs.writeFileSync(path.join(__dirname, "..", "GUIDE-STATUS.md"), statusReport(all, dests), "utf8");

  /* The homepage switcher needs the same merged view the static pages were
     built from. Emitting it here keeps the per-guide files the only place
     wait times and difficulty are edited. */
  fs.writeFileSync(path.join(GUIDES, "summary.json"), JSON.stringify({
    providers: all.map((g) => ({
      slug: g.slug, provider: g.provider, icon: g.icon,
      difficulty: g.difficulty, wait_time: g.wait_time,
      typical_size: g.typical_size, contents: g.contents || [],
    })),
  }, null, 2) + "\n", "utf8");

  /* ---------- stamp scripts and stylesheets with their content ----------

     Responses set Cache-Control: public, max-age=3600 on .js and .css, so a
     returning browser keeps whatever it already has for an hour. HTML
     revalidates every time, which is the trap: the page is new and the code
     behind it is not.

     That is not hypothetical. Decryption shipped, the new page loaded, the
     prompt appeared - and the reader typed a password into a version of zip.js
     an hour old that had no idea how to use one. It looked like the feature was
     broken.

     A hash of the file in the query string means the URL changes whenever the
     bytes do, so a stale copy can never be served for a new page. Unchanged
     files keep their URL and stay cached, which is the point of caching. The
     stamp is stripped before it is rewritten, so running the build twice does
     not stack them up. */
  {
    const crypto = require("crypto");
    const stampOf = new Map();
    const stamp = (name) => {
      if (stampOf.has(name)) return stampOf.get(name);
      const f = path.join(WEB, name);
      let v = "";
      if (fs.existsSync(f)) {
        v = crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex").slice(0, 8);
      }
      stampOf.set(name, v);
      return v;
    };

    const htmlUnder = (dir, out = []) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) htmlUnder(full, out);
        else if (e.name.endsWith(".html")) out.push(full);
      }
      return out;
    };

    let stamped = 0;
    for (const f of htmlUnder(WEB)) {
      const before = fs.readFileSync(f, "utf8");
      const dir = path.dirname(f);
      const after = before.replace(
        /(<(?:script|link)[^>]*?(?:src|href)=")([^"]+?\.(?:js|css))(\?v=[a-f0-9]+)?(")/g,
        (all, head, url, _old, tail) => {
          if (/^(https?:)?\/\//.test(url)) return all;          // leave anything remote alone
          const target = path.relative(WEB, path.resolve(dir, url)).split(path.sep).join("/");
          const v = stamp(target);
          return v ? head + url + "?v=" + v + tail : head + url + tail;
        });
      if (after !== before) { fs.writeFileSync(f, after, "utf8"); stamped++; }
    }
    console.log("stamped assets in " + stamped + " page" + (stamped === 1 ? "" : "s"));

    /* The sample archives, stamped into app.js rather than into a page.
     *
     * They are the one asset requested from script rather than named in HTML,
     * so the rewrite above never saw them - and they are also the one asset
     * the service worker deliberately keeps, which made them the only thing
     * on the site that could be served stale indefinitely. One stamp over the
     * whole set: they are rebuilt together and there is no benefit to
     * revalidating them apart.
     *
     * This has to run after the loop above, because changing app.js changes
     * app.js's own stamp - and it is rewritten before the pages are stamped
     * on the next pass, which is why the build is run twice in CI. */
    {
      const dir = path.join(WEB, "samples");
      let v = "";
      if (fs.existsSync(dir)) {
        const h = crypto.createHash("sha256");
        for (const f of fs.readdirSync(dir).sort()) {
          h.update(f).update(fs.readFileSync(path.join(dir, f)));
        }
        v = h.digest("hex").slice(0, 8);
      }
      const appJs = path.join(WEB, "app.js");
      const before = fs.readFileSync(appJs, "utf8");
      const after = before.replace(
        /\/\* BUILD:SAMPLES \*\/[\s\S]*?\/\* END:SAMPLES \*\//,
        "/* BUILD:SAMPLES */\nconst SAMPLES_V = " + JSON.stringify(v) + ";\n/* END:SAMPLES */");
      if (after !== before) {
        fs.writeFileSync(appJs, after, "utf8");
        console.log("samples stamped " + v + " (app.js restamped on the next build)");
      } else {
        console.log("samples stamped " + v);
      }
    }
    /* The commit stamp, into the hand-written pages as well.

       The generated guides get it from footer(), but index.html and app.html
       are written by hand and are the two anybody actually visits - so the
       one page where somebody decides whether to trust this with their files
       was the one page not saying which commit it is. Injected next to the
       source link, and any previous one removed first so that running the
       build twice does not stack them up. */
    if (COMMIT) {
      const OLD = new RegExp('\\s*<a class="foot-commit"[\\s\\S]*?</a>', 'g');
      const SRC = new RegExp('(<a class="foot-src"[\\s\\S]*?</a>)');
      const link = '\n        <a class="foot-commit" href="https://github.com/'
        + 'SolusKossi/muletto/commit/' + COMMIT + '" target="_blank" '
        + 'rel="noopener noreferrer" title="The commit this site was built from">'
        + 'build ' + COMMIT + '</a>';
      let stampedPages = 0;
      for (const f of htmlUnder(WEB)) {
        const before = fs.readFileSync(f, 'utf8');
        if (!before.includes('foot-src')) continue;
        const after = before.replace(OLD, '').replace(SRC, '$1' + link);
        if (after !== before) { fs.writeFileSync(f, after, 'utf8'); stampedPages++; }
      }
      console.log('commit stamp ' + COMMIT + ' in ' + stampedPages + ' page'
        + (stampedPages === 1 ? '' : 's'));
    }



    /* ---------- the offline precache list ----------

       Written from the page that was just stamped, so the worker asks for the
       exact URLs the browser will ask for. Deriving it any other way - a
       hand-kept list, a glob - means the day somebody adds a script the cache
       quietly stops covering the app, and nothing says so until a reader is
       offline and it is too late to tell them.

       Only the app shell. The guides are pleasant to have offline and are not
       what the promise is about, and precaching two dozen pages to make a
       point would be rude on a phone. They cache themselves when visited. */
    {
      const appHtml = fs.readFileSync(path.join(WEB, "app.html"), "utf8");
      const assets = [];
      const re = /<(?:script|link)[^>]*?(?:src|href)="([^"]+?\.(?:js|css)(?:\?v=[a-f0-9]+)?)"/g;
      let m;
      while ((m = re.exec(appHtml))) {
        if (!/^(https?:)?\/\//.test(m[1])) assets.push("/" + m[1].replace(/^\.?\//, ""));
      }

      // The fonts are part of the shell: without them an offline page renders
      // in a fallback face and looks broken rather than offline.
      const fontDir = path.join(WEB, "fonts");
      const fonts = fs.existsSync(fontDir)
        ? fs.readdirSync(fontDir).filter((f) => /\.woff2?$/i.test(f)).map((f) => "/fonts/" + f)
        : [];

      const list = ["/app.html"].concat(assets, fonts);
      const unique = [...new Set(list)];

      /* The cache name has to change whenever any cached thing changes, or an
         old worker serves an old shell forever. Hashing the list itself does
         that: every stamp is in it. */
      const version = crypto.createHash("sha256")
        .update(unique.join("\n")).digest("hex").slice(0, 12);

      const swPath = path.join(WEB, "sw.js");
      const sw = fs.readFileSync(swPath, "utf8");
      const block = "/* BUILD:PRECACHE */\n" +
        "const VERSION = " + JSON.stringify(version) + ";\n" +
        "const PRECACHE = " + JSON.stringify(unique, null, 2) + ";\n" +
        "/* END:PRECACHE */";
      const next = sw.replace(/\/\* BUILD:PRECACHE \*\/[\s\S]*?\/\* END:PRECACHE \*\//, block);
      if (next !== sw) fs.writeFileSync(swPath, next, "utf8");
      console.log("precache: " + unique.length + " files, version " + version);
    }
  }

  // sitemap + robots
  /* Only indexable pages go in the sitemap. Listing a page that carries a
     noindex is a contradiction, and Search Console reports it as one - which
     is why the superseded home page is absent from this list. */
  /* When each page last actually changed.
   *
   * The sitemap had a priority on every entry and a date on none, which is
   * the wrong way round: Google has said for years that it ignores priority,
   * and it does use lastmod as a hint about what is worth re-fetching. A
   * sitemap without dates asks a crawler to re-read thirty-five pages to find
   * the two that moved.
   *
   * Asked of git, not of the file.
   *
   * This first used the file's mtime, which was wrong in the way that matters:
   * every generated page is rewritten on every build whether its content
   * changed or not, so all thirty-five dates moved to today each time the
   * build ran. That is the exact claim lastmod exists to avoid making, and a
   * sitemap that says everything changed today, every day, is a sitemap a
   * crawler learns to ignore.
   *
   * The last commit to touch a file is the honest answer and cannot be moved
   * by rebuilding. One `git log` walk, newest first, so the first time a path
   * appears is its most recent change. A page not yet committed has no date
   * and gets no lastmod, which is better than guessing at one. */
  const when = (() => {
    const seen = new Map();
    /* Asked up to three times. One `git log` decides every lastmod in the
       file, so a single transient failure - git busy immediately after a
       push, most likely - takes the dates off all forty-odd URLs at once.
       That is not hypothetical: it is the failure this function already
       carries a warning about, and it was seen again on 2026-08-28, where
       check.js ran the build, got a stripped sitemap, reported it stale, and
       had already written it to disk. The next run rebuilt it correctly and
       the failure vanished, which is the worst way for a bug to behave. */
    for (let attempt = 0; attempt < 3 && !seen.size; attempt++) {
      try {
        const log = require("child_process").execFileSync(
          "git", ["log", "--pretty=format:%cs", "--name-only", "--", "apps/web"],
          { cwd: path.join(__dirname, ".."), encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
        let date = null;
        for (const line of log.split("\n")) {
          const s = line.trim();
          if (!s) continue;
          if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { date = s; continue; }
          if (date && !seen.has(s)) seen.set(s, date);
        }
      } catch (e) { /* handled below, where the silence is made audible */ }
    }

    /* Nothing from git. Rather than write a sitemap with no dates in it, keep
       the ones the sitemap already on disk is carrying.

       This is right in both cases that reach here. In a tree with no history -
       a staging copy, a downloaded archive - the committed sitemap beside it
       holds dates computed by a build that could see the history, and those
       are the correct answers. After a transient git failure they are the
       correct answers too, minus at most the commit being made right now.
       Either way, keeping them beats dropping forty of them. */
    if (!seen.size) {
      let kept = 0;
      try {
        const old = fs.readFileSync(path.join(__dirname, "..", "apps", "web", "sitemap.xml"), "utf8");
        for (const m of old.matchAll(/<loc>([^<]*)<\/loc>\s*<lastmod>([^<]*)<\/lastmod>/g)) {
          const rel = m[1].replace(/^https?:\/\/[^/]+\//, "");
          seen.set("apps/web/" + (rel || "index.html"), m[2]);
          kept++;
        }
      } catch (e) { /* no sitemap to fall back on either */ }
      console.warn("  WARNING: git gave no history for apps/web after three tries, so " +
        "the sitemap dates could not be recomputed. " +
        (kept ? "Kept the " + kept + " already in the sitemap on disk - they are at most " +
                "one commit out of date. "
              : "There was no sitemap to fall back on, so it has no lastmod dates at all. ") +
        "Do not publish from here without checking.");
    }
    return (rel) => seen.get("apps/web/" + rel) || null;
  })();

  const urls = [
    { loc: `${SITE}/`, pri: "1.0", file: "index.html" },
    { loc: `${SITE}/guides.html`, pri: "0.9", file: "guides.html" },
    { loc: `${SITE}/app.html`, pri: "0.9", file: "app.html" },
    { loc: `${SITE}/privacy.html`, pri: "0.7", file: "privacy.html" },
    ...flows.map((f) => ({ loc: `${SITE}/guides/${f.slug}.html`, pri: "0.85",
                           file: "guides/" + f.slug + ".html" })),
    ...problems.map((p) => ({ loc: `${SITE}/guides/${p.slug}.html`, pri: "0.85",
                              file: "guides/" + p.slug + ".html" })),
    ...[...all, ...dests].map((g) => ({ loc: `${SITE}/guides/${g.slug}.html`, pri: "0.8",
                                        file: "guides/" + g.slug + ".html" })),
  ];
  /* The Norwegian pages, and the alternates pairing them with the English.
     A sitemap is the one place a search engine hears about a page nothing
     links to yet, so a translation missing from here may simply never be
     found. Both directions are listed: hreflang in a sitemap has the same
     reciprocity rule as hreflang in a head, and a one-sided claim is ignored. */
  for (const slug of translated.keys()) {
    urls.push({ loc: `${SITE}/no/guides/${slug}.html`, pri: "0.8",
                file: "no/guides/" + slug + ".html",
                alt: { en: `${SITE}/guides/${slug}.html`,
                       nb: `${SITE}/no/guides/${slug}.html` } });
  }
  for (const u of urls) {
    const m = /\/guides\/([a-z0-9-]+)\.html$/.exec(u.loc);
    if (m && !u.alt && !u.loc.includes("/no/") && translated.has(m[1])) {
      u.alt = { en: u.loc, nb: `${SITE}/no/guides/${m[1]}.html` };
    }
  }

  const xhtmlNs = urls.some((u) => u.alt)
    ? ' xmlns:xhtml="http://www.w3.org/1999/xhtml"' : "";
  fs.writeFileSync(path.join(WEB, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>` + NL +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${xhtmlNs}>` + NL +
    urls.map((u) => {
      const d = when(u.file);
      const alts = u.alt
        ? Object.keys(u.alt).map((k) =>
            `<xhtml:link rel="alternate" hreflang="${k}" href="${u.alt[k]}"/>`).join("") +
          `<xhtml:link rel="alternate" hreflang="x-default" href="${u.alt.en}"/>`
        : "";
      return `  <url><loc>${u.loc}</loc>` + (d ? `<lastmod>${d}</lastmod>` : "") +
        `<priority>${u.pri}</priority>${alts}</url>`;
    }).join(NL) +
    NL + `</urlset>` + NL, "utf8");
  /* Crawling is allowed, and the sitemap is advertised.
   *
   * Worth keeping the reasoning that was here: "Disallow: /" sounds stronger
   * than a noindex and is weaker. A URL nobody may fetch can still be indexed
   * if something links to it, and it turns up with no title and no snippet -
   * and because the page is never fetched, a noindex on it is never seen. To
   * keep a page out, let the crawler have it and answer with a noindex. That
   * is how the superseded home page is handled. */
  fs.writeFileSync(path.join(WEB, "robots.txt"),
    `User-agent: *
Allow: /

Sitemap: ${SITE}/sitemap.xml
`, "utf8");

  /* vercel.json is generated from _headers rather than written beside it.
   *
   * Cloudflare Pages and Netlify read _headers directly; Vercel ignores it and
   * wants JSON. Two hand-maintained copies of a Content-Security-Policy become
   * a promise that differs by host the moment one is edited and the other is
   * forgotten - and that policy exists precisely so the promise is checkable.
   * So _headers is authored and this is derived. */
  const hdrPath = path.join(WEB, "_headers");
  if (fs.existsSync(hdrPath)) {
    const sections = [];
    let current = null;
    for (const line of fs.readFileSync(hdrPath, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      if (line[0] !== " " && line[0] !== "\t") {
        current = { source: trimmed, headers: [] };
        sections.push(current);
        continue;
      }
      const at = trimmed.indexOf(":");
      if (at > 0 && current) {
        current.headers.push({
          key: trimmed.slice(0, at).trim(),
          value: trimmed.slice(at + 1).trim(),
        });
      }
    }
    fs.writeFileSync(path.join(ROOT_DIR, "vercel.json"), JSON.stringify({
      // GENERATED by tools/build-site.js from apps/web/_headers. Do not edit.
      /* The host runs the build rather than serving what was committed, so the
         commit stamp in the footer is written by the deployment that is
         actually live. Without this the pages are whatever was built on
         somebody's laptop, and the stamp - which exists to say which commit is
         running - is silently absent. There are no dependencies to install. */
      buildCommand: "node tools/build-site.js",
      outputDirectory: "apps/web",
      /* Deliberately off. Turning it on makes /guides work, and also makes
         Vercel redirect /guides.html to /guides - which every canonical link,
         og:url and sitemap entry on this site points at. The canonical would
         then name a URL that redirects, which is the one thing a canonical
         must not do. The rewrites below get the same convenience without
         moving the address of anything. */
      cleanUrls: false,
      trailingSlash: false,
      /* Typing the name without .html should find the page.
       *
       * A rewrite rather than a redirect: the file is served under the address
       * that was asked for, the .html URL stays the only one anything points
       * at, and the canonical tag in the page settles which is which for a
       * crawler. /admin is the one that prompted this - it is the address
       * anybody would type, and it was a 404. */
      rewrites: ["admin", "app", "guides", "privacy"].map((n) => ({
        source: "/" + n,
        destination: "/" + n + ".html",
      })),
      headers: sections.map((sec) => ({
        // Netlify and Cloudflare take /* and /*.css; Vercel wants a pattern.
        source: sec.source === "/*" ? "/(.*)"
          : sec.source.startsWith("/*.") ? "/(.*)." + sec.source.slice(3)
          : sec.source,
        /* The noindex lives here rather than in _headers so it cannot be left
           on by accident: it exists only in builds that did not ask to be
           live, and `npm run build:live` removes it by not adding it. Failing
           to rebuild therefore fails safe - the site stays unindexed. */
        headers: sec.headers,
      })),
    }, null, 2) + "\n", "utf8");
  }

  if (MISSING_SHOTS.size) {
    console.log("WARNING: referenced but not in guides/img: " +
      [...MISSING_SHOTS].join(", "));
    console.log("  Put the raw files in screenshots-raw/, then run tools/redact-screenshot.py");
  }
  console.log(`built ${n} guide pages + guides.html + summary.json + sitemap.xml + robots.txt`);
}

main();
