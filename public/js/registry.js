const priorityHtml = (p) => (p === 'Normal' ? '<span class="muted">Normal</span>' : `<span class="prio pr-${escapeHtml(p)}">${escapeHtml(p)}</span>`);
const caseLink = (id, cnr) => `<a href="#" onclick="openCase(${id}); return false;">${escapeHtml(cnr || 'Case #' + id)}</a>`;

async function loadCauseList() {
  if (!$('clDate').value) $('clDate').value = todayIso();
  try {
    const d = await api(`/api/causelist?date=${encodeURIComponent($('clDate').value)}`);
    $('clCourt').textContent = '· ' + d.court;
    $('clInfo').textContent = `${d.rows.length} matter${d.rows.length === 1 ? '' : 's'} listed for ${d.date}. List generated in ${d.ms.toFixed(1)} ms (NFR-03).`;
    $('clRows').innerHTML = d.rows.length ? d.rows.map((r) => `
      <tr><td>${r.sr_no}</td><td>${fmtTime(r.hearingtime)}–${fmtTime(r.endtime)}</td>
        <td>${r.mode === 'Video Conference' ? `Video Conference<br><span class="muted">${escapeHtml(r.vclink)}</span>` : escapeHtml(r.venue)}</td>
        <td>${caseLink(r.caseid, r.cnr)}</td><td>${escapeHtml(r.casetype)}</td><td>${priorityHtml(r.priority)}</td>
        <td>${cell(r.stage)}</td><td class="wrap">${cell(r.parties)}</td><td>${escapeHtml(r.judge)}</td><td>${escapeHtml(r.outcome)}</td></tr>`).join('')
      : emptyRow(10, 'No hearings are listed in your court on this date.');
  } catch (err) {
    showMessage(err.message, 'error');
  }
}
VIEW_LOADERS.causelist = loadCauseList;
$('clLoad').addEventListener('click', loadCauseList);
$('clDate').addEventListener('change', loadCauseList);
$('clPrint').addEventListener('click', () => window.print());

$('searchForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const params = new URLSearchParams();
  [['cnr', 'sCnr'], ['party', 'sParty'], ['advocate', 'sAdvocate'], ['from', 'sFrom'], ['to', 'sTo'], ['legacy', 'sLegacy']]
    .forEach(([k, id]) => { if ($(id).value.trim()) params.set(k, $(id).value.trim()); });
  try {
    const d = await api('/api/search?' + params);
    $('sInfo').textContent = `${d.rows.length} case${d.rows.length === 1 ? '' : 's'} found in ${d.ms.toFixed(1)} ms${me.courtname ? ' (your court: ' + me.courtname + ')' : ''}.`;
    $('sRows').innerHTML = d.rows.length ? d.rows.map((r) => `
      <tr><td>${r.caseid}</td><td>${cell(r.cnr)}</td><td>${escapeHtml(r.casetype)}</td><td>${escapeHtml(r.status)}</td>
        <td>${cell(r.stage)}</td><td>${escapeHtml(r.court)}</td><td>${escapeHtml(r.filingdate)}</td><td>${cell(r.legacyref)}</td>
        <td><button class="btn-edit" onclick="openCase(${r.caseid})">Open</button></td></tr>`).join('')
      : emptyRow(9, 'No case matches.');
  } catch (err) {
    showMessage(err.message, 'error');
  }
});
VIEW_LOADERS.search = () => { $('sInfo').textContent = me && me.courtname ? `Searches cover the cases of ${me.courtname}.` : ''; };

const BAND_LABELS = { upto_3m: 'up to 3 months old', m3_to_6: '3–6 months old', m6_to_12: '6–12 months old', over_1y: 'over 1 year old', total: 'pending' };

async function loadReports() {
  try {
    const d = await api('/api/reports');
    $('rCourt').textContent = '· ' + d.court;
    const drill = (type, band, n) => (Number(n) > 0
      ? `<td class="num drill" onclick="drillPending('${type || ''}', '${band}')">${n}</td>` : `<td class="num">${n}</td>`);
    const totals = d.pendency.reduce((t, r) => {
      ['upto_3m', 'm3_to_6', 'm6_to_12', 'over_1y', 'total'].forEach((k) => { t[k] = (t[k] || 0) + Number(r[k]); });
      return t;
    }, {});
    $('rPendency').innerHTML = d.pendency.length ? d.pendency.map((r) => `
      <tr><td>${escapeHtml(r.casetype)}</td>${drill(r.casetype, 'upto_3m', r.upto_3m)}${drill(r.casetype, 'm3_to_6', r.m3_to_6)}
        ${drill(r.casetype, 'm6_to_12', r.m6_to_12)}${drill(r.casetype, 'over_1y', r.over_1y)}${drill(r.casetype, 'total', r.total)}
        <td class="num">${r.avg_age_days}</td></tr>`).join('')
      + `<tr><td><strong>All types</strong></td>${drill('', 'upto_3m', totals.upto_3m)}${drill('', 'm3_to_6', totals.m3_to_6)}
        ${drill('', 'm6_to_12', totals.m6_to_12)}${drill('', 'over_1y', totals.over_1y)}${drill('', 'total', totals.total)}<td></td></tr>`
      : emptyRow(7, 'No pending cases.');
    $('rDisposal').innerHTML = d.disposal.length ? d.disposal.map((r) => `
      <tr><td>${escapeHtml(r.disposaltype)}</td><td class="num">${r.cases}</td><td class="num">${r.pct}%</td></tr>`).join('')
      : emptyRow(3, 'No decided cases.');
    $('rRepeat').innerHTML = d.repeatGrounds.length ? d.repeatGrounds.map((r) => `
      <tr><td>${caseLink(r.caseid, r.cnr)}</td><td class="wrap">${escapeHtml(r.ground)}</td><td class="num">${r.times_used}</td>
        <td>${escapeHtml(r.decisions)}</td><td>${escapeHtml(r.last_used_on)}</td>
        <td><button class="btn-edit" onclick="openCase(${r.caseid}, 'adjournments')">Adjournments</button></td></tr>`).join('')
      : emptyRow(6, 'No ground has been used twice in one case.');
    $('rDrillTitle').classList.add('hidden');
    $('rDrillWrap').classList.add('hidden');
  } catch (err) {
    showMessage(err.message, 'error');
  }
}
VIEW_LOADERS.reports = loadReports;

async function drillPending(type, band) {
  try {
    const rows = await api(`/api/reports/pending?band=${band}${type ? '&type=' + encodeURIComponent(type) : ''}`);
    $('rDrillTitle').textContent = `${type || 'All'} cases ${BAND_LABELS[band]} (${rows.length})`;
    $('rDrillTitle').classList.remove('hidden');
    $('rDrillWrap').classList.remove('hidden');
    $('rDrill').innerHTML = rows.map((r) => `
      <tr><td>${r.caseid}</td><td>${cell(r.cnr)}</td><td>${escapeHtml(r.casetype)}</td><td>${escapeHtml(r.status)}</td>
        <td>${cell(r.stage)}</td><td>${priorityHtml(r.priority)}</td><td>${escapeHtml(r.filingdate)}</td><td class="num">${r.age_days}</td>
        <td><button class="btn-edit" onclick="openCase(${r.caseid})">Open</button></td></tr>`).join('') || emptyRow(9, 'No cases.');
    $('rDrillTitle').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    showMessage(err.message, 'error');
  }
}

async function loadNotifications() {
  try {
    const rows = await api('/api/notifications');
    $('nAll').checked = false;
    $('nRows').innerHTML = rows.length ? rows.map((r) => `
      <tr><td>${r.sentAt ? '' : `<input type="checkbox" class="nPick" value="${escapeHtml(r.key)}">`}</td>
        <td>${escapeHtml(r.name)}<br><span class="muted">${escapeHtml(r.audience)}</span></td><td>${escapeHtml(r.phone)}</td>
        <td>${escapeHtml(r.cnr || '—')}<br><span class="muted">${escapeHtml(r.courtname)}</span></td>
        <td>${escapeHtml(r.olddate)} ${escapeHtml(r.oldtime)}</td><td>${escapeHtml(r.newdate)} ${escapeHtml(r.newtime)}</td>
        <td>${escapeHtml(r.venue)}</td><td class="wrap">${escapeHtml(r.message)}</td>
        <td>${r.sentAt ? `Sent ${escapeHtml(new Date(r.sentAt).toLocaleTimeString('en-IN'))}` : '<strong>Waiting</strong>'}</td></tr>`).join('')
      : emptyRow(9, 'No hearing has been moved in the last 24 hours, so nobody needs to be told. Move a hearing from a case file to see it here.');
  } catch (err) {
    showMessage(err.message, 'error');
  }
}
VIEW_LOADERS.notifications = loadNotifications;
$('nReload').addEventListener('click', loadNotifications);
$('nAll').addEventListener('change', () => document.querySelectorAll('.nPick').forEach((c) => { c.checked = $('nAll').checked; }));
$('nSend').addEventListener('click', async () => {
  const keys = [...document.querySelectorAll('.nPick:checked')].map((c) => c.value);
  if (!keys.length) return showMessage('Tick the notifications to send.', 'error');
  await act(post('/api/notifications/send', { keys }), loadNotifications);
});
