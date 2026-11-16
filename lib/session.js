const pool = require('../db');
const { toPositiveInt } = require('./validate');
const { userError } = require('./errors');

const ROLE_SQL = {
  'Judge': 'SET LOCAL ROLE nyaya_judge',
  'Registry Clerk': 'SET LOCAL ROLE nyaya_clerk',
  'Advocate': 'SET LOCAL ROLE nyaya_advocate',
  'Litigant': 'SET LOCAL ROLE nyaya_litigant',
  'Court Admin': 'SET LOCAL ROLE nyaya_court_admin',
  'System Admin': 'SET LOCAL ROLE nyaya_sysadmin',
};
const NOTIFIER_SQL = 'SET LOCAL ROLE nyaya_notifier';

const STAFF = ['Registry Clerk', 'Court Admin'];
const COURT_USERS = ['Registry Clerk', 'Court Admin', 'Judge'];
const DEFAULT_PERSON_ID = toPositiveInt(process.env.APP_STAFF_ID);

const ACCOUNTS_SQL = `
  SELECT u.personid, p.name, u.approle, u.courtid, c.courtname
    FROM user_account u
    JOIN person p ON p.personid = u.personid
    LEFT JOIN court c ON c.courtid = u.courtid
   WHERE u.isactive
   ORDER BY u.approle, c.courtname NULLS FIRST, p.name`;

const ACCOUNT_SQL = `
  SELECT u.personid, p.name, u.approle, u.courtid, c.courtname
    FROM user_account u
    JOIN person p ON p.personid = u.personid
    LEFT JOIN court c ON c.courtid = u.courtid
   WHERE u.isactive AND u.personid = $1`;

async function signedIn(req) {
  const id = toPositiveInt(req.get('x-person')) || DEFAULT_PERSON_ID;
  const account = (await pool.query(ACCOUNT_SQL, [id])).rows[0];
  if (!account) throw userError('Sign in with an active user account first.', 401);
  return account;
}

async function inTransaction(roleSql, personId, work, account) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(roleSql);
    if (personId) await client.query("SELECT set_config('nyaya.personid', $1, true)", [String(personId)]);
    const result = await work(client, account);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function withSession(req, roles, work) {
  const account = await signedIn(req);
  if (roles && !roles.includes(account.approle)) {
    throw userError(`Signed in as ${account.approle}: this is not part of your role (role-based access, FR-27).`, 403);
  }
  return inTransaction(ROLE_SQL[account.approle], account.personid, work, account);
}

function asNotifier(work) {
  return inTransaction(NOTIFIER_SQL, null, work, null);
}

const by = (a) => `(by ${a.personid} ${a.name}, ${a.approle})`;

module.exports = { STAFF, COURT_USERS, DEFAULT_PERSON_ID, ACCOUNTS_SQL, signedIn, withSession, asNotifier, by };
