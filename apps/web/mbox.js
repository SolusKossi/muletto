"use strict";

/* Muletto - Gmail mailbox (MBOX) indexing.

   A Takeout mailbox is commonly tens of gigabytes, so it is never loaded whole.
   MBOX is a plain concatenation of messages, each starting at a line beginning
   "From " (with a space, which is what distinguishes it from the "From:" header).
   We stream the entry, keep only the headers of each message, and skip the
   bodies - which is where essentially all the bulk lives.

   The result is a searchable index of who, what and when. Bodies and
   attachments are deliberately not retained. */

const MMbox = (function () {
  const SEPARATOR = /^From \S+/;
  const WANTED = ["from", "to", "subject", "date", "cc"];

  // Headers may be RFC 2047 encoded ("=?UTF-8?B?...?="). Decode the common cases.
  function decodeWord(s) {
    return s.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (m, charset, enc, data) => {
      try {
        let bytes;
        if (enc.toLowerCase() === "b") {
          const bin = atob(data.replace(/\s/g, ""));
          bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
        } else {
          const fixed = data.replace(/_/g, " ");
          const out = [];
          for (let i = 0; i < fixed.length; i++) {
            if (fixed[i] === "=" && i + 2 < fixed.length) {
              out.push(parseInt(fixed.substr(i + 1, 2), 16)); i += 2;
            } else out.push(fixed.charCodeAt(i));
          }
          bytes = Uint8Array.from(out);
        }
        return new TextDecoder(charset.toLowerCase().startsWith("utf") ? "utf-8" : "windows-1252")
          .decode(bytes);
      } catch { return m; }
    });
  }

  const addressName = (v) => {
    const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>/.exec(v);
    if (m) return { name: decodeWord(m[1]).trim() || m[2].trim(), address: m[2].trim() };
    return { name: v.trim(), address: v.trim() };
  };

  /* Index a mailbox from a byte stream. onProgress(bytesRead, messagesFound). */
  async function index(stream, { limit = 50000, onProgress = null } = {}) {
    const reader = stream.getReader();
    const dec = new TextDecoder("utf-8", { fatal: false });
    let carry = "";           // partial line held between chunks
    let read = 0, count = 0, skipped = 0;
    let inHeaders = false;
    let current = null, lastKey = null;
    const messages = [];

    const finish = () => {
      if (!current) return;
      if (messages.length < limit) messages.push(current);
      else skipped++;
      current = null;
    };

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      read += value.length;
      const text = carry + dec.decode(value, { stream: true });
      const lines = text.split("\n");
      carry = lines.pop();     // last piece may be incomplete

      for (const raw of lines) {
        const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;

        if (SEPARATOR.test(line)) {
          finish();
          current = { from: null, to: null, subject: "", at: null, cc: null };
          inHeaders = true; lastKey = null;
          continue;
        }
        if (!current || !inHeaders) continue;
        if (line === "") { inHeaders = false; continue; }   // headers end at a blank line

        if (/^[ \t]/.test(line) && lastKey) {               // folded continuation
          if (lastKey === "subject") current.subject += " " + line.trim();
          continue;
        }
        const c = line.indexOf(":");
        if (c < 1) continue;
        const key = line.slice(0, c).toLowerCase();
        if (!WANTED.includes(key)) { lastKey = null; continue; }
        lastKey = key;
        const val = line.slice(c + 1).trim();
        if (key === "subject") current.subject = decodeWord(val);
        else if (key === "from") current.from = addressName(decodeWord(val));
        else if (key === "to") current.to = decodeWord(val);
        else if (key === "cc") current.cc = decodeWord(val);
        else if (key === "date") {
          const d = new Date(val);
          current.at = isNaN(d) ? null : d;
        }
      }
      count = messages.length;
      if (onProgress) onProgress(read, count);
    }
    finish();
    return { messages, skipped, bytesRead: read };
  }

  /* Turn an index into the shapes the viewer already knows how to display. */
  function summarise(result) {
    const bySender = new Map();
    const events = [];
    for (const m of result.messages) {
      const who = m.from ? m.from.name : "Unknown";
      const e = bySender.get(who) || { name: who, address: m.from ? m.from.address : "", count: 0 };
      e.count++; bySender.set(who, e);
      if (m.at) events.push({ at: m.at, kind: "email", label: m.subject || "(no subject)" });
    }
    const senders = [...bySender.values()].sort((a, b) => b.count - a.count);
    return { senders, events };
  }

  return { index, summarise };
})();
