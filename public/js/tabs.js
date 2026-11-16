const baseOnSignIn = onSignIn;
onSignIn = function () {
  baseOnSignIn();
  delete $('clCourtSel').dataset.touched;
  $('cdBody').innerHTML = '<p class="note">Enter a case ID of your court, or open a case from Search or the cause list.</p>';
  $('rsCurrent').innerHTML = '';
  $('rsNotify').innerHTML = '';
  $('rsBox').classList.add('hidden');
  $('tfHistory').innerHTML = '';
  $('auRows').innerHTML = emptyRow(5, 'Enter a case ID.');
  $('auInfo').textContent = '';
  $('lvCards').innerHTML = '';
  $('lvTitle').textContent = '';
  $('avRows').innerHTML = emptyRow(8, 'Choose an advocate.');
  $('avTitle').textContent = '';
  $('avInfo').textContent = '';
};

function barRow(label, value, max) {
  const pct = max ? Math.round((100 * value) / max) : 0;
  return `<div class="bar-row"><div>${escapeHtml(label)}</div><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div><div class="num"><strong>${value}</strong></div></div>`;
}

async function loadDashboard() {
  try {
    const d = await api('/api/dashboard');
    const t = d.totals;
    $('dTotals').innerHTML = [
      [t.all_cases, 'All cases'], [t.pending_cases, 'Pending cases (Registered or Hearing)'],
      [t.heard_this_month, 'Cases heard this month'], [t.hearings_today, 'Hearings listed today'],
    ].map(([v, l]) => `<div class="stat"><div class="value">${v}</div><div class="label">${escapeHtml(l)}</div></div>`).join('');
    const totalPending = d.pending.reduce((s, r) => s + Number(r.total), 0);
    const sums = d.pending.reduce((s, r) => ({ a: s.a + Number(r.upto_1y), b: s.b + Number(r.y1_to_3), c: s.c + Number(r.over_3y) }), { a: 0, b: 0, c: 0 });
    $('dPending').innerHTML = d.pending.map((r) => `
      <tr><td>${escapeHtml(r.casetype)}</td><td class="num">${r.upto_1y}</td><td class="num">${r.y1_to_3}</td><td class="num">${r.over_3y}</td>
        <td class="num"><strong>${r.total}</strong></td>
        <td><div class="bar-track"><div class="bar-fill" style="width:${totalPending ? Math.round((100 * r.total) / totalPending) : 0}%"></div></div></td></tr>`).join('')
      + `<tr><td><strong>All types</strong></td><td class="num"><strong>${sums.a}</strong></td><td class="num"><strong>${sums.b}</strong></td>
        <td class="num"><strong>${sums.c}</strong></td><td class="num"><strong>${totalPending}</strong></td><td></td></tr>`;
    const max = Math.max(...d.status.map((s) => Number(s.cases)));
    $('dStatus').innerHTML = d.status.map((s) => barRow(s.status, Number(s.cases), max)).join('');
  } catch (err) {
    showMessage(err.message, 'error');
  }
}
VIEW_LOADERS.dashboard = loadDashboard;

function openDetails(id) {
  showView('details');
  $('cdCase').value = id;
  loadDetails();
}

function section(title, headers, rowsHtml, cols, emptyText) {
  return `<h3 class="section-title">${title}</h3>${tableHtml(headers, rowsHtml, cols, emptyText)}`;
}

async function loadDetails() {
  const id = $('cdCase').value;
  if (!id) return showMessage('Enter a case ID.', 'error');
  try {
    const d = await api(`/api/cases/${encodeURIComponent(id)}/full`);
    const h = d.header;
    const askCount = {};
    d.adjournments.forEach((a) => { askCount[a.partyid] = (askCount[a.partyid] || 0) + 1; });
    $('cdBody').innerHTML = `
      <div class="box"><h4>Case #${h.caseid} · ${escapeHtml(h.cnr || 'not registered yet')}</h4><div class="kv">
        <div>Type</div><div>${escapeHtml(h.casetype)}${h.firrefnumber ? ' · ' + escapeHtml(h.firrefnumber) + (h.chargesheetrefnumber ? ' / ' + escapeHtml(h.chargesheetrefnumber) : '') : ''}</div>
        <div>Status and stage</div><div><span class="status st-${escapeHtml(h.status).replace(' ', '-')}">${escapeHtml(h.status)}</span> ${h.stage ? '· ' + escapeHtml(h.stage) : ''}${h.disposaltype ? ' · disposed by ' + escapeHtml(h.disposaltype) : ''}</div>
        <div>Priority</div><div>${priorityHtml(h.priority)}${h.priorityreason ? ' ' + escapeHtml(h.priorityreason) : ''}</div>
        <div>Court</div><div>${escapeHtml(h.courtname)} <span class="muted">(${escapeHtml(h.courttype)})</span></div>
        <div>Filed / registered</div><div>${escapeHtml(h.filingdate)} / ${cell(h.registrationdate)}</div>
        <div>Court fee still due</div><div>₹${money(h.courtfeedue)}</div>
        ${h.legacyregisterref ? `<div>Old register reference</div><div>${escapeHtml(h.legacyregisterref)}</div>` : ''}
      </div></div>
      ${d.links.length ? section('Linked cases (FR-15)', ['Relation', 'Case', 'CNR', 'Court', 'Status'], d.links.map((l) => `
        <tr><td><strong>${{
          appeal_of: `Appeal of #${l.caseid}`, appealed_in: `Appealed in #${l.caseid}`,
          lead: `Lead case #${l.caseid}`, heard_with: 'Heard with this one',
        }[l.relation]}</strong></td><td>#${l.caseid}</td><td>${cell(l.cnr)}</td>
          <td>${escapeHtml(l.courtname)} <span class="muted">(${escapeHtml(l.courttype)})</span></td>
          <td><span class="status st-${escapeHtml(l.status).replace(' ', '-')}">${escapeHtml(l.status)}</span></td></tr>`).join(''), 5, '') : ''}
      ${section(`Parties (${d.parties.length})`, ['Name', 'Role', 'Custody status', 'Advocate'], d.parties.map((p) => `
        <tr><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.partyrole)}</td><td>${cell(p.custodystatus)}</td>
          <td>${p.advocate ? escapeHtml(p.advocate) : '<span class="muted">In person</span>'}</td></tr>`).join(''), 4, 'No parties.')}
      ${section('Judge assignment history', ['Judge', 'Court', 'From', 'To', 'Type', 'Handover note'], d.assignments.map((a) => `
        <tr><td>${escapeHtml(a.judge)} <span class="muted">${escapeHtml(a.designation)}</span></td><td>${escapeHtml(a.courtname)}</td>
          <td>${escapeHtml(a.assigneddate)}</td><td>${a.enddate ? escapeHtml(a.enddate) : '<strong>current</strong>'}</td>
          <td>${escapeHtml(a.assignmenttype)}</td><td class="wrap">${cell(a.handovernote)}</td></tr>`).join(''), 6, 'No judge assigned yet.')}
      ${section(`Hearings (${d.hearings.length})`, ['Date', 'Time', 'Mode', 'Courtroom / VC link', 'Judge', 'Outcome'], d.hearings.map((x) => `
        <tr><td>${escapeHtml(x.hearingdate)}</td><td>${fmtTime(x.hearingtime)}–${fmtTime(x.endtime)}</td><td>${escapeHtml(x.mode)}</td>
          <td>${x.mode === 'Video Conference' ? escapeHtml(x.vclink) : 'Court Room ' + escapeHtml(x.courtroomnumber)}</td>
          <td>${escapeHtml(x.judge)}</td><td>${escapeHtml(x.outcome)}</td></tr>`).join(''), 6, 'No hearings.')}
      ${section(`Orders (${d.orders.length})`, ['Order', 'Date', 'Type', 'Order text', 'Related order', 'Conditions'], d.orders.map((o) => `
        <tr><td>#${o.orderid}</td><td>${escapeHtml(o.orderdate)}</td><td>${escapeHtml(o.ordertype)}</td><td class="wrap">${escapeHtml(o.ordertext)}</td>
          <td>${o.relatedorderid ? 'follows #' + o.relatedorderid : dash}</td><td class="wrap">${cell(o.conditions)}</td></tr>`).join(''), 6, 'No orders.')}
      ${section(`Adjournments (${d.adjournments.length})`, ['Hearing', 'Asked by', 'Ground', 'Opposed', 'Decision', 'Reason'], d.adjournments.map((a) => `
        <tr><td>${escapeHtml(a.hearingdate)}</td>
          <td>${escapeHtml(a.sought_by)}${askCount[a.partyid] > 2 ? `<span class="badge-warn" title="Same party asked more than twice in this case (FR-21)">⚠ asked ${askCount[a.partyid]}×</span>` : ''}</td>
          <td class="wrap">${escapeHtml(a.ground)}</td><td>${a.opposedflag ? 'Yes' : 'No'}</td><td>${escapeHtml(a.decision)}</td>
          <td class="wrap">${cell(a.decisionreason)}</td></tr>`).join(''), 6, 'No adjournments.')}`;
  } catch (err) {
    $('cdBody').innerHTML = '';
    showMessage(err.message, 'error');
  }
}
$('cdForm').addEventListener('submit', (e) => { e.preventDefault(); loadDetails(); });

let rsHearing = null;

function openReschedule(hid) {
  showView('reschedule');
  $('rsHearing').value = hid;
  loadReschedule();
}

async function loadReschedule() {
  const hid = $('rsHearing').value;
  if (!hid) return showMessage('Enter a hearing ID.', 'error');
  $('rsNotify').innerHTML = '';
  try {
    const h = await api(`/api/hearings/${encodeURIComponent(hid)}`);
    rsHearing = h;
    $('rsCurrent').innerHTML = `<div class="box"><h4>Hearing #${h.hearingid} · ${escapeHtml(h.cnr || 'Case #' + h.caseid)} (${escapeHtml(h.casetype)})</h4><div class="kv">
      <div>Court</div><div>${escapeHtml(h.courtname)}</div>
      <div>Now listed for</div><div>${escapeHtml(h.hearingdate)}, ${fmtTime(h.hearingtime)}–${fmtTime(h.endtime)}</div>
      <div>Venue</div><div>${h.mode === 'Video Conference' ? 'Video Conference' : 'Court Room ' + escapeHtml(h.courtroomnumber)}</div>
      <div>Judge</div><div>${escapeHtml(h.judge)}</div>
      <div>Outcome</div><div>${escapeHtml(h.outcome)}${h.outcome === 'Listed' ? '' : ' – already held, so it cannot be moved'}</div>
    </div></div>`;
    const rooms = await lookup('rooms-' + h.courtid, `/api/courtrooms?court=${h.courtid}`);
    $('rsRoom').innerHTML = rooms.map((r) => `<option value="${r}">Court Room ${r}</option>`).join('');
    $('rsRoom').value = String(h.courtroomnumber || rooms[0]);
    $('rsRoom').disabled = h.mode === 'Video Conference';
    $('rsDate').value = h.hearingdate;
    $('rsStart').value = fmtTime(h.hearingtime);
    $('rsEnd').value = fmtTime(h.endtime);
    $('rsBox').classList.toggle('hidden', h.outcome !== 'Listed' || !isStaff());
  } catch (err) {
    rsHearing = null;
    $('rsCurrent').innerHTML = '';
    $('rsBox').classList.add('hidden');
    showMessage(err.message, 'error');
  }
}
$('rsLoadForm').addEventListener('submit', (e) => { e.preventDefault(); loadReschedule(); });

$('rsGo').addEventListener('click', async () => {
  if (!rsHearing) return;
  try {
    const d = await post(`/api/hearings/${rsHearing.hearingid}/reschedule`, {
      date: $('rsDate').value, start: $('rsStart').value, end: $('rsEnd').value, room: $('rsRoom').disabled ? '' : $('rsRoom').value,
    });
    showMessage(d.message, 'success');
    const keep = { date: $('rsDate').value, start: $('rsStart').value, end: $('rsEnd').value };
    await loadReschedule();
    Object.assign(rsHearing, keep);
    $('rsNotify').innerHTML = `<h3 class="section-title">People to be told of the change (v_notification_queue)</h3>`
      + tableHtml(['To', 'Phone', 'Case', 'Moved from', 'Moved to', 'Venue', 'Message'], d.notifications.map((n) => `
        <tr><td>${escapeHtml(n.name)}<br><span class="muted">${escapeHtml(n.audience)}</span></td><td>${escapeHtml(n.phone)}</td>
          <td>${escapeHtml(n.cnr)}</td><td>${escapeHtml(n.olddate)} ${escapeHtml(n.oldtime)}</td><td>${escapeHtml(n.newdate)} ${escapeHtml(n.newtime)}</td>
          <td>${escapeHtml(n.venue)}</td><td class="wrap">${escapeHtml(n.message)}</td></tr>`).join(''), 7, 'Nobody to notify.');
  } catch (err) {
    showMessage(err.message, 'error');
  }
});
VIEW_LOADERS.reschedule = () => {};

let tfCases = [];

async function loadTransfer() {
  try {
    if (!$('tfDate').value) $('tfDate').value = todayIso();
    tfCases = await api('/api/transfer/cases');
    $('tfCase').innerHTML = optionList(tfCases, 'caseid',
      (c) => `#${c.caseid} ${c.cnr || ''} ${c.casetype} (${c.status}) – judge: ${c.current_judge || 'none'}`, tfCases.length ? '-- select a case --' : 'No Registered or Hearing case');
    lookups.judgesAll = lookups.judgesAll || await api('/api/judges');
    syncTransferJudges();
  } catch (err) {
    showMessage(err.message, 'error');
  }
}
VIEW_LOADERS.transfer = loadTransfer;

function syncTransferJudges() {
  const c = tfCases.find((x) => String(x.caseid) === $('tfCase').value);
  const roster = $('tfType').value === 'Roster';
  const list = (lookups.judgesAll || []).filter((j) => (!c || j.personid !== c.current_judgeid) && (!roster || (me && j.courtid === me.courtid)));
  $('tfJudge').innerHTML = optionList(list, 'personid', (j) => `${j.name} – ${j.designation}, ${j.courtname}`, '-- select the new judge --');
}
$('tfCase').addEventListener('change', syncTransferJudges);
$('tfType').addEventListener('change', syncTransferJudges);

$('tfGo').addEventListener('click', async () => {
  const caseId = $('tfCase').value;
  if (!caseId || !$('tfJudge').value) return showMessage('Choose the case and the new judge.', 'error');
  try {
    const d = await post(`/api/cases/${caseId}/transfer`, {
      judgeId: $('tfJudge').value, date: $('tfDate').value, type: $('tfType').value, note: $('tfNote').value,
    });
    showMessage(d.message, 'success');
    $('tfHistory').innerHTML = `<h3 class="section-title">Assignment history of case #${caseId}</h3>`
      + tableHtml(['Judge', 'Court', 'From', 'To', 'Type', 'Handover note'], d.assignments.map((a) => `
        <tr><td>${escapeHtml(a.judge)} <span class="muted">${escapeHtml(a.designation)}</span></td><td>${escapeHtml(a.courtname)}</td>
          <td>${escapeHtml(a.assigneddate)}</td><td>${a.enddate ? escapeHtml(a.enddate) : '<strong>current</strong>'}</td>
          <td>${escapeHtml(a.assignmenttype)}</td><td class="wrap">${cell(a.handovernote)}</td></tr>`).join(''), 6, 'The case has left your court.');
    const keepCase = caseId;
    await loadTransfer();
    $('tfCase').value = keepCase;
    syncTransferJudges();
  } catch (err) {
    showMessage(err.message, 'error');
  }
});

async function loadAudit() {
  const id = $('auCase').value;
  if (!id) return showMessage('Enter a case ID.', 'error');
  try {
    const rows = await api(`/api/cases/${encodeURIComponent(id)}/history`);
    $('auInfo').textContent = `${rows.length} change${rows.length === 1 ? '' : 's'} recorded for case #${id}, newest first.`;
    $('auRows').innerHTML = rows.length ? rows.map((r) => `
      <tr><td>${escapeHtml(new Date(r.changedat).toLocaleString('en-IN'))}</td><td>${escapeHtml(r.tablename)}</td>
        <td>${escapeHtml(r.action)}</td><td>${escapeHtml(r.changed_by)}</td><td class="diff wrap">${auditDiff(r)}</td></tr>`).join('')
      : emptyRow(5, 'No changes recorded.');
  } catch (err) {
    $('auRows').innerHTML = emptyRow(5, 'No result.');
    showMessage(err.message, 'error');
  }
}
$('auForm').addEventListener('submit', (e) => { e.preventDefault(); loadAudit(); });
VIEW_LOADERS.audit = () => {};

async function loadAdvocatePicker() {
  try {
    if (!$('avPerson').options.length) {
      const advocates = await api('/api/advocates');
      $('avPerson').innerHTML = optionList(advocates, 'personid',
        (a) => `#${a.personid} – ${a.name} (${a.barregistrationnumber}, ${a.barstatus})`, '-- select an advocate --');
    }
  } catch (err) {
    showMessage(err.message, 'error');
  }
}
VIEW_LOADERS.aview = loadAdvocatePicker;

$('avForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!$('avPerson').value) return showMessage('Choose an advocate.', 'error');
  try {
    const d = await api(`/api/advocate-view?person=${encodeURIComponent($('avPerson').value)}`);
    const coming = d.cases.filter((c) => c.next_hearing).length;
    $('avTitle').textContent = `What ${d.advocate.name} (#${d.advocate.personid}, ${d.advocate.barregistrationnumber}) sees`;
    $('avInfo').textContent = `${d.cases.length} case${d.cases.length === 1 ? '' : 's'} across courts, ${coming} with a coming hearing.`;
    $('avRows').innerHTML = d.cases.length ? d.cases.map((c) => `
      <tr><td>${escapeHtml(c.cnr || 'Not registered')}</td><td>${escapeHtml(c.casetype)}</td>
        <td><span class="status st-${escapeHtml(c.status).replace(' ', '-')}">${escapeHtml(c.status)}</span></td>
        <td>${cell(c.stage)}</td><td>${priorityHtml(c.priority)}</td><td>${escapeHtml(c.courtname)}</td>
        <td class="wrap">${cell(c.my_clients)}</td><td>${cell(c.next_hearing)}</td></tr>`).join('')
      : emptyRow(8, 'This advocate does not represent anyone yet.');
  } catch (err) {
    showMessage(err.message, 'error');
  }
});

async function loadLitigantPicker() {
  try {
    if (!$('lvPerson').options.length) {
      const parties = await lookup('parties', '/api/parties');
      $('lvPerson').innerHTML = optionList(parties, 'personid', (p) => `#${p.personid} – ${p.name}`, '-- select a party --');
    }
  } catch (err) {
    showMessage(err.message, 'error');
  }
}
VIEW_LOADERS.lview = loadLitigantPicker;

$('lvForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!$('lvPerson').value) return showMessage('Choose a party.', 'error');
  try {
    const d = await api(`/api/litigant-view?person=${encodeURIComponent($('lvPerson').value)}`);
    $('lvTitle').textContent = `What ${d.party.name} (#${d.party.personid}) sees`;
    $('lvCards').innerHTML = d.cases.length ? d.cases.map((c) => `
      <div class="portal-card">
        <h3>${c.case_number === 'Not yet registered' ? 'Filing (not yet registered)' : 'Case ' + escapeHtml(c.case_number)}</h3>
        <p class="big">${escapeHtml(c.what_is_happening)}</p>
        <p><strong>Where it stands:</strong> ${escapeHtml(c.current_step)}</p>
        <p><strong>Next hearing:</strong> ${c.next_hearing_date ? `${escapeHtml(c.next_hearing_date)} at ${fmtTime(c.next_hearing_time)}` : 'No date has been fixed yet.'}</p>
        ${c.where_to_appear ? `<p><strong>Where to appear:</strong> ${escapeHtml(c.where_to_appear)}</p>` : ''}
      </div>`).join('') : '<p class="muted">This person is not a party in any case.</p>';
  } catch (err) {
    showMessage(err.message, 'error');
  }
});
