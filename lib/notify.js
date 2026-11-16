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

function keyOf(r) {
  return `${r.logid}:${r.personid}:${r.audience}`;
}

function toNotification(r) {
  const key = keyOf(r);
  return {
    key, logid: r.logid, changedat: r.changedat, cnr: r.cnr, courtname: r.courtname, name: r.name,
    audience: r.audience, phone: maskPhone(r.contactnumber), mode: r.mode, venue: r.venue,
    olddate: r.olddate, oldtime: fmtTime(r.oldtime), newdate: r.newdate, newtime: fmtTime(r.newtime),
    message: smsText(r), sentAt: sent.get(key) || null,
  };
}

module.exports = { sent, maskPhone, smsText, keyOf, toNotification };
