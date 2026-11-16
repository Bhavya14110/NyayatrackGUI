const express = require('express');
const { toPositiveInt, emptyToNull } = require('../lib/validate');
const { userError, sendDbError } = require('../lib/errors');
const { withSession, by } = require('../lib/session');

const router = express.Router();

router.get('/portal/litigant', async (req, res) => {
  try {
    const data = await withSession(req, ['Litigant'], async (client) => ({
      cases: (await client.query('SELECT * FROM v_litigant_case_status ORDER BY next_hearing_date NULLS LAST')).rows,
      events: (await client.query('SELECT * FROM v_my_case_events ORDER BY hearingdate DESC, hearingtime DESC')).rows,
      documents: (await client.query('SELECT * FROM v_my_case_documents ORDER BY submissiondate DESC')).rows,
    }));
    res.json(data);
  } catch (err) {
    sendDbError(res, err, 'PORTAL');
  }
});

router.get('/portal/advocate', async (req, res) => {
  try {
    const data = await withSession(req, ['Advocate'], async (client) => ({
      cases: (await client.query('SELECT * FROM v_advocate_my_cases ORDER BY next_hearing NULLS LAST, cnr')).rows,
      events: (await client.query(
        'SELECT * FROM v_my_case_events WHERE hearingdate >= CURRENT_DATE ORDER BY hearingdate, hearingtime')).rows,
      documents: (await client.query('SELECT * FROM v_my_case_documents ORDER BY submissiondate DESC')).rows,
    }));
    res.json(data);
  } catch (err) {
    sendDbError(res, err, 'PORTAL');
  }
});

const ROLES = ['Judge', 'Registry Clerk', 'Advocate', 'Litigant', 'Court Admin', 'System Admin'];

router.get('/admin/accounts', async (req, res) => {
  try {
    const data = await withSession(req, ['System Admin'], async (client) => ({
      accounts: (await client.query(
        'SELECT userid, personid, approle, courtid, isactive FROM user_account ORDER BY approle, courtid NULLS FIRST, personid')).rows,
      summary: (await client.query('SELECT * FROM v_audit_summary ORDER BY changes DESC')).rows,
    }));
    res.json(data);
  } catch (err) {
    sendDbError(res, err, 'ADMIN');
  }
});

router.post('/admin/accounts', async (req, res) => {
  const personId = toPositiveInt(req.body.personId);
  const role = emptyToNull(req.body.role);
  const courtId = toPositiveInt(req.body.courtId);
  const errors = [];
  if (!personId) errors.push('Person ID must be a positive whole number.');
  if (!ROLES.includes(role)) errors.push(`Role must be one of: ${ROLES.join(', ')}.`);
  if (['Judge', 'Registry Clerk', 'Court Admin'].includes(role) && !courtId) errors.push(`A ${role} account needs a court.`);
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });

  try {
    const userId = await withSession(req, ['System Admin'], async (client, me) => {
      const result = await client.query(
        'INSERT INTO user_account (personid, approle, courtid) VALUES ($1, $2, $3) RETURNING userid',
        [personId, role, ['Judge', 'Registry Clerk', 'Court Admin'].includes(role) ? courtId : null]);
      console.log(`[ADMIN] INSERT INTO user_account (person ${personId}, ${role}) -> result.rowCount = ${result.rowCount} ${by(me)}`);
      return result.rows[0].userid;
    });
    res.status(201).json({ message: `Account #${userId} created for person #${personId} as ${role}.` });
  } catch (err) {
    sendDbError(res, err, 'ADMIN');
  }
});

router.put('/admin/accounts/:uid/active', async (req, res) => {
  const uid = toPositiveInt(req.params.uid);
  const active = req.body.active === true;
  if (!uid) return res.status(400).json({ error: 'Account ID must be a positive whole number.' });

  try {
    await withSession(req, ['System Admin'], async (client, me) => {
      const result = await client.query('UPDATE user_account SET isactive = $1 WHERE userid = $2', [active, uid]);
      console.log(`[ADMIN] UPDATE user_account SET isactive = ${active} WHERE userid = ${uid} -> result.rowCount = ${result.rowCount} ${by(me)}`);
      if (!result.rowCount) throw userError(`Account ${uid} was not found.`, 404);
    });
    res.json({ message: `Account #${uid} ${active ? 'activated' : 'deactivated'}.` });
  } catch (err) {
    sendDbError(res, err, 'ADMIN');
  }
});

module.exports = router;
