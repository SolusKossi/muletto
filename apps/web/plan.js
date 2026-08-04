"use strict";

/* Muletto - saying what you want done, in a sentence.

   "Keep folders of people and post-it notes, delete all screenshots, put the
   rest in a separate folder." That is how someone actually thinks about their
   library, and until now the only way to express it was by clicking through
   twelve thousand photos.

   The design rule that shapes everything here: **the model writes rules, it
   does not touch photos.**

   One text call turns the sentence into a short list of matchers. Those
   matchers then run locally, in plain JavaScript, over descriptions and
   filenames that already exist - so the interpretation costs a fraction of a
   penny once, no photo is re-read, and nothing is charged per picture.

   That split is not just about cost. A model that acts directly is a model
   whose mistakes you find afterwards. A model that produces rules can be shown
   its work first: every bucket has a count, a sample, and the exact matcher
   that caught each file. You approve a plan, not a hope.

   And "delete" never deletes. It means left out of the copy you export. The
   original archives are read-only here and always have been. */

const MPlan = (function () {
  /* The only vocabulary the model is allowed. A tiny closed set keeps the plan
     inspectable and keeps evaluation deterministic - anything the model invents
     outside this is dropped when the plan is validated, rather than silently
     matching nothing. */
  const FIELDS = ["caption", "name", "source", "kind"];

  const PROMPT = [
    "Turn the user's instruction about their photo library into a sorting plan.",
    "",
    "Reply with JSON only, in this exact shape:",
    '{"buckets":[{"name":"People","action":"keep","folder":"People",',
    '  "match":{"field":"caption","any":["person","people","portrait","face"]}}]}',
    "",
    "Rules:",
    '- "action" is either "keep" or "drop". Use "drop" only when the user clearly',
    "  says to remove, delete or get rid of something.",
    '- "field" is one of: caption, name, source, kind.',
    '  caption = a sentence describing what is in the picture.',
    "  name = the filename. source = which service it came from.",
    '  kind = either "photo" or "video".',
    '- "any" is a list of lowercase words or short phrases. A file matches if any',
    "  of them appear. Give several synonyms per bucket, not one.",
    '- The LAST bucket must be a catch-all: {"field":"rest"}. Give it the folder',
    "  the user asked for, or omit folder to leave those files where they are.",
    "- Buckets are tested in order and the first match wins, so put specific",
    "  buckets before general ones.",
    "- Use between two and six buckets. Name them the way the user did.",
    "",
    "No explanation, no markdown fence, JSON only.",
  ].join("\n");

  /* ---------- asking ---------- */

  async function endpoint() {
    if (typeof MCredits !== "undefined") {
      const hosted = await MCredits.endpoint();
      if (hosted) return hosted;
    }
    if (typeof MCaption !== "undefined") {
      const own = await MCaption.settings();
      if (own && own.url && own.model) return own;
    }
    return null;
  }

  const capField = (model) =>
    /^(gpt-5|o[134])/i.test(String(model || "")) ? "max_completion_tokens" : "max_tokens";

  async function ask(instruction, cfg) {
    const headers = { "Content-Type": "application/json" };
    if (cfg.key) headers.Authorization = "Bearer " + cfg.key;
    const body = {
      model: cfg.model,
      messages: [
        { role: "system", content: PROMPT },
        { role: "user", content: String(instruction).slice(0, 600) },
      ],
    };
    body[capField(cfg.model)] = 700;

    const res = await fetch(cfg.url, { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(res.status + " from the endpoint" + (text ? ": " + text.slice(0, 160) : ""));
    }
    const data = await res.json();
    const out = data && data.choices && data.choices[0] &&
      data.choices[0].message && data.choices[0].message.content;
    if (!out) throw new Error("The endpoint replied with nothing.");
    return out;
  }

  /* Models fence JSON in markdown about a third of the time whatever the
     instruction says, and sometimes add a sentence before it. Rather than
     insist, take the first balanced object in the reply. */
  function extractJson(text) {
    const s = String(text);
    const start = s.indexOf("{");
    if (start < 0) throw new Error("The endpoint did not return a plan.");
    let depth = 0;
    for (let i = start; i < s.length; i++) {
      if (s[i] === "{") depth++;
      else if (s[i] === "}" && --depth === 0) {
        try { return JSON.parse(s.slice(start, i + 1)); }
        catch (e) { throw new Error("The plan came back malformed."); }
      }
    }
    throw new Error("The plan came back truncated.");
  }

  /* Anything the model invented outside the vocabulary is discarded here, so a
     bad reply becomes a smaller plan rather than a rule that silently matches
     nothing or, worse, everything. */
  function validate(raw) {
    const list = (raw && Array.isArray(raw.buckets)) ? raw.buckets : [];
    const out = [];
    for (const b of list) {
      const m = b && b.match ? b.match : {};
      const rest = m.field === "rest";
      const field = FIELDS.indexOf(m.field) >= 0 ? m.field : null;
      const any = Array.isArray(m.any)
        ? m.any.map((t) => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 24)
        : [];
      if (!rest && (!field || !any.length)) continue;
      out.push({
        name: String((b && b.name) || (rest ? "Everything else" : "Bucket")).slice(0, 40),
        action: b && b.action === "drop" ? "drop" : "keep",
        folder: b && b.folder ? String(b.folder).replace(/[^\w \-]/g, "").trim().slice(0, 40) : "",
        rest,
        field,
        any,
      });
      if (out.length >= 8) break;
    }
    if (!out.length) throw new Error("That did not produce any usable rules. Try wording it differently.");
    /* Exactly one catch-all, at the end. Without it some files belong to no
       bucket and it is not obvious what happens to them. */
    const rests = out.filter((b) => b.rest);
    const rules = out.filter((b) => !b.rest);
    rules.push(rests[0] || { name: "Everything else", action: "keep", folder: "", rest: true, field: null, any: [] });
    return rules;
  }

  /* ---------- matching, locally ---------- */

  function haystack(m, field) {
    if (field === "caption") return String(m.caption || "").toLowerCase();
    if (field === "name") return String(m.name || m.path || "").toLowerCase();
    if (field === "source") return String(m.srcLabel || "").toLowerCase();
    if (field === "kind") return m.kind === "video" ? "video" : "photo";
    return "";
  }

  const hits = (m, b) => b.rest || b.any.some((t) => haystack(m, b.field).includes(t));

  /* Which bucket each file lands in, with nothing changed yet. This is the
     whole point: a plan is a proposal until someone approves it. */
  function preview(rules, media) {
    const buckets = rules.map((b) => ({ rule: b, items: [] }));
    for (const m of media) {
      for (let i = 0; i < rules.length; i++) {
        if (hits(m, rules[i])) { buckets[i].items.push(m); break; }
      }
    }
    const dropping = buckets.filter((b) => b.rule.action === "drop")
      .reduce((n, b) => n + b.items.length, 0);
    return {
      buckets,
      total: media.length,
      dropping,
      keeping: media.length - dropping,
      bytesDropped: buckets.filter((b) => b.rule.action === "drop")
        .reduce((n, b) => n + b.items.reduce((x, m) => x + (m.size || 0), 0), 0),
      /* A plan that removes most of a library is more likely to be a misread
         word than an intention, so the panel can say so before it is applied. */
      severe: media.length > 0 && dropping / media.length > 0.5,
      /* Matching on descriptions needs descriptions. Without them the only
         signal is the filename, and the reader should know that up front. */
      captioned: media.filter((m) => m.caption).length,
    };
  }

  /* ---------- applying, reversibly ---------- */

  function apply(view) {
    const before = view.buckets.flatMap((b) =>
      b.items.map((m) => ({ m, drop: !!m.drop, bucket: m.bucket || "" })));
    for (const b of view.buckets) {
      for (const m of b.items) {
        m.drop = b.rule.action === "drop";
        if (b.rule.folder) m.bucket = b.rule.folder;
        else delete m.bucket;
      }
    }
    return before;                 // hand back to revert()
  }

  function revert(before) {
    for (const s of before || []) {
      s.drop ? (s.m.drop = true) : delete s.m.drop;
      s.bucket ? (s.m.bucket = s.bucket) : delete s.m.bucket;
    }
  }

  /* One sentence per rule, in the reader's terms rather than the schema's. The
     plan has to be legible to someone who will not read JSON. */
  function describe(b) {
    const verb = b.action === "drop" ? "Leave out" : "Keep";
    const where = b.action === "drop" ? ""
      : b.folder ? ' in a folder called "' + b.folder + '"' : " where they are";
    if (b.rest) return verb + " everything else" + where + ".";
    const what = {
      caption: "described as",
      name: "whose filename contains",
      source: "from",
      kind: "that are",
    }[b.field] || "matching";
    const list = b.any.slice(0, 6).map((t) => '"' + t + '"').join(", ") +
      (b.any.length > 6 ? " and " + (b.any.length - 6) + " more" : "");
    return verb + " anything " + what + " " + list + where + ".";
  }

  async function interpret(instruction) {
    const cfg = await endpoint();
    if (!cfg) throw new Error("no-endpoint");
    return validate(extractJson(await ask(instruction, cfg)));
  }

  return { interpret, validate, preview, apply, revert, describe, endpoint, PROMPT };
})();
