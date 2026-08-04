/* Undo Meta's broken text encoding.
 *
 * Facebook and Instagram serialise JSON by escaping the UTF-8 *bytes* of a
 * string one at a time, rather than escaping the code point. So the file says
 *
 *     "cafe" with the e-acute written as its two raw bytes
 *
 * and a correct JSON parser hands back "cafA(c)" - because C3 and A9 are the
 * two bytes of e-acute, and each has been turned into its own character.
 *
 * The visible symptom is almost always emoji, because three of the four bytes
 * of an emoji land in the C1 control range and render as nothing at all: a
 * smiling face arrives as a single stray character and the rest is invisible.
 * For Norwegian the damage is quieter and worse - every ae, oe and aa in every
 * message comes out wrong, and it reads as a font problem rather than a bug.
 *
 * The repair is to take the characters back to bytes and decode them as what
 * they always were. The hard part is not the repair, it is knowing when not to
 * apply it, because running it over text that was never broken destroys it.
 * Three rules, and all three matter:
 *
 *   - Every character must be under U+0100. A string containing a real emoji
 *     was never mangled, so leave it alone.
 *   - Something must be above U+007F. Pure ASCII cannot have been mangled and
 *     the round trip is a waste.
 *   - The bytes must decode as valid UTF-8, checked strictly. If they do not,
 *     this was ordinary Latin-1 text and it stays as it is.
 *
 * Even then it is a guess: somebody who literally typed "A(c)" gets it turned
 * into an e-acute. That is unavoidable and vanishingly rare next to the number
 * of people whose entire message history is currently unreadable.
 *
 * Only for JSON. The HTML exports are already correct UTF-8, and running this
 * over them corrupts exactly the words it is meant to save. Meta has also
 * started fixing this unevenly - one recent Facebook export was clean while
 * Instagram was not - so the test is per string, never per service.
 */

const MMoji = (function () {
  // fatal: a byte sequence that is not UTF-8 must throw rather than guess.
  const strict = typeof TextDecoder !== "undefined"
    ? new TextDecoder("utf-8", { fatal: true })
    : null;

  function looksMangled(s) {
    let high = false;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c > 0xff) return false;      // a real non-Latin character: untouched
      if (c > 0x7f) high = true;
    }
    return high;
  }

  function repair(s) {
    if (typeof s !== "string" || !s || !strict) return s;
    if (!looksMangled(s)) return s;
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    try {
      return strict.decode(bytes);
    } catch (e) {
      return s;                        // not UTF-8 after all - leave it alone
    }
  }

  /* Keys as well as values. Meta mangles both, and a conversation keyed by a
     broken name is as unreadable as a broken message. */
  function walk(node, depth) {
    if (depth > 24) return node;
    if (typeof node === "string") return repair(node);
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) node[i] = walk(node[i], depth + 1);
      return node;
    }
    if (node && typeof node === "object") {
      for (const k of Object.keys(node)) {
        const fixed = walk(node[k], depth + 1);
        const key = repair(k);
        if (key === k) node[k] = fixed;
        else { delete node[k]; node[key] = fixed; }
      }
      return node;
    }
    return node;
  }

  return { repair, walk: (n) => walk(n, 0), looksMangled };
})();

if (typeof module !== "undefined" && module.exports) module.exports = MMoji;
