"use strict";

/* The counter store, over HTTP, with no packages.
 *
 * Vercel KV is Upstash Redis with a REST interface, and the REST interface is
 * reachable with fetch. Using it that way rather than through the client
 * library keeps this repo at zero runtime dependencies, which matters more
 * here than convenience: a site whose entire claim is "nothing is sent
 * anywhere" should not be pulling code it has not read into the one place
 * that can send things.
 *
 * If the environment is not configured, everything here returns null and the
 * callers do nothing. A site with no counters is a working site.
 */

/* Two spellings, because the same database arrives under two names.
 *
 * Vercel KV set KV_REST_API_URL and KV_REST_API_TOKEN. It has since become a
 * Marketplace integration, and connecting Upstash through the Marketplace
 * sets UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN instead - the same
 * database, the same REST interface, a different pair of names depending on
 * when and how it was added. Accepting both is three lines and removes a
 * failure that would otherwise look exactly like "the counters do not work".
 *
 * KV_* is tried first so an existing deployment keeps behaving as it did. */
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";

const configured = () => !!(URL_ && TOKEN);

/* Which names were found, for the usage page to report. Never the values -
   the token is a credential, and a page that prints credentials is a page
   that leaks them into a screenshot. */
function foundVars() {
  const names = ["KV_REST_API_URL", "KV_REST_API_TOKEN",
                 "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"];
  return names.filter((n) => !!process.env[n]);
}

/* One round trip for however many commands. Redis pipelines are ordered, so
   the results come back in the order they were sent. */
async function pipeline(commands) {
  if (!configured() || !commands.length) return null;
  const res = await fetch(URL_.replace(/\/+$/, "") + "/pipeline", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error("store " + res.status);
  const rows = await res.json();
  return rows.map((r) => (r && Object.prototype.hasOwnProperty.call(r, "result") ? r.result : null));
}

module.exports = { configured, pipeline, foundVars };
