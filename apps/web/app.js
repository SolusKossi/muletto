"use strict";

// Muletto web app.
// Everything here runs in the browser. The import flow reads the user's zip
// locally and never sends it anywhere; that is the whole point.

const $ = (sel, root = document) => root.querySelector(sel);
const fmtBytes = (n) => {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + " " + u[i];
};

/* ---------- Official provider marks (single-path brand logos, themed via currentColor) ----------
   Source: Simple Icons (https://simpleicons.org). Each mark is a trademark of its owner and is
   used here for nominative identification of that provider's export. Rendered monochrome in the
   site accent so the set reads as one system. For production, confirm each brand's usage guidelines
   (some restrict recolouring); a full-colour toggle is easy to add. */

const brand = (d) => `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${d}"/></svg>`;
const ICONS = {
  apple: brand("M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"),
  google: brand("M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"),
  samsung: brand("M19.8166 10.2808l.0459 2.6934h-.023l-.7793-2.6934h-1.2837v3.3925h.8481l-.0458-2.785h.023l.8366 2.785h1.2264v-3.3925zm-16.149 0l-.6418 3.427h.9284l.4699-3.1175h.0229l.4585 3.1174h.9169l-.6304-3.4269zm5.1805 0l-.424 2.6132h-.023l-.424-2.6132H6.5788l-.0688 3.427h.8596l.023-3.0832h.0114l.573 3.0831h.8711l.5731-3.083h.023l.0228 3.083h.8596l-.0802-3.4269zm-7.2664 2.4527c.0343.0802.0229.1949.0114.2522-.0229.1146-.1031.2292-.3324.2292-.2177 0-.3438-.126-.3438-.3095v-.3323H0v.2636c0 .7679.6074.9971 1.2493.9971.6189 0 1.1346-.2178 1.2149-.7794.0458-.298.0114-.4928 0-.5616-.1605-.722-1.467-.9283-1.5588-1.3295-.0114-.0688-.0114-.1375 0-.1834.023-.1146.1032-.2292.3095-.2292.2063 0 .321.126.321.3095v.2063h.8595v-.2407c0-.745-.6762-.8596-1.1576-.8596-.6074 0-1.1117.2063-1.2034.7564-.023.149-.0344.2866.0114.4585.1376.7106 1.364.9169 1.5358 1.3524m11.152 0c.0343.0803.0228.1834.0114.2522-.023.1146-.1032.2292-.3324.2292-.2178 0-.3438-.126-.3438-.3095v-.3323h-.917v.2636c0 .7564.596.9857 1.2379.9857.6189 0 1.1232-.2063 1.2034-.7794.0459-.298.0115-.4814 0-.5616-.1375-.7106-1.4327-.9284-1.5243-1.318-.0115-.0688-.0115-.1376 0-.1835.0229-.1146.1031-.2292.3094-.2292.1948 0 .321.126.321.3095v.2063h.848v-.2407c0-.745-.6647-.8596-1.146-.8596-.6075 0-1.1004.1948-1.192.7564-.023.149-.023.2866.0114.4585.1376.7106 1.341.9054 1.513 1.3524m2.8882.4585c.2407 0 .3094-.1605.3323-.2522.0115-.0343.0115-.0917.0115-.126v-2.533h.871v2.4642c0 .0688 0 .1948-.0114.2292-.0573.6419-.5616.8482-1.192.8482-.6303 0-1.1346-.2063-1.192-.8482 0-.0344-.0114-.1604-.0114-.2292v-2.4642h.871v2.533c0 .0458 0 .0916.0115.126 0 .0917.0688.2522.3095.2522m7.1518-.0344c.2522 0 .3324-.1605.3553-.2522.0115-.0343.0115-.0917.0115-.126v-.4929h-.3553v-.5043H24v.917c0 .0687 0 .1145-.0115.2292-.0573.6303-.596.8481-1.2034.8481-.6075 0-1.1461-.2178-1.2034-.8481-.0115-.1147-.0115-.1605-.0115-.2293v-1.444c0-.0574.0115-.172.0115-.2293.0802-.6419.596-.8482 1.2034-.8482s1.1347.2063 1.2034.8482c.0115.1031.0115.2292.0115.2292v.1146h-.8596v-.1948s0-.0803-.0115-.1261c-.0114-.0802-.0802-.2521-.3438-.2521-.2521 0-.321.1604-.3438.2521-.0115.0458-.0115.1032-.0115.1605v1.5702c0 .0458 0 .0916.0115.126 0 .0917.0917.2522.3323.2522"),
  snapchat: brand("M12.206.793c.99 0 4.347.276 5.93 3.821.529 1.193.403 3.219.299 4.847l-.003.06c-.012.18-.022.345-.03.51.075.045.203.09.401.09.3-.016.659-.12 1.033-.301.165-.088.344-.104.464-.104.182 0 .359.029.509.09.45.149.734.479.734.838.015.449-.39.839-1.213 1.168-.089.029-.209.075-.344.119-.45.135-1.139.36-1.333.81-.09.224-.061.524.12.868l.015.015c.06.136 1.526 3.475 4.791 4.014.255.044.435.27.42.509 0 .075-.015.149-.045.225-.24.569-1.273.988-3.146 1.271-.059.091-.12.375-.164.57-.029.179-.074.36-.134.553-.076.271-.27.405-.555.405h-.03c-.135 0-.313-.031-.538-.074-.36-.075-.765-.135-1.273-.135-.3 0-.599.015-.913.074-.6.104-1.123.464-1.723.884-.853.599-1.826 1.288-3.294 1.288-.06 0-.119-.015-.18-.015h-.149c-1.468 0-2.427-.675-3.279-1.288-.599-.42-1.107-.779-1.707-.884-.314-.045-.629-.074-.928-.074-.54 0-.958.089-1.272.149-.211.043-.391.074-.54.074-.374 0-.523-.224-.583-.42-.061-.192-.09-.389-.135-.567-.046-.181-.105-.494-.166-.57-1.918-.222-2.95-.642-3.189-1.226-.031-.063-.052-.15-.055-.225-.015-.243.165-.465.42-.509 3.264-.54 4.73-3.879 4.791-4.02l.016-.029c.18-.345.224-.645.119-.869-.195-.434-.884-.658-1.332-.809-.121-.029-.24-.074-.346-.119-1.107-.435-1.257-.93-1.197-1.273.09-.479.674-.793 1.168-.793.146 0 .27.029.383.074.42.194.789.3 1.104.3.234 0 .384-.06.465-.105l-.046-.569c-.098-1.626-.225-3.651.307-4.837C7.392 1.077 10.739.807 11.727.807l.419-.015h.06z"),
  facebook: brand("M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z"),
  instagram: brand("M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077"),
  box: brand("M12 2 3 6.5v11L12 22l9-4.5v-11L12 2Zm0 2.2 6.1 3.05L12 10.3 5.9 7.25 12 4.2ZM5 8.85l6 3v7.35l-6-3V8.85Zm14 0v7.35l-6 3v-7.35l6-3Z"),
};
// Non-brand icons for storage destinations.
const line = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
ICONS.server = line('<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>');
ICONS.drive = line('<rect x="2.5" y="7" width="19" height="10" rx="2.5"/><path d="M6.5 12h.01"/><path d="M10 12h7"/>');
// Non-brand icons for the view switcher.
ICONS.clock = line('<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.2 2"/>');
ICONS.image = line('<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><circle cx="8.6" cy="10" r="1.6"/><path d="m4 17 4.8-4.4a2 2 0 0 1 2.7 0L20 19.5"/>');
ICONS.chat = line('<path d="M20.5 12.4c0 4-3.8 7.2-8.5 7.2a10 10 0 0 1-2.7-.4l-5.3 1.6 1.6-4.2a6.8 6.8 0 0 1-2.1-4.9c0-4 3.8-7.2 8.5-7.2s8.5 3.2 8.5 7.2Z"/>');
ICONS.pin = line('<path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/>');
ICONS.table = line('<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M3 9.7h18M9.4 9.7v9.8"/>');
ICONS.folder = line('<path d="M3 7.5A2 2 0 0 1 5 5.5h3.9a2 2 0 0 1 1.5.7l1 1.3H19a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>');
ICONS.copy = line('<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 5.5h-10a2 2 0 0 0-2 2v10"/>');
ICONS.search = line('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>');
ICONS.layers = line('<path d="m12 3 9 4.7-9 4.7-9-4.7Z"/><path d="m3.6 12 8.4 4.4 8.4-4.4"/>');
ICONS.video = line('<rect x="3" y="6" width="12.5" height="12" rx="2.5"/><path d="m15.5 11 5.5-3v8l-5.5-3Z"/>');
ICONS.activity = line('<path d="M3 12h4l2.5-6 4 13L16 12h5"/>');
ICONS.chart = line('<path d="M4 19.5V4.5M4 19.5h16"/><path d="M7.5 16.5v-4M12 16.5v-8M16.5 16.5v-5.5"/>');
ICONS.route = line('<circle cx="6" cy="6" r="2.6"/><circle cx="18" cy="18" r="2.6"/><path d="M8.6 6H14a4 4 0 0 1 0 8h-4a4 4 0 0 0 0 8h4.9"/>');
/* One per topic. A sidebar where Contacts, Audio and Comments all carry the
   same speech bubble is a sidebar you have to read every time instead of
   recognising. */
ICONS.person = line('<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>');
ICONS.calendar = line('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3.5v3M16 3.5v3"/>');
ICONS.note = line('<path d="M5 3.5h9.5L19 8v12.5H5Z"/><path d="M14 3.5V8h5"/><path d="M8.5 12.5h7M8.5 16h4.5"/>');
ICONS.audio = line('<path d="M4 14v-4h3.5L12 6v12l-4.5-4H4Z"/><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10"/>');
ICONS.mail = line('<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="m3.8 7 7.1 5.2a2 2 0 0 0 2.2 0L20.2 7"/>');
ICONS.shield = line('<path d="M12 3.2 19 6v5.5c0 4.3-2.9 7.6-7 9.3-4.1-1.7-7-5-7-9.3V6Z"/><path d="m9.2 12 2 2 3.6-3.8"/>');
ICONS.heart = line('<path d="M12 20.3S3.8 15.6 3.8 9.8A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 8.2 2.2c0 5.8-8.2 10.5-8.2 10.5Z"/>');

function iconSvg(key) {
  return ICONS[key] || ICONS.box;
}

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const fmtDate = (d) => d ? d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";

/* ---------- Decorative icons on static pages ---------- */
// Guide pages and the guides index are generated as static HTML for search
// engines. Their card icons are decoration, so they are filled in here.

function hydrateIcons() {
  document.querySelectorAll("[data-icon]").forEach((el) => {
    el.innerHTML = iconSvg(el.dataset.icon);
  });
}

/* ---------- Screenshot lightbox ---------- */

/* Guide screenshots are wide UI captures shown at about 640px, which is too
   small to read the labels being described. Clicking one opens it full size.
   Built once, on demand, and reused. */
let lightbox = null;

function buildLightbox() {
  const el = document.createElement("div");
  el.className = "lightbox";
  el.hidden = true;
  el.innerHTML =
    '<button class="lb-close" type="button" aria-label="Close">' +
      '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">' +
      '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" fill="none"/></svg></button>' +
    '<figure class="lb-figure"><img alt="" /><figcaption></figcaption></figure>';

  const close = () => {
    el.hidden = true;
    document.body.classList.remove("no-scroll");
    el.querySelector("img").src = "";
    if (el.returnFocus) { el.returnFocus.focus(); el.returnFocus = null; }
  };

  // Anywhere outside the image counts as outside, including the padding
  // around the figure, so a stray click never feels like a trap.
  el.addEventListener("click", (e) => {
    if (!e.target.closest("img") || e.target.closest(".lb-close")) close();
  });
  el.querySelector(".lb-close").addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !el.hidden) close();
  });

  document.body.appendChild(el);
  return el;
}

function openLightbox(img, caption) {
  if (!lightbox) lightbox = buildLightbox();
  const big = lightbox.querySelector("img");
  big.src = img.currentSrc || img.src;
  big.alt = img.alt || "";
  const cap = lightbox.querySelector("figcaption");
  cap.textContent = caption || "";
  cap.hidden = !caption;
  lightbox.returnFocus = img;
  lightbox.hidden = false;
  document.body.classList.add("no-scroll");
  lightbox.querySelector(".lb-close").focus();
}

function wireShots() {
  document.querySelectorAll("figure.figshot").forEach((fig) => {
    const img = fig.querySelector("img");
    if (!img) return;
    const caption = fig.querySelector("figcaption")?.textContent || "";
    img.tabIndex = 0;
    img.setAttribute("role", "button");
    img.title = "Click to see it full size";
    img.addEventListener("click", () => openLightbox(img, caption));
    img.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openLightbox(img, caption); }
    });
  });
}

/* ---------- Homepage: what each export contains ---------- */

async function renderWhatYouGet() {
  const root = $("#whatyouget");
  try {
    const data = await (await fetch("guides/summary.json")).json();
    const list = data.providers.filter((p) => p.contents && p.contents.length);
    if (!list.length) { root.closest("section").hidden = true; return; }

    root.innerHTML = `
      <div class="switcher" role="tablist">
        ${list.map((p, i) => `<button class="sw-btn${i ? "" : " on"}" role="tab" data-i="${i}">
          <span class="sw-ic">${iconSvg(p.icon)}</span>${esc(p.provider)}</button>`).join("")}
      </div>
      <div class="sw-panel" id="sw-panel"></div>`;

    const panel = $("#sw-panel", root);
    const draw = (i) => {
      const p = list[i];
      const max = Math.max(...p.contents.map((c) => c.weight || 1));
      panel.innerHTML = `
        <div class="sw-meta">
          <div><span class="k">Typical wait</span><b>${esc(p.wait_time)}</b></div>
          <div><span class="k">Effort</span><b>${esc(p.difficulty)}</b></div>
          <div><span class="k">Typical size</span><b>${esc(p.typical_size || "varies")}</b></div>
        </div>
        <div class="sw-rows">
          ${p.contents.map((c) => `
            <div class="sw-row">
              <div class="sw-label">${esc(c.label)}</div>
              <div class="sw-track"><i style="width:${Math.round(((c.weight || 1) / max) * 100)}%"></i></div>
              <div class="sw-note">${esc(c.note || "")}</div>
            </div>`).join("")}
        </div>
        <a class="btn secondary" href="guides.html">See the ${esc(p.provider)} guide <span class="arrow">-&gt;</span></a>`;
    };
    draw(0);
    root.querySelectorAll(".sw-btn").forEach((b) =>
      b.addEventListener("click", () => {
        root.querySelectorAll(".sw-btn").forEach((x) => x.classList.remove("on"));
        b.classList.add("on");
        draw(Number(b.dataset.i));
      })
    );
  } catch (e) {
    root.innerHTML = `<p class="loading">Could not load export details.</p>`;
  }
}

/* ---------- Category classification and duplicates ---------- */

const CATEGORIES = [
  { key: "photos", label: "Photos", ext: ["jpg", "jpeg", "png", "heic", "heif", "gif", "webp", "bmp", "tif", "tiff", "dng", "raw"] },
  { key: "videos", label: "Videos", ext: ["mp4", "mov", "m4v", "avi", "mkv", "webm", "3gp", "hevc"] },
  { key: "audio", label: "Audio", ext: ["mp3", "m4a", "aac", "wav", "ogg", "opus", "flac"] },
  { key: "records", label: "Records and messages", ext: ["json", "html", "htm", "csv", "xml", "vcf", "ics", "txt"] },
  { key: "other", label: "Other files", ext: [] },
];
function categoryOf(name) {
  const e = (name.split(".").pop() || "").toLowerCase();
  const hit = CATEGORIES.find((c) => c.ext.includes(e));
  return hit ? hit.key : "other";
}

function findDuplicates(entries) {
  const byContent = new Map();
  for (const e of entries) {
    if (!e.size || !e.crc) continue;
    const k = e.crc + ":" + e.size;
    if (!byContent.has(k)) byContent.set(k, []);
    byContent.get(k).push(e);
  }
  let dupFiles = 0, reclaimable = 0;
  const groups = [];
  for (const list of byContent.values()) {
    if (list.length > 1) {
      dupFiles += list.length - 1;
      reclaimable += (list.length - 1) * list[0].size;
      groups.push(list);
    }
  }
  groups.sort((a, b) => b[0].size * (b.length - 1) - a[0].size * (a.length - 1));
  return { dupFiles, reclaimable, groups };
}

/* ---------- Provider auto-detection ---------- */

const SIGNATURES = [
  /* Takeout localises its folder and file names, and does it per string rather
     than wholesale: a German archive translates Access Log Activity and Saved
     but leaves Groups and Home App in English, and renames archive_browser.html
     to Archiv_Ubersicht.html. A Finnish one goes further and localises file
     names too. Matching the English index page alone would have failed to
     recognise a German or Finnish Takeout at all - and this is a Norwegian
     product. The root folder has stayed Takeout in every sample reported. */
  { slug: "google", label: "Google Takeout",
    pats: ["takeout/", "archive_browser.html", "archiv_ubersicht.html",
           "arkiston_selain.html", "explorateur_d_archives.html"] },
  { slug: "instagram", label: "Instagram", pats: ["your_instagram_activity", "instagram/", "/media/posts"] },
  { slug: "facebook", label: "Facebook", pats: ["your_facebook_activity", "facebook/", "personal_information/"] },
  { slug: "snapchat", label: "Snapchat", pats: ["memories_history", "chat_history", "snap_history", "json/account.json"] },
  { slug: "apple", label: "Apple", pats: ["icloud", "apple media services", "apple id account", "apple_id"] },
  { slug: "samsung", label: "Samsung", pats: ["samsung", "com.sec.", "com.samsung"] },
];
/* Some providers are recognisable from the archive's own name, and that was
   being thrown away.

   Samsung does not send one export. It sends a set, one archive per service -
   ANS, PENUP, NCDM, galaxyapps, SamsungAccount, samsungcloud, SmartThingsFind
   and so on - each named <service>_gk<id>_<date>_access.zip. Most of them
   contain nothing that says "samsung" anywhere inside, so looking only at the
   entry names inside the zip identified them as nothing at all, and each one
   became its own provider named after its file. */
/* Apple has exactly the same problem and it went unnoticed for longer, because
   most of the eighteen archives do mention iCloud somewhere and a few do not.
   AppleCare.zip holds two CSVs about support cases; nothing in it says Apple
   in a way the content test recognises, so it arrived as its own provider,
   sitting in the sidebar beside Apple with a cardboard-box icon. These are
   Apple's own archive names, taken from a real export. */
const APPLE_ARCHIVES =
  /^(applecare|apple\.com and apple store|apple account and device information|apple media services|marketing communications|wallet activity|other data part \d+ of \d+|app install and push notification activity|game center|devices registered with apple messaging|icloud )/i;

const NAME_SIGNATURES = [
  { slug: "samsung", label: "Samsung", test: (n) => /_gk\d+_\d{8}_access\.zip$/i.test(n) },
  { slug: "google", label: "Google Takeout", test: (n) => /^takeout[-_]/i.test(n) },
  { slug: "apple", label: "Apple", test: (n) => APPLE_ARCHIVES.test(n.replace(/\s*\(\d+\)\s*(?=\.zip$)/i, "")) },
];

function detectProvider(entries, fileName) {
  const names = entries.slice(0, 6000).map((e) => e.name.toLowerCase());
  let best = null, bestScore = 0;
  for (const s of SIGNATURES) {
    let score = 0;
    for (const n of names) if (s.pats.some((p) => n.includes(p))) score++;
    if (score > bestScore) { bestScore = score; best = s; }
  }
  if (best) return best;
  // Nothing inside gave it away, so fall back to what it is called.
  if (fileName) {
    const hit = NAME_SIGNATURES.find((s) => s.test(fileName));
    if (hit) return { slug: hit.slug, label: hit.label };
  }
  return null;
}

/* ---------- Opening an export ---------- */

/* Which open a source arrived in. Archives handed over together are one
   export by definition; archives handed over on separate occasions might be
   the same account exported twice. */
let openBatch = 0;

let objectUrls = [];
function releaseUrls() {
  objectUrls.forEach((u) => URL.revokeObjectURL(u));
  objectUrls = [];
}

/* Open one export and parse it into a source record.

   `seen` carries the contents already taken from earlier archives of the same
   download, keyed by export. Meta ships the same messages/inbox JSON in more
   than one part of a split export, and a reader who drops the whole folder in
   can hand over the same archive twice - either way the same bytes arrive
   twice. Parsing both copies is what put every message in the library twice.

   Filtering here rather than after the fact means the duplicate is never
   parsed, never counted, and never in the file list. Entries the archive gives
   no checksum for are kept: unidentifiable is not the same as duplicate. */
/* Ask for the archive password, once, and keep it for the rest of the batch.

   Samsung protects every archive it sends and emails the password separately.
   Asking is the difference between an export that opens and a file list.

   The prompt appears over the curtain, because that is where the reader
   already is - the alternative is failing the whole open and making them start
   again. An empty answer means "carry on without it", and the locked entries
   are then reported the way they were before any of this existed. */
function askPassword(name, wrong, progress) {
  return new Promise((resolve) => {
    const el = document.createElement("div");
    el.id = "pwx";
    /* Which archives are already open and which are still locked. Opening a
       Samsung export means nine archives and one password, and without this
       the same box appears again and again with nothing to say whether any
       progress is being made. */
    const done = (progress && progress.done) || [];
    const todo = (progress && progress.todo) || [];
    const list = (title, names, cls) => names.length
      ? '<div class="pw-group"><h4 class="' + cls + '">' + title + " (" + names.length + ")</h4>" +
        "<ul>" + names.map((n) => "<li>" + esc(n) + "</li>").join("") + "</ul></div>"
      : "";

    el.innerHTML =
      '<div class="xw-scrim"></div>' +
      '<div class="xw" role="dialog" aria-modal="true" aria-labelledby="pw-t">' +
        '<header class="xw-head"><div><h2 id="pw-t">' +
          (wrong ? "That password did not work" : "This export is locked") + "</h2>" +
          '<p class="muted small">' + (wrong
            ? "Check the email again - a trailing space is the usual culprit."
            : "Samsung locks every archive and emails the password separately, under " +
              "Send my file password on the download page. One password opens all of them.") +
          "</p></div></header>" +
        '<div class="xw-body">' +
          '<label class="pw-label" for="pw-in">Password for ' + esc(name) + "</label>" +
          '<input class="pw-in" id="pw-in" type="password" autocomplete="off" spellcheck="false" />' +
          '<p class="muted small pw-note">Used here and nowhere else. Not saved, not sent ' +
          "anywhere, and forgotten when this tab closes.</p>" +
          list("Already open", done, "pw-ok") +
          list("Still locked", todo, "pw-locked") +
        "</div>" +
        '<footer class="xw-foot">' +
          '<button class="btn ghost" id="pw-cancel">Cancel</button>' +
          '<div class="xw-footl">' +
            '<button class="btn secondary" id="pw-skip">Skip this one</button>' +
            '<button class="btn primary" id="pw-go">Unlock</button>' +
          "</div>" +
        "</footer>" +
      "</div>";
    document.body.appendChild(el);
    const input = el.querySelector("#pw-in");
    input.focus();
    const finish = (v) => {
      el.remove();
      document.removeEventListener("keydown", onKey);
      resolve(v);
    };
    const onKey = (e) => { if (e.key === "Escape") finish({ cancel: true }); };
    document.addEventListener("keydown", onKey);
    el.querySelector("#pw-go").addEventListener("click", () => finish({ password: input.value || null }));
    el.querySelector("#pw-skip").addEventListener("click", () => finish({ password: null }));
    el.querySelector("#pw-cancel").addEventListener("click", () => finish({ cancel: true }));
    el.querySelector(".xw-scrim").addEventListener("click", () => finish({ cancel: true }));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") finish({ password: input.value || null });
    });
  });
}

/* Try one entry to find out whether the password works, before asking the
   parser to read hundreds of them and fail on every one. */
async function unlockIfNeeded(file, entries, progress) {
  const locked = entries.find((e) => (e.encrypted || e.method === 99) && e.size > 0);
  if (!locked) return true;
  if (MZip.password) {
    try { await MZip.extract(file, locked); return true; } catch { /* not this one */ }
  }
  let wrong = false;
  for (let tries = 0; tries < 4; tries++) {
    const answer = await askPassword(file.name, wrong, progress);
    if (answer.cancel) { const e = new Error("cancelled"); e.cancelled = true; throw e; }
    if (!answer.password) return false;
    MZip.password = answer.password;
    try {
      await MZip.extract(file, locked);
      return true;
    } catch (err) {
      MZip.password = null;
      if (!err.badPassword) throw err;
      wrong = true;
    }
  }
  return false;
}

async function readSource(file, seen) {
  /* A gzipped tar cannot be read lazily - gzip is not seekable, so there is no
     directory to consult and no way to fetch one entry without decompressing
     everything before it. It is unpacked in one pass instead, each member into
     its own blob. Everything after this point is identical. */
  if (typeof MTar !== "undefined" && MTar.isTgz(file.name)) {
    const say = seen && seen.say;
    if (say) say("Unpacking " + file.name + " - a .tgz has to be read in one go...");
    const all = await MTar.read(file, (n, b) => {
      if (say) say("Unpacking " + file.name + " - " + n.toLocaleString() +
                   " files so far (" + fmtBytes(b) + ")...");
    });
    readCancelled();
    const det = detectProvider(all, file.name);
    const key = exportKey(file.name, (det && det.slug) || file.name);
    let entries = all, dropped = 0;
    if (seen) {
      const set = seen.get(key) || new Set();
      entries = all.filter((e) => {
        if (!e.size) return true;
        const k = e.name + ":" + e.size;
        if (set.has(k)) { dropped++; return false; }
        set.add(k);
        return true;
      });
      seen.set(key, set);
    }
    const lib = await MParse.parse(file, entries, det, seen && seen.say);
    readCancelled();
    return { name: file.name, size: file.size, file, entries, det, lib,
             exportKey: key, dropped, locked: 0, skippedNested: [] };
  }

  // Only the archive's directory is read here; file data stays on disk until
  // an individual entry is actually needed.
  const outer = await MZip.readDirectory(file);
  const unlocked = await unlockIfNeeded(file, outer, seen && seen.progress);

  /* Apple puts archives inside archives - seven of the eighteen in a real
     export - and until this ran, everything in them was invisible. Done after
     unlocking, because a nested archive inside an encrypted one cannot be read
     until the outer archive is open. */
  const nest = await MZip.expandNested(file, outer, null, (a) => {
    // Also the point where Stop takes effect inside a long archive, rather
    // than only between one archive and the next.
    readCancelled();
    if (seen && seen.say) {
      seen.say("Unpacking " + a.name.split("/").pop() +
               " (" + fmtBytes(a.size) + ") from inside " + file.name + "...");
    }
  });
  const all = nest.entries;
  const det = detectProvider(all, file.name);
  const key = exportKey(file.name, (det && det.slug) || file.name);

  let entries = all;
  let dropped = 0;
  if (seen) {
    const set = seen.get(key) || new Set();
    entries = all.filter((e) => {
      if (!e.crc || !e.size) return true;
      const k = e.crc + ":" + e.size;
      if (set.has(k)) { dropped++; return false; }
      set.add(k);
      return true;
    });
    seen.set(key, set);
  }

  const lib = await MParse.parse(file, entries, det, seen && seen.say);
  readCancelled();

  /* A nested archive too large to open is the one case where something real is
     missing and no count anywhere would show it: the outer archive lists it as
     a single file, so everything reconciles. Apple's Other Data holds a 1.3 GB
     zip of Siri recordings, which is over the limit and stays shut. Say so. */
  for (const s of nest.skipped) {
    const who = s.name.split("/").pop() + " is an archive inside this one, and ";
    const fix = " Its contents are not counted anywhere below. Unzip that one " +
                "file yourself and drop it in on its own to read it.";
    if (s.reason === "unreadable") {
      lib.notes.push(who + "it could not be opened - it may need its own " +
                     "password, or be damaged." + fix);
    } else if (s.reason === "budget") {
      lib.notes.push(who + "this export has more nested archives than Muletto " +
                     "opens in one go." + fix);
    } else {
      lib.notes.push(who + "at " + fmtBytes(s.size) + " this browser would not " +
                     "give us room to unpack it." + fix);
    }
  }

  /* An archive whose contents are locked reads as an archive with nothing in
     it, and that is the worst possible way to present it: every count is zero,
     the file list is full, and nothing says why. Samsung protects every entry
     in every one of the archives it sends. */
  const locked = unlocked
    ? 0
    : entries.filter((e) => e.encrypted || e.method === 99).length;
  return { name: file.name, size: file.size, file, entries, det, lib,
           exportKey: key, dropped, locked, skippedNested: nest.skipped };
}

/* Combine several exports into a single library. Each item remembers which
   export it came from, so we can still extract and label it afterwards. */
/* Opening a second export from a provider you already have.

   People re-export the same account a year later to pick up what has happened
   since. What comes back is not a separate library: it is the same library,
   with more in it. Treating it as an addition doubles every message, every
   record and every photo that was in both.

   So within one provider the newest export wins outright - it is a superset of
   what the older one held. The older ones then contribute only files whose
   bytes are not in the newest, which is the case worth keeping: photos you
   had, and the provider no longer does. Matched on CRC and size, which the
   archive itself records, so it is an identical-bytes test rather than a guess
   from the name.

   Duplicates across *different* providers are left alone. The same photo in
   Apple and Google is a real thing to know about, and the duplicate count is
   there to tell you. */
/* Which download a file belongs to.

   A big export does not arrive as one archive. Google splits a Takeout into
   takeout-<timestamp>-1-001.zip, -002, -003 and so on; Meta splits into files
   that share a name and a date and differ only by a trailing hash. Every part
   is a piece of ONE download.

   This matters because of what supersede does below. Grouping by provider
   alone made six parts of one Takeout look like six separate downloads a year
   apart, so five were marked older, greyed out and stripped back to orphaned
   files - which threw away their messages, their location history and their
   record tables. Only the last part survived intact, and a Takeout part is an
   arbitrary slice, so what survived was arbitrary too.

   Parts of one download share a key here, so supersede never fires between
   them and all of them are read in full. */
function exportKey(name, slug) {
  /* A browser downloading the same archive twice writes the second one as
     "name (1).zip". Both were opened, both kept their own key, so the content
     dedup - which works per key - never compared them, and every table in
     that export appeared twice side by side. The copy suffix is not part of
     the export's identity. */
  const base = String(name).replace(/\.zip$/i, "")
    .replace(/[ _-]*\((\d{1,3})\)$/, "")
    .replace(/[ _-]+copy(?:[ _-]*\d+)?$/i, "")
    .trim();
  // takeout-20260731T101500Z-1-001 -> the timestamp identifies the download.
  const g = base.match(/^takeout[-_](\d{8}T\d{6}Z)/i);
  if (g) return slug + ":" + g[1].toUpperCase();
  // instagram-<account>-2026-07-31-<hash> -> everything up to the date.
  const m = base.match(/^((?:instagram|facebook|meta)[-_].*?[-_]\d{4}[-_]\d{2}[-_]\d{2})/i);
  if (m) return slug + ":" + m[1].toLowerCase();

  /* Samsung ships one archive per service, all named
     <service>_gk<id>_<date>_access.zip, and the service name is different in
     every one. Grouping on the stem therefore made nine separate downloads out
     of a single request - so eight were treated as superseded and thrown away
     but for their orphaned files.

     They all belong together, so they all get one key. Two Samsung requests
     opened at the same time would merge rather than supersede, which is the
     safe way round: identical entries across them are already dropped by
     content before anything is parsed. */
  if (/_gk\d+_\d{8}_access$/i.test(base)) return slug + ":samsung-access";
  /* Apple splits one request into "Other Data Part 1 of 5.zip" and so on.
     Those are parts of a single download, not five downloads. */
  const part = base.match(/^(.*?)[ _-]*part[ _-]*\d{1,3}[ _-]*of[ _-]*\d{1,3}$/i);
  if (part) return slug + ":" + part[1].trim().toLowerCase();

  // Anything else: drop trailing part numbers, so name-1 and name-2 pair up.
  return slug + ":" + base.replace(/[-_](?:part[-_]?)?\d{1,4}$/i, "").toLowerCase();
}

function foldRepeats(sources) {
  /* Two levels, and the distinction is the whole point: a provider can have
     several downloads, and a download can have several parts. Superseding
     happens between downloads. Never between parts. */
  const byProvider = new Map();
  sources.forEach((s, i) => {
    const slug = (s.det && s.det.slug) || s.name;
    if (!s.exportKey) s.exportKey = exportKey(s.name, slug);
    if (!byProvider.has(slug)) byProvider.set(slug, []);
    byProvider.get(slug).push(i);
  });

  const report = [];
  for (const s of sources) { s.superseded = false; s.keepOnly = null; }

  for (const [, list] of byProvider) {
    // Split this provider's archives into downloads, keeping the order they
    // were opened in so the last one is still the newest.
    const downloads = [];
    const at = new Map();
    /* Grouped by the occasion they were opened on, not by their names.

       Apple sends one request as eighteen archives called things like
       AppleCare.zip and Marketing communications.zip; Samsung sends nine, one
       per service. No naming rule covers every provider, and getting it wrong
       is expensive: each archive looks like a separate download, so supersede
       marks all but one older and throws their records away.

       Whether two archives were handed over together is a far better signal
       than what they are called, and it is one the reader gives us for free.
       Opening a second export later still supersedes, which is the case
       supersede was written for. */
    for (const i of list) {
      const k = sources[i].batch != null ? "batch:" + sources[i].batch : sources[i].exportKey;
      if (!at.has(k)) { at.set(k, downloads.length); downloads.push([]); }
      downloads[at.get(k)].push(i);
    }
    // One download, however many parts it came in, is just the library.
    if (downloads.length < 2) continue;

    const newest = downloads[downloads.length - 1];
    const known = new Set();
    // Every part of the newest download counts as "what the newest one holds".
    for (const i of newest) {
      for (const e of sources[i].entries) if (e.crc && e.size) known.add(e.crc + ":" + e.size);
    }

    let foldedFiles = 0, keptFiles = 0;
    for (const older of downloads.slice(0, -1)) {
      for (const idx of older) {
        const src = sources[idx];
        const keep = new Set();
        for (const e of src.entries) {
          const k = e.crc + ":" + e.size;
          if (e.crc && e.size && known.has(k)) foldedFiles++;
          else { keep.add(e.name); keptFiles++; }
        }
        // Its records are superseded by the newer export; only orphaned files
        // survive, and only as files.
        src.superseded = true;
        src.keepOnly = keep;
      }
    }
    const head = sources[newest[0]];
    const label = head.det ? head.det.label : head.name;
    report.push({ label, copies: downloads.length, folded: foldedFiles, kept: keptFiles });
  }
  return report;
}

function mergeSources(sources) {
  const many = sources.length > 1;
  const merged = {
    provider: { slug: "merged", label: "Merged library" },
    media: [], conversations: [], events: [], places: [],
    tables: [], files: [], notes: [], insights: [], sources: [],
  };
  const repeats = foldRepeats(sources);
  merged.repeats = repeats;
  sources.forEach((s, i) => {
    const label = s.det ? s.det.label : s.name;
    const slug = s.det ? s.det.slug : "box";
    merged.sources.push({ i, label, slug, superseded: s.superseded, exportKey: s.exportKey });
    // A superseded export contributes only the files the newer one lost.
    const keep = s.keepOnly;
    const fresh = (list) => (keep
      ? list.filter((x) => keep.has((x.entry && x.entry.name) || x.path))
      : list);
    // Provenance travels on every record, not just media. The timeline and the
    // chat viewer both mix providers, and each item has to say where it came
    // from. Keeping it as a field rather than folding it into the title is
    // what lets the same person be grouped across platforms.
    const tag = (o) => { o.src = i; o.srcLabel = label; o.srcSlug = slug; return o; };
    for (const m of fresh(s.lib.media)) merged.media.push(tag(m));
    if (!s.superseded) for (const c of s.lib.conversations) merged.conversations.push(tag(c));
    if (!s.superseded) for (const e of s.lib.events) merged.events.push(tag(e));
    if (!s.superseded) for (const p of s.lib.places) merged.places.push(tag(p));
    if (!s.superseded) for (const t of s.lib.tables) merged.tables.push(tag(many ? { ...t, name: `${label}: ${t.name}` } : t));
    for (const f of fresh(s.lib.files)) merged.files.push(tag(f));
    if (!s.superseded) for (const n of s.lib.notes) merged.notes.push(many ? `${label}: ${n}` : n);
    if (!many) merged.insights.push(...(s.lib.insights || []));
  });
  merged.conversations.sort((a, b) => b.messages.length - a.messages.length);
  for (const r of repeats) {
    merged.notes.push(
      `You opened ${r.copies} ${r.label} exports. The newest one is used, because a fresh ` +
      `export contains everything an older one did - ${r.folded.toLocaleString()} identical ` +
      `files were folded away rather than shown twice.` +
      (r.kept ? ` ${r.kept.toLocaleString()} file${r.kept === 1 ? "" : "s"} present only in the ` +
        `older export ${r.kept === 1 ? "was" : "were"} kept.` : ""));
  }
  resolveSelf(merged);
  return merged;
}

/* Which of these names is the person who asked for the export.

   Snapchat says outright which messages were sent, so those names are known.
   Meta exports do not mark direction at all - every message just carries a
   sender name - so it has to be worked out. In a two-party thread the title
   names the other person, which leaves exactly one candidate for the owner.
   Votes are pooled across every conversation and every source, so one export
   that is explicit teaches the ones that are not. */
function resolveSelf(lib) {
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const self = new Set();
  const votes = new Map();
  const bump = (n, by) => { if (n) votes.set(n, (votes.get(n) || 0) + by); };

  for (const c of lib.conversations) {
    for (const m of c.messages) {
      if (m.direction === "sent" && m.from) { self.add(norm(m.from)); bump(norm(m.from), 100); }
    }
  }

  for (const c of lib.conversations) {
    if (c.messages.some((m) => m.direction === "sent")) continue;
    const senders = [...new Set(c.messages.map((m) => norm(m.from)).filter(Boolean))];
    const title = norm(c.title);
    const others = senders.filter((n) => n !== title && !title.includes(n) && !n.includes(title));
    // Only a two-party thread gives an unambiguous answer; groups just abstain.
    if (senders.length === 2 && others.length === 1) bump(others[0], 10);
    else for (const n of senders) bump(n, 1);
  }

  /* Take every strongly-scored name, not just the best one. The same person
     is "martin.l" on Snapchat and "Martin" on Instagram, and both are the
     account owner; keeping only the top score left the other platform's
     messages rendering as if someone else had sent them. A score of 10 can
     only come from a two-party thread where the title named the other person,
     so it is a deduction rather than a guess. Group threads score 1 and are
     ignored. */
  for (const [name, score] of votes) if (score >= 10) self.add(name);

  let fixed = 0;
  for (const c of lib.conversations) {
    for (const m of c.messages) {
      const mine = self.has(norm(m.from));
      const next = mine ? "sent" : "received";
      if (m.direction !== next) fixed++;
      m.direction = next;
    }
  }
  lib.self = [...self];
  return fixed;
}

const WORK_FILE = /\.(muletto|json|gz)$/i;
/* Written as a literal. Built through a shell, the escapes collapse and the
   dot matches any character - which is how a nested-archive test came to treat
   "notanarchive.unzip" as an archive. */
const ARCHIVE_FILE = /\.(zip|tgz|tar\.gz)$/i;

/* One place to put files, whatever they are.

   People should not have to know that an archive and a work file are different
   kinds of thing, or find two different buttons for them. Work files are taken
   out of the pile and applied first, so that if both are dropped together the
   results are already in place before anything is compared. */
/* A full-window curtain while an export is read.

   Reading a large archive takes seconds and decoding photos takes longer.
   Without something to look at, the page appears to have hung at exactly the
   moment the user is deciding whether to trust it - so it says what it is
   doing, and that it is doing it here. */
/* A full-screen curtain with no way out is the wrong thing to show somebody who
   did not ask for the work. Reading a large export takes minutes, and until
   this was here the only way to stop it was to close the tab. */
const cancelRead = { wanted: false };

function readCancelled() {
  if (!cancelRead.wanted) return false;
  const e = new Error("Stopped before anything was read.");
  e.cancelled = true;
  throw e;
}

function showCurtain(name) {
  if (curtainDrop) { clearTimeout(curtainDrop); curtainDrop = null; }
  let el = document.getElementById("curtain");
  if (!el) {
    el = document.createElement("div");
    el.id = "curtain";
    el.innerHTML = `
      <div class="curtain-in">
        <span class="wordmark">muletto</span>
        <div class="curtain-bar"><i></i></div>
        <p class="curtain-msg" id="curtain-msg"></p>
        <p class="curtain-fine">Reading it here, on your machine. Nothing is being uploaded.</p>
        <button class="btn ghost curtain-stop" id="curtain-stop">Stop</button>
      </div>`;
    document.body.appendChild(el);
    el.querySelector("#curtain-stop").addEventListener("click", () => {
      cancelRead.wanted = true;
      /* Also told to the reader, because the slow part is almost never a
         single read - it is a loop over thousands of entries, and only the
         reader is inside it. Without this, Stop sat saying "Stopping..." until
         the current archive finished, which for a large export is minutes and
         reads exactly like a hang. */
      if (typeof MZip !== "undefined") MZip.setCancelled(true);
      /* Down at once. Whatever is still unwinding cannot affect anything now:
         the library is discarded either way, so there is nothing to wait for
         and no reason to make somebody watch it. */
      hideCurtain();
    });
  }
  cancelRead.wanted = false;
  if (typeof MZip !== "undefined") MZip.setCancelled(false);
  const stop = el.querySelector("#curtain-stop");
  if (stop) { stop.disabled = false; stop.textContent = "Stop"; }
  document.body.classList.add("curtained");
  curtainSay(name);
  return el;
}

function curtainSay(msg) {
  const el = document.getElementById("curtain-msg");
  if (el) el.textContent = msg || "";
}

/* The removal is deferred so the fade can finish. If another read starts
   inside that window the element is reused, and without cancelling the pending
   removal it would be torn out from under the new read - leaving the body
   marked `curtained` with no curtain in it. */
let curtainDrop = null;

function hideCurtain() {
  document.body.classList.remove("curtained");
  const el = document.getElementById("curtain");
  if (el) curtainDrop = setTimeout(() => { el.remove(); curtainDrop = null; }, 320);
}

async function handleFiles(fileList, opts) {
  const all = [...fileList];
  const demo = !!(opts && opts.demo);
  /* A .tgz is an export, not a work file - and it ends in .gz, which WORK_FILE
     also matches. Which of these two tests wins decides whether a Takeout in
     tgz form is read as an archive or misfiled as saved progress. */
  const work = all.filter((f) => WORK_FILE.test(f.name) && !ARCHIVE_FILE.test(f.name));
  const files = all.filter((f) => ARCHIVE_FILE.test(f.name));

  /* Before the first await, so the curtain is up in the same tick as the drop
     or the click rather than after a work file has been read. Every return
     between here and the try below is guarded by !files.length, so there is no
     path that raises the curtain and then leaves without it. */
  if (files.length) showCurtain("Opening your export...");

  let restored = null;
  for (const f of work) {
    try {
      const r = await MDerived.fromFile(f);
      await MViews.loadLinks();
      restored = (restored || 0) + r.total;
    } catch (e) {
    if (e && e.cancelled) {
      hideCurtain();
      MNotify.push("Opening cancelled", {
        kind: "info",
        body: "Nothing was read. The archives are untouched, and you can try again whenever " +
          "the password turns up.",
      });
      return;
    }

      const say = (m) => {
        const el = document.getElementById("ex-status") || $("#import-result");
        if (el) el.textContent = m;
      };
      say(e.message);
      if (!files.length) return;
    }
  }
  if (restored !== null && !files.length) {
    const msg = `Restored what Muletto had worked out about ${plural(restored, "file", "files")}. ` +
      "Anything that applies to what you open will not be done again.";
    if (document.getElementById("explorer")) MExplorer.status(msg);
    else { const o = $("#import-result"); o.hidden = false; o.innerHTML = `<div class="note">${esc(msg)}</div>`; }
    return;
  }

  const append = !!(opts && opts.append) && !!current.lib;
  if (!files.length) return;
  const out = $("#import-result");
  // Appending keeps the pictures already decoded; starting over does not.
  if (!append) releaseUrls();
  out.hidden = false;

  const sources = append ? current.sources.slice() : [];
  /* What each download has already yielded, so a second part - or the same
     archive dropped twice - cannot contribute the same bytes again. Seeded
     from what is already open, so adding an export later behaves the same as
     opening it in the first batch. */
  const seenBytes = new Map();
  /* Everything opened in one go belongs to one act of opening. */
  const batch = ++openBatch;
  for (const s of sources) {
    const key = s.exportKey || exportKey(s.name, (s.det && s.det.slug) || s.name);
    const set = seenBytes.get(key) || new Set();
    for (const e of s.entries) if (e.crc && e.size) set.add(e.crc + ":" + e.size);
    seenBytes.set(key, set);
  }
  const status = append ? MExplorer.status : null;
  showCurtain("Opening your export...");
  try {
    for (let i = 0; i < files.length; i++) {
      readCancelled();
      const msg = `Reading ${files[i].name} (${fmtBytes(files[i].size)})` +
        (files.length > 1 ? ` - ${i + 1} of ${files.length}` : "") + "...";
      curtainSay(msg);
      if (status) status(msg);
      else out.innerHTML = `<p class="loading">${esc(msg)}</p>`;
      seenBytes.progress = {
        done: sources.map((x) => x.name),
        todo: files.slice(i + 1).map((f) => f.name),
      };
      /* Unpacking an archive inside an archive can take a while - Apple's
         Siri recordings are 1.3 GB - and with no word from it the curtain
         reads as a hang on the outer file. */
      seenBytes.say = (m) => { curtainSay(m); if (status) status(m); };
      const src = await readSource(files[i], seenBytes);
      src.batch = batch;
      sources.push(src);
    }
  } catch (e) {
    hideCurtain();
    if (e && e.cancelled) {
      out.hidden = true;
      out.innerHTML = "";
      MNotify.push("Stopped", {
        kind: "info",
        body: "Nothing was read, and nothing was changed. Your archives are exactly " +
          "as they were - open them again whenever you want.",
      });
      return;
    }
    if (status) status(e.message);
    else out.innerHTML = `<p class="loading">${esc(e.message)}</p>`;
    return;
  }

  const many = sources.length > 1;
  // Merge first: it decides which sources are superseded, and the file list
  // has to agree with the library rather than list an archive twice.
  const merged = mergeSources(sources);
  const allEntries = [];
  sources.forEach((s, i) => s.entries.forEach((e) => {
    if (s.keepOnly && !s.keepOnly.has(e.name)) return;
    allEntries.push(Object.assign({ src: i }, e));
  }));
  const total = allEntries.reduce((s, e) => s + e.size, 0);

  const counts = {};
  for (const e of allEntries) {
    const c = categoryOf(e.name);
    counts[c] = counts[c] || { n: 0, size: 0 };
    counts[c].n++; counts[c].size += e.size;
  }
  // Run duplicate detection across every export at once, which is the whole
  // point of opening them together.
  const dup = findDuplicates(allEntries);

  /* One chip per company, not per file. Samsung answers a request with nine
     separate archives and Apple with eighteen, so a chip per file was a wall
     of identical labels. The files are still there, folded under the company
     they came from. */
  const byCompany = [];
  for (const s of sources) {
    const label = s.det ? s.det.label : "Unrecognized";
    const slug = s.det ? s.det.slug : "box";
    let g = byCompany.find((x) => x.label === label);
    if (!g) { g = { label, slug, files: [] }; byCompany.push(g); }
    g.files.push(s.name);
  }
  const companyChip = (g) =>
    '<details class="src-co"><summary>' +
      `<span class="d-ic">${iconSvg(g.slug)}</span>` +
      `<strong>${esc(g.label)}</strong>` +
      `<span class="src-n">${g.files.length} file${g.files.length === 1 ? "" : "s"}</span>` +
    "</summary><ul>" +
      g.files.map((n) => `<li>${esc(n)}</li>`).join("") +
    "</ul></details>";

  const sourceLine = many
    ? `<div class="detected detected-co"><span class="src-lead">Merged <strong>${sources.length}</strong> ` +
      `export${sources.length === 1 ? "" : "s"} from <strong>${byCompany.length}</strong> ` +
      `${byCompany.length === 1 ? "service" : "services"}</span>` +
      byCompany.map(companyChip).join("") +
      `</div>`
    : (sources[0].det
      ? `<div class="detected"><span class="d-ic">${iconSvg(sources[0].det.slug)}</span><span>Detected ${/^[aeiou]/i.test(sources[0].det.label) ? "an" : "a"} <strong>${esc(sources[0].det.label)}</strong> export</span></div>`
      : `<div class="detected unknown"><span>Export type not recognized. Opening it as a general archive.</span></div>`);

  if (append) {
    renderLibrary(out, merged, sources, allEntries, demo);
    hideCurtain();
    return;
  }

  out.innerHTML = `
    <p class="proof"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg> Opened in your browser. Nothing was uploaded - ${many ? "these files" : "this file"} stayed on your device, and what was read is kept here so it is waiting next time.</p>
    ${sourceLine}
    <div class="tiles">
      <div class="tile"><div class="tile-n">${allEntries.length.toLocaleString()}</div><div class="tile-l">Total items</div><div class="tile-s">${fmtBytes(total)}</div></div>
      ${CATEGORIES.filter((c) => counts[c.key]).map((c) =>
        `<div class="tile"><div class="tile-n">${counts[c.key].n.toLocaleString()}</div><div class="tile-l">${c.label}</div><div class="tile-s">${fmtBytes(counts[c.key].size)}</div></div>`).join("")}
      ${dup.dupFiles > 0
        ? `<div class="tile accent"><div class="tile-n">${dup.dupFiles.toLocaleString()}</div><div class="tile-l">Exact duplicates</div><div class="tile-s">${fmtBytes(dup.reclaimable)} to reclaim${many ? ", across all exports" : ""}</div></div>`
        : `<div class="tile"><div class="tile-n">0</div><div class="tile-l">Exact duplicates</div><div class="tile-s">nothing to clean up</div></div>`}
    </div>
    <div id="library"><p class="loading" style="margin-top:18px">Reading the contents...</p></div>`;

  /* The small copies are made here, behind the curtain, because this is the
     one moment the reader is already waiting and nothing is on screen to be
     made slow. It is also the only chance to do it without competing with
     scrolling. A library already prepared on an earlier visit skips almost all
     of it - the index below tells us what is already on disk. */
  const lockedFiles = sources.reduce((n, s) => n + (s.locked || 0), 0);
  const lockedNames = sources.filter((s) => s.locked).map((s) => s.name);
  if (lockedFiles) {
    MNotify.push(plural(lockedFiles, "file is", "files are") + " password protected", {
      kind: "warn",
      body: "Only the list of what is inside could be read for " +
        plural(lockedNames.length, "archive", "archives") + ". Samsung emails the " +
        "password separately: on the download page, Send my file password mails it. Open " +
        "the same files again and enter it when asked.",
      action: "Read the Samsung guide",
      goto: () => { location.href = "guides/samsung.html"; },
    });
  }

  curtainSay("Building your timeline...");
  current.sources = sources;
  try {
    const had = await loadThumbIndex(merged.media);
    const missing = merged.media.filter((m) => (m.renderable && !m.heif) || m.kind === "video").length - had;
    if (missing > 0) {
      curtainSay("Preparing " + missing.toLocaleString() + " pictures...");
      await buildThumbs(merged.media, curtainSay);
    }
  } catch { /* the originals still work; this is only to make them quick */ }

  renderLibrary(out, merged, sources, allEntries, demo);
  hideCurtain();
}

/* ---------- Saving the data back out ---------- */

// Keeps the opened archive around so the save and search actions can use it.
let current = { sources: [], lib: null, entries: null, query: "", demo: false };

/* The sample exports are a demonstration, and a demonstration that writes to
   someone's browser is a bad one.
 *
 * Before this, opening the samples stored the library like any other, so the
 * next visit restored five archives of invented people and offered to carry on
 * where they left off. Anyone who had tried the demo once and come back to use
 * the product for real would be looking at somebody else's photos with no
 * obvious way to tell. That is worse than confusing - it undermines the exact
 * claim the demo exists to support.
 *
 * So demo libraries are never persisted, and every write goes through here. */
function persist() {
  if (current.demo) return;
  if (typeof MStore === "undefined") return;
  MStore.save(current.sources, current.lib, current.entries);
}

/* Anything that would spend money or write to disk is refused in demo mode,
   with the reason. The controls stay visible on purpose: hiding them would
   misrepresent what the product does, which is the opposite of the point. */
function demoBlocked(what) {
  if (!current.demo) return false;
  MNotify.push("Not available on the sample data", {
    kind: "warn",
    body: what + " needs your own library. These five archives are a demonstration - " +
      "invented people, and nothing here is saved to your browser. Open a real export " +
      "and everything works.",
  });
  return true;
}

function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function downloadManifest() {
  const { entries, lib, sources } = current;
  const dates = new Map((lib.media || []).map((m) => [m.path, m.at]));
  const label = (i) => {
    const s = sources[i];
    return s ? (s.det ? s.det.label : s.name) : "";
  };
  const rows = [["path", "name", "bytes", "category", "date", "export"]];
  for (const e of entries) {
    const at = dates.get(e.name);
    rows.push([e.name, e.name.split("/").pop(), e.size, categoryOf(e.name),
      at ? at.toISOString().slice(0, 10) : "", label(e.src)]);
  }
  const csv = rows.map((r) => r.map((c) => {
    const s = String(c);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(",")).join("\n");
  download("muletto-file-list.csv", new Blob([csv], { type: "text/csv" }));
}

/* Write the photos and videos into Year/Month folders on the user's disk,
   using the real capture date when the export gave us one. */
/* What a clean copy would contain.

   Nothing is ever deleted from the archives - they are read-only, and deleting
   someone's only copy of anything is not a thing this should do. A decision to
   drop a file means it is left out when a tidied copy is written, and that is
   what the numbers here describe. */
function cleanupTally(lib) {
  let keep = 0, drop = 0, keptBytes = 0, freedBytes = 0;
  for (const m of lib.media) {
    if (m.drop) { drop++; freedBytes += m.size || 0; }
    else { keep++; keptBytes += m.size || 0; }
  }
  return { keep, drop, keptBytes, freedBytes };
}

async function saveIntoFolders(_unused, repairDates) {
  const { sources, lib } = current;
  if (!window.showDirectoryPicker) {
    MNotify.push("This browser cannot write folders", { kind: "warn",
      body: "Chrome or Edge can. Otherwise, download the file list instead." });
    return;
  }
  const note = MNotify.task("Saving into dated folders");
  const statusEl = { set textContent(v) { note.say(v); }, get textContent() { return ""; } };
  const tally = cleanupTally(lib);
  // Continue a job left unfinished by a crash, reboot or closed tab.
  const sourceFiles = sources.map((s) => s.file);
  let job = await MJobs.find(sourceFiles).catch(() => null);
  let root = null;

  if (job && job.dirHandle && job.done.length) {
    if (await MJobs.ensureWritable(job.dirHandle)) {
      root = job.dirHandle;
      statusEl.textContent = `Continuing where this left off - ${job.done.length.toLocaleString()} already saved.`;
    } else {
      job = null; // permission declined; fall through to a fresh pick
    }
  }
  if (!root) {
    try {
      root = await window.showDirectoryPicker({ mode: "readwrite" });
    } catch { return; } // user cancelled
    job = await MJobs.start(sourceFiles, root, lib.media.length).catch(() => null);
  }
  const alreadyDone = new Set(job ? job.done : []);
  const tracker = job ? MJobs.progress(job) : null;

  const items = lib.media;
  const dirs = new Map();
  const getDir = async (parts) => {
    const key = parts.join("/");
    if (dirs.has(key)) return dirs.get(key);
    let d = root;
    for (const p of parts) d = await d.getDirectoryHandle(p, { create: true });
    dirs.set(key, d);
    return d;
  };

  let done = 0, failed = 0, repaired = 0, unrepairable = 0, skipped = 0;
  for (const m of items) {
    if (alreadyDone.has(m.path)) { skipped++; continue; }
    try {
      // Left out by a clean-up decision. The archive still has it; a tidied
      // copy is what this is writing, and it is not part of that.
      if (m.drop) { skipped++; continue; }

      const parts = m.at
        ? [String(m.at.getFullYear()), String(m.at.getMonth() + 1).padStart(2, "0")]
        : ["undated"];
      const dir = await getDir(parts);
      let bytes = await MZip.extract(sources[m.src || 0].file, m.entry);

      // Write the real capture date (and place) into the file itself, so
      // whatever you import it into afterwards sorts it correctly.
      if (repairDates && m.at) {
        if (MExif.isJpeg(bytes)) {
          try {
            bytes = MExif.writeDate(bytes, m.at, m.place || null);
            repaired++;
          } catch { unrepairable++; }
        } else {
          unrepairable++;
        }
      }

      const fh = await dir.getFileHandle(m.name, { create: true });
      const w = await fh.createWritable();
      await w.write(bytes);
      await w.close();
      done++;
      if (tracker) await tracker.mark(m.path);
    } catch {
      failed++;
    }
    if ((done + failed) % 10 === 0 || done + failed + skipped === items.length) {
      statusEl.textContent = `Saving... ${(done + failed + skipped).toLocaleString()} of ${items.length.toLocaleString()}` +
        (skipped ? ` (${skipped.toLocaleString()} already saved earlier)` : "");
    }
  }
  if (tracker) await tracker.flush();
  // Finished cleanly, so the job no longer needs to be resumable.
  if (job && failed === 0) await MJobs.remove(job.id).catch(() => {});
  note.done(`Saved ${plural(done, "file", "files")} into dated folders`, {
    body: (skipped ? `${skipped.toLocaleString()} were already saved before. ` : "") +
      (repaired ? `${repaired.toLocaleString()} had the correct date written in. ` : "") +
      (unrepairable ? `${unrepairable.toLocaleString()} were left as they were - only JPEG can be repaired. ` : "") +
      (failed ? `${failed} could not be written. ` : "") +
      (tally.drop ? `${tally.drop.toLocaleString()} left out by your clean-up choices, saving ` +
        `${fmtBytes(tally.freedBytes)}. ` : "") +
      "Your archives were not touched, and nothing was uploaded.",
  });
}

/* ---------- Near-duplicate photos (perceptual hashing) ----------
   Exact duplicates are found from the archive checksums. Photos that are the
   same picture but not the same file - a resized copy, a re-saved export, the
   same shot kept by two different services - need comparing by appearance.
   This is a difference hash: shrink to 9x8, greyscale, and record whether each
   pixel is brighter than its right-hand neighbour. Similar pictures then differ
   in only a few of those 64 bits. */

const POPCOUNT = (() => {
  const t = new Uint8Array(256);
  for (let i = 1; i < 256; i++) t[i] = (i & 1) + t[i >> 1];
  return t;
})();
function hamming(a, b) {
  let n = 0;
  for (let i = 0; i < 8; i++) n += POPCOUNT[a[i] ^ b[i]];
  return n;
}

/* A difference hash, plus the two numbers needed to know when not to trust it.

   dHash sets a bit where a pixel is brighter than the one to its right. On a
   photograph that is a good fingerprint. On a flat image it is meaningless, and
   worse than meaningless: in a solid black screenshot every pixel equals its
   neighbour, "brighter than" is false everywhere, and the hash is 64 zero bits.
   A solid white screenshot is uniform too, so it is also 64 zero bits. The two
   come out a Hamming distance of nothing apart, and a black picture and a white
   one get reported as the same picture - which is exactly what a library full
   of dark UI screenshots produced.

   So the mean luminance and the spread around it come back with the bits. The
   mean separates black from white; the spread says whether there was enough
   structure for the bits to mean anything at all. */
async function imageHash(blob) {
  const bmp = await createImageBitmap(blob);
  const W = 9, H = 8;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, W, H);
  if (bmp.close) bmp.close();
  const d = ctx.getImageData(0, 0, W, H).data;

  const lum = new Float32Array(W * H);
  for (let k = 0; k < W * H; k++) {
    const i = k * 4;
    lum[k] = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
  }
  let sum = 0;
  for (let k = 0; k < lum.length; k++) sum += lum[k];
  const mean = sum / lum.length;
  let sq = 0;
  for (let k = 0; k < lum.length; k++) sq += (lum[k] - mean) * (lum[k] - mean);
  const sd = Math.sqrt(sq / lum.length);

  const bits = new Uint8Array(8);
  let bit = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W - 1; x++) {
      if (lum[y * W + x] > lum[y * W + x + 1]) bits[bit >> 3] |= 1 << (bit & 7);
      bit++;
    }
  }
  return { bits, lum: Math.round(mean), sd: Math.round(sd) };
}

/* Every displayable picture, not the first few hundred. The cap was 400 with
   nothing said about it, so a library of three thousand was quietly compared in
   its first eighth and reported as if that were the answer. Hashing costs one
   decode per file and the result is filed under the file's contents forever, so
   the price is paid once. The remaining number is a runaway guard, not a
   sample, and if it ever bites the reader is told.

   A picture needs some structure before its fingerprint means anything, and
   near enough the same overall brightness before two are called the same. */
const SIMILAR_CAP = 25000;    // a bound, not a sample
const SIMILAR_DISTANCE = 6;   // bits of difference still counted as the same picture
const SIMILAR_MIN_SD = 12;    // flatter than this and the bits are noise
const SIMILAR_LUM = 26;       // how far apart two means may be

async function scanSimilar() {
  const { lib, sources } = current;
  const all = lib.media.filter((m) => m.renderable);
  const pool = all.slice(0, SIMILAR_CAP);
  const skipped = all.length - pool.length;
  if (pool.length < 2) {
    MNotify.push("Not enough photos to compare", {
      kind: "warn", body: "This library needs at least two displayable pictures." });
    return;
  }
  const note = MNotify.task("Comparing photos");
  const statusEl = { set textContent(v) { note.say(v); }, get textContent() { return ""; } };
  /* Hashing a photo costs a full decode, so it is done once per file ever.
     The results are filed under the file's contents, which means a photo that
     turns up again in next year's export - or in a second provider's export -
     is already done. */
  /* Hashing a photo costs a decode, so it is done once per file ever, and the
     result is filed under a digest of the contents. That is what makes a photo
     carried into next year's export - or arriving again inside a second
     provider's export - already done.

     The suggestion comes from the archive's own checksum and length, which
     cost nothing to read. Acting on a suggestion without confirming it is fine
     here: the worst a wrong match does is group two of your photos oddly, and
     you can see that it did. Anything that spends money calls verify() first. */
  const hints = pool.map((m) => MDerived.hintOfMedia(m));
  const known = await MDerived.suggest(hints);
  const hashed = [];
  const computed = [];
  let reused = 0;

  for (let i = 0; i < pool.length; i++) {
    const m = pool[i];
    const hint = hints[i];
    const prev = hint && known.get(hint);
    // Records written before the hash carried brightness and spread have no
    // way to answer "was there enough structure here", so they are redone.
    if (prev && prev.phash && prev.plum != null && prev.psd != null) {
      hashed.push({ m, hash: prev.phash, lum: prev.plum, sd: prev.psd });
      reused++;
      continue;
    }
    try {
      const bytes = await MZip.extract(sources[m.src || 0].file, m.entry);
      const [id, sig] = await Promise.all([
        MDerived.digest(bytes),
        imageHash(new Blob([bytes], { type: m.mime })),
      ]);
      hashed.push({ m, hash: sig.bits, lum: sig.lum, sd: sig.sd });
      // Deliberately no filename: it adds nothing, and a name like
      // "wedding-with-anna.jpg" is exactly the kind of thing that should not
      // sit in a file the user may back up or move around.
      computed.push({ id, hint, phash: sig.bits, plum: sig.lum, psd: sig.sd });
    } catch { /* unreadable image, skip */ }
    if (i % 15 === 0) {
      statusEl.textContent = `Comparing photos... ${i + 1} of ${pool.length}` +
        (reused ? ` (${reused.toLocaleString()} already done)` : "");
    }
  }
  if (computed.length) await MDerived.record(computed);

  /* A picture with almost no variation in it - a black screenshot, a blank
     scan - has no fingerprint worth comparing, so it is left out of the
     matching entirely rather than matched against every other flat picture in
     the library. */
  const flat = hashed.filter((h) => h.sd < SIMILAR_MIN_SD).length;
  const alike = (a, b) =>
    a.sd >= SIMILAR_MIN_SD && b.sd >= SIMILAR_MIN_SD &&
    Math.abs(a.lum - b.lum) <= SIMILAR_LUM &&
    hamming(a.hash, b.hash) <= SIMILAR_DISTANCE;

  const used = new Array(hashed.length).fill(false);
  const groups = [];
  for (let i = 0; i < hashed.length; i++) {
    if (used[i]) continue;
    const g = [hashed[i]];
    used[i] = true;
    for (let j = i + 1; j < hashed.length; j++) {
      if (!used[j] && alike(hashed[i], hashed[j])) {
        g.push(hashed[j]); used[j] = true;
      }
    }
    if (g.length > 1) groups.push(g.map((x) => x.m).sort((a, b) => b.size - a.size));
  }

  lib.similar = groups;
  lib.similarScanned = pool.length;
  const extra = groups.reduce((s, g) => s + g.slice(1).reduce((t, m) => t + m.size, 0), 0);
  // Redraw in place. Reopening the explorer would drop the reader back on the
  // timeline, which is not where they were when they asked for this.
  MExplorer.refresh();
  persist();

  /* Say plainly that nothing has been changed. "Found 13 groups" on its own
     reads like something was done about them. */
  note.done(groups.length
    ? `Found ${plural(groups.length, "group", "groups")} of pictures that look alike`
    : "No lookalike pictures found", {
    body: (groups.length
      ? `Nothing has been changed yet. Around ${fmtBytes(extra)} sits in the extra copies.`
      : "Every picture here is distinct, beyond the exact copies.") +
      ` ${pool.length.toLocaleString()} pictures compared.` +
      (flat ? ` ${flat.toLocaleString()} were too flat to fingerprint - a plain black or white
        picture has nothing to match on - so they were left out.`.replace(/\s+/g, " ") : "") +
      (skipped ? ` ${skipped.toLocaleString()} were not reached in this pass.` : "") +
      (reused ? ` ${reused.toLocaleString()} were already compared on an earlier visit.` : ""),
    action: groups.length ? "Decide what to keep" : null,
    goto: groups.length ? () => MExplorer.showView("cleanup") : null,
  });
}

async function renderSimilar(panel, lib) {
  const groups = (lib.similar || []).slice(0, 40);
  const extra = (lib.similar || []).reduce((s, g) => s + g.slice(1).reduce((t, m) => t + m.size, 0), 0);
  panel.innerHTML = `
    <p class="muted small">${plural(lib.similar.length, "group", "groups")} of photos that look the same,
      from the ${lib.similarScanned.toLocaleString()} compared. Keeping the largest of each and removing the rest
      would free about <strong>${fmtBytes(extra)}</strong>. Groups can include exact copies as well as resized ones.</p>
    ${groups.map((g, gi) => `
      <div class="dupe-group">
        <div class="dupe-head">${plural(g.length, "copy", "copies")} &middot; keeping the largest saves ${fmtBytes(g.slice(1).reduce((t, m) => t + m.size, 0))}</div>
        <div class="thumbs">
          ${g.map((m, mi) => `
            <figure class="thumb" data-g="${gi}" data-m="${mi}">
              <div class="ph"></div>
              <figcaption title="${esc(m.path)}">${mi === 0 ? '<span class="keep">keep</span> ' : ""}${esc(m.name)}<br /><span class="muted">${fmtBytes(m.size)}${m.srcLabel ? " &middot; " + esc(m.srcLabel) : ""}</span></figcaption>
            </figure>`).join("")}
        </div>
      </div>`).join("")}`;

  let budget = 60;
  for (let gi = 0; gi < groups.length && budget > 0; gi++) {
    for (let mi = 0; mi < groups[gi].length && budget > 0; mi++) {
      const m = groups[gi][mi];
      try {
        const blob = await MZip.extractBlob(current.sources[m.src || 0].file, m.entry, m.mime);
        const url = URL.createObjectURL(blob);
        objectUrls.push(url);
        const el = panel.querySelector(`.thumb[data-g="${gi}"][data-m="${mi}"] .ph`);
        if (el) { el.style.backgroundImage = `url("${url}")`; el.classList.add("has-img"); }
        budget--;
      } catch { /* skip */ }
    }
  }
}

/* ---------- Structure report ----------
   Describes the shape of an archive so a parser mismatch can be fixed without
   anyone sending their data. Shown in full before it can be saved. */

/* What is in the export, and how much of it Muletto understood.

   This exists to answer one question: did anything get missed? A parser that
   quietly ignores a folder looks identical to an export that never had it, and
   the reader has no way to tell those apart from the library alone.

   So it is built for every export as it opens, rather than hidden behind a
   button nobody presses until something has already gone wrong. It costs a
   fraction of a second and it is the only place that can say "your archive has
   4,000 files in a folder I did nothing with".

   It also has to be safe to hand over. It records shapes - folder layouts, key
   names, column headers, file types - and never a value, a message, or a name.
   Path segments that occur once are usually people, so they are replaced. */
async function buildReport(background) {
  if (!current.sources || !current.sources.length) return null;
  const note = background ? null : MNotify.task("Checking what is in your export");
  try {
    const reports = [];
    for (const src of current.sources) {
      if (note) note.say(`Reading the shape of ${src.name}...`);
      const r = await MDiagnose.build(src);
      r.parserRead = MDiagnose.coverage(src.lib);
      r.reconciled = MDiagnose.reconcile(src);
      r.sourceName = src.name;
      reports.push(r);
    }
    current.report = reports;
    current.reportJson = JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2);
    if (typeof MExplorer !== "undefined" && MExplorer.currentView()) MExplorer.refresh();

    /* Offer to report it, but only when the numbers say something is actually
       wrong, and only once per set of files. Silent otherwise. */
    if (typeof MContribute !== "undefined" && !current.demo) {
      const providers = (current.sources || [])
        .map((x) => (x.det ? x.det.label : null)).filter(Boolean);
      const key = (current.sources || []).map((x) => x.name).sort().join("|");
      try { MContribute.maybeOffer(reports, [...new Set(providers)], key); }
      catch (err) { /* never let an offer to help break the thing it is about */ }
    }
    if (note) {
      note.done("Checked your export", {
        body: "What is inside it, and how much of it was understood.",
        action: "See it",
        goto: () => MExplorer.showView("report"),
      });
    }
    return reports;
  } catch (e) {
    if (note) note.failed("Could not check the export: " + (e && e.message ? e.message : "unknown error"));
    return null;
  }
}

/* ---------- The library viewer ---------- */

function renderLibrary(root, lib, sources, entries, demo) {
  current = { sources, lib, entries, query: "", demo: !!demo };
  markExportOpen(sources, entries);
  if (!current.restoring) persist();

  // What the explorer needs from the app: live search text, a decoder for one
  // media record, and icon hydration for anything it injects.
  const ctx = {
    demo: !!current.demo,
    get query() { return current.query; },
    thumb: thumbUrl,
    /* Let go of one picture's decoded bytes.

       Every thumbnail holds the inflated file, which for a phone library is a
       few megabytes each. Keeping them all is how a library of three thousand
       turns into six gigabytes of resident memory, and a machine that is
       swapping loads pictures at wildly uneven speeds - which is what "some
       appear much faster than others" was. The grid recycles the ones furthest
       from the reader through here. */
    forget: (m) => {
      const key = (m.src || 0) + "|" + m.path;
      const p = thumbCache.get(key);
      if (!p) return;
      thumbCache.delete(key);
      Promise.resolve(p).then((url) => {
        if (!url) return;
        const i = objectUrls.indexOf(url);
        if (i >= 0) objectUrls.splice(i, 1);
        URL.revokeObjectURL(url);
      }).catch(() => {});
    },
    /* The file itself, for playing rather than looking at. Cached per file so
       reopening a clip does not inflate it a second time, and revoked with
       everything else when the library closes. */
    media: async (m) => {
      const key = "m|" + (m.src || 0) + "|" + m.path;
      if (thumbCache.has(key)) return thumbCache.get(key);
      let url = null;
      try {
        const src = current.sources[m.src || 0].file;
        const blob = await mediaBlob(m, src);
        if (blob) { url = URL.createObjectURL(blob); objectUrls.push(url); }
      } catch { url = null; }
      thumbCache.set(key, url);
      return url;
    },
    hydrate: (el) => el.querySelectorAll("[data-icon]").forEach((n) => {
      if (!n.firstChild) n.innerHTML = iconSvg(n.dataset.icon);
    }),
  };

  /* Built as soon as the library is open, in the background. Nobody goes
     looking for a coverage report until they already suspect something is
     wrong, and by then they have often already given up. */
  if (!current.report) setTimeout(() => buildReport(true), 400);

  MExplorer.open({
    lib, entries, sources, ctx,
    actions: {
      // Views the explorer does not own itself, so there is one copy of each.
      legacy: (k, panel, vctx, scoped) => {
        current.query = vctx.query;
        const use = scoped || lib;
        if (k === "photos") renderMedia(panel, use);
        else if (k === "similar") renderSimilar(panel, use);
        else if (k === "records") renderTables(panel, use);
        else if (k === "highlights") renderHighlights(panel, use);
        else renderFiles(panel, use === lib ? entries : entries.filter((e) => e.src === undefined || use.files.some((f) => f.entry === e)));
      },
      save: () => {
        if (!lib.media.length) {
          MNotify.push("Nothing to save", { kind: "warn",
            body: "This library has no photos or videos in it." });
          return;
        }
        MExport.open({ lib, sources, entries });
      },
      persist: () => {
        persist();
      },
      addSource: () => {
        // Deliberately does not close the explorer: the new export joins the
        // library you are already looking at.
        const f = $("#file");
        if (f) f.click();
      },
      findSimilar: () => scanSimilar(),
      plan: () => demoBlocked("Sorting by instruction") || MPlanUI.open({
        media: lib.media,
        thumb: (m) => ctx.thumb(m),
        // Buckets and drops change what the export writes, so the library is
        // saved and redrawn the moment a plan is applied or undone.
        onDone: () => {
          persist();
          MExplorer.refresh();
        },
      }),
      describe: () => demoBlocked("Tagging images with AI") || MCaptionUI.open({
        media: lib.media,
        sources,
        // The library is redrawn so the new descriptions are searchable at
        // once, and saved so they survive a reload even before an export.
        onDone: () => {
          persist();
          MExplorer.refresh();
        },
      }),
      manifest: downloadManifest,
      /* A copy of the work, as a file the user keeps.

         What is stored in the browser is enough to come back next month on
         this machine, but it is the browser's to evict and it does not travel.
         Anything that cost money must not depend on a cache. */
      saveWork: async (status) => {
        const n = await MDerived.count();
        if (!n) {
          status.textContent = "There is nothing worked out yet to save. Compare photos first, " +
            "and this will hold the results so they never need doing again.";
          return;
        }
        status.textContent = "Writing your work file...";
        const { blob, ext, raw } = await MDerived.toFile({
          sources: sources.map((x) => (x.det ? x.det.label : x.name)),
          items: entries.length,
        });
        const stamp = new Date().toISOString().slice(0, 10);
        download(`muletto-work-${stamp}.${ext}`, blob);
        status.textContent = `Saved what Muletto worked out about ${plural(n, "file", "files")} ` +
          `(${fmtBytes(blob.size)}${blob.size < raw ? ", compressed from " + fmtBytes(raw) : ""}). ` +
          "Keep it with your exports. It holds no photos and no messages - only the results, " +
          "filed against each file's contents, so it still applies to next year's export.";
      },

      loadWork: async (status) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".muletto,.json,.gz";
        input.addEventListener("change", async () => {
          if (!input.files.length) return;
          status.textContent = "Reading your work file...";
          try {
            const r = await MDerived.fromFile(input.files[0]);
            await MViews.loadLinks();
            status.textContent = `Restored what Muletto had worked out about ` +
              `${plural(r.total, "file", "files")}` +
              (r.written ? `, saved ${fmtDate(new Date(r.written))}` : "") +
              ". Anything that applies to what is open now will not be done again.";
          } catch (e) {
            status.textContent = e.message;
          }
        });
        input.click();
      },

      report: () => current.report || null,
      reportJson: () => current.reportJson || "",
      saveReport: (text) => download("muletto-structure-report.json",
        new Blob([text], { type: "application/json" })),

      /* Reports each stage, because clearing a large library is not instant -
         the thumbnails alone can be tens of thousands of records - and a
         dialog that sits there saying nothing is the thing that made this
         look broken in the first place. */
      forget: async (say) => {
        const tell = (m) => { if (typeof say === "function") say(m); };
        tell("Clearing the saved library...");
        await MStore.clear();
        tell("Clearing what was worked out...");
        await MDerived.clear();
        tell("Releasing the pictures...");
        thumbBlobs.clear();
        thumbCache.clear();
        try { sessionStorage.removeItem("muletto:open"); } catch { /* nothing kept */ }
        releaseUrls();
        current = { sources: [], lib: null, entries: null, query: "" };
        tell("Done.");
        MExplorer.close();
        /* Back to the front page. Staying here leaves an app with nothing in
           it and a drop zone that looks like the export failed to open. The
           toast is left for the next page to raise, since this one is about to
           be replaced. */
        try { sessionStorage.setItem("muletto:forgot", "1"); } catch { /* fine */ }
        location.href = "index.html";
        return;
        const panel = document.getElementById("import-result");
        if (panel) { panel.hidden = true; panel.innerHTML = ""; }
        document.querySelectorAll(".nav-explore").forEach((a) => a.remove());
      },
    },
  });

  /* What sits behind the explorer, for when it is closed.

     This replaces the whole import panel rather than appending to it. The
     panel holds a summary built when the files were first read, and opening a
     further export leaves that summary describing a library that no longer
     exists - which is what showed through as stale UI. One card, rebuilt from
     the current sources every time, cannot go stale. */
  const panel = document.getElementById("import-result") || root;
  panel.hidden = false;
  panel.innerHTML = `
    <div class="reopen">
      <div>
        <strong>${plural(sources.length, "export", "exports")} open</strong>
        <p class="muted small">${sources.map((s) => esc(s.det ? s.det.label : s.name)).join(", ")} -
        ${plural(entries.length, "file", "files")} read on this device, none uploaded.</p>
      </div>
      <button class="btn primary" id="reopen">Back to your data</button>
    </div>`;
  $("#reopen", panel).addEventListener("click", () =>
      renderLibrary(panel, lib, sources, entries, current.demo));

  // The "you had an export open" prompt is answered now.
  const stale = document.querySelector(".reopen-note");
  if (stale) stale.remove();
}

const THUMB_LIMIT = 48;

/* Decode one media record to a blob URL, whatever container it is in. Used by
   the photo grid and by the timeline when an item is expanded. Cached, because
   scrolling back over the same day should not decode the same HEIC twice. */
const thumbCache = new Map();

/* Shrink a picture before it is ever painted.

   A phone photograph is 4000px wide. Handing that straight to a 106px tile
   means the browser holds the full decoded bitmap - about 48 MB for one
   picture - and rescales it on every paint. With a few hundred tiles on screen
   that is gigabytes of bitmap and a scroll that stutters, which is exactly what
   showing more, smaller tiles exposed.

   360px is twice the widest tile, so it still looks sharp on a high-density
   screen, and costs about a hundredth of the memory. If the browser cannot
   resize on decode, the original is used rather than nothing. */
/* No re-encoding of thumbnails, deliberately.

   The obvious way to stop a 4000px photograph being decoded into a 106px tile
   is to write out a small copy of it. It was tried and it was a disaster.
   Measured over the pipeline, per picture:

       inflate out of the zip      ~3 ms
       decode, resized on the way  ~5 ms
       re-encode to a small JPEG   ~1010 ms

   The encode is a flat second whatever the picture weighs, and it sat between
   the reader and the first thing they see: about twenty seconds before a
   single tile appeared. Resizing during the decode - which is genuinely cheap
   - bought nothing, because the encode dominated everything.

   So the original bytes are handed straight to the tile, which costs about
   half a millisecond, and the browser decodes for paint the way it always did.
   What the warming pass buys is the inflate, which is the part that is
   actually ours to save.

   If large photographs make scrolling stutter again, the answer is a downscale
   in a worker, off the path the reader is waiting on - not on it. */

/* ---------- the thumbnail cache on disk ----------

   Built once per picture, kept in IndexedDB, and used for every tile from then
   on. This is the thing that makes a library of thousands behave: the grid
   reads 25 KB copies off disk instead of inflating and decoding megabytes, and
   the work is never done twice - not on the next visit, and not when the same
   photograph arrives again inside another service's export.

   The originals are still what gets opened, described, hashed and exported.
   These are only for looking at a wall of them at once. */

// hint -> small Blob, read back from disk. Blobs, not object URLs: a Blob is a
// handle to bytes the browser keeps on disk, so holding thousands costs
// almost nothing until one is actually turned into a URL and painted.
const thumbBlobs = new Map();

async function loadThumbIndex(media) {
  if (typeof MDerived === "undefined") return 0;
  const hints = media.map((m) => MDerived.hintOfMedia(m));
  const found = await MDerived.getThumbs(hints);
  for (const [h, b] of found) thumbBlobs.set(h, b);
  return found.size;
}

/* Make the ones that are missing, on background threads.

   Extraction stays here because the zip reader lives on this thread, and it is
   the cheap part - about 10 ms. The decode is fifty and the encode three, and
   those go to the workers, which is the whole point: three thousand pictures
   is two and a half minutes of decoding, and on this thread that is two and a
   half minutes of a page that cannot scroll or answer a click. */
async function buildThumbs(media, say) {
  if (typeof MDerived === "undefined" || typeof Worker !== "function") return 0;
  /* Videos are in this too. A clip with no poster was a grey square with a
     play badge and the word VIDEO on it, and it stayed that way because the
     first frame was only ever fetched when the tile scrolled into view - which
     means decoding a video, the slowest thing here, at the worst moment.
     Grabbing it once during the load and keeping the small copy makes a clip
     appear as fast as a photograph.

     Pictures first, because there are far more of them and they are what the
     grid opens on; the clips follow. */
  const pics = [], clips = [];
  for (const m of media) {
    const h = MDerived.hintOfMedia(m);
    if (!h || thumbBlobs.has(h)) continue;
    if (m.kind === "video") clips.push(m);
    else if (m.renderable && !m.heif) pics.push(m);
  }
  const todo = pics.concat(clips);
  if (!todo.length) return 0;

  // One less than the machine has, so the page keeps a core to draw with.
  const lanes = Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
  const workers = [];
  try {
    for (let i = 0; i < lanes; i++) workers.push(new Worker("thumbworker.js"));
  } catch {
    workers.forEach((w) => w.terminate());
    return 0;   // no workers available; the originals still work
  }

  let next = 0, done = 0, failed = 0;
  const pending = [];

  const flush = async (force) => {
    if (pending.length >= 40 || (force && pending.length)) {
      const batch = pending.splice(0, pending.length);
      await MDerived.putThumbs(batch);
    }
  };

  await new Promise((resolve) => {
    let live = workers.length;
    const feed = async (w) => {
      if (next >= todo.length) { if (--live === 0) resolve(); return; }
      const m = todo[next++];
      const hint = MDerived.hintOfMedia(m);
      let bytes = null;
      try {
        const file = current.sources[m.src || 0].file;
        if (m.kind === "video") {
          /* The poster has to be taken here: it needs a video element, and
             there is no such thing on a worker. What goes across is the frame,
             already a still image, which the worker shrinks like any other. */
          const clip = await MZip.extractBlob(file, m.entry, m.mime);
          const poster = clip ? await MVideo.posterFrame(clip) : null;
          bytes = poster ? await poster.arrayBuffer() : null;
        } else if (typeof MOverlay !== "undefined" && MOverlay.canMerge(m)) {
          /* Merged here rather than in the worker, because the caption has to
             go on before the picture is shrunk - a small copy made from the
             bare memory would be missing it for good, and this pass is what
             fills the disk cache the grid reads from afterwards. */
          bytes = await (await mediaBlob(m, file)).arrayBuffer();
        } else {
          bytes = await MZip.extract(file, m.entry);
        }
      } catch { bytes = null; }
      if (!bytes) { failed++; feed(w); return; }
      w.onmessage = (e) => {
        const r = e.data || {};
        if (r.ok && r.blob) {
          thumbBlobs.set(hint, r.blob);
          pending.push({ id: hint, blob: r.blob });
          done++;
        } else failed++;
        if (say && (done % 25 === 0 || done === todo.length)) {
          say("Preparing " + todo.length.toLocaleString() + " pictures... " +
              done.toLocaleString() + " done");
        }
        flush(false).then(() => feed(w));
      };
      // Transferred, not copied: the bytes are handed over rather than
      // duplicated, so a 4 MB photograph does not briefly exist twice.
      try { w.postMessage({ id: hint, bytes, type: m.mime }, [bytes.buffer || bytes]); }
      catch { w.postMessage({ id: hint, bytes, type: m.mime }); }
    };
    workers.forEach(feed);
  });

  await flush(true);
  workers.forEach((w) => w.terminate());
  return done;
}

/* The cache holds the promise, not the finished URL.

   It used to be filled only once the work had finished, so two callers asking
   for the same picture before either completed both decoded it - and that is
   the normal case here, with the visible tiles and the background warming pass
   both walking the library from the top. Every picture near the start was
   being inflated, shrunk and encoded twice. */
/* The picture as it was written, rather than as Snapchat filed it.

   Snapchat splits a captioned memory into the photograph and a transparent
   picture holding the caption, and hands you both. Everywhere a memory is
   shown, it is shown with its caption drawn back on, because that is what the
   person remembers taking. If the merge fails for any reason the original is
   used, so the worst case is the picture without its caption rather than no
   picture at all. */
async function mediaBlob(m, src) {
  const blob = await MZip.extractBlob(src, m.entry, m.mime);
  if (typeof MOverlay === "undefined" || !MOverlay.canMerge(m)) return blob;
  try {
    const over = await MZip.extractBlob(src, m.overlay, "image/png");
    return (await MOverlay.merge(blob, over, m.mime)) || blob;
  } catch { return blob; }
}

function thumbUrl(m) {
  const key = (m.src || 0) + "|" + m.path;
  if (thumbCache.has(key)) return thumbCache.get(key);
  const p = makeThumb(m);
  thumbCache.set(key, p);
  return p;
}

async function makeThumb(m) {
  let url = null;
  // The small copy off disk, if there is one. This is the normal path once a
  // library has been prepared, and it is why the grid stays quick.
  try {
    const hint = typeof MDerived !== "undefined" ? MDerived.hintOfMedia(m) : null;
    const small = hint && thumbBlobs.get(hint);
    if (small) {
      const u = URL.createObjectURL(small);
      objectUrls.push(u);
      return u;
    }
  } catch { /* fall through to the original */ }
  try {
    const src = current.sources[m.src || 0].file;
    let blob = null;
    /* A poster needs the file as a Blob, and a Blob has a ceiling: measured in
       Chrome, 1500 MB succeeds and 2048 MB fails outright. A Google Takeout
       can hold a 5.3 GB video, so without this the tile spends a minute
       inflating gigabytes only to fail and show nothing anyway. It shows
       nothing either way; this just declines to spend the minute. */
    if ((m.size || 0) > 1024 * 1024 * 1024) return null;
    if (m.kind === "video") {
      blob = await MVideo.posterFrame(await MZip.extractBlob(src, m.entry, m.mime));
    } else if (m.heif) {
      blob = await MHeif.toJpegBlob(await MZip.extract(src, m.entry), 0.85);
    } else if (m.renderable) {
      blob = await mediaBlob(m, src);
    }
    if (blob) { url = URL.createObjectURL(blob); objectUrls.push(url); }
  } catch { url = null; }
  return url;
}

async function renderMedia(panel, lib) {
  const q = current.query;
  const pool = q ? lib.media.filter((m) => m.path.toLowerCase().includes(q)) : lib.media;
  const shown = pool.slice(0, 200);
  if (!pool.length) { panel.innerHTML = `<p class="muted small">No photos or videos match "${esc(q)}".</p>`; return; }
  panel.innerHTML = `
    <p class="muted small">${plural(pool.length, "photo or video", "photos and videos")}${q ? ` matching "${esc(q)}"` : ""}${pool.length > shown.length ? `, showing the first ${shown.length}` : ""}.</p>
    <div class="thumbs">
      ${shown.map((m, i) => `
        <figure class="thumb" data-i="${i}">
          <div class="ph${m.kind === "video" ? " is-video" : ""}">${(m.renderable || m.heif || m.kind === "video") ? "" : esc((m.name.split(".").pop() || "file").toUpperCase())}</div>
          <figcaption title="${esc(m.path)}">${esc(m.name)}</figcaption>
        </figure>`).join("")}
    </div>`;

  // Decode a bounded number of images so a huge library stays responsive.
  let done = 0;
  for (let i = 0; i < shown.length && done < THUMB_LIMIT; i++) {
    const m = shown[i];
    if (!m.renderable && !m.heif && m.kind !== "video") continue;
    const url = await thumbUrl(m);
    const cell = panel.querySelector(`.thumb[data-i="${i}"] .ph`);
    if (!cell) continue;
    if (!url) { cell.textContent = m.kind === "video" ? "VIDEO" : "HEIC"; continue; }
    cell.style.backgroundImage = `url("${url}")`;
    cell.classList.add("has-img");
    done++;
  }
}

/* The cards, drawn.

   Charts are inline SVG on purpose: a charting library would be another
   hundred kilobytes for a line and some ticks, and it would want a CDN, which
   the Content-Security-Policy refuses on principle. */

/* explorer.js has its own num(); this file does not, and reaching for one
   that was not there threw inside the first card and left the previous
   view on screen with the new title above it. */
const cardNum = (n) => Number(n).toLocaleString();

function sparkline(points, w, h) {
  if (points.length < 2) {
    // One point is a reading, not a trend, and drawing a flat line implies one.
    return '<svg class="spark" viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" ' +
      'aria-hidden="true"><circle cx="' + (w / 2) + '" cy="' + (h / 2) + '" r="3" ' +
      'fill="currentColor"/></svg>';
  }
  const xs = points.map((p) => p.t), ys = points.map((p) => p.v);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (y1 === y0) { y0 -= 1; y1 += 1; }        // a flat line still needs a scale
  const pad = 3;
  const px = (t) => pad + ((t - x0) / (x1 - x0 || 1)) * (w - pad * 2);
  const py = (v) => h - pad - ((v - y0) / (y1 - y0)) * (h - pad * 2);
  const d = points.map((p, i) => (i ? "L" : "M") + px(p.t).toFixed(1) + " " + py(p.v).toFixed(1)).join(" ");
  const area = d + " L" + px(x1).toFixed(1) + " " + (h - pad) + " L" + px(x0).toFixed(1) + " " + (h - pad) + " Z";
  return '<svg class="spark" viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" aria-hidden="true">' +
    '<path class="spark-fill" d="' + area + '"/>' +
    '<path class="spark-line" d="' + d + '"/></svg>';
}

function barRow(label, value, max, note) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return '<li class="bar"><span class="bar-l">' + esc(label) + "</span>" +
    '<span class="bar-t"><span class="bar-f" style="width:' + pct + '%"></span></span>' +
    '<em class="bar-n">' + esc(note != null ? note : cardNum(value)) + "</em></li>";
}

const shortDate = (ms) => new Date(ms).toLocaleDateString(undefined,
  { year: "numeric", month: "short" });

function cardHtml(c) {
  const span = c.span && c.span.from
    ? '<span class="card-span">' + shortDate(c.span.from) +
      (c.span.to - c.span.from > 86400000 ? " to " + shortDate(c.span.to) : "") + "</span>"
    : "";
  const head = '<header><h3>' + esc(c.title) + "</h3>" +
    (c.source ? '<span class="card-src">' + esc(c.source) + "</span>" : "") + "</header>";

  if (c.kind === "series") {
    return '<article class="card card-series">' + head +
      '<div class="card-figure"><strong>' + esc(c.stat) +
        (c.unit ? '<em class="card-unit">' + esc(c.unit) + "</em>" : "") + "</strong>" +
        '<span class="muted small">' + esc(c.statLabel) + "</span></div>" +
      (c.chart ? sparkline(c.points, 320, 64) : "") +
      "<footer>" +
        (c.chart ? "<span>" + esc(c.low) + " low</span><span>" + esc(c.high) + " high</span>" : "") +
        "<span>" + cardNum(c.n) + (c.n === 1 ? " reading" : " readings") + "</span>" +
      "</footer>" + span + "</article>";
  }
  if (c.kind === "money") {
    const max = Math.max(...c.years.map((y) => y.n), 0);
    /* "across 4 charges" on a table of 197 live chat messages said the table
       was four charges. It was four rows that carried a price out of nearly
       two hundred that did not, and saying both is the whole difference
       between a number and a fact. */
    const where = c.rows && c.rows > c.n
      ? "over " + cardNum(c.n) + " of " + cardNum(c.rows) + " rows"
      : "across " + cardNum(c.n) + (c.n === 1 ? " row" : " rows");
    return '<article class="card card-money">' + head +
      '<div class="card-figure"><strong>' + esc(c.stat) + "</strong>" +
        '<span class="muted small">' + esc(where) + "</span></div>" +
      (c.years.length
        ? '<ul class="bars">' + c.years.map((y) => barRow(y.label, y.n, max, MInsight.fmtNum(y.n))).join("") + "</ul>"
        : '<p class="muted small">No dates on these, so they cannot be split by year.</p>') +
      span + "</article>";
  }
  if (c.kind === "facts") {
    return '<article class="card card-facts">' + head +
      '<dl>' + c.facts.map(([k, v]) =>
        "<dt>" + esc(k) + '</dt><dd title="' + esc(String(v).slice(0, 400)) + '">' +
        esc(v) + "</dd>").join("") + "</dl>" +
      (c.n > c.facts.length ? '<p class="muted small">' + cardNum(c.n - c.facts.length) + " more</p>" : "") +
      "</article>";
  }
  if (c.kind === "rank") {
    const max = Math.max(...c.bars.map((b) => b.n), 0);
    return '<article class="card card-rank">' + head +
      (c.subtitle ? '<p class="muted small">' + esc(c.subtitle) + "</p>" : "") +
      '<ul class="bars">' + c.bars.map((b) => barRow(b.label, b.n, max)).join("") + "</ul>" +
      '<footer><span>' + cardNum(c.n) + " rows</span></footer>" + span + "</article>";
  }
  if (c.kind === "list") {
    /* "16 more" with nothing to click was a card telling the reader what it
       had decided not to show them. The rest are in the page, hidden, and the
       button reveals them. */
    const shown = c.items.slice(0, 12);
    const rest = c.items.slice(12);
    const li = (it) => "<li><span>" + esc(it.label) + "</span>" +
      (it.at ? "<time>" + shortDate(it.at) + "</time>" : "") + "</li>";
    const hiddenInFile = c.n - c.items.length;
    return '<article class="card card-list">' + head +
      '<ol class="card-items">' + shown.map(li).join("") +
      (rest.length ? '<span class="card-rest" hidden>' + rest.map(li).join("") + "</span>" : "") +
      "</ol>" +
      (rest.length
        ? '<footer><button type="button" class="card-more linklike" data-n="' + rest.length + '">' +
          "Show " + cardNum(rest.length) + " more</button></footer>"
        : "") +
      (hiddenInFile > 0
        ? '<footer><span class="muted">' + cardNum(hiddenInFile) +
          " more are in the table, under Records.</span></footer>" : "") +
      span + "</article>";
  }
  if (c.kind === "other") {
    return '<article class="card card-other">' + head +
      '<p class="muted small">' + esc(c.note) + "</p>" +
      '<ul class="thin">' + c.rows.map((r) =>
        "<li><span>" + esc(r.label) + "</span><em>" + cardNum(r.n) + "</em></li>").join("") + "</ul></article>";
  }
  return '<article class="card">' + head +
    '<div class="card-figure"><strong>' + esc(c.stat || "") + "</strong>" +
    '<span class="muted small">' + esc(c.statLabel || "") + "</span></div>" + span + "</article>";
}

/* Which services answered, and which did not.

   Samsung omits an archive entirely when a service holds nothing, so an export
   never says what is missing. Without this the reader cannot tell "I never
   used that" from "I asked for the wrong thing" - and the second is fixable. */
/* `want` picks which half of the coverage a caller wants.
   "services" is what the export sent as a whole and belongs with the other
   summaries. "groups" is the breakdown inside one service - the seventeen
   kinds of Samsung Health - and belongs on the Health page beside the
   readings, not buried under Highlights where it was found. */
function coverageHtml(lib, want) {
  if (typeof MCatalog === "undefined") return "";
  /* Only the sources still switched on. The library handed in here is already
     filtered, so the archives are read back out of it rather than from the
     full list - otherwise switching Samsung off left its coverage panel behind
     saying what Samsung had sent. */
  const on = new Set();
  for (const arr of [lib.files, lib.media, lib.tables, lib.events, lib.places]) {
    for (const x of arr || []) if (x && x.src !== undefined) on.add(x.src);
  }
  const live = (current.sources || []).filter((_, i) => on.has(i));
  if (!live.length) return "";

  const names = live.map((s) => s.name);
  const paths = []
    .concat((lib.files || []).map((f) => f.path))
    .concat((lib.media || []).map((m) => m.path))
    .concat((lib.tables || []).map((t) => t.path));
  const tables = (lib.tables || []).map((t) => t.name);

  const slugs = [];
  for (const s of live) {
    const slug = s.det && s.det.slug;
    if (slug && slugs.indexOf(slug) < 0) slugs.push(slug);
  }

  let out = "";
  for (const slug of slugs) {
    const c = MCatalog.coverage(slug, names, paths, tables);
    if (!c) continue;

    const tile = (svc, on) =>
      '<li class="cov' + (on ? " on" : " off") + '">' +
        "<h4>" + esc(svc.name) + "</h4>" +
        "<p>" + esc(svc.holds) + "</p>" +
        (!on && svc.needs ? '<p class="cov-need">Needs ' + esc(svc.needs) + "</p>" : "") +
        (!on && svc.unknownName
          ? '<p class="cov-need">Samsung has not published a name for this archive, so we ' +
            "cannot tell whether yours arrived.</p>" : "") +
        (svc.note ? '<p class="cov-need">' + esc(svc.note) + "</p>" : "") +
      "</li>";

    const wantServices = want !== "groups";
    const wantGroups = want !== "services";
    out += '<section class="cov-block">' + (!wantServices ? "" :
      "<h3>" + esc(c.label) + " sent " + c.found.length + " of " +
        (c.found.length + c.absent.length) + " services</h3>" +
      '<p class="muted small">A service that holds nothing for you is left out of the export ' +
        "entirely, so this is the only place it shows up. Greyed means it was not in " +
        "what you opened.</p>" +
      '<ul class="cov-grid">' +
        c.found.map((x) => tile(x, true)).join("") +
        c.absent.map((x) => tile(x, false)).join("") +
      "</ul>");

    for (const g of (wantGroups ? c.groups : [])) {
      const have = g.items.filter((i) => i.found).length;
      out += '<div class="cov-sub' + (g.active ? "" : " off") + '">' +
        "<h4>" + esc(g.title) + " - " + have + " of " + g.items.length + "</h4>" +
        '<p class="muted small">' + esc(g.blurb) + "</p>" +
        '<ul class="cov-chips">' + g.items.map((i) =>
          '<li class="' + (i.found ? "on" : "off") + '" title="' +
            esc(i.holds + (i.needs && !i.found ? " Needs " + i.needs : "")) + '">' +
            esc(i.name) + "</li>").join("") + "</ul></div>";
    }
    out += "</section>";
  }
  return out;
}

function renderHighlights(panel, lib) {
  const cards = (typeof MInsight !== "undefined" ? MInsight.build(lib.tables) : []);
  const cover = coverageHtml(lib, "services");
  if (!cards.length && !cover) {
    panel.innerHTML = '<div class="ex-empty"><h3>Nothing to summarise yet</h3>' +
      '<p class="muted">This is where the records an export ships get turned into ' +
      "something readable - what you measured, what you bought, what you saved. " +
      "Nothing in this library shipped tables of that kind.</p></div>";
    return;
  }
  panel.innerHTML = cover + '<div class="cards">' + cards.map(cardHtml).join("") + "</div>";

}

/* On the document, not on the panel.
 *
 * The explorer hands a fresh panel to each render and discards the previous
 * one, so a listener bound to the panel was gone by the time anybody clicked -
 * the button was there, styled and labelled, and did nothing at all. Bound
 * once here, it survives every redraw. */
document.addEventListener("click", (ev) => {
  const btn = ev.target.closest && ev.target.closest(".card-more");
  if (!btn) return;
  const card = btn.closest(".card");
  const rest = card && card.querySelector(".card-rest");
  if (!rest) return;
  rest.hidden = !rest.hidden;
  btn.textContent = rest.hidden
    ? "Show " + cardNum(Number(btn.dataset.n)) + " more"
    : "Show fewer";
});

/* A cell that is not a string.

   Apple's Game Center table keeps an array of objects per row, and String()
   on those gives "[object Object],[object Object]" - a column of the same six
   words repeated down the page, which is worse than showing nothing because
   it looks like the data. Objects are summarised by what is in them, and the
   whole value is kept in the title so it is still reachable. */
/* A YouTube playlist in a Takeout is a column of eleven-character video IDs
   and nothing else - `Foreign videos.csv` is `Video ID, Playlist video
   creation timestamp`. The titles are not withheld by us; Google does not put
   them in the export at all, except for videos on your own channel, which
   arrive in `videos.csv` with a title beside them.
 *
 * So: resolve the ones the export actually names, and make the rest a link,
 * because an ID nobody can read is one click from the video it names. */
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const ytTitles = new Map();

function learnVideoTitles(lib) {
  for (const t of lib.tables || []) {
    const idAt = (t.columns || []).findIndex((c) => /^video id$/i.test(c));
    const tiAt = (t.columns || []).findIndex((c) => /^video title/i.test(c));
    if (idAt < 0 || tiAt < 0) continue;
    for (const row of t.rows || []) {
      const id = String(row[idAt] || "").trim();
      const title = String(row[tiAt] == null ? "" : row[tiAt]).trim();
      if (YT_ID.test(id) && title) ytTitles.set(id, title);
    }
  }
}

function videoCell(v) {
  const id = String(v == null ? "" : v).trim();
  if (!YT_ID.test(id)) return null;
  const known = ytTitles.get(id);
  const url = "https://www.youtube.com/watch?v=" + encodeURIComponent(id);
  return '<a href="' + url + '" target="_blank" rel="noopener noreferrer nofollow">' +
    esc(known || id) + "</a>" + (known ? "" : "");
}

function cellText(v) {
  if (v == null) return "";
  if (typeof v !== "object") return String(v);
  if (Array.isArray(v)) {
    if (!v.length) return "";
    const parts = v.map(cellText).filter(Boolean);
    return parts.length > 3
      ? parts.slice(0, 3).join(", ") + " and " + (parts.length - 3) + " more"
      : parts.join(", ");
  }
  // An object with one useful string in it is that string.
  const keys = Object.keys(v);
  const named = keys.find((k) => /^(name|title|label|value|text|id)$/i.test(k) &&
    typeof v[k] !== "object");
  if (named) return String(v[named]);
  const flat = keys.filter((k) => typeof v[k] !== "object" && v[k] !== "" && v[k] != null);
  if (!flat.length) return keys.length + (keys.length === 1 ? " field" : " fields");
  return flat.slice(0, 3).map((k) => k + ": " + v[k]).join(", ");
}

const cellTitle = (v) => (v && typeof v === "object" ? JSON.stringify(v) : "");

/* Which columns a person came to read.
 *
 * `comments.csv` is Comment ID, Channel ID, timestamp, Price, Parent comment
 * ID, Post ID, Video ID, **Comment text**, Top-level comment ID. Shown in file
 * order that puts four opaque identifiers on screen and pushes the actual
 * comment off the right edge behind a scrollbar - which reads, reasonably
 * enough, as the text having been withheld. It was there the whole time.
 *
 * The columns are not reordered arbitrarily: identifiers are moved to the end
 * and everything else keeps its original order, so the table still looks like
 * the file it came from. */
const ID_COLUMN = /(^|[ _])(id|ids|uuid|guid|hash|token|key)([ _]|$)/i;

function readableOrder(columns) {
  const order = columns.map((c, i) => i);
  return order.sort((a, b) => {
    const ai = ID_COLUMN.test(columns[a]) ? 1 : 0;
    const bi = ID_COLUMN.test(columns[b]) ? 1 : 0;
    return ai - bi || a - b;
  });
}

function renderTables(panel, lib) {
  learnVideoTitles(lib);
  if (!lib.tables.length) {
    panel.innerHTML = `<div class="ex-empty"><h3>No record tables here</h3>
      <p class="muted">These are the spreadsheets and lists an export ships - purchases,
      login history, subscriptions. Not every service includes them.</p></div>`;
    return;
  }
  panel.innerHTML = `
    <div class="pills">
      ${lib.tables.map((t, i) => `<button class="pill${i ? "" : " on"}" data-i="${i}">${esc(t.name)}</button>`).join("")}
    </div>
    <div id="tablebox"></div>`;
  const box = $("#tablebox", panel);
  const draw = (i) => {
    const t = lib.tables[i];
    const rows = t.rows.slice(0, 200);
    const ord = readableOrder(t.columns);
    const from = t.fromFiles > 1
      ? ` Joined from ${plural(t.fromFiles, "file", "files")} the export split it across.` : "";
    box.innerHTML = `
      <p class="muted small">${plural(t.rows.length, "row", "rows")}${t.rows.length > rows.length ? `, showing 200` : ""}.${from}</p>
      <div class="tablewrap"><table>
        <thead><tr>${ord.map((ci) => `<th>${esc(t.columns[ci])}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((r) => `<tr>${ord.map((ci) => {
          const col = t.columns[ci];
          const v = r[ci];
          // Only in a column that says it holds video IDs, so an eleven
          // character string somewhere else is not turned into a link.
          if (/video id/i.test(col)) {
            const link = videoCell(v);
            if (link) return `<td>${link}</td>`;
          }
          const title = cellTitle(v);
          return `<td${title ? ` title="${esc(title.slice(0, 400))}"` : ""}>${esc(cellText(v))}</td>`;
        }).join("")}</tr>`).join("")}</tbody>
      </table></div>`;
  };
  if (lib.tables.length) draw(0);
  panel.querySelectorAll(".pill").forEach((b) =>
    b.addEventListener("click", () => {
      panel.querySelectorAll(".pill").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      draw(Number(b.dataset.i));
    })
  );
}

function renderFiles(panel, entries) {
  if (!entries.length) {
    panel.innerHTML = `<div class="ex-empty"><h3>No files to list</h3>
      <p class="muted">Nothing in the archives matches what you are looking at.</p></div>`;
    return;
  }
  const q = current.query;
  const pool = q ? entries.filter((e) => e.name.toLowerCase().includes(q)) : entries;
  const rows = [...pool].sort((a, b) => b.size - a.size).slice(0, 500);
  if (!pool.length) { panel.innerHTML = `<p class="muted small">No files match "${esc(q)}".</p>`; return; }
  panel.innerHTML = `
    <p class="muted small">${plural(pool.length, "file", "files")}${q ? ` matching "${esc(q)}"` : ""}${pool.length > rows.length ? ", showing the 500 largest" : ""}. Click one to look at it.</p>
    <div class="filelist">
      ${rows.map((e, i) => `<div class="fl-row" data-i="${i}"><span class="fl-name">${esc(e.name)}${SNIFF_LABEL[e.sniffedAs] ? `<em class="fl-kind">${SNIFF_LABEL[e.sniffedAs]}</em>` : ""}<i class="fl-go">${FL_ARROW}</i></span><span class="sz">${fmtBytes(e.size)}</span></div>`).join("")}
    </div>`;

  /* A list of file names you cannot open is a directory listing, not a way to
     look at your own data - and All files is where everything the rest of the
     app did not claim ends up, so it is exactly where being able to look
     matters most.
   *
   * Opened in the side panel, the same one the timeline uses. It used to
   * expand inside its own row, which pushed the rest of the list down the
   * page and gave a photograph the width of a file name to be shown in. */
  panel.addEventListener("click", async (ev) => {
    const row = ev.target.closest && ev.target.closest(".fl-row");
    if (!row) return;
    const entry = rows[Number(row.dataset.i)];

    /* Nothing this page can draw: open it, rather than explaining. */
    if (!INLINE_EXT.test(entry.name) && !INLINE_SNIFFED.has(entry.sniffedAs)) {
      row.classList.add("fl-busy");
      try {
        const src = current.sources[entry.src || 0];
        const type = /\.pdf$/i.test(entry.name) ? "application/pdf" : "application/octet-stream";
        const url = URL.createObjectURL(await MZip.extractBlob(src.file, entry, type));
        objectUrls.push(url);
        window.open(url, "_blank", "noopener");
      } catch (err) {
        const box = MExplorer.showPanel(entry.name.split("/").pop(), entry.name, "note");
        if (box) {
          box.innerHTML = '<p class="muted small">That would not open: ' +
            esc(String((err && err.message) || err)) + "</p>";
        }
      }
      row.classList.remove("fl-busy");
      return;
    }

    panel.querySelectorAll(".fl-row.on").forEach((r) => r.classList.remove("on"));
    row.classList.add("on");

    const name = entry.name.split("/").pop();
    const where = [fmtBytes(entry.size), entry.name].filter(Boolean).join(" - ");
    const box = MExplorer.showPanel(name, where, "note");
    if (!box) return;
    box.innerHTML = '<p class="muted small">Reading...</p>';
    try {
      box.innerHTML = await previewHtml(entry);
    } catch (err) {
      box.innerHTML = '<p class="muted small">That would not open: ' +
        esc(String((err && err.message) || err)) + "</p>";
    }
  });
}

/* Everything is built from a blob made here, so looking at a file is still
   the file never leaving the machine.
 *
 * What each kind gets is decided by what the Content-Security-Policy actually
 * permits, not by what would be nice: `img-src` and `media-src` both allow
 * `blob:`, so pictures, audio and video play inline. `object-src` is 'none'
 * and there is no `frame-src`, so a PDF cannot be embedded however much one
 * would like it to be - it gets a link that opens it in its own tab, which is
 * still local and still nothing fetched. */
const PREVIEW_MAX = 2 * 1024 * 1024;

/* Slides in on hover. A row that does something should look like a row that
   does something before it is clicked, not after. */
const FL_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M5 12h13M13 6.5l5.5 5.5-5.5 5.5"/></svg>';

/* Kinds the page can draw in place. Everything else opens in its own tab,
   because a paragraph explaining why a PDF cannot be embedded is not what
   somebody clicking a PDF wanted - they wanted the PDF. */
const INLINE_SNIFFED = new Set(["webpage", "mbox"]);
/* Samsung names a saved page hashCode1539051287 and gives it no extension, so
   the only way anybody learns what it is, is if the row says so. */
const SNIFF_LABEL = { webpage: "saved web page", mbox: "mail" };

/* A saved web page, actually shown as one.
 *
 * MHTML is a MIME document: a boundary, then the page's HTML in one part and
 * every image, stylesheet and script in the others. Dumping it as text - which
 * is what this did first - puts a screenful of base64 in front of somebody who
 * asked to see a page they saved, and counting that as "read" is the kind of
 * overclaiming this file is otherwise careful about.
 *
 * The HTML part is pulled out, decoded, and put through the same sanitiser the
 * mail view uses, because it is somebody else's markup for exactly the same
 * reasons. The other parts are left alone: a page's images were saved as cid:
 * references, and the Content-Security-Policy refuses those anyway. */
function qpDecode(text) {
  return String(text || "")
    .replace(/=\r?\n/g, "")                               // soft line break
    .replace(/=([0-9A-Fa-f]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
}

function mhtmlHtml(raw) {
  const text = String(raw || "");
  const boundary = (/boundary="?([^"\r\n;]+)"?/i.exec(text.slice(0, 4000)) || [])[1];
  if (!boundary) return null;
  const parts = text.split("--" + boundary);
  let best = null;
  for (const part of parts) {
    const split = part.indexOf("\r\n\r\n") >= 0 ? part.indexOf("\r\n\r\n") : part.indexOf("\n\n");
    if (split < 0) continue;
    const head = part.slice(0, split);
    if (!/content-type:\s*text\/html/i.test(head)) continue;
    let body = part.slice(split).replace(/^(\r?\n){2}/, "");
    const enc = ((/content-transfer-encoding:\s*([\w-]+)/i.exec(head) || [])[1] || "").toLowerCase();
    const charset = ((/charset="?([\w-]+)"?/i.exec(head) || [])[1] || "utf-8").toLowerCase();
    /* Both encodings hand back *bytes*, one per character position, and
       stopping there is how an accented word came out with a stray capital A
       in front of it - the same mistake mojibake.js exists to undo for Meta.
       The bytes have to go to a decoder that knows the charset. */
    const asBytes = (str) => {
      const b8 = new Uint8Array(str.length);
      for (let i = 0; i < str.length; i++) b8[i] = str.charCodeAt(i) & 0xff;
      try { return new TextDecoder(charset).decode(b8); }
      catch (e) { return new TextDecoder("utf-8").decode(b8); }
    };
    if (enc === "quoted-printable") body = asBytes(qpDecode(body));
    else if (enc === "base64") {
      try { body = asBytes(atob(body.replace(/\s+/g, ""))); }
      catch (e) { /* leave it as written */ }
    }
    // The largest html part is the page; the rest are frames and fragments.
    if (!best || body.length > best.length) best = body;
  }
  return best;
}
const INLINE_EXT = new RegExp("\\.(jpe?g|png|gif|webp|bmp|avif|heic|heif|" +
  "mp4|mov|m4v|webm|mp3|m4a|wav|aac|ogg|opus|flac|" +
  "json|csv|txt|xml|html?|vcf|ics|md|log|srt|tsv)$", "i");

async function previewHtml(entry) {
  const src = current.sources[entry.src || 0];
  if (!src || !src.file) return '<p class="muted small">That archive is no longer open.</p>';
  const name = entry.name.split("/").pop();
  const ext = (name.split(".").pop() || "").toLowerCase();

  const blobFor = async (type) => {
    const b = await MZip.extractBlob(src.file, entry, type);
    const url = URL.createObjectURL(b);
    objectUrls.push(url);
    return url;
  };

  if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "avif"].includes(ext)) {
    return '<img class="fl-img" alt="" src="' + (await blobFor(MParse.mimeOf(name))) + '">';
  }
  if (MParse.heifFamily && MParse.heifFamily(name) && typeof MHeif !== "undefined") {
    const jpeg = await MHeif.toJpegBlob(await MZip.extract(src.file, entry), 0.85);
    const url = URL.createObjectURL(jpeg);
    objectUrls.push(url);
    return '<img class="fl-img" alt="" src="' + url + '">';
  }
  if (["mp4", "mov", "m4v", "webm"].includes(ext)) {
    return '<video class="fl-media" controls preload="metadata" src="' +
      (await blobFor(MParse.mimeOf(name))) + '"></video>';
  }
  if (["mp3", "m4a", "wav", "aac", "ogg", "opus", "flac"].includes(ext)) {
    return '<audio class="fl-media" controls preload="none" src="' +
      (await blobFor(MParse.mimeOf(name))) + '"></audio>';
  }

  const TEXTY = ["json", "csv", "txt", "xml", "html", "htm", "vcf", "ics", "md", "log", "srt", "tsv"];
  /* Recognised by its first bytes rather than its name - a saved web page
     with no extension is still text, and showing it beats showing nothing. */
  if (entry.sniffedAs === "webpage") {
    const raw = await MZip.extractText(src.file, entry);
    const subject = ((/^subject:\s*(.+)$/im.exec(raw.slice(0, 2000)) || [])[1] || "").trim();
    const when = ((/^date:\s*(.+)$/im.exec(raw.slice(0, 2000)) || [])[1] || "").trim();
    const html = mhtmlHtml(raw);
    const head = '<p class="muted small">A web page you saved in your browser' +
      (when ? " on " + esc(when) : "") + ", shown from the archive.</p>";
    if (!html) {
      return head + '<p class="muted small">The page itself could not be pulled ' +
        "out of the file.</p>";
    }
    return (subject ? "<h4>" + esc(subject) + "</h4>" : "") + head +
      '<div class="fl-page">' +
      (typeof MTopics !== "undefined" && MTopics.safeHtml
        ? MTopics.safeHtml(html, "They were saved inside this file, which is not " +
            "unpacked here - nothing was requested from the web to show this.")
        : '<pre class="fl-text">' + esc(html.slice(0, 100000)) + "</pre>") +
      "</div>";
  }

  if (TEXTY.includes(ext) || entry.sniffedAs === "mbox") {
    if ((entry.size || 0) > PREVIEW_MAX) {
      return '<p class="muted small">' + esc(fmtBytes(entry.size)) +
        " of text, which is more than is worth putting on screen at once.</p>";
    }
    let text = await MZip.extractText(src.file, entry);
    if (ext === "json") {
      // Pretty-printed, because one line of minified JSON is not readable and
      // this is the format most of an export arrives in.
      try { text = JSON.stringify(JSON.parse(text), null, 2); } catch (e) { /* as written */ }
    }
    if (typeof MMoji !== "undefined" && MMoji.repair) text = MMoji.repair(text) || text;
    return '<pre class="fl-text">' + esc(text.slice(0, 200000)) +
      (text.length > 200000 ? "\n\n... cut here" : "") + "</pre>";
  }

  /* Unreachable in practice - the caller opens anything not on the inline
     list in its own tab before getting here - but a kind that slips through
     should say so rather than show an empty box. */
  return '<p class="muted small">Nothing here can draw a <code>.' + esc(ext) +
    "</code>.</p>";
}

/* ---------- Wiring ---------- */

/* Sample exports shipped with the site, so the opener can be tried before a
   real export has arrived. They mimic the real folder layouts at a tiny size. */
const SAMPLES = ["snapchat-export.zip", "apple-export.zip", "google-takeout.zip",
                "instagram-export.zip", "samsung-export.zip"];

/* A content stamp for the archives, written by the build.
 *
 * The samples were the only asset on the site served under a name that could
 * change meaning, and it bit twice. The service worker answers from its cache
 * first, and it deliberately keeps the samples - they are nine megabytes and
 * the page tells people to pull their connection - so a rebuilt archive under
 * the same URL is a cached archive forever, or at least until the shell
 * version happens to roll and the reader happens to close every tab.
 *
 * `cache: "no-cache"` below was the first attempt and it is not enough: it
 * revalidates with the server, and the service worker never asks the server.
 * A stamped URL is a different URL, so there is nothing to answer from.
 *
 * The name the reader sees is still the plain one - the stamp is stripped
 * before the File is made. */
/* BUILD:SAMPLES */
const SAMPLES_V = "5b26f332";
/* END:SAMPLES */

async function loadSamples(btn) {
  const label = btn.textContent;
  btn.disabled = true;
  /* Up front, before the archives are even fetched. Putting "Loading..." on the
     button and only raising the curtain once handleFiles started meant a second
     of a page that looked like it had ignored the click, followed by a curtain
     that flashed past. The click is the moment to answer. */
  showCurtain("Fetching the sample exports...");
  try {
    const files = [];
    for (const name of SAMPLES) {
      /* The page tells people to turn their connection off, so this is a
         thing that will genuinely be clicked with no network. Saying which
         one it is beats a generic failure. */
      let res;
      try {
        /* Revalidated, not taken from the cache on faith.
         *
         * Every other asset carries a content stamp in its URL, so a change is
         * a new name. The samples deliberately do not - they are nine
         * megabytes and are kept only once somebody asks for them - which
         * means their URL stays the same while their contents change between
         * builds. A sample gained thirteen files and the browser went on
         * serving the old archive, and so did the service worker, because it
         * filled its own new cache from the stale HTTP one.
         *
         * `no-cache` asks the server whether it changed rather than assuming
         * it did not. Offline this still throws, and the message below is the
         * one that matters. */
        res = await fetch("samples/" + name + (SAMPLES_V ? "?v=" + SAMPLES_V : ""),
                          { cache: "no-cache" });
      } catch (err) {
        throw new Error(navigator.onLine
          ? "The sample exports could not be fetched."
          : "The samples are the one part of this page that has to be downloaded, " +
            "and you are offline. Your own export needs no connection - drop it in " +
            "and it opens. Or reconnect for a moment to fetch the samples, after " +
            "which they work offline too.");
      }
      if (!res.ok) throw new Error("missing " + name);
      files.push(new File([await res.blob()], name));
    }
    await handleFiles(files, { demo: true });
    const out = $("#import-result");
    if (out) {
      const note = document.createElement("div");
      note.className = "note";
      note.innerHTML = "These are <strong>sample exports</strong>, not your data - five small archives " +
        "shaped like the real thing. The same photo appears in more than one of them, which is what the " +
        "duplicate and similar-photo tools are finding.";
      out.insertBefore(note, out.firstChild.nextSibling);
    }
  } catch (e) {
    // The curtain is raised before the first fetch now, so a failure here has
    // to take it back down - otherwise the page is stuck behind it.
    hideCurtain();
    btn.textContent = "Sample data could not be loaded.";
    btn.disabled = false;
    return;
  }
  btn.textContent = label;
  btn.disabled = false;
}

/* Opening an export needs a real computer, and saying so is kinder than
   letting someone try.

   A phone is the wrong tool for this and would fail in ways that look like our
   fault. A Takeout runs to tens of gigabytes and a mobile browser will be
   killed long before it finishes reading one; there is no showDirectoryPicker
   on any mobile browser, so the tidied library has nowhere to go but a single
   download the phone then has to hold; and the archive is almost certainly on
   a laptop anyway, because that is where the download link was opened.

   The guides are genuinely useful on a phone - that is where someone reads
   them while waiting - so only the opener is closed off, and the sample data
   stays available so the app can still be looked at.

   Coarse pointer AND a narrow window: a touchscreen laptop is fine, and so is
   a narrow window on a desktop. It takes both to be a phone. */
function isHandheld() {
  const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  const narrow = Math.min(screen.width || innerWidth, innerWidth) < 820;
  return !!(coarse && narrow);
}

function closeOpenerOnMobile() {
  const drop = $("#drop");
  if (!drop || !isHandheld()) return false;
  drop.classList.add("drop-off");
  drop.innerHTML =
    "<p><strong>Opening an export needs a computer</strong></p>" +
    "<p class=\"small\">These archives run to tens of gigabytes, and a phone browser " +
    "runs out of memory long before it finishes reading one. Phones also cannot write a " +
    "library back out to a folder, which is the point of the exercise.</p>" +
    "<p class=\"small\">The guides below work perfectly well here, and this is a good place " +
    "to read them while you wait for an export to arrive. Come back on a laptop to open it.</p>";
  // Nothing to click, and nothing to pick a file with.
  const input = $("#file");
  if (input) input.remove();
  return true;
}

function wireImport() {
  // Set while the explorer is open, so the picker adds to the library.
  const appending = () => !!document.getElementById("explorer");

  const drop = $("#drop");
  if (closeOpenerOnMobile()) return;   // no picker, no drop target, nothing to wire
  const input = $("#file");
  drop.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    if (input.files.length) handleFiles(input.files, { append: appending() });
    input.value = "";   // so the same file can be chosen twice in a row
  });
  ["dragenter", "dragover"].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("hot"); })
  );
  ["dragleave", "drop"].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("hot"); })
  );
  drop.addEventListener("drop", (e) => {
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files, { append: appending() });
  });
}


function renderLogos() {
  $("#home-logos").innerHTML = ["apple", "google", "samsung", "snapchat", "facebook", "instagram"]
    .map((k) => iconSvg(k)).join("");
}

/* ---------- Resuming an interrupted save ---------- */

// A save that was cut short by a reboot or a closed tab can be picked up again:
// the browser hands back the source files and the destination folder, so only
// the write permission needs re-granting.
async function offerResume() {
  const slot = $("#resume");
  let job = null;
  try {
    const jobs = (await MJobs.all()) || [];
    job = jobs.filter((j) => j.done.length && j.done.length < j.total)
              .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0] || null;
  } catch { return; }
  if (!job) return;

  slot.hidden = false;
  slot.className = "resume-card";
  slot.innerHTML = `
    <div>
      <strong>You have a save in progress.</strong>
      <div class="muted small">${esc(job.fileNames.join(", "))} &middot;
        ${job.done.length.toLocaleString()} of ${job.total.toLocaleString()} files already written.</div>
    </div>
    <div class="tool-actions">
      <button class="btn primary" id="resume-go">Continue saving</button>
      <button class="btn ghost" id="resume-drop">Discard</button>
    </div>`;

  $("#resume-drop", slot).addEventListener("click", async () => {
    await MJobs.remove(job.id).catch(() => {});
    slot.hidden = true;
  });

  $("#resume-go", slot).addEventListener("click", async () => {
    const btn = $("#resume-go", slot);
    btn.disabled = true;
    if (!(await MJobs.sourcesReadable(job))) {
      slot.innerHTML = `<div class="muted small">Those export files have moved or been deleted since,
        so this cannot be continued automatically. Open them again below and the already-saved files
        will still be skipped.</div>`;
      return;
    }
    slot.hidden = true;
    await handleFiles(job.sources);
    // #save-status went with the old tab strip; this said nothing for a while.
    MNotify.push("Ready to continue", {
      kind: "done",
      body: "Choose Export, and the files already written will be skipped.",
      action: "Export",
      goto: () => { const b = document.getElementById("ex-save"); if (b) b.click(); },
    });
  });
}

/* ---------- "Explore your data" in the nav ----------

   The library only exists in memory, so this is a note to the rest of the tab
   that one is open, not a copy of anything. sessionStorage dies with the tab,
   which matches what we promise: nothing is kept. */
function markExportOpen(sources, entries) {
  try {
    sessionStorage.setItem("muletto:open", JSON.stringify({
      sources: sources.length,
      files: entries.length,
      label: sources.length === 1 ? (sources[0].det ? sources[0].det.label : sources[0].name)
        : sources.length + " exports",
    }));
  } catch { /* private mode; the nav item just will not appear */ }
  addExploreLink();
}

function addExploreLink() {
  let info = null;
  try { info = JSON.parse(sessionStorage.getItem("muletto:open") || "null"); } catch { info = null; }
  if (!info) return;
  document.querySelectorAll(".nav-links").forEach((nav) => {
    if (nav.querySelector(".nav-explore")) return;
    const a = document.createElement("a");
    a.className = "nav-explore";
    a.href = "app.html";
    a.innerHTML = '<span class="dot"></span>Your data';
    a.title = info.label + ", " + info.files.toLocaleString() + " files open in this tab";
    nav.appendChild(a);
  });
}

/* Pick up an export opened on a previous visit.

   The archives are still on disk and the browser kept a reference to them, so
   there is nothing to upload and nothing to choose again. If one has since
   been moved or deleted, say which - the library is still browsable, but its
   pictures cannot be decoded. */
/* Landing on the page and having it start reading gigabytes unasked is
   alarming in exactly the way this product cannot afford: the one question a
   visitor has is whether their files are going anywhere, and work they did not
   start is the worst possible answer. It also happened at the worst moment -
   after the reader changed, so the "stale" branch below silently re-read every
   archive.

   So nothing happens now until it is asked for. What is kept is described, and
   the reader chooses. */
async function offerLibrary() {
  if (typeof MStore === "undefined" || !$("#drop")) return false;
  let saved = null;
  try { saved = await MStore.load(); } catch { saved = null; }
  if (!saved) return false;

  const slot = $("#restore");
  if (!slot) return false;

  const files = saved.sources.map((x) => x.file).filter(Boolean);
  const reread = saved.stale && (!saved.missing || !saved.missing.length) && files.length > 0;
  const label = saved.sources.map((s) => s.name).join(", ");
  const when = saved.savedAt ? fmtDate(new Date(saved.savedAt)) : null;
  const bytes = saved.sources.reduce((n, s) => n + (s.size || 0), 0);

  slot.hidden = false;
  slot.className = "resume-card";
  slot.innerHTML = `
    <div>
      <strong>You had an export open here${when ? " on " + esc(when) : ""}.</strong>
      <div class="muted small">${esc(label)}${bytes ? " &middot; " + esc(fmtBytes(bytes)) : ""}${
        reread ? " &middot; would be read again from the same files, which takes a few minutes"
               : " &middot; picks up in a moment"}</div>
    </div>
    <div class="tool-actions">
      <button class="btn primary" id="restore-go">${reread ? "Read it again" : "Pick up where I left off"}</button>
      <button class="btn ghost" id="restore-drop">Start fresh</button>
    </div>`;

  $("#restore-drop", slot).addEventListener("click", async () => {
    await MStore.clear().catch(() => {});
    slot.hidden = true;
    slot.innerHTML = "";
  });

  $("#restore-go", slot).addEventListener("click", async () => {
    $("#restore-go", slot).disabled = true;
    slot.hidden = true;
    if (reread) await handleFiles(files);
    else await restoreLibrary(saved);
  });
  return true;
}

async function restoreLibrary(saved) {
  const out = $("#import-result");
  out.hidden = false;

  showCurtain("Picking up where you left off...");

  // Rebuilt from the parts, exactly as a fresh open would, so a restored
  // library and a newly opened one behave identically from here on.
  const sources = saved.sources;
  const lib = mergeSources(sources);
  const entries = [];
  sources.forEach((s, i) => s.entries.forEach((e) => {
    if (s.keepOnly && !s.keepOnly.has(e.name)) return;
    entries.push(Object.assign({ src: i }, e));
  }));
  current.restoring = true;
  renderLibrary(out, lib, sources, entries);
  current.restoring = false;
  hideCurtain();

  const note = [];
  if (saved.savedAt) {
    note.push("Opened again from this device - last used " + fmtDate(new Date(saved.savedAt)) + ".");
  }
  if (saved.missing && saved.missing.length) {
    note.push(plural(saved.missing.length, "archive has", "archives have") +
      " been moved or deleted since (" + saved.missing.map(esc).join(", ") +
      "), so pictures from " + (saved.missing.length === 1 ? "it" : "them") + " cannot be shown.");
  }
  if (note.length) MExplorer.status(note.join(" "));
  return true;
}

/* Coming back to the app page after navigating away.

   The library was only ever in memory, so it is gone. Saying so plainly is
   better than an empty drop zone that looks like the export was lost - and it
   is a chance to restate why nothing was kept. */
function noteReopenNeeded() {
  let info = null;
  try { info = JSON.parse(sessionStorage.getItem("muletto:open") || "null"); } catch { return; }
  if (!info || current.lib) return;
  const drop = $("#drop");
  if (!drop) return;
  const note = document.createElement("div");
  note.className = "note reopen-note";
  note.innerHTML = "You had <strong>" + esc(info.label) + "</strong> open, and it could not be " +
    "reopened - the archives were most likely moved, renamed or deleted, or this browser cleared " +
    "its storage. Choose them again and everything Muletto already worked out still applies.";
  drop.parentNode.insertBefore(note, drop);
}

/* ---------- Page-aware init ---------- */

// Ask the browser to keep our IndexedDB. Without this a half-finished save job
// can be evicted under storage pressure and the resume offer disappears.
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persisted().then((ok) => { if (!ok) navigator.storage.persist(); });
}

if ($("#home-logos")) renderLogos();
if (document.querySelector("figure.figshot")) wireShots();
if ($("#drop")) wireImport();
// Offer only. Nothing is read until somebody asks for it.
if ($("#drop")) {
  offerLibrary().then((ok) => { if (!ok) noteReopenNeeded(); });
}
if ($("#try-samples")) $("#try-samples").addEventListener("click", (e) => loadSamples(e.target));
if ($("#resume")) offerResume();

/* The library was cleared on the previous page, which then navigated here.
   Saying so on arrival is the only confirmation there is - everything that
   could have shown it is gone. */
(function sayForgotten() {
  let flag = null;
  try { flag = sessionStorage.getItem("muletto:forgot"); } catch { return; }
  if (!flag) return;
  try { sessionStorage.removeItem("muletto:forgot"); } catch { /* fine */ }
  if (typeof MNotify === "undefined") return;
  MNotify.push("Everything was forgotten", {
    kind: "ok",
    body: "The comparisons, the repaired dates, the descriptions and the small copies are " +
      "cleared from this browser. Your exports are untouched, wherever you keep them.",
  });
})();
if (document.querySelector("[data-icon]")) hydrateIcons();
addExploreLink();
