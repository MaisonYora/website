const crypto = require('crypto');

function response(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

function clean(value, max = 500) { return String(value || '').trim().slice(0, max); }

function timingSafeEqualText(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

async function callSheet(action, payload = {}) {
  const url = process.env.REVIEW_SHEET_WEB_APP_URL;
  const secret = process.env.REVIEW_SHEET_SECRET;
  if (!url || !secret) throw new Error('Review workflow is not configured.');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, secret, ...payload })
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (_) { throw new Error('Review sheet service returned an invalid response.'); }
  if (!res.ok || data.ok === false) throw new Error(data.error || 'Review sheet operation failed.');
  return data;
}

async function stripeCreatePromotionCode({ couponId, code, expiresAt, email, reviewId, stripeKey }) {
  const makeParams = modern => {
    const p = new URLSearchParams();
    p.set('code', code);
    p.set('max_redemptions', '1');
    p.set('expires_at', String(expiresAt));
    p.set('metadata[reward_type]', 'review');
    p.set('metadata[review_email]', email);
    p.set('metadata[review_id]', reviewId);
    if (modern) {
      p.set('promotion[type]', 'coupon');
      p.set('promotion[coupon]', couponId);
    } else {
      p.set('coupon', couponId);
    }
    return p;
  };

  async function request(params) {
    const res = await fetch('https://api.stripe.com/v1/promotion_codes', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': `review-reward-${reviewId}`
      },
      body: params.toString()
    });
    const data = await res.json();
    return { res, data };
  }

  let out = await request(makeParams(true));
  if (!out.res.ok && /unknown parameter|promotion/i.test(out.data?.error?.message || '')) {
    out = await request(makeParams(false));
  }
  if (!out.res.ok) throw new Error(out.data?.error?.message || 'Stripe could not create the promotion code.');
  return out.data;
}

function generateCode() {
  return 'YORA10-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed.' });
  const configuredKey = process.env.REVIEW_ADMIN_KEY;
  const suppliedKey = event.headers['x-admin-key'] || event.headers['X-Admin-Key'];
  if (!configuredKey || !timingSafeEqualText(suppliedKey, configuredKey)) return response(401, { error: 'Invalid admin key.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return response(400, { error: 'Invalid request.' }); }
  const action = clean(body.action, 40);

  try {
    if (action === 'list') {
      const data = await callSheet('list_pending', { limit: 100 });
      return response(200, { ok: true, reviews: data.reviews || [] });
    }

    const reviewId = clean(body.review_id, 120);
    if (!reviewId) return response(400, { error: 'Missing review ID.' });

    if (action === 'reject') {
      const data = await callSheet('reject_review', { review_id: reviewId, note: clean(body.note, 500) });
      return response(200, { ok: true, message: data.message || 'Review rejected.' });
    }

    if (action !== 'approve') return response(400, { error: 'Unsupported admin action.' });

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    const couponId = process.env.REVIEW_COUPON_ID;
    if (!stripeKey || !couponId) return response(500, { error: 'Stripe review-reward settings are incomplete.' });

    const reviewData = await callSheet('get_review', { review_id: reviewId });
    const review = reviewData.review;
    if (!review) return response(404, { error: 'Review not found.' });
    if (String(review.status || '').toLowerCase() === 'approved') {
      return response(200, { ok: true, message: 'This review is already approved.', promo_code: review.promo_code || '' });
    }

    const rewardState = await callSheet('get_reward_status', { email: review.email, review_id: reviewId });
    if (rewardState.has_issued_reward) {
      const approved = await callSheet('approve_review', {
        review_id: reviewId,
        no_new_reward: true,
        note: 'Approved; review reward already issued previously to this email.'
      });
      return response(200, { ok: true, message: 'Review approved. This email already had a review reward, so no new coupon was issued.', email_sent: false, promo_code: rewardState.promo_code || '' });
    }

    const expiresAt = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60);
    const promo = await stripeCreatePromotionCode({
      couponId,
      code: generateCode(),
      expiresAt,
      email: review.email,
      reviewId,
      stripeKey
    });

    const siteUrl = (process.env.SITE_URL || 'https://maisonyora.ca').replace(/\/$/, '');
    const approved = await callSheet('approve_review', {
      review_id: reviewId,
      promo_code: promo.code,
      stripe_promotion_code_id: promo.id,
      expiry_iso: new Date(expiresAt * 1000).toISOString(),
      site_url: siteUrl
    });

    return response(200, {
      ok: true,
      message: approved.message || 'Review approved and reward issued.',
      promo_code: promo.code,
      expires_at: expiresAt,
      email_sent: !!approved.email_sent
    });
  } catch (err) {
    return response(502, { error: err.message || 'Admin operation failed.' });
  }
};
