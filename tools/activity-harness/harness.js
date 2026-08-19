/* Runs the shipped parseActivity over the real My Activity pages.
   Counts only - no search term, title or URL is ever printed. */
(async () => {
  const out = document.getElementById("out");
  const L = [];
  const idx = await (await fetch("activity/index.json")).json();
  let all = 0, dated = 0, verbed = 0, linked = 0, threw = 0;
  const byProduct = [];
  for (const it of idx) {
    let rows = [], err = null;
    const t0 = performance.now();
    try {
      const html = await (await fetch("activity/" + it.file)).text();
      rows = MTopics.parseActivity(html, it.product);
    } catch (e) { err = String(e.message).slice(0, 70); threw++; }
    const ms = Math.round(performance.now() - t0);
    const d = rows.filter(r => r.at).length;
    all += rows.length; dated += d;
    verbed += rows.filter(r => r.verb).length;
    linked += rows.filter(r => r.href).length;
    byProduct.push(it.product.padEnd(20) + String(rows.length).padStart(6) + " rows  " +
      String(d).padStart(6) + " dated  " + String(ms).padStart(5) + "ms  " +
      (it.bytes / 1024).toFixed(0).padStart(6) + "KB" + (err ? "  THREW: " + err : ""));
  }
  const pc = n => all ? (n * 100 / all).toFixed(1) + "%" : "-";
  L.push("My Activity, real pages, shipped parser");
  L.push("=======================================");
  L.push(...byProduct);
  L.push("");
  L.push("total rows parsed   " + all);
  L.push("with a usable date  " + dated + "   " + pc(dated));
  L.push("with a verb kept    " + verbed + "   " + pc(verbed));
  L.push("with a link         " + linked + "   " + pc(linked));
  L.push("files that threw    " + threw);
  L.push("");
  L.push("ACTIVITY_FILE matches the real path: " +
    MTopics.ACTIVITY_FILE.test("Takeout/My Activity/Search/My Activity.html"));
  out.textContent = L.join("\n");
})();
