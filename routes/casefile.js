const express = require('express');
const pool = require('../db');
const { PARTY_ROLES, CUSTODY, OUTCOMES, DOC_TYPES, DOC_STAGES, isValidDate, isValidTime, toPositiveInt,
  emptyToNull } = require('../lib/validate');
const { userError, sendDbError } = require('../lib/errors');
const { STAFF, COURT_USERS, withSession, asNotifier, by } = require('../lib/session');
const { toNotification } = require('../lib/notify');

const router = express.Router();

async function visibleCase(client, id) {
  if (!id) throw userError('Case ID in the URL must be a positive whole number.');
  const found = await client.query(
    'SELECT caseid, cnr, status, stage, courtid, courtfeedue FROM court_case WHERE caseid = $1', [id]);
  if (!found.rowCount) throw userError(`Case ${id} was not found in your court.`, 404);
  return found.rows[0];
}

function fail(errors, res) {
  if (!errors.length) return false;
  res.status(400).json({ error: errors.join(' ') });
  return true;
}

router.get('/parties', async (req, res) => {
  try {
    const result = await withSession(req, STAFF, (client) => client.query(
      'SELECT p.personid, p.name FROM party pa JOIN person p ON p.personid = pa.personid ORDER BY p.name, p.personid'));
    res.json(result.rows);
  } catch (err) {
    sendDbError(res, err, 'PARTIES');
  }
});

router.get('/pincodes', async (req, res) => {
  try {
    const result = await withSession(req, STAFF, (client) => client.query(
      'SELECT pincode, city, state FROM pincode ORDER BY state, city, pincode'));
    res.json(result.rows);
  } catch (err) {
    sendDbError(res, err, 'PINCODES');
  }
});

router.get('/judges', async (req, res) => {
  const court = toPositiveInt(req.query.court);
  try {
    const result = await withSession(req, COURT_USERS, (client) => client.query(
      `SELECT j.personid, p.name, j.designation, j.courtid, c.courtname
         FROM judge j JOIN person p ON p.personid = j.personid JOIN court c ON c.courtid = j.courtid
        WHERE ($1::int IS NULL OR j.courtid = $1::int)
        ORDER BY c.courtname, p.name`, [court]));
    res.json(result.rows);
  } catch (err) {
    sendDbError(res, err, 'JUDGES');
  }
});

router.get('/courtrooms', async (req, res) => {
  const court = toPositiveInt(req.query.court);
  try {
    const result = await withSession(req, COURT_USERS, (client) => client.query(
      'SELECT courtroomnumber FROM courtroom WHERE courtid = $1 ORDER BY courtroomnumber', [court]));
    res.json(result.rows.map((r) => r.courtroomnumber));
  } catch (err) {
    sendDbError(res, err, 'COURTROOMS');
  }
});

const PARTIES_OF_CASE_SQL = `
  SELECT i.personid, p.name, i.partyrole, i.custodystatus, i.advocateid, a.name AS advocate
    FROM involved_in i
    JOIN person p ON p.personid = i.personid
    LEFT JOIN person a ON a.personid = i.advocateid
   WHERE i.caseid = $1
   ORDER BY i.partyrole, p.name`;

const PAYMENTS_OF_CASE_SQL = `
  SELECT paymentid, receiptnumber, paymentdate, paymentamount
    FROM court_fee_payment
   WHERE caseid = $1
   ORDER BY paymentdate, paymentid`;

router.get('/cases/:id/details', async (req, res) => {
  try {
    const data = await withSession(req, COURT_USERS, async (client) => {
      const c = await visibleCase(client, toPositiveInt(req.params.id));
      const parties = await client.query(PARTIES_OF_CASE_SQL, [c.caseid]);
      const payments = await client.query(PAYMENTS_OF_CASE_SQL, [c.caseid]);
      return { case: c, courtfeedue: c.courtfeedue, parties: parties.rows, payments: payments.rows };
    });
    res.json(data);
  } catch (err) {
    sendDbError(res, err, 'DETAILS');
  }
});

router.post('/cases/:id/parties', async (req, res) => {
  const id = toPositiveInt(req.params.id);
  const personId = toPositiveInt(req.body.personId);
  const role = emptyToNull(req.body.partyRole);
  const custody = emptyToNull(req.body.custodyStatus);
  const errors = [];
  if (!personId) errors.push('Choose the party to add.');
  if (!PARTY_ROLES.includes(role)) errors.push(`Role must be one of: ${PARTY_ROLES.join(', ')}.`);
  if (custody && !CUSTODY.includes(custody)) errors.push(`Custody status must be one of: ${CUSTODY.join(', ')}.`);
  if (custody && role !== 'Accused') errors.push('Custody status is only for an accused.');
  if (fail(errors, res)) return;

  try {
    await withSession(req, STAFF, async (client, me) => {
      await visibleCase(client, id);
      const result = await client.query(
        'INSERT INTO involved_in (personid, caseid, partyrole, custodystatus) VALUES ($1, $2, $3, $4)',
        [personId, id, role, custody]);
      console.log(`[PARTY] INSERT INTO involved_in (case ${id}, person ${personId}) -> result.rowCount = ${result.rowCount} ${by(me)}`);
    });
    res.status(201).json({ message: `Party added to case ${id} as ${role}.` });
  } catch (err) {
    sendDbError(res, err, 'PARTY');
  }
});

router.post('/cases/:id/parties/new', async (req, res) => {
  const id = toPositiveInt(req.params.id);
  const name = emptyToNull(req.body.name);
  const address = emptyToNull(req.body.address);
  const pincode = emptyToNull(req.body.pincode);
  const phone = emptyToNull(req.body.phone);
  const role = emptyToNull(req.body.partyRole);
  const custody = emptyToNull(req.body.custodyStatus);
  const errors = [];
  if (!name || name.length > 100) errors.push('Name is required (up to 100 characters).');
  if (!address || address.length > 150) errors.push('Address is required (up to 150 characters).');
  if (!pincode || !/^[1-9][0-9]{5}$/.test(pincode)) errors.push('Choose a pincode.');
  if (!phone || !/^[6-9][0-9]{9}$/.test(phone)) errors.push('Phone number must be 10 digits starting with 6, 7, 8 or 9.');
  if (!PARTY_ROLES.includes(role)) errors.push(`Role must be one of: ${PARTY_ROLES.join(', ')}.`);
  if (custody && !CUSTODY.includes(custody)) errors.push(`Custody status must be one of: ${CUSTODY.join(', ')}.`);
  if (custody && role !== 'Accused') errors.push('Custody status is only for an accused.');
  if (fail(errors, res)) return;

  try {
    const personId = await withSession(req, STAFF, async (client, me) => {
      await visibleCase(client, id);
      const person = await client.query(
        'INSERT INTO person (name, addressline, pincode, contactnumber) VALUES ($1, $2, $3, $4) RETURNING personid',
        [name, address, pincode, phone]);
      const pid = person.rows[0].personid;
      await client.query('INSERT INTO party (personid) VALUES ($1)', [pid]);
      await client.query(
        'INSERT INTO involved_in (personid, caseid, partyrole, custodystatus) VALUES ($1, $2, $3, $4)',
        [pid, id, role, custody]);
      console.log(`[PARTY] INSERT INTO person, party, involved_in (new person ${pid}, case ${id}) -> result.rowCount = 1 ${by(me)}`);
      return pid;
    });
    res.status(201).json({ message: `${name} registered as a new party (#${personId}) and added to case ${id} as ${role}.` });
  } catch (err) {
    sendDbError(res, err, 'PARTY');
  }
});

const NEXT_RECEIPT_SQL = `
  SELECT $1::text || LPAD((COALESCE(MAX(SUBSTRING(receiptnumber FROM '[0-9]{6}$')::int), 0) + 1)::text, 6, '0') AS receipt
    FROM court_fee_payment
   WHERE receiptnumber LIKE $1::text || '%'`;

router.post('/cases/:id/payments', async (req, res) => {
  const id = toPositiveInt(req.params.id);
  const amount = Number(req.body.amount);
  const paymentDate = emptyToNull(req.body.paymentDate);
  const errors = [];
  if (!(amount > 0) || amount > 99999999) errors.push('Payment amount must be more than ₹0.');
  if (!isValidDate(paymentDate)) errors.push('Payment date is required (YYYY-MM-DD).');
  if (fail(errors, res)) return;

  try {
    const receipt = (await pool.query(NEXT_RECEIPT_SQL, [`RCPT-${paymentDate.slice(0, 4)}-`])).rows[0].receipt;
    const due = await withSession(req, STAFF, async (client, me) => {
      await visibleCase(client, id);
      const result = await client.query(
        'INSERT INTO court_fee_payment (receiptnumber, paymentdate, paymentamount, caseid) VALUES ($1, $2, $3, $4)',
        [receipt, paymentDate, amount, id]);
      console.log(`[PAYMENT] INSERT INTO court_fee_payment (case ${id}, ₹${amount}) -> result.rowCount = ${result.rowCount} ${by(me)}`);
      return (await client.query('SELECT courtfeedue FROM court_case WHERE caseid = $1', [id])).rows[0].courtfeedue;
    });
    res.status(201).json({ message: `Payment of ₹${amount.toFixed(2)} recorded (receipt ${receipt}). Fee still due: ₹${due}.`, receipt, due });
  } catch (err) {
    sendDbError(res, err, 'PAYMENT');
  }
});

const HEARINGS_SQL = `
  SELECT h.hearingid, h.hearingdate, h.hearingtime, h.endtime, h.mode, h.outcome, h.vclink,
         h.courtroomnumber, h.judgeid, p.name AS judge, h.causelistid,
         (SELECT COUNT(*) FROM court_order o WHERE o.hearingid = h.hearingid) AS orders
    FROM hearing h
    JOIN person p ON p.personid = h.judgeid
   WHERE h.caseid = $1
   ORDER BY h.hearingdate, h.hearingtime`;

router.get('/cases/:id/hearings', async (req, res) => {
  try {
    const rows = await withSession(req, COURT_USERS, async (client) => {
      const c = await visibleCase(client, toPositiveInt(req.params.id));
      return (await client.query(HEARINGS_SQL, [c.caseid])).rows;
    });
    res.json(rows);
  } catch (err) {
    sendDbError(res, err, 'HEARINGS');
  }
});

const INSERT_HEARING_SQL = `
  INSERT INTO hearing (hearingdate, hearingtime, endtime, mode, vclink, caseid, judgeid, courtid, courtroomnumber, causelistid)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  RETURNING hearingid`;

router.post('/cases/:id/hearings', async (req, res) => {
  const id = toPositiveInt(req.params.id);
  const date = emptyToNull(req.body.date);
  const start = emptyToNull(req.body.start);
  const end = emptyToNull(req.body.end);
  const mode = emptyToNull(req.body.mode);
  const judgeId = toPositiveInt(req.body.judgeId);
  const room = mode === 'In Person' ? toPositiveInt(req.body.room) : null;
  const link = mode === 'Video Conference' ? emptyToNull(req.body.vcLink) : null;
  const errors = [];
  if (!isValidDate(date)) errors.push('Hearing date is required.');
  if (!isValidTime(start) || !isValidTime(end)) errors.push('Start and end time are required.');
  else if (end <= start) errors.push('The hearing must end after it starts.');
  if (!['In Person', 'Video Conference'].includes(mode)) errors.push('Mode must be In Person or Video Conference.');
  if (mode === 'In Person' && !room) errors.push('Choose a courtroom for an in-person hearing.');
  if (mode === 'Video Conference' && (!link || !/^https?:\/\/\S+$/.test(link) || link.length > 200)) errors.push('Give the video-conference link (http/https).');
  if (!judgeId) errors.push('Choose the judge.');
  if (fail(errors, res)) return;

  try {
    const hearingId = await withSession(req, STAFF, async (client, me) => {
      const c = await visibleCase(client, id);
      let list = await client.query('SELECT causelistid FROM cause_list WHERE courtid = $1 AND listdate = $2', [c.courtid, date]);
      if (!list.rowCount) {
        list = await client.query('INSERT INTO cause_list (listdate, courtid) VALUES ($1, $2) RETURNING causelistid', [date, c.courtid]);
      }
      const result = await client.query(INSERT_HEARING_SQL,
        [date, start, end, mode, link, id, judgeId, c.courtid, room, list.rows[0].causelistid]);
      console.log(`[HEARING] INSERT INTO hearing (case ${id}, ${date} ${start}) -> result.rowCount = ${result.rowCount} ${by(me)}`);
      return result.rows[0].hearingid;
    });
    res.status(201).json({ message: `Hearing #${hearingId} fixed for ${date} at ${start} and added to that day's cause list.` });
  } catch (err) {
    sendDbError(res, err, 'HEARING');
  }
});

const HEARING_ONE_SQL = `
  SELECT h.hearingid, h.hearingdate, h.hearingtime, h.endtime, h.mode, h.outcome, h.vclink, h.courtroomnumber,
         h.courtid, c.courtname, h.caseid, cc.cnr, cc.casetype, p.name AS judge
    FROM hearing h
    JOIN court_case cc ON cc.caseid = h.caseid
    JOIN court c ON c.courtid = h.courtid
    JOIN person p ON p.personid = h.judgeid
   WHERE h.hearingid = $1`;

router.get('/hearings/:hid', async (req, res) => {
  const hid = toPositiveInt(req.params.hid);
  if (!hid) return res.status(400).json({ error: 'Hearing ID must be a positive whole number.' });

  try {
    const row = await withSession(req, COURT_USERS, async (client) => {
      const found = (await client.query(HEARING_ONE_SQL, [hid])).rows[0];
      if (!found) throw userError(`Hearing ${hid} was not found in your court.`, 404);
      return found;
    });
    res.json(row);
  } catch (err) {
    sendDbError(res, err, 'HEARING');
  }
});

router.post('/hearings/:hid/reschedule', async (req, res) => {
  const hid = toPositiveInt(req.params.hid);
  const date = emptyToNull(req.body.date);
  const start = emptyToNull(req.body.start);
  const end = emptyToNull(req.body.end);
  const room = toPositiveInt(req.body.room);
  const errors = [];
  if (!hid) errors.push('Hearing ID must be a positive whole number.');
  if (!isValidDate(date)) errors.push('New date is required.');
  if (!isValidTime(start) || !isValidTime(end)) errors.push('New start and end time are required.');
  else if (end <= start) errors.push('The hearing must end after it starts.');
  if (fail(errors, res)) return;

  try {
    const cnr = await withSession(req, STAFF, async (client, me) => {
      const visible = await client.query(
        'SELECT cc.cnr FROM hearing h JOIN court_case cc ON cc.caseid = h.caseid WHERE h.hearingid = $1', [hid]);
      if (!visible.rowCount) throw userError(`Hearing ${hid} was not found in your court.`, 404);
      await client.query('CALL sp_reschedule_hearing($1, $2, $3, $4, $5, $6)', [hid, date, start, end, room, me.personid]);
      console.log(`[HEARING] CALL sp_reschedule_hearing(${hid} -> ${date} ${start}) ${by(me)}`);
      return visible.rows[0].cnr;
    });
    const notify = await asNotifier(async (client) => (await client.query(
      'SELECT * FROM v_notification_queue WHERE cnr = $1 ORDER BY changedat DESC, audience, name', [cnr])).rows);
    res.json({
      message: `Hearing #${hid} moved to ${date} at ${start}. ${notify.length} people must be told of the change.`,
      notifications: notify.map(toNotification),
    });
  } catch (err) {
    sendDbError(res, err, 'HEARING');
  }
});

router.put('/hearings/:hid/outcome', async (req, res) => {
  const hid = toPositiveInt(req.params.hid);
  const outcome = emptyToNull(req.body.outcome);
  if (!hid || !OUTCOMES.includes(outcome)) return res.status(400).json({ error: `Outcome must be one of: ${OUTCOMES.join(', ')}.` });

  try {
    await withSession(req, ['Judge', 'Registry Clerk'], async (client, me) => {
      const result = await client.query('UPDATE hearing SET outcome = $1 WHERE hearingid = $2', [outcome, hid]);
      console.log(`[HEARING] UPDATE hearing SET outcome WHERE hearingid = ${hid} -> result.rowCount = ${result.rowCount} ${by(me)}`);
      if (!result.rowCount) throw userError(`Hearing ${hid} was not found in your court.`, 404);
    });
    res.json({ message: `Outcome of hearing #${hid} recorded as ${outcome}.` });
  } catch (err) {
    sendDbError(res, err, 'HEARING');
  }
});

const ORDERS_SQL = `
  SELECT o.orderid, o.orderdate, o.ordertype, o.ordertext, o.relatedorderid, o.hearingid, h.hearingdate,
         (SELECT STRING_AGG(oc.condition, '; ' ORDER BY oc.condition) FROM order_condition oc
           WHERE oc.orderid = o.orderid) AS conditions
    FROM court_order o
    JOIN hearing h ON h.hearingid = o.hearingid
   WHERE h.caseid = $1
   ORDER BY o.orderdate, o.orderid`;

router.get('/cases/:id/orders', async (req, res) => {
  try {
    const rows = await withSession(req, COURT_USERS, async (client) => {
      const c = await visibleCase(client, toPositiveInt(req.params.id));
      return (await client.query(ORDERS_SQL, [c.caseid])).rows;
    });
    res.json(rows);
  } catch (err) {
    sendDbError(res, err, 'ORDERS');
  }
});

router.post('/cases/:id/orders', async (req, res) => {
  const id = toPositiveInt(req.params.id);
  const hearingId = toPositiveInt(req.body.hearingId);
  const date = emptyToNull(req.body.date);
  const type = emptyToNull(req.body.type);
  const text = emptyToNull(req.body.text);
  const relatedId = toPositiveInt(req.body.relatedOrderId);
  const conditions = String(req.body.conditions || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const errors = [];
  if (!hearingId) errors.push('Choose the hearing at which the order is passed.');
  if (!isValidDate(date)) errors.push('Order date is required.');
  if (!['Interim', 'Final'].includes(type)) errors.push('Order type must be Interim or Final.');
  if (!text || text.length > 300) errors.push('Order text is required (up to 300 characters).');
  if (conditions.some((c) => c.length > 150)) errors.push('Each condition must be 150 characters or fewer.');
  if (fail(errors, res)) return;

  try {
    const orderId = await withSession(req, ['Judge'], async (client, me) => {
      await visibleCase(client, id);
      const own = await client.query('SELECT 1 FROM hearing WHERE hearingid = $1 AND caseid = $2', [hearingId, id]);
      if (!own.rowCount) throw userError('That hearing does not belong to this case.');
      const result = await client.query(
        'INSERT INTO court_order (orderdate, ordertype, ordertext, hearingid, relatedorderid) VALUES ($1, $2, $3, $4, $5) RETURNING orderid',
        [date, type, text, hearingId, relatedId]);
      const oid = result.rows[0].orderid;
      for (const cond of conditions) {
        await client.query('INSERT INTO order_condition (orderid, condition) VALUES ($1, $2)', [oid, cond]);
      }
      console.log(`[ORDER] INSERT INTO court_order (case ${id}, ${type}) + ${conditions.length} conditions -> result.rowCount = ${result.rowCount} ${by(me)}`);
      return oid;
    });
    res.status(201).json({ message: `${type} order #${orderId} passed${relatedId ? ` (follows order #${relatedId})` : ''}.` });
  } catch (err) {
    sendDbError(res, err, 'ORDER');
  }
});

const ADJOURNMENTS_SQL = `
  SELECT a.adjournmentid, a.requesteddate, a.ground, a.opposedflag, a.decision, a.decisionreason,
         a.hearingid, h.hearingdate, a.partyid, p.name AS sought_by,
         COUNT(*) OVER (PARTITION BY lower(a.ground)) AS ground_uses,
         COUNT(*) OVER (PARTITION BY a.partyid) AS party_requests_here,
         (SELECT COUNT(*) FROM adjournment x WHERE x.partyid = a.partyid) AS party_requests_all
    FROM adjournment a
    JOIN hearing h ON h.hearingid = a.hearingid
    JOIN person p ON p.personid = a.partyid
   WHERE h.caseid = $1
   ORDER BY h.hearingdate, a.adjournmentid`;

router.get('/cases/:id/adjournments', async (req, res) => {
  try {
    const rows = await withSession(req, COURT_USERS, async (client) => {
      const c = await visibleCase(client, toPositiveInt(req.params.id));
      return (await client.query(ADJOURNMENTS_SQL, [c.caseid])).rows;
    });
    res.json(rows);
  } catch (err) {
    sendDbError(res, err, 'ADJOURNMENTS');
  }
});

router.post('/cases/:id/adjournments', async (req, res) => {
  const id = toPositiveInt(req.params.id);
  const hearingId = toPositiveInt(req.body.hearingId);
  const partyId = toPositiveInt(req.body.partyId);
  const ground = emptyToNull(req.body.ground);
  const date = emptyToNull(req.body.requestedDate);
  const opposed = req.body.opposed === true || req.body.opposed === 'true';
  const errors = [];
  if (!hearingId) errors.push('Choose the hearing to adjourn.');
  if (!partyId) errors.push('Choose the party asking for the adjournment.');
  if (!ground || ground.length > 100) errors.push('Ground is required (up to 100 characters).');
  if (!isValidDate(date)) errors.push('Request date is required.');
  if (fail(errors, res)) return;

  try {
    await withSession(req, ['Registry Clerk', 'Judge'], async (client, me) => {
      await visibleCase(client, id);
      const own = await client.query('SELECT 1 FROM hearing WHERE hearingid = $1 AND caseid = $2', [hearingId, id]);
      if (!own.rowCount) throw userError('That hearing does not belong to this case.');
      const result = await client.query(
        'INSERT INTO adjournment (requesteddate, ground, opposedflag, hearingid, partyid) VALUES ($1, $2, $3, $4, $5)',
        [date, ground, opposed, hearingId, partyId]);
      console.log(`[ADJOURN] INSERT INTO adjournment (case ${id}, hearing ${hearingId}) -> result.rowCount = ${result.rowCount} ${by(me)}`);
    });
    res.status(201).json({ message: 'Adjournment request recorded; it is pending the judge\'s decision.' });
  } catch (err) {
    sendDbError(res, err, 'ADJOURN');
  }
});

router.put('/adjournments/:aid/decision', async (req, res) => {
  const aid = toPositiveInt(req.params.aid);
  const decision = emptyToNull(req.body.decision);
  const reason = emptyToNull(req.body.reason);
  const errors = [];
  if (!aid) errors.push('Adjournment ID must be a positive whole number.');
  if (!['Granted', 'Refused'].includes(decision)) errors.push('Decision must be Granted or Refused.');
  if (!reason || reason.length > 100) errors.push('Give the reason for the decision (up to 100 characters).');
  if (fail(errors, res)) return;

  try {
    await withSession(req, ['Judge'], async (client, me) => {
      const result = await client.query(
        "UPDATE adjournment SET decision = $1, decisionreason = $2 WHERE adjournmentid = $3 AND decision = 'Pending'",
        [decision, reason, aid]);
      console.log(`[ADJOURN] UPDATE adjournment SET decision WHERE adjournmentid = ${aid} -> result.rowCount = ${result.rowCount} ${by(me)}`);
      if (!result.rowCount) throw userError('That request was not found or has already been decided.', 404);
    });
    res.json({ message: `Adjournment request ${decision.toLowerCase()}.` });
  } catch (err) {
    sendDbError(res, err, 'ADJOURN');
  }
});

const DOCUMENTS_SQL = `
  SELECT d.documentid, d.documenttype, d.submissiondate, d.casestage, p.name AS submitted_by,
         d.hearingid, h.hearingdate
    FROM document d
    JOIN person p ON p.personid = d.submittedby
    LEFT JOIN hearing h ON h.hearingid = d.hearingid
   WHERE d.caseid = $1
   ORDER BY d.submissiondate, d.documentid`;

router.get('/cases/:id/documents', async (req, res) => {
  try {
    const rows = await withSession(req, COURT_USERS, async (client) => {
      const c = await visibleCase(client, toPositiveInt(req.params.id));
      return (await client.query(DOCUMENTS_SQL, [c.caseid])).rows;
    });
    res.json(rows);
  } catch (err) {
    sendDbError(res, err, 'DOCUMENTS');
  }
});

router.post('/cases/:id/documents', async (req, res) => {
  const id = toPositiveInt(req.params.id);
  const type = emptyToNull(req.body.type);
  const stage = emptyToNull(req.body.stage);
  const date = emptyToNull(req.body.date);
  const submittedBy = toPositiveInt(req.body.submittedBy);
  const errors = [];
  if (!DOC_TYPES.includes(type)) errors.push('Choose the document type.');
  if (!DOC_STAGES.includes(stage)) errors.push('Choose the case stage of the document.');
  if (!isValidDate(date)) errors.push('Submission date is required.');
  if (!submittedBy) errors.push('Choose who submitted the document.');
  if (fail(errors, res)) return;

  try {
    const docId = await withSession(req, ['Registry Clerk'], async (client, me) => {
      await visibleCase(client, id);
      const result = await client.query(
        'INSERT INTO document (documenttype, submissiondate, casestage, caseid, submittedby) VALUES ($1, $2, $3, $4, $5) RETURNING documentid',
        [type, date, stage, id, submittedBy]);
      console.log(`[DOCUMENT] INSERT INTO document (case ${id}, ${type}) -> result.rowCount = ${result.rowCount} ${by(me)}`);
      return result.rows[0].documentid;
    });
    res.status(201).json({ message: `${type} recorded as document #${docId}.` });
  } catch (err) {
    sendDbError(res, err, 'DOCUMENT');
  }
});

router.post('/cases/:id/process', async (req, res) => {
  const id = toPositiveInt(req.params.id);
  const hearingId = toPositiveInt(req.body.hearingId);
  const type = emptyToNull(req.body.type);
  if (!hearingId || !['Summons', 'Notice'].includes(type)) {
    return res.status(400).json({ error: 'Choose a coming hearing and whether to issue a Summons or a Notice.' });
  }

  try {
    const docId = await withSession(req, ['Registry Clerk'], async (client, me) => {
      await visibleCase(client, id);
      const result = await client.query('SELECT fn_issue_process_document($1, $2, $3, $4) AS documentid', [id, hearingId, type, me.personid]);
      console.log(`[DOCUMENT] fn_issue_process_document(case ${id}, hearing ${hearingId}, ${type}) -> document ${result.rows[0].documentid} ${by(me)}`);
      return result.rows[0].documentid;
    });
    res.status(201).json({ message: `${type} issued for hearing #${hearingId} (document #${docId}).` });
  } catch (err) {
    sendDbError(res, err, 'DOCUMENT');
  }
});

const ASSIGNMENTS_SQL = `
  SELECT a.judgeid, p.name AS judge, j.designation, c.courtname, a.assigneddate, a.enddate,
         a.assignmenttype, a.handovernote
    FROM assigned_to a
    JOIN judge j ON j.personid = a.judgeid
    JOIN person p ON p.personid = a.judgeid
    JOIN court c ON c.courtid = j.courtid
   WHERE a.caseid = $1
   ORDER BY a.assigneddate`;

const HANDOVER_SQL = `
  SELECT cc.cnr, cc.status, cc.stage, cc.priority,
         (SELECT COUNT(*) FROM document d WHERE d.caseid = cc.caseid
             AND d.documenttype IN ('Exhibit', 'Evidence Affidavit')) AS exhibits,
         (SELECT COUNT(*) FROM document d WHERE d.caseid = cc.caseid) AS documents,
         (SELECT STRING_AGG(o.orderdate::text || ': ' || o.ordertext, ' | ' ORDER BY o.orderdate)
            FROM court_order o JOIN hearing h ON h.hearingid = o.hearingid
           WHERE h.caseid = cc.caseid AND o.ordertype = 'Interim') AS directions_in_force,
         (SELECT STRING_AGG(ap.applicationtype, ', ') FROM application ap
           WHERE ap.caseid = cc.caseid AND ap.applicationstatus = 'Pending') AS pending_applications,
         (SELECT COUNT(*) FROM adjournment a JOIN hearing h ON h.hearingid = a.hearingid
           WHERE h.caseid = cc.caseid) AS adjournments,
         (SELECT MIN(hearingdate) FROM hearing WHERE caseid = cc.caseid AND hearingdate >= CURRENT_DATE) AS next_hearing
    FROM court_case cc
   WHERE cc.caseid = $1`;

router.get('/cases/:id/assignments', async (req, res) => {
  try {
    const data = await withSession(req, COURT_USERS, async (client) => {
      const c = await visibleCase(client, toPositiveInt(req.params.id));
      const assignments = (await client.query(ASSIGNMENTS_SQL, [c.caseid])).rows;
      const handover = (await client.query(HANDOVER_SQL, [c.caseid])).rows[0];
      return { assignments, handover };
    });
    res.json(data);
  } catch (err) {
    sendDbError(res, err, 'ASSIGN');
  }
});

router.post('/cases/:id/assign', async (req, res) => {
  const id = toPositiveInt(req.params.id);
  const judgeId = toPositiveInt(req.body.judgeId);
  const date = emptyToNull(req.body.date);
  if (!judgeId || !isValidDate(date)) return res.status(400).json({ error: 'Choose the judge and the assignment date.' });

  try {
    await withSession(req, STAFF, async (client, me) => {
      await visibleCase(client, id);
      const result = await client.query(
        "INSERT INTO assigned_to (caseid, judgeid, assigneddate, assignmenttype) VALUES ($1, $2, $3, 'Original')",
        [id, judgeId, date]);
      console.log(`[ASSIGN] INSERT INTO assigned_to (case ${id}, judge ${judgeId}) -> result.rowCount = ${result.rowCount} ${by(me)}`);
    });
    res.status(201).json({ message: `Case ${id} assigned to judge #${judgeId}.` });
  } catch (err) {
    sendDbError(res, err, 'ASSIGN');
  }
});

router.post('/cases/:id/transfer', async (req, res) => {
  const id = toPositiveInt(req.params.id);
  const judgeId = toPositiveInt(req.body.judgeId);
  const date = emptyToNull(req.body.date);
  const type = emptyToNull(req.body.type);
  const note = emptyToNull(req.body.note);
  const errors = [];
  if (!judgeId) errors.push('Choose the judge who takes over.');
  if (!isValidDate(date)) errors.push('Transfer date is required.');
  if (!['Transfer', 'Roster'].includes(type)) errors.push('Type must be Transfer or Roster.');
  if (fail(errors, res)) return;

  try {
    const assignments = await withSession(req, ['Court Admin'], async (client, me) => {
      await visibleCase(client, id);
      await client.query('CALL sp_transfer_case($1, $2, $3, $4, $5, $6)', [id, judgeId, date, me.personid, type, note]);
      console.log(`[TRANSFER] CALL sp_transfer_case(case ${id} -> judge ${judgeId}, ${type}) ${by(me)}`);
      return (await client.query(ASSIGNMENTS_SQL, [id])).rows;
    });
    const moved = assignments.length === 0 ? ' The case has moved to the new judge\'s court and leaves yours.' : '';
    res.json({ message: `Case ${id} handed over to judge #${judgeId} from ${date} (${type}).${moved}`, assignments });
  } catch (err) {
    sendDbError(res, err, 'TRANSFER');
  }
});

const CASE_HEADER_SQL = `
  SELECT cc.caseid, cc.cnr, cc.casetype, cc.status, cc.stage, cc.priority, cc.priorityreason, cc.disposaltype,
         cc.filingdate, cc.registrationdate, cc.courtfeedue, cc.legacyregisterref, cc.originalcaseid, cc.leadcaseid,
         c.courtname, cr.firrefnumber, cr.chargesheetrefnumber
    FROM court_case cc
    JOIN court c ON c.courtid = cc.courtid
    LEFT JOIN criminal_case cr ON cr.caseid = cc.caseid
   WHERE cc.caseid = $1`;

router.get('/cases/:id/full', async (req, res) => {
  try {
    const data = await withSession(req, COURT_USERS, async (client, me) => {
      const c = await visibleCase(client, toPositiveInt(req.params.id));
      const id = c.caseid;
      const result = {
        header: (await client.query(CASE_HEADER_SQL, [id])).rows[0],
        parties: (await client.query(PARTIES_OF_CASE_SQL, [id])).rows,
        assignments: (await client.query(ASSIGNMENTS_SQL, [id])).rows,
        hearings: (await client.query(HEARINGS_SQL, [id])).rows,
        orders: (await client.query(ORDERS_SQL, [id])).rows,
        adjournments: (await client.query(ADJOURNMENTS_SQL, [id])).rows,
      };
      console.log(`[DETAILS] case ${id}: ${result.parties.length} parties, ${result.hearings.length} hearings, ${result.orders.length} orders, ${result.adjournments.length} adjournments ${by(me)}`);
      return result;
    });
    res.json(data);
  } catch (err) {
    sendDbError(res, err, 'DETAILS');
  }
});

router.get('/transfer/cases', async (req, res) => {
  try {
    const rows = await withSession(req, ['Court Admin'], async (client) => (await client.query(
      `SELECT cc.caseid, cc.cnr, cc.casetype, cc.status,
              (SELECT p.name FROM assigned_to a JOIN person p ON p.personid = a.judgeid
                WHERE a.caseid = cc.caseid AND a.enddate IS NULL) AS current_judge,
              (SELECT a.judgeid FROM assigned_to a WHERE a.caseid = cc.caseid AND a.enddate IS NULL) AS current_judgeid
         FROM court_case cc
        WHERE cc.status IN ('Registered', 'Hearing')
        ORDER BY cc.caseid`)).rows);
    res.json(rows);
  } catch (err) {
    sendDbError(res, err, 'TRANSFER');
  }
});

router.get('/cases/:id/history', async (req, res) => {
  try {
    const rows = await withSession(req, COURT_USERS, async (client) => {
      const c = await visibleCase(client, toPositiveInt(req.params.id));
      return (await client.query(
        `SELECT logid, changedat, tablename, action, changed_by, oldvalue, newvalue
           FROM v_case_timeline WHERE caseid = $1 ORDER BY logid DESC`, [c.caseid])).rows;
    });
    res.json(rows);
  } catch (err) {
    sendDbError(res, err, 'HISTORY');
  }
});

module.exports = router;
