require('dotenv').config({ quiet: true });
const path = require('path');
const express = require('express');
const pool = require('./db');
const { CASE_TYPES, STATUSES, PRIORITIES, RUNNING_STAGES, UNREGISTERED, DECIDED, isValidDate, toPositiveInt,
  emptyToNull, validateCase } = require('./lib/validate');
const { userError, sendDbError } = require('./lib/errors');
const { STAFF, COURT_USERS, DEFAULT_PERSON_ID, ACCOUNTS_SQL, withSession, by } = require('./lib/session');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/accounts', async (req, res) => {
  try {
    const result = await pool.query(ACCOUNTS_SQL);
    res.json({ defaultId: DEFAULT_PERSON_ID, accounts: result.rows });
  } catch (err) {
    sendDbError(res, err, 'ACCOUNTS');
  }
});

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
    (casetype, filingdate, courtid, courtfeedue, priority, priorityreason, legacyregisterref, originalcaseid, leadcaseid)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  RETURNING *`;

const INSERT_CRIMINAL_SQL = `
  INSERT INTO criminal_case (caseid, firrefnumber, chargesheetrefnumber)
  VALUES ($1, $2, $3)
  ON CONFLICT (caseid) DO UPDATE
     SET firrefnumber = EXCLUDED.firrefnumber, chargesheetrefnumber = EXCLUDED.chargesheetrefnumber`;

app.post('/api/cases', async (req, res) => {
  const { errors, values, criminal } = validateCase(req.body, 'create');
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });

  try {
    const created = await withSession(req, STAFF, async (client, me) => {
      const result = await client.query(INSERT_SQL, values);
      const caseId = result.rows[0].caseid;
      console.log(`[CREATE] INSERT INTO court_case -> result.rowCount = ${result.rowCount} ${by(me)}`);
      if (criminal) {
        const crim = await client.query(INSERT_CRIMINAL_SQL, [caseId, ...criminal]);
        console.log(`[CREATE] INSERT INTO criminal_case -> result.rowCount = ${crim.rowCount}`);
      }
      return result.rows[0];
    });
    console.log(`[CREATE] Case ${created.caseid} inserted successfully as Filed.`);
    res.status(201).json({ message: `Case ${created.caseid} filed successfully.`, case: created });
  } catch (err) {
    sendDbError(res, err, 'CREATE');
  }
});

const SELECT_SQL = `
  SELECT c.caseid, c.cnr, c.casetype, c.filingdate, c.registrationdate, c.status, c.stage,
         c.priority, c.priorityreason, c.disposaltype, c.courtfeedue, c.returnreason,
         c.legacyregisterref, c.courtid, ct.courtname, c.originalcaseid, c.leadcaseid,
         cr.firrefnumber, cr.chargesheetrefnumber
    FROM court_case c
    JOIN court ct ON ct.courtid = c.courtid
    LEFT JOIN criminal_case cr ON cr.caseid = c.caseid
   WHERE ($1::varchar IS NULL OR c.casetype = $1::varchar)
     AND ($2::varchar IS NULL OR c.status = $2::varchar)
     AND ($3::text IS NULL
          OR ($3::text = 'due'  AND c.courtfeedue > 0)
          OR ($3::text = 'none' AND c.courtfeedue = 0))
     AND ($4::date IS NULL OR
          (CASE WHEN $6::text = 'registration' THEN c.registrationdate ELSE c.filingdate END) >= $4::date)
     AND ($5::date IS NULL OR
          (CASE WHEN $6::text = 'registration' THEN c.registrationdate ELSE c.filingdate END) <= $5::date)
     AND ($8::varchar IS NULL OR c.priority = $8::varchar)
   ORDER BY
     CASE WHEN $7::text = 'priority' THEN
       CASE c.priority WHEN 'Urgent' THEN 1 WHEN 'Liberty' THEN 2 ELSE 3 END END ASC,
     CASE WHEN $7::text = 'filing_desc' THEN c.filingdate END DESC NULLS LAST,
     CASE WHEN $7::text = 'filing_asc' THEN c.filingdate END ASC NULLS LAST,
     CASE WHEN $7::text = 'reg_desc' THEN c.registrationdate END DESC NULLS LAST,
     CASE WHEN $7::text = 'reg_asc' THEN c.registrationdate END ASC NULLS LAST,
     CASE WHEN $7::text = 'fee_desc' THEN c.courtfeedue END DESC,
     CASE WHEN $7::text = 'fee_asc' THEN c.courtfeedue END ASC,
     CASE WHEN $7::text = 'id_asc' THEN c.caseid END ASC,
     c.caseid DESC`;

const SORTS = ['id_desc', 'id_asc', 'filing_desc', 'filing_asc', 'reg_desc', 'reg_asc', 'fee_desc', 'fee_asc', 'priority'];

function readFilters(query) {
  const errors = [];
  const type = emptyToNull(query.type);
  const status = emptyToNull(query.status);
  const fee = emptyToNull(query.fee);
  const dateField = emptyToNull(query.dateField) || 'filing';
  const from = emptyToNull(query.from);
  const to = emptyToNull(query.to);
  const sort = emptyToNull(query.sort) || 'id_desc';
  const priority = emptyToNull(query.priority);

  if (type && !CASE_TYPES.includes(type)) errors.push('Unknown case type filter.');
  if (status && !STATUSES.includes(status)) errors.push('Unknown status filter.');
  if (fee && !['due', 'none'].includes(fee)) errors.push('Fee filter must be "due" or "none".');
  if (!['filing', 'registration'].includes(dateField)) errors.push('Date filter must be on filing or registration date.');
  if (from && !isValidDate(from)) errors.push('"From" date is not valid.');
  if (to && !isValidDate(to)) errors.push('"To" date is not valid.');
  if (from && to && from > to) errors.push('"From" date must be on or before the "To" date.');
  if (!SORTS.includes(sort)) errors.push('Unknown sort order.');
  if (priority && !PRIORITIES.includes(priority)) errors.push('Unknown priority filter.');

  return { errors, values: [type, status, fee, from, to, dateField, sort, priority] };
}

app.get('/api/cases', async (req, res) => {
  const { errors, values } = readFilters(req.query);
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });

  try {
    const result = await withSession(req, COURT_USERS, (client) => client.query(SELECT_SQL, values));
    const [type, status, fee, from, to, dateField, sort, priority] = values;
    const active = { type, status, priority, fee, from, to };
    const used = Object.entries(active).filter(([, v]) => v !== null).map(([k, v]) => `${k}=${v}`);
    if (from || to) used.push(`dateField=${dateField}`);
    if (sort !== 'id_desc') used.push(`sort=${sort}`);
    console.log(`[READ] SELECT FROM court_case${used.length ? ' (filters: ' + used.join(', ') + ')' : ''} -> result.rowCount = ${result.rowCount}`);
    console.log(`[READ] ${result.rowCount} cases fetched successfully.`);
    res.json(result.rows);
  } catch (err) {
    sendDbError(res, err, 'READ');
  }
});

const UPDATE_SQL = `
  UPDATE court_case
     SET casetype = $1, filingdate = $2, courtid = $3, courtfeedue = $4, priority = $5,
         priorityreason = $6, legacyregisterref = $7, originalcaseid = $8, leadcaseid = $9,
         status = $10, stage = $11, cnr = $12, registrationdate = $13, returnreason = $14,
         disposaltype = $15
   WHERE caseid = $16
  RETURNING *`;

app.put('/api/cases/:id', async (req, res) => {
  const id = toPositiveInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Case ID in the URL must be a positive whole number.' });

  const { errors, values, criminal } = validateCase(req.body, 'update');
  if (values[7] === id) errors.push('A case cannot be an appeal of itself.');
  if (values[8] === id) errors.push('A case cannot be tagged to itself.');
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });

  try {
    const updated = await withSession(req, STAFF, async (client, me) => {
      const crimRow = await client.query('SELECT 1 FROM criminal_case WHERE caseid = $1', [id]);
      if (crimRow.rowCount && values[0] !== 'Criminal') {
        throw userError('This case has FIR details on record, so its type must stay Criminal.');
      }
      const result = await client.query(UPDATE_SQL, [...values, id]);
      console.log(`[UPDATE] UPDATE court_case WHERE caseid = ${id} -> result.rowCount = ${result.rowCount} ${by(me)}`);
      if (result.rowCount === 0) throw userError(`Case ${id} was not found in your court.`, 404);
      if (criminal) {
        const crim = await client.query(INSERT_CRIMINAL_SQL, [id, ...criminal]);
        console.log(`[UPDATE] UPSERT criminal_case WHERE caseid = ${id} -> result.rowCount = ${crim.rowCount}`);
      }
      return result.rows[0];
    });
    console.log(`[UPDATE] Case ${id} updated successfully.`);
    res.json({ message: `Case ${id} updated successfully.`, case: updated });
  } catch (err) {
    sendDbError(res, err, 'UPDATE');
  }
});

const JUDGE_UPDATE_SQL = `
  UPDATE court_case
     SET priority = $1, priorityreason = $2, stage = $3
   WHERE caseid = $4
  RETURNING *`;

app.put('/api/cases/:id/judge', async (req, res) => {
  const id = toPositiveInt(req.params.id);
  const priority = emptyToNull(req.body.priority) || 'Normal';
  const reason = emptyToNull(req.body.priorityReason);
  const stage = emptyToNull(req.body.stage);
  const errors = [];
  if (!id) errors.push('Case ID in the URL must be a positive whole number.');
  if (!PRIORITIES.includes(priority)) errors.push(`Priority must be one of: ${PRIORITIES.join(', ')}.`);
  if (priority !== 'Normal' && !reason) errors.push(`Give a reason for the ${priority} priority.`);
  if (reason && reason.length > 100) errors.push('Priority reason must be 100 characters or fewer.');
  if (stage && !RUNNING_STAGES.includes(stage)) errors.push(`Stage must be one of: ${RUNNING_STAGES.join(', ')}.`);
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });

  try {
    const updated = await withSession(req, ['Judge'], async (client, me) => {
      const current = (await client.query('SELECT status, stage FROM court_case WHERE caseid = $1', [id])).rows[0];
      if (!current) throw userError(`Case ${id} was not found in your court.`, 404);
      let newStage = stage;
      if (UNREGISTERED.includes(current.status)) newStage = null;
      if (DECIDED.includes(current.status)) newStage = 'Disposed';
      const result = await client.query(JUDGE_UPDATE_SQL, [priority, priority === 'Normal' ? null : reason, newStage, id]);
      console.log(`[UPDATE] UPDATE court_case SET priority, stage WHERE caseid = ${id} -> result.rowCount = ${result.rowCount} ${by(me)}`);
      return result.rows[0];
    });
    res.json({ message: `Priority and stage of case ${id} saved.`, case: updated });
  } catch (err) {
    sendDbError(res, err, 'UPDATE');
  }
});

const DELETE_SQL = 'DELETE FROM court_case WHERE caseid = $1';

app.delete('/api/cases/:id', async (req, res) => {
  const id = toPositiveInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Case ID in the URL must be a positive whole number.' });

  try {
    await withSession(req, null, async (client, me) => {
      const result = await client.query(DELETE_SQL, [id]);
      console.log(`[DELETE] DELETE FROM court_case WHERE caseid = ${id} -> result.rowCount = ${result.rowCount} ${by(me)}`);
      if (result.rowCount === 0) throw userError(`Case ${id} was not found.`, 404);
    });
    console.log(`[DELETE] Case ${id} deleted successfully.`);
    res.json({ message: `Case ${id} deleted successfully.` });
  } catch (err) {
    sendDbError(res, err, 'DELETE');
  }
});

app.use('/api', require('./routes/casefile'));
app.use('/api', require('./routes/registry'));
app.use('/api', require('./routes/portals'));

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`NyayaTrack server running at http://localhost:${PORT}`);
});
