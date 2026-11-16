const CASE_TYPES = ['Criminal', 'Civil', 'Commercial', 'Family', 'Writ'];
const STATUSES = ['Filed', 'Returned', 'Registered', 'Hearing', 'Disposed', 'Under Appeal'];
const UNREGISTERED = ['Filed', 'Returned'];
const DECIDED = ['Disposed', 'Under Appeal'];
const RUNNING_STAGES = ['Adjourned', 'Part Heard', 'Evidence', 'Arguments', 'Reserved'];
const PRIORITIES = ['Normal', 'Urgent', 'Liberty'];
const DISPOSALS = ['Judgment', 'Mediation', 'Lok Adalat', 'Withdrawn'];
const PARTY_ROLES = ['Complainant', 'Accused', 'Petitioner', 'Respondent', 'Plaintiff', 'Defendant', 'Appellant'];
const CUSTODY = ['In Custody', 'On Bail', 'Not Arrested'];
const OUTCOMES = ['Listed', 'Adjourned', 'Evidence Recorded', 'Part Heard', 'Arguments Heard', 'Interim Order', 'Order Reserved', 'Disposed'];
const DOC_TYPES = ['Complaint', 'Evidence Affidavit', 'Exhibit', 'Memo of Appeal', 'Notice', 'Petition', 'Plaint', 'Reply',
  'Summons', 'Vakalatnama', 'Writ Petition', 'Written Arguments', 'Written Statement'];
const DOC_STAGES = ['Filing', 'Scrutiny', 'Pleadings', 'Evidence', 'Arguments', 'Judgment', 'Appeal'];
const CNR_FORMAT = /^[A-Z]{4}[0-9]{12}$/;

function isValidDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}

function isValidTime(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(s);
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

function optionalId(value, label, errors) {
  const raw = emptyToNull(value);
  if (raw === null) return null;
  const id = toPositiveInt(raw);
  if (!id) errors.push(`${label} must be a positive whole number.`);
  return id;
}

function validateCase(body, mode) {
  const errors = [];
  const caseType = emptyToNull(body.caseType);
  const courtId = toPositiveInt(body.courtId);
  const filingDate = emptyToNull(body.filingDate);
  const fee = emptyToNull(body.courtFeeDue) === null ? 0 : Number(body.courtFeeDue);
  const priority = emptyToNull(body.priority) || 'Normal';
  const priorityReason = emptyToNull(body.priorityReason);
  const legacyRef = emptyToNull(body.legacyRef);
  const originalCaseId = optionalId(body.originalCaseId, 'Appeal of case', errors);
  const leadCaseId = optionalId(body.leadCaseId, 'Lead case', errors);
  const firNumber = emptyToNull(body.firNumber);
  const chargeSheetNumber = emptyToNull(body.chargeSheetNumber);

  if (!CASE_TYPES.includes(caseType)) errors.push(`Case type must be one of: ${CASE_TYPES.join(', ')}.`);
  if (!courtId) errors.push('Court is required.');
  if (!isValidDate(filingDate)) errors.push('Filing date is required (YYYY-MM-DD).');
  if (isNaN(fee) || fee < 0) errors.push('Court fee due must be a number that is 0 or more.');
  if (!PRIORITIES.includes(priority)) errors.push(`Priority must be one of: ${PRIORITIES.join(', ')}.`);
  if (priority !== 'Normal' && !priorityReason) errors.push(`Give a reason for the ${priority} priority.`);
  if (priorityReason && priorityReason.length > 100) errors.push('Priority reason must be 100 characters or fewer.');
  if (legacyRef && legacyRef.length > 30) errors.push('Old register reference must be 30 characters or fewer.');
  if ((firNumber || chargeSheetNumber) && caseType !== 'Criminal') errors.push('FIR and charge sheet numbers are only for criminal cases.');
  if (chargeSheetNumber && !firNumber) errors.push('Enter the FIR number before the charge sheet number.');
  if (firNumber && firNumber.length > 25) errors.push('FIR number must be 25 characters or fewer.');
  if (chargeSheetNumber && chargeSheetNumber.length > 25) errors.push('Charge sheet number must be 25 characters or fewer.');

  const values = [caseType, filingDate, courtId, fee, priority, priority === 'Normal' ? null : priorityReason,
    legacyRef, originalCaseId, leadCaseId];
  const criminal = firNumber ? [firNumber, chargeSheetNumber] : null;
  if (mode === 'create') return { errors, values, criminal };

  const status = emptyToNull(body.status);
  const stage = emptyToNull(body.stage);
  const cnr = emptyToNull(body.cnr) && emptyToNull(body.cnr).toUpperCase();
  const registrationDate = emptyToNull(body.registrationDate);
  const returnReason = emptyToNull(body.returnReason);
  const disposalType = emptyToNull(body.disposalType);

  if (!STATUSES.includes(status)) errors.push(`Status must be one of: ${STATUSES.join(', ')}.`);
  const isRegistered = status && !UNREGISTERED.includes(status);
  const isDecided = DECIDED.includes(status);
  if (isRegistered) {
    if (!cnr || !CNR_FORMAT.test(cnr)) errors.push('CNR must be 4 capital letters followed by 12 digits, e.g. MHPU010000052025.');
    if (!isValidDate(registrationDate)) errors.push('Registration date is required once a case is registered.');
    else if (isValidDate(filingDate) && registrationDate < filingDate) errors.push('Registration date cannot be before the filing date.');
  }
  if (stage && !RUNNING_STAGES.includes(stage)) errors.push(`Stage must be one of: ${RUNNING_STAGES.join(', ')}.`);
  if (status === 'Returned' && !returnReason) errors.push('Return reason is required when a filing is returned.');
  if (returnReason && returnReason.length > 80) errors.push('Return reason must be 80 characters or fewer.');
  if (isDecided && !DISPOSALS.includes(disposalType)) errors.push(`Choose how the case was disposed of: ${DISPOSALS.join(', ')}.`);

  values.push(
    status,
    isDecided ? 'Disposed' : isRegistered ? stage : null,
    isRegistered ? cnr : null,
    isRegistered ? registrationDate : null,
    status === 'Returned' ? returnReason : null,
    isDecided ? disposalType : null,
  );
  return { errors, values, criminal };
}

module.exports = {
  CASE_TYPES, STATUSES, UNREGISTERED, DECIDED, RUNNING_STAGES, PRIORITIES, DISPOSALS, PARTY_ROLES, CUSTODY,
  OUTCOMES, DOC_TYPES, DOC_STAGES, CNR_FORMAT,
  isValidDate, isValidTime, toPositiveInt, emptyToNull, optionalId, validateCase,
};
