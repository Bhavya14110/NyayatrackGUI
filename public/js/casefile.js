const PARTY_ROLES = ['Complainant', 'Accused', 'Petitioner', 'Respondent', 'Plaintiff', 'Defendant', 'Appellant'];
const OUTCOMES = ['Listed', 'Adjourned', 'Evidence Recorded', 'Part Heard', 'Arguments Heard', 'Interim Order', 'Order Reserved', 'Disposed'];
const DOC_TYPES = ['Complaint', 'Evidence Affidavit', 'Exhibit', 'Memo of Appeal', 'Notice', 'Petition', 'Plaint', 'Reply',
  'Summons', 'Vakalatnama', 'Writ Petition', 'Written Arguments', 'Written Statement'];
const DOC_STAGES = ['Filing', 'Scrutiny', 'Pleadings', 'Evidence', 'Arguments', 'Judgment', 'Appeal'];

let cfCase = null;
let cfTab = 'parties';
let cfHearings = [];
let cfParties = [];
let cfNewDocument = null;
const lookups = {};

const simpleOptions = (list, selected) => list.map((v) => `<option${v === selected ? ' selected' : ''}>${escapeHtml(v)}</option>`).join('');
const custodyOptions = '<option value="">-- none --</option>' + simpleOptions(['In Custody', 'On Bail', 'Not Arrested']);

function resetCaseFileCache() {
  Object.keys(lookups).forEach((k) => delete lookups[k]);
}

async function lookup(key, url) {
  if (!lookups[key]) lookups[key] = await api(url);
  return lookups[key];
}

function openCaseFile(c, tab) {
  cfCase = c;
  $('caseFile').classList.remove('hidden');
  showCfTab(tab || cfTab || 'parties');
}

function closeCaseFile() {
  cfCase = null;
  $('caseFile').classList.add('hidden');
  $('cfBody').innerHTML = '';
}

document.querySelectorAll('#cfTabs button').forEach((b) => b.addEventListener('click', () => showCfTab(b.dataset.tab)));

async function showCfTab(tab) {
  if (!cfCase) return;
  cfTab = tab;
  document.querySelectorAll('#cfTabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('cfBody').innerHTML = '<p class="muted">Loading…</p>';
  try {
    await CF_RENDER[tab]();
  } catch (err) {
    $('cfBody').innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
  }
}

const cid = () => cfCase.caseid;
const val = (id) => ($(id) ? $(id).value.trim() : '');

function bindCustody(roleId, custodyId) {
  const sync = () => {
    $(custodyId).disabled = $(roleId).value !== 'Accused';
    if ($(custodyId).disabled) $(custodyId).value = '';
  };
  $(roleId).addEventListener('change', sync);
  sync();
}

function tableHtml(headers, rowsHtml, cols, emptyText) {
  return `<div class="table-wrap short"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>`
    + `<tbody>${rowsHtml || emptyRow(cols, emptyText)}</tbody></table></div>`;
}

const hearingLabel = (h) => `${h.hearingdate} ${fmtTime(h.hearingtime)} – ${h.outcome}`;

async function loadHearingsAndParties() {
  const [hearings, details] = await Promise.all([
    api(`/api/cases/${cid()}/hearings`), api(`/api/cases/${cid()}/details`)]);
  cfHearings = hearings;
  cfParties = details.parties;
  return { hearings, details };
}

const CF_RENDER = {
  async parties() {
    const d = await api(`/api/cases/${cid()}/details`);
    cfParties = d.parties;
    let html = tableHtml(['Name', 'Role', 'Custody', 'Advocate'], d.parties.map((p) => `
      <tr><td>${escapeHtml(p.name)} <span class="muted">#${p.personid}</span></td><td>${escapeHtml(p.partyrole)}</td>
          <td>${cell(p.custodystatus)}</td><td>${p.advocate ? escapeHtml(p.advocate) : '<span class="muted">In person</span>'}</td></tr>`).join(''),
      4, 'No parties yet. A case needs at least one party before it can be registered (FR-14, FR-17).');
    if (isStaff()) {
      const [parties, pins] = await Promise.all([lookup('parties', '/api/parties'), lookup('pincodes', '/api/pincodes')]);
      html += `
        <div class="box"><h4>Add an existing party</h4>
          <div class="inline-form">
            <div class="wide"><label for="pPerson">Party</label><select id="pPerson">${optionList(parties, 'personid', (p) => `${p.name} (#${p.personid})`, '-- select a party --')}</select></div>
            <div><label for="pRole">Role</label><select id="pRole">${simpleOptions(PARTY_ROLES)}</select></div>
            <div><label for="pCustody">Custody <span class="hint">(accused)</span></label><select id="pCustody">${custodyOptions}</select></div>
            <div><button type="button" class="btn-primary" onclick="addParty()">Add party</button></div>
          </div>
        </div>
        <div class="box"><h4>Register a new person as a party</h4>
          <p class="note">The database stops a possible duplicate: the same name with the same phone number (FR-16).</p>
          <div class="inline-form">
            <div><label for="npName">Full name</label><input id="npName" maxlength="100"></div>
            <div class="wide"><label for="npAddress">Address</label><input id="npAddress" maxlength="150"></div>
            <div><label for="npPin">Pincode</label><select id="npPin">${optionList(pins, 'pincode', (p) => `${p.pincode} – ${p.city}, ${p.state}`, '-- select --')}</select></div>
            <div><label for="npPhone">Phone</label><input id="npPhone" maxlength="10" placeholder="10 digits"></div>
            <div><label for="npRole">Role</label><select id="npRole">${simpleOptions(PARTY_ROLES)}</select></div>
            <div><label for="npCustody">Custody <span class="hint">(accused)</span></label><select id="npCustody">${custodyOptions}</select></div>
            <div><button type="button" class="btn-primary" onclick="addNewParty()">Register and add</button></div>
          </div>
        </div>`;
    }
    $('cfBody').innerHTML = html;
    if (isStaff()) { bindCustody('pRole', 'pCustody'); bindCustody('npRole', 'npCustody'); }
  },

  async fee() {
    const d = await api(`/api/cases/${cid()}/details`);
    let html = `<p><strong>Fee still due: ₹${money(d.courtfeedue)}</strong></p>`
      + tableHtml(['Receipt', 'Date', '<span class="num">Amount (₹)</span>'], d.payments.map((p) => `
        <tr><td>${escapeHtml(p.receiptnumber)}</td><td>${escapeHtml(p.paymentdate)}</td><td class="num">${money(p.paymentamount)}</td></tr>`).join(''),
      3, 'No payments recorded yet.')
      + '<p class="note">A receipt is never edited or deleted (FR-25). Each payment lowers the fee due automatically; a correction is recorded as a new payment.</p>';
    if (isStaff()) {
      html += `<div class="box"><h4>Record a payment</h4><div class="inline-form">
        <div><label for="payAmount">Amount (₹)</label><input type="number" id="payAmount" min="1" step="0.01" value="${Number(d.courtfeedue) > 0 ? d.courtfeedue : ''}"></div>
        <div><label for="payDate">Payment date</label><input type="date" id="payDate" value="${todayIso()}"></div>
        <div><button type="button" class="btn-primary" onclick="recordPayment()">Record payment</button></div>
      </div></div>`;
    }
    $('cfBody').innerHTML = html;
  },

  async hearings() {
    const rows = await api(`/api/cases/${cid()}/hearings`);
    cfHearings = rows;
    const canOutcome = isJudge() || isClerk();
    let html = tableHtml(['#', 'Date', 'Time', 'Mode / venue', 'Judge', 'Outcome', 'Orders', ''], rows.map((h) => `
      <tr><td>${h.hearingid}</td><td>${escapeHtml(h.hearingdate)}</td><td>${fmtTime(h.hearingtime)}–${fmtTime(h.endtime)}</td>
        <td>${h.mode === 'Video Conference' ? `Video: <a href="${escapeHtml(h.vclink)}" target="_blank" rel="noopener">${escapeHtml(h.vclink)}</a>` : 'Court Room ' + escapeHtml(h.courtroomnumber)}</td>
        <td>${escapeHtml(h.judge)}</td>
        <td>${canOutcome ? `<select id="out-${h.hearingid}">${simpleOptions(OUTCOMES, h.outcome)}</select>` : escapeHtml(h.outcome)}</td>
        <td>${h.orders}</td>
        <td>${canOutcome ? `<button class="btn-edit" onclick="saveOutcome(${h.hearingid})">Save outcome</button> ` : ''}${isStaff() && h.outcome === 'Listed' ? `<button class="btn-secondary btn-small" onclick="showMove(${h.hearingid})">Move</button>` : ''}</td></tr>`).join(''),
      8, 'No hearings yet. Hearings can be fixed once the case is registered.');
    html += '<div id="moveBox"></div>';
    if (isStaff()) {
      const [judges, rooms] = await Promise.all([
        lookup('judges-' + cfCase.courtid, `/api/judges?court=${cfCase.courtid}`),
        lookup('rooms-' + cfCase.courtid, `/api/courtrooms?court=${cfCase.courtid}`)]);
      html += `<div class="box"><h4>Fix a hearing</h4>
        <p class="note">The database refuses a courtroom or judge that is already booked at that time (FR-28), and adds the hearing to that day's cause list.</p>
        <div class="inline-form">
          <div><label for="hDate">Date</label><input type="date" id="hDate"></div>
          <div><label for="hStart">Starts</label><input type="time" id="hStart" value="10:30"></div>
          <div><label for="hEnd">Ends</label><input type="time" id="hEnd" value="11:00"></div>
          <div><label for="hMode">Mode</label><select id="hMode"><option>In Person</option><option>Video Conference</option></select></div>
          <div><label for="hRoom">Courtroom</label><select id="hRoom">${rooms.map((r) => `<option value="${r}">Court Room ${r}</option>`).join('')}</select></div>
          <div class="wide"><label for="hLink">Video link (FR-04)</label><input id="hLink" maxlength="200" value="https://vc.nyayatrack.in/${escapeHtml(cfCase.cnr || 'case-' + cfCase.caseid)}"></div>
          <div><label for="hJudge">Judge</label><select id="hJudge">${optionList(judges, 'personid', (j) => `${j.name} (${j.designation})`)}</select></div>
          <div><button type="button" class="btn-primary" onclick="fixHearing()">Fix hearing</button></div>
        </div></div>`;
    }
    $('cfBody').innerHTML = html;
    if (isStaff()) {
      const syncMode = () => {
        const vc = $('hMode').value === 'Video Conference';
        $('hRoom').disabled = vc;
        $('hLink').disabled = !vc;
      };
      $('hMode').addEventListener('change', syncMode);
      syncMode();
    }
  },

  async orders() {
    const [orders, hearings] = await Promise.all([api(`/api/cases/${cid()}/orders`), api(`/api/cases/${cid()}/hearings`)]);
    cfHearings = hearings;
    let html = tableHtml(['Order', 'Date', 'Type', 'Order text', 'Follows', 'Conditions', 'Hearing', ''], orders.map((o) => `
      <tr><td>#${o.orderid}</td><td>${escapeHtml(o.orderdate)}</td><td>${escapeHtml(o.ordertype)}</td>
        <td class="wrap">${escapeHtml(o.ordertext)}</td><td>${o.relatedorderid ? '#' + o.relatedorderid : dash}</td>
        <td class="wrap">${cell(o.conditions)}</td><td>${escapeHtml(o.hearingdate)}</td>
        <td>${isJudge() ? `<button class="btn-edit" onclick="followOrder(${o.orderid})">Modify by new order</button>` : ''}</td></tr>`).join(''),
      8, 'No orders yet.')
      + '<p class="note">Orders are append-only (FR-25): an order is never edited. To modify, extend or vacate one, pass a new order that follows it, so the link between related orders is kept (FR-26).</p>';
    const held = hearings.filter((h) => h.outcome !== 'Listed');
    if (!isJudge()) {
      html += '<p class="note">Orders are recorded by the judge of this court: sign in as the judge to record one.</p>';
    } else {
      html += `<div class="box"><h4>Record order</h4>
        <p class="note">The database refuses a second Final order in a case, an order dated before its hearing, and a related order from another case (FR-26). A Final order lets the registry dispose of the case (FR-11).</p>
        <div class="inline-form">
        <div class="wide"><label for="oHearing">At hearing (held)</label><select id="oHearing">${optionList(held, 'hearingid', hearingLabel, held.length ? '-- select --' : 'No hearing has been held yet')}</select></div>
        <div><label for="oDate">Order date</label><input type="date" id="oDate" value="${todayIso()}"></div>
        <div><label for="oType">Type</label><select id="oType"><option>Interim</option><option>Final</option></select></div>
        <div><label for="oFollows">Related order <span class="hint">(this case)</span></label><select id="oFollows"><option value="">-- none --</option>${orders.map((o) => `<option value="${o.orderid}">#${o.orderid} ${escapeHtml(o.ordertype)} (${escapeHtml(o.orderdate)})</option>`).join('')}</select></div>
        <div class="full"><label for="oText">Order text</label><textarea id="oText" maxlength="300"></textarea></div>
        <div class="full"><label for="oConditions">Conditions <span class="hint">(one per line, optional)</span></label><textarea id="oConditions"></textarea></div>
        <div><button type="button" class="btn-primary" onclick="passOrder()">Record order</button></div>
      </div></div>`;
    }
    $('cfBody').innerHTML = html;
  },

  async adjournments() {
    const [rows] = await Promise.all([api(`/api/cases/${cid()}/adjournments`), loadHearingsAndParties()]);
    let html = tableHtml(['Hearing', 'Sought by', 'Ground', 'Opposed', 'Requested', 'Decision', 'Reason', 'Pattern flags', ''], rows.map((a) => {
      const flags = [];
      if (Number(a.ground_uses) >= 2) flags.push(`<span class="flag">Ground used ${a.ground_uses}× in this case</span>`);
      if (Number(a.party_requests_all) >= 2) flags.push(`<span class="flag">${a.party_requests_all} requests by this party</span>`);
      const decide = isJudge() && a.decision === 'Pending'
        ? `<select id="dec-${a.adjournmentid}"><option>Granted</option><option>Refused</option></select>
           <input id="decr-${a.adjournmentid}" maxlength="100" placeholder="Reason" style="margin-top:4px">
           <button class="btn-edit" style="margin-top:4px" onclick="decideAdjournment(${a.adjournmentid})">Decide</button>` : '';
      return `<tr><td>${escapeHtml(a.hearingdate)}</td><td>${escapeHtml(a.sought_by)}</td><td class="wrap">${escapeHtml(a.ground)}</td>
        <td>${a.opposedflag ? 'Yes' : 'No'}</td><td>${escapeHtml(a.requesteddate)}</td><td>${escapeHtml(a.decision)}</td>
        <td class="wrap">${cell(a.decisionreason)}</td><td class="wrap">${flags.join('') || dash}</td><td>${decide}</td></tr>`;
    }).join(''), 9, 'No adjournments asked in this case.')
      + '<p class="note">The full adjournment history of the case, with repeat patterns flagged (FR-21). The judge decides each request (NFR-01).</p>';
    if (isJudge() || isClerk()) {
      html += `<div class="box"><h4>Record an adjournment request</h4><div class="inline-form">
        <div class="wide"><label for="aHearing">Hearing</label><select id="aHearing">${optionList(cfHearings, 'hearingid', hearingLabel, '-- select --')}</select></div>
        <div><label for="aParty">Asked by</label><select id="aParty">${optionList(cfParties, 'personid', (p) => `${p.name} (${p.partyrole})`, '-- select --')}</select></div>
        <div class="wide"><label for="aGround">Ground</label><input id="aGround" maxlength="100"></div>
        <div><label for="aDate">Requested on</label><input type="date" id="aDate" value="${todayIso()}"></div>
        <div><label class="check"><input type="checkbox" id="aOpposed"> Opposed by the other side</label></div>
        <div><button type="button" class="btn-primary" onclick="requestAdjournment()">Record request</button></div>
      </div></div>`;
    }
    $('cfBody').innerHTML = html;
  },

  async documents() {
    const [docs] = await Promise.all([api(`/api/cases/${cid()}/documents`), loadHearingsAndParties()]);
    let html = tableHtml(['#', 'Document', 'Date', 'Stage', 'Submitted / issued by', 'For hearing'], docs.map((d) => `
      <tr class="${d.documentid === cfNewDocument ? 'highlight' : ''}"><td>${d.documentid}</td><td>${escapeHtml(d.documenttype)}</td><td>${escapeHtml(d.submissiondate)}</td>
        <td>${escapeHtml(d.casestage)}</td><td>${escapeHtml(d.submitted_by)}</td><td>${cell(d.hearingdate)}</td></tr>`).join(''),
      6, 'No documents on record.')
      + '<p class="note">A document on record is never edited or removed (FR-25); a corrected version is filed as a new document.</p>';
    if (isClerk()) {
      const coming = cfHearings.filter((h) => h.outcome === 'Listed' && h.hearingdate >= todayIso());
      const submitters = [];
      cfParties.forEach((p) => {
        submitters.push({ id: p.personid, label: `${p.name} (${p.partyrole})` });
        if (p.advocateid && !submitters.some((s) => s.id === p.advocateid)) submitters.push({ id: p.advocateid, label: `${p.advocate} (advocate)` });
      });
      html += `<div class="box"><h4>Issue a summons or notice (FR-10)</h4><div class="inline-form">
          <div class="wide"><label for="prHearing">For coming hearing</label><select id="prHearing">${optionList(coming, 'hearingid', hearingLabel, coming.length ? '-- select --' : 'No coming hearing')}</select></div>
          <div><label for="prType">Type</label><select id="prType"><option>Summons</option><option>Notice</option></select></div>
          <div><button type="button" class="btn-primary" onclick="issueProcess()">Issue</button></div>
        </div></div>
        <div class="box"><h4>Record a filed document</h4><div class="inline-form">
          <div><label for="dType">Document</label><select id="dType">${simpleOptions(DOC_TYPES)}</select></div>
          <div><label for="dStage">Case stage</label><select id="dStage">${simpleOptions(DOC_STAGES)}</select></div>
          <div><label for="dDate">Date</label><input type="date" id="dDate" value="${todayIso()}"></div>
          <div class="wide"><label for="dBy">Submitted by</label><select id="dBy">${optionList(submitters, 'id', (s) => s.label, '-- select --')}</select></div>
          <div><button type="button" class="btn-primary" onclick="recordDocument()">Record document</button></div>
        </div></div>`;
    }
    $('cfBody').innerHTML = html;
  },

  async judges() {
    const d = await api(`/api/cases/${cid()}/assignments`);
    const current = d.assignments.find((a) => !a.enddate);
    const h = d.handover;
    let html = tableHtml(['Judge', 'Designation', 'Court', 'From', 'To', 'Type', 'Handover note'], d.assignments.map((a) => `
      <tr><td>${escapeHtml(a.judge)}</td><td>${escapeHtml(a.designation)}</td><td>${escapeHtml(a.courtname)}</td>
        <td>${escapeHtml(a.assigneddate)}</td><td>${a.enddate ? escapeHtml(a.enddate) : '<strong>current</strong>'}</td>
        <td>${escapeHtml(a.assignmenttype)}</td><td class="wrap">${cell(a.handovernote)}</td></tr>`).join(''),
      7, 'No judge assigned yet.');
    html += `<div class="box"><h4>Handover package (FR-22)</h4><div class="kv">
      <div>Status and stage</div><div>${escapeHtml(h.status)}${h.stage ? ' · ' + escapeHtml(h.stage) : ''} · ${escapeHtml(h.priority)} priority</div>
      <div>Documents on record</div><div>${h.documents} (${h.exhibits} exhibits / evidence affidavits)</div>
      <div>Interim directions in force</div><div>${cell(h.directions_in_force)}</div>
      <div>Pending applications</div><div>${cell(h.pending_applications)}</div>
      <div>Adjournments so far</div><div>${h.adjournments}</div>
      <div>Next hearing</div><div>${cell(h.next_hearing)}</div>
    </div></div>`;
    if (isStaff() && !current) {
      const judges = await lookup('judges-' + cfCase.courtid, `/api/judges?court=${cfCase.courtid}`);
      html += `<div class="box"><h4>Assign a judge (FR-09)</h4><div class="inline-form">
        <div class="wide"><label for="asJudge">Judge</label><select id="asJudge">${optionList(judges, 'personid', (j) => `${j.name} (${j.designation})`)}</select></div>
        <div><label for="asDate">From</label><input type="date" id="asDate" value="${todayIso()}"></div>
        <div><button type="button" class="btn-primary" onclick="assignJudge()">Assign</button></div>
      </div></div>`;
    }
    if (isCourtAdmin() && current) {
      const all = await lookup('judges-all', '/api/judges');
      lookups.transferJudges = all;
      html += `<div class="box"><h4>Transfer or roster change (FR-09)</h4>
        <p class="note">Closes the current assignment, opens the new one with your handover note, and moves the coming hearings to the new judge. A transfer to another court moves the case with the judge.</p>
        <div class="inline-form">
          <div><label for="trType">Type</label><select id="trType"><option>Roster</option><option>Transfer</option></select></div>
          <div class="wide"><label for="trJudge">New judge</label><select id="trJudge"></select></div>
          <div><label for="trDate">From</label><input type="date" id="trDate" value="${todayIso()}"></div>
          <div class="full"><label for="trNote">Handover note</label><textarea id="trNote" maxlength="1000"></textarea></div>
          <div><button type="button" class="btn-primary" onclick="transferCase()">Hand over</button></div>
        </div></div>`;
    }
    $('cfBody').innerHTML = html;
    if (isCourtAdmin() && current) {
      const syncJudges = () => {
        const roster = $('trType').value === 'Roster';
        const list = lookups.transferJudges.filter((j) => j.personid !== current.judgeid
          && (roster ? j.courtid === cfCase.courtid : j.courtid !== cfCase.courtid));
        $('trJudge').innerHTML = optionList(list, 'personid', (j) => `${j.name} (${j.designation}, ${j.courtname})`);
      };
      $('trType').addEventListener('change', syncJudges);
      syncJudges();
    }
  },

  async history() {
    const rows = await api(`/api/cases/${cid()}/history`);
    const show = (v) => (v === null || v === undefined ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v));
    const diff = (r) => {
      if (r.action === 'UPDATE' && r.oldvalue && r.newvalue) {
        const keys = Object.keys(r.newvalue).filter((k) => JSON.stringify(r.oldvalue[k]) !== JSON.stringify(r.newvalue[k]));
        return keys.map((k) => `<b>${escapeHtml(k)}</b>: ${escapeHtml(show(r.oldvalue[k]))} → ${escapeHtml(show(r.newvalue[k]))}`).join('<br>');
      }
      const v = r.newvalue || r.oldvalue || {};
      return Object.entries(v).filter(([, x]) => x !== null).slice(0, 6)
        .map(([k, x]) => `<b>${escapeHtml(k)}</b>: ${escapeHtml(show(x))}`).join(' · ');
    };
    $('cfBody').innerHTML = tableHtml(['When', 'By', 'Record', 'Action', 'What changed'], rows.map((r) => `
      <tr><td>${escapeHtml(new Date(r.changedat).toLocaleString('en-IN'))}</td><td>${escapeHtml(r.changed_by)}</td>
        <td>${escapeHtml(r.tablename)}</td><td>${escapeHtml(r.action)}</td><td class="diff wrap">${diff(r)}</td></tr>`).join(''),
      5, 'No history yet.')
      + '<p class="note">Built from the append-only audit log: who changed what, when, with the old and new values (FR-23, FR-24). It cannot be edited or deleted.</p>';
  },
};

async function addParty() {
  if (!val('pPerson')) return showMessage('Choose the party to add.', 'error');
  await act(post(`/api/cases/${cid()}/parties`, { personId: val('pPerson'), partyRole: val('pRole'), custodyStatus: val('pCustody') }),
    () => showCfTab('parties'));
}

async function addNewParty() {
  await act(post(`/api/cases/${cid()}/parties/new`, {
    name: val('npName'), address: val('npAddress'), pincode: val('npPin'), phone: val('npPhone'),
    partyRole: val('npRole'), custodyStatus: val('npCustody'),
  }), () => { delete lookups.parties; return showCfTab('parties'); });
}

async function recordPayment() {
  await act(post(`/api/cases/${cid()}/payments`, { amount: val('payAmount'), paymentDate: val('payDate') }),
    async () => { highlightId = cid(); await refreshEditing(); await showCfTab('fee'); });
}

async function fixHearing() {
  await act(post(`/api/cases/${cid()}/hearings`, {
    date: val('hDate'), start: val('hStart'), end: val('hEnd'), mode: val('hMode'),
    room: $('hRoom').disabled ? '' : val('hRoom'), vcLink: $('hLink').disabled ? '' : val('hLink'), judgeId: val('hJudge'),
  }), () => showCfTab('hearings'));
}

async function saveOutcome(hid) {
  await act(put(`/api/hearings/${hid}/outcome`, { outcome: val('out-' + hid) }), () => showCfTab('hearings'));
}

async function showMove(hid) {
  const h = cfHearings.find((x) => x.hearingid === hid);
  const rooms = await lookup('rooms-' + cfCase.courtid, `/api/courtrooms?court=${cfCase.courtid}`);
  $('moveBox').innerHTML = `<div class="box"><h4>Move hearing #${hid} (${escapeHtml(h.hearingdate)} ${fmtTime(h.hearingtime)})</h4>
    <p class="note">The cause list is updated and every party and advocate appears in the notification feed (FR-05a, FR-12).</p>
    <div class="inline-form">
      <div><label for="mvDate">New date</label><input type="date" id="mvDate" value="${escapeHtml(h.hearingdate)}"></div>
      <div><label for="mvStart">Starts</label><input type="time" id="mvStart" value="${fmtTime(h.hearingtime)}"></div>
      <div><label for="mvEnd">Ends</label><input type="time" id="mvEnd" value="${fmtTime(h.endtime)}"></div>
      <div><label for="mvRoom">Courtroom</label><select id="mvRoom" ${h.mode === 'Video Conference' ? 'disabled' : ''}>${rooms.map((r) => `<option value="${r}"${r === h.courtroomnumber ? ' selected' : ''}>Court Room ${r}</option>`).join('')}</select></div>
      <div><button type="button" class="btn-primary" onclick="moveHearing(${hid})">Move hearing</button></div>
    </div></div>`;
  $('moveBox').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function moveHearing(hid) {
  await act(post(`/api/hearings/${hid}/reschedule`, {
    date: val('mvDate'), start: val('mvStart'), end: val('mvEnd'), room: $('mvRoom').disabled ? '' : val('mvRoom'),
  }), () => showCfTab('hearings'));
}

function followOrder(orderId) {
  $('oFollows').value = String(orderId);
  $('oText').focus();
  $('oText').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function passOrder() {
  await act(post(`/api/cases/${cid()}/orders`, {
    hearingId: val('oHearing'), date: val('oDate'), type: val('oType'), text: val('oText'),
    relatedOrderId: val('oFollows'), conditions: $('oConditions').value,
  }), () => showCfTab('orders'));
}

async function requestAdjournment() {
  await act(post(`/api/cases/${cid()}/adjournments`, {
    hearingId: val('aHearing'), partyId: val('aParty'), ground: val('aGround'), requestedDate: val('aDate'),
    opposed: $('aOpposed').checked,
  }), () => showCfTab('adjournments'));
}

async function decideAdjournment(aid) {
  await act(put(`/api/adjournments/${aid}/decision`, { decision: val('dec-' + aid), reason: val('decr-' + aid) }),
    () => showCfTab('adjournments'));
}

async function issueProcess() {
  if (!val('prHearing')) return showMessage('Choose a coming hearing.', 'error');
  await act(post(`/api/cases/${cid()}/process`, { hearingId: val('prHearing'), type: val('prType') }),
    (d) => { cfNewDocument = d.documentid; return showCfTab('documents'); });
}

async function recordDocument() {
  await act(post(`/api/cases/${cid()}/documents`, {
    type: val('dType'), stage: val('dStage'), date: val('dDate'), submittedBy: val('dBy'),
  }), () => showCfTab('documents'));
}

async function assignJudge() {
  await act(post(`/api/cases/${cid()}/assign`, { judgeId: val('asJudge'), date: val('asDate') }), () => showCfTab('judges'));
}

async function transferCase() {
  const ok = await askConfirm(`Hand case #${cid()} over to the selected judge from ${val('trDate')}? This is recorded permanently.`, 'Confirm handover', 'Hand over');
  if (!ok) return;
  await act(post(`/api/cases/${cid()}/transfer`, {
    judgeId: val('trJudge'), date: val('trDate'), type: val('trType'), note: val('trNote'),
  }), async () => { await refreshEditing(); await showCfTab('judges'); });
}
