// ═══════════════════════════════════════════════════
//  CogBlock V12 — dots/lines layout rebuild
// ═══════════════════════════════════════════════════

const DEFAULTS = {
  adminPasscode: "4822",
  consecutiveMissesForBlock: 2,
  spRestartSlowerByMs: 375,
  spRestartWrongLimit: 3,
  spRestartCorrectStreak: 2,
  qualifyingBlockGapMs: 250,
  rollMeanWindow: 8,
  noResponseTimeoutMs: 20000,
  wrongWindowSize: 5,
  wrongThresholdStop: 4,
  maxTrialCount: 180,
  maxTestDurationMs: 120000,
  minDurationMs: 800,
  maxDurationMs: 10000,
  initialUnusedCalibrationTrials: 1,
  initialMeasuredCalibrationTrials: 20,
  initialPacedPercent: 0.70,
  calibrationStopErrors: 5,
  calibrationStopSlowMs: 10000,
  cpsBestMs: 800,
  cpsWorstMs: 3000,
  deviceBenchmarkEnabled: 0
};

const ADMIN_FIELDS = [
  ["consecutiveMissesForBlock","Consecutive misses for block","number"],
  ["spRestartSlowerByMs","SP Restart: slowdown on success (ms)","number"],
  ["spRestartWrongLimit","SP Restart: wrong limit before bad end","number"],
  ["spRestartCorrectStreak","SP Restart: correct streak to pass","number"],
  ["qualifyingBlockGapMs","Max block diff to trigger end (ms)","number"],
  ["rollMeanWindow","Rolling mean window size (answers)","number"],
  ["maxTestDurationMs","Max total test time (ms)","number"],
  ["noResponseTimeoutMs","Time to end test if no response (ms)","number"],
  ["wrongWindowSize","Wrong-answer window size","number"],
  ["wrongThresholdStop","Wrong answers threshold","number"],
  ["maxTrialCount","Maximum paced trial count","number"],
  ["minDurationMs","Minimum paced duration (ms)","number"],
  ["maxDurationMs","Maximum paced duration (ms)","number"],
  ["initialUnusedCalibrationTrials","Unused self-paced trials","number"],
  ["initialMeasuredCalibrationTrials","Measured self-paced trials","number"],
  ["initialPacedPercent","Initial paced % of calibration average","number"],
  ["calibrationStopErrors","Calibration stop after errors >","number"],
  ["calibrationStopSlowMs","Calibration stop if any RT exceeds (ms)","number"],
  ["cpsBestMs","CPS best ms (score 100)","number"],
  ["cpsWorstMs","CPS worst ms (score 0)","number"],
  ["deviceBenchmarkEnabled","Run device benchmark before test (0/1)","number"],
  ["adminPasscode","Admin passcode","password"]
];

// ─── Pattern definitions (1–6 dots / 1–6 lines) ───
// Coordinates are % of cell — spread wide (15–85) for maximum readability
const DOT_PATTERNS = {
  1:[["dot",50,50]],
  2:[["dot",22,50],["dot",78,50]],
  3:[["dot",50,18],["dot",22,75],["dot",78,75]],
  4:[["dot",22,22],["dot",78,22],["dot",22,78],["dot",78,78]],
  5:[["dot",22,22],["dot",78,22],["dot",50,50],["dot",22,78],["dot",78,78]],
  6:[["dot",22,18],["dot",78,18],["dot",22,50],["dot",78,50],["dot",22,82],["dot",78,82]]
};

const LINE_PATTERNS = {
  1:[["v",50,50]],
  2:[["v",22,50],["v",78,50]],
  3:[["v",15,50],["v",50,50],["v",85,50]],
  4:[["v",22,25],["v",78,25],["v",22,75],["v",78,75]],
  5:[["v",22,22],["v",78,22],["v",50,50],["v",22,78],["v",78,78]],
  6:[["v",15,18],["v",50,18],["v",85,18],["v",15,78],["v",50,78],["v",85,78]]
};

const SAMN_PERELLI = [
  [7,"Full alert, wide awake"],
  [6,"Very lively, responsive, but not at peak"],
  [5,"Okay, about normal"],
  [4,"Less than sharp, let down"],
  [3,"Feeling dull, losing focus"],
  [2,"Very difficult to concentrate, groggy"],
  [1,"Unable to function, ready to drop"]
];

// ─── Settings ───
function loadSettings() {
  const s = JSON.parse(localStorage.getItem("cogblock_v12_settings") || "null");
  if (!s) return { ...DEFAULTS };
  // Only carry over keys that exist in DEFAULTS — prevents stale/missing keys crashing
  const merged = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) {
    if (s[k] !== undefined) merged[k] = s[k];
  }
  return merged;
}
function saveSettings() {
  localStorage.setItem("cogblock_v12_settings", JSON.stringify(settings));
}
let settings = loadSettings();

// ─── State ───
const state = {
  phase: "idle",
  duration: null,
  blockDuration: null,
  current: null,
  previous: null,
  unresolvedStreak: 0,
  overloads: [],
  recoveries: [],
  recoveryCorrectCompleted: 0,  // used by terminal_recovery only
  spCorrectStreak: 0,           // consecutive corrects in SP restart phase
  spWrongCount: 0,              // total wrongs in SP restart phase
  terminalBlockReason: null,    // description of convergent blocks that triggered terminal rule
  _benchResolve: null,          // resolves benchmark promise on user action
  history: JSON.parse(localStorage.getItem("cogblock_v12_history") || "[]"),
  totalTrials: 0,
  totalResponses: 0,     // every tap (calibration + paced + recovery)
  totalCorrect: 0,       // correct taps across ALL phases
  totalIncorrect: 0,     // incorrect taps across ALL phases (not including misses)
  missedTrials: 0,       // paced frames with no response
  pacedErrors: 0,        // wrong taps during paced phase only
  rollMeanLog: [],       // last N answers (true/false) across all phases for roll mean check
  testStartTime: null,   // performance.now() at test start
  trialTimer: null,
  absoluteNoResponseTimer: null,
  maxTestTimer: null,
  lastFiveAnswers: [],
  samnPerelli: null,
  subjectId: null,
  calibrationTrialIndex: 0,
  calibrationRTs: [],
  calibrationErrors: 0,
  pacedRTs: [],          // correct paced response times (ms)
  rtLog: [],             // {seq, rt, correct, phase} for every paced tap + missed
  previousMissed: false, // was the immediately preceding paced frame a no-response?
  lastFrameDuration: null, // duration of the frame that was missed (for late-catch r calc)
  trialOpenedAt: null,
  geo: null,
  benchmark: null,
  lastResultText: null
};

// ─── DOM refs ───
const $ = id => document.getElementById(id);
const stimGrid    = $("stimGrid");
const probeCell   = $("probeCell");
const probeInner  = $("probeInner");
const respGrid    = $("respGrid");
const rateOut     = $("rateOut");
const blocksOut   = $("blocksOut");
const recoveryOut = $("recoveryOut");
const wrongOut    = $("wrongOut");
const fatigueOut  = $("fatigueOut");
const cpsOut      = $("cpsOut");
const statusLine  = $("statusLine");
const resultBox   = $("resultBox");
const phaseLabel  = $("phaseLabel");
const modeLabel   = $("modeLabel");
const metricsPanel= $("metricsPanel");
let deferredPrompt = null;

// ─── Utility ───
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function stdDev(a) {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((sum, v) => sum + (v - m) ** 2, 0) / (a.length - 1));
}
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function subjectKey(id) { return id === "0" ? "Guest" : id; }
function setStatus(m) { statusLine.textContent = m; }

// ─── CPS ───
function computeCPS(avgMs) {
  const best = Number(settings.cpsBestMs), worst = Number(settings.cpsWorstMs);
  const span = worst - best;
  if (!isFinite(best) || !isFinite(worst) || span <= 0) return 0;
  return Math.max(0, Math.min(100, ((worst - avgMs) / span) * 100));
}
function updateCPSDisplay(avg) {
  cpsOut.textContent = avg != null ? computeCPS(avg).toFixed(0) : "—";
}

// ─── Timers ───
function clearTimer() {
  if (state.trialTimer) clearTimeout(state.trialTimer);
  state.trialTimer = null;
}
function clearNoResponseTimer() {
  if (state.absoluteNoResponseTimer) clearTimeout(state.absoluteNoResponseTimer);
  state.absoluteNoResponseTimer = null;
}
function clearMaxTestTimer() {
  if (state.maxTestTimer) clearTimeout(state.maxTestTimer);
  state.maxTestTimer = null;
}
function armNoResponseTimer() {
  clearNoResponseTimer();
  state.absoluteNoResponseTimer = setTimeout(() => {
    state.endReason = `No response for more than ${settings.noResponseTimeoutMs} ms`;
    finish();
  }, settings.noResponseTimeoutMs);
}
function armMaxTestTimer() {
  clearMaxTestTimer();
  const ms = Number(settings.maxTestDurationMs) || 120000;
  state.maxTestTimer = setTimeout(() => {
    state.endReason = `Maximum test time reached (${(ms/1000).toFixed(0)} s)`;
    finish();
  }, ms);
}
function noteAnyResponse() { armNoResponseTimer(); }

// ─── Quiet mode during test ───
function setTestingQuiet(isQuiet) {
  metricsPanel.style.display = isQuiet ? "none" : "grid";
  statusLine.style.display   = isQuiet ? "none" : "block";
  resultBox.classList.add("hidden");
}

// ─── Geo ───
async function captureGeoAndAddress() {
  const now = new Date();
  const base = { local_time: now.toLocaleString(), gmt_time: now.toUTCString(), date_iso: now.toISOString() };
  if (!navigator.geolocation) { state.geo = { ...base, status: "unavailable" }; return; }
  const pos = await new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { enableHighAccuracy: true, timeout: 7000, maximumAge: 0 });
  });
  if (!pos) { state.geo = { ...base, status: "denied_or_failed" }; return; }
  state.geo = { ...base, status: "ok", latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy_m: pos.coords.accuracy };
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`;
    const r = await fetch(url, { headers: { "Accept": "application/json" } });
    const data = await r.json();
    state.geo.address = data.display_name || "";
  } catch (e) {
    state.geo.address_error = "reverse_geocode_failed";
  }
}

// ─── Device benchmark ───
// Phase 1: how fast can the processor generate + render 100 trials?
// Phase 2: how accurately does setTimeout(0) fire — measures JS scheduler overhead.
// Both phases run as fast as the processor allows — no deliberate waits.
async function runDeviceBenchmark(force) {
  const enabled = force || Number(settings.deviceBenchmarkEnabled || 0) === 1;
  if (!enabled) { state.benchmark = null; return; }

  const BENCH_TRIALS = 1000;

  const overlay     = $("benchmarkOverlay");
  const statusLine  = $("benchStatusLine");
  const statsBox    = $("benchStats");
  const gradeEl     = $("benchGrade");
  const chartCanvas = $("benchChart");
  const btnsEl      = $("benchBtns");

  if (overlay)     overlay.classList.remove("hidden");
  if (gradeEl)     gradeEl.style.display  = "none";
  if (chartCanvas) chartCanvas.style.display = "none";
  if (btnsEl)      btnsEl.style.display   = "none";
  if (statsBox)    statsBox.innerHTML      = "";

  // ── Phase 1: Processor speed — generate + render trials as fast as possible ──
  if (statusLine) statusLine.textContent = "Phase 1: Measuring processor speed…";
  await new Promise(r => setTimeout(r, 50)); // allow UI to update

  const procTimes = [];
  for (let i = 0; i < BENCH_TRIALS; i++) {
    const t0 = performance.now();
    const trial = makeTrial("paced", i > 0 ? i % 6 : null);
    renderTrial(trial);
    procTimes.push(performance.now() - t0);
    if (statusLine && i % 10 === 9)
      statusLine.textContent = `Phase 1: ${i + 1}/${BENCH_TRIALS} trials…`;
  }
  setProbeIdle();

  const avgProcMs      = mean(procTimes);
  const minProcMs      = Math.min(...procTimes);
  const maxProcMs      = Math.max(...procTimes);
  const procSd         = stdDev(procTimes) || 0;
  const minPossibleDurMs = Math.ceil(avgProcMs + procSd * 2);

  // ── Phase 2: Scheduler overhead — how fast does setTimeout(0) actually fire? ──
  if (statusLine) statusLine.textContent = "Phase 2: Measuring scheduler speed…";
  await new Promise(r => setTimeout(r, 50));

  const schedTimes = [];
  await new Promise(resolve => {
    let n = 0;
    function next() {
      if (n >= BENCH_TRIALS) { resolve(); return; }
      const t0 = performance.now();
      setTimeout(() => {
        schedTimes.push(performance.now() - t0);
        n++;
        if (statusLine && n % 10 === 0)
          statusLine.textContent = `Phase 2: ${n}/${BENCH_TRIALS} scheduler calls…`;
        next();
      }, 0);
    }
    next();
  });

  const avgSchedMs = mean(schedTimes);
  const minSchedMs = Math.min(...schedTimes);
  const maxSchedMs = Math.max(...schedTimes);
  const schedSd    = stdDev(schedTimes) || 0;

  // ── Scores ──
  // Proc score: 100 = <0.5ms avg, 0 = >20ms
  const procScore  = Math.max(0, Math.min(100, Math.round(100 - (avgProcMs / 20) * 100)));
  // Sched score: 100 = <1ms avg scheduler overhead, 0 = >20ms
  const schedScore = Math.max(0, Math.min(100, Math.round(100 - (avgSchedMs / 20) * 100)));
  const overallScore = Math.round((procScore + schedScore) / 2);

  const grade = overallScore >= 90 ? "A" : overallScore >= 75 ? "B" : overallScore >= 55 ? "C" : "D";
  const gradeClass = grade === "A" ? "a" : grade === "B" ? "b" : grade === "C" ? "c" : "d";

  state.benchmark = {
    enabled: true, trials: BENCH_TRIALS,
    avgProcMs, minProcMs, maxProcMs, procSd,
    minPossibleDurMs,
    avgSchedMs, minSchedMs, maxSchedMs, schedSd,
    procScore, schedScore, overallScore, grade,
    schedTimes: [...schedTimes], procTimes: [...procTimes]
  };

  if (statusLine) statusLine.textContent = "Benchmark complete";

  if (gradeEl) {
    gradeEl.textContent = `Grade: ${grade}  (${overallScore}/100)`;
    gradeEl.className   = `bench-grade ${gradeClass}`;
    gradeEl.style.display = "block";
  }

  const canRun = minPossibleDurMs < 1000;
  const rows = [
    ["── PROCESSOR SPEED ──", ""],
    ["Avg render time",     `${avgProcMs.toFixed(2)} ms`],
    ["Min / Max render",    `${minProcMs.toFixed(2)} / ${maxProcMs.toFixed(2)} ms`],
    ["Render SD",           `${procSd.toFixed(2)} ms`],
    ["Min presentation rate", `~${minPossibleDurMs} ms/trial`],
    ["Can run <1000ms?",    canRun ? `✓ Yes — floor ~${minPossibleDurMs}ms` : `✗ Marginal (${minPossibleDurMs}ms floor)`],
    ["Processor score",     `${procScore} / 100`],
    ["── SCHEDULER SPEED ──", ""],
    ["Avg setTimeout(0)",   `${avgSchedMs.toFixed(2)} ms`],
    ["Min / Max",           `${minSchedMs.toFixed(2)} / ${maxSchedMs.toFixed(2)} ms`],
    ["Scheduler SD",        `${schedSd.toFixed(2)} ms`],
    ["Scheduler score",     `${schedScore} / 100`],
    ["── OVERALL ──", ""],
    ["Score",               `${overallScore} / 100`],
    ["Grade",               grade],
  ];

  if (statsBox) {
    statsBox.innerHTML = rows.map(([label, val]) =>
      val === ""
        ? `<div style="font-size:11px;color:var(--accent);font-weight:700;margin-top:8px;letter-spacing:.08em">${label}</div>`
        : `<div class="bench-stat"><span class="bench-label">${label}</span><span class="bench-val">${val}</span></div>`
    ).join("");
  }

  // Chart: scheduler call times per trial
  if (chartCanvas) {
    chartCanvas.style.display = "block";
    const ctx = chartCanvas.getContext("2d");
    const W = chartCanvas.width, H = chartCanvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#081321"; ctx.fillRect(0, 0, W, H);
    const PAD = { top: 20, right: 10, bottom: 24, left: 46 };
    const cW = W - PAD.left - PAD.right, cH = H - PAD.top - PAD.bottom;
    const vMax = Math.max(...schedTimes, 10);
    function yOf(v) { return PAD.top + cH - (v / vMax) * cH; }
    // Grid
    ctx.strokeStyle = "rgba(79,111,153,.25)"; ctx.lineWidth = 1;
    [0, .25, .5, .75, 1].forEach(f => {
      const y = PAD.top + cH * (1 - f);
      ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke();
      ctx.fillStyle = "#7fa0c0"; ctx.font = "9px sans-serif"; ctx.textAlign = "right";
      ctx.fillText(`${(vMax * f).toFixed(1)}ms`, PAD.left - 3, y + 3);
    });
    // Line
    ctx.strokeStyle = "#7fd7ff"; ctx.lineWidth = 1.5;
    ctx.beginPath();
    schedTimes.forEach((v, i) => {
      const x = PAD.left + (i / (BENCH_TRIALS - 1)) * cW;
      i === 0 ? ctx.moveTo(x, yOf(v)) : ctx.lineTo(x, yOf(v));
    });
    ctx.stroke();
    // Avg line
    const yAvg = yOf(avgSchedMs);
    ctx.strokeStyle = "rgba(255,159,64,.6)"; ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(PAD.left, yAvg); ctx.lineTo(PAD.left + cW, yAvg); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#ff9f40"; ctx.font = "9px sans-serif"; ctx.textAlign = "left";
    ctx.fillText("avg", PAD.left + cW + 2, yAvg + 3);
    // Labels
    ctx.fillStyle = "#d7e7f8"; ctx.font = "bold 10px sans-serif"; ctx.textAlign = "left";
    ctx.fillText("Scheduler overhead per call — setTimeout(0) actual latency", PAD.left, 14);
    ctx.fillStyle = "#7fa0c0"; ctx.font = "9px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("Call →", PAD.left + cW / 2, H - 2);
  }

  if (btnsEl) btnsEl.style.display = "grid";
}

// ═══════════════════════════════════════════════════
//  SVG RENDERING — dots and lines only, no shapes
// ═══════════════════════════════════════════════════

/**
 * Renders a pattern (dots or lines) as an inline SVG.
 * size: "large" for stim cells, "probe" for center, "small" for refresher
 */
function patternToSVG(pattern, size = "large") {
  const dim  = size === "probe" ? 72 : size === "small" ? 40 : 56;
  const dotR = size === "probe" ? 8  : size === "small" ? 5  : 7;
  const lineW = size === "probe" ? 10 : size === "small" ? 6  : 9;
  const lineH = size === "probe" ? 26 : size === "small" ? 15 : 22;
  const marks = pattern.map(([k, x, y]) => {
    const px = (x / 100) * dim, py = (y / 100) * dim;
    if (k === "dot") return `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${dotR}" fill="var(--text)"/>`;
    return `<rect x="${(px - lineW / 2).toFixed(1)}" y="${(py - lineH / 2).toFixed(1)}" width="${lineW}" height="${lineH}" rx="2" fill="var(--text)"/>`;
  }).join("");
  return `<svg class="pat-svg" width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}" xmlns="http://www.w3.org/2000/svg">${marks}</svg>`;
}

// ─── Build a trial ───
// Top cells: random mix of dots AND lines (not all same family).
// Probe: dots or lines. Exactly one top cell matches probe count AND is opposite family.
// All other top cells either have a different count, or if same count, same family as probe.
// lastCorrectPos: the correct position from the previous trial — new trial must differ.

function makeTrial(kind, lastCorrectPos) {
  for (let attempt = 0; attempt < 500; attempt++) {
    // Choose probe family and count
    const probeFamily  = Math.random() < 0.5 ? "dots" : "lines";
    const probeCount   = randInt(1, 6);
    const probePattern = probeFamily === "dots" ? DOT_PATTERNS[probeCount] : LINE_PATTERNS[probeCount];
    const oppFamily    = probeFamily === "dots" ? "lines" : "dots";

    // Choose correct position — must differ from lastCorrectPos
    const correctPos = (() => {
      if (lastCorrectPos == null) return randInt(0, 5);
      let p;
      let tries = 0;
      do { p = randInt(0, 5); tries++; } while (p === lastCorrectPos && tries < 20);
      return p;
    })();

    // Build 6 top cells: random mix of dots and lines
    // correctPos cell: opposite family, probeCount
    // Other cells: must NOT be (oppFamily + probeCount) — i.e. must not also be a correct answer
    const counts = shuffle([1, 2, 3, 4, 5, 6]);
    // Ensure probeCount lands at correctPos
    const existingAt = counts.indexOf(probeCount);
    [counts[correctPos], counts[existingAt]] = [counts[existingAt], counts[correctPos]];

    // Assign families: correctPos gets oppFamily; others get random family
    // but if another cell has probeCount AND oppFamily it would be a second correct answer — reject
    const families = [];
    let valid = true;
    for (let i = 0; i < 6; i++) {
      if (i === correctPos) {
        families.push(oppFamily);
      } else {
        // Randomly pick family; if this cell has probeCount, must NOT be oppFamily
        let f;
        if (counts[i] === probeCount) {
          // Force same family as probe so it doesn't match
          f = probeFamily;
        } else {
          f = Math.random() < 0.5 ? "dots" : "lines";
        }
        families.push(f);
      }
    }

    // Build topItems
    const topItems = counts.map((c, i) => {
      const fam = families[i];
      return { count: c, family: fam, pattern: fam === "dots" ? DOT_PATTERNS[c] : LINE_PATTERNS[c] };
    });

    // Validation: exactly one cell is (oppFamily + probeCount)
    const correctMatches = topItems.filter(x => x.count === probeCount && x.family === oppFamily);
    if (correctMatches.length !== 1) continue;
    if (topItems[correctPos].count !== probeCount || topItems[correctPos].family !== oppFamily) continue;
    if (correctPos === lastCorrectPos) continue;

    return {
      kind,
      probePattern,
      probeCount,
      probeFamily,
      topItems,
      correctPos,
      resolved: false
    };
  }
  throw new Error("Could not generate valid trial");
}

// ─── Render the trial layout ───
function renderTrial(trial) {
  // --- Stimulus grid (top, 2 rows × 3 cols) ---
  stimGrid.innerHTML = "";
  for (let i = 0; i < 6; i++) {
    const cell = document.createElement("div");
    cell.className = "stim-cell";
    // position label: row 1 = positions 1–3, row 2 = positions 4–6
    const label = document.createElement("div");
    label.className = "cell-label";
    label.textContent = String(i + 1);
    cell.appendChild(label);
    cell.innerHTML += patternToSVG(trial.topItems[i].pattern, "large");
    stimGrid.appendChild(cell);
  }

  // --- Probe (center) ---
  probeCell.classList.remove("idle");
  probeInner.innerHTML = patternToSVG(trial.probePattern, "probe");

  // --- Response buttons (bottom, same 2×3 layout) ---
  respGrid.innerHTML = "";
  for (let i = 0; i < 6; i++) {
    const btn = document.createElement("div");
    btn.className = "resp-btn";
    const pos = document.createElement("div");
    pos.className = "resp-pos";
    pos.textContent = String(i + 1);
    btn.appendChild(pos);
    const capturedIndex = i;
    btn.addEventListener("pointerdown", () => handleTap(capturedIndex, btn));
    respGrid.appendChild(btn);
  }
}

// ─── Flash feedback on button ───
function flashBtn(index, correct) {
  const btns = respGrid.querySelectorAll(".resp-btn");
  if (!btns[index]) return;
  const cls = correct ? "correct-flash" : "wrong-flash";
  btns[index].classList.add(cls);
  setTimeout(() => btns[index].classList.remove(cls), 200);
}

// ─── Idle probe ───
function setProbeIdle() {
  probeCell.classList.add("idle");
  probeInner.innerHTML = "";
  stimGrid.innerHTML = "";
  respGrid.innerHTML = "";
}

// ═══════════════════════════════════════════════════
//  TEST LOGIC
// ═══════════════════════════════════════════════════

function updateMetrics() {
  rateOut.textContent   = state.duration ? `${Math.round(state.duration)} ms` : "—";
  blocksOut.textContent = String(state.overloads.length);
  recoveryOut.textContent = String(state.recoveries.length);
  wrongOut.textContent  = String(state.lastFiveAnswers.filter(v => v === false).length + state.calibrationErrors);
  fatigueOut.textContent = state.samnPerelli ? String(state.samnPerelli.score) : "—";
}

function trialMatches(trial, index) {
  return trial && index === trial.correctPos;
}

function recordAnswer(ok, isMiss) {
  // Misses (no tap) do NOT count toward roll mean or wrong-threshold —
  // only actual tap responses count
  if (!isMiss) {
    // ── per-window wrong-answer check ──
    state.lastFiveAnswers.push(ok);
    if (state.lastFiveAnswers.length > settings.wrongWindowSize) state.lastFiveAnswers.shift();

    // ── rolling mean check ──
    state.rollMeanLog.push(ok);
    const win = Math.max(1, Math.round(Number(settings.rollMeanWindow) || 8));
    if (state.rollMeanLog.length > win) state.rollMeanLog.shift();
    if (state.rollMeanLog.length === win) {
      const correctCount = state.rollMeanLog.filter(v => v === true).length;
      const ratio = correctCount / win;
      if (ratio < 0.70) {
        state.endReason = `Too many wrong responses (${correctCount}/${win} correct = ${(ratio * 100).toFixed(0)}% — below 70% threshold)`;
        finish();
        return true;
      }
    }

    // ── wrong-threshold stop ──
    const wc = state.lastFiveAnswers.filter(v => v === false).length;
    if (state.lastFiveAnswers.length === settings.wrongWindowSize && wc > settings.wrongThresholdStop) {
      state.endReason = `More than ${settings.wrongThresholdStop} wrong answers out of last ${settings.wrongWindowSize}. Restart required.`;
      finish();
      return true;
    }
  }

  updateMetrics();
  return false;
}

function avgLast2Blocks() {
  if (state.overloads.length < 2) return null;
  return (state.overloads[state.overloads.length - 1] + state.overloads[state.overloads.length - 2]) / 2;
}

function maybeTriggerTerminalRule() {
  if (state.overloads.length < 2) return false;
  const n = state.overloads.length;
  const b1 = state.overloads[n - 2];
  const b2 = state.overloads[n - 1];
  const diff = Math.abs(b2 - b1);
  if (diff < settings.qualifyingBlockGapMs) {
    state.terminalBlockReason = `2 consecutive blocks within ${settings.qualifyingBlockGapMs} ms threshold (Block ${n-1}: ${b1.toFixed(0)} ms, Block ${n}: ${b2.toFixed(0)} ms, diff: ${diff.toFixed(0)} ms)`;
    state.phase = "terminal_recovery";
    state.recoveryCorrectCompleted = 0;
    state.spCorrectStreak = 0;
    state.spWrongCount = 0;
    openTrial("terminal_recovery");
    return true;
  }
  return false;
}

function failCalibrationAndRetest(reason) {
  state.endReason = reason + " Retest required.";
  finish();
}

function finishCalibration() {
  const avg = mean(state.calibrationRTs);
  const pacedStart = clamp(avg * settings.initialPacedPercent, settings.minDurationMs, settings.maxDurationMs);
  state.duration = pacedStart;
  state.phase = "paced";
  state.testStartTime = performance.now();  // start duration clock when MP begins
  armMaxTestTimer();                         // max-test timer starts at same moment
  setStatus(`Machine-paced start: ${pacedStart.toFixed(1)} ms`);
  openTrial("paced");
}

function formatDuration(ms) {
  if (ms == null) return "—";
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function finish() {
  clearTimer(); clearNoResponseTimer(); clearMaxTestTimer();
  state.phase = "finished";

  const avg2      = avgLast2Blocks();
  const cps       = avg2 != null ? computeCPS(avg2) : null;
  const sd        = stdDev(state.pacedRTs);
  const blockDiff = state.overloads.length >= 2
    ? state.overloads[state.overloads.length - 1] - state.overloads[state.overloads.length - 2]
    : null;
  const testDurMs = state.testStartTime != null ? performance.now() - state.testStartTime : null;

  const result = {
    subjectId:                  subjectKey(state.subjectId || "0"),
    samnPerelli:                state.samnPerelli,
    calibrationAverageMs:       state.calibrationRTs.length ? mean(state.calibrationRTs) : null,
    blocks:                     [...state.overloads],
    blockCount:                 state.overloads.length,
    averageLast2BlockingScoresMs: avg2,
    blockScoreDifferenceMs:     blockDiff,
    cognitivePerformanceScore:  cps,
    totalResponses:             state.totalResponses,
    totalTrials:                state.totalTrials,
    totalCorrect:               state.totalCorrect,
    totalIncorrect:             state.totalIncorrect,
    missedTrials:               state.missedTrials,
    pacedErrors:                state.pacedErrors,
    pacedResponseCount:         state.pacedRTs.length,
    pacedResponseMeanMs:        state.pacedRTs.length ? mean(state.pacedRTs) : null,
    pacedResponseSdMs:          sd,
    testDurationMs:             testDurMs,
    rtLog:                      [...state.rtLog],
    endReason:                  state.endReason || "Run complete",
    time:                       new Date().toISOString(),
    geo:                        state.geo
  };

  state.history.push(result);
  localStorage.setItem("cogblock_v12_history", JSON.stringify(state.history));
  updateCPSDisplay(avg2);
  setProbeIdle();

  // ── geo string ──
  let geoStr = "unavailable";
  if (result.geo) {
    if (result.geo.status === "ok") {
      geoStr = result.geo.address
        ? result.geo.address
        : `${result.geo.latitude.toFixed(5)}, ${result.geo.longitude.toFixed(5)}`;
      geoStr += ` (±${Math.round(result.geo.accuracy_m)} m)`;
    } else {
      geoStr = result.geo.status;
    }
  }

  // ── build clean readable results text ──
  const hr  = "─────────────────────────";
  const spf = result.samnPerelli
    ? `${result.samnPerelli.score}  (${result.samnPerelli.label})`
    : "not recorded";
  const blockList = result.blocks.length
    ? result.blocks.map((b, i) => `  Block ${i + 1}: ${b.toFixed(0)} ms`).join("\n")
    : "  none";
  const diffStr = blockDiff != null
    ? `${blockDiff > 0 ? "+" : ""}${blockDiff.toFixed(0)} ms  (${blockDiff > 0 ? "slower" : blockDiff < 0 ? "faster" : "no change"})`
    : "—";

  const text =
`CogBlock V12  —  Test Results
${hr}
Date / Time:   ${new Date(result.time).toLocaleString()}
Subject ID:    ${result.subjectId}
Location:      ${geoStr}
${hr}
FATIGUE (S-PF)
  Pre-test rating:  ${spf}
${hr}
CALIBRATION
  Average RT:  ${result.calibrationAverageMs != null ? result.calibrationAverageMs.toFixed(1) + " ms" : "—"}
${hr}
MACHINE-PACED PERFORMANCE
  Block scores:
${blockList}
  Avg last 2 blocks:   ${avg2 != null ? avg2.toFixed(1) + " ms" : "—"}
  Block score diff:    ${diffStr}
  CPS:                 ${cps != null ? cps.toFixed(1) + " / 100" : "—"}
${hr}
RESPONSE STATISTICS
  Total taps:            ${result.totalResponses}
    Correct:             ${result.totalCorrect}
    Incorrect:           ${result.totalIncorrect}
  Missed (no response):  ${result.missedTrials}
  Paced correct taps:    ${result.pacedResponseCount}
  Paced wrong taps:      ${result.pacedErrors}
  Mean paced RT:         ${result.pacedResponseMeanMs != null ? result.pacedResponseMeanMs.toFixed(1) + " ms" : "—"}
  Paced RT SD:           ${sd != null ? sd.toFixed(1) + " ms" : "—"}
  Test duration:         ${formatDuration(testDurMs)}
${hr}
END REASON
  ${result.endReason}`;

  state.lastResultText = text;
  showResultsPage(text);
}

function openTrial(kind) {
  clearTimer();
  state.previous = state.current;
  const lastCorrectPos = state.current ? state.current.correctPos : null;
  state.current  = makeTrial(kind, lastCorrectPos);
  state.trialOpenedAt = performance.now();
  renderTrial(state.current);
  updateMetrics();

  if (kind === "calibration") {
    const idx   = state.calibrationTrialIndex + 1;
    const total = settings.initialUnusedCalibrationTrials + settings.initialMeasuredCalibrationTrials;
    phaseLabel.textContent = `Cal ${idx}/${total}`;
    setStatus(idx <= settings.initialUnusedCalibrationTrials ? "Self-paced (unused)" : "Self-paced (measured)");
  } else if (kind === "paced") {
    phaseLabel.textContent = `Paced · ${Math.round(state.duration)} ms`;
    setStatus("Machine-paced");
    state.trialTimer = setTimeout(onPacedFrameEnd, state.duration);
  } else if (kind === "recovery") {
    phaseLabel.textContent = `SP Restart ${state.spCorrectStreak}✓ ${state.spWrongCount}✗`;
    setStatus(`SP Restart — need ${settings.spRestartCorrectStreak} in a row (${state.spWrongCount}/${settings.spRestartWrongLimit} wrong)`);
  } else if (kind === "terminal_recovery") {
    phaseLabel.textContent = `Final SP ${state.recoveryCorrectCompleted + 1}/${settings.spRestartCorrectStreak}`;
    setStatus("Final self-paced recovery");
  }
}

// ─── New pacing formula ───
// r = RT / presentationRate
// Δ = (0.1r - 0.1) * duration   →  negative = speedup, positive = slowdown
// Correct: apply Δ
// No response: no change
// Wrong: +100 ms
function applyPacingAdjustment(rt, correct, durationUsed) {
  if (correct) {
    const r = rt / durationUsed;
    const delta = (0.1 * r - 0.1) * durationUsed;
    state.duration = clamp(state.duration + delta, settings.minDurationMs, settings.maxDurationMs);
  } else {
    // wrong response
    state.duration = clamp(state.duration + 100, settings.minDurationMs, settings.maxDurationMs);
  }
}

function onPacedFrameEnd() {
  if (state.phase !== "paced") return;
  state.totalTrials += 1;
  const currentMissed = state.current && state.current.kind === "paced" && !state.current.resolved;

  if (currentMissed) {
    state.rtLog.push({ seq: state.rtLog.length + 1, rt: null, correct: false, phase: "missed" });
    state.missedTrials += 1;       // missed = no tap, not a wrong tap
    state.previousMissed = true;
    state.lastFrameDuration = state.duration;
    if (recordAnswer(false, true)) return;  // isMiss=true
  } else {
    state.previousMissed = false;
    state.lastFrameDuration = null;
  }

  state.unresolvedStreak = currentMissed ? state.unresolvedStreak + 1 : 0;
  if (state.unresolvedStreak >= settings.consecutiveMissesForBlock) {
    state.blockDuration = state.duration;
    state.overloads.push(state.blockDuration);
    state.unresolvedStreak = 0;
    state.previousMissed = false;
    state.lastFrameDuration = null;
    updateCPSDisplay(avgLast2Blocks());
    if (maybeTriggerTerminalRule()) return;
    state.phase = "recovery";
    state.recoveryCorrectCompleted = 0;
    state.spCorrectStreak = 0;
    state.spWrongCount = 0;
    openTrial("recovery");
    return;
  }
  if (state.totalTrials >= settings.maxTrialCount) {
    state.endReason = `Trial cap reached (${settings.maxTrialCount} trials)`;
    finish();
  } else {
    openTrial("paced");
  }
}

function handleTap(index, btnEl) {
  if (!["calibration", "paced", "recovery", "terminal_recovery"].includes(state.phase)) return;
  noteAnyResponse();

  if (state.phase === "calibration") {
    const rt = performance.now() - state.trialOpenedAt;
    const ok = trialMatches(state.current, index);
    flashBtn(index, ok);
    // count every calibration tap toward all-phase totals
    state.totalResponses += 1;
    if (ok) state.totalCorrect += 1;
    else    state.totalIncorrect += 1;
    if (!ok) {
      state.calibrationErrors += 1;
      updateMetrics();
      if (state.calibrationErrors > settings.calibrationStopErrors) {
        failCalibrationAndRetest(`More than ${settings.calibrationStopErrors} calibration errors.`);
        return;
      }
    } else {
      if (rt > settings.calibrationStopSlowMs) {
        failCalibrationAndRetest(`Calibration response exceeded ${settings.calibrationStopSlowMs} ms.`);
        return;
      }
      if (state.calibrationTrialIndex >= settings.initialUnusedCalibrationTrials) state.calibrationRTs.push(rt);
    }
    state.calibrationTrialIndex += 1;
    if (state.calibrationTrialIndex >= settings.initialUnusedCalibrationTrials + settings.initialMeasuredCalibrationTrials) {
      finishCalibration();
    } else {
      openTrial("calibration");
    }
    return;
  }

  if (state.phase === "recovery") {
    // ── SP Restart Phase after a block ──
    clearTimer();
    const ok = trialMatches(state.current, index);
    flashBtn(index, ok);
    state.totalResponses += 1;
    if (ok) state.totalCorrect += 1; else state.totalIncorrect += 1;

    if (ok) {
      state.spCorrectStreak += 1;
      state.current.resolved = true;
      const streakNeeded = Math.max(1, Math.round(Number(settings.spRestartCorrectStreak) || 2));
      if (state.spCorrectStreak >= streakNeeded) {
        // 2 correct in a row — success, re-enter MP with slowdown
        const slower = clamp(
          state.blockDuration + (Number(settings.spRestartSlowerByMs) || 375),
          settings.minDurationMs, settings.maxDurationMs
        );
        state.recoveries.push(slower);
        state.phase = "paced";
        state.duration = slower;
        state.spCorrectStreak = 0; state.spWrongCount = 0;
        phaseLabel.textContent = `Paced · ${Math.round(slower)} ms`;
        setStatus(`SP Restart passed — resuming at ${slower.toFixed(0)} ms`);
        setTimeout(() => openTrial("paced"), 180);
      } else {
        setStatus(`SP Restart: ${state.spCorrectStreak} correct in a row — need ${streakNeeded}`);
        setTimeout(() => openTrial("recovery"), 160);
      }
    } else {
      state.spCorrectStreak = 0; // reset streak on any wrong
      state.spWrongCount += 1;
      const wrongLimit = Math.max(1, Math.round(Number(settings.spRestartWrongLimit) || 3));
      if (state.spWrongCount >= wrongLimit) {
        // 3 wrong — bad end
        state.endReason = `SP Restart failed: ${wrongLimit} wrong responses before ${settings.spRestartCorrectStreak} correct in a row`;
        finish();
        return;
      }
      setStatus(`SP Restart: ${state.spWrongCount} wrong (limit ${wrongLimit})`);
      setTimeout(() => openTrial("recovery"), 160);
    }

    // roll mean / wrong-threshold checks (don't end via recordAnswer — we handle it above)
    recordAnswer(ok);
    return;
  }

  if (state.phase === "terminal_recovery") {
    // ── Terminal recovery: 2 self-paced correct then end ──
    clearTimer();
    const ok = trialMatches(state.current, index);
    flashBtn(index, ok);
    state.totalResponses += 1;
    if (ok) state.totalCorrect += 1; else state.totalIncorrect += 1;
    if (recordAnswer(ok)) return;
    if (ok) {
      state.current.resolved = true;
      state.recoveryCorrectCompleted += 1;
      const needed = Math.max(1, Math.round(Number(settings.spRestartCorrectStreak) || 2));
      if (state.recoveryCorrectCompleted >= needed) {
        state.endReason = `Convergent blocks — ${state.terminalBlockReason || "2 consecutive blocks within threshold"}. Completed ${needed} final self-paced trials.`;
        finish();
        return;
      }
      setTimeout(() => openTrial("terminal_recovery"), 160);
    } else {
      setTimeout(() => openTrial("terminal_recovery"), 160);
    }
    return;
  }

  // ── Paced phase tap handling ──
  const rt = performance.now() - state.trialOpenedAt;

  if (state.previousMissed && rt < 600) {
    // Fast response after a miss — assume it was meant for the PREVIOUS trial
    const lastDur = state.lastFrameDuration || state.duration;
    const correctForLast = state.previous && !state.previous.resolved && trialMatches(state.previous, index);

    state.totalResponses += 1;
    state.previousMissed = false;
    state.lastFrameDuration = null;

    if (correctForLast) {
      // Correct for last trial: effectiveRT = RT + lastDur → slowdown (faster than window)
      state.previous.resolved = true;
      const effectiveRT = rt + lastDur;
      applyPacingAdjustment(effectiveRT, true, state.duration);
      state.totalCorrect += 1;
      state.pacedRTs.push(rt);
      state.rtLog.push({ seq: state.rtLog.length + 1, rt, correct: true, phase: "paced_late_correct" });
      flashBtn(index, true);
      if (recordAnswer(true)) return;
    } else {
      // Wrong for last trial: +100ms slowdown
      applyPacingAdjustment(null, false, state.duration);
      state.totalIncorrect += 1;
      state.pacedErrors += 1;
      state.rtLog.push({ seq: state.rtLog.length + 1, rt, correct: false, phase: "paced_late_wrong" });
      flashBtn(index, false);
      if (recordAnswer(false)) return;
    }
    return;
  }

  // RT >= 600ms (or no preceding miss) — treat as response to CURRENT trial
  state.previousMissed = false;
  state.lastFrameDuration = null;

  if (state.current && state.current.kind === "paced" && !state.current.resolved && trialMatches(state.current, index)) {
    state.current.resolved = true;
    state.totalResponses += 1;
    state.totalCorrect += 1;
    applyPacingAdjustment(rt, true, state.duration);
    state.pacedRTs.push(rt);
    state.rtLog.push({ seq: state.rtLog.length + 1, rt, correct: true, phase: "paced" });
    flashBtn(index, true);
    if (recordAnswer(true)) return;
    return;
  }

  // Wrong response (no match on current trial)
  state.totalResponses += 1;
  state.totalIncorrect += 1;
  state.pacedErrors += 1;
  applyPacingAdjustment(null, false, state.duration);
  state.rtLog.push({ seq: state.rtLog.length + 1, rt: null, correct: false, phase: "paced_wrong" });
  flashBtn(index, false);
  recordAnswer(false);
}

// ═══════════════════════════════════════════════════
//  REFRESHER
// ═══════════════════════════════════════════════════

function renderRefresher() {
  const grid = $("refresherGrid");
  grid.innerHTML = "";
  for (let i = 1; i <= 6; i++) {
    const card = document.createElement("div");
    card.className = "ref-card";
    card.innerHTML = `<div class="ref-num">${i}</div>
      <div class="ref-row">
        <div><div class="ref-lbl">dots</div>${patternToSVG(DOT_PATTERNS[i], "small")}</div>
        <div class="ref-arrow">↔</div>
        <div><div class="ref-lbl">lines</div>${patternToSVG(LINE_PATTERNS[i], "small")}</div>
      </div>`;
    grid.appendChild(card);
  }
}

// ═══════════════════════════════════════════════════
//  FATIGUE CHECKLIST
// ═══════════════════════════════════════════════════

function renderFatigueChecklist() {
  const f = $("fatigueList");
  f.innerHTML = "";
  for (const [score, label] of SAMN_PERELLI) {
    const b = document.createElement("button");
    b.className = "fatigue-item";
    b.textContent = `${score}. ${label}`;
    b.onclick = () => {
      state.samnPerelli = { score, label };
      fatigueOut.textContent = String(score);
      $("fatigueOverlay").classList.add("hidden");
      setStatus(`Fatigue rating: ${score} — ${label}`);
    };
    f.appendChild(b);
  }
}

// ═══════════════════════════════════════════════════
//  ADMIN
// ═══════════════════════════════════════════════════

function renderAdmin() {
  const w = $("adminSettings");
  w.innerHTML = "";
  for (const [k, l, t] of ADMIN_FIELDS) {
    const r = document.createElement("div");
    r.style.cssText = "display:grid;grid-template-columns:1fr 140px;gap:8px;align-items:center;margin-bottom:8px";
    r.innerHTML = `<label style="font-size:14px;color:var(--text)">${l}<div style="font-size:11px;color:var(--muted)">${k}</div></label><input id="adm_${k}" type="${t}" value="${settings[k]}" style="padding:9px;border:1px solid var(--edge);border-radius:10px;background:#0a1629;color:var(--text);font-size:14px;width:100%">`;
    w.appendChild(r);
  }
  renderHistoryGraphs();
}

function readAdmin() {
  for (const [k, _, t] of ADMIN_FIELDS) {
    const el = $("adm_" + k);
    settings[k] = t === "number" ? Number(el.value) : el.value;
  }
}

function resetAdmin() {
  settings = { ...DEFAULTS };
  saveSettings();
  renderAdmin();
}

// ═══════════════════════════════════════════════════
//  CHARTS
// ═══════════════════════════════════════════════════

// ═══════════════════════════════════════════════════
//  CHARTS — combined CPS / Block Score / S-PF
// ═══════════════════════════════════════════════════

function drawCombinedChart(canvas, hist) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const PAD = { top: 32, right: 52, bottom: 38, left: 48 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;

  ctx.fillStyle = "#081321";
  ctx.fillRect(0, 0, W, H);

  if (!hist.length) {
    ctx.fillStyle = "#d7e7f8";
    ctx.font = "bold 13px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("No data yet", W / 2, H / 2);
    ctx.textAlign = "left";
    return;
  }

  const slice = hist.slice(-20);
  const n = slice.length;
  const xStep = n > 1 ? cW / (n - 1) : cW;

  // ── Raw series values ──
  const cpsVals   = slice.map(x => x.cognitivePerformanceScore ?? null);
  const blockVals = slice.map(x => x.averageLast2BlockingScoresMs ?? null);
  const spfVals   = slice.map(x => x.samnPerelli ? x.samnPerelli.score : null);

  // ── Left axis: CPS 0–100 ──
  const CPS_MIN = 0, CPS_MAX = 100;

  // ── Right axis: block time (ms) — auto-scale from data ──
  const blockValid = blockVals.filter(v => v != null);
  const blockRawMin = blockValid.length ? Math.min(...blockValid) : 0;
  const blockRawMax = blockValid.length ? Math.max(...blockValid) : 3000;
  // nice round ticks for right axis (block ms)
  const blockAxisMax = Math.ceil(blockRawMax / 500) * 500 || 3000;
  const blockAxisMin = Math.max(0, Math.floor(blockRawMin / 500) * 500);

  // ── Right axis: S-PF 1–7 (share the right axis, annotated separately) ──
  const SPF_MIN = 1, SPF_MAX = 7;

  // Convert to Y pixel coords
  function yLeft(v, lo, hi)  { return PAD.top + cH - ((v - lo) / ((hi - lo) || 1)) * cH; }
  function xOf(i)             { return PAD.left + (n > 1 ? i * xStep : cW / 2); }

  // ── Grid lines (based on left CPS axis, 5 lines 0/25/50/75/100) ──
  ctx.strokeStyle = "rgba(79,111,153,0.25)";
  ctx.lineWidth = 1;
  [0, 25, 50, 75, 100].forEach(v => {
    const y = yLeft(v, CPS_MIN, CPS_MAX);
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke();
  });

  // ── Left Y axis: CPS labels ──
  ctx.font = "10px sans-serif";
  ctx.fillStyle = "#7fd7ff";
  ctx.textAlign = "right";
  [0, 25, 50, 75, 100].forEach(v => {
    ctx.fillText(String(v), PAD.left - 4, yLeft(v, CPS_MIN, CPS_MAX) + 4);
  });
  // Left axis title
  ctx.save();
  ctx.translate(11, PAD.top + cH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = "#7fd7ff";
  ctx.font = "bold 9px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("CPS", 0, 0);
  ctx.restore();

  // ── Right Y axis: Block ms labels ──
  ctx.fillStyle = "#ff9f40";
  ctx.textAlign = "left";
  const blockTicks = 5;
  for (let t = 0; t <= blockTicks; t++) {
    const v = blockAxisMin + (t / blockTicks) * (blockAxisMax - blockAxisMin);
    // Map block ms to pixel using same pixel range but block scale
    const y = PAD.top + cH - (t / blockTicks) * cH;
    ctx.fillText(v >= 1000 ? (v/1000).toFixed(1)+"s" : Math.round(v)+"ms", PAD.left + cW + 4, y + 4);
  }
  // Right axis title
  ctx.save();
  ctx.translate(W - 6, PAD.top + cH / 2);
  ctx.rotate(Math.PI / 2);
  ctx.fillStyle = "#ff9f40";
  ctx.font = "bold 9px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Block ms", 0, 0);
  ctx.restore();

  // ── X axis labels ──
  ctx.fillStyle = "#7fa0c0";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "center";
  for (let i = 0; i < n; i++) {
    ctx.fillText(String(i + 1), xOf(i), PAD.top + cH + 14);
  }
  ctx.fillText("Session →", PAD.left + cW / 2, PAD.top + cH + 28);
  ctx.textAlign = "left";

  // ── Helper: draw a series ──
  function drawSeries(vals, toY, color, dashed) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.2;
    ctx.setLineDash(dashed || []);
    ctx.beginPath();
    let started = false;
    vals.forEach((v, i) => {
      if (v == null) { started = false; return; }
      const x = xOf(i), y = toY(v);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    vals.forEach((v, i) => {
      if (v == null) return;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(xOf(i), toY(v), 3.5, 0, Math.PI * 2); ctx.fill();
      // value label above dot
      ctx.fillStyle = color;
      ctx.font = "9px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(typeof v === "number" ? (v > 100 ? (v/1000).toFixed(1)+"s" : v.toFixed(0)) : "", xOf(i), toY(v) - 6);
      ctx.textAlign = "left";
    });
  }

  // Normalize block ms to left-axis pixel space using its own scale
  function yBlock(v) {
    return PAD.top + cH - ((v - blockAxisMin) / ((blockAxisMax - blockAxisMin) || 1)) * cH;
  }
  function ySpf(v) {
    return yLeft(v, SPF_MIN, SPF_MAX);
  }

  drawSeries(cpsVals,   v => yLeft(v, CPS_MIN, CPS_MAX), "#7fd7ff");
  drawSeries(blockVals, yBlock,  "#ff9f40", [5, 3]);
  drawSeries(spfVals,   ySpf,   "#a8ff78", [2, 4]);

  // ── S-PF right-side tick annotations (1–7) ──
  ctx.fillStyle = "#a8ff78";
  ctx.font = "9px sans-serif";
  ctx.textAlign = "left";
  [1, 4, 7].forEach(v => {
    ctx.fillText(`${v}`, PAD.left + cW + 4, ySpf(v) + 3);
  });
  ctx.save();
  ctx.translate(W - 6, PAD.top + cH * 0.25);
  ctx.rotate(Math.PI / 2);
  ctx.fillStyle = "#a8ff78";
  ctx.font = "bold 9px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("S-PF", 0, 0);
  ctx.restore();

  // ── Legend ──
  const legend = [
    { color: "#7fd7ff", label: "CPS",       dash: [] },
    { color: "#ff9f40", label: "Block ms",  dash: [5, 3] },
    { color: "#a8ff78", label: "S-PF",      dash: [2, 4] }
  ];
  let lx = PAD.left;
  legend.forEach(({ color, label, dash }) => {
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(lx, 16); ctx.lineTo(lx + 16, 16); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.font = "bold 10px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(label, lx + 20, 20);
    lx += ctx.measureText(label).width + 38;
  });
}

function renderHistoryGraphs() {
  const hist = state.history || [];
  drawCombinedChart($("resultsCombinedChart"), hist);
  drawCombinedChart($("adminCombinedChart"),   hist);
  const note = state.benchmark && state.benchmark.enabled
    ? `Benchmark grade ${state.benchmark.grade} (${state.benchmark.overallScore}/100) | ` +
      `proc ${state.benchmark.avgProcMs.toFixed(2)}ms avg | min rate ${state.benchmark.minPossibleDurMs}ms | ` +
      `scheduler ${state.benchmark.avgSchedMs.toFixed(2)}ms avg`
    : "Device benchmark — tap 'Run Benchmark' on main screen";
  const an = $("adminBenchmarkNote");
  if (an) an.textContent = note;
}

function drawRTScatterChart(canvas, rtLog, blockScores, meanRT, sdRT) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  ctx.fillStyle = "#081321";
  ctx.fillRect(0, 0, W, H);

  const PAD = { top: 28, right: 14, bottom: 36, left: 52 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;

  // Filter to entries with actual RT values
  const withRT = rtLog.filter(e => e.rt != null);

  if (!withRT.length) {
    ctx.fillStyle = "#d7e7f8";
    ctx.font = "bold 13px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("No paced responses recorded", W / 2, H / 2);
    ctx.textAlign = "left";
    return;
  }

  const n = rtLog.length;
  const rtVals = withRT.map(e => e.rt);
  const rtMax = Math.max(...rtVals, meanRT != null ? meanRT + (sdRT || 0) * 2 : 0);
  const rtMin = 0;
  const rtSpan = rtMax || 1;

  function xOf(seq) { return PAD.left + ((seq - 1) / Math.max(1, n - 1)) * cW; }
  function yOf(rt)  { return PAD.top + cH - (rt / rtSpan) * cH; }

  // Grid lines
  ctx.strokeStyle = "rgba(79,111,153,0.25)";
  ctx.lineWidth = 1;
  const yTicks = 5;
  for (let g = 0; g <= yTicks; g++) {
    const rt = (g / yTicks) * rtMax;
    const y = yOf(rt);
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke();
    ctx.fillStyle = "#7fa0c0";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(rt >= 1000 ? (rt / 1000).toFixed(1) + "s" : Math.round(rt) + "ms", PAD.left - 4, y + 4);
  }
  ctx.textAlign = "left";

  // X axis label
  ctx.fillStyle = "#7fa0c0";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Trial sequence →", PAD.left + cW / 2, H - 4);
  ctx.textAlign = "left";

  // SD band
  if (meanRT != null && sdRT != null) {
    const yTop    = yOf(Math.min(meanRT + sdRT, rtMax));
    const yBottom = yOf(Math.max(meanRT - sdRT, 0));
    ctx.fillStyle = "rgba(127,215,255,0.07)";
    ctx.fillRect(PAD.left, yTop, cW, yBottom - yTop);
  }

  // Mean line
  if (meanRT != null) {
    const yM = yOf(meanRT);
    ctx.strokeStyle = "rgba(127,215,255,0.5)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(PAD.left, yM); ctx.lineTo(PAD.left + cW, yM); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#7fd7ff";
    ctx.font = "10px sans-serif";
    ctx.fillText("mean", PAD.left + cW + 2, yM + 4);
  }

  // Block score markers (vertical lines at block events)
  let blockSeq = 0;
  blockScores.forEach((bs, i) => {
    // find approximate seq where block happened — use cumulative trials
    // we mark them evenly for now since we don't store exact seq per block
    blockSeq = Math.round(((i + 1) / blockScores.length) * n);
    const x = PAD.left + (blockSeq / Math.max(1, n)) * cW;
    ctx.strokeStyle = "rgba(255,100,100,0.55)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, PAD.top); ctx.lineTo(x, PAD.top + cH); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#ff8888";
    ctx.font = "bold 9px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`B${i + 1}`, x, PAD.top - 4);
    ctx.textAlign = "left";
  });

  // Missed/error dots (grey X markers)
  rtLog.forEach(e => {
    if (e.rt != null) return;
    const x = xOf(e.seq);
    const y = PAD.top + cH * 0.15; // park at top as "off-chart miss"
    ctx.strokeStyle = e.phase === "missed" ? "rgba(180,120,60,0.7)" : "rgba(255,80,80,0.7)";
    ctx.lineWidth = 1.5;
    const r = 4;
    ctx.beginPath(); ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.stroke();
  });

  // Correct RT dots
  withRT.forEach(e => {
    const x = xOf(e.seq);
    const y = yOf(e.rt);
    ctx.fillStyle = "#7fd7ff";
    ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
  });

  // Chart title
  ctx.fillStyle = "#d7e7f8";
  ctx.font = "bold 11px sans-serif";
  ctx.fillText("Response Times  (● correct  × miss/error  ─ mean ± SD  B# block)", PAD.left, 16);
}

// ═══════════════════════════════════════════════════
//  EXPORT / EMAIL
// ═══════════════════════════════════════════════════

function exportResults() {
  const blob = new Blob([JSON.stringify({ settings, history: state.history }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "cogblock_v12_results.json";
  a.click();
}

function emailResults() {
  const text = state.lastResultText || "No results available.";
  const body = encodeURIComponent(text);
  window.location.href = `mailto:?subject=CogBlock V12 Results&body=${body}`;
}

// ═══════════════════════════════════════════════════
//  FIRE / SMOKE / SPARKS PARTICLE SYSTEM
// ═══════════════════════════════════════════════════
let _fxRaf = null;
const _particles = [];

function startFX() {
  const canvas = $("fxCanvas");
  const box    = $("thinkingBox");
  if (!canvas || !box) return;

  const br  = box.getBoundingClientRect();
  const PAD = 60;
  canvas.width  = br.width  + PAD * 2;
  canvas.height = br.height + PAD * 2;
  canvas.style.left     = `-${PAD}px`;
  canvas.style.top      = `-${PAD}px`;
  canvas.style.width    = `${br.width  + PAD * 2}px`;
  canvas.style.height   = `${br.height + PAD * 2}px`;
  canvas.style.zIndex   = "0";
  canvas.style.position = "absolute";

  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext("2d");

  // Gear corner positions in canvas coords (offset by PAD)
  const corners = [
    { x: PAD + 22,              y: PAD + 22 },
    { x: PAD + br.width  - 22,  y: PAD + 22 },
    { x: PAD + 22,              y: PAD + br.height - 22 },
    { x: PAD + br.width  - 22,  y: PAD + br.height - 22 },
  ];

  _particles.length = 0;

  function spawn() {
    corners.forEach(c => {
      // Fire — 2 per corner per frame
      for (let i = 0; i < 2; i++) {
        _particles.push({
          type:"fire", x: c.x + (Math.random()-.5)*8, y: c.y,
          vx:(Math.random()-.5)*1.2, vy:-(Math.random()*2.5+1.5),
          life:1, decay:Math.random()*.03+.025,
          size:Math.random()*5+3, hue:Math.random()*30
        });
      }
      // Smoke — 35% chance per corner
      if (Math.random()<.35) {
        _particles.push({
          type:"smoke", x: c.x+(Math.random()-.5)*10, y: c.y-8,
          vx:(Math.random()-.5)*.6, vy:-(Math.random()*1.2+.6),
          life:1, decay:Math.random()*.012+.008, size:Math.random()*12+8
        });
      }
      // Sparks — 25% chance per corner
      if (Math.random()<.25) {
        const ang = Math.random()*Math.PI*2;
        const spd = Math.random()*4+2;
        _particles.push({
          type:"spark", x:c.x, y:c.y,
          vx:Math.cos(ang)*spd, vy:Math.sin(ang)*spd-2,
          life:1, decay:Math.random()*.06+.04, size:Math.random()*2+1, gravity:.18
        });
      }
    });
  }

  function frame() {
    ctx.clearRect(0, 0, W, H);
    spawn();
    for (let i = _particles.length-1; i >= 0; i--) {
      const p = _particles[i];
      p.x += p.vx; p.y += p.vy;
      if (p.gravity) p.vy += p.gravity;
      p.life -= p.decay;
      if (p.life <= 0) { _particles.splice(i,1); continue; }

      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life) * (p.type==="smoke" ? .45 : p.life);

      if (p.type==="fire") {
        const g = ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.size);
        g.addColorStop(0,  `hsla(${p.hue+40},100%,95%,${p.life})`);
        g.addColorStop(.3, `hsla(${p.hue+20},100%,70%,${p.life})`);
        g.addColorStop(.7, `hsla(${p.hue},90%,45%,${p.life*.7})`);
        g.addColorStop(1,  `hsla(${p.hue},80%,20%,0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size*(1+(1-p.life)*.5), 0, Math.PI*2);
        ctx.fill();
      } else if (p.type==="smoke") {
        const g = ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.size);
        g.addColorStop(0,  `rgba(160,190,210,${p.life*.4})`);
        g.addColorStop(.6, `rgba(100,130,160,${p.life*.2})`);
        g.addColorStop(1,  `rgba(60,80,100,0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size*(1+(1-p.life)), 0, Math.PI*2);
        ctx.fill();
      } else if (p.type==="spark") {
        ctx.strokeStyle = `hsla(45,100%,${70+p.life*30}%,${p.life})`;
        ctx.lineWidth = p.size; ctx.lineCap="round";
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x-p.vx*3, p.y-p.vy*3);
        ctx.stroke();
      }
      ctx.restore();
    }
    _fxRaf = requestAnimationFrame(frame);
  }

  if (_fxRaf) cancelAnimationFrame(_fxRaf);
  frame();
}

function stopFX() {
  if (_fxRaf) { cancelAnimationFrame(_fxRaf); _fxRaf = null; }
  _particles.length = 0;
  const canvas = $("fxCanvas");
  if (canvas) { const ctx=canvas.getContext("2d"); ctx.clearRect(0,0,canvas.width,canvas.height); }
}

// ═══════════════════════════════════════════════════
//  NAVIGATION
// ═══════════════════════════════════════════════════

function showOnly(overlayId) {
  ["subjectOverlay","refresherOverlay","fatigueOverlay","resultsOverlay","adminOverlay","summaryOverlay"].forEach(id => {
    const el = $(id);
    if (!el) return;
    if (id === overlayId) el.classList.remove("hidden");
    else el.classList.add("hidden");
  });
}

function isTestSuccess(endReason) {
  // Success = test ended because convergent blocks were found
  return (endReason || "").toLowerCase().startsWith("convergent blocks");
}

function buildSummary(result) {
  const rows = [
    ["Subject ID",       result.subjectId],
    ["Date / Time",      new Date(result.time).toLocaleString()],
    ["Location",         (() => {
      if (!result.geo) return "unavailable";
      if (result.geo.status === "ok") {
        const addr = result.geo.address || `${result.geo.latitude.toFixed(4)}, ${result.geo.longitude.toFixed(4)}`;
        return addr.length > 40 ? addr.substring(0, 38) + "…" : addr;
      }
      return result.geo.status;
    })()],
    ["Version",          "CogBlock V12"],
    ["Test Duration",    formatDuration(result.testDurationMs)],
    ["Total Responses",  String(result.totalResponses)],
    ["S-PF Rating",      result.samnPerelli ? `${result.samnPerelli.score} — ${result.samnPerelli.label}` : "—"],
    ["CPS",              result.cognitivePerformanceScore != null ? result.cognitivePerformanceScore.toFixed(1) + " / 100" : "—"],
    ["Total Blocks",     String(result.blockCount || result.blocks.length)],
    ["Final Block Score",result.blocks.length ? result.blocks[result.blocks.length - 1].toFixed(0) + " ms" : "—"],
    ["Block Score Diff", result.blockScoreDifferenceMs != null
      ? `${result.blockScoreDifferenceMs > 0 ? "+" : ""}${result.blockScoreDifferenceMs.toFixed(0)} ms`
      : "—"],
  ];
  // Add benchmark if it ran
  if (state.benchmark && state.benchmark.enabled) {
    rows.push(["Device Grade",  `${state.benchmark.grade} (${state.benchmark.overallScore}/100)`]);
    rows.push(["Min Rate",      `${state.benchmark.minPossibleDurMs}ms/trial`]);
  }
  const container = $("summaryRows");
  if (!container) return;
  container.innerHTML = rows.map(([label, val]) =>
    `<div class="summary-row"><span class="summary-label">${label}</span><span class="summary-val">${val}</span></div>`
  ).join("");
}

function showResultsPage(text) {
  const last = state.history[state.history.length - 1];
  const success = last ? isTestSuccess(last.endReason) : false;

  // Step 1 — Thinking (6s)
  const thinking = $("thinkingOverlay");
  const outcome  = $("outcomeOverlay");
  const outcomeText = $("outcomeText");
  const summary  = $("summaryOverlay");

  if (thinking) {
    thinking.classList.remove("hidden");
    setTimeout(() => startFX(), 50);
  }

  setTimeout(() => {
    stopFX();
    if (thinking) thinking.classList.add("hidden");

    // Step 2 — Success / Failed (3s)
    if (outcome && outcomeText) {
      outcomeText.textContent = success ? "SUCCESS!" : "Test Failed";
      outcomeText.className   = "outcome-text " + (success ? "success" : "failed");
      outcome.classList.remove("hidden");
    }

    setTimeout(() => {
      if (outcome) outcome.classList.add("hidden");

      // Step 3 — Summary page
      if (last) buildSummary(last);
      if (summary) summary.classList.remove("hidden");
      // Pre-populate full results page in background
      const box = $("resultsPageBox");
      if (box) box.textContent = text;
      renderHistoryGraphs();
      if (last) {
        drawRTScatterChart($("resultsRTChart"), last.rtLog || [], last.blocks || [], last.pacedResponseMeanMs, last.pacedResponseSdMs);
      }
      setTestingQuiet(false);
    }, 3000);
  }, 6000);
}

function clearCurrentSession() {
  clearTimer(); clearNoResponseTimer(); clearMaxTestTimer();
  state.phase = "idle";
  state.duration = null; state.blockDuration = null;
  state.current = null; state.previous = null;
  state.unresolvedStreak = 0;
  state.overloads = []; state.recoveries = [];
  state.recoveryCorrectCompleted = 0;
  state.spCorrectStreak = 0; state.spWrongCount = 0; state.terminalBlockReason = null;
  state.totalTrials = 0; state.endReason = "";
  state.totalResponses = 0; state.pacedErrors = 0; state.testStartTime = null;
  state.totalCorrect = 0; state.totalIncorrect = 0; state.missedTrials = 0; state.rollMeanLog = [];
  state.lastFiveAnswers = [];
  state.calibrationTrialIndex = 0;
  state.calibrationRTs = []; state.calibrationErrors = 0;
  state.pacedRTs = [];
  state.rtLog = [];
  state.previousMissed = false;
  state.lastFrameDuration = null;
  state.geo = null; state.benchmark = null; state.lastResultText = null;
  updateCPSDisplay(null);
  updateMetrics();
  setProbeIdle();
  setTestingQuiet(false);
}

function goToStartPage() {
  clearCurrentSession();
  ["thinkingOverlay","outcomeOverlay"].forEach(id => {
    const el = $(id); if (el) el.classList.add("hidden");
  });
  stopFX();
  setStatus("Ready");
  showOnly("subjectOverlay");
}

function startOverFlow() {
  clearCurrentSession();
  state.subjectId = null;
  state.samnPerelli = null;
  fatigueOut.textContent = "—";
  $("subjectIdInput").value = "";
  setStatus("Reset. Enter Subject ID.");
  showOnly("subjectOverlay");
}

// ═══════════════════════════════════════════════════
//  START TEST
// ═══════════════════════════════════════════════════

async function startTest() {
  if (!state.subjectId) { showOnly("subjectOverlay"); setStatus("Enter Subject ID first"); return; }
  if (!state.samnPerelli) { showOnly("fatigueOverlay"); setStatus("Select fatigue rating first"); return; }
  clearTimer(); clearNoResponseTimer();
  state.phase = "calibration";
  state.duration = null; state.blockDuration = null;
  state.current = null; state.previous = null;
  state.unresolvedStreak = 0;
  state.overloads = []; state.recoveries = [];
  state.recoveryCorrectCompleted = 0;
  state.spCorrectStreak = 0; state.spWrongCount = 0; state.terminalBlockReason = null;
  state.totalTrials = 0; state.endReason = "";
  state.totalResponses = 0; state.pacedErrors = 0; state.testStartTime = null;
  state.totalCorrect = 0; state.totalIncorrect = 0; state.missedTrials = 0; state.rollMeanLog = [];
  state.lastFiveAnswers = [];
  state.calibrationTrialIndex = 0;
  state.calibrationRTs = []; state.calibrationErrors = 0;
  state.pacedRTs = [];
  state.rtLog = [];
  state.previousMissed = false;
  state.lastFrameDuration = null;
  setTestingQuiet(true);
  await captureGeoAndAddress();
  noteAnyResponse();
  openTrial("calibration");
}

// ═══════════════════════════════════════════════════
//  EVENT WIRING
// ═══════════════════════════════════════════════════

$("subjectNextBtn").onclick = () => {
  const raw = $("subjectIdInput").value.trim();
  if (raw === "0") {
    state.subjectId = "0";
    showOnly("refresherOverlay");
    setStatus("Guest session");
    return;
  }
  if (!/^[A-Za-z0-9]{6}$/.test(raw)) { setStatus("ID must be 6 letters/numbers, or 0 for Guest"); return; }
  state.subjectId = raw.toUpperCase();
  showOnly("refresherOverlay");
  setStatus(`Subject ID: ${state.subjectId}`);
};

$("skipRefresherBtn").onclick    = () => { showOnly("fatigueOverlay"); setStatus("Refresher skipped"); };
$("refBackBtn").onclick          = () => goToStartPage();
$("refStartOverBtn").onclick     = () => startOverFlow();
$("fatigueBackBtn").onclick      = () => goToStartPage();
$("fatigueStartOverBtn").onclick = () => startOverFlow();

$("adminOpenBtn").onclick  = () => {
  $("adminOverlay").classList.remove("hidden");
  $("adminGate").classList.remove("hidden");
  $("adminBody").classList.add("hidden");
  $("adminPass").value = "";
};
$("unlockBtn").onclick = () => {
  if ($("adminPass").value === settings.adminPasscode) {
    $("adminGate").classList.add("hidden");
    $("adminBody").classList.remove("hidden");
    renderAdmin();
    setStatus("Admin unlocked");
  } else { setStatus("Incorrect passcode"); }
};
$("closeAdminBtn").onclick   = () => $("adminOverlay").classList.add("hidden");
$("closeAdminBtn2").onclick  = () => $("adminOverlay").classList.add("hidden");
$("saveAdminBtn").onclick    = () => { readAdmin(); saveSettings(); renderAdmin(); setStatus("Settings saved"); };
$("resetAdminBtn").onclick   = () => { resetAdmin(); setStatus("Admin reset to defaults"); };
$("exportAdminBtn").onclick  = () => {
  const blob = new Blob([JSON.stringify(settings, null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = "cogblock_v12_admin.json"; a.click();
};
$("adminBackBtn").onclick     = () => goToStartPage();
$("adminBackBtn2").onclick    = () => goToStartPage();
$("adminStartOverBtn").onclick= () => startOverFlow();
$("adminStartOverBtn2").onclick= () => startOverFlow();

$("startBtn").onclick       = startTest;
$("backToStartBtn").onclick = goToStartPage;
$("startOverBtn").onclick   = startOverFlow;
const mainBenchBtn = $("mainBenchmarkBtn");
if (mainBenchBtn) mainBenchBtn.onclick = async () => { await runDeviceBenchmark(true); };
$("resultsBackBtn").onclick  = goToStartPage;
$("resultsStartOverBtn").onclick = startOverFlow;
$("resultsExportBtn").onclick= exportResults;
$("resultsEmailBtn").onclick = emailResults;

// Summary ↔ Full results navigation
const summaryToFull = $("summaryToFullBtn");
const fullToSummary = $("fullToSummaryBtn");
if (summaryToFull) summaryToFull.onclick = () => {
  $("summaryOverlay").classList.add("hidden");
  $("resultsOverlay").classList.remove("hidden");
};
if (fullToSummary) fullToSummary.onclick = () => {
  $("resultsOverlay").classList.add("hidden");
  $("summaryOverlay").classList.remove("hidden");
};
const summaryRestart = $("summaryRestartBtn");
const summaryReset   = $("summaryResetBtn");
if (summaryRestart) summaryRestart.onclick = goToStartPage;
if (summaryReset)   summaryReset.onclick   = startOverFlow;

// Benchmark button in admin
const runBenchBtn = $("runBenchmarkBtn");
if (runBenchBtn) runBenchBtn.onclick = async () => {
  $("adminOverlay").classList.add("hidden");
  await runDeviceBenchmark(true);
};
const benchMain   = $("benchMainBtn");
const benchAdmin  = $("benchAdminBtn");
if (benchMain) benchMain.onclick = () => {
  $("benchmarkOverlay").classList.add("hidden");
};
if (benchRetest) benchRetest.onclick = () => {
  const overlay = $("benchmarkOverlay");
  if (overlay) overlay.classList.add("hidden");
  setTimeout(async () => { await runDeviceBenchmark(true); }, 200);
};
if (benchAdmin) benchAdmin.onclick = () => {
  const overlay = $("benchmarkOverlay");
  if (overlay) overlay.classList.add("hidden");
  $("adminOverlay").classList.remove("hidden");
  $("adminGate").classList.add("hidden");
  $("adminBody").classList.remove("hidden");
  renderAdmin();
};

window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault(); deferredPrompt = e;
  $("installBtn").disabled = false;
  setStatus("'Add to Home Screen' saves CogBlock V12 as an app for offline use.");
});
$("installBtn").onclick = async () => {
  if (!deferredPrompt) {
    setStatus("'Add to Home Screen' saves this app for offline use. Available in Chrome or Edge on Android, and Safari on iOS.");
    return;
  }
  deferredPrompt.prompt();
  const choice = await deferredPrompt.userChoice;
  deferredPrompt = null;
  setStatus(choice.outcome === "accepted" ? "App added to home screen." : "Cancelled.");
};

// ─── Init ───
modeLabel.textContent = "Subject mode";
renderFatigueChecklist();
renderRefresher();
updateMetrics();
renderHistoryGraphs();
setProbeIdle();
