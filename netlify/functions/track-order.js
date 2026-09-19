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

function escapeSearchValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function safeUrl(value) {
  const text = clean(value, 500);
  return /^https:\/\//i.test(text) ? text : '';
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed.' });
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return response(500, { error: 'Order tracking is not configured on the server.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return response(400, { error: 'Invalid tracking request.' }); }

  const orderRef = clean(body.order_ref, 80).toUpperCase();
  const email = clean(body.email, 180).toLowerCase();
  if (!/^MY-[A-Z0-9-]{6,70}$/.test(orderRef) || !/^\S+@\S+\.\S+$/.test(email)) {
    return response(400, { error: 'Enter the Maison YoRa order reference and the email used at checkout.' });
  }

  const query = `metadata["order_ref"]:"${escapeSearchValue(orderRef)}" AND metadata["customer_email"]:"${escapeSearchValue(email)}"`;
  const url = new URL('https://api.stripe.com/v1/payment_intents/search');
  url.searchParams.set('query', query);
  url.searchParams.set('limit', '1');

  let stripeRes;
  try {
    stripeRes = await fetch(url, { headers: { 'Authorization': `Bearer ${stripeKey}` } });
  } catch (_) {
    return response(502, { error: 'Unable to reach the order system. Please try again.' });
  }
  const data = await stripeRes.json();
  if (!stripeRes.ok) return response(502, { error: data?.error?.message || 'Unable to search for that order.' });

  const intent = (data.data || [])[0];
  if (!intent) return response(404, { error: 'No matching order was found. Check the reference and checkout email.' });

  const meta = intent.metadata || {};
  const paymentStatus = intent.status === 'succeeded' ? 'Payment confirmed' :
    intent.status === 'processing' ? 'Payment processing' :
    intent.status === 'canceled' ? 'Payment cancelled' : 'Payment pending';
  const fulfillmentStatus = clean(meta.fulfillment_status, 100) || (intent.status === 'succeeded' ? 'Order received' : paymentStatus);

  return response(200, {
    order_ref: clean(meta.order_ref, 80) || orderRef,
    payment_status: paymentStatus,
    order_status: fulfillmentStatus,
    created: intent.created || null,
    amount: typeof intent.amount === 'number' ? intent.amount : null,
    currency: intent.currency || 'cad',
    carrier: clean(meta.carrier, 100),
    tracking_number: clean(meta.tracking_number, 120),
    tracking_url: safeUrl(meta.tracking_url),
    status_note: clean(meta.status_note, 240)
  });
};
