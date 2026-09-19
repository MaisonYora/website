function response(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body)
  };
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'GET') return response(405, { error: 'Method not allowed.' });
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return response(500, { error: 'Stripe is not configured on the server.' });

  const sessionId = String((event.queryStringParameters || {}).session_id || '');
  if (!/^cs_(test_|live_)?[A-Za-z0-9_]+$/.test(sessionId)) {
    return response(400, { error: 'Invalid checkout session.' });
  }

  let stripeRes;
  try {
    stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(sessionId), {
      headers: { 'Authorization': `Bearer ${stripeKey}` }
    });
  } catch (_) {
    return response(502, { error: 'Unable to reach Stripe.' });
  }

  const session = await stripeRes.json();
  if (!stripeRes.ok) return response(502, { error: session?.error?.message || 'Unable to verify payment.' });

  return response(200, {
    id: session.id,
    payment_status: session.payment_status,
    amount_total: session.amount_total,
    currency: session.currency,
    customer_email: session.customer_details?.email || session.customer_email || '',
    order_ref: session.metadata?.order_ref || session.client_reference_id || ''
  });
};
