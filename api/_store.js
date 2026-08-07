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

const URL_ = process.env.KV_REST_API_URL || "";
const TOKEN = process.env.KV_REST_API_TOKEN || "";

const configured = () => !!(URL_ && TOKEN);

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

module.exports = { configured, pipeline };
