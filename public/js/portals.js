function docRows(docs, cols) {
  return docs.length ? docs.map((d) => `
    <tr><td>${escapeHtml(d.cnr || '—')}</td><td>${escapeHtml(d.documenttype)}</td><td>${escapeHtml(d.submissiondate)}</td><td>${escapeHtml(d.casestage)}</td></tr>`).join('')
    : emptyRow(cols, 'No documents yet.');
}

async function loadLitigant() {
  try {
    const d = await api('/api/portal/litigant');
    $('lCases').innerHTML = d.cases.length ? d.cases.map((c) => `
      <div class="portal-card">
        <h3>Case ${escapeHtml(c.case_number)}</h3>
        <p class="big">${escapeHtml(c.what_is_happening)}</p>
        <p><strong>Where it stands:</strong> ${escapeHtml(c.current_step)}</p>
        <p><strong>Next hearing:</strong> ${c.next_hearing_date
          ? `${escapeHtml(c.next_hearing_date)} at ${fmtTime(c.next_hearing_time)}`
          : 'No date has been fixed yet.'}</p>
        ${c.where_to_appear ? `<p><strong>Where to appear:</strong> ${escapeHtml(c.where_to_appear)}</p>` : ''}
      </div>`).join('') : '<p class="muted">You are not a party in any case.</p>';
    $('lEvents').innerHTML = d.events.length ? d.events.map((e) => `
      <tr><td>${escapeHtml(e.cnr || '—')}</td><td>${escapeHtml(e.hearingdate)}</td><td>${fmtTime(e.hearingtime)}</td>
        <td>${e.mode === 'Video Conference' ? 'Online' : escapeHtml(e.venue)}</td><td>${escapeHtml(e.outcome)}</td>
        <td class="wrap">${e.ordertext ? `${escapeHtml(e.ordertype)} order: ${escapeHtml(e.ordertext)}` : dash}</td>
        <td class="wrap">${e.adjournment_ground ? `${escapeHtml(e.adjournment_ground)} (${escapeHtml(e.adjournment_decision)})` : dash}</td></tr>`).join('')
      : emptyRow(7, 'No hearings yet.');
    $('lDocs').innerHTML = docRows(d.documents, 4);
  } catch (err) {
    showMessage(err.message, 'error');
  }
}
VIEW_LOADERS.litigant = loadLitigant;

async function loadAdvocate() {
  try {
    const d = await api('/api/portal/advocate');
    $('aCount').textContent = `(${d.cases.length})`;
    $('aCases').innerHTML = d.cases.length ? d.cases.map((c) => `
      <tr><td>${escapeHtml(c.cnr || 'Not registered')}</td><td>${escapeHtml(c.casetype)}</td><td>${escapeHtml(c.status)}</td>
        <td>${cell(c.stage)}</td><td>${priorityHtml(c.priority)}</td><td>${escapeHtml(c.courtname)}</td>
        <td class="wrap">${cell(c.my_clients)}</td><td>${cell(c.next_hearing)}</td></tr>`).join('')
      : emptyRow(8, 'You do not represent anyone yet.');
    $('aEvents').innerHTML = d.events.length ? d.events.map((e) => `
      <tr><td>${escapeHtml(e.hearingdate)}</td><td>${fmtTime(e.hearingtime)}</td><td>${escapeHtml(e.cnr || '—')}</td><td>${escapeHtml(e.mode)}</td>
        <td>${e.vclink ? `<a href="${escapeHtml(e.vclink)}" target="_blank" rel="noopener">${escapeHtml(e.vclink)}</a>` : escapeHtml(e.venue)}</td>
        <td>${escapeHtml(e.outcome)}</td></tr>`).join('')
      : emptyRow(6, 'No coming hearings.');
    $('aDocs').innerHTML = docRows(d.documents, 4);
  } catch (err) {
    showMessage(err.message, 'error');
  }
}
VIEW_LOADERS.advocate = loadAdvocate;

let adminAccounts = [];

function renderAccounts() {
  const role = $('accFilter').value;
  const rows = adminAccounts.filter((a) => !role || a.approle === role);
  $('accRows').innerHTML = rows.length ? rows.map((a) => `
    <tr><td>#${a.userid}</td><td>${a.personid}</td><td>${escapeHtml(a.approle)}</td><td>${cell(a.courtid)}</td>
      <td>${a.isactive ? 'Yes' : '<strong>No</strong>'}</td>
      <td>${a.personid === me.personid ? '<span class="muted">you</span>'
        : `<button class="${a.isactive ? 'btn-delete' : 'btn-edit'}" onclick="setActive(${a.userid}, ${!a.isactive})">${a.isactive ? 'Deactivate' : 'Activate'}</button>`}</td></tr>`).join('')
    : emptyRow(6, 'No accounts.');
}

async function loadAdmin() {
  try {
    const d = await api('/api/admin/accounts');
    adminAccounts = d.accounts;
    renderAccounts();
    $('auditRows').innerHTML = d.summary.map((s) => `
      <tr><td>${escapeHtml(s.tablename)}</td><td>${escapeHtml(s.action)}</td><td class="num">${s.changes}</td>
        <td>${escapeHtml(new Date(s.last_activity).toLocaleString('en-IN'))}</td></tr>`).join('') || emptyRow(4, 'No activity.');
  } catch (err) {
    showMessage(err.message, 'error');
  }
}
VIEW_LOADERS.admin = loadAdmin;
$('accFilter').addEventListener('change', renderAccounts);

async function setActive(uid, active) {
  await act(put(`/api/admin/accounts/${uid}/active`, { active }), loadAdmin);
}

$('accForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  await act(post('/api/admin/accounts', { personId: $('accPerson').value, role: $('accRole').value, courtId: $('accCourt').value }),
    async () => { $('accPerson').value = ''; $('accCourt').value = ''; await loadAdmin(); });
});
