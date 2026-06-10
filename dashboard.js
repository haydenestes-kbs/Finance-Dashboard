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
const DEPT_NAMES = { '3020':'Financial Planning & Analysis','3040':'Information Technology','3041':'IT-Infrastructure','3042':'IT-Development','3070':'Legal','3906':'Sales & SAM','1020':'Field Ops Mgmt-LSS' };
function deptName(code){ return DEPT_NAMES[code] || code; }
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

// Which department codes are "children" we can drill into (everything except the
// synthetic consolidated bucket). Used to build the selector.
function drillDepts(){
  // departments that actually have data loaded
  const set = Array.from(new Set(allLineItems.map(l=>l.department)));
  set.sort();
  return set;
}

// Rebuild lineItems from allLineItems for the current activeDept.
// - single dept code: just that department's lines (full detail)
// - '__ALL__' consolidated: one synthetic line per category (rollup), no vendor detail
function applyActiveDept(){
  const depts = drillDepts();
  if (!activeDept){
    // default: consolidated if more than one dept, else the single dept
    activeDept = depts.length > 1 ? '__ALL__' : (depts[0] || homeDept);
  }
  if (activeDept === '__ALL__'){
    // category rollup across all visible depts
    const byCat = {};
    allLineItems.forEach(l=>{
      const c = byCat[l.cat] || (byCat[l.cat] = [0,0,0,0,0]);
      l.actuals.forEach((v,i)=> c[i]+=v);
    });
    lineItems = Object.keys(byCat).map((cat,idx)=>({
      id:`roll_${cat}`, label:(catMeta[cat]?catMeta[cat].label:cat), cat, vendor:'Consolidated',
      actuals:byCat[cat]
    }));
  } else {
    lineItems = allLineItems.filter(l=>l.department===activeDept).map(l=>({
      id:l.id, label:l.label, cat:l.cat, vendor:l.vendor, actuals:l.actuals.slice()
    }));
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

// Cost section grouping for the P&L. We hold operating-cost actuals only (no
// revenue feed yet), so the P&L is cost-focused: categories roll into COR/OpEx.
const COR_CATS  = ['payroll','benefits','service'];          // cost of revenue / direct delivery
const OPEX_CATS = ['prof','te','other'];                     // operating expenses
function sectionForCat(cat){ return COR_CATS.includes(cat) ? 'COR' : 'OPEX'; }

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
  const totA = corA+opexA, totB = corB+opexB;

  // KPIs: we have costs, not revenue, so frame around operating cost + variance.
  const per = view==='mtd' ? 'May 2026' : 'YTD Jan–May';
  const kpis = [
    { l:'Total Operating Cost', v:fmt(totA), s:per },
    { l:'Cost of Delivery', v:fmt(corA), s:`${totA?Math.round(corA/totA*100):0}% of cost` },
    { l:'Operating Expense', v:fmt(opexA), s:`${totA?Math.round(opexA/totA*100):0}% of cost` },
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
  const tv = totA-totB, tvc = tv<=0?'vneg':'vpos';
  h += `</tbody><tfoot><tr><td>Total Operating Cost</td><td class="r">${fmt(totA)}</td><td class="r">${fmt(totB)}</td><td class="r ${tvc}">${tv>=0?'+':''}${fmt(tv)}</td><td></td></tr></tfoot>`;
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
// We have payroll/benefits COST TOTALS (real), but no employee roster yet.
// Show the real cost totals; stub the roster with a connect-Workday note.
function renderPayroll(){
  const payLines = lineItems.filter(l=>l.cat==='payroll' || l.cat==='benefits');
  const payYtd = payLines.filter(l=>l.cat==='payroll').reduce((s,l)=>s+ytd(l.actuals),0);
  const benYtd = payLines.filter(l=>l.cat==='benefits').reduce((s,l)=>s+ytd(l.actuals),0);
  const payMay = payLines.filter(l=>l.cat==='payroll').reduce((s,l)=>s+l.actuals[CURRENT_MONTH_IDX],0);
  const loadedYtd = payYtd+benYtd;
  const kpis = [
    { l:'Payroll · May', v:fmt(payMay), s:'Salary, wages, OT' },
    { l:'Payroll · YTD', v:fmt(payYtd), s:'Jan–May' },
    { l:'Benefits & Taxes · YTD', v:fmt(benYtd), s:payYtd?`${Math.round(benYtd/payYtd*100)}% of payroll`:'—' },
    { l:'Loaded Labor · YTD', v:fmt(loadedYtd), s:'Payroll + benefits' },
  ];
  document.getElementById('payKpis').innerHTML = kpis.map(k=>
    `<div class="kpi"><div class="kpi-label">${k.l}</div><div class="kpi-val">${k.v}</div><div class="kpi-sub">${k.s}</div></div>`).join('');

  // Real monthly labor cost table (what we DO have)
  let rows = payLines.sort((a,b)=>ytd(b.actuals)-ytd(a.actuals)).map(l=>
    `<tr><td class="strong">${l.label}</td><td class="dim">${catMeta[l.cat]?catMeta[l.cat].label:l.cat}</td>`+
    l.actuals.map(v=>`<td class="r">${v?fmt(v):'<span class="dim">–</span>'}</td>`).join('')+
    `<td class="r strong">${fmt(ytd(l.actuals))}</td></tr>`).join('');
  document.getElementById('payTable').innerHTML =
    `<thead><tr><th>Labor Line</th><th>Category</th>${months.slice(0,ACTUAL_MONTHS).map(m=>`<th class="r">${m}</th>`).join('')}<th class="r">YTD</th></tr></thead><tbody>${rows||''}</tbody>`;

  // Roster stub — we have totals, not per-employee detail
  document.getElementById('payRosterNote').innerHTML =
    `<b>Employee roster — not connected.</b> This department's payroll <em>totals</em> above are live from the GL. `+
    `Per-employee detail (roster, hire/term dates, merit planning, headcount roll-forward) needs a feed from the HR system. `+
    `Once Workday or the payroll export is wired in, the roster and headcount roll-forward render here and drive the forecast.`;
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
  let h = `<thead><tr><th>Vendor</th><th>Category</th><th class="r">May</th><th class="r">YTD</th><th class="r">Run-rate</th></tr></thead><tbody>`;
  vlines.forEach(l=>{ const y=ytd(l.actuals);
    h += `<tr><td class="strong">${l.vendor}</td><td class="dim">${catMeta[l.cat]?catMeta[l.cat].label:l.cat}</td><td class="r">${fmt(l.actuals[CURRENT_MONTH_IDX])}</td><td class="r strong">${fmt(y)}</td><td class="r dim">${fmt(y/ACTUAL_MONTHS*12)}</td></tr>`; });
  h += `</tbody><tfoot><tr><td>Total</td><td></td><td class="r">${fmt(mtd)}</td><td class="r">${fmt(vYtd)}</td><td class="r">${fmt(vYtd/ACTUAL_MONTHS*12)}</td></tr></tfoot>`;
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

// ---- TAB 6: SCENARIO -----------------------------------------------------
// Needs a model + the FP&A agent. Honest stub describing what will live here.
function renderScenario(){
  const ytdActual = lineItems.reduce((s,l)=>s+ytd(l.actuals),0);
  const runRate = lineItems.reduce((s,l)=>s+ ytd(l.actuals) + avg(l.actuals)*(12-ACTUAL_MONTHS), 0);
  const kpis = [
    { l:'Full-Year Run-rate', v:fmt(runRate), s:'Current trajectory' },
    { l:'YTD Actual', v:fmt(ytdActual), s:'Jan–May' },
    { l:'AOP Plan', v:'Not loaded', s:'Needed for gap', cls:'fl' },
    { l:'Gap to Plan', v:'—', s:'Needs AOP', cls:'fl' },
  ];
  document.getElementById('scnKpis').innerHTML = kpis.map(k=>
    `<div class="kpi"><div class="kpi-label">${k.l}</div><div class="kpi-val ${k.cls||''}">${k.v}</div><div class="kpi-sub">${k.s}</div></div>`).join('');
  document.getElementById('scnNote').innerHTML =
    `<b>Scenario planning — coming next.</b> This tab will let a leader toggle cost levers (defer a hire, trim a vendor, hold T&E) to see the effect on the full-year landing versus AOP, `+
    `and surface anomalies the FP&A agent finds (double-counted spend, duplicate vendors). It needs the AOP loaded and the levers modeled. The run-rate above is the starting point.`;
}

// =============================================================
// TAB SWITCHING + DEPARTMENT SELECTOR (real backend)
// =============================================================
const TAB_TITLES = {
  pnl:['Department P&L','Operating cost by category'],
  payroll:['Payroll','Labor cost and roster'],
  vendors:['Vendors','External vendor spend'],
  te:['Travel & Entertainment','T&E by GL line'],
  budget:['Budget','Actuals, run-rate and plan'],
  scenario:['Scenario','Plan to land on AOP'],
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
  }
}

// Department selector (consolidated + drill), same model as before.
function renderDeptSelector(){
  const sel = document.getElementById('deptSelect');
  if (!sel) return;
  const depts = drillDepts();
  let opts = '';
  if (depts.length > 1){
    const consolLabel = isAdminUser ? 'Consolidated · all departments' : 'Consolidated · all my departments';
    opts += `<option value="__ALL__">${consolLabel}</option>`;
    depts.forEach(d=> opts += `<option value="${d}">${d} · ${deptName(d)}</option>`);
  } else {
    const d = depts[0] || homeDept;
    opts = `<option value="${d}">${d} · ${deptName(d)}</option>`;
  }
  sel.innerHTML = opts;
  sel.value = activeDept;
  updateHeadings();
}

function updateHeadings(){
  const isAll = activeDept === '__ALL__';
  const scopeName = isAll ? (isAdminUser ? 'All Departments · Consolidated' : 'Consolidated View') : `${activeDept} · ${deptName(activeDept)}`;
  // page title shows tab name; subtitle shows scope + identity
  const t = TAB_TITLES[activeTab] || ['',''];
  const titleEl = document.getElementById('pageTitle'); if (titleEl) titleEl.textContent = t[0];
  const subEl = document.getElementById('pageSub');
  if (subEl) subEl.textContent = `${scopeName} · ${userIdentity.name}${userIdentity.title?', '+userIdentity.title:''} · May 2026 close`;
  // sidebar department label
  const navLabel = document.getElementById('navDeptLabel');
  if (navLabel) navLabel.textContent = isAll ? (isAdminUser?'All Departments':'My Departments') : deptName(activeDept);
  const navRev = document.getElementById('navReviewer');
  if (navRev) navRev.textContent = `${shortName(userIdentity.name)}${userIdentity.title?', '+userIdentity.title:''}`;
}

async function switchDept(val){
  activeDept = val;
  applyActiveDept();
  renderDeptSelector();
  renderActiveTab();
}

async function renderDashboard(){
  await loadAll();
  renderDeptSelector();
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
