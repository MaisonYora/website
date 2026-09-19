const REVIEWS_SHEET = 'Reviews';
const COUPONS_SHEET = 'ReviewCoupons';

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const expected = PropertiesService.getScriptProperties().getProperty('REVIEW_SHEET_SECRET');
    if (!expected || body.secret !== expected) return jsonOut({ ok:false, error:'Unauthorized.' });
    ensureSheets_();
    switch (body.action) {
      case 'submit_review': return jsonOut(submitReview_(body));
      case 'list_pending': return jsonOut(listPending_(body));
      case 'get_review': return jsonOut(getReview_(body));
      case 'get_reward_status': return jsonOut(getRewardStatus_(body));
      case 'approve_review': return jsonOut(approveReview_(body));
      case 'reject_review': return jsonOut(rejectReview_(body));
      case 'list_approved': return jsonOut(listApproved_(body));
      default: return jsonOut({ ok:false, error:'Unsupported action.' });
    }
  } catch (err) {
    return jsonOut({ ok:false, error:String(err && err.message || err) });
  }
}

function ensureSheets_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, REVIEWS_SHEET, [
    'review_id','submitted_at','name','email','rating','review','status','approved_at','published','reward_status','admin_note'
  ]);
  ensureSheet_(ss, COUPONS_SHEET, [
    'email','customer_name','review_id','review_date','status','promo_code','discount','issue_date','expiry_date','stripe_promotion_code_id','notes'
  ]);
}

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) sh.getRange(1,1,1,headers.length).setValues([headers]);
  const current = sh.getRange(1,1,1,Math.max(sh.getLastColumn(), headers.length)).getValues()[0];
  headers.forEach((h, i) => { if (current[i] !== h) sh.getRange(1,i+1).setValue(h); });
  sh.setFrozenRows(1);
}

function rows_(sheetName) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2) return [];
  const values = sh.getDataRange().getValues();
  const headers = values[0].map(String);
  return values.slice(1).map((row, i) => {
    const obj = { _row:i+2 };
    headers.forEach((h, j) => obj[h] = row[j]);
    return obj;
  });
}

function normalizeEmail_(v) { return String(v || '').trim().toLowerCase(); }
function newReviewId_() { return 'REV-' + Utilities.getUuid().replace(/-/g,'').slice(0,12).toUpperCase(); }
function iso_(d) { return d ? new Date(d).toISOString() : ''; }

function submitReview_(b) {
  const name = String(b.name || '').trim().slice(0,120);
  const email = normalizeEmail_(b.email);
  const rating = Number(b.rating);
  const review = String(b.review || '').trim().slice(0,1500);
  if (!name || !/^\S+@\S+\.\S+$/.test(email) || !review || rating < 1 || rating > 5) throw new Error('Missing or invalid review fields.');

  const now = new Date();
  const id = newReviewId_();
  const coupons = rows_(COUPONS_SHEET).filter(r => normalizeEmail_(r.email) === email);
  const issued = coupons.find(r => ['issued','active','used'].includes(String(r.status || '').trim().toLowerCase()));
  const pending = coupons.find(r => String(r.status || '').trim().toLowerCase() === 'pending');
  let rewardStatus = 'Pending';
  if (issued) rewardStatus = 'Already issued';
  else if (pending) rewardStatus = 'Already pending';

  const reviewsSh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REVIEWS_SHEET);
  reviewsSh.appendRow([id, now, name, email, rating, review, 'Pending', '', false, rewardStatus, '']);

  if (!issued && !pending) {
    const couponsSh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(COUPONS_SHEET);
    couponsSh.appendRow([email, name, id, now, 'Pending', '', '10%', '', '', '', 'Awaiting review approval']);
  } else if (!issued && pending) {
    // Keep one pending reward row per email; newest review can still be moderated independently.
  }
  return { ok:true, review_id:id, reward_status:rewardStatus };
}

function listPending_(b) {
  const limit = Math.max(1, Math.min(100, Number(b.limit) || 100));
  const reviews = rows_(REVIEWS_SHEET)
    .filter(r => String(r.status || '').trim().toLowerCase() === 'pending')
    .slice(-limit).reverse()
    .map(publicReview_);
  return { ok:true, reviews };
}

function getReview_(b) {
  const id = String(b.review_id || '').trim();
  const r = rows_(REVIEWS_SHEET).find(x => String(x.review_id) === id);
  return { ok:true, review:r ? publicReview_(r, true) : null };
}

function getRewardStatus_(b) {
  const email = normalizeEmail_(b.email);
  const rows = rows_(COUPONS_SHEET).filter(r => normalizeEmail_(r.email) === email);
  const issued = rows.find(r => ['issued','active','used'].includes(String(r.status || '').trim().toLowerCase()));
  return { ok:true, has_issued_reward:!!issued, promo_code:issued ? String(issued.promo_code || '') : '' };
}

function approveReview_(b) {
  const id = String(b.review_id || '').trim();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const reviewRows = rows_(REVIEWS_SHEET);
  const review = reviewRows.find(r => String(r.review_id) === id);
  if (!review) throw new Error('Review not found.');
  const sh = ss.getSheetByName(REVIEWS_SHEET);
  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
  setCell_(sh, review._row, headers, 'status', 'Approved');
  setCell_(sh, review._row, headers, 'approved_at', new Date());
  setCell_(sh, review._row, headers, 'published', true);
  setCell_(sh, review._row, headers, 'admin_note', String(b.note || ''));

  if (b.no_new_reward) {
    setCell_(sh, review._row, headers, 'reward_status', 'Already issued');
    return { ok:true, message:'Review approved; no additional review reward was issued.', email_sent:false };
  }

  const promo = String(b.promo_code || '').trim();
  const promoId = String(b.stripe_promotion_code_id || '').trim();
  const expiry = b.expiry_iso ? new Date(b.expiry_iso) : null;
  if (!promo || !promoId || !expiry) throw new Error('Missing promotion code details.');

  const couponRows = rows_(COUPONS_SHEET);
  let couponRow = couponRows.find(r => normalizeEmail_(r.email) === normalizeEmail_(review.email) && String(r.status || '').trim().toLowerCase() === 'pending');
  if (!couponRow) {
    const csh = ss.getSheetByName(COUPONS_SHEET);
    csh.appendRow([normalizeEmail_(review.email), review.name, id, new Date(review.submitted_at), 'Pending', '', '10%', '', '', '', 'Created during approval']);
    couponRow = rows_(COUPONS_SHEET).find(r => normalizeEmail_(r.email) === normalizeEmail_(review.email) && String(r.status || '').trim().toLowerCase() === 'pending');
  }
  const csh = ss.getSheetByName(COUPONS_SHEET);
  const ch = csh.getRange(1,1,1,csh.getLastColumn()).getValues()[0].map(String);
  setCell_(csh, couponRow._row, ch, 'customer_name', review.name);
  setCell_(csh, couponRow._row, ch, 'review_id', id);
  setCell_(csh, couponRow._row, ch, 'review_date', review.submitted_at);
  setCell_(csh, couponRow._row, ch, 'status', 'Issued');
  setCell_(csh, couponRow._row, ch, 'promo_code', promo);
  setCell_(csh, couponRow._row, ch, 'discount', '10%');
  setCell_(csh, couponRow._row, ch, 'issue_date', new Date());
  setCell_(csh, couponRow._row, ch, 'expiry_date', expiry);
  setCell_(csh, couponRow._row, ch, 'stripe_promotion_code_id', promoId);
  setCell_(csh, couponRow._row, ch, 'notes', 'One-time review reward; restricted by website checkout email.');
  setCell_(sh, review._row, headers, 'reward_status', 'Issued');

  let emailSent = false;
  try {
    const site = String(b.site_url || 'https://maisonyora.ca').replace(/\/$/, '');
    const subject = 'Your 10% Maison YoRa review thank-you';
    const expiryText = Utilities.formatDate(expiry, Session.getScriptTimeZone() || 'America/Toronto', 'MMM d, yyyy');
    const plain = 'Thank you for sharing your honest Maison YoRa review. Your one-time 10% code is ' + promo + '. It expires ' + expiryText + '. Use the same email address at checkout. Shop: ' + site;
    const html = '<p>Thank you for sharing your honest Maison YoRa review.</p>' +
      '<p>Your one-time <strong>10% review reward</strong> is:</p>' +
      '<p style="font-size:22px;font-weight:bold;letter-spacing:1px">' + promo + '</p>' +
      '<p>Expires <strong>' + expiryText + '</strong>. Please use the same email address at checkout.</p>' +
      '<p><a href="' + site + '">Shop Maison YoRa</a></p>';
    MailApp.sendEmail({ to:normalizeEmail_(review.email), subject:subject, body:plain, htmlBody:html, name:'Maison YoRa' });
    emailSent = true;
  } catch (err) {
    setCell_(csh, couponRow._row, ch, 'notes', 'Coupon issued. Automatic email failed: ' + String(err && err.message || err));
  }
  return { ok:true, message:emailSent ? 'Review approved, coupon issued, and email sent.' : 'Review approved and coupon issued. Automatic email could not be sent.', email_sent:emailSent };
}

function rejectReview_(b) {
  const id = String(b.review_id || '').trim();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const review = rows_(REVIEWS_SHEET).find(r => String(r.review_id) === id);
  if (!review) throw new Error('Review not found.');
  const sh = ss.getSheetByName(REVIEWS_SHEET);
  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
  setCell_(sh, review._row, headers, 'status', 'Rejected');
  setCell_(sh, review._row, headers, 'published', false);
  setCell_(sh, review._row, headers, 'admin_note', String(b.note || ''));

  const pending = rows_(COUPONS_SHEET).find(r => normalizeEmail_(r.email) === normalizeEmail_(review.email) && String(r.status || '').trim().toLowerCase() === 'pending');
  if (pending && String(pending.review_id) === id) {
    const csh = ss.getSheetByName(COUPONS_SHEET);
    const ch = csh.getRange(1,1,1,csh.getLastColumn()).getValues()[0].map(String);
    setCell_(csh, pending._row, ch, 'status', 'Rejected');
    setCell_(csh, pending._row, ch, 'notes', 'Review was not approved; no coupon issued.');
  }
  return { ok:true, message:'Review rejected. No coupon was issued.' };
}

function listApproved_(b) {
  const limit = Math.max(1, Math.min(50, Number(b.limit) || 12));
  const reviews = rows_(REVIEWS_SHEET)
    .filter(r => String(r.status || '').trim().toLowerCase() === 'approved' && String(r.published).toLowerCase() !== 'false')
    .slice(-limit).reverse()
    .map(r => ({
      name: displayName_(r.name),
      rating: Number(r.rating) || 0,
      review: String(r.review || ''),
      review_date: formatDate_(r.approved_at || r.submitted_at)
    }));
  return { ok:true, reviews };
}

function publicReview_(r, includeEmail) {
  const out = {
    review_id:String(r.review_id || ''),
    submitted_at:iso_(r.submitted_at),
    name:String(r.name || ''),
    rating:Number(r.rating) || 0,
    review:String(r.review || ''),
    status:String(r.status || ''),
    reward_status:String(r.reward_status || '')
  };
  if (includeEmail) out.email = normalizeEmail_(r.email);
  return out;
}

function displayName_(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Maison YoRa customer';
  if (parts.length === 1) return parts[0];
  return parts[0] + ' ' + parts[parts.length-1].charAt(0).toUpperCase() + '.';
}
function formatDate_(d) {
  if (!d) return '';
  return Utilities.formatDate(new Date(d), Session.getScriptTimeZone() || 'America/Toronto', 'MMM yyyy');
}
function setCell_(sh, row, headers, name, value) {
  const idx = headers.indexOf(name);
  if (idx < 0) throw new Error('Missing sheet column: ' + name);
  sh.getRange(row, idx+1).setValue(value);
}
