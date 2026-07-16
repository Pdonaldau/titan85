/* ============================================================
   Titan85 — Exercise Library
   Browse 1,324 exercises by muscle group with animated
   demonstrations. Data: data/exercises.json (built by
   tools/build-exercises.mjs from hasaneyldrm/exercises-dataset).
   Animations stream from a CDN and are cached by the service
   worker after first view.
   ============================================================ */

const ExLib = (() => {
  const CDN = "https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@main";
  const CDN_FALLBACK = "https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/main";
  const PAGE = 24;

  const GROUPS = [
    ["all", "All", "🏋️"],
    ["back", "Back", "🚣"],
    ["chest", "Chest", "🫁"],
    ["shoulders", "Shoulders", "🤷"],
    ["arms", "Arms", "💪"],
    ["legs", "Legs", "🦵"],
    ["core", "Core", "🧘"],
    ["cardio", "Cardio", "🏃"],
  ];

  let ALL = null;        // full exercise list once loaded
  let loadPromise = null;
  let group = "all";
  let equip = "all";
  let query = "";
  let shown = PAGE;

  /* ---------- data ---------- */
  function load() {
    if (!loadPromise) {
      loadPromise = fetch("data/exercises.json")
        .then(r => r.json())
        .then(list => { ALL = list; return list; });
    }
    return loadPromise;
  }

  const gifUrl = base => `${CDN}/videos/${base}.gif`;
  const gifFallbackUrl = base => `${CDN_FALLBACK}/videos/${base}.gif`;
  const imgUrl = base => `${CDN}/images/${base}.jpg`;

  // swap to the fallback host once if the CDN fails
  function wireFallback(img, base, fn) {
    img.addEventListener("error", () => {
      if (img.dataset.fb) { img.closest(".exgif")?.classList.add("noimg"); return; }
      img.dataset.fb = "1";
      img.src = fn(base);
    });
  }

  /* ---------- filtering ---------- */
  function filtered() {
    const q = query.trim().toLowerCase();
    return ALL.filter(e =>
      (group === "all" || e.b === group) &&
      (equip === "all" || e.e === equip) &&
      (!q || e.n.includes(q) || e.t.includes(q)));
  }

  /* ---------- render: group tiles ---------- */
  function renderGroups() {
    const row = document.getElementById("exGroupRow");
    row.innerHTML = "";
    GROUPS.forEach(([key, label, emoji]) => {
      const count = key === "all" ? ALL.length : ALL.filter(e => e.b === key).length;
      const tile = document.createElement("button");
      tile.className = "muscle-tile" + (key === group ? " active" : "");
      tile.innerHTML = `<span class="mt-emoji">${emoji}</span><span class="mt-label">${label}</span><span class="mt-count">${count}</span>`;
      tile.addEventListener("click", () => {
        group = key; shown = PAGE;
        renderGroups(); renderList();
      });
      row.appendChild(tile);
    });
  }

  /* ---------- render: equipment select ---------- */
  function renderEquip() {
    const sel = document.getElementById("exEquip");
    if (sel.options.length > 1) return; // already populated
    [...new Set(ALL.map(e => e.e))].sort().forEach(eq => {
      const o = document.createElement("option");
      o.value = eq; o.textContent = eq[0].toUpperCase() + eq.slice(1);
      sel.appendChild(o);
    });
    sel.addEventListener("change", () => { equip = sel.value; shown = PAGE; renderList(); });
  }

  /* ---------- render: results grid ---------- */
  function renderList() {
    const list = filtered();
    const label = GROUPS.find(g => g[0] === group)[1];
    document.getElementById("exCount").textContent =
      `${list.length} exercise${list.length === 1 ? "" : "s"}` +
      (group === "all" ? "" : ` · ${label}`);

    const grid = document.getElementById("exGrid");
    grid.innerHTML = "";
    list.slice(0, shown).forEach(e => grid.appendChild(card(e)));

    const more = document.getElementById("exMoreBtn");
    more.style.display = list.length > shown ? "" : "none";
    more.onclick = () => { shown += PAGE; renderList(); };

    document.getElementById("exEmpty").style.display = list.length ? "none" : "";
  }

  function card(e) {
    const el = document.createElement("div");
    el.className = "excard";
    el.innerHTML = `
      <div class="exgif"><img loading="lazy" alt="${esc(e.n)}" /></div>
      <div class="exinfo">
        <h4>${esc(e.n)}</h4>
        <p>${esc(e.t)} · ${esc(e.e)}</p>
      </div>`;
    const img = el.querySelector("img");
    img.src = gifUrl(e.g);
    wireFallback(img, e.g, gifFallbackUrl);
    el.addEventListener("click", () => openModal(e));
    return el;
  }

  /* ---------- detail modal ---------- */
  function openModal(e) {
    const modal = document.getElementById("exModal");
    const tag = t => `<span class="ex-tag">${esc(t)}</span>`;
    modal.querySelector(".ex-modal-body").innerHTML = `
      <div class="exgif big"><img alt="${esc(e.n)} animation" /></div>
      <h3>${esc(e.n)}</h3>
      <div class="ex-tags">
        ${tag("🎯 " + e.t)}${tag("🛠 " + e.e)}
        ${e.m.map(s => tag(s)).join("")}
      </div>
      ${e.s.length ? `<h4>How to do it</h4><ol class="ex-steps">${e.s.map(s => `<li>${esc(s)}</li>`).join("")}</ol>` : ""}
      <p class="ex-attrib">Animation © Gym visual — gymvisual.com</p>`;
    const img = modal.querySelector("img");
    img.src = gifUrl(e.g);
    wireFallback(img, e.g, gifFallbackUrl);
    modal.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    const modal = document.getElementById("exModal");
    modal.hidden = true;
    modal.querySelector(".ex-modal-body").innerHTML = "";
    document.body.style.overflow = "";
  }

  /* ---------- public ---------- */
  let wired = false;
  async function open() {
    const loading = document.getElementById("exLoading");
    if (!ALL) loading.style.display = "";
    try { await load(); } catch (err) {
      loading.textContent = "Could not load the exercise library.";
      console.error(err);
      return;
    }
    loading.style.display = "none";

    if (!wired) {
      wired = true;
      const search = document.getElementById("exSearch");
      search.addEventListener("input", () => {
        query = search.value; shown = PAGE; renderList();
      });
      renderEquip();
      const modal = document.getElementById("exModal");
      modal.addEventListener("click", ev => { if (ev.target === modal) closeModal(); });
      modal.querySelector(".ex-close").addEventListener("click", closeModal);
      renderGroups();
      renderList();
    }
  }

  // open the detail modal for a known exercise id (workout logger thumbs)
  async function showById(id) {
    await load();
    const e = ALL.find(x => x.i === id);
    if (e) openModal(e);
  }

  return { open, showById, gifUrl, imgUrl };
})();
