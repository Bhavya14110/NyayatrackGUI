const express = require('express');
const pool = require('../db');
const { CASE_TYPES, isValidDate, toPositiveInt, emptyToNull } = require('../lib/validate');
const { userError, sendDbError } = require('../lib/errors');
const { STAFF, COURT_USERS, withSession, signedIn, asNotifier, asLitigant, by } = require('../lib/session');
const { sent, maskPhone, smsText, keyOf, toNotification } = require('../lib/notify');

const router = express.Router();

async function courtUser(req) {
  const me = await signedIn(req);
  if (!COURT_USERS.includes(me.approle)) throw userError(`Signed in as ${me.approle}: this is not part of your role (role-based access, FR-27).`, 403);
  return me;
}

const DASH_TOTALS_SQL = `
  SELECT (SELECT COUNT(*) FROM court_case) AS all_cases,
         (SELECT COUNT(*) FROM v_pending_cases) AS pending_cases,
         (SELECT COUNT(DISTINCT caseid) FROM hearing
           WHERE hearingdate BETWEEN date_trunc('month', CURRENT_DATE)::date AND CURRENT_DATE
             AND outcome <> 'Listed') AS heard_this_month,
         (SELECT COUNT(*) FROM hearing WHERE hearingdate = CURRENT_DATE) AS hearings_today`;

const DASH_PENDING_SQL = `
  SELECT casetype,
         COUNT(*) FILTER (WHERE age_days <= 365)               AS upto_1y,
         COUNT(*) FILTER (WHERE age_days BETWEEN 366 AND 1095) AS y1_to_3,
         COUNT(*) FILTER (WHERE age_days > 1095)               AS over_3y,
         COUNT(*) AS total
    FROM v_pending_cases
   GROUP BY casetype
   ORDER BY total DESC, casetype`;

const DASH_STATUS_SQL = `
  SELECT status, COUNT(*) AS cases
    FROM court_case
   GROUP BY status
   ORDER BY cases DESC`;

router.get('/dashboard', async (req, res) => {
  try {
    await courtUser(req);
    const totals = (await pool.query(DASH_TOTALS_SQL)).rows[0];
    const pending = (await pool.query(DASH_PENDING_SQL)).rows;
    const status = (await pool.query(DASH_STATUS_SQL)).rows;
    console.log(`[DASHBOARD] ${totals.all_cases} cases, ${totals.pending_cases} pending -> result.rowCount = ${pending.length + status.length}`);
    res.json({ totals, pending, status });
  } catch (err) {
    sendDbError(res, err, 'DASHBOARD');
  }
});

const CAUSE_LIST_SQL = `
  SELECT ROW_NUMBER() OVER (ORDER BY CASE cc.priority WHEN 'Urgent' THEN 1 WHEN 'Liberty' THEN 2 ELSE 3 END,
                                     h.hearingtime) AS sr_no,
         h.hearingid, h.courtid, h.hearingtime, h.endtime, h.mode, h.vclink, h.outcome, h.courtroomnumber,
         COALESCE('Court Room ' || h.courtroomnumber, 'Video Conference') AS venue,
         jp.name AS judge, cc.caseid, cc.cnr, cc.casetype, cc.priority, cc.stage,
         (SELECT STRING_AGG(p.name || ' (' || i.partyrole || ')', ', ' ORDER BY i.partyrole)
            FROM involved_in i JOIN person p ON p.personid = i.personid
           WHERE i.caseid = cc.caseid) AS parties
    FROM hearing h
    JOIN court_case cc ON cc.caseid = h.caseid
    JOIN person jp ON jp.personid = h.judgeid
   WHERE h.hearingdate = $1 AND h.courtid = $2
   ORDER BY sr_no`;

router.get('/causelist', async (req, res) => {
  const date = emptyToNull(req.query.date);
  if (!isValidDate(date)) return res.status(400).json({ error: 'Choose the date of the cause list.' });

  try {
    const me = await courtUser(req);
    const court = toPositiveInt(req.query.court) || me.courtid;
    const courtRow = (await pool.query('SELECT courtname FROM court WHERE courtid = $1', [court])).rows[0];
    if (!courtRow) throw userError('That court does not exist.', 404);
    const started = process.hrtime.bigint();
    const rows = (await pool.query(CAUSE_LIST_SQL, [date, court])).rows;
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    console.log(`[CAUSELIST] ${courtRow.courtname} ${date} -> result.rowCount = ${rows.length} (${ms.toFixed(1)} ms)`);
    res.json({ courtid: court, court: courtRow.courtname, date, rows, ms });
  } catch (err) {
    sendDbError(res, err, 'CAUSELIST');
  }
});

const SEARCH_SQL = `
  SELECT * FROM fn_search_cases(p_cnr => $1::text, p_party => $2::text, p_advocate => $3::text,
                                p_from => $4::date, p_to => $5::date, p_legacy => $6::text)`;

router.get('/search', async (req, res) => {
  const cnr = emptyToNull(req.query.cnr) && emptyToNull(req.query.cnr).toUpperCase();
  const party = emptyToNull(req.query.party);
  const advocate = emptyToNull(req.query.advocate);
  const from = emptyToNull(req.query.from);
  const to = emptyToNull(req.query.to);
  const legacy = emptyToNull(req.query.legacy);
  const errors = [];
  if (!cnr && !party && !advocate && !from && !to && !legacy) errors.push('Enter at least one search criterion.');
  if (from && !isValidDate(from)) errors.push('"Filed from" date is not valid.');
  if (to && !isValidDate(to)) errors.push('"Filed to" date is not valid.');
  if ([cnr, party, advocate, legacy].some((v) => v && v.length > 60)) errors.push('Search text is too long.');
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });

  try {
    const data = await withSession(req, COURT_USERS, async (client, me) => {
      const started = process.hrtime.bigint();
      const rows = (await client.query(SEARCH_SQL, [cnr, party, advocate, from, to, legacy])).rows;
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      console.log(`[SEARCH] fn_search_cases -> result.rowCount = ${rows.length} (${ms.toFixed(1)} ms) ${by(me)}`);
      return { rows, ms };
    });
    res.json(data);
  } catch (err) {
    sendDbError(res, err, 'SEARCH');
  }
});

const PENDENCY_SQL = `
  SELECT casetype,
         COUNT(*) FILTER (WHERE age_days <= 90)               AS upto_3m,
         COUNT(*) FILTER (WHERE age_days BETWEEN 91 AND 180)  AS m3_to_6,
         COUNT(*) FILTER (WHERE age_days BETWEEN 181 AND 365) AS m6_to_12,
         COUNT(*) FILTER (WHERE age_days > 365)               AS over_1y,
         COUNT(*) AS total,
         ROUND(AVG(age_days)) AS avg_age_days
    FROM v_pending_cases
   GROUP BY casetype
   ORDER BY total DESC`;

const BANDS = {
  upto_3m: [0, 90], m3_to_6: [91, 180], m6_to_12: [181, 365], over_1y: [366, 1000000], total: [0, 1000000],
};

const PENDING_CASES_SQL = `
  SELECT caseid, cnr, casetype, status, stage, priority, filingdate, age_days
    FROM v_pending_cases
   WHERE ($1::varchar IS NULL OR casetype = $1::varchar)
     AND age_days BETWEEN $2 AND $3
   ORDER BY age_days DESC`;

const DISPOSAL_SQL = `
  SELECT disposaltype, COUNT(*) AS cases,
         ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
    FROM court_case
   WHERE status IN ('Disposed', 'Under Appeal')
   GROUP BY disposaltype
   ORDER BY cases DESC`;

const REPEAT_GROUND_SQL = `
  SELECT h.caseid, cc.cnr, a.ground, COUNT(*) AS times_used,
         STRING_AGG(a.decision, ', ' ORDER BY h.hearingdate) AS decisions,
         MAX(h.hearingdate) AS last_used_on
    FROM adjournment a
    JOIN hearing h ON h.hearingid = a.hearingid
    JOIN court_case cc ON cc.caseid = h.caseid
   GROUP BY h.caseid, cc.cnr, a.ground
  HAVING COUNT(*) >= 2
   ORDER BY times_used DESC, h.caseid`;

router.get('/reports', async (req, res) => {
  try {
    const data = await withSession(req, COURT_USERS, async (client, me) => ({
      court: me.courtname,
      pendency: (await client.query(PENDENCY_SQL)).rows,
      disposal: (await client.query(DISPOSAL_SQL)).rows,
      repeatGrounds: (await client.query(REPEAT_GROUND_SQL)).rows,
    }));
    res.json(data);
  } catch (err) {
    sendDbError(res, err, 'REPORTS');
  }
});

router.get('/reports/pending', async (req, res) => {
  const type = emptyToNull(req.query.type);
  const band = BANDS[req.query.band] || BANDS.total;
  if (type && !CASE_TYPES.includes(type)) return res.status(400).json({ error: 'Unknown case type.' });

  try {
    const result = await withSession(req, COURT_USERS, (client) => client.query(PENDING_CASES_SQL, [type, band[0], band[1]]));
    res.json(result.rows);
  } catch (err) {
    sendDbError(res, err, 'REPORTS');
  }
});

router.get('/notifications', async (req, res) => {
  try {
    const me = await signedIn(req);
    if (!STAFF.includes(me.approle)) throw userError('Only registry staff run the notification service (FR-27).', 403);
    const rows = await asNotifier(async (client) =>
      (await client.query('SELECT * FROM v_notification_queue ORDER BY changedat DESC, audience, name')).rows);
    res.json(rows.map(toNotification));
  } catch (err) {
    sendDbError(res, err, 'NOTIFY');
  }
});

router.post('/notifications/send', async (req, res) => {
  const keys = Array.isArray(req.body.keys) ? req.body.keys.map(String) : [];
  if (!keys.length) return res.status(400).json({ error: 'Choose the notifications to send.' });

  try {
    const me = await signedIn(req);
    if (!STAFF.includes(me.approle)) throw userError('Only registry staff run the notification service (FR-27).', 403);
    const rows = await asNotifier(async (client) =>
      (await client.query('SELECT * FROM v_notification_queue')).rows);
    let count = 0;
    for (const r of rows) {
      const key = keyOf(r);
      if (!keys.includes(key) || sent.has(key)) continue;
      sent.set(key, new Date().toISOString());
      count++;
      console.log(`[NOTIFY] SMS to ${maskPhone(r.contactnumber)} (${r.name}, ${r.audience}): ${smsText(r)}`);
    }
    res.json({ message: `${count} notification${count === 1 ? '' : 's'} handed to the SMS / e-mail sender (simulated: no gateway is connected).` });
  } catch (err) {
    sendDbError(res, err, 'NOTIFY');
  }
});

router.get('/litigant-view', async (req, res) => {
  const personId = toPositiveInt(req.query.person);
  if (!personId) return res.status(400).json({ error: 'Choose the party whose view you want to see.' });

  try {
    const me = await signedIn(req);
    if (!STAFF.includes(me.approle)) throw userError('Only registry staff can open the litigant view for a party (FR-27).', 403);
    const party = (await pool.query(
      'SELECT p.personid, p.name FROM party pa JOIN person p ON p.personid = pa.personid WHERE pa.personid = $1', [personId])).rows[0];
    if (!party) throw userError(`Person ${personId} is not a party in any case.`, 404);
    const cases = await asLitigant(personId, async (client) =>
      (await client.query('SELECT * FROM v_litigant_case_status ORDER BY next_hearing_date NULLS LAST')).rows);
    console.log(`[LITIGANT] SET LOCAL ROLE nyaya_litigant, nyaya.personid = ${personId} -> result.rowCount = ${cases.length} ${by(me)}`);
    res.json({ party, cases });
  } catch (err) {
    sendDbError(res, err, 'LITIGANT');
  }
});

module.exports = router;
