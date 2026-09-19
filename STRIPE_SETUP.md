# Maison YoRa — Stripe + Netlify setup

This package merges Stripe Checkout into the latest Maison YoRa website version, including the updated Gallery 1–8 stories.

## Shipping rule in this package

- Merchandise subtotal **over $75 CAD**: free shipping.
- Merchandise subtotal **$75 CAD or less**: $12 CAD shipping.
- The browser displays the rule, and the Netlify Function recalculates it independently before Stripe Checkout is created.

## Files to add to your existing GitHub repository

Keep your current `images/`, `products.csv`, `privacy-policy.html`, `track-order.html`, and other website files. Add/replace only these files from this package:

- `index.html` — latest site + Gallery 1–8 + Stripe checkout.
- `success.html` — verifies and displays the returned Stripe payment status.
- `netlify.toml` — points Netlify to `netlify/functions`.
- `netlify/functions/create-checkout-session.js` — validates the cart, recalculates prices/shipping, and creates Stripe Checkout.
- `netlify/functions/checkout-session.js` — verifies the Checkout Session for the confirmation page.
- `.env.example` — documentation only; do not put real secrets in GitHub.

## Netlify environment variables

Create these in Netlify > Project configuration > Environment variables:

- `STRIPE_SECRET_KEY` = your Stripe test secret key while testing (`sk_test_...`). Mark this as a secret.
- `SITE_URL` = `https://maisonyora.ca`

Never commit your real Stripe secret key to GitHub.

After changing environment variables, trigger a new deployment.

## Deploy and test

Push the files to the GitHub repository already connected to Netlify. Netlify should deploy the site and the two serverless functions.

Test on the deployed site using Stripe Test mode. Confirm:

- below $75 => $12 shipping
- exactly $75 => $12 shipping
- above $75 => free shipping
- multiple quantities
- custom candle checkout
- successful payment returns to `success.html`
- cancelling Stripe returns to the checkout section

## Going live

After successful testing, replace the Netlify `STRIPE_SECRET_KEY` test value with the Stripe live secret key (`sk_live_...`), redeploy, and place one small real order to confirm the full flow.
