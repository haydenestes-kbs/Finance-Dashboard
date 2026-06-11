// =============================================================
// KBS FP&A DASHBOARD — secured (login required) · May 2026
// =============================================================

// -------------------------------------------------------------
// SUPABASE CONFIG  ← fill these in (see DEPLOYMENT_GUIDE.md)
// -------------------------------------------------------------
const SUPABASE_URL = 'https://qlrjughdnauodapvubvq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFscmp1Z2hkbmF1b2RhcHZ1YnZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwMjIzMjUsImV4cCI6MjA5NjU5ODMyNX0.b72XbKUJf4LA4EtEtI4d9FnsTifd2ow0crhRWoahaPY';

let sb = null;
let CONFIGURED = false;
try {
  if (SUPABASE_URL && !SUPABASE_URL.startsWith('YOUR_') && window.supabase) {
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { db: { schema: 'finance' } });
    CONFIGURED = true;
  }
} catch (e) { console.warn('Supabase init failed', e); }

let REVIEWER = 'Reviewer';   // set from the signed-in user's email after login

// Department scoping. Resolved after login from shared.visible_departments().
let visibleDepts = [];       // every department code the signed-in user may see
let homeDept = null;         // the department new rows are written under
let activeDept = null;       // current selector value: a dept code, or '__ALL__' for consolidated
let allLineItems = [];       // every visible dept's actual lines (tagged with .department)
let isAdminUser = false;     // true if the signed-in user has all-department access
// Department metadata, loaded from shared.departments at login.
// DEPT_META[code] = { name, parent }. Falls back to a small static map if the
// load fails, so the dashboard still renders.
let DEPT_META = {};
const DEPT_NAMES_FALLBACK = { '3020':'Finance','3040':'Information Technology','3041':'IT-Infrastructure','3042':'IT-Development','3070':'Legal','1020':'Field Ops Mgmt-LSS' };
function deptName(code){ return (DEPT_META[code] && DEPT_META[code].name) || DEPT_NAMES_FALLBACK[code] || code; }
function deptParent(code){ return DEPT_META[code] ? DEPT_META[code].parent : null; }
function isTopLevel(code){ return !deptParent(code); }
// direct children of a department (one level down)
function childrenOf(code){ return Object.keys(DEPT_META).filter(c => DEPT_META[c].parent === code); }
// Display identity per known user (name + title). Falls back to the email prefix.
const USER_IDENTITY = {
  'bfremont@kbs-services.com':      { name:'Ben Fremont',     title:'VP, FP&A' },
  'hayden.estes@kbs-services.com':  { name:'Hayden Estes',    title:'Director, Finance Transformation' },
  'isiddiqui@kbs-services.com':     { name:'Irfan Siddiqui',  title:'SVP, Information Technology' },
  'janet.saura@kbs-services.com':   { name:'Janet Saura',     title:'General Counsel' },
  'kamonte.mccray@kbs-services.com':{ name:'Kamonte McCray',  title:'Chief Revenue Officer' },
};
let userIdentity = { name:'User', title:'' };
// Short name like "B. Fremont" for the compact sidebar reviewer line.
function shortName(full){
  const parts = String(full).trim().split(/\s+/);
  return parts.length>1 ? `${parts[0][0]}. ${parts.slice(1).join(' ')}` : full;
}
// Update all the identity + department labels for the signed-in user and active view.
function applyIdentity(){
  const idDept = (activeDept && activeDept!=='__ALL__') ? activeDept : (homeDept || '3020');
  const consolidated = activeDept === '__ALL__';
  const navLabel = document.getElementById('navDeptLabel');
  if (navLabel) navLabel.textContent = consolidated
    ? (isAdminUser ? 'All Departments' : 'My Departments')
    : deptName(idDept);
  const rev = document.getElementById('navReviewer');
  if (rev) rev.textContent = `${shortName(userIdentity.name)}${userIdentity.title?', '+userIdentity.title:''}`;
  const sub = document.getElementById('pageSub');
  if (sub) sub.textContent = `Executive review · ${userIdentity.name}${userIdentity.title?', '+userIdentity.title:''} · May 2026 close`;
}
// Department the forecast editor reads/writes. In consolidated mode there is no
// single target, so fall back to homeDept (the editor is hidden in that mode anyway).
function forecastDept(){ return (activeDept && activeDept!=='__ALL__') ? activeDept : homeDept; }

// =============================================================
// STATIC STRUCTURE (not sensitive): month layout + Hayden's terms.
// The actual dollar figures load from Supabase after login.
// =============================================================
const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const ACTUAL_MONTHS = 5;            // Jan–May are actuals
const CURRENT_MONTH_IDX = 4;        // May

// lineItems is populated from the DB (actuals table) at load time.
let lineItems = [];

// Hayden Estes — NON-BUDGETED new hire. Director, Finance Transformation.
// $190,000/yr. Starts May 31, 2026 → first full month is June.
const HAYDEN_SALARY_ANNUAL = 190000;
const haydenMonthlySalary = Math.round(HAYDEN_SALARY_ANNUAL / 12);          // 15,833
let benefitsRatio = 0.1395;   // recomputed from DB actuals after load
let haydenMonthlyBenefit = Math.round(haydenMonthlySalary * benefitsRatio);
let haydenLines = [];

function buildHaydenLines(){
  haydenMonthlyBenefit = Math.round(haydenMonthlySalary * benefitsRatio);
  haydenLines = [
    { id:'hayden_salary',   label:'Salary — H. Estes',            cat:'payroll',  hayden:true, monthly: haydenMonthlySalary },
    { id:'hayden_benefits', label:'Employee Benefits — H. Estes', cat:'benefits', hayden:true, monthly: haydenMonthlyBenefit },
  ];
}

// =============================================================
// REQUISITIONS — open roles Ben adds on the org chart.
// Each req creates flagged forecast lines (salary at midpoint + bonus,
// plus benefits), active from its target start month through December.
// =============================================================
let reqs = [];        // [{id,title,reports_to,salary_low,salary_high,bonus_pct,start_date}]
let reqLines = [];    // derived forecast line objects

// month index (0=Jan..11=Dec) of a req's start date; defaults to June (5) if unset
function reqStartIdx(r){
  if (!r.start_date) return 5;
  const d = new Date(r.start_date + 'T00:00:00');
  const idx = d.getMonth();           // 0..11
  return isNaN(idx) ? 5 : Math.max(0, Math.min(11, idx));
}

// annual all-in for a req: midpoint salary + bonus%, benefits computed separately
function reqMidpointAnnual(r){
  const mid = (Number(r.salary_low) + Number(r.salary_high)) / 2;
  return Math.round(mid);
}

function buildReqLines(){
  reqLines = [];
  reqs.forEach(r=>{
    const annual = reqMidpointAnnual(r);
    const bonusAnnual = Math.round(annual * (Number(r.bonus_pct)||0) / 100);
    const salMonthly = Math.round((annual + bonusAnnual) / 12);   // salary line incl. bonus, spread monthly
    const benMonthly = Math.round(salMonthly * benefitsRatio);
    const startIdx = reqStartIdx(r);
    const short = (r.title || 'Open Req').length > 22 ? (r.title.slice(0,20)+'…') : (r.title||'Open Req');
    reqLines.push({ id:`req_${r.id}_sal`, label:`Salary — ${short} (open)`,  cat:'payroll',  req:true, reqId:r.id, monthly:salMonthly, startIdx });
    reqLines.push({ id:`req_${r.id}_ben`, label:`Benefits — ${short} (open)`, cat:'benefits', req:true, reqId:r.id, monthly:benMonthly, startIdx });
  });
}

// =============================================================
// CUSTOM LINES — extra rows Ben adds to a section (blank editable cells)
// =============================================================
let customLines = [];   // [{id,label,cat}]

// section key -> forecast line categories it contains, + display label
const SECTIONS = [
  { key:'wages',   label:'Employee Wages & Benefits', cats:['payroll','benefits'] },
  { key:'vendors', label:'External Vendors',          cats:['service','prof'] },
  { key:'te',      label:'Travel & Entertainment',    cats:['te'] },
  { key:'other',   label:'Other Expenses',            cats:['other'] },
];
// which category a custom line gets, by section (first cat of the section)
const SECTION_DEFAULT_CAT = { wages:'payroll', vendors:'service', te:'te', other:'other' };

// =============================================================
// CATEGORY BUDGETS (derived from YTD actuals as the baseline)
// Monthly budget = YTD-actual average per line. Forecast defaults to it.
// =============================================================
function ytd(arr){ return arr.reduce((a,b)=>a+b,0); }
function avg(arr){ const nz = arr.filter((v,i)=>i<ACTUAL_MONTHS); return Math.round(ytd(nz)/ACTUAL_MONTHS); }

const catMeta = {
  payroll:  { label:'Payroll',          tag:'cat-other' },
  benefits: { label:'Benefits',         tag:'cat-benefits' },
  service:  { label:'Service Center',   tag:'cat-service' },
  prof:     { label:'Professional Fees',tag:'cat-prof' },
  te:       { label:'Travel & Entertainment', tag:'cat-te' },
  other:    { label:'Other Labor & Supplies', tag:'cat-other' },
  addback:  { label:'Management Add-back', tag:'cat-other' },
};

const fmt = (n) => (n<0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString();
const fmtK = (n) => Math.abs(n) >= 1000 ? '$' + (n/1000).toFixed(0) + 'K' : '$' + Math.round(n);
const initClasses = ['init-a','init-b','init-c','init-d','init-e','init-f','init-g','init-h'];

// =============================================================
// STATE & PERSISTENCE  (cloud-only — data lives in Supabase, gated by login)
//   - actuals (loaded from DB)
//   - forecast values (per line, Jun–Dec)
//   - comments (keyed by tab + line + month)
// No financial data is cached in the browser.
// =============================================================

// Build default forecast: every forecast month for each line defaults to
// that line's YTD monthly average (its "budget"). Hayden lines added Jun–Dec.
function buildDefaultForecast(){
  const fc = {};
  lineItems.forEach(l => {
    const base = avg(l.actuals);
    fc[l.id] = months.map((m,i)=> i<ACTUAL_MONTHS ? l.actuals[i] : base);
  });
  haydenLines.forEach(l => {
    fc[l.id] = months.map((m,i)=> i<ACTUAL_MONTHS ? 0 : l.monthly);
  });
  reqLines.forEach(l => {
    // zero before start month and across all actuals; monthly amount from start month → Dec
    fc[l.id] = months.map((m,i)=> (i<ACTUAL_MONTHS || i<l.startIdx) ? 0 : l.monthly);
  });
  customLines.forEach(l => {
    // blank line — all zeros; Ben types the forecast months himself
    fc[l.id] = months.map(()=> 0);
  });
  return fc;
}

let forecastState = {};
let commentsState = {};   // { "forecast|lineId|monthIdx": [ {author, text, ts} ] }

function setConn(ok, label){
  const cls = ok ? '' : 'off';
  ['connBadge','headerBadge'].forEach(id=>{
    const el = document.getElementById(id);
    if(!el) return;
    el.innerHTML = `<span class="live-dot ${cls}"></span>${label}`;
    el.className = 'sync-badge' + (ok?'':' off');
  });
}

// Load the Jan–May actuals from Supabase and rebuild lineItems + Hayden lines.
async function loadActuals(){
  const { data, error } = await sb.from('actuals').select('*')
    .in('department', visibleDepts)
    .order('sort_order',{ascending:true});
  if (error) throw error;
  allLineItems = (data||[]).map(r=>({
    id:r.id, label:r.label, cat:r.cat, vendor:r.vendor, department:r.department,
    actuals:[Number(r.jan),Number(r.feb),Number(r.mar),Number(r.apr),Number(r.may)]
  }));
  applyActiveDept();   // sets lineItems from allLineItems based on activeDept
}

// The set of department codes the user may see (from access), sorted.
function visibleSet(){ return (visibleDepts || []).slice().sort(); }

// Which actual department codes a dropdown selection covers:
//  - '__ALL__'      -> every visible department
//  - a parent code  -> that code plus its visible children
//  - a leaf code    -> just that code
function deptsForSelection(sel){
  const vis = new Set(visibleSet());
  if (sel === '__ALL__') return Array.from(vis);
  const kids = childrenOf(sel).filter(c => vis.has(c));
  const out = [sel, ...kids].filter(c => vis.has(c));
  return out.length ? out : [sel];
}

// Build the dropdown options appropriate to the user.
//  - admin: each top-level (no-parent) visible department, plus a top "All" rollup
//  - department head whose home dept has children: Consolidated + each child
//  - leaf head: just their own department
function selectorOptions(){
  const vis = visibleSet();
  if (isAdminUser){
    const tops = vis.filter(isTopLevel);
    return { showAll:true, items: tops };
  }
  // non-admin: anchored on their home department
  const kids = childrenOf(homeDept).filter(c => vis.includes(c));
  if (kids.length){
    return { showAll:true, items: [homeDept, ...kids] };  // parent + its sub-departments
  }
  return { showAll:false, items: [homeDept] };             // leaf department
}

// Rebuild lineItems from allLineItems for the current activeDept selection.
function applyActiveDept(){
  if (!activeDept){
    const opt = selectorOptions();
    activeDept = opt.showAll ? '__ALL__' : (opt.items[0] || homeDept);
  }
  const codes = deptsForSelection(activeDept);
  const rows = allLineItems.filter(l => codes.includes(l.department));
  const single = (activeDept !== '__ALL__') && childrenOf(activeDept).length === 0;

  if (!single){
    // consolidated: one synthetic line per category across the selected codes
    const byCat = {};
    rows.forEach(l=>{
      const c = byCat[l.cat] || (byCat[l.cat] = [0,0,0,0,0]);
      l.actuals.forEach((v,i)=> c[i]+=v);
    });
    lineItems = Object.keys(byCat).map(cat=>({
      id:`roll_${cat}`, label:(catMeta[cat]?catMeta[cat].label:cat), cat, vendor:'Consolidated',
      actuals:byCat[cat]
    }));
  } else {
    // single leaf department: full line detail
    lineItems = rows.map(l=>({ id:l.id, label:l.label, cat:l.cat, vendor:l.vendor, actuals:l.actuals.slice() }));
  }
  // recompute benefits ratio from whatever is in view
  const sal = (lineItems.find(l=>l.id==='salary'||l.id==='roll_payroll')||{actuals:[0]}).actuals.reduce((a,b)=>a+b,0);
  const ben = lineItems.filter(l=>l.cat==='benefits').reduce((s,l)=>s+l.actuals.reduce((a,b)=>a+b,0),0);
  benefitsRatio = sal>0 ? ben/sal : 0.1395;
  buildHaydenLines();
}

// Resolve which department codes this user may see, via the shared helper.
// Falls back to 3020 (finance) if the lookup returns nothing, so the existing
// finance dashboard keeps working. Uses a REST fallback for the user_access
// lookup so it works regardless of supabase-js .schema() support.
async function resolveDepartments(email){
  visibleDepts = [];
  homeDept = null;
  // Call shared.visible_departments(). The client defaults to the 'finance' schema,
  // so we must explicitly target 'shared'. Try the JS client first; if the RPC
  // can't be schema-routed in this supabase-js version, fall back to REST with the
  // Content-Profile header that selects the shared schema.
  try {
    let vis = null, vErr = null;
    if (typeof sb.schema === 'function') {
      const r = await sb.schema('shared').rpc('visible_departments');
      vis = r.data; vErr = r.error;
    } else { vErr = new Error('no .schema()'); }
    if (vErr) throw vErr;
    visibleDepts = (vis || []).map(r => r.department);
  } catch(e){
    console.warn('visible_departments via client failed, trying REST', e);
    try {
      const token = (await sb.auth.getSession()).data.session.access_token;
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/visible_departments`, {
        method: 'POST',
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`,
                   'Content-Type': 'application/json',
                   'Content-Profile': 'shared', 'Accept-Profile': 'shared' },
        body: '{}' });
      const rows = await resp.json();
      if (Array.isArray(rows)) visibleDepts = rows.map(r => r.department);
    } catch(e2){ console.warn('visible_departments REST fallback failed', e2); }
  }
  // home department (where new rows are written): read the user's access row.
  try {
    let acc = null;
    if (typeof sb.schema === 'function') {
      const { data } = await sb.schema('shared').from('user_access')
        .select('department, is_admin').eq('email', email.toLowerCase()).maybeSingle();
      acc = data;
    } else {
      // REST fallback for older supabase-js without .schema()
      const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/user_access?email=eq.${encodeURIComponent(email.toLowerCase())}&select=department,is_admin`,
        { headers: { apikey: SUPABASE_ANON_KEY,
                     Authorization: `Bearer ${(await sb.auth.getSession()).data.session.access_token}`,
                     'Accept-Profile': 'shared' } });
      const rows = await resp.json();
      acc = Array.isArray(rows) && rows.length ? rows[0] : null;
    }
    if (acc) { homeDept = acc.is_admin ? '3020' : acc.department; isAdminUser = !!acc.is_admin; }
  } catch(e){ console.warn('user_access lookup failed', e); }
  if (!visibleDepts.length) visibleDepts = ['3020'];
  if (!homeDept) homeDept = '3020';
  await loadDeptHierarchy();
}

// Load code/name/parent for every department from shared.departments so the
// dropdown can show the right level (top-level for admins, subtree for heads).
async function loadDeptHierarchy(){
  DEPT_META = {};
  try {
    let rows = null;
    if (typeof sb.schema === 'function') {
      const { data } = await sb.schema('shared').from('departments')
        .select('code, name, parent_code, is_active');
      rows = data;
    } else {
      const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/departments?select=code,name,parent_code,is_active`,
        { headers: { apikey: SUPABASE_ANON_KEY,
                     Authorization: `Bearer ${(await sb.auth.getSession()).data.session.access_token}`,
                     'Accept-Profile': 'shared' } });
      rows = await resp.json();
    }
    (rows || []).forEach(r=>{ if (r.is_active !== false) DEPT_META[r.code] = { name:r.name, parent:r.parent_code || null }; });
  } catch(e){ console.warn('department hierarchy load failed', e); }
}

async function loadAll(){
  // actuals first (everything else depends on them)
  await loadActuals();
  // requisitions (must exist before forecast defaults are built)
  try {
    const { data: reqRows } = await sb.from('requisitions').select('*')
      .in('department', visibleDepts).order('created_at',{ascending:true});
    reqs = reqRows || [];
  } catch(e){ reqs = []; }
  buildReqLines();
  // custom lines (also must exist before forecast defaults)
  try {
    const { data: clRows } = await sb.from('custom_lines').select('*')
      .in('department', visibleDepts).order('created_at',{ascending:true});
    customLines = (clRows||[]).map(r=>({ id:r.id, label:r.label, section:r.cat, cat:SECTION_DEFAULT_CAT[r.cat]||'other', custom:true }));
  } catch(e){ customLines = []; }
  // forecast
  await loadForecastForDept();
  // comments
  const { data: cmts } = await sb.from('comments').select('*')
    .in('department', visibleDepts).order('created_at',{ascending:true});
  commentsState = {};
  (cmts||[]).forEach(c=>{
    (commentsState[c.cell_key] = commentsState[c.cell_key] || []).push(
      { id:c.id, author:c.author, text:c.body, ts:c.created_at });
  });
  setConn(true, 'Supabase · synced');
}

// Load (or default) the forecast for the department the editor currently targets.
async function loadForecastForDept(){
  try {
    const { data: fcRow } = await sb.from('forecast').select('data')
      .eq('department', forecastDept()).maybeSingle();
    forecastState = { ...buildDefaultForecast(), ...(fcRow && fcRow.data ? fcRow.data : {}) };
  } catch(e){
    console.warn('forecast load failed', e);
    forecastState = buildDefaultForecast();
  }
}

async function saveForecastCloud(){
  try {
    await sb.from('forecast').upsert(
      { department:forecastDept(), reviewer:REVIEWER, data:forecastState, updated_at:new Date().toISOString() },
      { onConflict:'department' });
  } catch(e){ console.warn('forecast save failed', e); toast('Save failed — check connection', true); }
}

async function addCommentCloud(cellKey, body){
  const entry = { author:REVIEWER, text:body, ts:new Date().toISOString() };
  try {
    const { data, error } = await sb.from('comments')
      .insert({ cell_key:cellKey, author:REVIEWER, body, department:homeDept }).select().single();
    if (error) throw error;
    if (data) entry.id = data.id;
    (commentsState[cellKey] = commentsState[cellKey] || []).push(entry);
  } catch(e){ console.warn('comment save failed', e); toast('Comment failed — check connection', true); }
}

async function deleteCommentCloud(cellKey, idx){
  const list = commentsState[cellKey] || [];
  const entry = list[idx];
  try {
    if (entry && entry.id) {
      const { error } = await sb.from('comments').delete().eq('id', entry.id);
      if (error) throw error;
    }
    list.splice(idx,1);
    if (list.length === 0) delete commentsState[cellKey];
  } catch(e){ console.warn('comment delete failed', e); toast('Delete failed — check connection', true); }
}

function toast(msg, isErr){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  setTimeout(()=> t.className = 'toast' + (isErr?' err':''), 2600);
}

// =============================================================
// TAB SWITCHING
// ===== END REUSED BACKEND CORE =====

// =============================================================
// V2 RENDER LAYER — 6-tab structure on the real backend
// Tabs: 1 P&L · 2 Payroll · 3 Vendors · 4 T&E · 5 Budget · 6 Scenario
// Everything reads from the department-scoped lineItems / allLineItems.
// Tabs without a real data source yet render an honest stub.
// =============================================================

let pnlView = 'mtd';   // 'mtd' (May) or 'ytd'
let charts = {};       // keep chart instances so we can destroy before redraw
function destroyChart(key){ if (charts[key]){ charts[key].destroy(); delete charts[key]; } }
function escapeHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// Cost section grouping for the P&L. We hold operating-cost actuals only (no
// revenue feed yet), so the P&L is cost-focused: categories roll into COR/OpEx.
const COR_CATS  = ['payroll','benefits','service'];          // cost of revenue / direct delivery
const OPEX_CATS = ['prof','te','other'];                     // operating expenses
const ADDBACK_CATS = ['addback'];                            // EBITDA add-backs (shown separately)
function sectionForCat(cat){
  if (ADDBACK_CATS.includes(cat)) return 'ADDBACK';
  return COR_CATS.includes(cat) ? 'COR' : 'OPEX';
}

// Per-line actual for a period: month = May, ytd = Jan-May sum.
function valFor(l, view){ return view==='mtd' ? l.actuals[CURRENT_MONTH_IDX] : ytd(l.actuals); }
// Budget baseline = YTD monthly average (same basis the forecast uses).
function budFor(l, view){ const a = avg(l.actuals); return view==='mtd' ? a : a*ACTUAL_MONTHS; }

// ---- TAB 1: P&L ----------------------------------------------------------
function renderPnl(){
  const view = pnlView;
  // group the scoped lines by category
  const byCat = {};
  lineItems.forEach(l=>{
    const c = byCat[l.cat] || (byCat[l.cat] = { actual:0, budget:0 });
    c.actual += valFor(l, view); c.budget += budFor(l, view);
  });
  const cats = Object.keys(catMeta).filter(c=>byCat[c]);
  const corA = cats.filter(c=>sectionForCat(c)==='COR').reduce((s,c)=>s+byCat[c].actual,0);
  const corB = cats.filter(c=>sectionForCat(c)==='COR').reduce((s,c)=>s+byCat[c].budget,0);
  const opexA = cats.filter(c=>sectionForCat(c)==='OPEX').reduce((s,c)=>s+byCat[c].actual,0);
  const opexB = cats.filter(c=>sectionForCat(c)==='OPEX').reduce((s,c)=>s+byCat[c].budget,0);
  const addA = cats.filter(c=>sectionForCat(c)==='ADDBACK').reduce((s,c)=>s+byCat[c].actual,0);
  const addB = cats.filter(c=>sectionForCat(c)==='ADDBACK').reduce((s,c)=>s+byCat[c].budget,0);
  const operA = corA+opexA, operB = corB+opexB;     // operating cost (excludes add-backs)
  const totA = operA+addA, totB = operB+addB;        // grand total (includes add-backs)
  const hasAddback = cats.some(c=>sectionForCat(c)==='ADDBACK');

  // KPIs: we have costs, not revenue, so frame around operating cost + variance.
  const per = view==='mtd' ? 'May 2026' : 'YTD Jan–May';
  const kpis = [
    { l:'Total Cost', v:fmt(totA), s:per },
    { l:'Operating Cost', v:fmt(operA), s:hasAddback?'Excludes add-backs':`${totA?Math.round(operA/totA*100):0}% of cost` },
    { l: hasAddback ? 'Management Add-back' : 'Operating Expense', v:fmt(hasAddback?addA:opexA), s:hasAddback?'Non-operating':`${totA?Math.round(opexA/totA*100):0}% of cost` },
    { l:'Over / (Under) Budget', v:(totA-totB>=0?'+':'')+fmt(totA-totB),
      s:`vs ${fmt(totB)} baseline`, cls:(totA-totB)>0?'dn':'up' },
  ];
  document.getElementById('pnlKpis').innerHTML = kpis.map(k=>
    `<div class="kpi"><div class="kpi-label">${k.l}</div><div class="kpi-val ${k.cls||''}">${k.v}</div><div class="kpi-sub">${k.s}</div></div>`).join('');

  // table: section header, then each category line; subtotals for COR / OpEx
  const lineRow = (label, a, b) => {
    const v = a-b; const vc = Math.abs(v)<1?'vzero':(v<=0?'vneg':'vpos');
    const op = b ? (v/Math.abs(b))*100 : 0;
    const st = Math.abs(op)<2 ? '<span class="badge bmuted">On Plan</span>'
             : (v<=0 ? '<span class="badge bok">Under</span>' : '<span class="badge brisk">Over</span>');
    return `<tr><td>${label}</td><td class="r strong">${fmt(a)}</td><td class="r dim">${fmt(b)}</td><td class="r ${vc}">${v>=0?'+':''}${fmt(v)}</td><td>${st}</td></tr>`;
  };
  const subRow = (label,a,b)=>{ const v=a-b, vc=Math.abs(v)<1?'vzero':(v<=0?'vneg':'vpos');
    return `<tr class="sub"><td class="strong">${label}</td><td class="r">${fmt(a)}</td><td class="r">${fmt(b)}</td><td class="r ${vc}">${v>=0?'+':''}${fmt(v)}</td><td></td></tr>`; };
  const secLines = sec => cats.filter(c=>sectionForCat(c)===sec)
    .sort((a,b)=>byCat[b].actual-byCat[a].actual)
    .map(c=>lineRow(catMeta[c].label, byCat[c].actual, byCat[c].budget)).join('');

  let h = `<thead><tr><th>Cost Category</th><th class="r">${view==='mtd'?'May':'YTD'} Actual</th><th class="r">Budget</th><th class="r">Variance</th><th>Status</th></tr></thead><tbody>`;
  h += `<tr class="grp"><td colspan="5">Cost of Delivery</td></tr>` + secLines('COR') + subRow('Total Cost of Delivery',corA,corB);
  h += `<tr class="grp"><td colspan="5">Operating Expenses</td></tr>` + secLines('OPEX') + subRow('Total Operating Expense',opexA,opexB);
  if (hasAddback){
    h += subRow('Operating Cost (subtotal)', operA, operB);
    h += `<tr class="grp"><td colspan="5">Add-backs (non-operating)</td></tr>` + secLines('ADDBACK');
  }
  const tv = totA-totB, tvc = tv<=0?'vneg':'vpos';
  const totLabel = hasAddback ? 'Total Cost (incl. add-backs)' : 'Total Operating Cost';
  h += `</tbody><tfoot><tr><td>${totLabel}</td><td class="r">${fmt(totA)}</td><td class="r">${fmt(totB)}</td><td class="r ${tvc}">${tv>=0?'+':''}${fmt(tv)}</td><td></td></tr></tfoot>`;
  document.getElementById('pnlTable').innerHTML = h;
}

function renderPnlCharts(){
  // monthly operating cost (all scoped lines summed per month)
  const monthly = months.slice(0,ACTUAL_MONTHS).map((m,i)=> lineItems.reduce((s,l)=>s+l.actuals[i],0));
  destroyChart('pnlBar');
  charts.pnlBar = new Chart(document.getElementById('pnlBar'), { type:'bar',
    data:{ labels:months.slice(0,ACTUAL_MONTHS), datasets:[{ data:monthly, backgroundColor:'#1A56A0', borderRadius:4, barThickness:34 }] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:c=>fmt(c.parsed.y) } } },
      scales:{ y:{ ticks:{ callback:v=>fmtK(v) }, grid:{color:'#F1F5F9'} }, x:{ grid:{display:false} } } } });

  // cost mix donut: category YTD
  const byCat = {};
  lineItems.forEach(l=>{ byCat[l.cat] = (byCat[l.cat]||0) + ytd(l.actuals); });
  const labels = Object.keys(byCat).filter(c=>byCat[c]>0).sort((a,b)=>byCat[b]-byCat[a]);
  const data = labels.map(c=>byCat[c]);
  const colorMap = { payroll:'#1A56A0', benefits:'#2E6FCC', service:'#1A7A4A', prof:'#6B21A8', te:'#B91C1C', other:'#B45309' };
  destroyChart('pnlDonut');
  charts.pnlDonut = new Chart(document.getElementById('pnlDonut'), { type:'doughnut',
    data:{ labels:labels.map(c=>catMeta[c]?catMeta[c].label:c), datasets:[{ data, backgroundColor:labels.map(c=>colorMap[c]||'#94A3B8'), borderColor:'#fff', borderWidth:2 }] },
    options:{ responsive:true, maintainAspectRatio:false, cutout:'60%', plugins:{ legend:{ position:'bottom', labels:{ boxWidth:9, padding:8, font:{size:9} } }, tooltip:{ callbacks:{ label:c=>`${c.label}: ${fmt(c.parsed)}` } } } } });
}

// ---- TAB 2: PAYROLL ------------------------------------------------------
// Real GL cost totals (payroll/benefits) + the employee roster (sample comp).
function renderPayroll(){
  const payLines = lineItems.filter(l=>l.cat==='payroll' || l.cat==='benefits');
  const payYtd = payLines.filter(l=>l.cat==='payroll').reduce((s,l)=>s+ytd(l.actuals),0);
  const benYtd = payLines.filter(l=>l.cat==='benefits').reduce((s,l)=>s+ytd(l.actuals),0);
  const payMay = payLines.filter(l=>l.cat==='payroll').reduce((s,l)=>s+l.actuals[CURRENT_MONTH_IDX],0);
  // budgeted labor YTD: run-rate baseline of the payroll lines (interim until real budget loads)
  const budLaborYtd = payLines.filter(l=>l.cat==='payroll').reduce((s,l)=>s+avg(l.actuals)*ACTUAL_MONTHS,0);

  const kpis = [
    { l:'Payroll · May', v:fmt(payMay), s:'Salary, wages, OT' },
    { l:'Payroll · YTD', v:fmt(payYtd), s:'Jan–May' },
    { l:'Benefits & Taxes · YTD', v:fmt(benYtd), s:payYtd?`${Math.round(benYtd/payYtd*100)}% of payroll`:'—' },
    { l:'Budgeted Labor · YTD', v:fmt(budLaborYtd), s:'Run-rate baseline' },
  ];
  document.getElementById('payKpis').innerHTML = kpis.map(k=>
    `<div class="kpi"><div class="kpi-label">${k.l}</div><div class="kpi-val">${k.v}</div><div class="kpi-sub">${k.s}</div></div>`).join('');

  // ----- headcount metrics row -----
  const active = employees.filter(e=>e.status==='active');
  const opens = employees.filter(e=>e.status==='open');
  const backfills = opens.filter(e=>e.backfill_for);
  const newReqs = opens.filter(e=>!e.backfill_for);
  const termed = employees.filter(e=>e.status==='termed');
  const hcRow = document.getElementById('payHcRow');
  if (hcRow){
    const cards = [
      { l:'Active Headcount', v:active.length, s:'Filled positions' },
      { l:'Open Headcount', v:newReqs.length, s:'New positions' },
      { l:'Open Backfills', v:backfills.length, s:'Replacing exits' },
      { l:'Recent Exits', v:termed.length, s:'Termed' },
    ];
    hcRow.innerHTML = cards.map(c=>`<div class="kpi"><div class="kpi-label">${c.l}</div><div class="kpi-val">${c.v}</div><div class="kpi-sub">${c.s}</div></div>`).join('');
  }

  // ----- recent activity (attrition) -----
  const actBody = document.getElementById('payActivityBody');
  if (actBody){
    const recent = termed.slice().sort((a,b)=> (b.term_date||'').localeCompare(a.term_date||''));
    actBody.innerHTML = recent.length ? recent.map(e=>`
      <tr><td class="dim">${e.emp_code||'—'}</td><td class="strong">${escapeHtml(e.name||'—')}</td>
      <td>${escapeHtml(e.title||'')}</td><td class="dim">${fmtDate(e.hire_date)}</td>
      <td class="dim">${fmtDate(e.term_date)}</td><td class="r">${e.base_salary?fmt(e.base_salary):'—'}</td>
      <td class="r dim">${e.bonus_pct?e.bonus_pct+'%':'—'}</td></tr>`).join('')
      : `<tr><td colspan="7" class="dim" style="padding:16px;text-align:center">No recent exits.</td></tr>`;
  }

  // ----- current employee listing -----
  const empBody = document.getElementById('payEmpBody');
  if (empBody){
    empBody.innerHTML = active.length ? active.map(e=>`
      <tr><td class="dim">${e.emp_code||'—'}</td><td class="strong">${escapeHtml(e.name||'—')}</td>
      <td>${escapeHtml(e.title||'')}</td><td class="dim">${escapeHtml(e.reports_to||'')}</td>
      <td>${e.grade?`<span class="badge bmuted">${e.grade}</span>`:''}</td>
      <td class="dim">${fmtDate(e.hire_date)}</td>
      <td class="r">${e.base_salary?fmt(e.base_salary):'—'}</td>
      <td class="r dim">${e.bonus_pct?e.bonus_pct+'%':'—'}</td>
      <td class="r strong">${fmt(empAllIn(e))}</td></tr>`).join('')
      : `<tr><td colspan="9" class="dim" style="padding:16px;text-align:center">No active employees loaded for this department.</td></tr>`;
    const sub = document.getElementById('payEmpSub');
    if (sub) sub.textContent = `${active.length} active · all-in annual comp (sample)`;
  }

  // ----- open positions -----
  const openBody = document.getElementById('payOpenBody');
  if (openBody){
    openBody.innerHTML = opens.length ? opens.map(e=>`
      <tr><td>${escapeHtml(e.title||'')}</td><td class="dim">${escapeHtml(e.reports_to||'')}</td>
      <td>${e.grade?`<span class="badge bmuted">${e.grade}</span>`:''}</td>
      <td>${e.backfill_for?`<span class="badge bwarn">Backfill · ${escapeHtml(e.backfill_for)}</span>`:'<span class="badge binfo">New headcount</span>'}</td>
      <td class="r">${e.base_salary?fmt(e.base_salary):'—'}</td>
      <td class="r strong">${fmt(empAllIn(e))}</td></tr>`).join('')
      : `<tr><td colspan="6" class="dim" style="padding:16px;text-align:center">No open positions.</td></tr>`;
  }
}

// ---- TAB 3: VENDORS ------------------------------------------------------
// Real: external (non-payroll) vendor lines, sorted high to low.
function renderVendors(){
  const vlines = lineItems.filter(l=> l.vendor && l.vendor!=='Employees' && l.vendor!=='Consolidated' && l.cat!=='payroll' && l.cat!=='benefits')
    .slice().sort((a,b)=> ytd(b.actuals)-ytd(a.actuals));
  const consolidatedMode = (activeDept === '__ALL__');

  const mtd = vlines.reduce((s,l)=>s+l.actuals[CURRENT_MONTH_IDX],0);
  const vYtd = vlines.reduce((s,l)=>s+ytd(l.actuals),0);
  const kpis = [
    { l:'Vendor Lines', v:vlines.length, s:'With YTD activity' },
    { l:'May Spend', v:fmt(mtd), s:'Current month' },
    { l:'YTD Spend', v:fmt(vYtd), s:'Jan–May' },
    { l:'Annualized Run-rate', v:fmt(vYtd/ACTUAL_MONTHS*12), s:'YTD pace x12' },
  ];
  document.getElementById('venKpis').innerHTML = kpis.map(k=>
    `<div class="kpi"><div class="kpi-label">${k.l}</div><div class="kpi-val">${k.v}</div><div class="kpi-sub">${k.s}</div></div>`).join('');

  if (consolidatedMode){
    document.getElementById('venTable').innerHTML =
      `<thead><tr><th>Vendor</th></tr></thead><tbody><tr><td class="dim" style="padding:18px">Vendor-level detail shows when you drill into a single department. In Consolidated view, see the P&L tab for category rollups.</td></tr></tbody>`;
    destroyChart('venBar');
    return;
  }
  const monthHdrs = months.slice(0,ACTUAL_MONTHS).map(m=>`<th class="r">${m}</th>`).join('');
  let h = `<thead><tr><th>Vendor</th><th>Category</th>${monthHdrs}<th class="r">YTD</th><th class="r">Run-rate</th></tr></thead><tbody>`;
  vlines.forEach(l=>{ const y=ytd(l.actuals);
    const monthCells = l.actuals.map(v=>`<td class="r">${v?fmt(v):'<span class="dim">–</span>'}</td>`).join('');
    h += `<tr><td class="strong">${l.vendor}</td><td class="dim">${catMeta[l.cat]?catMeta[l.cat].label:l.cat}</td>${monthCells}<td class="r strong">${fmt(y)}</td><td class="r dim">${fmt(y/ACTUAL_MONTHS*12)}</td></tr>`; });
  const monthTotals = months.slice(0,ACTUAL_MONTHS).map((m,i)=>`<td class="r">${fmt(vlines.reduce((s,l)=>s+l.actuals[i],0))}</td>`).join('');
  h += `</tbody><tfoot><tr><td>Total</td><td></td>${monthTotals}<td class="r">${fmt(vYtd)}</td><td class="r">${fmt(vYtd/ACTUAL_MONTHS*12)}</td></tr></tfoot>`;
  document.getElementById('venTable').innerHTML = h;

  // top vendors bar
  const top = vlines.slice(0,8);
  destroyChart('venBar');
  charts.venBar = new Chart(document.getElementById('venBar'), { type:'bar',
    data:{ labels:top.map(l=>l.vendor.length>22?l.vendor.slice(0,20)+'…':l.vendor), datasets:[{ data:top.map(l=>ytd(l.actuals)), backgroundColor:'#1A56A0', borderRadius:4, barThickness:18 }] },
    options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:c=>fmt(c.parsed.x) } } }, scales:{ x:{ ticks:{ callback:v=>fmtK(v) }, grid:{color:'#F1F5F9'} }, y:{ grid:{display:false} } } } });
}

// ---- TAB 4: T&E ----------------------------------------------------------
function renderTe(){
  const teLines = lineItems.filter(l=>l.cat==='te');
  const teYtd = teLines.reduce((s,l)=>s+ytd(l.actuals),0);
  const teMay = teLines.reduce((s,l)=>s+l.actuals[CURRENT_MONTH_IDX],0);
  const kpis = [
    { l:'T&E · May', v:fmt(teMay), s:'Current month' },
    { l:'T&E · YTD', v:fmt(teYtd), s:'Jan–May' },
    { l:'Annualized', v:fmt(teYtd/ACTUAL_MONTHS*12), s:'YTD pace x12' },
    { l:'Lines', v:teLines.length, s:'GL accounts with activity' },
  ];
  document.getElementById('teKpis').innerHTML = kpis.map(k=>
    `<div class="kpi"><div class="kpi-label">${k.l}</div><div class="kpi-val">${k.v}</div><div class="kpi-sub">${k.s}</div></div>`).join('');

  if (!teLines.length){
    document.getElementById('teTable').innerHTML =
      `<thead><tr><th>T&E</th></tr></thead><tbody><tr><td class="dim" style="padding:18px">No T&E activity for this department in the loaded period.</td></tr></tbody>`;
    destroyChart('teBar'); return;
  }
  let h = `<thead><tr><th>GL / Line</th>${months.slice(0,ACTUAL_MONTHS).map(m=>`<th class="r">${m}</th>`).join('')}<th class="r">YTD</th></tr></thead><tbody>`;
  teLines.sort((a,b)=>ytd(b.actuals)-ytd(a.actuals)).forEach(l=>{
    h += `<tr><td class="strong">${l.label.split('·').pop().trim()}</td>`+l.actuals.map(v=>`<td class="r">${v?fmt(v):'<span class="dim">–</span>'}</td>`).join('')+`<td class="r strong">${fmt(ytd(l.actuals))}</td></tr>`; });
  h += `</tbody>`;
  document.getElementById('teTable').innerHTML = h;

  const monthly = months.slice(0,ACTUAL_MONTHS).map((m,i)=> teLines.reduce((s,l)=>s+l.actuals[i],0));
  destroyChart('teBar');
  charts.teBar = new Chart(document.getElementById('teBar'), { type:'line',
    data:{ labels:months.slice(0,ACTUAL_MONTHS), datasets:[{ label:'Actual T&E', data:monthly, borderColor:'#1A56A0', backgroundColor:'rgba(26,86,160,0.08)', fill:true, tension:0.3, pointRadius:4, pointBackgroundColor:'#1A56A0', pointBorderColor:'#fff', pointBorderWidth:2, borderWidth:2 }] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:c=>fmt(c.parsed.y) } } }, scales:{ y:{ ticks:{ callback:v=>fmtK(v) }, grid:{color:'#F1F5F9'}, beginAtZero:true }, x:{ grid:{display:false} } } } });
}

// ---- TAB 5: BUDGET -------------------------------------------------------
// No AOP / reforecast versions loaded yet. Show the derived run-rate baseline
// as the only "version", with an honest note about loading real budget data.
function renderBudget(){
  const ytdActual = lineItems.reduce((s,l)=>s+ytd(l.actuals),0);
  const fullYearBaseline = lineItems.reduce((s,l)=>s+ ytd(l.actuals) + avg(l.actuals)*(12-ACTUAL_MONTHS), 0);
  const kpis = [
    { l:'YTD Actual', v:fmt(ytdActual), s:'Jan–May' },
    { l:'Run-rate Full-Year', v:fmt(fullYearBaseline), s:'Actuals + YTD pace' },
    { l:'AOP Plan', v:'Not loaded', s:'Awaiting budget feed', cls:'fl' },
    { l:'Variance to AOP', v:'—', s:'Needs AOP', cls:'fl' },
  ];
  document.getElementById('budKpis').innerHTML = kpis.map(k=>
    `<div class="kpi"><div class="kpi-label">${k.l}</div><div class="kpi-val ${k.cls||''}">${k.v}</div><div class="kpi-sub">${k.s}</div></div>`).join('');

  // chart: actuals (Jan-May) + run-rate forecast (Jun-Dec)
  const monthly = months.map((m,i)=> i<ACTUAL_MONTHS ? lineItems.reduce((s,l)=>s+l.actuals[i],0) : lineItems.reduce((s,l)=>s+avg(l.actuals),0));
  destroyChart('budBar');
  charts.budBar = new Chart(document.getElementById('budBar'), { type:'bar',
    data:{ labels:months, datasets:[
      { label:'Actual', data:monthly.map((v,i)=>i<ACTUAL_MONTHS?v:null), backgroundColor:'#1A56A0', borderRadius:3 },
      { label:'Run-rate forecast', data:monthly.map((v,i)=>i>=ACTUAL_MONTHS?v:null), backgroundColor:'#A8C0E8', borderRadius:3 },
    ]},
    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom', labels:{ boxWidth:10, padding:12, font:{size:11} } }, tooltip:{ callbacks:{ label:c=>`${c.dataset.label}: ${fmt(c.parsed.y||0)}` } } }, scales:{ y:{ ticks:{ callback:v=>fmtK(v) }, grid:{color:'#F1F5F9'} }, x:{ grid:{display:false} } } } });

  document.getElementById('budNote').innerHTML =
    `<b>Budget versions — not loaded.</b> The bars show this department's <em>actuals</em> through May plus a simple run-rate projection for the balance of year. `+
    `The AOP and reforecast versions (4+8, 6+6, 8+4) populate once approved budget figures are loaded to the database. The run-rate here is the interim baseline.`;
}

// ---- TAB 6: SCENARIO (workforce) -----------------------------------------
// Model workforce or vendor changes and see the monthly + annual impact.
// In-memory only (does not write to DB).
let scnMode = 'workforce';   // workforce | vendor
let scnAction = 'promote';   // promote | backfill | newreq | term
let scnEmpId = null;         // selected employee/position id
let scnDeltaPct = 10;        // promotion raise % (for promote)
let scnNewSalary = 120000;   // for new req / backfill salary
let scnDate = '2026-07-01';  // hire / promotion / term effective date
// vendor scenario
let scnVendorId = null;      // selected vendor line id
let scnVendorAction = 'cut'; // cut | increase | remove
let scnVendorPct = 10;       // cut/increase percent

const MONTH_FIRSTS = months.map((m,i)=>`2026-${String(i+1).padStart(2,'0')}-01`);
// month index (0-11) that an effective date falls in; clamped to the year
function effectiveMonthIdx(dateStr){
  if (!dateStr) return ACTUAL_MONTHS; // default June
  const d = new Date(dateStr+'T00:00:00');
  const idx = d.getMonth();
  return isNaN(idx) ? ACTUAL_MONTHS : Math.max(0, Math.min(11, idx));
}
// number of months from the effective month through December (inclusive)
function monthsRemaining(dateStr){ return 12 - effectiveMonthIdx(dateStr); }

// current monthly run-rate series for the active selection:
// actuals Jan-May, then YTD-average for Jun-Dec
function currentMonthlySeries(){
  return months.map((m,i)=> i<ACTUAL_MONTHS
    ? lineItems.reduce((s,l)=>s+l.actuals[i],0)
    : lineItems.reduce((s,l)=>s+avg(l.actuals),0));
}
// budget baseline series (derived from run-rate; flat YTD-average each month)
function budgetMonthlySeries(){
  const monthlyAvg = lineItems.reduce((s,l)=>s+avg(l.actuals),0);
  return months.map(()=> monthlyAvg);
}

// The scenario's monthly delta series (added to the current run-rate).
// Annual change is spread evenly across the affected months from the effective
// date forward, so an October change only moves Oct-Dec.
function scenarioMonthlySeries(annualDelta, dateStr){
  const startIdx = effectiveMonthIdx(dateStr);
  const perMonth = annualDelta / 12;        // annualized monthly rate
  return months.map((m,i)=> i>=startIdx ? perMonth : 0);
}

function renderScenario(){
  const active = employees.filter(e=>e.status==='active');
  const opens = employees.filter(e=>e.status==='open');
  const baselineComp = active.reduce((s,e)=>s+empAllIn(e),0);

  // ---- compute annual delta + label + detail for the active scenario ----
  let deltaLabel='Select a scenario', annualDelta=0, detail='', dateLabel='';
  if (scnMode==='workforce'){
    const emp = employees.find(e=>e.id===scnEmpId) || active[0] || opens[0];
    const rem = monthsRemaining(scnDate);
    const remNote = `Effective ${fmtDate(scnDate)} → ${rem} month${rem===1?'':'s'} this year.`;
    if (scnAction==='promote' && emp){
      const cur=empAllIn(emp); annualDelta = cur*(scnDeltaPct/100);
      deltaLabel = `Promote ${emp.name||emp.title}`;
      dateLabel='Promotion date';
      detail = `${escapeHtml(emp.name||emp.title)} +${scnDeltaPct}% (${fmt(cur)} → ${fmt(cur*(1+scnDeltaPct/100))} all-in). ${remNote}`;
    } else if (scnAction==='backfill' && emp){
      const cur=empAllIn(emp); annualDelta = scnNewSalary*1.1 - cur;
      deltaLabel = `Backfill ${emp.name||emp.title}`;
      dateLabel='Hire date';
      detail = `Replace ${escapeHtml(emp.name||emp.title)} (${fmt(cur)}) with a hire at ${fmt(scnNewSalary)} base. ${remNote}`;
    } else if (scnAction==='newreq'){
      annualDelta = scnNewSalary*1.1;
      deltaLabel = 'New requisition';
      dateLabel='Hire date';
      detail = `New position at ${fmt(scnNewSalary)} base (~${fmt(annualDelta)} loaded annual). ${remNote}`;
    } else if (scnAction==='term' && emp){
      annualDelta = -empAllIn(emp);
      deltaLabel = `Eliminate ${emp.name||emp.title}`;
      dateLabel='Term date';
      detail = `Remove ${escapeHtml(emp.name||emp.title)}: ${fmt(Math.abs(annualDelta))}/yr. ${remNote}`;
    }
  } else { // vendor
    const vlines = lineItems.filter(l=> l.vendor && l.vendor!=='Employees' && l.vendor!=='Consolidated' && l.cat!=='payroll' && l.cat!=='benefits')
      .sort((a,b)=>ytd(b.actuals)-ytd(a.actuals));
    const v = vlines.find(l=>l.id===scnVendorId) || vlines[0];
    const rem = monthsRemaining(scnDate);
    const remNote = `Effective ${fmtDate(scnDate)} → ${rem} month${rem===1?'':'s'} this year.`;
    if (v){
      const annualRunRate = avg(v.actuals)*12;  // this vendor's annualized spend
      if (scnVendorAction==='cut'){
        annualDelta = -annualRunRate*(scnVendorPct/100);
        deltaLabel = `Cut ${v.vendor} ${scnVendorPct}%`;
        detail = `Reduce ${escapeHtml(v.vendor)} (run-rate ${fmt(annualRunRate)}/yr) by ${scnVendorPct}%. ${remNote}`;
      } else if (scnVendorAction==='increase'){
        annualDelta = annualRunRate*(scnVendorPct/100);
        deltaLabel = `Increase ${v.vendor} ${scnVendorPct}%`;
        detail = `Increase ${escapeHtml(v.vendor)} (run-rate ${fmt(annualRunRate)}/yr) by ${scnVendorPct}%. ${remNote}`;
      } else { // remove
        annualDelta = -annualRunRate;
        deltaLabel = `Remove ${v.vendor}`;
        detail = `Eliminate ${escapeHtml(v.vendor)} entirely: ${fmt(annualRunRate)}/yr. ${remNote}`;
      }
    }
  }

  // ---- the three monthly series for the chart ----
  const curSeries = currentMonthlySeries();
  const budSeries = budgetMonthlySeries();
  const deltaSeries = scenarioMonthlySeries(annualDelta, scnDate);
  const scnSeries = curSeries.map((v,i)=> v + deltaSeries[i]);
  // annual (full-year) figures
  const curAnnual = curSeries.reduce((a,b)=>a+b,0);
  const scnAnnual = scnSeries.reduce((a,b)=>a+b,0);
  const yearImpact = scnAnnual - curAnnual;  // prorated impact this year

  const kpis = [
    { l:'Current Run-rate (FY)', v:fmt(curAnnual), s:'Full-year trajectory' },
    { l:'Scenario', v:deltaLabel, s:'Modeled change', txt:true },
    { l:'Impact This Year', v:(yearImpact>=0?'+':'')+fmt(yearImpact), s:'Prorated from effective date', cls:yearImpact>0?'dn':(yearImpact<0?'up':'') },
    { l:'Modeled Run-rate (FY)', v:fmt(scnAnnual), s:'After scenario' },
  ];
  document.getElementById('scnKpis').innerHTML = kpis.map(k=>
    `<div class="kpi"><div class="kpi-label">${k.l}</div><div class="kpi-val ${k.txt?'txt':''} ${k.cls||''}">${k.v}</div><div class="kpi-sub">${k.s}</div></div>`).join('');

  // ---- three-line chart ----
  destroyChart('scnChart');
  const cv = document.getElementById('scnChart');
  if (cv){
    charts.scnChart = new Chart(cv, { type:'line',
      data:{ labels:months.map(m=>m+" '26"), datasets:[
        { label:'Budget (baseline)', data:budSeries, borderColor:'#94A3B8', borderWidth:2, borderDash:[5,4], pointRadius:0, fill:false, tension:.2 },
        { label:'Current run-rate', data:curSeries, borderColor:'#1A56A0', backgroundColor:'rgba(26,86,160,0.06)', borderWidth:2.5, pointRadius:3, pointBackgroundColor:'#1A56A0', fill:false, tension:.2 },
        { label:'Scenario', data:scnSeries, borderColor:'#1A7A4A', borderWidth:2.5, borderDash:[6,3], pointRadius:3, pointBackgroundColor:'#1A7A4A', fill:false, tension:.2 },
      ]},
      options:{ responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{ position:'bottom', labels:{ boxWidth:10, padding:14, font:{size:11} } }, tooltip:{ callbacks:{ label:c=>`${c.dataset.label}: ${fmt(c.parsed.y)}` } } },
        scales:{ y:{ ticks:{ callback:v=>fmtK(v) }, grid:{color:'#F1F5F9'} }, x:{ grid:{display:false} } } } });
  }

  // ---- controls ----
  const ctrl = document.getElementById('scnControls');
  if (ctrl){
    const modeToggle = `
      <div class="scn-field"><label>Scenario area</label>
        <select onchange="scnSet('mode',this.value)">
          <option value="workforce" ${scnMode==='workforce'?'selected':''}>Workforce</option>
          <option value="vendor" ${scnMode==='vendor'?'selected':''}>Vendor</option>
        </select></div>`;
    let body='';
    if (scnMode==='workforce'){
      const empOptions = [...active, ...opens].map(e=>{
        const sel = employees.find(x=>x.id===scnEmpId) || active[0] || opens[0];
        return `<option value="${e.id}" ${e.id===(sel&&sel.id)?'selected':''}>${escapeHtml(e.name||('OPEN · '+e.title))}${e.title&&e.name?` · ${escapeHtml(e.title)}`:''}</option>`;
      }).join('');
      const needsEmp=(scnAction!=='newreq'), needsPct=(scnAction==='promote'), needsSalary=(scnAction==='backfill'||scnAction==='newreq');
      const dlabel = scnAction==='promote'?'Promotion date':scnAction==='term'?'Term date':'Hire date';
      body = `
        <div class="scn-field"><label>Scenario type</label>
          <select onchange="scnSet('action',this.value)">
            <option value="promote" ${scnAction==='promote'?'selected':''}>Promote an employee</option>
            <option value="backfill" ${scnAction==='backfill'?'selected':''}>Backfill a position</option>
            <option value="newreq" ${scnAction==='newreq'?'selected':''}>Open a new requisition</option>
            <option value="term" ${scnAction==='term'?'selected':''}>Eliminate a position</option>
          </select></div>
        ${needsEmp?`<div class="scn-field"><label>Employee / position</label><select onchange="scnSet('emp',this.value)">${empOptions}</select></div>`:''}
        ${needsPct?`<div class="scn-field"><label>Raise %</label><input type="number" value="${scnDeltaPct}" onchange="scnSet('pct',this.value)"></div>`:''}
        ${needsSalary?`<div class="scn-field"><label>New base salary</label><input type="number" value="${scnNewSalary}" onchange="scnSet('salary',this.value)"></div>`:''}
        <div class="scn-field"><label>${dlabel}</label><input type="date" value="${scnDate}" onchange="scnSet('date',this.value)"></div>`;
    } else {
      const vlines = lineItems.filter(l=> l.vendor && l.vendor!=='Employees' && l.vendor!=='Consolidated' && l.cat!=='payroll' && l.cat!=='benefits')
        .sort((a,b)=>ytd(b.actuals)-ytd(a.actuals));
      const selV = vlines.find(l=>l.id===scnVendorId) || vlines[0];
      const vOptions = vlines.map(l=>`<option value="${l.id}" ${l.id===(selV&&selV.id)?'selected':''}>${escapeHtml(l.vendor)} (${fmt(ytd(l.actuals))} YTD)</option>`).join('');
      const needsPct = (scnVendorAction!=='remove');
      body = `
        <div class="scn-field"><label>Vendor</label><select onchange="scnSet('vendor',this.value)">${vOptions||'<option>No vendors</option>'}</select></div>
        <div class="scn-field"><label>Change</label>
          <select onchange="scnSet('vaction',this.value)">
            <option value="cut" ${scnVendorAction==='cut'?'selected':''}>Cut spend</option>
            <option value="increase" ${scnVendorAction==='increase'?'selected':''}>Increase spend</option>
            <option value="remove" ${scnVendorAction==='remove'?'selected':''}>Remove vendor</option>
          </select></div>
        ${needsPct?`<div class="scn-field"><label>Percent</label><input type="number" value="${scnVendorPct}" onchange="scnSet('vpct',this.value)"></div>`:''}
        <div class="scn-field"><label>Effective date</label><input type="date" value="${scnDate}" onchange="scnSet('date',this.value)"></div>`;
    }
    ctrl.innerHTML = modeToggle + body;
  }
  const det = document.getElementById('scnDetail');
  if (det) det.innerHTML = detail
    ? `<b>Impact:</b> ${detail} In-session model only; it does not change saved data.`
    : `Pick a scenario to model the impact.`;
}

function scnSet(field, val){
  if (field==='mode') scnMode = val;
  else if (field==='action') scnAction = val;
  else if (field==='emp') scnEmpId = Number(val);
  else if (field==='pct') scnDeltaPct = Number(val)||0;
  else if (field==='salary') scnNewSalary = Number(String(val).replace(/[^0-9.]/g,''))||0;
  else if (field==='date') scnDate = val;
  else if (field==='vendor') scnVendorId = val;
  else if (field==='vaction') scnVendorAction = val;
  else if (field==='vpct') scnVendorPct = Number(val)||0;
  renderScenario();
}

// ---- EMPLOYEES (roster for Payroll + Scenario tabs) ----------------------
let employees = [];   // roster rows for the active department selection
async function loadEmployees(){
  employees = [];
  const codes = deptsForSelection(activeDept);
  try {
    const { data, error } = await sb.from('employees').select('*')
      .in('department', codes).order('id',{ascending:true});
    if (error) throw error;
    employees = data || [];
  } catch(e){ console.warn('employees load failed', e); employees = []; }
}
// loaded annual cost of an employee (salary + target bonus). Benefits handled at dept level.
function empAllIn(e){
  const base = Number(e.base_salary)||0;
  const bonus = base * (Number(e.bonus_pct)||0)/100;
  return base + bonus;
}
function fmtDate(d){ return d ? new Date(d+'T00:00:00').toLocaleDateString([], {month:'short',day:'numeric',year:'numeric'}) : '—'; }

// ---- TAB 7: SETTLEMENTS (Legal) -----------------------------------------
// A case/accrual tracker, editable by the legal team. Its own table, scoped
// by department like everything else. Settled cases sort to the bottom.
let settlements = [];               // loaded rows for the active department
const STATUS_LABELS = { initial:'Initial', in_progress:'In progress', settled:'Settled' };
const STATUS_ORDER = { initial:0, in_progress:1, settled:2 };

async function loadSettlements(){
  settlements = [];
  // settlements are a single-department concept; load for the codes in view
  const codes = deptsForSelection(activeDept);
  try {
    const { data, error } = await sb.from('settlements').select('*')
      .in('department', codes).order('created_at',{ascending:true});
    if (error) throw error;
    settlements = data || [];
  } catch(e){ console.warn('settlements load failed', e); settlements = []; }
}

function sortSettlements(list){
  // settled to the bottom; within a group, larger balance first (nulls last)
  return list.slice().sort((a,b)=>{
    const so = (STATUS_ORDER[a.status]??9) - (STATUS_ORDER[b.status]??9);
    if (so) return so;
    const av = a.balance==null ? -1 : a.balance;
    const bv = b.balance==null ? -1 : b.balance;
    return bv - av;
  });
}

function renderSettlements(){
  const tbody = document.getElementById('setTableBody');
  if (!tbody) return;
  const rows = sortSettlements(settlements);

  // KPIs: accrued balance (estimable + probable), open vs settled counts, untracked
  const accrued = rows.filter(r=>r.status!=='settled' && r.balance!=null).reduce((s,r)=>s+Number(r.balance),0);
  const openCount = rows.filter(r=>r.status!=='settled').length;
  const settledCount = rows.filter(r=>r.status==='settled').length;
  const notEstimable = rows.filter(r=>r.status!=='settled' && r.balance==null).length;
  const kpis = [
    { l:'Accrued Balance', v:fmt(accrued), s:'Estimable & probable · open cases' },
    { l:'Open Matters', v:openCount, s:notEstimable?`${notEstimable} not yet estimable`:'All estimable' },
    { l:'Settled Matters', v:settledCount, s:'Closed' },
    { l:'Total Matters', v:rows.length, s:'Tracked' },
  ];
  const kp = document.getElementById('setKpis');
  if (kp) kp.innerHTML = kpis.map(k=>`<div class="kpi"><div class="kpi-label">${k.l}</div><div class="kpi-val">${k.v}</div><div class="kpi-sub">${k.s}</div></div>`).join('');

  if (!rows.length){
    tbody.innerHTML = `<tr><td colspan="7" class="dim" style="padding:20px;text-align:center">No matters tracked yet. Use “Add matter” to enter the first case.</td></tr>`;
    return;
  }
  const statusSelect = (r) => `<select class="set-status" onchange="updateSettlement(${r.id},'status',this.value)">`+
    Object.keys(STATUS_LABELS).map(s=>`<option value="${s}" ${r.status===s?'selected':''}>${STATUS_LABELS[s]}</option>`).join('')+`</select>`;
  const balDisplay = (r) => r.balance==null
    ? `<span class="dim" title="Not yet estimable">Not estimable</span>`
    : fmt(Number(r.balance));
  tbody.innerHTML = rows.map(r=>{
    const settledCls = r.status==='settled' ? ' class="set-settled"' : '';
    return `<tr${settledCls}>
      <td><input class="set-inp" value="${escapeHtml(r.matter||'')}" onchange="updateSettlement(${r.id},'matter',this.value)"></td>
      <td><input class="set-inp" value="${escapeHtml(r.firm||'')}" onchange="updateSettlement(${r.id},'firm',this.value)" placeholder="Firm"></td>
      <td>${statusSelect(r)}</td>
      <td class="r"><input class="set-inp set-num" value="${r.balance==null?'':r.balance}" onchange="updateSettlement(${r.id},'balance',this.value)" placeholder="—" title="Leave blank if not estimable"></td>
      <td><input class="set-inp" value="${escapeHtml(r.note||'')}" onchange="updateSettlement(${r.id},'note',this.value)" placeholder="Note"></td>
      <td><input class="set-inp" value="${escapeHtml(r.review_notes||'')}" onchange="updateSettlement(${r.id},'review_notes',this.value)" placeholder="Review notes"></td>
      <td><button class="set-del" title="Remove matter" onclick="deleteSettlement(${r.id})">&times;</button></td>
    </tr>`;
  }).join('');
}

async function addSettlement(){
  const codes = deptsForSelection(activeDept);
  // write under the active single dept, or the user's home dept in a rollup view
  const dept = (activeDept && activeDept!=='__ALL__' && childrenOf(activeDept).length===0) ? activeDept : (codes[0] || homeDept);
  try {
    const { data, error } = await sb.from('settlements')
      .insert({ department:dept, matter:'New matter', status:'initial', balance:null }).select().single();
    if (error) throw error;
    settlements.push(data);
    renderSettlements();
    toast('Matter added');
  } catch(e){ console.warn('add settlement failed', e); toast('Could not add matter — check connection', true); }
}

async function updateSettlement(id, field, value){
  const row = settlements.find(r=>r.id===id);
  if (!row) return;
  let val = value;
  if (field==='balance'){
    const cleaned = String(value).replace(/[^0-9.\-]/g,'');
    val = cleaned==='' ? null : Number(cleaned);
  }
  row[field] = val;
  try {
    const { error } = await sb.from('settlements').update({ [field]:val, updated_at:new Date().toISOString() }).eq('id', id);
    if (error) throw error;
    // re-render if a change affects ordering (status or balance)
    if (field==='status' || field==='balance') renderSettlements();
  } catch(e){ console.warn('update settlement failed', e); toast('Save failed — check connection', true); }
}

async function deleteSettlement(id){
  const row = settlements.find(r=>r.id===id);
  if (!row) return;
  if (!confirm(`Remove "${row.matter||'this matter'}" from the tracker?`)) return;
  try {
    const { error } = await sb.from('settlements').delete().eq('id', id);
    if (error) throw error;
    settlements = settlements.filter(r=>r.id!==id);
    renderSettlements();
    toast('Matter removed');
  } catch(e){ console.warn('delete settlement failed', e); toast('Delete failed — check connection', true); }
}

const TAB_TITLES = {
  pnl:['Department P&L','Operating cost by category'],
  payroll:['Payroll','Labor cost and roster'],
  vendors:['Vendors','External vendor spend'],
  te:['Travel & Entertainment','T&E by GL line'],
  budget:['Budget','Actuals, run-rate and plan'],
  scenario:['Scenario','Plan to land on AOP'],
  settlements:['Settlements','Legal matters and accrual balances'],
};
let activeTab = 'pnl';

function showTab(name, el){
  activeTab = name;
  document.querySelectorAll('.tab,.nav-item[data-tab]').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll(`.tab[data-tab="${name}"],.nav-item[data-tab="${name}"]`).forEach(e=>e.classList.add('active'));
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  document.getElementById('panel-'+name).classList.add('active');
  // charts must render while visible
  renderActiveTab();
}

// render whichever tab is active (charts need to draw while the panel is shown)
function renderActiveTab(){
  switch(activeTab){
    case 'pnl': renderPnl(); renderPnlCharts(); break;
    case 'payroll': renderPayroll(); break;
    case 'vendors': renderVendors(); break;
    case 'te': renderTe(); break;
    case 'budget': renderBudget(); break;
    case 'scenario': renderScenario(); break;
    case 'settlements': renderSettlements(); break;
  }
}

// Department selector, hierarchy-aware.
//  admin: "All Departments" + each top-level department
//  multi-child head: their parent (consolidated) + each sub-department
//  leaf head: just their own department
function renderDeptSelector(){
  const sel = document.getElementById('deptSelect');
  if (!sel) return;
  const opt = selectorOptions();
  let opts = '';
  if (isAdminUser){
    opts += `<option value="__ALL__">All Departments · Consolidated</option>`;
    opt.items.forEach(d=>{
      const tag = childrenOf(d).length ? ' (rollup)' : '';
      opts += `<option value="${d}">${d} · ${deptName(d)}${tag}</option>`;
    });
  } else if (opt.showAll){
    // parent + children: parent option is the consolidated rollup
    const parent = opt.items[0];
    opts += `<option value="${parent}">${deptName(parent)} · Consolidated</option>`;
    opt.items.slice(1).forEach(d=> opts += `<option value="${d}">${d} · ${deptName(d)}</option>`);
  } else {
    const d = opt.items[0] || homeDept;
    opts = `<option value="${d}">${d} · ${deptName(d)}</option>`;
  }
  sel.innerHTML = opts;
  sel.value = activeDept;
  updateHeadings();
}

// is the current selection a consolidated/rollup view (vs a single leaf dept)?
function selectionIsRollup(){
  if (activeDept === '__ALL__') return true;
  return childrenOf(activeDept).length > 0;
}

function updateHeadings(){
  const rollup = selectionIsRollup();
  let scopeName;
  if (activeDept === '__ALL__') scopeName = isAdminUser ? 'All Departments · Consolidated' : 'Consolidated View';
  else if (rollup) scopeName = `${deptName(activeDept)} · Consolidated`;
  else scopeName = `${activeDept} · ${deptName(activeDept)}`;
  const t = TAB_TITLES[activeTab] || ['',''];
  const titleEl = document.getElementById('pageTitle'); if (titleEl) titleEl.textContent = t[0];
  const subEl = document.getElementById('pageSub');
  if (subEl) subEl.textContent = `${scopeName} · ${userIdentity.name}${userIdentity.title?', '+userIdentity.title:''} · May 2026 close`;
  const navLabel = document.getElementById('navDeptLabel');
  if (navLabel) navLabel.textContent = (activeDept === '__ALL__')
    ? (isAdminUser?'All Departments':'My Departments')
    : deptName(activeDept);
  const navRev = document.getElementById('navReviewer');
  if (navRev) navRev.textContent = `${shortName(userIdentity.name)}${userIdentity.title?', '+userIdentity.title:''}`;
}

// Settlements is Legal-only. Show the tab when Legal (3070) is in the current
// selection, hide it otherwise. If hidden while active, fall back to P&L.
function updateSettlementsTabVisibility(){
  const codes = deptsForSelection(activeDept);
  const showSet = codes.includes('3070');
  document.querySelectorAll('[data-tab="settlements"]').forEach(el=>{
    el.style.display = showSet ? '' : 'none';
  });
  if (!showSet && activeTab==='settlements'){ showTab('pnl'); }
}

async function switchDept(val){
  activeDept = val;
  applyActiveDept();
  await loadSettlements();
  await loadEmployees();
  renderDeptSelector();
  updateSettlementsTabVisibility();
  renderActiveTab();
}

async function renderDashboard(){
  await loadAll();
  await loadSettlements();
  await loadEmployees();
  renderDeptSelector();
  updateSettlementsTabVisibility();
  renderActiveTab();
}

// =============================================================
// AUTH GATE + INIT
// =============================================================
function showLogin(msg){
  const app = document.getElementById('appShell'); if (app) app.style.display='none';
  const login = document.getElementById('loginScreen'); if (login) login.style.display='flex';
  if (msg){ const e=document.getElementById('loginError'); if(e) e.textContent=msg; }
}

async function enterApp(session){
  const email = session?.user?.email || 'user';
  const namePart = email.split('@')[0];
  userIdentity = USER_IDENTITY[email.toLowerCase()] || { name: namePart.charAt(0).toUpperCase()+namePart.slice(1), title:'' };
  REVIEWER = userIdentity.name;
  await resolveDepartments(email);
  const tu=document.getElementById('topbarUser'); if(tu) tu.textContent=email;
  const ta=document.getElementById('topbarAvatar');
  if(ta) ta.textContent = userIdentity.name.split(/\s+/).map(p=>p[0]).slice(0,2).join('').toUpperCase();
  const login=document.getElementById('loginScreen'); if(login) login.style.display='none';
  const app=document.getElementById('appShell'); if(app) app.style.display='flex';
  try { await renderDashboard(); }
  catch(e){ console.error(e); setConn(false,'Load error'); toast('Could not load data — check the connection', true); }
}

async function doLogin(){
  const email = document.getElementById('loginEmail').value.trim();
  const pass = document.getElementById('loginPass').value;
  const btn = document.getElementById('loginBtn');
  const err = document.getElementById('loginError'); if(err) err.textContent='';
  if (!email || !pass){ if(err) err.textContent='Enter your email and password.'; return; }
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
    if (error) throw error;
    await enterApp(data.session);
  } catch(e){ if(err) err.textContent='Sign-in failed. Check your email and password.'; }
  finally { btn.disabled=false; btn.textContent='Sign in'; }
}

async function doSignOut(){
  try { await sb.auth.signOut(); } catch(e){}
  lineItems=[]; allLineItems=[]; visibleDepts=[]; activeDept=null;
  const le=document.getElementById('loginEmail'); if(le) le.value='';
  const lp=document.getElementById('loginPass'); if(lp) lp.value='';
  showLogin('You have been signed out.');
}

(async function boot(){
  if (!CONFIGURED){ showLogin('Backend not configured.'); const b=document.getElementById('loginBtn'); if(b) b.disabled=true; return; }
  const lb=document.getElementById('loginBtn'); if(lb) lb.addEventListener('click', doLogin);
  const lp=document.getElementById('loginPass'); if(lp) lp.addEventListener('keydown', e=>{ if(e.key==='Enter') doLogin(); });
  const le=document.getElementById('loginEmail'); if(le) le.addEventListener('keydown', e=>{ if(e.key==='Enter') document.getElementById('loginPass').focus(); });
  const so=document.getElementById('signOutBtn'); if(so) so.addEventListener('click', doSignOut);
  // segmented P&L view toggle
  document.querySelectorAll('#pnlSeg button').forEach(b=> b.addEventListener('click', ()=>{
    document.querySelectorAll('#pnlSeg button').forEach(x=>x.classList.remove('active'));
    b.classList.add('active'); pnlView=b.dataset.v; renderPnl();
  }));
  try {
    const { data } = await sb.auth.getSession();
    if (data && data.session){ await enterApp(data.session); } else { showLogin(); }
  } catch(e){ showLogin(); }
})();

window.addEventListener('resize', ()=>{ renderActiveTab(); });
