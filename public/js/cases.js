const form = $('caseForm');
const fields = ['caseType', 'courtId', 'filingDate', 'courtFeeDue', 'priority', 'priorityReason', 'status',
                'stage', 'cnr', 'registrationDate', 'returnReason', 'disposalType', 'originalCaseId',
                'leadCaseId', 'legacyRef', 'firNumber', 'chargeSheetNumber'];
const JUDGE_FIELDS = ['priority', 'priorityReason', 'stage'];
const NEXT_STATUS = {
  Filed: ['Registered', 'Returned'], Returned: ['Filed'], Registered: ['Hearing', 'Disposed'],
  Hearing: ['Disposed'], Disposed: ['Under Appeal'], 'Under Appeal': [],
};
const STATUS_NOTES = {
  Registered: 'Registering needs a CNR, a registration date, at least one party and a recorded fee payment (FR-08, FR-17).',
  Hearing: 'A case moves to Hearing only after a hearing has actually been held.',
  Disposed: 'Disposing of a case needs a final order on record and a disposal type (FR-11).',
  'Under Appeal': 'Only possible once an appeal has been filed against this case in a higher court.',
  Returned: 'A returned filing needs the reason; it can be filed again later.',
  Filed: 'A returned filing can be filed again.',
};
let allCases = [];
let editingId = null;
let editingCase = null;
let highlightId = null;
let yearsLoaded = false;

async function loadCourts() {
  try {
    const courts = await fetch('/api/courts').then((r) => r.json());
    $('courtId').innerHTML = '<option value="">-- select --</option>' + courts.map((c) =>
      `<option value="${c.courtid}">${c.courtid} – ${escapeHtml(c.courtname)}</option>`).join('');
  } catch (err) {
    $('courtId').innerHTML = '<option value="">Could not load courts</option>';
  }
}

function setStatusOptions(current) {
  const options = current ? [current, ...NEXT_STATUS[current]] : ['Filed'];
  $('status').innerHTML = options.map((s) => `<option>${s}</option>`).join('');
  $('status').value = options[0];
  $('status').disabled = !current || options.length === 1;
}

function applyStatusRules() {
  const status = $('status').value;
  const editing = editingId !== null;
  const registered = editing && !['Filed', 'Returned'].includes(status);
  const decided = ['Disposed', 'Under Appeal'].includes(status);
  $('cnr').disabled = !registered;
  $('registrationDate').disabled = !registered;
  if (!registered) { $('cnr').value = ''; $('registrationDate').value = ''; }
  $('returnReason').disabled = status !== 'Returned';
  if (status !== 'Returned') $('returnReason').value = '';
  $('disposalType').disabled = !decided;
  if (!decided) $('disposalType').value = '';
  $('stage').disabled = !registered || decided;
  if (decided) $('stage').value = 'Disposed';
  else if (!registered) $('stage').value = '';
  else if ($('stage').value === 'Disposed') $('stage').value = '';
  [...$('stage').options].forEach((o) => { o.disabled = o.value === 'Disposed'; });
  $('priorityReason').disabled = $('priority').value === 'Normal';
  if ($('priority').value === 'Normal') $('priorityReason').value = '';
  const criminal = $('caseType').value === 'Criminal';
  $('firNumber').disabled = !criminal;
  $('chargeSheetNumber').disabled = !criminal;
  if (!criminal) { $('firNumber').value = ''; $('chargeSheetNumber').value = ''; }
  if (isStaff()) {
    $('courtId').value = String(editing && editingCase ? editingCase.courtid : me.courtid);
    $('courtId').disabled = true;
  }

  if (isJudge()) {
    fields.filter((f) => !JUDGE_FIELDS.includes(f)).forEach((f) => { $(f).disabled = true; });
    $('ruleHint').textContent = 'As the judge you decide the priority (urgent matters are called first, FR-20) and the stage of the case. '
      + 'The system only checks that your choice is consistent; it never decides for you (NFR-01).';
    return;
  }
  if (!editing) {
    $('ruleHint').textContent = 'New cases start as Filed in your own court. After saving, the case file opens: add the parties and record the court fee there; then the case can be registered with a CNR.';
  } else {
    const next = NEXT_STATUS[editingCase.status];
    const allowed = next.length ? `Next status allowed from ${editingCase.status}: ${next.join(', ')}.` : `${editingCase.status} is the last status a case can reach.`;
    const note = status !== editingCase.status ? ' ' + (STATUS_NOTES[status] || '') : '';
    $('ruleHint').textContent = allowed + note;
  }
}
['status', 'priority', 'caseType'].forEach((id) => $(id).addEventListener('change', applyStatusRules));

function periodRange() {
  const p = $('fPeriod').value;
  const today = new Date();
  const back = (months, days = 0) => {
    const d = new Date(today);
    d.setMonth(d.getMonth() - months);
    d.setDate(d.getDate() - days);
    return isoDate(d);
  };
  if (p === 'last30') return { from: back(0, 30), to: isoDate(today) };
  if (p === 'last3m') return { from: back(3), to: isoDate(today) };
  if (p === 'last6m') return { from: back(6), to: isoDate(today) };
  if (p === 'last12m') return { from: back(12), to: isoDate(today) };
  if (/^year\d{4}$/.test(p)) { const y = p.slice(4); return { from: `${y}-01-01`, to: `${y}-12-31` }; }
  if (p === 'custom') return { from: $('fFrom').value, to: $('fTo').value };
  return { from: '', to: '' };
}

function filterParams() {
  const { from, to } = periodRange();
  const params = new URLSearchParams();
  if ($('fType').value) params.set('type', $('fType').value);
  if ($('fStatus').value) params.set('status', $('fStatus').value);
  if ($('fPriority').value) params.set('priority', $('fPriority').value);
  if ($('fFee').value) params.set('fee', $('fFee').value);
  if (from || to) {
    params.set('dateField', $('fDateField').value);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
  }
  if ($('fSort').value !== 'id_desc') params.set('sort', $('fSort').value);
  return params;
}

function updateFilterSummary() {
  const parts = [];
  const selText = (id) => $(id).options[$(id).selectedIndex].text;
  if ($('fType').value) parts.push(selText('fType'));
  if ($('fStatus').value) parts.push(selText('fStatus'));
  if ($('fPriority').value) parts.push(selText('fPriority') + ' priority');
  if ($('fFee').value) parts.push(selText('fFee'));
  const { from, to } = periodRange();
  if (from || to) {
    const field = $('fDateField').value === 'registration' ? 'Registered' : 'Filed';
    parts.push(`${field} ${from ? 'from ' + from : ''}${from && to ? ' ' : ''}${to ? 'to ' + to : ''}`);
  }
  const sortText = `Sorted by ${selText('fSort')}`;
  $('filterSummary').textContent = parts.length
    ? `${parts.length} filter${parts.length > 1 ? 's' : ''}: ${parts.join(' · ')} · ${sortText}`
    : `No filters applied · ${sortText}`;
}

function onFilterChange() {
  document.querySelectorAll('.custom-range').forEach((el) =>
    el.classList.toggle('hidden', $('fPeriod').value !== 'custom'));
  updateFilterSummary();
  loadCases();
}
['fType', 'fStatus', 'fPriority', 'fFee', 'fDateField', 'fPeriod', 'fSort', 'fFrom', 'fTo'].forEach((id) =>
  $(id).addEventListener('change', onFilterChange));

function resetFilterInputs() {
  ['fType', 'fStatus', 'fPriority', 'fFee', 'fPeriod', 'fFrom', 'fTo'].forEach((id) => { $(id).value = ''; });
  $('fDateField').value = 'filing';
  $('fSort').value = 'id_desc';
  $('filter').value = '';
  document.querySelectorAll('.custom-range').forEach((el) => el.classList.add('hidden'));
  updateFilterSummary();
}
$('resetFilters').addEventListener('click', () => { resetFilterInputs(); loadCases(); });

function fillYearOptions(cases) {
  const years = new Set();
  cases.forEach((c) => {
    if (c.filingdate) years.add(c.filingdate.slice(0, 4));
    if (c.registrationdate) years.add(c.registrationdate.slice(0, 4));
  });
  $('yearOptions').innerHTML = [...years].sort().reverse()
    .map((y) => `<option value="year${y}">${y}</option>`).join('');
  yearsLoaded = true;
}

async function loadCases() {
  const params = filterParams();
  try {
    allCases = await api('/api/cases' + (params.toString() ? '?' + params : ''));
    if (!yearsLoaded && params.toString() === '') fillYearOptions(allCases);
    renderTable();
  } catch (err) {
    allCases = [];
    $('caseRows').innerHTML = emptyRow(13, 'Could not load cases.');
    $('count').textContent = '';
    showMessage('Could not load cases: ' + err.message, 'error');
  }
}
VIEW_LOADERS.cases = loadCases;

function remarksOf(c) {
  const parts = [];
  if (c.returnreason) parts.push('Returned: ' + c.returnreason);
  if (c.disposaltype) parts.push('Disposal: ' + c.disposaltype);
  if (c.priorityreason) parts.push(c.priority + ': ' + c.priorityreason);
  if (c.firrefnumber) parts.push(c.firrefnumber + (c.chargesheetrefnumber ? ' / ' + c.chargesheetrefnumber : ' (no charge sheet)'));
  if (c.legacyregisterref) parts.push('Old ref ' + c.legacyregisterref);
  return parts.length ? escapeHtml(parts.join(' · ')) : dash;
}

function linksOf(c) {
  const parts = [];
  if (c.originalcaseid) parts.push('Appeal of #' + c.originalcaseid);
  if (c.leadcaseid) parts.push('With #' + c.leadcaseid);
  return parts.length ? parts.join('<br>') : dash;
}

function renderTable() {
  const q = $('filter').value.trim().toLowerCase();
  const rows = q ? allCases.filter((c) =>
    [c.caseid, c.cnr, c.casetype, c.status, c.stage, c.priority, c.courtname, c.filingdate,
     c.legacyregisterref, c.firrefnumber, c.disposaltype]
      .some((v) => String(v ?? '').toLowerCase().includes(q))) : allCases;
  $('count').textContent = `(${rows.length}${q ? ' of ' + allCases.length : ''})${me && me.courtname ? ' · ' + me.courtname : ''}`;
  if (rows.length === 0) {
    $('caseRows').innerHTML = emptyRow(13, 'No cases match the selected filters.');
    return;
  }
  $('caseRows').innerHTML = rows.map((c) => `
    <tr class="${c.caseid === highlightId ? 'highlight' : ''}">
      <td><strong>${c.caseid}</strong></td>
      <td>${cell(c.cnr)}</td>
      <td>${escapeHtml(c.casetype)}</td>
      <td>${escapeHtml(c.filingdate)}</td>
      <td>${cell(c.registrationdate)}</td>
      <td><span class="status st-${escapeHtml(c.status).replace(' ', '-')}">${escapeHtml(c.status)}</span></td>
      <td>${cell(c.stage)}</td>
      <td>${c.priority === 'Normal' ? '<span class="muted">Normal</span>' : `<span class="prio pr-${escapeHtml(c.priority)}">${escapeHtml(c.priority)}</span>`}</td>
      <td class="num">${money(c.courtfeedue)}</td>
      <td>${c.courtid} – ${escapeHtml(c.courtname)}</td>
      <td>${linksOf(c)}</td>
      <td class="remarks">${remarksOf(c)}</td>
      <td>
        <button class="btn-edit" onclick="startEdit(${c.caseid})">${isJudge() ? 'Open' : 'Edit'}</button>
        <button class="btn-delete" onclick="deleteCase(${c.caseid})">Delete</button>
      </td>
    </tr>`).join('');
}
$('filter').addEventListener('input', renderTable);

function readForm() {
  const body = {};
  fields.forEach((f) => { body[f] = $(f).disabled && f !== 'status' && f !== 'courtId' ? '' : $(f).value.trim(); });
  return body;
}

function resetForm() {
  form.reset();
  $('courtFeeDue').value = '0';
  editingId = null;
  editingCase = null;
  setStatusOptions(null);
  fields.forEach((f) => { $(f).disabled = false; });
  $('formTitle').textContent = isJudge() ? 'Case file' : 'Add new case';
  $('formTitle').classList.remove('editing');
  $('formLead').innerHTML = isJudge()
    ? 'Open a case from the list below to set its priority and stage, record hearing outcomes, pass orders and decide adjournments.'
    : `A new case always starts as a <strong>Filed</strong> case in your court${me && me.courtname ? ' (' + escapeHtml(me.courtname) + ')' : ''}. The change is logged under your name.`;
  form.classList.toggle('hidden', isJudge());
  $('submitBtn').textContent = 'Add case';
  $('cancelBtn').style.display = 'none';
  closeCaseFile();
  applyStatusRules();
}

function startEdit(id, tab) {
  const c = allCases.find((x) => x.caseid === id);
  if (!c) return false;
  editingId = id;
  editingCase = c;
  form.classList.remove('hidden');
  fields.forEach((f) => { $(f).disabled = false; });
  $('caseType').value = c.casetype;
  $('courtId').value = String(c.courtid);
  $('filingDate').value = c.filingdate;
  $('courtFeeDue').value = c.courtfeedue;
  $('priority').value = c.priority;
  setStatusOptions(c.status);
  applyStatusRules();
  $('priorityReason').value = c.priorityreason ?? '';
  $('stage').value = c.stage ?? '';
  $('cnr').value = c.cnr ?? '';
  $('registrationDate').value = c.registrationdate ?? '';
  $('returnReason').value = c.returnreason ?? '';
  $('disposalType').value = c.disposaltype ?? '';
  $('originalCaseId').value = c.originalcaseid ?? '';
  $('leadCaseId').value = c.leadcaseid ?? '';
  $('legacyRef').value = c.legacyregisterref ?? '';
  $('firNumber').value = c.firrefnumber ?? '';
  $('chargeSheetNumber').value = c.chargesheetrefnumber ?? '';
  $('formTitle').textContent = `${isJudge() ? 'Case' : 'Edit case'} #${id}${c.cnr ? ' – ' + c.cnr : ''}`;
  $('formTitle').classList.add('editing');
  $('formLead').textContent = `Current status: ${c.status}${c.stage ? ' (' + c.stage + ')' : ''}. Changes are logged under ${me.name} (${me.approle}).`;
  $('submitBtn').textContent = isJudge() ? 'Save priority and stage' : 'Save changes';
  $('cancelBtn').style.display = 'inline-block';
  clearMessage();
  openCaseFile(c, tab);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  return true;
}
$('cancelBtn').addEventListener('click', resetForm);

async function openCase(id, tab) {
  if (currentView !== 'cases') showView('cases');
  if (!allCases.some((c) => c.caseid === id)) {
    resetFilterInputs();
    await loadCases();
  }
  if (!startEdit(id, tab)) showMessage(`Case ${id} is not in your court.`, 'error');
}

async function refreshEditing() {
  await loadCases();
  if (editingId) {
    const c = allCases.find((x) => x.caseid === editingId);
    if (c) { editingCase = c; $('courtFeeDue').value = c.courtfeedue; } else { resetForm(); }
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (isJudge()) {
    if (!editingId) return;
    await act(put(`/api/cases/${editingId}/judge`, {
      priority: $('priority').value, priorityReason: $('priorityReason').value, stage: $('stage').value,
    }), async () => { highlightId = editingId; await refreshEditing(); });
    return;
  }
  const body = readForm();
  if (!body.caseType || !body.courtId || !body.filingDate) {
    showMessage('Please fill in Case type, Court and Filing date.', 'error');
    return;
  }
  const url = editingId ? `/api/cases/${editingId}` : '/api/cases';
  const method = editingId ? 'PUT' : 'POST';
  try {
    const data = await api(url, { method, body: JSON.stringify(body) });
    highlightId = data.case.caseid;
    resetForm();
    await loadCases();
    if (method === 'POST') {
      startEdit(highlightId, 'parties');
      showMessage(`${data.message} Add its parties and record the court fee in the case file below.`, 'success');
    } else {
      showMessage(data.message, 'success');
    }
  } catch (err) {
    showMessage(err.message, 'error');
  }
});

async function deleteCase(id) {
  const c = allCases.find((x) => x.caseid === id);
  const what = c ? `${c.casetype} case #${id}${c.cnr ? ' (CNR ' + c.cnr + ')' : ''}` : `case #${id}`;
  if (!(await askConfirm(`Are you sure you want to delete ${what}? This asks the database to remove the row from the COURT_CASE table.`))) return;
  try {
    const data = await api(`/api/cases/${id}`, { method: 'DELETE' });
    if (editingId === id) resetForm();
    showMessage(data.message, 'success');
    await loadCases();
  } catch (err) {
    showMessage(`Could not delete case #${id}: ${err.message}`, 'error');
  }
}

function onSignIn() {
  allCases = [];
  yearsLoaded = false;
  highlightId = null;
  resetFilterInputs();
  resetForm();
  resetCaseFileCache();
}
