/* ============================================================
   Titan85 — main application
   Loads JSON data, handles navigation, renders every view,
   and persists everything to localStorage (fully offline).
   ============================================================ */

const DATA = { meals: null, recipes: null, workouts: null, shopping: null };
const MEAL_SLOTS = [
  ["Breakfast", "breakfast"],
  ["Snack", "snack1"],
  ["Lunch", "lunch"],
  ["Snack", "snack2"],
  ["Dinner", "dinner"],
  ["Evening", "snack3"],
];

const TRAIN_EMOJI = {
  "Upper Body": "💪", "Lower Body": "🦵", "Full Body": "🏋️",
  "Swimming": "🏊", "Recovery Walk": "🚶", "Walk": "🚶", "Meal Prep": "🍱", "Rest": "😴",
};

let PLAN_WEEK = 0;   // index for Plan view
let SHOP_WEEK = 0;   // index for Shopping view
let SPLIT = "upper"; // active workout split

/* ---------- boot ---------- */
async function boot() {
  registerSW();
  try {
    const [meals, recipes, workouts, shopping] = await Promise.all([
      fetch("data/meals.json").then(r => r.json()),
      fetch("data/recipes.json").then(r => r.json()),
      fetch("data/workouts.json").then(r => r.json()),
      fetch("data/shopping.json").then(r => r.json()),
    ]);
    DATA.meals = meals; DATA.recipes = recipes;
    DATA.workouts = workouts; DATA.shopping = shopping;
  } catch (e) {
    document.getElementById("mealList").innerHTML =
      `<div class="card"><p class="muted">Could not load data files. Make sure the app is served over http (not opened as a file). See README.</p></div>`;
    console.error(e);
    return;
  }

  PLAN_WEEK = currentWeekIndex();
  SHOP_WEEK = PLAN_WEEK;
  SPLIT = DATA.workouts.splits[0].id;

  setupNav();
  setupPhysique();
  renderToday();
  renderPhysique();
  renderPlan();
  renderRecipes();
  renderShopping();
  renderWorkout();
  renderProgress();
}

/* ---------- programme week / day ---------- */
function programmeStart() {
  let start = TitanStorage.load("startDate", null);
  if (!start) {
    start = new Date().toISOString();
    TitanStorage.save("startDate", start);
  }
  return new Date(start);
}
function currentWeekIndex() {
  const days = Math.floor((Date.now() - programmeStart().getTime()) / 86400000);
  const total = DATA.meals.weeks.length;
  return ((Math.floor(days / 7) % total) + total) % total;
}
function todayName() {
  return new Date().toLocaleDateString("en-IE", { weekday: "long" });
}
function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

/* ---------- navigation ---------- */
const TITLES = {
  today: "Today", plan: "Meal Plan", recipes: "Recipes",
  shopping: "Shopping", workout: "Workout", exercises: "Exercises", progress: "Progress",
};
function setupNav() {
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });
}
function switchView(view) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  document.getElementById("view-" + view).classList.add("active");
  document.querySelector(`.tab[data-view="${view}"]`).classList.add("active");
  document.getElementById("headerTitle").textContent = TITLES[view];
  if (view === "today") renderPhysique();
  if (view === "exercises") ExLib.open();
  if (view === "progress") drawWeightChart(TitanStorage.load("history", []));
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
}

/* ---------- helpers ---------- */
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 1600);
}
function findRecipe(name) {
  if (!DATA.recipes) return null;
  return DATA.recipes.recipes.find(r => r.name.toLowerCase() === String(name).toLowerCase());
}

/* ============================================================
   TODAY
   ============================================================ */
function renderToday() {
  const wk = DATA.meals.weeks[currentWeekIndex()];
  document.getElementById("weekPill").textContent = "Week " + wk.week;
  document.getElementById("headerSub").textContent = wk.title;

  const day = wk.days.find(d => d.day === todayName()) || wk.days[0];
  const emoji = TRAIN_EMOJI[day.training] || "🔥";

  document.getElementById("todayTraining").innerHTML = `
    <div class="card train-banner">
      <div>
        <div class="label">${esc(day.day)} · Training</div>
        <div class="val">${esc(day.training)}</div>
      </div>
      <div class="emoji">${emoji}</div>
    </div>`;

  const checks = TitanStorage.load("mealChecks", {});
  const dayChecks = checks[todayKey()] || {};

  const list = document.getElementById("mealList");
  list.innerHTML = "";
  MEAL_SLOTS.forEach(([label, key]) => {
    const val = day[key];
    if (!val) return;
    const done = !!dayChecks[key];
    const recipe = findRecipe(val);
    const div = document.createElement("div");
    div.className = "card meal" + (done ? " done" : "");
    div.innerHTML = `
      <div>
        <span class="tag">${label}</span>
        <p>${esc(val)}${recipe ? ` <span class="freeze-badge">· recipe ›</span>` : ""}</p>
      </div>
      <input type="checkbox" class="checkbox" ${done ? "checked" : ""} />`;
    div.querySelector(".checkbox").addEventListener("change", e => {
      const all = TitanStorage.load("mealChecks", {});
      all[todayKey()] = all[todayKey()] || {};
      all[todayKey()][key] = e.target.checked;
      TitanStorage.save("mealChecks", all);
      div.classList.toggle("done", e.target.checked);
      updateMealProgress(day);
    });
    if (recipe) {
      div.querySelector("p").style.cursor = "pointer";
      div.querySelector("p").addEventListener("click", () => openRecipe(recipe.id));
    }
    list.appendChild(div);
  });
  updateMealProgress(day);
}
function updateMealProgress(day) {
  const total = MEAL_SLOTS.filter(([, k]) => day[k]).length;
  const checks = (TitanStorage.load("mealChecks", {})[todayKey()]) || {};
  const done = MEAL_SLOTS.filter(([, k]) => day[k] && checks[k]).length;
  document.getElementById("mealProgressLabel").textContent = `${done} of ${total}`;
  document.getElementById("mealProgressBar").style.width = (total ? (done / total) * 100 : 0) + "%";
}

/* ============================================================
   PHYSIQUE SKIN
   A stylized character whose build is driven by bodyweight
   progress toward your goal (with a light nudge from any
   measurements you've logged). Flip to preview the Goal build.
   ============================================================ */
let PHYS_FACE = "now";

// Body-shape presets: how weight sits on the frame. Height+weight (BMI)
// set overall mass; the selected build sets muscle and leanness.
const SHAPES = {
  unfit:    { label: "Unfit",    muscle: 0.12, lean: 0.18 },
  average:  { label: "Average",  muscle: 0.35, lean: 0.45 },
  athletic: { label: "Athletic", muscle: 0.60, lean: 0.72 },
  muscular: { label: "Muscular", muscle: 0.85, lean: 0.75 },
  bulky:    { label: "Bulky",    muscle: 0.92, lean: 0.35 },
};

function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function bmi(weight, height) {
  if (weight == null || !height) return null;
  const m = height / 100;
  return weight / (m * m);
}
function massFrom(weight, height) {
  // Average body volume for a person of this height and weight (BMI-based);
  // raw-weight fallback when height isn't recorded yet.
  const b = bmi(weight, height);
  if (b != null) return clamp01((b - 19) / 13);
  return weight != null ? clamp01((weight - 65) / 40) : null;
}

function setupPhysique() {
  const btn = document.getElementById("flipPhysiqueBtn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    PHYS_FACE = PHYS_FACE === "now" ? "goal" : "now";
    document.getElementById("physiqueStage").classList.toggle("goal", PHYS_FACE === "goal");
    document.getElementById("physiqueState").textContent = PHYS_FACE === "now" ? "Now" : "Goal";
    btn.textContent = PHYS_FACE === "now" ? "See Goal →" : "← Back to Now";
    if (window.PHYS && window.Physique3D) {
      Physique3D.morphTo(PHYS_FACE === "now" ? window.PHYS.now : window.PHYS.goal, 1100);
    }
    updatePhysiqueCaption();
  });
}

function getPhysiqueParams() {
  const history = TitanStorage.load("history", []);
  const meas = TitanStorage.load("measurements", {});
  const goals = TitanStorage.load("goals", {});

  const start = history.length ? history[0].weight : null;
  const current = history.length ? history[history.length - 1].weight : null;
  const goalWeight = goals.weight != null ? goals.weight : null;
  const height = meas.height != null ? meas.height : null;
  // stature 0..1 over 165–195cm; default mid if height unknown
  const stature = height != null ? clamp01((height - 165) / 30) : 0.5;
  const fem = TitanStorage.load("sex", "male") === "female" ? 1 : 0;

  // Same system for both sides: average frame for height+weight (mass),
  // shaped by the selected build (muscle/lean).
  const shapeNowKey = TitanStorage.load("shapeNow", "average");
  const shapeGoalKey = goals.shape || "muscular";
  const sNow = SHAPES[shapeNowKey] || SHAPES.average;
  const sGoal = SHAPES[shapeGoalKey] || SHAPES.muscular;

  const nowMass = massFrom(current, height);
  const goalMass = massFrom(goalWeight, height);

  const now = {
    muscle: sNow.muscle, lean: sNow.lean,
    mass: nowMass != null ? nowMass : 0.45,
    stature, fem,
  };
  const goal = {
    muscle: sGoal.muscle, lean: sGoal.lean,
    mass: goalMass != null ? goalMass : (nowMass != null ? nowMass : 0.5),
    stature, fem,
  };

  // Progress along the bodyweight path from start → goal (for the chips).
  let progress = 0;
  if (start != null && current != null && goalWeight != null && goalWeight !== start) {
    progress = Math.max(0, Math.min(1, (current - start) / (goalWeight - start)));
  }

  return {
    now, goal,
    meta: {
      start, current, goalWeight, height, progress,
      shapeNow: shapeNowKey, shapeGoal: shapeGoalKey,
      hasGoal: goalWeight != null, hasData: current != null,
    },
  };
}

/* --- build selector chip rows (shared by Today + Stats) --- */
function renderShapeChips(el, activeKey, onPick) {
  if (!el) return;
  el.innerHTML = "";
  Object.entries(SHAPES).forEach(([key, s]) => {
    const c = document.createElement("button");
    c.className = "chip sm" + (key === activeKey ? " active" : "");
    c.textContent = s.label;
    c.addEventListener("click", () => onPick(key));
    el.appendChild(c);
  });
}

function renderNowShapeRow() {
  renderShapeChips(
    document.getElementById("shapeNowRow"),
    TitanStorage.load("shapeNow", "average"),
    key => {
      TitanStorage.save("shapeNow", key);
      const p = getPhysiqueParams();
      window.PHYS = p;
      if (window.Physique3D) Physique3D.morphTo(PHYS_FACE === "now" ? p.now : p.goal, 700);
      renderNowShapeRow();
      updatePhysiqueCaption();
    });
}

async function renderPhysique() {
  const canvas = document.getElementById("physiqueCanvas");
  if (!canvas || !window.Physique3D) return;
  const p = getPhysiqueParams();
  window.PHYS = p;
  const ok = await Physique3D.mount(canvas);
  if (ok) Physique3D.setParams(PHYS_FACE === "now" ? p.now : p.goal);
  renderNowShapeRow();
  updatePhysiqueCaption();
}

function updatePhysiqueCaption() {
  const wrap = document.getElementById("physiqueStats");
  if (!wrap || !window.PHYS) return;
  const m = window.PHYS.meta;
  const chip = (v, label) => `<div class="pchip"><b>${v}</b><span>${label}</span></div>`;

  if (PHYS_FACE === "now") {
    if (!m.hasData) {
      wrap.innerHTML = `<p class="muted small physique-hint">Log your bodyweight on the <b>Stats</b> tab to bring your character to life.</p>`;
      return;
    }
    const delta = (m.current - m.start);
    const sign = delta > 0 ? "+" : "";
    const pct = Math.round(m.progress * 100);
    wrap.innerHTML =
      `<div class="physique-chips">
         ${chip(m.current + " kg", "Current")}
         ${chip(sign + delta.toFixed(1) + " kg", "Since start")}
         ${chip(m.hasGoal ? pct + "%" : "—", "To goal")}
       </div>
       ${m.hasGoal ? `<div class="physique-bar"><span style="width:${pct}%"></span></div>` : ""}`;
  } else {
    if (!m.hasGoal) {
      wrap.innerHTML = `<p class="muted small physique-hint">Set a goal weight under <b>Stats › Your Goal</b> to personalise this build.</p>`;
      return;
    }
    const toGo = (m.goalWeight - m.current);
    const sign = toGo > 0 ? "+" : "";
    const gLabel = (SHAPES[m.shapeGoal] || SHAPES.muscular).label;
    wrap.innerHTML =
      `<div class="physique-chips">
         ${chip(m.goalWeight + " kg", "Goal")}
         ${chip(sign + toGo.toFixed(1) + " kg", "To go")}
         ${chip(gLabel, "Target build")}
       </div>`;
  }
}

/* ============================================================
   MEAL PLAN
   ============================================================ */
function renderPlan() {
  const sw = document.getElementById("weekSwitch");
  sw.innerHTML = "";
  DATA.meals.weeks.forEach((wk, i) => {
    const c = document.createElement("button");
    c.className = "chip" + (i === PLAN_WEEK ? " active" : "");
    c.textContent = "Week " + wk.week;
    c.addEventListener("click", () => { PLAN_WEEK = i; renderPlan(); });
    sw.appendChild(c);
  });

  const wk = DATA.meals.weeks[PLAN_WEEK];
  document.getElementById("planPrep").innerHTML = `
    <h3>${esc(wk.title)}</h3>
    <p class="muted small">Sunday batch cook</p>
    <div class="prep-list">${wk.prep.map(p => {
      const r = findRecipe(p);
      return `<span class="prep-tag"${r ? ` data-rid="${r.id}" style="cursor:pointer"` : ""}>${esc(p)}${r ? " ›" : ""}</span>`;
    }).join("")}</div>`;
  document.getElementById("planPrep").querySelectorAll("[data-rid]").forEach(el =>
    el.addEventListener("click", () => openRecipe(+el.dataset.rid)));

  const days = document.getElementById("planDays");
  days.innerHTML = "";
  wk.days.forEach(day => {
    const card = document.createElement("div");
    card.className = "card day-card";
    const emoji = TRAIN_EMOJI[day.training] || "🔥";
    card.innerHTML = `
      <h3>${esc(day.day)} <span class="train">${emoji} ${esc(day.training)}</span></h3>
      <ul class="day-meals">
        ${MEAL_SLOTS.filter(([, k]) => day[k]).map(([label, k]) =>
          `<li><span class="k">${label}</span><span>${esc(day[k])}</span></li>`).join("")}
      </ul>`;
    days.appendChild(card);
  });
}

/* ============================================================
   RECIPES
   ============================================================ */
function renderRecipes() {
  const list = document.getElementById("recipeList");
  list.innerHTML = "";
  DATA.recipes.recipes.forEach(r => {
    const card = document.createElement("div");
    card.className = "card";
    card.id = "recipe-" + r.id;
    card.innerHTML = `
      <div class="recipe-head">
        <div>
          <h3 style="margin:0">${esc(r.name)}</h3>
          <div class="recipe-tags">${(r.tags || []).map(t => `<span>${esc(t)}</span>`).join("")}
            ${r.freeze ? `<span class="freeze-badge">❄ Freezes</span>` : ""}</div>
        </div>
        <div style="color:var(--muted);font-size:22px">›</div>
      </div>
      <div class="recipe-macros">
        <div class="macro"><b>${r.protein}g</b><span>Protein</span></div>
        <div class="macro"><b>${r.calories}</b><span>Kcal</span></div>
        <div class="macro"><b>${(r.prep||0)+(r.cook||0)}m</b><span>Time</span></div>
        <div class="macro"><b>${r.servings}</b><span>Servings</span></div>
      </div>
      <div class="recipe-body">
        ${r.ingredients ? `<h4>Ingredients</h4><ul>${r.ingredients.map(i => `<li>${esc(i)}</li>`).join("")}</ul>` : ""}
        ${r.method ? `<h4>Method</h4><ol>${r.method.map(m => `<li>${esc(m)}</li>`).join("")}</ol>` : ""}
      </div>`;
    card.querySelector(".recipe-head").addEventListener("click", () =>
      card.querySelector(".recipe-body").classList.toggle("open"));
    list.appendChild(card);
  });
}
function openRecipe(id) {
  switchView("recipes");
  const card = document.getElementById("recipe-" + id);
  if (!card) return;
  card.querySelector(".recipe-body").classList.add("open");
  setTimeout(() => card.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
}

/* ============================================================
   SHOPPING
   ============================================================ */
function renderShopping() {
  const keys = Object.keys(DATA.shopping);
  const sw = document.getElementById("shopWeekSwitch");
  sw.innerHTML = "";
  keys.forEach((k, i) => {
    const c = document.createElement("button");
    c.className = "chip" + (i === SHOP_WEEK ? " active" : "");
    c.textContent = "Week " + (i + 1);
    c.addEventListener("click", () => { SHOP_WEEK = i; renderShopping(); });
    sw.appendChild(c);
  });

  const key = keys[SHOP_WEEK];
  const checks = TitanStorage.load("shopChecks", {});
  const wkChecks = checks[key] || {};
  const list = document.getElementById("shoppingList");
  list.innerHTML = "";

  DATA.shopping[key].forEach(group => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `<p class="cat-title">${esc(group.category)}</p>`;
    group.items.forEach(item => {
      const id = group.category + "|" + item;
      const done = !!wkChecks[id];
      const row = document.createElement("div");
      row.className = "shop-item" + (done ? " done" : "");
      row.innerHTML = `<input type="checkbox" class="checkbox" ${done ? "checked" : ""}/><label>${esc(item)}</label>`;
      const cb = row.querySelector(".checkbox");
      const toggle = () => {
        cb.checked = !cb.checked;
        const all = TitanStorage.load("shopChecks", {});
        all[key] = all[key] || {};
        all[key][id] = cb.checked;
        TitanStorage.save("shopChecks", all);
        row.classList.toggle("done", cb.checked);
      };
      row.querySelector("label").addEventListener("click", toggle);
      cb.addEventListener("change", () => { cb.checked = !cb.checked; toggle(); });
      card.appendChild(row);
    });
    list.appendChild(card);
  });

  document.getElementById("clearShopBtn").onclick = () => {
    const all = TitanStorage.load("shopChecks", {});
    delete all[key];
    TitanStorage.save("shopChecks", all);
    renderShopping();
    toast("Week " + (SHOP_WEEK + 1) + " list reset");
  };
}

/* ============================================================
   WORKOUT LOGGER
   ============================================================ */
function renderWorkout() {
  const sw = document.getElementById("splitSwitch");
  sw.innerHTML = "";
  DATA.workouts.splits.forEach(s => {
    const c = document.createElement("button");
    c.className = "chip" + (s.id === SPLIT ? " active" : "");
    c.textContent = s.name;
    c.addEventListener("click", () => { SPLIT = s.id; renderWorkout(); });
    sw.appendChild(c);
  });

  const split = DATA.workouts.splits.find(s => s.id === SPLIT);
  const logs = TitanStorage.load("workoutLogs", {});
  const lastByDate = logs[SPLIT] || {};
  const dates = Object.keys(lastByDate).sort();
  const last = dates.length ? lastByDate[dates[dates.length - 1]] : {};

  const list = document.getElementById("exerciseList");
  list.innerHTML = "";
  split.exercises.forEach((ex, idx) => {
    const prev = last[ex.exercise] || {};
    const card = document.createElement("div");
    card.className = "card ex-row";
    const thumb = ex.media
      ? `<button class="ex-thumb" data-exid="${ex.exId}" aria-label="Show ${esc(ex.exercise)} demo">
           <img loading="lazy" src="${ExLib.imgUrl(ex.media)}" alt="" /></button>`
      : "";
    card.innerHTML = `
      <div class="ex-title-row">${thumb}
        <h3>${esc(ex.exercise)} <span class="target">${ex.sets} × ${esc(ex.reps)}</span></h3>
      </div>
      <div class="ex-inputs">
        <div class="field"><label>Weight (kg)</label><input type="number" inputmode="decimal" data-ex="${idx}" data-f="weight" value="${prev.weight ?? ""}" placeholder="—"/></div>
        <div class="field"><label>Sets</label><input type="number" inputmode="numeric" data-ex="${idx}" data-f="sets" value="${prev.sets ?? ex.sets}" /></div>
        <div class="field"><label>Reps</label><input type="text" data-ex="${idx}" data-f="reps" value="${prev.reps ?? ""}" placeholder="${esc(ex.reps)}"/></div>
      </div>`;
    const tBtn = card.querySelector(".ex-thumb");
    if (tBtn) tBtn.addEventListener("click", () => ExLib.showById(tBtn.dataset.exid));
    list.appendChild(card);
  });

  document.getElementById("saveWorkoutBtn").onclick = () => {
    const split = DATA.workouts.splits.find(s => s.id === SPLIT);
    const session = {};
    document.querySelectorAll("#exerciseList .ex-row").forEach((card, idx) => {
      const ex = split.exercises[idx].exercise;
      const get = f => card.querySelector(`[data-f="${f}"]`).value;
      session[ex] = { weight: get("weight"), sets: get("sets"), reps: get("reps") };
    });
    const all = TitanStorage.load("workoutLogs", {});
    all[SPLIT] = all[SPLIT] || {};
    all[SPLIT][todayKey()] = session;
    TitanStorage.save("workoutLogs", all);
    renderWorkout();
    toast("Session saved 💪");
  };

  renderWorkoutHistory();
}
function renderWorkoutHistory() {
  const logs = TitanStorage.load("workoutLogs", {})[SPLIT] || {};
  const dates = Object.keys(logs).sort().reverse();
  const wrap = document.getElementById("workoutHistory");
  if (!dates.length) { wrap.innerHTML = ""; return; }
  wrap.innerHTML = `<h2 class="section-title">History</h2>` + dates.slice(0, 8).map(d => {
    const s = logs[d];
    const rows = Object.entries(s)
      .filter(([, v]) => v.weight)
      .map(([ex, v]) => `<li><span class="k">${esc(ex)}</span><span>${esc(v.weight)}kg · ${esc(v.sets)}×${esc(v.reps || "")}</span></li>`)
      .join("");
    return `<div class="card day-card"><h3>${new Date(d).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" })}</h3><ul class="day-meals">${rows || '<li><span class="k">No weights logged</span></li>'}</ul></div>`;
  }).join("");
}

/* ============================================================
   PROGRESS
   ============================================================ */
function renderProgress() {
  const history = TitanStorage.load("history", []);
  drawWeightChart(history);
  renderWeightStat(history);

  const m = TitanStorage.load("measurements", {});
  ["height", "chest", "waist", "arms", "thighs"].forEach(k => {
    const el = document.getElementById("m-" + k);
    if (m[k] != null) el.value = m[k];
  });
  renderMeasureStat(m);

  const goals = TitanStorage.load("goals", {});
  const gw = document.getElementById("g-weight");
  if (gw && goals.weight != null) gw.value = goals.weight;
  renderGoalStat(goals);

  // goal build selector
  const drawGoalChips = () => {
    const g = TitanStorage.load("goals", {});
    renderShapeChips(document.getElementById("goalShapeRow"), g.shape || "muscular", key => {
      g.shape = key;
      TitanStorage.save("goals", g);
      drawGoalChips();
      renderPhysique();
    });
  };
  drawGoalChips();

  // sex selector — proportions differ, so the model needs to know
  const drawSexChips = () => {
    const cur = TitanStorage.load("sex", "male");
    const row = document.getElementById("sexRow");
    if (!row) return;
    row.innerHTML = "";
    [["male", "Male"], ["female", "Female"]].forEach(([key, label]) => {
      const c = document.createElement("button");
      c.className = "chip sm" + (key === cur ? " active" : "");
      c.textContent = label;
      c.addEventListener("click", () => {
        TitanStorage.save("sex", key);
        drawSexChips();
        renderPhysique();
      });
      row.appendChild(c);
    });
  };
  drawSexChips();

  document.getElementById("saveGoalBtn").onclick = () => {
    const g = TitanStorage.load("goals", {});
    const v = parseFloat(document.getElementById("g-weight").value);
    if (isNaN(v) || v <= 0) { toast("Enter a goal weight"); return; }
    g.weight = v;
    g.date = new Date().toISOString();
    TitanStorage.save("goals", g);
    renderGoalStat(g);
    renderPhysique();
    toast("Goal saved 🎯");
  };

  document.getElementById("saveWeightBtn").onclick = () => {
    const val = parseFloat(document.getElementById("currentWeight").value);
    if (isNaN(val) || val <= 0) { toast("Enter a valid weight"); return; }
    const h = TitanStorage.load("history", []);
    h.push({ date: new Date().toISOString(), weight: val });
    TitanStorage.save("history", h);
    document.getElementById("currentWeight").value = "";
    drawWeightChart(h);
    renderWeightStat(h);
    renderPhysique();
    toast("Weight saved");
  };

  document.getElementById("saveMeasureBtn").onclick = () => {
    const data = {};
    ["height", "chest", "waist", "arms", "thighs"].forEach(k => {
      const v = parseFloat(document.getElementById("m-" + k).value);
      if (!isNaN(v)) data[k] = v;
    });
    data.date = new Date().toISOString();
    TitanStorage.save("measurements", data);
    renderMeasureStat(data);
    renderPhysique();
    toast("Measurements saved");
  };
}
function renderGoalStat(g) {
  const el = document.getElementById("goalStat");
  if (!el) return;
  el.textContent = g.weight != null
    ? `Goal ${g.weight}kg set — see your Goal character on the Today tab.`
    : "";
}
function renderWeightStat(h) {
  const el = document.getElementById("weightStat");
  if (!h.length) { el.textContent = ""; return; }
  const latest = h[h.length - 1].weight;
  const first = h[0].weight;
  const diff = (latest - first).toFixed(1);
  const sign = diff > 0 ? "+" : "";
  const height = TitanStorage.load("measurements", {}).height;
  const b = bmi(latest, height);
  const bmiTxt = b != null ? ` · BMI ${b.toFixed(1)}` : "";
  el.textContent = h.length > 1
    ? `Latest ${latest}kg${bmiTxt} · ${sign}${diff}kg since start (${h.length} entries)`
    : `Latest ${latest}kg${bmiTxt}`;
}
function renderMeasureStat(m) {
  const el = document.getElementById("measureStat");
  el.textContent = m.date ? "Last updated " + new Date(m.date).toLocaleDateString("en-IE") : "";
}

/* ---------- service worker ---------- */
function registerSW() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("service-worker.js").catch(err =>
        console.warn("SW registration failed:", err));
    });
  }
}

boot();
