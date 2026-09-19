function response(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body)
  };
}

function clean(value, max = 180) {
  return String(value || '').trim().slice(0, max);
}

async function stripeJson(url, stripeKey) {
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${stripeKey}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || 'Stripe could not validate the coupon.');
  return data;
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return response(405, { valid: false, error: 'Method not allowed.' });
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return response(500, { valid: false, error: 'Stripe is not configured on the server.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return response(400, { valid: false, error: 'Invalid coupon request.' }); }

  const code = clean(body.code, 64);
  const email = clean(body.email, 180).toLowerCase();
  const subtotalCents = Math.max(0, Number.parseInt(body.subtotal_cents, 10) || 0);
  if (!code) return response(400, { valid: false, error: 'Enter a coupon code.' });

  try {
    const url = new URL('https://api.stripe.com/v1/promotion_codes');
    url.searchParams.set('code', code);
    url.searchParams.set('active', 'true');
    url.searchParams.set('limit', '10');
    const list = await stripeJson(url, stripeKey);
    const promo = (list.data || []).find(p => String(p.code || '').toLowerCase() === code.toLowerCase() && p.active);
    if (!promo) return response(400, { valid: false, error: 'That coupon code is invalid or inactive.' });
    if (promo.expires_at && promo.expires_at * 1000 < Date.now()) return response(400, { valid: false, error: 'That coupon code has expired.' });
    if (promo.max_redemptions != null && promo.times_redeemed >= promo.max_redemptions) return response(400, { valid: false, error: 'That coupon code has already been used.' });

    const meta = promo.metadata || {};
    if (String(meta.reward_type || '').toLowerCase() === 'review') {
      const rewardEmail = clean(meta.review_email, 180).toLowerCase();
      if (!email) return response(400, { valid: false, error: 'Enter the email address that received this review reward before applying the code.' });
      if (rewardEmail && rewardEmail !== email) return response(400, { valid: false, error: 'This review reward is linked to a different email address.' });
    }

    const restrictions = promo.restrictions || {};
    if (restrictions.minimum_amount != null) {
      const currency = String(restrictions.minimum_amount_currency || 'cad').toLowerCase();
      if (currency !== 'cad') return response(400, { valid: false, error: 'That coupon cannot be used for a CAD checkout.' });
      if (subtotalCents < restrictions.minimum_amount) {
        return response(400, { valid: false, error: `This coupon requires an order subtotal of at least $${(restrictions.minimum_amount / 100).toFixed(2)} CAD.` });
      }
    }
    if (restrictions.first_time_transaction) return response(400, { valid: false, error: 'This code is restricted to first-time transactions and cannot be used here.' });
    if (promo.customer) return response(400, { valid: false, error: 'This code is restricted to a specific Stripe customer and cannot be used through this checkout form.' });

    const couponId = promo.promotion?.coupon || (typeof promo.coupon === 'string' ? promo.coupon : promo.coupon?.id);
    if (!couponId) return response(400, { valid: false, error: 'That promotion code is not linked to a valid coupon.' });
    const coupon = await stripeJson('https://api.stripe.com/v1/coupons/' + encodeURIComponent(couponId), stripeKey);
    if (!coupon.valid) return response(400, { valid: false, error: 'That coupon is no longer valid.' });
    if (coupon.redeem_by && coupon.redeem_by * 1000 < Date.now()) return response(400, { valid: false, error: 'That coupon has expired.' });

    const percentOff = typeof coupon.percent_off === 'number' ? coupon.percent_off : null;
    const amountOff = typeof coupon.amount_off === 'number' ? coupon.amount_off : null;
    const currency = coupon.currency ? String(coupon.currency).toLowerCase() : null;
    if (amountOff != null && currency && currency !== 'cad') return response(400, { valid: false, error: 'That coupon cannot be used for a CAD checkout.' });

    let discountCents = 0;
    if (percentOff != null) discountCents = Math.min(subtotalCents, Math.round(subtotalCents * percentOff / 100));
    else if (amountOff != null) discountCents = Math.min(subtotalCents, amountOff);
    if (discountCents <= 0) return response(400, { valid: false, error: 'That coupon does not produce a discount for this order.' });

    const label = percentOff != null ? `${percentOff}% off` : `$${(amountOff / 100).toFixed(2)} off`;
    return response(200, {
      valid: true,
      code: promo.code,
      promotion_code_id: promo.id,
      percent_off: percentOff,
      amount_off: amountOff,
      currency: currency || 'cad',
      discount_cents: discountCents,
      message: `${promo.code} applied — ${label}.`
    });
  } catch (err) {
    return response(502, { valid: false, error: err.message || 'Unable to validate the coupon right now.' });
  }
};
