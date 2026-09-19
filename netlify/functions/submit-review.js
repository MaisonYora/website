function response(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

function clean(value, max = 500) { return String(value || '').trim().slice(0, max); }

async function callSheet(action, payload) {
  const url = process.env.REVIEW_SHEET_WEB_APP_URL;
  const secret = process.env.REVIEW_SHEET_SECRET;
  if (!url || !secret) throw new Error('Review workflow is not configured yet.');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, secret, ...payload })
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (_) { throw new Error('Review service returned an invalid response.'); }
  if (!res.ok || data.ok === false) throw new Error(data.error || 'Review service could not save the review.');
  return data;
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed.' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return response(400, { error: 'Invalid review request.' }); }

  const name = clean(body.name, 120);
  const email = clean(body.email, 180).toLowerCase();
  const review = clean(body.review, 1500);
  const rating = Number.parseInt(body.rating, 10);
  if (!name || !/^\S+@\S+\.\S+$/.test(email) || !review || rating < 1 || rating > 5) {
    return response(400, { error: 'Please provide your name, email, rating, and review.' });
  }

  try {
    const data = await callSheet('submit_review', { name, email, rating, review });
    const reward = data.reward_status || 'Pending';
    let message = 'Thank you. Your review is pending moderation.';
    if (reward === 'Pending') message += ' If approved, this email may receive one 10% review reward.';
    if (reward === 'Already issued') message += ' A review reward has already been issued to this email, so another coupon will not be generated.';
    if (reward === 'Already pending') message += ' A review reward is already pending for this email.';
    return response(200, { ok: true, review_id: data.review_id, reward_status: reward, message });
  } catch (err) {
    return response(502, { error: err.message || 'Unable to submit the review right now.' });
  }
};
