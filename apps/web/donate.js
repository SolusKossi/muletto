"use strict";

/* Muletto - the ask, once, after the work is done.

   The rules here are all about restraint rather than
   conversion:

   **After the win, never before.** The moment is when an export has finished
   and the files are on their disk, dated and de-duplicated. Anything in front
   of a feature is a gate with a door in it and reads as one.

   **Once per library, and remember the answer.** A second ask is a nag, and a
   nag from a privacy product costs more than it earns.

   **Anchored amounts.** An empty box mostly returns nothing, because it hands
   the reader a decision with no reference point. Presets are less work for
   them, not more pressure.

   **Nothing in return.** No badge, no bonus credits. The honest version is
   stronger: this is free either way, and if it was worth something you can say
   so.

   **It hides itself when it cannot work.** With no LINK set there is nowhere
   for the money to go, and a button that does nothing is worse than no button.
   The copy on pricing.html is written to match, so nothing promises a route
   that is not there. */

const MDonate = (function () {
  /* ---------------------------------------------------------------------
     Set LINK to wherever donations should go - a Stripe payment link, Ko-fi,
     GitHub Sponsors, Liberapay. Anything that takes a hosted checkout.

     Empty means the ask never appears. That is the correct behaviour until
     there is somewhere for it to point.

     If the destination can take an amount in the URL, put {amount} in it and
     it is substituted with whole currency units:
       "https://donate.stripe.com/xxx?__prefilled_amount={amount}"
     --------------------------------------------------------------------- */
  /* Buy Me a Coffee. Its links take no prefilled amount, so {amount} is
     absent here and the reader picks on their page instead - which is why
     the figures above are an anchor rather than a promise.

     If the page slug changes again, this and the line on the home page are
     the two places that name it. */
  const LINK = "https://buymeacoffee.com/muletto";

  const AMOUNTS = [3, 8, 20];
  const TYPICAL = 8;                    // shown as the usual figure
  const CURRENCY = "$";
  const KEY = "donate:asked";

  const live = () => !!LINK;

  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  /* Asked once, ever, on this machine. Deliberately not per library: someone
     who opens a second export next month has already been asked, and asking
     again because the library changed is exactly the nag the rule forbids. */
  async function asked() {
    if (typeof MDerived === "undefined") return true;
    return !!(await MDerived.setting(KEY));
  }

  async function remember(answer) {
    if (typeof MDerived === "undefined") return;
    await MDerived.setting(KEY, { at: new Date().toISOString(), answer });
  }

  async function shouldAsk() {
    return live() && !(await asked());
  }

  function html() {
    return '<section class="dn" id="dn">' +
      "<h3>That is everything, and it was free.</h3>" +
      "<p>No account, no licence, nothing held back, and none of it was uploaded. " +
      "If it turned out to be worth something to you, you can say so. Most people " +
      "who do give " + esc(CURRENCY + TYPICAL) + ".</p>" +
      '<div class="dn-row">' +
        AMOUNTS.map((a) =>
          '<button class="btn secondary dn-amt" data-amt="' + a + '">' +
          esc(CURRENCY + a) + "</button>").join("") +
        '<button class="btn ghost dn-no" id="dn-no">No thanks</button>' +
      "</div>" +
      '<p class="dn-fine">Nothing changes either way, and you will not be asked again.</p>' +
    "</section>";
  }

  /* Called with the container the summary was drawn into. Returns nothing; the
     panel removes itself once answered. */
  function wire(root) {
    const box = root.querySelector("#dn");
    if (!box) return;

    box.querySelectorAll(".dn-amt").forEach((b) => {
      b.addEventListener("click", async () => {
        const amt = Number(b.dataset.amt);
        await remember(amt);
        // Opened rather than navigated, so a half-finished export summary is
        // not thrown away by leaving the page.
        window.open(LINK.replace("{amount}", String(amt)), "_blank", "noopener");
        box.innerHTML = "<h3>Thank you.</h3><p>That is genuinely appreciated.</p>";
      });
    });

    const no = box.querySelector("#dn-no");
    if (no) {
      no.addEventListener("click", async () => {
        await remember(false);
        box.remove();
      });
    }
  }

  return { live, shouldAsk, html, wire, asked };
})();
