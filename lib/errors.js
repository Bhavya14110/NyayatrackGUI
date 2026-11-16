function userError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const CHECK_MESSAGES = {
  ck_case_cnr: 'CNR must be 4 capital letters followed by 12 digits.',
  ck_case_registered: 'A registered case needs a CNR and a registration date.',
  ck_case_regdate: 'Registration date cannot be before the filing date.',
  ck_case_returned: 'A returned filing needs a return reason, and only a returned filing has one.',
  ck_case_prio_why: 'An Urgent or Liberty priority needs a reason.',
  ck_case_disp_status: 'Only a decided case has a disposal type, and every decided case needs one.',
  ck_case_stage_disp: 'A decided case must be at the Disposed stage.',
  ck_case_stage_none: 'A filing that is not registered yet has no stage.',
  ck_case_fee: 'Court fee due cannot be negative.',
  ck_case_self_appeal: 'A case cannot be an appeal of itself.',
  ck_case_self_lead: 'A case cannot be tagged to itself.',
  ck_pay_amt: 'A payment must be more than ₹0.',
  ck_inv_custody_role: 'Custody status is only for an accused.',
  ck_person_phone: 'Phone number must be 10 digits starting with 6, 7, 8 or 9.',
  ck_hear_room: 'An in-person hearing needs a courtroom; a video hearing has none.',
  ck_hear_vclink: 'A video hearing needs a link; an in-person hearing has none.',
  ck_hear_time: 'The hearing must end after it starts.',
  ck_adj_reason: 'A granted or refused adjournment needs a reason.',
  ck_acc_court: 'Judges, registry clerks and court admins belong to one court; other roles have no court.',
  ck_order_type: 'Order type must be Interim or Final.',
};

const UNIQUE_MESSAGES = [
  ['cnr', 'Another case already has this CNR. CNR must be unique.'],
  ['involved_in', 'This person is already a party in this case.'],
  ['receipt', 'That receipt number is already used. Please try again.'],
  ['ux_one_current_judge', 'This case already has a current judge. Use a transfer or roster change instead.'],
  ['user_account_personid', 'This person already has a user account.'],
  ['order_condition', 'The same condition is listed twice.'],
];

function sendDbError(res, err, action) {
  console.error(`[${action}] FAILED -> ${err.code || err.status || ''} ${err.message}`);
  if (err.status) return res.status(err.status).json({ error: err.message });
  const c = err.constraint || '';
  switch (err.code) {
    case '23505': {
      const hit = UNIQUE_MESSAGES.find(([key]) => c.includes(key));
      return res.status(409).json({ error: hit ? hit[1] : `This value already exists (${c}).` });
    }
    case '23503':
      if (c.includes('courtid')) return res.status(400).json({ error: 'The selected court does not exist.' });
      if (c.includes('originalcaseid')) return res.status(400).json({ error: 'The original case of this appeal does not exist.' });
      if (c.includes('leadcaseid')) return res.status(400).json({ error: 'The lead case does not exist.' });
      if (c.includes('pincode')) return res.status(400).json({ error: 'That pincode is not in the pincode list.' });
      if (c.includes('personid') || c.includes('partyid')) return res.status(400).json({ error: 'That person does not hold the needed role.' });
      if (c.includes('caseid')) return res.status(404).json({ error: 'That case does not exist.' });
    case '23001':
      return res.status(409).json({ error: 'Other records (hearings, documents, fee payments, parties, etc.) still refer to this record.' });
    case '23514':
      return res.status(400).json({ error: CHECK_MESSAGES[c] || `The data breaks a database rule (${c}).` });
    case '23P01': {
      const which = c.includes('room') ? ' The courtroom is taken (FR-28).' : c.includes('judge') ? ' The judge is already sitting in another hearing (FR-28).' : '';
      return res.status(409).json({ error: 'That courtroom or judge is already booked at an overlapping time.' + which });
    }
    case '42501':
      if (action === 'DELETE') {
        return res.status(409).json({ error: 'Court records are append-only (FR-25): no role may delete a case. Return a filing, or dispose of a case as Withdrawn, instead.' });
      }
      if (err.message.includes('row-level security')) {
        return res.status(403).json({ error: 'You can only work on records of your own court (row-level security, FR-27).' });
      }
      return res.status(403).json({ error: 'Your role is not allowed to do this (role-based access, FR-27).' });
    case 'P0001':
      if (err.message.includes('append-only')) {
        return res.status(409).json({ error: 'Court records are append-only (FR-25): an existing record cannot be changed or deleted. Record a new one instead.' });
      }
      return res.status(400).json({ error: err.message });
    case '22P02':
    case '22007':
    case '22008':
    case '22003':
      return res.status(400).json({ error: 'One of the values has an invalid format.' });
    case 'ECONNREFUSED':
    case '28P01':
    case '3D000':
      return res.status(503).json({ error: 'Cannot connect to the database. Check that PostgreSQL is running and .env is correct.' });
    default:
      return res.status(500).json({ error: 'Unexpected database error: ' + err.message });
  }
}

module.exports = { userError, sendDbError };
