function response(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

async function callSheet(action, payload = {}) {
  const url = process.env.REVIEW_SHEET_WEB_APP_URL;
  const secret = process.env.REVIEW_SHEET_SECRET;
  if (!url || !secret) throw new Error('Review workflow is not configured yet.');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, secret, ...payload })
  });
  const data = await res.json();
  if (!res.ok || data.ok === false) throw new Error(data.error || 'Unable to load reviews.');
  return data;
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'GET') return response(405, { error: 'Method not allowed.' });
  try {
    const data = await callSheet('list_approved', { limit: 12 });
    return response(200, { reviews: Array.isArray(data.reviews) ? data.reviews : [] });
  } catch (err) {
    return response(502, { error: err.message || 'Unable to load approved reviews.' });
  }
};
