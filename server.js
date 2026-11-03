require('dotenv').config({ quiet: true });
const path = require('path');
const express = require('express');
const pool = require('./db');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const CASE_TYPES = ['Civil', 'Criminal', 'Family', 'Commercial', 'Writ'];
const STATUSES = ['Filed', 'Returned', 'Registered', 'Hearing', 'Disposed', 'Under Appeal'];
const UNREGISTERED = ['Filed', 'Returned'];

function isValidDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}

function toPositiveInt(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function emptyToNull(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function validateCase(body) {
  const errors = [];
  const caseType = emptyToNull(body.caseType);
  const status = emptyToNull(body.status);
  const filingDate = emptyToNull(body.filingDate);
  const registrationDate = emptyToNull(body.registrationDate);
  const cnr = emptyToNull(body.cnr) && emptyToNull(body.cnr).toUpperCase();
  const returnReason = emptyToNull(body.returnReason);
  const courtId = toPositiveInt(body.courtId);
  const originalCaseId = emptyToNull(body.originalCaseId);
  const fee = emptyToNull(body.courtFeeDue) === null ? 0 : Number(body.courtFeeDue);

  if (!CASE_TYPES.includes(caseType)) errors.push(`Case type must be one of: ${CASE_TYPES.join(', ')}.`);
  if (!STATUSES.includes(status)) errors.push(`Status must be one of: ${STATUSES.join(', ')}.`);
  if (!isValidDate(filingDate)) errors.push('Filing date is required (YYYY-MM-DD).');
  if (!courtId) errors.push('Court is required.');
  if (isNaN(fee) || fee < 0) errors.push('Court fee due must be a number that is 0 or more.');

  const isRegistered = status && !UNREGISTERED.includes(status);
  if (isRegistered) {
    if (!cnr || !/^[A-Z0-9]{16}$/.test(cnr)) errors.push('CNR must be exactly 16 letters/digits for a registered case.');
    if (!isValidDate(registrationDate)) errors.push('Registration date is required for a registered case.');
    else if (isValidDate(filingDate) && registrationDate < filingDate) errors.push('Registration date cannot be before the filing date.');
  } else if (status) {
    if (cnr) errors.push(`A case with status "${status}" cannot have a CNR yet.`);
    if (registrationDate) errors.push(`A case with status "${status}" cannot have a registration date yet.`);
  }

  if (status === 'Returned' && !returnReason) errors.push('Return reason is required when status is "Returned".');
  if (status !== 'Returned' && returnReason) errors.push('Return reason is only allowed when status is "Returned".');
  if (returnReason && returnReason.length > 80) errors.push('Return reason must be 80 characters or fewer.');

  let origId = null;
  if (originalCaseId !== null) {
    origId = toPositiveInt(originalCaseId);
    if (!origId) errors.push('Original case ID must be a positive whole number.');
  }

  return {
    errors,
    values: [cnr, caseType, filingDate, isRegistered ? registrationDate : null, status, fee,
      status === 'Returned' ? returnReason : null, courtId, origId],
  };
}

function sendDbError(res, err, action) {
  console.error(`[${action}] FAILED -> ${err.code || ''} ${err.message}`);
  switch (err.code) {
    case '23505':
      return res.status(409).json({ error: 'Another case already has this CNR. CNR must be unique.' });
    case '23503':
      if (err.constraint === 'fk_case_court') return res.status(400).json({ error: 'The selected court does not exist.' });
      if (err.constraint === 'fk_case_orig') return res.status(400).json({ error: 'The original case ID does not exist.' });
    case '23001':
      return res.status(409).json({
        error: 'This case cannot be deleted because other records (hearings, documents, fee payments, parties, etc.) still refer to it.',
      });
    case '23514':
      return res.status(400).json({ error: `The data breaks a database rule (${err.constraint}).` });
    case 'P0001':
      return res.status(400).json({ error: err.message });
    case '22P02':
    case '22007':
    case '22008':
      return res.status(400).json({ error: 'One of the values has an invalid format.' });
    case 'ECONNREFUSED':
    case '28P01':
    case '3D000':
      return res.status(503).json({ error: 'Cannot connect to the database. Check that PostgreSQL is running and .env is correct.' });
    default:
      return res.status(500).json({ error: 'Unexpected database error: ' + err.message });
  }
}

app.get('/api/courts', async (req, res) => {
  try {
    const result = await pool.query('SELECT courtid, courtname, courttype FROM court ORDER BY courtid');
    res.json(result.rows);
  } catch (err) {
    sendDbError(res, err, 'COURTS');
  }
});

const INSERT_SQL = `
  INSERT INTO court_case
    (caseid, cnr, casetype, filingdate, registrationdate, status, courtfeedue, returnreason, courtid, originalcaseid)
  VALUES
    ((SELECT COALESCE(MAX(caseid), 0) + 1 FROM court_case), $1, $2, $3, $4, $5, $6, $7, $8, $9)
  RETURNING *`;

app.post('/api/cases', async (req, res) => {
  const { errors, values } = validateCase(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });

  try {
    const result = await pool.query(INSERT_SQL, values);
    console.log(`[CREATE] INSERT INTO court_case -> result.rowCount = ${result.rowCount}`);
    console.log(`[CREATE] Case ${result.rows[0].caseid} inserted successfully.`);
    res.status(201).json({ message: `Case ${result.rows[0].caseid} added successfully.`, case: result.rows[0] });
  } catch (err) {
    sendDbError(res, err, 'CREATE');
  }
});

const SELECT_SQL = `
  SELECT c.caseid, c.cnr, c.casetype, c.filingdate, c.registrationdate, c.status,
         c.courtfeedue, c.returnreason, c.courtid, ct.courtname, c.originalcaseid
    FROM court_case c
    JOIN court ct ON ct.courtid = c.courtid
   WHERE ($1::varchar IS NULL OR c.casetype = $1::varchar)
     AND ($2::varchar IS NULL OR c.status = $2::varchar)
     AND ($3::text IS NULL
          OR ($3::text = 'due'  AND c.courtfeedue > 0)
          OR ($3::text = 'none' AND c.courtfeedue = 0))
     AND ($4::date IS NULL OR
          (CASE WHEN $6::text = 'registration' THEN c.registrationdate ELSE c.filingdate END) >= $4::date)
     AND ($5::date IS NULL OR
          (CASE WHEN $6::text = 'registration' THEN c.registrationdate ELSE c.filingdate END) <= $5::date)
   ORDER BY c.caseid DESC`;

function readFilters(query) {
  const errors = [];
  const type = emptyToNull(query.type);
  const status = emptyToNull(query.status);
  const fee = emptyToNull(query.fee);
  const dateField = emptyToNull(query.dateField) || 'filing';
  const from = emptyToNull(query.from);
  const to = emptyToNull(query.to);

  if (type && !CASE_TYPES.includes(type)) errors.push('Unknown case type filter.');
  if (status && !STATUSES.includes(status)) errors.push('Unknown status filter.');
  if (fee && !['due', 'none'].includes(fee)) errors.push('Fee filter must be "due" or "none".');
  if (!['filing', 'registration'].includes(dateField)) errors.push('Date filter must be on filing or registration date.');
  if (from && !isValidDate(from)) errors.push('"From" date is not valid.');
  if (to && !isValidDate(to)) errors.push('"To" date is not valid.');
  if (from && to && from > to) errors.push('"From" date must be on or before the "To" date.');

  return { errors, values: [type, status, fee, from, to, dateField] };
}

app.get('/api/cases', async (req, res) => {
  const { errors, values } = readFilters(req.query);
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });

  try {
    const result = await pool.query(SELECT_SQL, values);
    const [type, status, fee, from, to, dateField] = values;
    const active = { type, status, fee, from, to };
    const used = Object.entries(active).filter(([, v]) => v !== null).map(([k, v]) => `${k}=${v}`);
    if (from || to) used.push(`dateField=${dateField}`);
    console.log(`[READ] SELECT FROM court_case${used.length ? ' (filters: ' + used.join(', ') + ')' : ''} -> result.rowCount = ${result.rowCount}`);
    console.log(`[READ] ${result.rowCount} cases fetched successfully.`);
    res.json(result.rows);
  } catch (err) {
    sendDbError(res, err, 'READ');
  }
});

const UPDATE_SQL = `
  UPDATE court_case
     SET cnr = $1, casetype = $2, filingdate = $3, registrationdate = $4, status = $5,
         courtfeedue = $6, returnreason = $7, courtid = $8, originalcaseid = $9
   WHERE caseid = $10
  RETURNING *`;

const APP_STAFF_ID = String(toPositiveInt(process.env.APP_STAFF_ID) || 391);

app.put('/api/cases/:id', async (req, res) => {
  const id = toPositiveInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Case ID in the URL must be a positive whole number.' });

  const { errors, values } = validateCase(req.body);
  if (values[8] === id) errors.push('A case cannot be an appeal of itself.');
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('nyaya.staffid', $1, true)", [APP_STAFF_ID]);
    const result = await client.query(UPDATE_SQL, [...values, id]);
    await client.query('COMMIT');
    console.log(`[UPDATE] UPDATE court_case WHERE caseid = ${id} -> result.rowCount = ${result.rowCount}`);
    if (result.rowCount === 0) return res.status(404).json({ error: `Case ${id} was not found.` });
    console.log(`[UPDATE] Case ${id} updated successfully.`);
    res.json({ message: `Case ${id} updated successfully.`, case: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    sendDbError(res, err, 'UPDATE');
  } finally {
    client.release();
  }
});

const DELETE_SQL = 'DELETE FROM court_case WHERE caseid = $1';

app.delete('/api/cases/:id', async (req, res) => {
  const id = toPositiveInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Case ID in the URL must be a positive whole number.' });

  try {
    const result = await pool.query(DELETE_SQL, [id]);
    console.log(`[DELETE] DELETE FROM court_case WHERE caseid = ${id} -> result.rowCount = ${result.rowCount}`);
    if (result.rowCount === 0) return res.status(404).json({ error: `Case ${id} was not found.` });
    console.log(`[DELETE] Case ${id} deleted successfully.`);
    res.json({ message: `Case ${id} deleted successfully.` });
  } catch (err) {
    sendDbError(res, err, 'DELETE');
  }
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`NyayaTrack server running at http://localhost:${PORT}`);
});
