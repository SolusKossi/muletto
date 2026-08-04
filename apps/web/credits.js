"use strict";

/* Muletto - credits, for people who do not want to run a model.

   Tagging photos is the one thing here that costs money per use, and until now
   the only way to do it was to install Ollama or hold an OpenAI key. That is a
   fine route for someone who already knows what an endpoint is, and a wall for
   everyone else. Most people who want their photos searchable are not going to
   create an API account to get there.

   So there is a hosted route: buy credits, press the button, done. One credit
   describes one photo.

   Three rules, because this is the only part of Muletto where anything leaves
   the machine and the whole product rests on that being true elsewhere.

   **The picture is the only thing sent.** Not the archive, not the file list,
   not the dates, not the messages. One downscaled JPEG per credit, and only
   for the photos in the run you started.

   **The server is authoritative about the balance.** The number kept here is a
   display copy, so the panel can show something before the network answers.
   Anything that decides whether work happens is decided server-side, because a
   balance a client can edit is not a balance.

   **No account for the free path.** A credit token is not a login. Nothing
   about opening an export, comparing photos, repairing dates or exporting ever
   requires one, and none of that changes because someone bought credits. */

const MCredits = (function () {
  /* ---------------------------------------------------------------------
     SERVICE CONFIGURATION - NOT LIVE YET.

     `base` is empty because the credit service does not exist. Everything
     below is wired and waiting for it; with an empty base the UI says so
     plainly rather than pretending to sell something.

     When it exists, set `base` and the rest works: the run path already
     speaks this protocol. The endpoints it expects are documented at the
     bottom of this file.

     Two dollars per thousand photographs, with a two dollar floor.
     --------------------------------------------------------------------- */
  const SERVICE = {
    base: "",

    /* One published price per photo, and you buy the number you actually
       have. Tiers make the reader guess which box their library falls in,
       and then sell them the next one up - which is a small dishonesty for
       no benefit when the cost per photo is this predictable. It is
       predictable because we control it: every image is downscaled to the
       same width and the reply is capped, so one photo is one photo. */
    perPhoto: 0.002,

    /* The one place the exact price cannot be charged.

       Card processing takes roughly 30 cents plus 2.9% of anything, whatever
       the amount. Billing a 200-photo run at its true cost would hand more to
       the processor than to us, and paying 30 cents to move 8 cents is not a
       business, it is a rounding error with a receipt. So there is a floor,
       it is stated on the screen with the reason attached, and anything the
       reader does not use stays theirs as credit rather than being kept. */
    minCharge: 2,
    currency: "$",
  };

  const KEY = "credits:account";

  const live = () => !!SERVICE.base;

  async function account() {
    if (typeof MDerived === "undefined") return null;
    return (await MDerived.setting(KEY)) || null;
  }

  async function saveAccount(a) {
    if (typeof MDerived === "undefined") return;
    await MDerived.setting(KEY, a);
  }

  /* The balance as far as this machine knows. Shown immediately so the panel
     is not blank while the network answers; replaced by refresh() when it
     does. Never trusted for anything that spends. */
  async function known() {
    const a = await account();
    return a && isFinite(a.balance) ? a.balance : 0;
  }

  async function refresh() {
    const a = await account();
    if (!live() || !a || !a.token) return a ? a.balance || 0 : 0;
    const res = await fetch(SERVICE.base + "/balance", {
      headers: { Authorization: "Bearer " + a.token },
    });
    if (!res.ok) throw new Error("Could not check your balance (" + res.status + ").");
    const data = await res.json();
    a.balance = data.credits;
    await saveAccount(a);
    return a.balance;
  }

  /* One credit, one photo. Deliberately not a token count: nobody can
     estimate a run in tokens, and a unit the reader cannot predict is a unit
     they cannot consent to. */
  const costOf = (photos) => photos;

  const money = (n) => SERVICE.currency + n.toFixed(2);

  /* What a given number of photos costs, and what will actually be charged.

     These differ only when the run is below the floor, and when they do the
     panel says so rather than quietly rounding up. The extra is not a fee -
     it is credit, it is spendable, and it does not expire. */
  function quote(photos) {
    const n = Math.max(0, Math.floor(photos || 0));
    // Zero photos is zero money. Without this the floor applies to nothing at
    // all, and the "buy a different number" field would happily charge the
    // minimum for a quantity of none.
    if (!n) {
      return { photos: 0, exact: 0, charge: 0, credits: 0, extra: 0, atFloor: false,
        money: money(0), exactMoney: money(0), perPhoto: SERVICE.perPhoto,
        minCharge: money(SERVICE.minCharge) };
    }
    const raw = Math.ceil(n * SERVICE.perPhoto * 100) / 100;
    const charge = Math.max(SERVICE.minCharge, raw);

    /* What that charge is worth. Two traps here, and both take credits off
       someone who has paid for them.

       The charge was rounded up to whole cents, so dividing it back by a
       fractional price lands just under an integer - 3.80 / 0.002 is
       1899.9999999999998, and flooring that sells 1,900 photos and delivers
       1,899. The epsilon absorbs that.

       The floor is the guarantee that matters regardless: nobody who paid for
       n photos gets fewer than n, whatever the arithmetic does. */
    const credits = Math.max(n, Math.floor(charge / SERVICE.perPhoto + 1e-6));
    return {
      photos: n,
      exact: raw,
      charge,
      credits,
      extra: Math.max(0, credits - n),
      atFloor: charge > raw,
      money: money(charge),
      exactMoney: money(raw),
      perPhoto: SERVICE.perPhoto,
      minCharge: money(SERVICE.minCharge),
    };
  }

  /* A per-photo price is a fraction of a penny, and two decimal places turn
     that into "$0.00 each" - which reads as free and is worse than saying
     nothing. Below a penny it is quoted per thousand photos instead, which is
     the same number in a unit a person can hold. */
  function unitLabel() {
    if (SERVICE.perPhoto >= 0.01) return money(SERVICE.perPhoto) + " a photo";
    return money(SERVICE.perPhoto * 1000) + " per 1,000 photos";
  }

  const price = () => ({
    perPhoto: SERVICE.perPhoto, minCharge: SERVICE.minCharge, money, unitLabel,
  });

  /* Buying happens on the service's own checkout page, not in here. Muletto
     never sees a card number, and there is no form in this app that asks for
     one. */
  async function checkoutUrl(credits) {
    if (!live()) throw new Error("not-open");
    const a = (await account()) || {};
    const res = await fetch(SERVICE.base + "/checkout", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" },
        a.token ? { Authorization: "Bearer " + a.token } : {}),
      // The server prices this again from its own figures. A checkout that
      // trusts an amount sent by the browser is a checkout with a discount
      // button in the developer tools.
      body: JSON.stringify({ credits: Math.max(1, Math.floor(credits || 0)) }),
    });
    if (!res.ok) throw new Error("Could not start the purchase (" + res.status + ").");
    const data = await res.json();
    if (data.token && data.token !== a.token) {
      a.token = data.token;
      await saveAccount(a);
    }
    return data.url;
  }

  /* Redeeming a token by hand, for a purchase finished in another tab or on
     another device. The credits belong to the token, not to the browser. */
  async function useToken(token) {
    const t = String(token || "").trim();
    if (!t) throw new Error("Paste the code from your receipt.");
    await saveAccount({ token: t, balance: 0 });
    return refresh();
  }

  async function forget() {
    if (typeof MDerived !== "undefined") await MDerived.setting(KEY, null);
  }

  /* The configuration caption.js needs to talk to the service, in the same
     shape as a bring-your-own endpoint so there is one run path rather than
     two. */
  async function endpoint() {
    const a = await account();
    if (!live() || !a || !a.token) return null;
    return {
      preset: "muletto",
      url: SERVICE.base + "/v1/chat/completions",
      // The service picks the real model; this names the product, not the
      // vendor.
      model: "muletto-vision",
      key: a.token,
      hosted: true,
    };
  }

  return {
    live, account, saveAccount, known, refresh, costOf, quote, price, money, unitLabel,
    checkoutUrl, useToken, forget, endpoint,
  };
})();

/* ---------------------------------------------------------------------------
   What the service has to provide, when it exists:

   GET  /balance
        Authorization: Bearer <token>
        -> { "credits": 1840 }

   POST /checkout   { "credits": 1247 }
        -> { "url": "https://checkout...", "token": "<issued if new>" }
        Prices the request from its own figures rather than trusting an amount
        from the browser, and applies the same floor. The token is issued
        before payment so the browser can hold it while the reader is away on
        the payment page. It has no credits until the payment settles.

   POST /v1/chat/completions
        Authorization: Bearer <token>
        The OpenAI chat-completions shape, one image per request, so caption.js
        needs no separate code path. Must decrement one credit per successful
        description and refuse with 402 when the balance is empty.

   The promises the panel makes on the service's behalf, which the service has
   to actually keep:
     - the image is held only for the moment it takes to describe it
     - it is not written to disk, logged, or used for training
     - no description, filename or date is retained after the response
     - the token identifies a balance, not a person
   These are printed in front of the reader before they spend anything. They
   are commitments, not marketing.
   --------------------------------------------------------------------------- */
