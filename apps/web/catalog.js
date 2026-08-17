/* What a service can send, so the app can say what yours did not.
 *
 * An export is a set of answers to questions you did not get to see. Samsung
 * sends one archive per service and simply omits any service that holds
 * nothing for you - there is no empty archive, it just never arrives. So an
 * export with nine archives looks complete, and the reader has no way to tell
 * whether Samsung Health was missing because they never used it, because the
 * watch data lives somewhere else, or because the request was made wrong.
 *
 * This is the list of what exists. Anything matched against the export is
 * shown as found; everything else is shown greyed with the reason it might be
 * absent. The greyed half is the useful half - it is the only thing on screen
 * that can tell somebody they asked for the wrong thing.
 *
 * Every entry carries how well it is known, and that is shown rather than
 * smoothed over:
 *
 *   seen      - observed in a real export, prefix and file names confirmed
 *   published - Samsung documents the service; its archive name is not known
 *   reported  - described consistently by people who have one, not by Samsung
 *
 * Nothing here is inferred quietly. Where the archive name is unknown the
 * entry says so instead of guessing, because a guessed prefix that never
 * matches would show a service as missing when it is sitting right there.
 */

const MCatalog = (function () {
  /* ---------- Samsung ---------- */

  /* Two archives arrive under the same samsungcloud prefix holding completely
     different things, so these are matched on what is inside rather than on
     the name of the file. */
  const SAMSUNG = [
    { key: "health", name: "Samsung Health", conf: "seen",
      holds: "Steps, heart rate, sleep, weight, exercise and goals.",
      inside: /(^|\/)(Heart Rate|Step Count|Sleep|Exercise|Weight|Goal|Food Goal|User Profile|Device Profile|Recommendation)\//i,
      alt: /com\.samsung\.(shealth|health)\./i,
      needs: "Samsung Health used at all. A watch adds far more of it." },

    { key: "cloud", name: "Samsung Cloud sync", conf: "seen",
      holds: "Notes, browser tabs, clipped screenshots and reminders.",
      inside: /(^|\/)(S-Note3?|Pinall|S-Browser Tabs|Samsung Notes|Reminder|Calendar|Contacts)\//i,
      needs: "Samsung Cloud sync switched on for that category." },

    { key: "account", name: "Samsung Account", conf: "seen",
      holds: "Your profile, sign-in history and linked devices.",
      file: /^SamsungAccount/i, needs: null },

    { key: "store", name: "Galaxy Store", conf: "seen",
      holds: "Apps downloaded and bought, reviews you left.",
      file: /^galaxyapps/i, needs: null },

    { key: "penup", name: "PENUP", conf: "seen",
      holds: "Drawings posted and your PENUP profile.",
      file: /^PENUP/i, needs: "The PENUP drawing app having been opened." },

    { key: "find", name: "SmartThings Find", conf: "seen",
      holds: "Where your devices were located, and when.",
      file: /^SmartThingsFind/i, needs: "Find My Mobile switched on." },

    { key: "subs", name: "Subscription Hub", conf: "seen",
      holds: "Subscriptions bought through Samsung.",
      file: /^Subscription Hub/i, needs: "A Samsung subscription." },

    { key: "ans", name: "Support tickets", conf: "seen",
      holds: "Cases you opened with Samsung support.",
      file: /^ANS[_ ]/i, needs: "Having contacted Samsung support.",
      note: "Samsung labels this ANS and does not say what that stands for." },

    { key: "ncdm", name: "NCDM", conf: "seen",
      holds: "Samsung does not document what this is.",
      file: /^NCDM/i, needs: null,
      note: "Sent with a description file in Korean. We have not identified it." },

    /* Real services with no archive name anyone has published. They are listed
       so a reader can see they exist, and told plainly that we cannot spot
       them rather than being shown a tile that will never light up. */
    { key: "members", name: "Samsung Members", conf: "published", unknownName: true,
      holds: "Posts, support requests and diagnostics from the Members app.",
      needs: "The Members app having been used." },
    { key: "internet", name: "Samsung Internet", conf: "published", unknownName: true,
      holds: "Bookmarks, history and saved pages. Open tabs arrive under Cloud sync.",
      needs: "Samsung Cloud sync switched on for the browser." },
    { key: "notes", name: "Samsung Notes", conf: "published", unknownName: true,
      holds: "The modern notes app, separate from the older S Note.",
      needs: "Notes sync switched on." },
    { key: "pass", name: "Samsung Pass", conf: "published", unknownName: true,
      holds: "Sites you saved sign-ins for. Never the passwords themselves.",
      needs: "Samsung Pass set up." },
    { key: "wallet", name: "Samsung Wallet and Pay", conf: "published", unknownName: true,
      holds: "Cards added and payments made through Samsung.",
      needs: "Samsung Pay or Wallet set up." },
    { key: "bixby", name: "Bixby", conf: "published", unknownName: true,
      holds: "Things you asked Bixby to do.",
      needs: "Bixby having been used." },
    { key: "smartthings", name: "SmartThings", conf: "reported", unknownName: true,
      holds: "Your devices, automations, and roughly a week of device history.",
      needs: "SmartThings devices set up.",
      note: "Reported as a separate download inside the SmartThings app." },
    { key: "tvplus", name: "Samsung TV Plus", conf: "published", unknownName: true,
      holds: "What you watched on Samsung TV Plus.",
      needs: "A Samsung TV, or the TV Plus app." },
    { key: "rewards", name: "Samsung Rewards", conf: "published", unknownName: true,
      holds: "Points earned and spent.", needs: "Rewards available in your country." },
    { key: "connectime", name: "ConnecTime", conf: "published", unknownName: true,
      holds: "Video calls between a Samsung TV and a phone.",
      needs: "A 2023 or later Samsung TV." },
    { key: "kids", name: "Samsung Kids", conf: "published", unknownName: true,
      holds: "Which apps a child profile used, and for how long.",
      needs: "Samsung Kids set up." },
    { key: "game", name: "Game Launcher", conf: "published", unknownName: true,
      holds: "Games played and time spent in them.", needs: "Game Launcher used." },
  ];

  /* Samsung Health is the one that grows enormously with a watch, so what is
     in it gets its own list. A phone alone produces a handful of these; a
     watch produces most of them and adds years of depth to each. */
  const HEALTH = [
    { key: "steps", name: "Steps", match: /step[ _]?count|pedometer|step_daily/i,
      needs: null, holds: "Daily step counts." },
    /* Three that Samsung never produced and Google Fit does, so they had no
       matcher until Fit was read. Ordered before the looser kinds below for
       the usual reason: the first match wins, and "Calories (kcal)" would
       otherwise be caught by something vaguer. */
    { key: "calories", name: "Calories", match: /calorie|energy (burned|expended)/i,
      needs: null, holds: "Energy burned, per day." },
    /* Anchored on `^` until a real Apple export showed why that cannot work:
       the health page matches against the path and the name joined together,
       so the haystack starts with a folder and never with the word. The panel
       was simply absent, and the table sat in Highlights instead. Distance is
       a plain enough word to need a health source behind it, so it is one of
       the loose kinds rather than standing on its own. */
    { key: "distance", name: "Distance", match: /\bdistance\b/i,
      needs: null, holds: "How far you moved." },
    /* Heart Points is deliberately not matched here. It is Google's own
       weighted score rather than a count of minutes, and matching it would
       give a second panel identical in title to Move Minutes and different in
       meaning. It stays a table. */
    { key: "active", name: "Active minutes", match: /move minutes|active minutes/i,
      needs: null, holds: "Time spent moving enough to count." },
    /* Apple Health writes these and Samsung does not, so nothing matched them
       until a real Health export was read. Flights climbed already had a
       SHAPE entry and no catalogue kind at all, so it could never have been
       found whoever produced it. */
    { key: "floors", name: "Floors climbed", match: /flights? ?climbed|floors? ?climbed/i,
      needs: null, holds: "Flights of stairs, per day." },
    { key: "walkspeed", name: "Walking speed", match: /walking speed/i,
      needs: "An iPhone carried in a pocket, or a watch.",
      holds: "How fast you walk, averaged over a day." },
    { key: "audio", name: "Headphone volume", match: /headphone audio|audio exposure/i,
      needs: "Headphones paired to the phone.",
      holds: "How loud you listen, and for how long." },
    /* The measurements a phone records about how you walk, plus the two that
       sat homeless in Highlights because nothing named them. A health export
       should be read on the health page in full; anything left over lands in
       a generic list of tables, which is where these six were. */
    { key: "steplength", name: "Step length", match: /step length/i,
      needs: "A phone carried in a pocket, or a watch.",
      holds: "How far you travel per step." },
    { key: "doublesupport", name: "Double support", match: /double support/i,
      needs: "A phone carried in a pocket.",
      holds: "Time with both feet down, as a share of each walk." },
    { key: "asymmetry", name: "Walking asymmetry", match: /asymmetry/i,
      needs: "A phone carried in a pocket.",
      holds: "How evenly your two sides move." },
    { key: "steadiness", name: "Walking steadiness", match: /steadiness/i,
      needs: "A recent iPhone.",
      holds: "Apple's own estimate of how stable your walk is." },
    { key: "restenergy", name: "Resting energy", match: /resting energy|basal energy/i,
      needs: null, holds: "What your body spends before you do anything." },
    /* Anchored, and the haystack starts with a folder - the same trap
       distance fell into. Loose, so it needs a health source behind it. */
    { key: "height", name: "Height", match: /\bheight\b/i,
      needs: null, holds: "Recorded once, usually by hand." },
    { key: "heart", name: "Heart rate", match: /heart[ _]?rate/i,
      needs: "A watch, or an older Galaxy with a sensor on the back.",
      holds: "Every reading taken." },
    /* "Time in bed" is here because a phone without a watch records only that,
       and it is deliberately not called sleep - the phone knows when it was
       put down, not when anybody fell asleep. The series keeps the honest
       name and still lands in the right panel. */
    { key: "sleep", name: "Sleep", match: /\bsleep\b|time in bed/i,
      needs: "A watch or ring worn overnight.",
      holds: "Time asleep, and the stages within it." },
    { key: "exercise", name: "Workouts", match: /exercise|workout/i,
      needs: null, holds: "Each session, with pace, route and heart rate." },
    /* `holds` describes what a kind can contain, which is what the greyed
       list of absent kinds needs. A panel that was actually found should
       describe what is in it instead - two hand-typed weights are not "body
       composition from a smart scale". `holdsIf` is appended only when the
       columns show that data is really there. */
    { key: "weight", name: "Weight", match: /weight|body[ _]?(composition|mass)/i,
      needs: null, holds: "Weight over time.",
      holdsIf: { cols: /fat|muscle|\bbmi\b|body water|bone mass|visceral/i,
                 more: "Body composition from a smart scale." } },
    { key: "stress", name: "Stress", match: /stress/i,
      needs: "A watch or ring.", holds: "Stress readings through the day." },
    { key: "spo2", name: "Blood oxygen", match: /oxygen|spo2/i,
      needs: "A watch.", holds: "Blood oxygen readings." },
    { key: "hrv", name: "Heart rate variability", match: /\bhrv\b|variability/i,
      needs: "A watch or ring.", holds: "The measure most sleep and recovery scores rest on." },
    { key: "ecg", name: "ECG", match: /\becg\b|electrocardio/i,
      needs: "A Galaxy Watch 4 or newer.", holds: "Recorded traces." },
    { key: "bp", name: "Blood pressure", match: /blood[ _]?pressure/i,
      needs: "A cuff, or manual entry.", holds: "Readings over time." },
    { key: "temp", name: "Skin temperature", match: /skin[ _]?temp|temperature/i,
      needs: "A Galaxy Watch 5 or newer, or a Ring.", holds: "Overnight temperature." },
    { key: "resp", name: "Breathing rate", match: /respirat|breathing/i,
      needs: "A watch or ring.", holds: "Breaths per minute while asleep." },
    { key: "floors", name: "Floors climbed", match: /floor/i,
      needs: null, holds: "Flights of stairs." },
    { key: "food", name: "Food and nutrition", match: /food|nutrition|caloric/i,
      needs: "Meals logged by hand.", holds: "What was logged, and its calories." },
    { key: "water", name: "Water and caffeine", match: /water|caffeine/i,
      needs: "Logged by hand.", holds: "Glasses and cups counted." },
    { key: "rewards", name: "Badges and records", match: /reward|best_record|milestone|trophy/i,
      needs: null, holds: "Streaks, personal bests and awards." },
    { key: "together", name: "Challenges and friends", match: /social|challenge|leaderboard|friends/i,
      needs: "Samsung Health Together used.", holds: "Challenges entered, and who with." },
  ];

  const PROVIDERS = {
    samsung: { label: "Samsung", services: SAMSUNG, groups: [
      { key: "health", title: "Inside Samsung Health", items: HEALTH,
        blurb: "A phone records a little of this. A watch records most of it, every day." },
    ] },
  };

  /* Which of a provider's services this export actually contains.

     Matched on the archive names and on the paths inside them, because the two
     samsungcloud archives are told apart only by what they hold. */
  function coverage(slug, archiveNames, entryPaths, tableNames) {
    const p = PROVIDERS[slug];
    if (!p) return null;
    const names = archiveNames || [];
    const paths = entryPaths || [];
    const tables = tableNames || [];

    const hit = (svc) => {
      if (svc.file && names.some((n) => svc.file.test(n))) return true;
      if (svc.inside && paths.some((x) => svc.inside.test(x))) return true;
      if (svc.alt && paths.some((x) => svc.alt.test(x))) return true;
      return false;
    };

    const found = [], absent = [];
    for (const svc of p.services) (hit(svc) ? found : absent).push(svc);

    const groups = (p.groups || []).map((g) => {
      const parent = p.services.find((x) => x.key === g.key);
      const on = parent && found.indexOf(parent) >= 0;
      const items = g.items.map((it) => ({
        ...it,
        found: on && (paths.some((x) => it.match.test(x)) || tables.some((x) => it.match.test(x))),
      }));
      return { ...g, active: !!on, items };
    });

    return { label: p.label, found, absent, groups };
  }

  return { coverage, PROVIDERS, SAMSUNG, HEALTH };
})();

if (typeof module !== "undefined" && module.exports) module.exports = MCatalog;
