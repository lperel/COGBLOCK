// ═══════════════════════════════════════════════════
//  BlockRate v1 — dots/lines layout rebuild
// ═══════════════════════════════════════════════════

const DEFAULTS = {
  adminPasscode: "4822",
  speedupFactor: 0.80,
  resumeSlowerByMs: 400,
  consecutiveMissesForBlock: 2,
  recoveryCorrectTrials: 2,
  qualifyingBlockGapMs: 250,
  noResponseTimeoutMs: 20000,
  wrongWindowSize: 5,
  wrongThresholdStop: 4,
  maxTrialCount: 180,
  minDurationMs: 45000,
  maxDurationMs: 180000,
  initialUnusedCalibrationTrials: 1,
  initialMeasuredCalibrationTrials: 20,
  initialPacedPercent: 0.70,
  calibrationStopErrors: 5,
  calibrationStopSlowMs: 20000,
  cpsBestMs: 2000,
  cpsWorstMs: 5000,
  deviceBenchmarkEnabled: 0
};

const ADMIN_FIELDS = [
  ["speedupFactor","Speedup factor","number"],
  ["resumeSlowerByMs","Resume slower after block (ms)","number"],
  ["consecutiveMissesForBlock","Consecutive misses for block","number"],
  ["recoveryCorrectTrials","Recovery correct trials","number"],
  ["qualifyingBlockGapMs","Gap between consecutive blocks to end (ms)","number"],
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
const DOT_PATTERNS = {
  1:[["dot",50,50]],
  2:[["dot",33,50],["dot",67,50]],
  3:[["dot",50,28],["dot",33,64],["dot",67,64]],
  4:[["dot",33,33],["dot",67,33],["dot",33,67],["dot",67,67]],
  5:[["dot",33,33],["dot",67,33],["dot",50,50],["dot",33,67],["dot",67,67]],
  6:[["dot",33,24],["dot",67,24],["dot",33,50],["dot",67,50],["dot",33,76],["dot",67,76]]
};

const LINE_PATTERNS = {
  1:[["v",50,50]],
  2:[["v",30,50],["v",70,50]],
  3:[["v",20,50],["v",50,50],["v",80,50]],
  4:[["v",30,30],["v",70,30],["v",30,70],["v",70,70]],
  5:[["v",30,28],["v",70,28],["v",50,50],["v",30,72],["v",70,72]],
  6:[["v",22,24],["v",50,24],["v",78,24],["v",22,72],["v",50,72],["v",78,72]]
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
  const s = JSON.parse(localStorage.getItem("blockrate_v1_settings") || "null");
  return s ? { ...DEFAULTS, ...s } : { ...DEFAULTS };
}
function saveSettings() {
  localStorage.setItem("blockrate_v1_settings", JSON.stringify(settings));
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
  recoveryCorrectCompleted: 0,
  history: JSON.parse(localStorage.getItem("blockrate_v1_history") || "[]"),
  totalTrials: 0,
  trialTimer: null,
  absoluteNoResponseTimer: null,
  lastFiveAnswers: [],
  samnPerelli: null,
  subjectId: null,
  calibrationTrialIndex: 0,
  calibrationRTs: [],
  calibrationErrors: 0,
  trialOpenedAt: null,
  geo: null,
  benchmark: null
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
function armNoResponseTimer() {
  clearNoResponseTimer();
  state.absoluteNoResponseTimer = setTimeout(() => {
    state.endReason = `No response for more than ${settings.noResponseTimeoutMs} ms`;
    finish();
  }, settings.noResponseTimeoutMs);
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
async function runDeviceBenchmark() {
  const enabled = Number(settings.deviceBenchmarkEnabled || 0) === 1;
  if (!enabled) { state.benchmark = null; return; }
  const samples = [];
  let last = performance.now();
  await new Promise(resolve => {
    let n = 0;
    function step(ts) { samples.push(ts - last); last = ts; n += 1; if (n < 30) requestAnimationFrame(step); else resolve(); }
    requestAnimationFrame(step);
  });
  const usable = samples.slice(1);
  const avg = usable.reduce((a, b) => a + b, 0) / Math.max(1, usable.length);
  state.benchmark = { enabled: true, avgFrameMs: avg, minFrameMs: Math.min(...usable), maxFrameMs: Math.max(...usable), samples: usable.length };
}

// ═══════════════════════════════════════════════════
//  SVG RENDERING — dots and lines only, no shapes
// ═══════════════════════════════════════════════════

/**
 * Renders a pattern (dots or lines) as an inline SVG.
 * size: "large" for stim cells, "probe" for center, "small" for refresher
 */
function patternToSVG(pattern, size = "large") {
  const dim = size === "probe" ? 72 : size === "small" ? 40 : 56;
  const dotR = size === "probe" ? 7 : size === "small" ? 5 : 6;
  const lineW = size === "probe" ? 9 : size === "small" ? 6 : 8;
  const lineH = size === "probe" ? 22 : size === "small" ? 14 : 18;
  const marks = pattern.map(([k, x, y]) => {
    const px = (x / 100) * dim, py = (y / 100) * dim;
    if (k === "dot") return `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${dotR}" fill="var(--text)"/>`;
    return `<rect x="${(px - lineW / 2).toFixed(1)}" y="${(py - lineH / 2).toFixed(1)}" width="${lineW}" height="${lineH}" rx="2" fill="var(--text)"/>`;
  }).join("");
  return `<svg class="pat-svg" width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}" xmlns="http://www.w3.org/2000/svg">${marks}</svg>`;
}

// ─── Build a trial ───
// Each trial: 6 top cells, each has a pattern (dots or lines).
// Center probe has a pattern. Exactly one top cell matches the probe's count,
// and its type is the OPPOSITE family (probe dots → top has lines, or vice versa).
// The 6 response buttons correspond 1-to-1 with the 6 top positions.
// Correct answer = the response button at the same position as the matching top cell.

function makeTrial(kind) {
  for (let attempt = 0; attempt < 300; attempt++) {
    // Choose probe family and count
    const probeFamily = Math.random() < 0.5 ? "dots" : "lines";
    const probeCount  = randInt(1, 6);
    const probePattern = probeFamily === "dots" ? DOT_PATTERNS[probeCount] : LINE_PATTERNS[probeCount];

    // Top cells: opposite family
    const topFamily = probeFamily === "dots" ? "lines" : "dots";
    const topPatterns = topFamily === "lines" ? LINE_PATTERNS : DOT_PATTERNS;

    // Assign 6 distinct counts to top positions (1–6, shuffled)
    const counts = shuffle([1, 2, 3, 4, 5, 6]);
    // Exactly one top cell must have count === probeCount
    const correctPos = randInt(0, 5); // 0–5 index into top grid
    // Place probeCount at correctPos
    const existingAt = counts.indexOf(probeCount);
    // Swap so probeCount is at correctPos
    [counts[correctPos], counts[existingAt]] = [counts[existingAt], counts[correctPos]];

    const topItems = counts.map(c => ({ count: c, pattern: topPatterns[c] }));

    // Validation: exactly one top cell matches probe count
    const matches = topItems.filter(x => x.count === probeCount);
    if (matches.length !== 1) continue;
    if (topItems[correctPos].count !== probeCount) continue;

    return {
      kind,
      probePattern,
      probeCount,
      probeFamily,
      topFamily,
      topItems,       // array of 6 {count, pattern}
      correctPos,     // 0–5, the index of correct response button
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
  rateOut.textContent   = state.duration ? `${(1000 / state.duration).toFixed(2)} Hz` : "—";
  blocksOut.textContent = String(state.overloads.length);
  recoveryOut.textContent = String(state.recoveries.length);
  wrongOut.textContent  = String(state.lastFiveAnswers.filter(v => v === false).length + state.calibrationErrors);
  fatigueOut.textContent = state.samnPerelli ? String(state.samnPerelli.score) : "—";
}

function trialMatches(trial, index) {
  return trial && index === trial.correctPos;
}

function recordAnswer(ok) {
  state.lastFiveAnswers.push(ok);
  if (state.lastFiveAnswers.length > settings.wrongWindowSize) state.lastFiveAnswers.shift();
  updateMetrics();
  const wc = state.lastFiveAnswers.filter(v => v === false).length;
  if (state.lastFiveAnswers.length === settings.wrongWindowSize && wc > settings.wrongThresholdStop) {
    clearTimer(); clearNoResponseTimer();
    state.phase = "finished";
    state.endReason = `More than ${settings.wrongThresholdStop} wrong answers out of last ${settings.wrongWindowSize}. Restart required.`;
    setStatus(state.endReason);
    return true;
  }
  return false;
}

function avgLast2Blocks() {
  if (state.overloads.length < 2) return state.overloads.length ? state.overloads[state.overloads.length - 1] : null;
  return (state.overloads[state.overloads.length - 1] + state.overloads[state.overloads.length - 2]) / 2;
}

function maybeTriggerTerminalRule() {
  if (state.overloads.length < 2) return false;
  const n = state.overloads.length;
  const gap = Math.abs(state.overloads[n - 1] - state.overloads[n - 2]);
  if (gap < settings.qualifyingBlockGapMs) {
    state.phase = "terminal_recovery";
    state.recoveryCorrectCompleted = 0;
    openTrial("terminal_recovery");
    return true;
  }
  return false;
}

function failCalibrationAndRetest(reason) {
  clearTimer(); clearNoResponseTimer();
  state.phase = "finished";
  state.endReason = reason + " Retest required.";
  setProbeIdle();
  setStatus("Retest required");
}

function finishCalibration() {
  const avg = mean(state.calibrationRTs);
  const pacedStart = clamp(avg * settings.initialPacedPercent, settings.minDurationMs, settings.maxDurationMs);
  state.duration = pacedStart;
  state.phase = "paced";
  setStatus(`Machine-paced start: ${pacedStart.toFixed(1)} ms`);
  openTrial("paced");
}

function finish() {
  clearTimer(); clearNoResponseTimer();
  state.phase = "finished";
  const avg2 = avgLast2Blocks();
  const cps  = avg2 != null ? computeCPS(avg2) : null;
  const result = {
    subjectId: subjectKey(state.subjectId || "0"),
    samnPerelli: state.samnPerelli,
    calibrationAverageMs: state.calibrationRTs.length ? mean(state.calibrationRTs) : null,
    blocks: [...state.overloads],
    averageLast2BlockingScoresMs: avg2,
    cognitivePerformanceScore: cps,
    endReason: state.endReason || "Run complete",
    time: new Date().toISOString(),
    geo: state.geo
  };
  state.history.push(result);
  localStorage.setItem("blockrate_v1_history", JSON.stringify(state.history));
  updateCPSDisplay(avg2);
  setProbeIdle();

  const fatigueText = state.samnPerelli ? `${state.samnPerelli.score} — ${state.samnPerelli.label}` : "not recorded";
  const text = `BlockRate v1

Subject ID: ${result.subjectId}
Samn–Perelli: ${fatigueText}
Calibration avg: ${result.calibrationAverageMs != null ? result.calibrationAverageMs.toFixed(1) + " ms" : "—"}
Avg last 2 blocks: ${avg2 != null ? avg2.toFixed(1) + " ms" : "—"}
CPS: ${cps != null ? cps.toFixed(1) : "—"}
End reason: ${result.endReason}`;

  showResultsPage(text);
}

function openTrial(kind) {
  clearTimer();
  state.previous = state.current;
  state.current  = makeTrial(kind);
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
    phaseLabel.textContent = `Recovery ${state.recoveryCorrectCompleted + 1}/${settings.recoveryCorrectTrials}`;
    setStatus("Self-paced recovery");
  } else if (kind === "terminal_recovery") {
    phaseLabel.textContent = `Final ${state.recoveryCorrectCompleted + 1}/${settings.recoveryCorrectTrials}`;
    setStatus("Final self-paced recovery");
  }
}

function onPacedFrameEnd() {
  if (state.phase !== "paced") return;
  state.totalTrials += 1;
  const currentMissed = state.current && state.current.kind === "paced" && !state.current.resolved;
  if (currentMissed) { if (recordAnswer(false)) return; }
  state.unresolvedStreak = currentMissed ? state.unresolvedStreak + 1 : 0;
  if (state.unresolvedStreak >= settings.consecutiveMissesForBlock) {
    state.blockDuration = state.duration;
    state.overloads.push(state.blockDuration);
    state.unresolvedStreak = 0;
    updateCPSDisplay(avgLast2Blocks());
    if (maybeTriggerTerminalRule()) return;
    state.phase = "recovery";
    state.recoveryCorrectCompleted = 0;
    openTrial("recovery");
    return;
  }
  state.duration = clamp(state.duration * settings.speedupFactor, settings.minDurationMs, settings.maxDurationMs);
  if (state.totalTrials >= settings.maxTrialCount) {
    state.endReason = "Reached trial cap";
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

  if (state.phase === "recovery" || state.phase === "terminal_recovery") {
    clearTimer();
    const ok = trialMatches(state.current, index);
    flashBtn(index, ok);
    if (recordAnswer(ok)) return;
    if (ok) {
      state.current.resolved = true;
      state.recoveryCorrectCompleted += 1;
      if (state.recoveryCorrectCompleted >= settings.recoveryCorrectTrials) {
        if (state.phase === "terminal_recovery") {
          state.endReason = `Completed ${settings.recoveryCorrectTrials} final self-paced trials`;
          finish();
          return;
        }
        state.recoveries.push(state.blockDuration + settings.resumeSlowerByMs);
        state.phase = "paced";
        state.duration = clamp(state.blockDuration + settings.resumeSlowerByMs, settings.minDurationMs, settings.maxDurationMs);
        setTimeout(() => openTrial("paced"), 180);
      } else {
        setTimeout(() => openTrial(state.phase), 160);
      }
    } else {
      setTimeout(() => openTrial(state.phase), 160);
    }
    return;
  }

  // Paced phase: allow late response to previous or current
  if (state.previous && state.previous.kind === "paced" && !state.previous.resolved && trialMatches(state.previous, index)) {
    state.previous.resolved = true;
    flashBtn(index, true);
    if (recordAnswer(true)) return;
    return;
  }
  if (state.current && state.current.kind === "paced" && !state.current.resolved && trialMatches(state.current, index)) {
    state.current.resolved = true;
    flashBtn(index, true);
    if (recordAnswer(true)) return;
    return;
  }
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

function drawSimpleLineChart(canvas, values, label) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#d7e7f8"; ctx.font = "14px sans-serif"; ctx.fillText(label, 10, 18);
  ctx.strokeStyle = "#7fd7ff"; ctx.lineWidth = 2;
  if (!values.length) { ctx.fillStyle = "#d7e7f8"; ctx.fillText("No data yet", 10, 40); return; }
  const max = Math.max(...values), min = Math.min(...values);
  const span = (max - min) || 1;
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = 12 + i * ((canvas.width - 24) / Math.max(1, values.length - 1));
    const y = canvas.height - 16 - ((v - min) / span) * (canvas.height - 40);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function renderHistoryGraphs() {
  const hist = state.history || [];
  const cpsVals = hist.map(x => x.cognitivePerformanceScore).filter(v => v != null);
  const spfVals = hist.map(x => x.samnPerelli ? x.samnPerelli.score : null).filter(v => v != null);
  drawSimpleLineChart($("resultsCpsChart"), cpsVals.slice(-20), "CPS history");
  drawSimpleLineChart($("resultsSpfChart"), spfVals.slice(-20), "S-PF history");
  drawSimpleLineChart($("adminCpsChart"), cpsVals.slice(-20), "CPS history");
  drawSimpleLineChart($("adminSpfChart"), spfVals.slice(-20), "S-PF history");
  const note = state.benchmark && state.benchmark.enabled
    ? `Device benchmark: avg frame ${state.benchmark.avgFrameMs.toFixed(2)} ms`
    : "Device benchmark off";
  const rn = $("resultsNote"), an = $("adminBenchmarkNote");
  if (rn) rn.textContent = note;
  if (an) an.textContent = note;
}

// ═══════════════════════════════════════════════════
//  EXPORT / EMAIL
// ═══════════════════════════════════════════════════

function exportResults() {
  const blob = new Blob([JSON.stringify({ settings, history: state.history }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "blockrate_v1_results.json";
  a.click();
}

function emailResults() {
  const last = state.history[state.history.length - 1] || {};
  const body = encodeURIComponent(JSON.stringify(last, null, 2));
  window.location.href = `mailto:?subject=BlockRate v1&body=${body}`;
}

// ═══════════════════════════════════════════════════
//  NAVIGATION
// ═══════════════════════════════════════════════════

function showOnly(overlayId) {
  ["subjectOverlay", "refresherOverlay", "fatigueOverlay", "resultsOverlay", "adminOverlay"].forEach(id => {
    const el = $(id);
    if (!el) return;
    if (id === overlayId) el.classList.remove("hidden");
    else el.classList.add("hidden");
  });
}

function showResultsPage(text) {
  const box = $("resultsPageBox");
  if (box) box.textContent = text;
  showOnly("resultsOverlay");
  renderHistoryGraphs();
  setTestingQuiet(false);
}

function clearCurrentSession() {
  clearTimer(); clearNoResponseTimer();
  state.phase = "idle";
  state.duration = null; state.blockDuration = null;
  state.current = null; state.previous = null;
  state.unresolvedStreak = 0;
  state.overloads = []; state.recoveries = [];
  state.recoveryCorrectCompleted = 0;
  state.totalTrials = 0; state.endReason = "";
  state.lastFiveAnswers = [];
  state.calibrationTrialIndex = 0;
  state.calibrationRTs = []; state.calibrationErrors = 0;
  state.geo = null; state.benchmark = null;
  updateCPSDisplay(null);
  updateMetrics();
  setProbeIdle();
  setTestingQuiet(false);
}

function goToStartPage() {
  clearCurrentSession();
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
  state.totalTrials = 0; state.endReason = "";
  state.lastFiveAnswers = [];
  state.calibrationTrialIndex = 0;
  state.calibrationRTs = []; state.calibrationErrors = 0;
  setTestingQuiet(true);
  await captureGeoAndAddress();
  await runDeviceBenchmark();
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
$("continueRefresherBtn").onclick= () => { showOnly("fatigueOverlay"); setStatus("Refresher done"); };
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
  a.download = "blockrate_v1_admin.json"; a.click();
};
$("adminBackBtn").onclick     = () => goToStartPage();
$("adminBackBtn2").onclick    = () => goToStartPage();
$("adminStartOverBtn").onclick= () => startOverFlow();
$("adminStartOverBtn2").onclick= () => startOverFlow();

$("startBtn").onclick       = startTest;
$("exportBtn").onclick      = exportResults;
$("emailBtn").onclick       = emailResults;
$("backToStartBtn").onclick = goToStartPage;
$("startOverBtn").onclick   = startOverFlow;
$("resultsBackBtn").onclick  = goToStartPage;
$("resultsStartOverBtn").onclick = startOverFlow;
$("resultsExportBtn").onclick= exportResults;
$("resultsEmailBtn").onclick = emailResults;

window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault(); deferredPrompt = e; $("installBtn").disabled = false;
});
$("installBtn").onclick = async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
};

// ─── Init ───
modeLabel.textContent = "Subject mode";
renderFatigueChecklist();
renderRefresher();
updateMetrics();
renderHistoryGraphs();
setProbeIdle();
