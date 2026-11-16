const express = require('express');
const { CASE_TYPES, isValidDate, toPositiveInt, emptyToNull } = require('../lib/validate');
const { userError, sendDbError } = require('../lib/errors');
const { STAFF, COURT_USERS, withSession, signedIn, asNotifier, by } = require('../lib/session');

const router = express.Router();

const CAUSE_LIST_SQL = `
  SELECT ROW_NUMBER() OVER (ORDER BY CASE cc.priority WHEN 'Urgent' THEN 1 WHEN 'Liberty' THEN 2 ELSE 3 END,
                                     h.hearingtime) AS sr_no,
         h.hearingid, h.hearingtime, h.endtime, h.mode, h.vclink, h.outcome,
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
    const data = await withSession(req, COURT_USERS, async (client, me) => {
      const started = process.hrtime.bigint();
      const rows = (await client.query(CAUSE_LIST_SQL, [date, me.courtid])).rows;
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      console.log(`[CAUSELIST] ${me.courtname} ${date} -> result.rowCount = ${rows.length} (${ms.toFixed(1)} ms)`);
      return { court: me.courtname, date, rows, ms };
    });
    res.json(data);
  } catch (err) {
    sendDbError(res, err, 'CAUSELIST');
  }
});

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
      const rows = (await client.query(
        'SELECT * FROM fn_search_cases($1::text, $2::text, $3::text, $4::date, $5::date, $6::text)',
        [cnr, party, advocate, from, to, legacy])).rows;
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

const sent = new Map();

function maskPhone(p) {
  return p ? `${p.slice(0, 2)}XXXXXX${p.slice(-2)}` : '';
}

function fmtTime(t) {
  return t ? String(t).slice(0, 5) : '';
}

function smsText(r) {
  return `NyayaTrack: your hearing in case ${r.cnr || '(not registered)'} at ${r.courtname} has moved from `
    + `${r.olddate} ${fmtTime(r.oldtime)} to ${r.newdate} ${fmtTime(r.newtime)}. Venue: ${r.venue}.`;
}

router.get('/notifications', async (req, res) => {
  try {
    const me = await signedIn(req);
    if (!STAFF.includes(me.approle)) throw userError('Only registry staff run the notification service (FR-27).', 403);
    const rows = await asNotifier(async (client) =>
      (await client.query('SELECT * FROM v_notification_queue ORDER BY changedat DESC, audience, name')).rows);
    res.json(rows.map((r) => {
      const key = `${r.logid}:${r.personid}:${r.audience}`;
      return {
        key, logid: r.logid, changedat: r.changedat, cnr: r.cnr, courtname: r.courtname, name: r.name,
        audience: r.audience, phone: maskPhone(r.contactnumber), mode: r.mode, venue: r.venue,
        olddate: r.olddate, oldtime: fmtTime(r.oldtime), newdate: r.newdate, newtime: fmtTime(r.newtime),
        message: smsText(r), sentAt: sent.get(key) || null,
      };
    }));
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
      const key = `${r.logid}:${r.personid}:${r.audience}`;
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

module.exports = router;
