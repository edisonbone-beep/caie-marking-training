// ============================================================
// SUPABASE
// ============================================================
var SUPABASE_URL = 'https://kyhbgkfetxmqtegjhqsz.supabase.co';
var SUPABASE_KEY = 'sb_publishable_70RLAQJoYff_ie2dtXX0aw_i1aqZFoB';
var supabase;
try {
  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
} catch(e) {
  console.error('Supabase init error:', e);
  supabase = null;
}

// ============================================================
// DATA LAYER (Supabase / 国内 API 双模式)
// 部署国内服务器后：USE_DOMESTIC_API 改 true，填上域名即可切换
// ============================================================
var USE_DOMESTIC_API = false;
var DOMESTIC_API = '';   // 例如 'https://www.yourdomain.com/api'

async function apiFetchResults() {
  if (USE_DOMESTIC_API) {
    var resp = await fetch(DOMESTIC_API + '/results', {
      headers: { 'x-admin-password': ADMIN_PWD }
    });
    if (resp.status === 401) throw new Error('unauthorized');
    if (!resp.ok) throw new Error('API error ' + resp.status);
    return await resp.json();
  }
  if (!supabase) throw new Error('Database not connected');
  var r = await supabase.from('marking_results').select('*').order('created_at', { ascending: false });
  if (r.error) throw new Error(r.error.message);
  return r.data || [];
}

async function apiInsertResult(rec) {
  if (USE_DOMESTIC_API) {
    var resp = await fetch(DOMESTIC_API + '/results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rec)
    });
    if (!resp.ok) console.error('API save error:', resp.status);
    return;
  }
  var r = await supabase.from('marking_results').insert(rec);
  if (r.error) console.error('Supabase save error:', r.error);
}

async function apiCheckAdminPassword(pwd) {
  if (USE_DOMESTIC_API) {
    try {
      var resp = await fetch(DOMESTIC_API + '/auth', {
        headers: { 'x-admin-password': pwd }
      });
      return resp.ok;
    } catch(e) {
      return null; // 网络错误
    }
  }
  return pwd === ADMIN_PWD;
}

// ============================================================
// STATE
// ============================================================
var currentUser = '';
var currentPaper = null;
var currentScript = null;
var timerInterval = null;
var timerSeconds = 0;
var questionScores = {};
var isAdmin = false;

// ============================================================
// LOGIN
// ============================================================
function doLogin() {
  const name = document.getElementById('nameInput').value.trim();
  if (!name) { alert('Please enter your name'); return; }
  currentUser = name;
  isAdmin = false;
  currentSubject = 'Physics';
  showSelectionPage();
}

document.getElementById('nameInput').addEventListener('keypress', function(e) {
  if (e.key === 'Enter') doLogin();
});

// ============================================================
// SELECTION PAGE
// ============================================================
function showSelectionPage() {
  hideAll();
  document.getElementById('selectionPage').classList.remove('hidden');
  document.getElementById('userInfo').textContent = currentUser;
  renderSelection();
}

function extractPaperNum(paperStr) {
  var m = paperStr.match(/Paper\s*(\d)/);
  return m ? m[1] : '?';
}

function renderScriptButtons(p) {
  var html = '<div class="script-list">';
  for (var sid of Object.keys(p.scripts)) {
    var doneKey = 'done_' + currentUser + '_' + p.key + '_' + sid;
    var isDone = localStorage.getItem(doneKey) === 'true';
    html += '<button class="script-btn ' + (isDone ? 'done' : '') + '" onclick="startMarking(\'' + p.key + '\', \'' + sid + '\')">Script ' + sid + (isDone ? ' \u2713' : '') + '</button>';
  }
  html += '</div>';
  return html;
}

var ALL_SUBJECTS = [
  { name: 'Physics', hasData: true },
  { name: 'Mathematics', hasData: false },
  { name: 'Chemistry', hasData: false },
  { name: 'Biology', hasData: false },
  { name: 'Economics', hasData: false }
];
var currentSubject = 'Physics';

function renderSelection() {
  // Render subject tabs
  var tabsEl = document.getElementById('subjectTabs');
  var tabsHtml = '';
  for (var si = 0; si < ALL_SUBJECTS.length; si++) {
    var s = ALL_SUBJECTS[si];
    var cls = 'subject-tab';
    if (s.name === currentSubject) cls += ' active';
    if (!s.hasData && !isAdmin) cls += ' disabled-tab';
    tabsHtml += '<div class="' + cls + '" onclick="switchSubject(\'' + s.name + '\')">' + s.name + '</div>';
  }
  // Admin gets a Dashboard tab
  if (isAdmin) {
    var dcls = 'subject-tab dashboard-tab';
    if (currentSubject === 'Dashboard') dcls += ' active';
    tabsHtml += '<div class="' + dcls + '" onclick="switchSubject(\'Dashboard\')">Dashboard</div>';
  }
  tabsEl.innerHTML = tabsHtml;

  // Render content: admin sees stats, teacher sees practice papers
  if (isAdmin) {
    if (currentSubject === 'Dashboard') {
      renderDashboard();
    } else {
      renderSubjectStats(currentSubject);
    }
  } else {
    renderSubjectContent(currentSubject);
  }
}

function switchSubject(name) {
  if (name === 'Dashboard') {
    if (!isAdmin) return;
    currentSubject = 'Dashboard';
    renderSelection();
    return;
  }
  var subj = null;
  for (var i = 0; i < ALL_SUBJECTS.length; i++) {
    if (ALL_SUBJECTS[i].name === name) { subj = ALL_SUBJECTS[i]; break; }
  }
  if (!subj) return;
  if (!subj.hasData && !isAdmin) return;
  currentSubject = name;
  renderSelection();
}

function renderDashboard() {
  var container = document.getElementById('selectionContent');
  var html = '';
  html += '<div class="admin-header">';
  html += '<h2>Admin Dashboard - All Subjects</h2>';
  html += '<div>';
  html += '<button class="secondary" onclick="loadAdminData(null)">Refresh</button>';
  html += '<button class="secondary" onclick="exportCSV()">Export CSV</button>';
  html += '<button onclick="adminLogout()">Logout</button>';
  html += '</div>';
  html += '</div>';
  html += '<div class="stats-grid" id="statsGrid"></div>';
  html += '<h3 style="margin-bottom:12px;">Results</h3>';
  html += '<div class="results-table" id="resultsTable"><div class="loading">Loading...</div></div>';
  container.innerHTML = html;
  loadAdminData(null);
}

function renderSubjectContent(subjName) {
  var container = document.getElementById('selectionContent');
  var html = '';

  var subj = null;
  for (var i = 0; i < ALL_SUBJECTS.length; i++) {
    if (ALL_SUBJECTS[i].name === subjName) { subj = ALL_SUBJECTS[i]; break; }
  }

  if (!subj || !subj.hasData) {
    html += '<div class="subject-card-placeholder"><p>Coming soon</p></div>';
    container.innerHTML = html;
    return;
  }

  // Group by category (IG/AL), then by paper number
  var categories = {};
  for (var pkey in PAPERS) {
    var pinfo = PAPERS[pkey];
    var pSubj = pinfo.subject.split(' ').pop();
    if (pSubj !== subjName) continue;
    var cat = pinfo.category;
    var num = extractPaperNum(pinfo.paper);
    if (!categories[cat]) categories[cat] = {};
    if (!categories[cat][num]) categories[cat][num] = [];
    categories[cat][num].push(Object.assign({ key: pkey }, pinfo));
  }

  var catOrder = ['IG', 'AL'];
  for (var ci = 0; ci < catOrder.length; ci++) {
    var cat = catOrder[ci];
    if (!categories[cat]) continue;
    html += '<div class="category-section">';
    html += '<div class="category-title ' + cat.toLowerCase() + '">' + (cat === 'IG' ? 'IGCSE' : 'A-Level') + ' ' + subjName + '</div>';

    var paperNums = Object.keys(categories[cat]).sort();
    for (var ni = 0; ni < paperNums.length; ni++) {
      var num = paperNums[ni];
      var papers = categories[cat][num];
      html += '<div class="paper-num-heading">Paper ' + num + '</div>';
      html += '<div class="papers-grid">';
      for (var pi = 0; pi < papers.length; pi++) {
        var p = papers[pi];
        html += '<div class="paper-card">';
        html += '<h3>' + p.subject + ' - ' + p.paper + '</h3>';
        html += '<div class="paper-sub">Full mark: ' + p.fullMark + ' | Scripts: ' + Object.keys(p.scripts).join(', ') + '</div>';
        html += renderScriptButtons(p);
        html += '</div>';
      }
      html += '</div>';
    }

    html += '</div>';
  }

  container.innerHTML = html;
}

function renderSubjectStats(subjName) {
  var container = document.getElementById('selectionContent');
  var html = '';
  html += '<div class="admin-header">';
  html += '<h2>' + subjName + ' - Marking Statistics</h2>';
  html += '<div>';
  html += '<button class="secondary" onclick="loadAdminData(\'' + subjName + '\')">Refresh</button>';
  html += '<button class="secondary" onclick="exportCSV()">Export CSV</button>';
  html += '<button onclick="adminLogout()">Logout</button>';
  html += '</div>';
  html += '</div>';
  html += '<div class="stats-grid" id="statsGrid"></div>';
  html += '<h3 style="margin-bottom:12px;">Results - ' + subjName + '</h3>';
  html += '<div class="results-table" id="resultsTable"><div class="loading">Loading...</div></div>';
  container.innerHTML = html;
  loadAdminData(subjName);
}

// ============================================================
// ADMIN PANEL
// ============================================================
var ADMIN_PWD = '123456';
var allResults = [];
var displayedResults = [];

function getSubjectForPaper(paperKey) {
  if (PAPERS[paperKey] && PAPERS[paperKey].subject) {
    return PAPERS[paperKey].subject.split(' ').pop();
  }
  return null;
}

async function doAdminLogin() {
  var pwd = document.getElementById('adminPwdInput').value;
  var ok = await apiCheckAdminPassword(pwd);
  var errEl = document.getElementById('adminErrorMsg');
  if (ok === null) {
    errEl.textContent = 'Cannot connect to server, please try again later';
    errEl.classList.remove('hidden');
    return;
  }
  if (ok) {
    if (USE_DOMESTIC_API) ADMIN_PWD = pwd;
    errEl.classList.add('hidden');
    currentUser = 'Admin';
    isAdmin = true;
    currentSubject = 'Dashboard';
    showSelectionPage();
  } else {
    errEl.textContent = 'Incorrect password';
    errEl.classList.remove('hidden');
  }
}

document.getElementById('adminPwdInput').addEventListener('keypress', function(e) {
  if (e.key === 'Enter') doAdminLogin();
});

function adminLogout() {
  isAdmin = false;
  currentUser = null;
  currentSubject = 'Physics';
  hideAll();
  document.getElementById('loginPage').classList.remove('hidden');
}

function adminFormatTime(secs) {
  if (!secs && secs !== 0) return '-';
  var m = Math.floor(secs / 60);
  var s = secs % 60;
  return m + 'm ' + s + 's';
}

async function loadAdminData(subjectFilter) {
  document.getElementById('resultsTable').innerHTML = '<div class="loading">Loading...</div>';

  try {
    allResults = await apiFetchResults();
  } catch(e) {
    var msg = e.message === 'unauthorized' ? 'Password verification failed, please login again' : e.message;
    document.getElementById('resultsTable').innerHTML = '<div class="loading" style="color:#e74c3c;">Error: ' + msg + '</div>';
    return;
  }

  // Filter by subject if requested
  if (subjectFilter) {
    displayedResults = [];
    for (var fi = 0; fi < allResults.length; fi++) {
      if (getSubjectForPaper(allResults[fi].paper) === subjectFilter) {
        displayedResults.push(allResults[fi]);
      }
    }
  } else {
    displayedResults = allResults;
  }

  var userSet = new Set(displayedResults.map(function(r) { return r.teacher_name; }));

  var totalQuestions = 0, matchedQuestions = 0;
  for (var ri = 0; ri < displayedResults.length; ri++) {
    var r = displayedResults[ri];
    if (r.results && Array.isArray(r.results)) {
      for (var qi = 0; qi < r.results.length; qi++) {
        var q = r.results[qi];
        if (q.officialMark !== null && q.officialMark !== undefined) {
          totalQuestions++;
          if (q.myMark === q.officialMark) matchedQuestions++;
        }
      }
    }
  }
  var accuracy = totalQuestions > 0 ? Math.round(matchedQuestions / totalQuestions * 100) : 0;

  document.getElementById('statsGrid').innerHTML =
    '<div class="stat-card"><h3>Teachers</h3><div class="stat-value">' + userSet.size + '</div></div>' +
    '<div class="stat-card"><h3>Submissions</h3><div class="stat-value">' + displayedResults.length + '</div></div>' +
    '<div class="stat-card"><h3>Avg Accuracy <span class="info-icon">i<span class="tip-text">Matched question parts \u00f7 Total question parts (with official marks) \u00d7 100%. Counts every sub-question across all submissions where the teacher\'s mark exactly equals the official mark.</span></span></h3><div class="stat-value">' + (totalQuestions > 0 ? accuracy + '%' : '-') + '</div></div>' +
    '<div class="stat-card"><h3>Avg Time</h3><div class="stat-value">' + (displayedResults.length > 0 ? adminFormatTime(Math.round(displayedResults.reduce(function(s,r) { return s + r.time_taken; }, 0) / displayedResults.length)) : '-') + '</div></div>';

  if (displayedResults.length === 0) {
    document.getElementById('resultsTable').innerHTML = '<div class="loading">No marking data for this subject yet</div>';
    return;
  }

  var tableHtml = '<table><tr><th></th><th>Teacher</th><th>Paper</th><th>Script</th><th>My Mark</th><th>Official</th><th>Full</th><th>Diff</th><th>Accuracy</th><th>Time</th><th>Date</th></tr>';

  for (var idx = 0; idx < displayedResults.length; idx++) {
    var r = displayedResults[idx];
    var diff = r.official_total !== null && r.official_total !== undefined ? r.my_total - r.official_total : null;
    var diffHtml = '-';
    if (diff !== null) {
      if (diff > 0) diffHtml = '<span class="diff-pos">+' + diff + '</span>';
      else if (diff < 0) diffHtml = '<span class="diff-neg">' + diff + '</span>';
      else diffHtml = '<span class="diff-zero">0</span>';
    }
    var subTotal = 0, subMatch = 0;
    if (r.results && Array.isArray(r.results)) {
      for (var qi = 0; qi < r.results.length; qi++) {
        var q = r.results[qi];
        if (q.officialMark !== null && q.officialMark !== undefined) {
          subTotal++;
          if (q.myMark === q.officialMark) subMatch++;
        }
      }
    }
    var subAcc = subTotal > 0 ? Math.round(subMatch / subTotal * 100) + '%' : '-';
    var dateStr = new Date(r.created_at).toLocaleString();

    tableHtml += '<tr>' +
      '<td><button class="expand-btn" onclick="toggleAdminDetail(' + idx + ', this)">+</button></td>' +
      '<td>' + r.teacher_name + '</td>' +
      '<td>' + r.paper + '</td>' +
      '<td>' + r.script + '</td>' +
      '<td>' + r.my_total + '</td>' +
      '<td>' + (r.official_total !== null && r.official_total !== undefined ? r.official_total : '-') + '</td>' +
      '<td>' + r.full_mark + '</td>' +
      '<td>' + diffHtml + '</td>' +
      '<td>' + subAcc + '</td>' +
      '<td>' + adminFormatTime(r.time_taken) + '</td>' +
      '<td>' + dateStr + '</td></tr>';
    tableHtml += '<tr class="detail-row hidden" id="detail_' + idx + '"><td colspan="11"><div id="detail_content_' + idx + '"></div></td></tr>';
  }

  tableHtml += '</table>';
  document.getElementById('resultsTable').innerHTML = tableHtml;
}

function toggleAdminDetail(idx, btn) {
  var row = document.getElementById('detail_' + idx);
  var isHidden = row.classList.contains('hidden');
  row.classList.toggle('hidden');
  btn.textContent = isHidden ? '-' : '+';
  if (isHidden) {
    var r = displayedResults[idx];
    var html = '<table class="detail-table"><tr><th>Part</th><th>Your Mark</th><th>Official</th></tr>';
    if (r.results && Array.isArray(r.results)) {
      for (var qi = 0; qi < r.results.length; qi++) {
        var q = r.results[qi];
        var isMatch = q.officialMark !== null && q.officialMark !== undefined ? q.myMark === q.officialMark : null;
        var color = isMatch === false ? '#e74c3c' : '#333';
        var bg = isMatch === false ? '#ffeaea' : 'transparent';
        var maxStr = (q.maxMark !== null && q.maxMark !== undefined) ? q.maxMark : '?';
        html += '<tr style="background:' + bg + ';">';
        html += '<td style="font-weight:600;">' + q.label + '</td>';
        html += '<td style="color:' + color + ';font-weight:600;">' + q.myMark + '/' + maxStr + '</td>';
        html += '<td style="color:' + color + ';font-weight:600;">' + (q.officialMark !== null && q.officialMark !== undefined ? q.officialMark + '/' + maxStr : '-') + '</td>';
        html += '</tr>';
      }
    }
    html += '</table>';
    document.getElementById('detail_content_' + idx).innerHTML = html;
  }
}

function exportCSV() {
  if (displayedResults.length === 0) { alert('No data to export'); return; }
  var csv = 'Teacher,Paper,Script,My Mark,Official,Full Mark,Diff,Accuracy,Time,Date\n';
  for (var ri = 0; ri < displayedResults.length; ri++) {
    var r = displayedResults[ri];
    var diff = r.official_total !== null && r.official_total !== undefined ? r.my_total - r.official_total : '';
    var subTotal = 0, subMatch = 0;
    if (r.results && Array.isArray(r.results)) {
      for (var qi = 0; qi < r.results.length; qi++) {
        var q = r.results[qi];
        if (q.officialMark !== null && q.officialMark !== undefined) {
          subTotal++;
          if (q.myMark === q.officialMark) subMatch++;
        }
      }
    }
    var acc = subTotal > 0 ? Math.round(subMatch / subTotal * 100) + '%' : '';
    csv += '"' + r.teacher_name + '","' + r.paper + '","' + r.script + '",' + r.my_total + ',' + (r.official_total !== null && r.official_total !== undefined ? r.official_total : '') + ',' + r.full_mark + ',' + diff + ',' + acc + ',"' + adminFormatTime(r.time_taken) + '","' + new Date(r.created_at).toLocaleString() + '"\n';
  }
  var blob = new Blob([csv], { type: 'text/csv' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'marking_results_' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================
// MARKING PAGE
// ============================================================
function startMarking(paperKey, scriptId) {
  currentPaper = paperKey;
  currentScript = scriptId;
  const pinfo = PAPERS[paperKey];
  const sinfo = pinfo.scripts[scriptId];

  hideAll();
  document.getElementById('markingPage').classList.remove('hidden');
  document.getElementById('markingTitle').textContent = `${pinfo.subject} ${pinfo.paper} - Script ${scriptId}`;
  document.getElementById('markingUserInfo').textContent = currentUser;
  document.getElementById('fullMark').textContent = pinfo.fullMark;

  // Render script images (left panel) with zoom/pan wrapper
  let scriptHtml = '<div class="panel-content">';
  for (const img of sinfo.images) {
    scriptHtml += `<img src="${img}" loading="lazy" alt="Script page">`;
  }
  scriptHtml += '</div>';
  scriptHtml += '<div class="zoom-controls"><button onclick="zoomPanel(\'scriptPanel\',-1)">\u2212</button><span class="zoom-label" id="zoomLabel_scriptPanel">100%</span><button onclick="zoomPanel(\'scriptPanel\',1)">+</button><button onclick="zoomPanel(\'scriptPanel\',0)" style="font-size:13px;">\u21BA</button></div>';
  document.getElementById('scriptPanel').innerHTML = scriptHtml;

  // Render MS images (middle panel) with zoom/pan wrapper
  let msHtml = '<div class="panel-content">';
  for (const img of pinfo.msImages) {
    msHtml += `<img src="${img}" loading="lazy" alt="Mark scheme page">`;
  }
  msHtml += '</div>';
  msHtml += '<div class="zoom-controls"><button onclick="zoomPanel(\'msPanel\',-1)">\u2212</button><span class="zoom-label" id="zoomLabel_msPanel">100%</span><button onclick="zoomPanel(\'msPanel\',1)">+</button><button onclick="zoomPanel(\'msPanel\',0)" style="font-size:13px;">\u21BA</button></div>';
  document.getElementById('msPanel').innerHTML = msHtml;

  // Initialize zoom/pan for both panels
  initZoomPan('scriptPanel');
  initZoomPan('msPanel');

  // Build question list (right panel)
  questionScores = {};
  document.getElementById('totalScore').textContent = '0';

  // Generate question items from feedback if available, or generic list
  let questions = [];
  if (pinfo.hasFb && pinfo.feedback && pinfo.feedback[scriptId]) {
    const fb = pinfo.feedback[scriptId];
    questions = fb.questions || [];
  }

  let qHtml = '';
  if (questions.length > 0) {
    // Group by question number
    const groups = {};
    const groupOrder = [];
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const qNum = parseInt(q.label.match(/(\d+)/)?.[1]) || 0;
      if (!groups[qNum]) {
        groups[qNum] = [];
        groupOrder.push(qNum);
      }
      groups[qNum].push({ ...q, _idx: i });
    }

    for (const qNum of groupOrder) {
      const gItems = groups[qNum];
      const gMax = gItems.reduce((s, q) => s + (q.maxMark || 0), 0);

      if (groupOrder.length > 1) {
        qHtml += `<div class="q-group">`;
        qHtml += `<div class="q-group-header" onclick="toggleGroup(this)" id="qgh_${qNum}">`;
        qHtml += `<div class="qg-left"><span class="qg-arrow">\u25BC</span><span>Q${qNum}</span></div>`;
        qHtml += `<span class="q-group-sub" id="qgs_${qNum}">- / ${gMax}</span>`;
        qHtml += `</div>`;
        qHtml += `<div class="q-group-body" id="qgb_${qNum}">`;
      }

      for (const q of gItems) {
        const i = q._idx;
        const qid = `q_${i}`;
        questionScores[qid] = { label: q.label, questionNum: qNum, score: null, maxMark: q.maxMark, officialMark: q.officialMark };

        qHtml += `<div class="q-item" id="qi_${i}">`;
        qHtml += `<div class="q-label">${q.label}</div>`;
        qHtml += `<div class="q-marks">Max: ${q.maxMark !== null ? q.maxMark : '?'}</div>`;
        qHtml += `<div class="q-controls">`;
        qHtml += `<button onclick="markCorrect('${qid}', ${i})" id="btn_c_${i}">\u2713</button>`;
        qHtml += `<button onclick="markWrong('${qid}', ${i})" id="btn_w_${i}">\u2717</button>`;
        qHtml += `<input type="number" min="0" max="${q.maxMark || 99}" id="inp_${i}" onchange="markManual('${qid}', ${i})" placeholder="0">`;
        qHtml += `<span class="q-score-display" id="sd_${i}">-</span>`;
        qHtml += `</div></div>`;
      }

      if (groupOrder.length > 1) {
        qHtml += `</div></div>`;
      }
    }
  } else {
    // No feedback data - show generic question inputs
    for (let i = 0; i < 15; i++) {
      const qid = `q_${i}`;
      questionScores[qid] = { label: `Q${i+1}`, questionNum: i+1, score: null, maxMark: null, officialMark: null };
      qHtml += `<div class="q-item" id="qi_${i}">`;
      qHtml += `<div class="q-label">Q${i+1}</div>`;
      qHtml += `<div class="q-controls">`;
      qHtml += `<button onclick="markCorrect('${qid}', ${i})" id="btn_c_${i}">\u2713</button>`;
      qHtml += `<button onclick="markWrong('${qid}', ${i})" id="btn_w_${i}">\u2717</button>`;
      qHtml += `<input type="number" min="0" max="99" id="inp_${i}" onchange="markManual('${qid}', ${i})" placeholder="0">`;
      qHtml += `<span class="q-score-display" id="sd_${i}">-</span>`;
      qHtml += `</div></div>`;
    }
  }

  document.getElementById('questionList').innerHTML = qHtml;

  // Start timer
  startTimer();
}

function markCorrect(qid, idx) {
  const q = questionScores[qid];
  const maxM = q.maxMark !== null ? q.maxMark : 0;
  q.score = maxM;
  document.getElementById(`btn_c_${idx}`).className = 'active-correct';
  document.getElementById(`btn_w_${idx}`).className = '';
  document.getElementById(`inp_${idx}`).value = maxM;
  document.getElementById(`sd_${idx}`).textContent = `${maxM}/${maxM}`;
  document.getElementById(`qi_${idx}`).classList.add('scored');
  updateTotal();
}

function markWrong(qid, idx) {
  const q = questionScores[qid];
  q.score = 0;
  document.getElementById(`btn_c_${idx}`).className = '';
  document.getElementById(`btn_w_${idx}`).className = 'active-wrong';
  document.getElementById(`inp_${idx}`).value = 0;
  document.getElementById(`sd_${idx}`).textContent = `0/${q.maxMark !== null ? q.maxMark : '?'}`;
  document.getElementById(`qi_${idx}`).classList.add('scored');
  updateTotal();
}

function markManual(qid, idx) {
  const q = questionScores[qid];
  const val = parseInt(document.getElementById(`inp_${idx}`).value);
  if (isNaN(val)) return;
  q.score = val;
  document.getElementById(`btn_c_${idx}`).className = '';
  document.getElementById(`btn_w_${idx}`).className = '';
  document.getElementById(`sd_${idx}`).textContent = `${val}/${q.maxMark !== null ? q.maxMark : '?'}`;
  document.getElementById(`qi_${idx}`).classList.add('scored');
  updateTotal();
}

function updateTotal() {
  let total = 0;
  const groupData = {};
  for (const q of Object.values(questionScores)) {
    if (q.score !== null) total += q.score;
    const gn = q.questionNum;
    if (gn !== undefined && gn !== null) {
      if (!groupData[gn]) groupData[gn] = { scored: 0, max: 0, allScored: true, allCorrect: true };
      groupData[gn].max += (q.maxMark || 0);
      if (q.score !== null) {
        groupData[gn].scored += q.score;
        if (q.score !== q.maxMark) groupData[gn].allCorrect = false;
      } else {
        groupData[gn].allScored = false;
        groupData[gn].allCorrect = false;
      }
    }
  }
  document.getElementById('totalScore').textContent = total;
  for (const [gn, gd] of Object.entries(groupData)) {
    const subEl = document.getElementById('qgs_' + gn);
    if (subEl) subEl.textContent = gd.scored + ' / ' + gd.max;
    const hdrEl = document.getElementById('qgh_' + gn);
    if (hdrEl) {
      hdrEl.classList.remove('all-correct', 'has-wrong');
      if (gd.allScored && gd.allCorrect) hdrEl.classList.add('all-correct');
      else if (gd.allScored && !gd.allCorrect) hdrEl.classList.add('has-wrong');
    }
  }
}

function toggleGroup(el) {
  el.classList.toggle('collapsed');
  const bodyId = 'qgb_' + el.id.split('_')[1];
  const body = document.getElementById(bodyId);
  if (body) body.classList.toggle('collapsed');
}

// ============================================================
// TIMER
// ============================================================
function startTimer() {
  stopTimer();
  timerSeconds = 0;
  updateTimerDisplay();
  timerInterval = setInterval(function() {
    timerSeconds++;
    updateTimerDisplay();
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function updateTimerDisplay() {
  const m = Math.floor(timerSeconds / 60);
  const s = timerSeconds % 60;
  document.getElementById('timerDisplay').textContent =
    String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m + 'm ' + s + 's';
}

// ============================================================
// SUBMIT
// ============================================================
function submitMarking() {
  if (!confirm('Submit your marking? You cannot change it after submission.')) return;

  stopTimer();

  const pinfo = PAPERS[currentPaper];
  let myTotal = 0;
  const results = [];
  const mismatches = [];

  for (const [qid, q] of Object.entries(questionScores)) {
    const score = q.score !== null ? q.score : 0;
    myTotal += score;
    const entry = {
      label: q.label,
      questionNum: q.questionNum,
      myMark: score,
      officialMark: q.officialMark,
      maxMark: q.maxMark,
    };
    results.push(entry);

    // Check mismatch (only if we have official mark)
    if (q.officialMark !== null && q.officialMark !== undefined && score !== q.officialMark) {
      mismatches.push(entry);
    }
  }

  // Get commentary from feedback
  let fbQuestions = [];
  if (pinfo.hasFb && pinfo.feedback && pinfo.feedback[currentScript]) {
    fbQuestions = pinfo.feedback[currentScript].questions || [];
  }

  const officialTotal = pinfo.feedback && pinfo.feedback[currentScript]
    ? pinfo.feedback[currentScript].totalMark : null;

  // 保存批卷结果（自动按模式路由到 Supabase 或国内 API）
  apiInsertResult({
    teacher_name: currentUser,
    paper: currentPaper,
    script: currentScript,
    my_total: myTotal,
    official_total: officialTotal,
    full_mark: pinfo.fullMark,
    time_taken: timerSeconds,
    results: results
  });

  const saveData = {
    user: currentUser,
    paper: currentPaper,
    script: currentScript,
    myTotal: myTotal,
    officialTotal: officialTotal,
    fullMark: pinfo.fullMark,
    timeTaken: timerSeconds,
    results: results,
  };
  localStorage.setItem(`done_${currentUser}_${currentPaper}_${currentScript}`, 'true');

  // Show results
  showResults(saveData, mismatches, fbQuestions);
}

// ============================================================
// RESULTS PAGE
// ============================================================
function showResults(saveData, mismatches, fbQuestions) {
  hideAll();
  document.getElementById('resultsPage').classList.remove('hidden');
  document.getElementById('resultsUserInfo').textContent = currentUser;

  const pinfo = PAPERS[saveData.paper];
  const sinfo = pinfo.scripts[saveData.script];

  // Left panel: student script images with zoom
  let scriptHtml = '<div class="panel-content">';
  for (const img of sinfo.images) {
    scriptHtml += `<img src="${img}" loading="lazy" alt="Script page">`;
  }
  scriptHtml += '</div>';
  scriptHtml += '<div class="zoom-controls"><button onclick="zoomPanel(\'resultsScript\',-1)">\u2212</button><span class="zoom-label" id="zoomLabel_resultsScript">100%</span><button onclick="zoomPanel(\'resultsScript\',1)">+</button><button onclick="zoomPanel(\'resultsScript\',0)" style="font-size:13px;">\u21BA</button></div>';
  document.getElementById('resultsScript').innerHTML = scriptHtml;
  initZoomPan('resultsScript');

  // Middle panel: mark scheme images with zoom
  let msHtml = '<div class="panel-content">';
  for (const img of pinfo.msImages) {
    msHtml += `<img src="${img}" loading="lazy" alt="Mark scheme page">`;
  }
  msHtml += '</div>';
  msHtml += '<div class="zoom-controls"><button onclick="zoomPanel(\'resultsMS\',-1)">\u2212</button><span class="zoom-label" id="zoomLabel_resultsMS">100%</span><button onclick="zoomPanel(\'resultsMS\',1)">+</button><button onclick="zoomPanel(\'resultsMS\',0)" style="font-size:13px;">\u21BA</button></div>';
  document.getElementById('resultsMS').innerHTML = msHtml;
  initZoomPan('resultsMS');

  // Right panel: summary + mismatched questions with feedback
  let html = `<div class="results-summary">`;
  html += `<h2 style="font-size:16px;margin-bottom:4px;">${pinfo.subject} ${pinfo.paper} - Script ${saveData.script}</h2>`;
  html += `<div class="big-score">${saveData.myTotal} / ${saveData.fullMark}</div>`;
  html += `<div class="score-detail">Your mark: ${saveData.myTotal}`;
  if (saveData.officialTotal !== null && saveData.officialTotal !== undefined) {
    html += ` | Official: ${saveData.officialTotal}`;
    const diff = saveData.myTotal - saveData.officialTotal;
    const diffStr = diff > 0 ? `+${diff}` : `${diff}`;
    html += ` | Diff: ${diffStr}`;
  }
  html += `</div>`;
  html += `<div class="time-taken">Time: ${formatTime(saveData.timeTaken)}</div>`;
  html += `</div>`;

  // Build feedback map
  const fbMap = {};
  for (const fq of fbQuestions) { fbMap[fq.label] = fq; }

  // Find mismatched questions
  const mismatched = [];
  for (const r of saveData.results) {
    if (r.officialMark !== null && r.officialMark !== undefined && r.myMark !== r.officialMark) {
      mismatched.push(r);
    }
  }

  if (mismatched.length > 0) {
    html += `<div class="fb-section">`;
    html += `<h3>Mismatched (${mismatched.length})</h3>`;

    // Group by question number
    const groups = {};
    const groupOrder = [];
    for (const m of mismatched) {
      const qn = m.questionNum || 0;
      if (!groups[qn]) { groups[qn] = []; groupOrder.push(qn); }
      groups[qn].push(m);
    }

    for (const qn of groupOrder) {
      const items = groups[qn];
      html += `<div style="margin-bottom:14px;">`;
      html += `<div style="font-weight:700;font-size:15px;margin-bottom:6px;color:#333;padding:6px 10px;background:#f0f0f0;border-radius:6px;">Q${qn}</div>`;
      for (const m of items) {
        const fb = fbMap[m.label];
        const fbCommentary = fb ? fb.commentary : '';
        html += `<div class="fb-item">`;
        html += `<div class="fb-label">${m.label}</div>`;
        html += `<div class="fb-marks">`;
        html += `<span style="color:#e74c3c;font-weight:600;">Your: ${m.myMark}</span>`;
        html += ` | <span style="color:#27ae60;font-weight:600;">Official: ${m.officialMark}</span>`;
        html += ` / Max: ${m.maxMark !== null ? m.maxMark : '?'}`;
        html += `</div>`;
        if (fbCommentary) {
          html += `<div class="fb-commentary">${fbCommentary}</div>`;
        }
        html += `</div>`;
      }
      html += `</div>`;
    }
    html += `</div>`;
  } else {
    html += `<div style="text-align:center;padding:40px 20px;color:#27ae60;font-size:18px;font-weight:600;">All marks match official!</div>`;
  }

  document.getElementById('resultsContent').innerHTML = html;
}

// ============================================================
// NAVIGATION
// ============================================================
function goBackToSelection() {
  stopTimer();
  showSelectionPage();
}

function hideAll() {
  document.getElementById('loginPage').classList.add('hidden');
  document.getElementById('selectionPage').classList.add('hidden');
  document.getElementById('markingPage').classList.add('hidden');
  document.getElementById('resultsPage').classList.add('hidden');
}

// === Zoom & Pan for image panels ===
var panelStates = {};

function initZoomPan(panelId) {
  var panel = document.getElementById(panelId);
  var content = panel.querySelector('.panel-content');
  if (!content) return;

  panelStates[panelId] = { scale: 1, tx: 0, ty: 0 };

  // Button-only zoom, no wheel hijack, no drag — native scroll handles page navigation
}

function zoomPanel(panelId, dir) {
  var s = panelStates[panelId];
  if (!s) return;

  if (dir === 0) {
    s.scale = 1;
    applyTransform(panelId);
    updateZoomLabel(panelId);
    return;
  }

  var factor = dir > 0 ? 1.2 : 1 / 1.2;
  s.scale = Math.min(Math.max(s.scale * factor, 0.5), 5);

  applyTransform(panelId);
  updateZoomLabel(panelId);
}

function applyTransform(panelId) {
  var s = panelStates[panelId];
  var panel = document.getElementById(panelId);
  var content = panel.querySelector('.panel-content');
  if (!content) return;
  content.style.width = (s.scale * 100) + '%';
}

function updateZoomLabel(panelId) {
  var s = panelStates[panelId];
  var label = document.getElementById('zoomLabel_' + panelId);
  if (label) label.textContent = Math.round(s.scale * 100) + '%';
}
