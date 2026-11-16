const $ = (id) => document.getElementById(id);
const dash = '<span class="muted">—</span>';
const ROLE_ORDER = ['Registry Clerk', 'Court Admin', 'Judge', 'Advocate', 'Litigant', 'System Admin'];
const ROLE_VIEWS = {
  'Registry Clerk': ['cases', 'causelist', 'search', 'reports', 'notifications'],
  'Court Admin': ['cases', 'causelist', 'search', 'reports', 'notifications'],
  'Judge': ['cases', 'causelist', 'search', 'reports'],
  'Advocate': ['advocate'],
  'Litigant': ['litigant'],
  'System Admin': ['admin'],
};
const VIEW_LOADERS = {};
let accounts = [];
let me = null;
let currentView = null;

const isStaff = () => me && ['Registry Clerk', 'Court Admin'].includes(me.approle);
const isJudge = () => me && me.approle === 'Judge';
const isClerk = () => me && me.approle === 'Registry Clerk';
const isCourtAdmin = () => me && me.approle === 'Court Admin';

function escapeHtml(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function showMessage(text, type) {
  const box = $('message');
  box.textContent = text;
  box.className = 'message ' + type;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function clearMessage() {
  $('message').className = 'message';
}

function isoDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const todayIso = () => isoDate(new Date());
const fmtTime = (t) => (t ? String(t).slice(0, 5) : '');
const money = (v) => Number(v).toFixed(2);
const cell = (v) => (v === null || v === undefined || v === '' ? dash : escapeHtml(v));

function optionList(items, valueKey, labelFn, placeholder) {
  return (placeholder ? `<option value="">${escapeHtml(placeholder)}</option>` : '')
    + items.map((it) => `<option value="${escapeHtml(it[valueKey])}">${escapeHtml(labelFn(it))}</option>`).join('');
}

function emptyRow(cols, text) {
  return `<tr><td colspan="${cols}" class="muted">${escapeHtml(text)}</td></tr>`;
}

async function api(url, options = {}) {
  const headers = {};
  if (me) headers['X-Person'] = String(me.personid);
  if (options.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { ...options, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data;
}

const post = (url, body) => api(url, { method: 'POST', body: JSON.stringify(body) });
const put = (url, body) => api(url, { method: 'PUT', body: JSON.stringify(body) });

async function act(promise, after) {
  try {
    const data = await promise;
    if (data && data.message) showMessage(data.message, 'success');
    if (after) await after(data);
    return data;
  } catch (err) {
    showMessage(err.message, 'error');
    return null;
  }
}

function updateThemeButton() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  $('themeToggle').textContent = dark ? '☀ Light mode' : '☾ Dark mode';
}

$('themeToggle').addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('nyaya-theme', next); } catch (e) {}
  updateThemeButton();
});

function askConfirm(text, title = 'Delete case?', yes = 'Yes, delete') {
  return new Promise((resolve) => {
    const modal = $('confirmModal');
    $('confirmTitle').textContent = title;
    $('confirmYes').textContent = yes;
    $('confirmText').textContent = text;
    modal.classList.remove('hidden');
    $('confirmNo').focus();
    const close = (answer) => {
      modal.classList.add('hidden');
      $('confirmYes').onclick = $('confirmNo').onclick = modal.onclick = document.onkeydown = null;
      resolve(answer);
    };
    $('confirmYes').onclick = () => close(true);
    $('confirmNo').onclick = () => close(false);
    modal.onclick = (e) => { if (e.target === modal) close(false); };
    document.onkeydown = (e) => { if (e.key === 'Escape') close(false); };
  });
}

function showView(view) {
  currentView = view;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('hidden', v.id !== 'view-' + view));
  clearMessage();
  if (VIEW_LOADERS[view]) VIEW_LOADERS[view]();
}

document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

function fillPeople(role, selectedId) {
  const list = accounts.filter((a) => a.approle === role);
  const groups = {};
  list.forEach((a) => { (groups[a.courtname || 'All courts'] = groups[a.courtname || 'All courts'] || []).push(a); });
  $('signPerson').innerHTML = Object.entries(groups).map(([court, people]) =>
    `<optgroup label="${escapeHtml(court)}">` + people.map((a) =>
      `<option value="${a.personid}">${escapeHtml(a.name)} (#${a.personid})</option>`).join('') + '</optgroup>').join('');
  $('signPerson').value = String(selectedId || (list[0] && list[0].personid) || '');
}

function signIn(personId) {
  me = accounts.find((a) => String(a.personid) === String(personId)) || null;
  if (!me) return;
  try { localStorage.setItem('nyaya-person', String(me.personid)); } catch (e) {}
  $('signRole').value = me.approle;
  fillPeople(me.approle, me.personid);
  const views = ROLE_VIEWS[me.approle];
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('hidden', !views.includes(b.dataset.view)));
  const scope = me.courtname ? `${me.courtname} only (row-level security)` : 'own records only';
  $('signedInfo').textContent = `${me.name} · ${me.approle}${me.courtname ? ' · ' + me.courtname : ''} · database role nyaya_${
    { 'Registry Clerk': 'clerk', 'Court Admin': 'court_admin', Judge: 'judge', Advocate: 'advocate', Litigant: 'litigant', 'System Admin': 'sysadmin' }[me.approle]
  } · sees ${me.approle === 'System Admin' ? 'accounts and counts, no case data' : scope}. Every change is logged under this person.`;
  if (typeof onSignIn === 'function') onSignIn();
  showView(views[0]);
}

$('signRole').addEventListener('change', () => {
  fillPeople($('signRole').value);
  signIn($('signPerson').value);
});
$('signPerson').addEventListener('change', () => signIn($('signPerson').value));

async function start() {
  updateThemeButton();
  try {
    const data = await fetch('/api/accounts').then((r) => r.json());
    if (data.error) throw new Error(data.error);
    accounts = data.accounts;
    $('signRole').innerHTML = ROLE_ORDER.filter((r) => accounts.some((a) => a.approle === r))
      .map((r) => `<option>${r}</option>`).join('');
    if (typeof loadCourts === 'function') await loadCourts();
    let saved = null;
    try { saved = localStorage.getItem('nyaya-person'); } catch (e) {}
    const pick = accounts.some((a) => String(a.personid) === saved) ? saved
      : accounts.some((a) => a.personid === data.defaultId) ? data.defaultId : accounts[0].personid;
    signIn(pick);
  } catch (err) {
    showMessage('Could not load user accounts: ' + err.message, 'error');
  }
}
