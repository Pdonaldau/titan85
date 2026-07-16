# Titan85 — Offline Muscle-Building Tracker

A self-contained PWA (Progressive Web App) for a 4-week meal-prep + training block.
Works fully offline once installed, stores everything on-device, no accounts, no servers.

## What it does

- **Today** — the current day's meals (tap to tick off) and today's training, based on a rotating 4-week programme that auto-advances from the date you first open it.
- **Plan** — browse all 4 weeks, each with its Sunday batch-cook list and 7 daily meal plans.
- **Recipes** — 11 batch-cook recipes with macros, ingredients and method (tap a meal anywhere to jump to its recipe).
- **Shop** — weekly shopping lists you can tick off; state saved per week.
- **Train** — Upper / Lower / Full-body sessions. Log weight/sets/reps per exercise; it remembers your last numbers and keeps a history. Each exercise has a thumbnail — tap it for an animated demo with step-by-step instructions.
- **Exercises** — a library of 1,324 exercises. Pick what you want to work on (Back, Chest, Shoulders, Arms, Legs, Core, Cardio), filter by equipment or search, and tap any exercise for its animation and instructions. Animations stream from a CDN and are cached for offline use once viewed. Data and media from [exercises-dataset](https://github.com/hasaneyldrm/exercises-dataset) (animations © [Gym visual](https://gymvisual.com/)).
- **Stats** — log bodyweight (offline line chart) and body measurements.

All progress is saved in the browser's local storage on your phone.

## Project structure

```
index.html            Single-page app shell + iOS bottom tab bar
manifest.json         PWA manifest (installable, standalone)
service-worker.js     Offline caching (cache-first)
css/style.css         Dark theme, safe-area aware
js/storage.js         localStorage wrapper
js/charts.js          Custom canvas weight chart (no libraries)
js/app.js             Data loading, navigation, all view rendering
js/exercises.js       Exercise library (muscle-group picker, search, GIF modal)
data/meals.json       4 weeks × 7 days
data/recipes.json     Recipe database
data/workouts.json    Upper / Lower / Full-body splits
data/shopping.json    Weekly shopping lists
data/exercises.json   1,324-exercise library (built by tools/build-exercises.mjs)
icons/                App icons + Apple touch icon
```

## Run it locally (Windows PowerShell)

The service worker and JSON files need to be served over http — opening `index.html`
directly as a `file://` will not work. From this folder:

```powershell
cd "C:\Users\pdona\Desktop\Workout-Prep"
py -3 -m http.server 8085
```

Then open <http://127.0.0.1:8085> in a browser.

## Install on your iPhone

A PWA must be served over **HTTPS** (or `localhost`) for Safari to install it.
Two easy options:

**Option A — GitHub Pages (free, permanent):**
1. Create a new GitHub repo and upload this whole folder.
2. Repo → Settings → Pages → deploy from `main` / root.
3. Open the resulting `https://…github.io/…` URL in **Safari** on your iPhone.
4. Tap the **Share** button → **Add to Home Screen**.

**Option B — same Wi-Fi as your PC (quick test):**
1. Run `py -3 -m http.server 8085` on your PC.
2. Find your PC's local IP (`ipconfig`), e.g. `192.168.1.20`.
3. On the iPhone Safari, open `http://192.168.1.20:8085`.
   (Add-to-Home-Screen works, but offline caching needs HTTPS — use Option A for the real install.)

Once added to the Home Screen it launches full-screen, works with no signal, and keeps your logged data.

## Editing your plan

Everything is data-driven — edit the JSON files, no code changes needed:

- Change meals/training → `data/meals.json`
- Add a recipe → append an object to `data/recipes.json` (a meal name that matches a recipe `name` auto-links)
- Change exercises → `data/workouts.json`
- Change shopping lists → `data/shopping.json`

After editing, bump `CACHE_NAME` in `service-worker.js` (e.g. `titan85-v3`) so installed phones pick up the new data.

## Notes on the data

Week 1 follows the plan exactly as supplied. Weeks 2–4 follow the same batch-cook
rhythm (two mains + oats + a protein pot) using each week's prep list, and the recipe
macros for the added meals are sensible muscle-building estimates — tune any of it in
the JSON to match your real numbers.
