const PRODUCTS_API_URL = 'https://opensheet.elk.sh/1YQRL0Qx3x5G9IqFR2CthlT-4tiaYMDoEBlRFbeHOSBg/1';
const SHIPPING_FEE_CENTS = 1200;
const FREE_SHIPPING_THRESHOLD_CENTS = 7500; // Free only when merchandise subtotal is OVER $75.
const CUSTOM_CANDLE_PRICE_CENTS = 7500;

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

function validCanadianPostal(value) {
  return /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/.test(clean(value));
}

async function loadProducts(siteUrl) {
  let res;
  try {
    res = await fetch(PRODUCTS_API_URL, { headers: { 'User-Agent': 'Maison-YoRa-Checkout/1.0' } });
    if (res.ok) {
      const rows = await res.json();
      return rows.map(row => ({
        name: clean(row.name, 200),
        priceCents: Math.round(Number(row.price) * 100),
        quantity: Number.parseInt(row.quantity, 10)
      })).filter(p => p.name && Number.isFinite(p.priceCents) && p.priceCents >= 0);
    }
  } catch (_) {}

  // Fallback to the same products.csv deployed with the site.
  const csvRes = await fetch(siteUrl.replace(/\/$/, '') + '/products.csv', { cache: 'no-store' });
  if (!csvRes.ok) throw new Error('Unable to load the product catalogue.');
  const text = await csvRes.text();
  const lines = text.trim().split(/\r?\n/);
  const products = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 6) continue;
    const name = clean(parts[0], 200);
    const priceCents = Math.round(Number(parts[2]) * 100);
    const quantity = Number.parseInt(parts[5], 10);
    if (name && Number.isFinite(priceCents) && priceCents >= 0) {
      products.push({ name, priceCents, quantity });
    }
  }
  return products;
}

function addParam(params, key, value) {
  if (value !== undefined && value !== null && value !== '') params.append(key, String(value));
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed.' });

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const siteUrl = (process.env.SITE_URL || 'https://maisonyora.ca').replace(/\/$/, '');
  if (!stripeKey) return response(500, { error: 'Stripe is not configured on the server.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return response(400, { error: 'Invalid checkout request.' }); }

  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return response(400, { error: 'Your cart is empty.' });
  if (items.length > 30) return response(400, { error: 'Too many different items in the cart.' });

  const customer = body.customer || {};
  const name = clean(customer.name, 120);
  const email = clean(customer.email, 180).toLowerCase();
  const address1 = clean(customer.address1, 180);
  const address2 = clean(customer.address2, 180);
  const city = clean(customer.city, 120);
  const province = clean(customer.province, 120);
  const postal = clean(customer.postal, 20).toUpperCase();
  const notes = clean(customer.notes, 450);
  const firstTime = !!customer.firstTime;

  if (!name || !email || !/^\S+@\S+\.\S+$/.test(email) || !address1 || !city || !province || !validCanadianPostal(postal)) {
    return response(400, { error: 'Please complete your name, email, and valid Canadian shipping address.' });
  }

  let products;
  try { products = await loadProducts(siteUrl); }
  catch (_) { return response(503, { error: 'We could not verify the product catalogue. Please try again.' }); }

  const productMap = new Map(products.map(p => [p.name.toLowerCase(), p]));
  const validated = [];
  let merchandiseSubtotal = 0;

  for (const rawItem of items) {
    const itemName = clean(rawItem.name, 200);
    const qty = Number.parseInt(rawItem.qty, 10);
    if (!itemName || !Number.isInteger(qty) || qty < 1 || qty > 20) {
      return response(400, { error: 'One of the cart quantities is invalid.' });
    }

    let unitAmount;
    const catalogueItem = productMap.get(itemName.toLowerCase());
    if (catalogueItem) {
      if (Number.isFinite(catalogueItem.quantity) && catalogueItem.quantity >= 0 && qty > catalogueItem.quantity) {
        return response(409, { error: `${itemName} does not have enough stock for quantity ${qty}.` });
      }
      unitAmount = catalogueItem.priceCents;
    } else if (/^Custom .+ Candle — .+, .+$/i.test(itemName)) {
      unitAmount = CUSTOM_CANDLE_PRICE_CENTS;
    } else {
      return response(400, { error: `We could not verify “${itemName}” in the current catalogue.` });
    }

    merchandiseSubtotal += unitAmount * qty;
    validated.push({ name: itemName, qty, unitAmount });
  }

  // The rule requested for Maison YoRa: $12 at $75 or below, free only above $75.
  const shippingCents = merchandiseSubtotal > FREE_SHIPPING_THRESHOLD_CENTS ? 0 : SHIPPING_FEE_CENTS;
  const orderRef = `MY-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  const params = new URLSearchParams();
  addParam(params, 'mode', 'payment');
  addParam(params, 'success_url', `${siteUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`);
  addParam(params, 'cancel_url', `${siteUrl}/#checkout`);
  addParam(params, 'customer_email', email);
  addParam(params, 'client_reference_id', orderRef);
  addParam(params, 'payment_intent_data[receipt_email]', email);
  addParam(params, 'metadata[order_ref]', orderRef);
  addParam(params, 'metadata[customer_name]', name);
  addParam(params, 'metadata[shipping_address_1]', address1);
  addParam(params, 'metadata[shipping_address_2]', address2);
  addParam(params, 'metadata[shipping_city]', city);
  addParam(params, 'metadata[shipping_province]', province);
  addParam(params, 'metadata[shipping_postal]', postal);
  addParam(params, 'metadata[shipping_country]', 'CA');
  addParam(params, 'metadata[first_time_customer]', firstTime ? 'yes' : 'no');
  addParam(params, 'metadata[order_notes]', notes);

  let index = 0;
  for (const item of validated) {
    addParam(params, `line_items[${index}][price_data][currency]`, 'cad');
    addParam(params, `line_items[${index}][price_data][product_data][name]`, item.name);
    addParam(params, `line_items[${index}][price_data][unit_amount]`, item.unitAmount);
    addParam(params, `line_items[${index}][quantity]`, item.qty);
    index++;
  }

  if (shippingCents > 0) {
    addParam(params, `line_items[${index}][price_data][currency]`, 'cad');
    addParam(params, `line_items[${index}][price_data][product_data][name]`, 'Canada Shipping');
    addParam(params, `line_items[${index}][price_data][unit_amount]`, shippingCents);
    addParam(params, `line_items[${index}][quantity]`, 1);
  }

  let stripeRes;
  try {
    stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });
  } catch (_) {
    return response(502, { error: 'Unable to reach Stripe. Please try again.' });
  }

  const stripeData = await stripeRes.json();
  if (!stripeRes.ok || !stripeData.url) {
    console.error('Stripe checkout error:', stripeData);
    return response(502, { error: stripeData?.error?.message || 'Stripe could not create the checkout session.' });
  }

  return response(200, { url: stripeData.url, order_ref: orderRef });
};
