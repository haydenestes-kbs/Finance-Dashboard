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
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    CONFIGURED = true;
  }
} catch (e) { console.warn('Supabase init failed', e); }

let REVIEWER = 'Reviewer';   // set from the signed-in user's email after login

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
  const { data, error } = await sb.from('actuals').select('*').order('sort_order',{ascending:true});
  if (error) throw error;
  lineItems = (data||[]).map(r=>({
    id:r.id, label:r.label, cat:r.cat, vendor:r.vendor,
    actuals:[Number(r.jan),Number(r.feb),Number(r.mar),Number(r.apr),Number(r.may)]
  }));
  // recompute benefits ratio from real actuals
  const sal = (lineItems.find(l=>l.id==='salary')||{actuals:[0]}).actuals.reduce((a,b)=>a+b,0);
  const ben = (lineItems.find(l=>l.id==='benefits')||{actuals:[0]}).actuals.reduce((a,b)=>a+b,0)
            + (lineItems.find(l=>l.id==='anthem')||{actuals:[0]}).actuals.reduce((a,b)=>a+b,0);
  benefitsRatio = sal>0 ? ben/sal : 0.1395;
  buildHaydenLines();
}

async function loadAll(){
  // actuals first (everything else depends on them)
  await loadActuals();
  // forecast
  const { data: fcRow } = await sb.from('forecast').select('data').eq('reviewer','ben').maybeSingle();
  forecastState = { ...buildDefaultForecast(), ...(fcRow && fcRow.data ? fcRow.data : {}) };
  // comments
  const { data: cmts } = await sb.from('comments').select('*').order('created_at',{ascending:true});
  commentsState = {};
  (cmts||[]).forEach(c=>{
    (commentsState[c.cell_key] = commentsState[c.cell_key] || []).push(
      { id:c.id, author:c.author, text:c.body, ts:c.created_at });
  });
  setConn(true, 'Supabase · synced');
}

async function saveForecastCloud(){
  try {
    await sb.from('forecast').upsert(
      { reviewer:'ben', data:forecastState, updated_at:new Date().toISOString() },
      { onConflict:'reviewer' });
  } catch(e){ console.warn('forecast save failed', e); toast('Save failed — check connection', true); }
}

async function addCommentCloud(cellKey, body){
  const entry = { author:REVIEWER, text:body, ts:new Date().toISOString() };
  try {
    const { data, error } = await sb.from('comments')
      .insert({ cell_key:cellKey, author:REVIEWER, body }).select().single();
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
// =============================================================
function showTab(name, el){
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item[data-tab]').forEach(n=>n.classList.remove('active'));
  document.querySelectorAll(`.tab[data-tab="${name}"], .nav-item[data-tab="${name}"]`).forEach(e=>e.classList.add('active'));
  document.getElementById('panel-'+name).classList.add('active');
}

// =============================================================
// SPEND TAB
// =============================================================
let currentView = 'month';

function lineActual(l, view){
  return view==='month' ? l.actuals[CURRENT_MONTH_IDX] : ytd(l.actuals);
}
function lineBudget(l, view){
  const a = avg(l.actuals);
  return view==='month' ? a : a*ACTUAL_MONTHS;
}

function catTotals(view){
  const totals = {};
  lineItems.forEach(l=>{
    const c = l.cat;
    totals[c] = totals[c] || { actual:0, budget:0 };
    totals[c].actual += lineActual(l, view);
    totals[c].budget += lineBudget(l, view);
  });
  return totals;
}

function pctVar(actual, budget){
  if (budget === 0) return { txt:'—', cls:'fl' };
  const pct = ((actual-budget)/Math.abs(budget))*100;
  const cls = pct > 2 ? 'dn' : pct < -2 ? 'up' : 'fl';
  const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '—';
  return { txt:`${arrow} ${Math.abs(pct).toFixed(1)}% vs. budget`, cls };
}

function renderSpend(){
  const view = currentView;
  const allActual = lineItems.reduce((s,l)=>s+lineActual(l,view),0);
  const allBudget = lineItems.reduce((s,l)=>s+lineBudget(l,view),0);
  const payrollActual = lineItems.filter(l=>l.cat==='payroll'||l.cat==='benefits'||l.cat==='other')
    .reduce((s,l)=>s+lineActual(l,view),0);
  const nonPayroll = allActual - payrollActual;

  const periodLbl = view==='month' ? 'May 2026' : 'YTD Jan–May';
  const kpis = [
    { label:`Total Spend · ${view==='month'?'May':'YTD'}`, value:fmt(allActual), delta:pctVar(allActual,allBudget), sub:'All categories' },
    { label:'Payroll & Labor', value:fmt(payrollActual), delta:null, sub:'Salary, benefits, labor' },
    { label:'Non-Payroll', value:fmt(nonPayroll), delta:null, sub:'Vendors, service, T&E' },
    { label:'Over / (Under) Budget', value:fmt(allActual-allBudget), delta:pctVar(allActual,allBudget), sub:periodLbl },
  ];
  document.getElementById('kpiRow').innerHTML = kpis.map(k=>`
    <div class="kpi">
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-val">${k.value}</div>
      ${k.delta?`<div class="kpi-delta ${k.delta.cls}">${k.delta.txt}</div>`:'<div class="kpi-delta fl">&nbsp;</div>'}
      <div class="kpi-sub">${k.sub}</div>
    </div>`).join('');

  // Category table
  document.getElementById('catPeriodHead').textContent = view==='month' ? 'May 2026' : 'YTD';
  document.getElementById('catSub').textContent = view==='month' ? 'May 2026 · Actuals vs. Budget' : 'Year-to-Date · Jan–May 2026';
  const totals = catTotals(view);
  const cats = Object.keys(catMeta).filter(c=>totals[c]);
  document.getElementById('catCount').textContent = `${cats.length} categories`;
  let body='', tA=0, tB=0;
  cats.forEach(c=>{
    const t = totals[c]; tA+=t.actual; tB+=t.budget;
    const v = t.actual - t.budget;
    const overPct = t.budget ? (v/Math.abs(t.budget))*100 : 0;
    let sc,st;
    if (overPct>5){sc='brisk';st='Over';} else if(overPct<-5){sc='bok';st='Under';} else {sc='bmuted';st='On Plan';}
    const vc = v>0?'var-pos':v<0?'var-neg':'var-zero';
    body += `<tr>
      <td><span class="emp-name">${catMeta[c].label}</span></td>
      <td class="num strong">${fmt(t.actual)}</td>
      <td class="num dim">${fmt(t.budget)}</td>
      <td class="num ${vc}">${v>=0?'+':''}${fmt(v)}</td>
      <td><span class="badge ${sc}">${st}</span></td>
    </tr>`;
  });
  document.getElementById('catTableBody').innerHTML = body;
  document.getElementById('catTotalActual').textContent = fmt(tA);
  document.getElementById('catTotalBudget').textContent = fmt(tB);
  const tv = tA-tB, tvEl = document.getElementById('catTotalVar');
  tvEl.textContent = (tv>=0?'+':'')+fmt(tv);
  tvEl.className = 'num ' + (tv>0?'var-pos':'var-neg');

  // Vendor detail (non-Employees lines)
  document.getElementById('vendPeriodHead').textContent = view==='month'?'May 2026':'May 2026';
  const vlines = lineItems.filter(l=> l.vendor!=='Employees' && l.vendor!=='Other');
  let vbody='';
  vlines.forEach(l=>{
    vbody += `<tr>
      <td><span class="emp-name">${l.vendor}</span></td>
      <td class="dim">${l.label.split('·').pop().trim()}</td>
      <td class="num strong">${fmt(l.actuals[CURRENT_MONTH_IDX])}</td>
      <td class="num dim">${fmt(ytd(l.actuals))}</td>
    </tr>`;
  });
  document.getElementById('vendTableBody').innerHTML = vbody;
}

// =============================================================
// CHARTS
// =============================================================
Chart.defaults.font.family = "'DM Sans', sans-serif";
Chart.defaults.color = '#64748B';
Chart.defaults.borderColor = '#E2E8F0';
let mixChart, trendChart, teTrendChart, teCategoryChart, forecastChart;

function renderMix(){
  const totals = catTotals('ytd');
  const labels = Object.keys(catMeta).filter(c=>totals[c]);
  const data = labels.map(c=>totals[c].actual);
  const colorMap = { payroll:'#1A56A0', benefits:'#2E6FCC', service:'#1A7A4A', prof:'#6B21A8', te:'#B91C1C', other:'#B45309' };
  if (mixChart) mixChart.destroy();
  mixChart = new Chart(document.getElementById('mixChart'), {
    type:'doughnut',
    data:{ labels:labels.map(c=>catMeta[c].label), datasets:[{ data, backgroundColor:labels.map(c=>colorMap[c]), borderColor:'#fff', borderWidth:2 }] },
    options:{ responsive:true, maintainAspectRatio:false, cutout:'62%',
      plugins:{ legend:{ position:'bottom', labels:{ boxWidth:9, boxHeight:9, padding:10, font:{size:10} } },
        tooltip:{ callbacks:{ label:(c)=>`${c.label}: ${fmt(c.parsed)}` } } } }
  });
}

function monthlyTotals(){
  return months.slice(0,ACTUAL_MONTHS).map((m,i)=> lineItems.reduce((s,l)=>s+l.actuals[i],0));
}

function renderTrend(){
  const data = monthlyTotals();
  if (trendChart) trendChart.destroy();
  trendChart = new Chart(document.getElementById('trendChart'), {
    type:'bar',
    data:{ labels:months.slice(0,ACTUAL_MONTHS), datasets:[{ label:'Total Spend', data, backgroundColor:'#1A56A0', borderRadius:4, barThickness:36 }] },
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:(c)=>fmt(c.parsed.y) } } },
      scales:{ y:{ ticks:{ callback:(v)=>fmtK(v) }, grid:{color:'#F1F5F9'} }, x:{ grid:{display:false} } } }
  });
}

// =============================================================
// T&E TAB  (accounts 60301–60304)
// =============================================================
const teLineIds = ['travel','mileage_e','mileage_m','meals','parking'];
function renderTE(){
  const A = id => (lineItems.find(l=>l.id===id) || {actuals:[0,0,0,0,0]}).actuals;
  const teLines = lineItems.filter(l=>teLineIds.includes(l.id));
  // collapse the two mileage lines into one display row
  const mileE = A('mileage_e'), mileM = A('mileage_m');
  const display = [
    { label:'60301 · Travel', vals: A('travel') },
    { label:'60302 · Mileage Reimbursement', vals: mileE.map((v,i)=> v + (mileM[i]||0)) },
    { label:'60303 · Meals / Ent', vals: A('meals') },
    { label:'60304 · Parking', vals: A('parking') },
  ];
  let body='';
  display.forEach(d=>{
    const total = ytd(d.vals);
    body += `<tr>
      <td><span class="emp-name">${d.label}</span></td>
      ${d.vals.map(v=>`<td class="num">${v===0?'<span class="dim">–</span>':fmt(v)}</td>`).join('')}
      <td class="num strong">${fmt(total)}</td>
    </tr>`;
  });
  document.getElementById('teTableBody').innerHTML = body;

  const teYtd = teLines.reduce((s,l)=>s+ytd(l.actuals),0);
  // T&E budget baseline = avg monthly of the YTD T&E run-rate
  const teBudgetYtd = Math.round(teYtd); // budget == actual baseline since these are the source numbers
  document.getElementById('teYtdTotal').textContent = fmt(teYtd);
  document.getElementById('teBudget').textContent = fmt(teBudgetYtd);
  document.getElementById('teBudgetSub').textContent = 'YTD baseline · Jan–May';
  const v = teYtd - teBudgetYtd;
  document.getElementById('teVariance').textContent = (v>=0?'+':'')+fmt(v);
  document.getElementById('teVarDelta').innerHTML = v>0?'<span class="dn">▲ Over baseline</span>':'<span class="up">▼ On baseline</span>';
  // largest line
  const sorted = display.map(d=>({label:d.label, total:ytd(d.vals)})).sort((a,b)=>b.total-a.total);
  document.getElementById('teTopLine').textContent = sorted[0].label.split('·').pop().trim();
  document.getElementById('teTopAmt').textContent = fmt(sorted[0].total)+' YTD';

  renderTETrend(display);
  renderTECategory(display);
}

function renderTETrend(display){
  const monthly = months.slice(0,ACTUAL_MONTHS).map((m,i)=> display.reduce((s,d)=>s+d.vals[i],0));
  if (teTrendChart) teTrendChart.destroy();
  teTrendChart = new Chart(document.getElementById('teTrendChart'), {
    type:'line',
    data:{ labels:months.slice(0,ACTUAL_MONTHS), datasets:[{ label:'Actual T&E', data:monthly, borderColor:'#1A56A0', backgroundColor:'rgba(26,86,160,0.08)', fill:true, tension:0.3, pointRadius:4, pointBackgroundColor:'#1A56A0', pointBorderColor:'#fff', pointBorderWidth:2, borderWidth:2 }] },
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:(c)=>fmt(c.parsed.y) } } },
      scales:{ y:{ ticks:{ callback:(v)=>fmtK(v) }, grid:{color:'#F1F5F9'}, beginAtZero:true }, x:{ grid:{display:false} } } }
  });
}

function renderTECategory(display){
  const labels = display.map(d=>d.label.split('·').pop().trim());
  const data = display.map(d=>ytd(d.vals));
  const colors = ['#1A56A0','#1A7A4A','#6B21A8','#B45309'];
  if (teCategoryChart) teCategoryChart.destroy();
  teCategoryChart = new Chart(document.getElementById('teCategoryChart'), {
    type:'bar',
    data:{ labels, datasets:[{ data, backgroundColor:colors, borderRadius:4, barThickness:22 }] },
    options:{ responsive:true, maintainAspectRatio:false, indexAxis:'y',
      plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:(c)=>fmt(c.parsed.x) } } },
      scales:{ x:{ ticks:{ callback:(v)=>fmtK(v) }, grid:{color:'#F1F5F9'} }, y:{ grid:{display:false} } } }
  });
}

// =============================================================
// FORECAST EDITOR  (line × month grid, editable Jun–Dec, comments per cell)
// =============================================================
const forecastRows = [
  { section:'Payroll & Benefits' },
  'salary','hayden_salary','benefits','hayden_benefits','anthem',
  { section:'Service & Professional Fees' },
  'ccsi','accordion','shankly',
  { section:'Travel & Entertainment' },
  'travel','mileage_e','mileage_m','meals','parking',
  { section:'Other Labor & Supplies' },
  'fed_unemp','hourly','overtime','bonus','vacation','supplies',
];

function lineById(id){
  return lineItems.find(l=>l.id===id) || haydenLines.find(l=>l.id===id);
}

function cellKey(lineId, monthIdx){ return `forecast|${lineId}|${monthIdx}`; }
function cellCommentCount(lineId, monthIdx){ return (commentsState[cellKey(lineId,monthIdx)]||[]).length; }

function renderForecastTable(){
  const tbl = document.getElementById('forecastTable');
  let head = `<thead><tr><th class="lbl-h">Line Item</th>`;
  months.forEach((m,i)=>{
    const isA = i<ACTUAL_MONTHS;
    head += `<th class="${isA?'actual-h':'fcst-h'}">${m}${isA?'':' ⋯'}</th>`;
  });
  head += `<th class="fcst-h">FY Total</th></tr></thead>`;

  let bodyRows = '';
  forecastRows.forEach(row=>{
    if (typeof row === 'object'){
      bodyRows += `<tr class="row-section"><td colspan="14">${row.section}</td></tr>`;
      return;
    }
    const id = row;
    const l = lineById(id);
    if (!l) return;
    const vals = forecastState[id] || [];
    const isHayden = l.hayden;
    let rowHtml = `<tr class="${isHayden?'row-hayden':''}"><td class="lbl">${l.label}</td>`;
    let total = 0;
    months.forEach((m,i)=>{
      const v = vals[i] || 0; total += v;
      const isA = i<ACTUAL_MONTHS;
      const cc = cellCommentCount(id,i);
      const dot = cc>0 ? `<span class="cmt-dot" title="${cc} comment(s)" onclick="openComment('${id}',${i},event)"></span>` : '';
      const trig = `<svg class="cmt-trigger" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" onclick="openComment('${id}',${i},event)"><path d="M2 3h12v8H6l-3 3V3z"/></svg>`;
      if (isA){
        rowHtml += `<td class="actual-cell">${v===0?'<span style="color:#CBD5E1">–</span>':fmt(v)}${dot}${trig}</td>`;
      } else {
        rowHtml += `<td class="fcst-cell"><input class="fcst-input" type="text" data-line="${id}" data-month="${i}" value="${v}">${dot}${trig}</td>`;
      }
    });
    rowHtml += `<td class="actual-cell strong" style="font-weight:500;color:var(--text)">${fmt(total)}</td></tr>`;
    bodyRows += rowHtml;
  });

  // totals footer
  let footCols = '';
  let grand = 0;
  months.forEach((m,i)=>{
    const colTotal = forecastRows.filter(r=>typeof r==='string').reduce((s,id)=> s + ((forecastState[id]||[])[i]||0), 0);
    grand += colTotal;
    footCols += `<td>${fmt(colTotal)}</td>`;
  });
  const foot = `<tfoot><tr><td class="lbl">Total Department</td>${footCols}<td>${fmt(grand)}</td></tr></tfoot>`;

  tbl.innerHTML = head + '<tbody>' + bodyRows + '</tbody>' + foot;

  // wire inputs
  tbl.querySelectorAll('.fcst-input').forEach(inp=>{
    inp.addEventListener('focus', e=>{
      const v = parseInt(String(e.target.value).replace(/[^0-9\-]/g,''));
      if(!isNaN(v)) e.target.value = v;
    });
    inp.addEventListener('blur', async e=>{
      const id = e.target.dataset.line, mi = parseInt(e.target.dataset.month);
      const v = parseInt(String(e.target.value).replace(/[^0-9\-]/g,'')) || 0;
      forecastState[id][mi] = v;
      await saveForecastCloud();
      renderForecastTable();
      renderForecastKPIs();
      renderForecastChart();
    });
    inp.addEventListener('keydown', e=>{ if(e.key==='Enter') e.target.blur(); });
  });
}

function forecastLineYTD(id){ return (forecastState[id]||[]).slice(0,ACTUAL_MONTHS).reduce((a,b)=>a+b,0); }
function forecastLineFwd(id){ return (forecastState[id]||[]).slice(ACTUAL_MONTHS).reduce((a,b)=>a+b,0); }

function renderForecastKPIs(){
  const allIds = forecastRows.filter(r=>typeof r==='string');
  const total = allIds.reduce((s,id)=> s + (forecastState[id]||[]).reduce((a,b)=>a+b,0), 0);
  const ytdActual = allIds.reduce((s,id)=> s + forecastLineYTD(id), 0);
  const fwd = allIds.reduce((s,id)=> s + forecastLineFwd(id), 0);
  const haydenTotal = haydenLines.reduce((s,l)=> s + forecastLineFwd(l.id), 0);
  document.getElementById('fcTotal').textContent = fmt(total);
  document.getElementById('fcYtd').textContent = fmt(ytdActual);
  document.getElementById('fcRemaining').textContent = fmt(fwd);
  document.getElementById('fcHayden').textContent = fmt(haydenTotal);
}

function renderForecastChart(){
  if (forecastChart) forecastChart.destroy();
  const allIds = forecastRows.filter(r=>typeof r==='string');
  const monthTotals = months.map((m,i)=> allIds.reduce((s,id)=> s + ((forecastState[id]||[])[i]||0), 0));
  const actualData = monthTotals.map((v,i)=> i<ACTUAL_MONTHS ? v : null);
  const forecastData = monthTotals.map((v,i)=> i>=ACTUAL_MONTHS-1 ? v : null);
  forecastChart = new Chart(document.getElementById('forecastChart'), {
    type:'line',
    data:{ labels:months.map(m=>m+" '26"), datasets:[
      { label:'Actual', data:actualData, borderColor:'#1A56A0', backgroundColor:'rgba(26,86,160,0.08)', fill:true, tension:0.2, pointRadius:4, pointBackgroundColor:'#1A56A0', pointBorderColor:'#fff', pointBorderWidth:2, borderWidth:2.5 },
      { label:'Forecast', data:forecastData, borderColor:'#2E6FCC', backgroundColor:'rgba(46,111,204,0.05)', fill:true, tension:0.2, pointRadius:4, pointBackgroundColor:'#2E6FCC', pointBorderColor:'#fff', pointBorderWidth:2, borderWidth:2.5, borderDash:[5,4] }
    ]},
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ position:'bottom', labels:{ boxWidth:10, padding:14, font:{size:11} } },
        tooltip:{ callbacks:{ label:(c)=> c.parsed.y===null?'':`${c.dataset.label}: ${fmt(c.parsed.y)}` } } },
      scales:{ y:{ ticks:{ callback:(v)=>fmtK(v) }, grid:{color:'#F1F5F9'}, beginAtZero:false }, x:{ grid:{display:false} } } }
  });
}

function renderForecast(){
  renderForecastTable();
  renderForecastKPIs();
  renderForecastChart();
}

// =============================================================
// COMMENTS POPOVER
// =============================================================
let activeCellKey = null;

function openComment(lineId, monthIdx, ev){
  if (ev) ev.stopPropagation();
  const l = lineById(lineId);
  activeCellKey = cellKey(lineId, monthIdx);
  document.getElementById('cmtPopTitle').textContent = l ? l.label : 'Comment';
  document.getElementById('cmtPopSub').textContent = `${months[monthIdx]} 2026 · ${monthIdx<ACTUAL_MONTHS?'Actual':'Forecast'}`;
  renderCommentList();
  document.getElementById('cmtInput').value = '';

  const overlay = document.getElementById('cmtOverlay');
  overlay.classList.add('show');
  // position popover near the clicked cell
  const pop = document.getElementById('cmtPop');
  const rect = (ev && ev.target.closest('td')) ? ev.target.closest('td').getBoundingClientRect() : {left:window.innerWidth/2-150, bottom:200};
  let left = rect.left;
  let top = rect.bottom + 6;
  if (left + 300 > window.innerWidth - 12) left = window.innerWidth - 312;
  if (left < 12) left = 12;
  if (top + 320 > window.innerHeight) top = Math.max(12, rect.top - 326);
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
  setTimeout(()=>document.getElementById('cmtInput').focus(), 50);
}

function renderCommentList(){
  const list = commentsState[activeCellKey] || [];
  const el = document.getElementById('cmtList');
  if (list.length === 0){
    el.innerHTML = '<div class="cmt-empty">No comments yet. Add context or a proposed adjustment below.</div>';
    return;
  }
  el.innerHTML = list.map((c,i)=>`
    <div class="cmt-item">
      <div class="cmt-item-top">
        <span class="cmt-author">${c.author}</span>
        <span class="cmt-time">${new Date(c.ts).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</span>
      </div>
      <div class="cmt-text">${escapeHtml(c.text)}</div>
      <button class="cmt-del" onclick="removeComment(${i})">Delete</button>
    </div>`).join('');
}

function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

async function submitComment(){
  const txt = document.getElementById('cmtInput').value.trim();
  if (!txt || !activeCellKey) return;
  const btn = document.getElementById('cmtSaveBtn');
  btn.disabled = true;
  await addCommentCloud(activeCellKey, txt);
  btn.disabled = false;
  document.getElementById('cmtInput').value = '';
  renderCommentList();
  renderForecastTable();   // refresh comment dots
  toast('Comment added');
}

async function removeComment(idx){
  await deleteCommentCloud(activeCellKey, idx);
  renderCommentList();
  renderForecastTable();
}

function closeComment(ev){
  if (ev && ev.target.id !== 'cmtOverlay') return;
  document.getElementById('cmtOverlay').classList.remove('show');
  activeCellKey = null;
}
document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeComment({target:{id:'cmtOverlay'}}); });

// =============================================================
// ORG CHART  — Ben Fremont, VP FP&A
// =============================================================
function renderOrg(){
  const tree = document.getElementById('orgTree');
  tree.innerHTML = `
    <div class="org-node exec">
      <div class="org-node-role">VP · Financial Planning &amp; Analysis</div>
      <div class="org-node-name">Ben Fremont</div>
      <div class="org-node-meta">Team Lead · 7 direct reports</div>
    </div>
    <div class="org-connector"></div>
    <div class="org-section-label">Direct Reports</div>
    <div class="org-hbar-wrap"></div>
    <div style="height:14px"></div>

    <div class="org-row">

      <!-- 1. Joshua Ritch -->
      <div class="org-branch">
        <div class="org-node lead">
          <div class="org-node-role">Finance Manager</div>
          <div class="org-node-name">Joshua Ritch</div>
        </div>
      </div>

      <!-- 2. Timothy Moynihan + 2 analysts -->
      <div class="org-branch">
        <div class="org-node lead">
          <div class="org-node-role">Finance Manager</div>
          <div class="org-node-name">Timothy Moynihan</div>
          <div class="org-node-meta">2 reports</div>
        </div>
        <div class="org-connector"></div>
        <div class="org-sub">
          <div class="org-node sub">
            <div class="org-node-role">Financial Analyst</div>
            <div class="org-node-name">Emiliano Godinez Berlin</div>
          </div>
          <div class="org-node sub">
            <div class="org-node-role">Financial Analyst</div>
            <div class="org-node-name">Justice Perez</div>
          </div>
        </div>
      </div>

      <!-- 3. Christine Pacheco -->
      <div class="org-branch">
        <div class="org-node">
          <div class="org-node-role">Sr. Financial Analyst</div>
          <div class="org-node-name">Christine Pacheco</div>
        </div>
      </div>

      <!-- 4. Jordan Camenson + 1 analyst -->
      <div class="org-branch">
        <div class="org-node lead">
          <div class="org-node-role">Finance Manager</div>
          <div class="org-node-name">Jordan Camenson</div>
          <div class="org-node-meta">1 report</div>
        </div>
        <div class="org-connector"></div>
        <div class="org-sub">
          <div class="org-node sub">
            <div class="org-node-role">Financial Analyst</div>
            <div class="org-node-name">Pindaro Medina</div>
          </div>
        </div>
      </div>

    </div>

    <div style="height:16px"></div>
    <div class="org-row">
      <!-- 5. Billy Flynn -->
      <div class="org-branch">
        <div class="org-node">
          <div class="org-node-role">Financial Analyst</div>
          <div class="org-node-name">Billy Flynn</div>
        </div>
      </div>

      <!-- 6. CCSI Team -->
      <div class="org-branch">
        <div class="org-node lead">
          <div class="org-node-role">CCSI Team</div>
          <div class="org-node-name">Call Center Services Intl</div>
          <div class="org-node-meta">2 analysts</div>
        </div>
        <div class="org-connector"></div>
        <div class="org-sub">
          <div class="org-node sub">
            <div class="org-node-role">Financial Analyst</div>
            <div class="org-node-name">Jorge Cadena</div>
          </div>
          <div class="org-node sub">
            <div class="org-node-role">Financial Analyst</div>
            <div class="org-node-name">Pedro Fernandez</div>
          </div>
        </div>
      </div>

      <!-- 7. Hayden Estes - incoming -->
      <div class="org-branch">
        <div class="org-node incoming">
          <div class="org-node-date">Starts May 31, 2026</div>
          <div class="org-node-role">Director · Finance Transformation</div>
          <div class="org-node-name">Hayden Estes</div>
          <div class="org-node-meta">Incoming hire</div>
        </div>
      </div>
    </div>
  `;
}

// =============================================================
// EXPORT SNAPSHOT (JSON download of forecast + comments)
// =============================================================
function exportSnapshot(){
  const snap = {
    generated: new Date().toISOString(),
    reviewer: REVIEWER,
    forecast: forecastState,
    comments: commentsState,
  };
  const blob = new Blob([JSON.stringify(snap, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `KBS_FPA_forecast_review_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Snapshot exported');
}

// =============================================================
// BUTTON WIRING
// =============================================================
document.querySelectorAll('#viewToggle button').forEach(b=>{
  b.addEventListener('click', ()=>{
    document.querySelectorAll('#viewToggle button').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    currentView = b.dataset.view;
    renderSpend();
  });
});

document.getElementById('resetForecast').addEventListener('click', async ()=>{
  if(!confirm('Reset all forecast months to the YTD baseline? This clears your forecast edits (comments are kept).')) return;
  forecastState = buildDefaultForecast();
  await saveForecastCloud();
  renderForecast();
  toast('Forecast reset to baseline');
});

document.getElementById('saveForecast').addEventListener('click', async ()=>{
  await saveForecastCloud();
  toast('Saved to cloud · notification sent');
});

document.getElementById('exportBtn').addEventListener('click', exportSnapshot);

// =============================================================
// AUTH GATE + INIT
// =============================================================
function showLogin(msg){
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
  if (msg) document.getElementById('loginError').textContent = msg;
}

async function renderDashboard(){
  await loadAll();
  renderSpend();
  renderMix();
  renderTrend();
  renderTE();
  renderForecast();
  renderOrg();
}

async function enterApp(session){
  // set reviewer identity from the signed-in email
  const email = session?.user?.email || 'user';
  const namePart = email.split('@')[0];
  REVIEWER = namePart.charAt(0).toUpperCase() + namePart.slice(1); // e.g. "Ben"
  document.getElementById('topbarUser').textContent = email;
  document.getElementById('topbarAvatar').textContent = namePart.slice(0,2).toUpperCase();
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appShell').style.display = 'flex';
  try {
    await renderDashboard();
  } catch(e){
    console.error(e);
    setConn(false, 'Load error');
    toast('Could not load data — check that the schema was run', true);
  }
}

async function doLogin(){
  const email = document.getElementById('loginEmail').value.trim();
  const pass = document.getElementById('loginPass').value;
  const btn = document.getElementById('loginBtn');
  document.getElementById('loginError').textContent = '';
  if (!email || !pass){ document.getElementById('loginError').textContent = 'Enter your email and password.'; return; }
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
    if (error) throw error;
    await enterApp(data.session);
  } catch(e){
    document.getElementById('loginError').textContent = 'Sign-in failed. Check your email and password.';
  } finally {
    btn.disabled = false; btn.textContent = 'Sign in';
  }
}

async function doSignOut(){
  try { await sb.auth.signOut(); } catch(e){}
  // wipe in-memory data so nothing lingers
  forecastState = {}; commentsState = {}; lineItems = [];
  document.getElementById('loginEmail').value = '';
  document.getElementById('loginPass').value = '';
  showLogin('You have been signed out.');
}

(async function boot(){
  if (!CONFIGURED){
    showLogin('Backend not configured. Add your Supabase URL and key in dashboard.js.');
    document.getElementById('loginBtn').disabled = true;
    return;
  }
  // wire login controls
  document.getElementById('loginBtn').addEventListener('click', doLogin);
  document.getElementById('loginPass').addEventListener('keydown', e=>{ if(e.key==='Enter') doLogin(); });
  document.getElementById('loginEmail').addEventListener('keydown', e=>{ if(e.key==='Enter') document.getElementById('loginPass').focus(); });
  document.getElementById('signOutBtn').addEventListener('click', doSignOut);

  // restore an existing session if present, else show login
  try {
    const { data } = await sb.auth.getSession();
    if (data && data.session){ await enterApp(data.session); }
    else { showLogin(); }
  } catch(e){ showLogin(); }
})();
