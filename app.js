const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

/** ---------------------------------------------------------
 * State + Storage
 * -------------------------------------------------------- */
const STORAGE_KEY = "gradsim_state_v1";
const state = {
  cohortId: "2023_2024",
  trackId: "EE",
  trackType: "major", // major | minor
  courses: [] // {id, code, name, credits, bucket}
};

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      Object.assign(state, parsed);
    }
  } catch { /* ignore */ }
}

/** ---------------------------------------------------------
 * Data loading
 * -------------------------------------------------------- */
let COURSES = [];
let REQ = null;

async function loadData() {
  const [coursesRes, reqRes] = await Promise.all([
    fetch("./data/courses.json"),
    fetch("./data/requirements.json")
  ]);
  COURSES = await coursesRes.json();
  REQ = await reqRes.json();
}

function findCourse(code) {
  return COURSES.find(c => c.code.toUpperCase() === code.toUpperCase()) || null;
}

function getCohort() {
  return REQ.cohorts.find(c => c.id === state.cohortId) || REQ.cohorts[0];
}
function getTrack() {
  return REQ.tracks.find(t => t.id === state.trackId) || REQ.tracks[0];
}

const BUCKETS = [
  { id:"basic-math", label:"기초 · 수학" },
  { id:"basic-science-physics", label:"기초 · 과학(물리)" },
  { id:"basic-science-chem", label:"기초 · 과학(화학)" },
  { id:"basic-science-bio", label:"기초 · 과학(생명)" },
  { id:"basic-eng-core", label:"기초 · 공학(컴퓨터공학)" },
  { id:"basic-eng-select", label:"기초 · 공학선택" },
  { id:"basic-hss", label:"기초 · 인문사회(쓰기·읽기·말하기)" },
  { id:"basic-english", label:"기초 · 영어" },
  { id:"basic-artspe", label:"기초 · 예체능(2020만)" },
  { id:"adv-track", label:"심화 · 트랙(전공)" },
  { id:"adv-nontrack", label:"심화 · 비트랙/융합" },
  { id:"adv-ugrp", label:"심화 · UGRP" },
  { id:"adv-intern", label:"심화 · 인턴십" },
  { id:"adv-other", label:"심화 · 기타" },
];

function bucketLabel(id) {
  return BUCKETS.find(b => b.id === id)?.label || id;
}

/** ---------------------------------------------------------
 * Auto bucket suggestion
 * -------------------------------------------------------- */
function suggestBucket(code, name="") {
  const up = (code || "").toUpperCase().trim();
  const nm = (name || "").trim();

  if (up.startsWith("BS")) {
    // math
    if (["BS102A","BS101","BS201A","BS203","BS202"].includes(up)) return "basic-math";
    // physics
    if (["BS103A","BS104A","BS105A","BS106A"].includes(up)) return "basic-science-physics";
    // chemistry
    if (["BS118","BS113","BS119","CHEM206"].includes(up)) return "basic-science-chem";
    // bio
    if (["BS114","BS115","BS116","BS117"].includes(up)) return "basic-science-bio";
    return "basic-science-physics";
  }
  if (up.startsWith("BE")) {
    if (["BE101A","BE202","BE201"].includes(up)) return "basic-eng-core";
    if (["BE203","BE204","BE205","BE206"].includes(up)) return "basic-eng-select";
    return "basic-eng-select";
  }
  if (up.startsWith("HSS")) return "basic-hss";
  if (up.startsWith("ENG_")) return "basic-english";
  if (up.startsWith("ART_") || up === "PE1" || up === "PE2") return "basic-artspe";
  if (up.startsWith("UGRP")) return "adv-ugrp";
  if (up.startsWith("INT")) return "adv-intern";

  // Track codes
  const track = getTrack();
  if (track.prefixes?.some(px => px && up.startsWith(px))) return "adv-track";

  // heuristic by name
  if (nm.includes("인턴") || nm.toLowerCase().includes("intern")) return "adv-intern";
  if (nm.toUpperCase().includes("UGRP")) return "adv-ugrp";

  return "adv-other";
}

/** ---------------------------------------------------------
 * Requirement evaluation helpers
 * -------------------------------------------------------- */
function sumCredits(filterFn) {
  return state.courses.filter(filterFn).reduce((a, c) => a + (Number(c.credits) || 0), 0);
}
function hasCourse(code) {
  const up = code.toUpperCase();
  return state.courses.some(c => (c.code || "").toUpperCase() === up);
}
function hasAnyCourse(codes) {
  return codes.some(hasCourse);
}

function creditsForCodes(codes) {
  const set = new Set(codes.map(x => x.toUpperCase()));
  return state.courses.filter(c => set.has((c.code||"").toUpperCase()))
    .reduce((a,c)=>a+(Number(c.credits)||0),0);
}

function evalCohort() {
  const cohort = getCohort();
  const track = getTrack();

  const total = sumCredits(()=>true);
  const basic = sumCredits(c => c.bucket.startsWith("basic-"));
  const advanced = sumCredits(c => c.bucket.startsWith("adv-"));

  // --- Basic: Math
  const math = cohort.basic.math;
  const mathMustAll = math.requiredAll.filter(code => hasCourse(code));
  const mathAllOk = math.requiredAll.every(hasCourse);
  const mathGroupCredits = creditsForCodes(math.chooseCreditsFrom.codes);
  const mathGroupOk = mathGroupCredits >= math.chooseCreditsFrom.minCredits;
  const mathCredits = sumCredits(c => c.bucket === "basic-math");

  // --- Basic: Science by areas
  const sci = cohort.basic.science;
  const phyCredits = sumCredits(c => c.bucket === "basic-science-physics");
  const chemCredits = sumCredits(c => c.bucket === "basic-science-chem");
  const bioCredits = sumCredits(c => c.bucket === "basic-science-bio");
  const sciTotal = phyCredits + chemCredits + bioCredits;

  function areaOk(area) {
    // theory list must be present; lab any one present
    const theoryOk = (area.theory && area.theory.every(hasCourse)) || false;
    const theoryAnyOk = (area.theoryAnyOf && hasAnyCourse(area.theoryAnyOf)) || false;
    const labOk = (area.lab && hasAnyCourse(area.lab)) || false;
    return (theoryOk || theoryAnyOk) && labOk;
  }
  const phyOk = areaOk(sci.areas.physics);
  const chemOk = areaOk(sci.areas.chem);
  const bioOk = areaOk(sci.areas.bio);

  // Track-dependent basic science adds (e.g., physics II for EE/PHY)
  const adds = track.basicScienceAdds?.mustTake || [];
  const addsOk = adds.every(hasCourse);

  // --- Basic: Engineering core/select
  const engCore = cohort.basic.engCore;
  const engCoreOk = engCore.requiredAll.every(hasCourse) && sumCredits(c => c.bucket==="basic-eng-core") >= engCore.minCredits;

  const engSel = cohort.basic.engSelect;
  const engSelCredits = sumCredits(c => c.bucket==="basic-eng-select");
  const engSelOk = engSelCredits >= engSel.minCredits && (
    engSel.chooseAnyOf.some(x => {
      if (x.includes("+")) {
        const parts = x.split("+").map(s=>s.trim());
        return parts.every(hasCourse);
      }
      return hasCourse(x);
    })
  );

  // --- Basic: HSS writing
  const hss = cohort.basic.hssWriting;
  const hssCredits = sumCredits(c => c.bucket==="basic-hss");
  const hssMustOk = hasAnyCourse(hss.mustIncludeAnyOf || []);
  const hssExtraOk = (hss.requiredAll || []).every(hasCourse);
  const hssOk = hssCredits >= hss.minCredits && hssMustOk && hssExtraOk;

  // --- Basic: English
  const en = cohort.basic.english;
  const enCredits = sumCredits(c => c.bucket==="basic-english");
  const enOk = en.requiredAll.every(hasCourse) && enCredits >= en.minCredits;

  // --- Basic: Arts/PE (2020 only)
  const ap = cohort.basic.artsPE;
  const apCredits = sumCredits(c => c.bucket==="basic-artspe");
  const apOk = ap ? (ap.requiredAll.every(hasCourse) && apCredits >= ap.minCredits) : true;

  // --- Advanced buckets
  const advTrackCredits = sumCredits(c => c.bucket==="adv-track");
  const advNonCredits = sumCredits(c => c.bucket==="adv-nontrack");
  const advUgrpCredits = sumCredits(c => c.bucket==="adv-ugrp");
  const advInternCredits = sumCredits(c => c.bucket==="adv-intern");

  // Optional: physics/chem extra track rules (if course codes exist in your list)
  const extraTrack = REQ.trackExtraRules?.[track.id]?.[state.trackType] || null;
  let extraTrackOk = true;
  let extraTrackMsg = null;
  if (extraTrack) {
    const mustAll = (extraTrack.mustTakeAll || []).every(hasCourse);
    const mustOne = extraTrack.mustTakeOneOf ? hasAnyCourse(extraTrack.mustTakeOneOf) : true;
    extraTrackOk = mustAll && mustOne;
    extraTrackMsg = { mustAll, mustOne, extraTrack };
  }

  // Overall checks
  const totalOk = total >= cohort.totals.totalMin;
  const basicOk = basic >= cohort.totals.basicMin;
  const advOk = advanced >= cohort.totals.advancedMin;

  return {
    cohort, track,
    totals: { total, basic, advanced, totalOk, basicOk, advOk },
    basic: {
      math: { mathCredits, need: math.minCredits, allOk: mathAllOk, groupCredits: mathGroupCredits, groupNeed: math.chooseCreditsFrom.minCredits, groupOk: mathGroupOk },
      science: { total: sciTotal, need: sci.minCredits, phyCredits, chemCredits, bioCredits, phyOk, chemOk, bioOk, adds, addsOk },
      engCore: { credits: sumCredits(c=>c.bucket==="basic-eng-core"), need: engCore.minCredits, ok: engCoreOk, requiredAll: engCore.requiredAll },
      engSelect: { credits: engSelCredits, need: engSel.minCredits, ok: engSelOk, chooseAnyOf: engSel.chooseAnyOf },
      hss: { credits: hssCredits, need: hss.minCredits, mustOk: hssMustOk, extraOk: hssExtraOk, ok: hssOk },
      english: { credits: enCredits, need: en.minCredits, ok: enOk, requiredAll: en.requiredAll },
      artsPE: ap ? { credits: apCredits, need: ap.minCredits, ok: apOk } : null
    },
    advanced: {
      trackCredits: advTrackCredits, trackNeed: cohort.advanced.trackMin, trackOk: advTrackCredits >= cohort.advanced.trackMin,
      nonCredits: advNonCredits, nonNeed: cohort.advanced.nonTrackMin, nonOk: advNonCredits >= cohort.advanced.nonTrackMin,
      ugrpCredits: advUgrpCredits, ugrpNeed: cohort.advanced.ugrpMin, ugrpOk: advUgrpCredits >= cohort.advanced.ugrpMin,
      internCredits: advInternCredits, internNeed: cohort.advanced.internMin, internOk: advInternCredits >= cohort.advanced.internMin,
      extraTrackOk, extraTrackMsg
    }
  };
}

/** ---------------------------------------------------------
 * UI rendering
 * -------------------------------------------------------- */
function renderSelectors() {
  const cohortSel = $("#cohort");
  cohortSel.innerHTML = REQ.cohorts.map(c => `<option value="${c.id}">${c.label}</option>`).join("");
  cohortSel.value = state.cohortId;
  cohortSel.addEventListener("change", () => {
    state.cohortId = cohortSel.value;
    saveState();
    renderAll();
  });

  const trackSel = $("#track");
  trackSel.innerHTML = REQ.tracks.map(t => `<option value="${t.id}">${t.label}</option>`).join("");
  trackSel.value = state.trackId;
  trackSel.addEventListener("change", () => {
    state.trackId = trackSel.value;
    saveState();
    // re-suggest buckets for adv-track by prefix
    state.courses.forEach(c => {
      if (c.bucket === "adv-other") {
        const sug = suggestBucket(c.code, c.name);
        if (sug === "adv-track") c.bucket = sug;
      }
    });
    renderAll();
  });

  const trackTypeSel = $("#trackType");
  trackTypeSel.value = state.trackType;
  trackTypeSel.addEventListener("change", () => {
    state.trackType = trackTypeSel.value;
    saveState();
    renderAll();
  });
}

function renderCourseTable() {
  const tbody = $("#courseTableBody");
  tbody.innerHTML = "";

  for (const c of state.courses) {
    const tr = document.createElement("tr");
    tr.className = "border-t border-slate-200/60";
    tr.innerHTML = `
      <td class="py-2 pr-2 font-mono text-xs text-slate-700">${escapeHtml(c.code)}</td>
      <td class="py-2 pr-2 text-slate-900">${escapeHtml(c.name)}</td>
      <td class="py-2 pr-2 text-slate-700 text-right">${Number(c.credits)||0}</td>
      <td class="py-2 pr-2">
        <select class="bucketSelect w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm">
          ${BUCKETS.map(b => `<option value="${b.id}" ${b.id===c.bucket?"selected":""}>${b.label}</option>`).join("")}
        </select>
      </td>
      <td class="py-2 text-right">
        <button class="delBtn rounded-lg px-2 py-1 text-sm text-slate-600 hover:bg-slate-100">삭제</button>
      </td>
    `;
    $(".bucketSelect", tr).addEventListener("change", (e) => {
      c.bucket = e.target.value;
      saveState();
      renderAll();
    });
    $(".delBtn", tr).addEventListener("click", () => {
      state.courses = state.courses.filter(x => x.id !== c.id);
      saveState();
      renderAll();
    });
    tbody.appendChild(tr);
  }

  $("#courseCount").textContent = `${state.courses.length}개`;
}

function renderSuggestionsList(query) {
  const list = $("#suggestions");
  list.innerHTML = "";
  if (!query || query.trim().length < 2) {
    list.classList.add("hidden");
    return;
  }
  const q = query.trim().toLowerCase();
  const found = COURSES
    .filter(c => (c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)))
    .slice(0, 10);

  if (found.length === 0) {
    list.classList.add("hidden");
    return;
  }

  for (const item of found) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "w-full text-left px-3 py-2 hover:bg-slate-50";
    btn.innerHTML = `
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <div class="font-mono text-xs text-slate-600">${escapeHtml(item.code)}</div>
          <div class="truncate text-sm text-slate-900">${escapeHtml(item.name)}</div>
        </div>
        <div class="text-xs text-slate-600">${item.credits}학점</div>
      </div>
    `;
    btn.addEventListener("click", () => {
      $("#courseSearch").value = `${item.code} ${item.name}`;
      $("#code").value = item.code;
      $("#name").value = item.name;
      $("#credits").value = item.credits;
      list.classList.add("hidden");
      $("#name").focus();
    });
    list.appendChild(btn);
  }
  list.classList.remove("hidden");
}

function setupAddCourseForm() {
  const search = $("#courseSearch");
  search.addEventListener("input", () => renderSuggestionsList(search.value));
  document.addEventListener("click", (e) => {
    const list = $("#suggestions");
    if (!list.contains(e.target) && e.target !== search) list.classList.add("hidden");
  });

  $("#addCourse").addEventListener("submit", (e) => {
    e.preventDefault();
    const code = $("#code").value.trim() || "NO_CODE";
    const name = $("#name").value.trim() || "이름 없음";
    const credits = Number($("#credits").value) || 0;

    // special composite (BE205+BE206)
    const composite = code.toUpperCase().includes("BE205+BE206");

    let bucket = $("#bucket").value;
    if (!bucket) bucket = suggestBucket(code, name);

    state.courses.unshift({
      id: uid(),
      code: composite ? "BE205+BE206" : code,
      name,
      credits,
      bucket
    });

    // clear
    $("#courseSearch").value = "";
    $("#code").value = "";
    $("#name").value = "";
    $("#credits").value = "3";
    $("#bucket").value = "";

    saveState();
    renderAll();
  });

  $("#autoBucket").addEventListener("click", () => {
    const code = $("#code").value.trim();
    const name = $("#name").value.trim();
    const sug = suggestBucket(code, name);
    $("#bucket").value = sug;
  });

  const __exportBtn = $("#exportBtn");
  if (__exportBtn) __exportBtn.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], {type:"application/json"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `gradsim_export_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  const __importFile = $("#importFile");
  if (__importFile) __importFile.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const txt = await file.text();
    try {
      const parsed = JSON.parse(txt);
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.courses)) {
        state.cohortId = parsed.cohortId || state.cohortId;
        state.trackId = parsed.trackId || state.trackId;
        state.trackType = parsed.trackType || state.trackType;
        state.courses = parsed.courses.map(c => ({
          id: c.id || uid(),
          code: c.code || "NO_CODE",
          name: c.name || "이름 없음",
          credits: Number(c.credits)||0,
          bucket: c.bucket || suggestBucket(c.code, c.name)
        }));
        saveState();
        renderAll();
      }
    } catch {
      alert("JSON 가져오기에 실패했어요. export한 JSON 파일을 선택했는지 확인해줘!");
    } finally {
      e.target.value = "";
    }
  });

  const __resetBtn = $("#resetBtn");
  if (__resetBtn) __resetBtn.addEventListener("click", () => {
    if (!confirm("정말 초기화할까요? (저장된 데이터가 삭제됩니다)")) return;
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  });
}

function renderProgress() {
  const r = evalCohort();

  // header summary
  $("#summaryTotal").textContent = `${r.totals.total} / ${r.cohort.totals.totalMin}학점`;
  $("#summaryBasic").textContent = `${r.totals.basic} / ${r.cohort.totals.basicMin}학점`;
  $("#summaryAdv").textContent = `${r.totals.advanced} / ${r.cohort.totals.advancedMin}학점`;

  setBar("#barTotal", r.totals.total, r.cohort.totals.totalMin);
  setBar("#barBasic", r.totals.basic, r.cohort.totals.basicMin);
  setBar("#barAdv", r.totals.advanced, r.cohort.totals.advancedMin);

  // Basic detail cards
  $("#mathStatus").innerHTML = renderReqLine(
    "수학 9학점",
    r.basic.math.mathCredits,
    r.basic.math.need,
    r.basic.math.allOk && r.basic.math.groupOk
  ) + `<div class="mt-2 text-xs text-slate-600">
    필수: BS102a(공학수학Ⅰ), BS101(다변수미적분학) / 선택: BS201a, BS203, BS202 중 3학점
  </div>`;

  $("#scienceStatus").innerHTML = `
    ${renderReqLine("기초과학 18학점", r.basic.science.total, r.cohort.basic.science.minCredits, r.basic.science.total >= r.cohort.basic.science.minCredits && r.basic.science.phyOk && r.basic.science.chemOk && r.basic.science.bioOk)}
    <div class="mt-2 grid grid-cols-1 gap-2 text-xs text-slate-600">
      <div>물리: ${r.basic.science.phyCredits}학점 · 영역충족 ${badge(r.basic.science.phyOk)}</div>
      <div>화학: ${r.basic.science.chemCredits}학점 · 영역충족 ${badge(r.basic.science.chemOk)}</div>
      <div>생명: ${r.basic.science.bioCredits}학점 · 영역충족 ${badge(r.basic.science.bioOk)}</div>
      ${r.basic.science.adds.length ? `<div class="mt-1">트랙 추가요건(${r.track.label}): ${r.basic.science.adds.join(", ")} ${badge(r.basic.science.addsOk)}</div>` : ``}
    </div>
  `;

  $("#engCoreStatus").innerHTML = `
    ${renderReqLine("컴퓨터공학(기초) 필수", r.basic.engCore.credits, r.basic.engCore.need, r.basic.engCore.ok)}
    <div class="mt-2 text-xs text-slate-600">필수: ${r.basic.engCore.requiredAll.join(", ")}</div>
  `;

  $("#engSelStatus").innerHTML = `
    ${renderReqLine("공학선택 3학점", r.basic.engSelect.credits, r.basic.engSelect.need, r.basic.engSelect.ok)}
    <div class="mt-2 text-xs text-slate-600">택1(또는 묶음): BE203, BE204, BE205+BE206</div>
  `;

  $("#hssStatus").innerHTML = `
    ${renderReqLine("쓰기·읽기·말하기", r.basic.hss.credits, r.basic.hss.need, r.basic.hss.ok)}
    <div class="mt-2 text-xs text-slate-600">
      지정과목: 학술 글쓰기(HSS109a) 또는 Scientific Writing 포함 ${badge(r.basic.hss.mustOk)}
      ${r.cohort.id === "2025_plus" ? `<br/>추가 필수: 미래 소양강좌, 진로탐색 및 전공설계Ⅰ·Ⅱ ${badge(r.basic.hss.extraOk)}` : ``}
    </div>
  `;

  $("#engCommStatus").innerHTML = `
    ${renderReqLine("영어 4학점", r.basic.english.credits, r.basic.english.need, r.basic.english.ok)}
    <div class="mt-2 text-xs text-slate-600">필수: Academic English 2과목</div>
  `;

  if (r.basic.artsPE) {
    $("#artsStatusWrap").classList.remove("hidden");
    $("#artsStatus").innerHTML = `${renderReqLine("예체능 4학점(2020)", r.basic.artsPE.credits, r.basic.artsPE.need, r.basic.artsPE.ok)}`;
  } else {
    $("#artsStatusWrap").classList.add("hidden");
  }

  // Advanced detail cards
  $("#advTrackStatus").innerHTML = renderReqLine("트랙 27학점", r.advanced.trackCredits, r.advanced.trackNeed, r.advanced.trackOk);
  $("#advNonStatus").innerHTML = renderReqLine("비트랙/융합 6학점", r.advanced.nonCredits, r.advanced.nonNeed, r.advanced.nonOk);
  $("#advUgrpStatus").innerHTML = renderReqLine("UGRP 6학점", r.advanced.ugrpCredits, r.advanced.ugrpNeed, r.advanced.ugrpOk);
  $("#advInternStatus").innerHTML = renderReqLine("인턴십", r.advanced.internCredits, r.advanced.internNeed, r.advanced.internOk);

  // Extra track rule info (PHY/CHEM only, if your course codes match)
  const extra = $("#extraTrack");
  if (r.advanced.extraTrackMsg) {
    extra.classList.remove("hidden");
    extra.innerHTML = `
      <div class="rounded-2xl border border-slate-200 bg-white p-4">
        <div class="flex items-center justify-between gap-3">
          <div class="text-sm font-semibold text-slate-900">추가 체크리스트 (${r.track.label} · ${state.trackType === "major" ? "전공" : "부전공"})</div>
          <div>${badge(r.advanced.extraTrackOk)}</div>
        </div>
        <div class="mt-2 text-xs text-slate-600">
          지정과목: ${(r.advanced.extraTrackMsg.extraTrack.mustTakeAll || []).join(", ")}<br/>
          ${r.advanced.extraTrackMsg.extraTrack.mustTakeOneOf ? `실험 택1: ${r.advanced.extraTrackMsg.extraTrack.mustTakeOneOf.join(" / ")}` : ``}
        </div>
        <div class="mt-2 text-xs text-slate-500">
          * 표에 나온 과목코드가 내 수강리스트와 다르면, 코드를 맞추거나 버킷을 수동으로 지정해줘.
        </div>
      </div>
    `;
  } else {
    extra.classList.add("hidden");
    extra.innerHTML = "";
  }

  // Overall banner
  const okAll = r.totals.totalOk && r.totals.basicOk && r.totals.advOk
    && r.basic.math.allOk && r.basic.math.groupOk
    && r.basic.science.total >= r.cohort.basic.science.minCredits && r.basic.science.phyOk && r.basic.science.chemOk && r.basic.science.bioOk && r.basic.science.addsOk
    && r.basic.engCore.ok && r.basic.engSelect.ok && r.basic.hss.ok && r.basic.english.ok
    && (r.basic.artsPE ? r.basic.artsPE.ok : true)
    && r.advanced.trackOk && r.advanced.nonOk && r.advanced.ugrpOk && r.advanced.internOk
    && r.advanced.extraTrackOk;

  $("#banner").className = okAll
    ? "rounded-2xl border border-emerald-200 bg-emerald-50 p-4"
    : "rounded-2xl border border-amber-200 bg-amber-50 p-4";
  $("#bannerTitle").textContent = okAll ? "🎉 현재 입력 기준으로 졸업요건을 충족했어요!" : "아직 남은 요건이 있어요 — 아래 체크리스트를 채워보자!";
}

function renderAll() {
  // bucket select in form
  const bucketSel = $("#bucket");
  bucketSel.innerHTML = `<option value="">(자동분류)</option>` + BUCKETS.map(b => `<option value="${b.id}">${b.label}</option>`).join("");

  renderSelectors();
  renderCourseTable();
  renderProgress();
}

function setBar(sel, value, max) {
  const el = $(sel);
  const pct = max <= 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  el.style.width = pct + "%";
  el.setAttribute("aria-valuenow", String(pct));
}

function badge(ok) {
  return ok
    ? `<span class="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">OK</span>`
    : `<span class="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700">미충족</span>`;
}

function renderReqLine(title, have, need, ok) {
  const pct = need <= 0 ? 100 : Math.min(100, Math.round((have / need) * 100));
  return `
    <div class="flex items-center justify-between gap-3">
      <div class="text-sm font-semibold text-slate-900">${escapeHtml(title)}</div>
      <div class="flex items-center gap-2">
        <div class="text-xs text-slate-600">${have} / ${need}</div>
        ${badge(ok)}
      </div>
    </div>
    <div class="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div class="h-2 rounded-full bg-slate-900/80" style="width:${pct}%"></div>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/** ---------------------------------------------------------
 * Paste Import (Portal table copy/paste)
 * - Accepts TSV (tab-separated) or multi-space separated rows
 * - Extracts: course code + credits (prefers credits-number followed by grade)
 * - Adds into state.courses with auto-bucket via suggestBucket()
 * -------------------------------------------------------- */
function setupPasteImport() {
  const box = $("#pasteBox");
  const btn = $("#btnParsePaste");
  const btnClear = $("#btnClearPaste");
  const out = $("#pasteResult");

  // If UI isn't present, do nothing
  if (!box || !btn) return;

  btn.addEventListener("click", () => {
    const text = box.value || "";
    const result = importFromPastedTable(text);
    if (out) out.textContent = `인식: ${result.parsed}줄 / 추가: ${result.added}과목 / 중복·무시: ${result.skipped}`;
    saveState();
    renderAll();
  });

  if (btnClear) {
    btnClear.addEventListener("click", () => {
      box.value = "";
      if (out) out.textContent = "";
    });
  }
}

function importFromPastedTable(text) {
  const lines = String(text || "")
    .replace(/\r/g, "")
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean);

  let parsed = 0, added = 0, skipped = 0;

  for (const line of lines) {
    parsed++;
    const cells = splitCells(line);
    const code = findCourseCode(cells);
    const creditInfo = findCreditToken(cells);
    const credits = creditInfo?.credits;

    if (!code || !Number.isFinite(credits) || credits <= 0) { skipped++; continue; }

    // Deduplicate by course code
    const exists = state.courses.some(c => (c.code || "").toUpperCase() === code.toUpperCase());
    if (exists) { skipped++; continue; }

    const name = guessCourseName(cells, creditInfo?.idx);
    const bucket = suggestBucket(code, name);

    state.courses.unshift({
      id: uid(),
      code,
      name: name || code,
      credits,
      bucket
    });

    added++;
  }

  return { parsed, added, skipped };
}

function splitCells(line) {
  if (line.includes("\t")) {
    return line.split("\t").map(s => s.trim()).filter(Boolean);
  }
  return line.split(/\s{2,}/).map(s => s.trim()).filter(Boolean);
}

function findCourseCode(cells) {
  const codeRe = /^[A-Za-z]{1,6}\d{2,4}[A-Za-z]?$/; // BS105a, HSS109a, GC101
  for (const c of cells) {
    const t = String(c).trim();
    if (codeRe.test(t)) return t;
  }
  for (const c of cells) {
    const m = String(c).trim().match(/[A-Za-z]{1,6}\d{2,4}[A-Za-z]?/);
    if (m) return m[0];
  }
  return null;
}

function findCreditToken(cells) {
  const gradeRe = /^(S|U|P|NP|A\+|A0|A-|B\+|B0|B-|C\+|C0|C-|D\+|D0|D-|F)$/i;

  for (let i = 0; i < cells.length; i++) {
    const v = normalizeNumber(cells[i]);
    if (!Number.isFinite(v) || v < 0.5 || v > 6) continue;

    const next = (cells[i + 1] || "").trim();
    if (gradeRe.test(next)) return { idx: i, credits: v };
  }

  // Fallback: last plausible number (may confuse with GPA, but better than nothing)
  let best = null;
  for (let i = 0; i < cells.length; i++) {
    const v = normalizeNumber(cells[i]);
    if (!Number.isFinite(v) || v < 0.5 || v > 6) continue;
    best = { idx: i, credits: v };
  }
  return best;
}

function normalizeNumber(x) {
  const s = String(x || "").replace(",", ".").trim();
  const m = s.match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : NaN;
}

function guessCourseName(cells, creditIdx) {
  const end = creditIdx != null ? Math.min(cells.length, creditIdx) : cells.length;
  const stop = new Set([
    "기초","심화","교과","전공","필수","선택","인문사회","기초과학","기초공학","영어",
    "글로벌커뮤니케이션","쓰기·읽기 중점","미래소양강좌"
  ]);

  let best = "";
  for (let i = 0; i < end; i++) {
    const t = String(cells[i] || "").trim();
    if (!t) continue;
    if (stop.has(t)) continue;
    if (/^\d+(\.\d+)?$/.test(t)) continue;
    if (/^[A-Za-z]{1,6}\d{2,4}[A-Za-z]?$/.test(t)) continue;
    if (t.length > best.length) best = t;
  }
  return best;
}

/** ---------------------------------------------------------
 * Boot
 * -------------------------------------------------------- */
async function main() {
  loadState();
  await loadData();
  setupAddCourseForm();  setupPasteImport();
  renderAll();
}

main();
