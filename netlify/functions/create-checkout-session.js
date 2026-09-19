const SHEET_ID = '1YQRL0Qx3x5G9IqFR2CthlT-4tiaYMDoEBlRFbeHOSBg';
const PRODUCTS_API_URL = `https://opensheet.elk.sh/${SHEET_ID}/1`;
const CUSTOM_PRODUCTS_API_URL = `https://opensheet.elk.sh/${SHEET_ID}/CustomProducts`;
const CUSTOM_OPTIONS_API_URL = `https://opensheet.elk.sh/${SHEET_ID}/CustomOptions`;
const SHIPPING_FEE_CENTS = 1200;
const FREE_SHIPPING_THRESHOLD_CENTS = 7500; // Free only when merchandise subtotal is OVER $75.

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

function active(value) {
  const v = String(value == null ? '' : value).trim().toLowerCase();
  return v === '' || v === 'true' || v === 'yes' || v === '1' || v === 'active';
}

function validCanadianPostal(value) {
  return /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/.test(clean(value));
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Maison-YoRa-Checkout/2.0' }, cache: 'no-store' });
  if (!res.ok) throw new Error(`Catalogue request failed with status ${res.status}.`);
  return res.json();
}

async function loadProducts(siteUrl) {
  try {
    const rows = await fetchJson(PRODUCTS_API_URL);
    return rows.map(row => ({
      name: clean(row.name, 200),
      priceCents: Math.round(Number(row.price) * 100),
      quantity: Number.parseInt(row.quantity, 10)
    })).filter(p => p.name && Number.isFinite(p.priceCents) && p.priceCents >= 0);
  } catch (_) {
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
}

async function loadCustomCatalogue() {
  const [productRows, optionRows] = await Promise.all([
    fetchJson(CUSTOM_PRODUCTS_API_URL),
    fetchJson(CUSTOM_OPTIONS_API_URL)
  ]);

  const products = productRows.map(row => ({
    productId: clean(row.product_id, 100),
    productName: clean(row.product_name, 160),
    basePriceCents: Math.round(Number(row.base_price) * 100),
    isActive: active(row.active)
  })).filter(p => p.productId && p.productName && Number.isFinite(p.basePriceCents) && p.basePriceCents >= 0 && p.isActive);

  const options = optionRows.map(row => ({
    productId: clean(row.product_id, 100),
    category: clean(row.category, 100),
    option: clean(row.option, 160),
    adjustmentCents: Math.round(Number(row.price_adjustment || 0) * 100),
    isActive: active(row.active)
  })).filter(o => o.productId && o.category && o.option && Number.isFinite(o.adjustmentCents) && o.isActive);

  return { products, options };
}

function canonicalCustomItem(rawCustom, catalogue) {
  const productId = clean(rawCustom?.product_id, 100);
  const selections = rawCustom?.selections && typeof rawCustom.selections === 'object' ? rawCustom.selections : {};
  const product = catalogue.products.find(p => p.productId === productId);
  if (!product) throw new Error('That custom product is no longer available.');

  const productOptions = catalogue.options.filter(o => o.productId === productId);
  const categories = [...new Set(productOptions.map(o => o.category))];
  let unitAmount = product.basePriceCents;
  const canonicalSelections = [];

  for (const category of categories) {
    const requested = clean(selections[category], 160);
    if (!requested) throw new Error(`Please choose an option for ${category}.`);
    const match = productOptions.find(o => o.category === category && o.option === requested);
    if (!match) throw new Error(`${requested} is no longer available for ${category}.`);
    unitAmount += match.adjustmentCents;
    canonicalSelections.push({ category, option: match.option });
  }

  if (unitAmount < 0) throw new Error('The custom product price is invalid.');

  const summary = canonicalSelections.map(s => `${s.category}: ${s.option}`).join(' · ');
  const name = product.productName + (summary ? ` — ${summary}` : '');
  return { name, unitAmount, productId, canonicalSelections };
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

  const hasCustom = items.some(item => item && item.custom);
  let customCatalogue = null;
  if (hasCustom) {
    try { customCatalogue = await loadCustomCatalogue(); }
    catch (_) { return response(503, { error: 'We could not verify the current custom-product options. Please try again.' }); }
  }

  const productMap = new Map(products.map(p => [p.name.toLowerCase(), p]));
  const validated = [];
  let merchandiseSubtotal = 0;

  for (const rawItem of items) {
    const itemName = clean(rawItem.name, 300);
    const qty = Number.parseInt(rawItem.qty, 10);
    if (!itemName || !Number.isInteger(qty) || qty < 1 || qty > 20) {
      return response(400, { error: 'One of the cart quantities is invalid.' });
    }

    let validatedItem;
    const catalogueItem = productMap.get(itemName.toLowerCase());
    if (catalogueItem && !rawItem.custom) {
      if (Number.isFinite(catalogueItem.quantity) && catalogueItem.quantity >= 0 && qty > catalogueItem.quantity) {
        return response(409, { error: `${itemName} does not have enough stock for quantity ${qty}.` });
      }
      validatedItem = { name: catalogueItem.name, qty, unitAmount: catalogueItem.priceCents, custom: null };
    } else if (rawItem.custom && customCatalogue) {
      try {
        const customItem = canonicalCustomItem(rawItem.custom, customCatalogue);
        validatedItem = { name: customItem.name, qty, unitAmount: customItem.unitAmount, custom: customItem };
      } catch (err) {
        return response(400, { error: err.message || 'A custom selection could not be verified.' });
      }
    } else {
      return response(400, { error: `We could not verify “${itemName}” in the current catalogue.` });
    }

    merchandiseSubtotal += validatedItem.unitAmount * qty;
    validated.push(validatedItem);
  }

  // Maison YoRa shipping rule: $12 at $75 or below, free only above $75.
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
    addParam(params, `line_items[${index}][price_data][product_data][name]`, item.name.slice(0, 250));
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
