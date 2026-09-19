# Maison YoRa — Stripe + Netlify setup

This package merges Stripe Checkout into the latest Maison YoRa website version, including the updated Gallery 1–8 stories.

## Shipping rule in this package

- Merchandise subtotal **over $75 CAD**: free shipping.
- Merchandise subtotal **$75 CAD or less**: $12 CAD shipping.
- The browser displays the rule, and the Netlify Function recalculates it independently before Stripe Checkout is created.

## Files to add to your existing GitHub repository

Keep your current `images/`, `products.csv`, `privacy-policy.html`, and other website assets. Add/replace these files from this package:

- `index.html` — latest site + Gallery 1–8 + Stripe checkout.
- `success.html` — verifies and displays the returned Stripe payment status and links to order tracking.
- `track-order.html` — customer order-status lookup using order reference + checkout email.
- `netlify.toml` — points Netlify to `netlify/functions`.
- `netlify/functions/create-checkout-session.js` — validates the cart, recalculates prices/shipping, and creates Stripe Checkout.
- `netlify/functions/checkout-session.js` — verifies the Checkout Session for the confirmation page.
- `netlify/functions/validate-promo-code.js` — securely validates Stripe Promotion Codes.
- `netlify/functions/track-order.js` — securely looks up payment/order metadata for the Track Order page.
- `.env.example` — documentation only; do not put real secrets in GitHub.

## Netlify environment variables

Create these in Netlify > Project configuration > Environment variables:

- `STRIPE_SECRET_KEY` = your Stripe test secret key while testing (`sk_test_...`). Mark this as a secret.
- `SITE_URL` = `https://maisonyora.ca`

Never commit your real Stripe secret key to GitHub.

After changing environment variables, trigger a new deployment.

## Deploy and test

Push the files to the GitHub repository already connected to Netlify. Netlify should deploy the site and all four serverless functions.

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

## Google Sheet-driven custom products

The Custom Pieces builder now reads two tabs from the same Google Sheet used by the shop.

### `CustomProducts` tab
Required headers:

`product_id | product_name | base_price | active | sort_order | description`

Example product IDs used in the current design:

- `CUSTOM_CANDLE`
- `FLOWER_BOUQUET`

Keep `product_id` stable. You can change the customer-facing `product_name` at any time.

### `CustomOptions` tab
Required headers:

`product_id | category | option | price_adjustment | active | sort_order | description`

The website groups options by `category` automatically, so categories can differ by product. For example, a candle can have Bloom / Colour / Scent, while a bouquet can have Size / Flower Palette / Scent / Packaging.

`price_adjustment` is added to the base price. Use `0` for an included option, a positive number for an upgrade, or a negative number for a discount.

Set `active` to `FALSE` to hide a product or option without deleting it. `sort_order` controls the display order.

The browser shows live pricing, but the Netlify checkout function reloads and validates the same Google Sheet data before creating the Stripe Checkout Session. Customer-edited browser prices are therefore not trusted.

## Review coupon setup

The checkout now includes a **Redeem Coupon** field. It validates Stripe Promotion Codes through the Netlify server before showing a discount and the checkout function validates the code again before creating the Stripe Checkout Session.

For the review reward:

1. In Stripe, create a coupon for **10% off**, duration **once**.
2. Create a separate Promotion Code for each approved review (for example `YORA10-A7K4P2`).
3. Set the Promotion Code to **one redemption** and optionally add an expiry date.
4. Do not restrict the Promotion Code to a specific Stripe Customer in this version; use a unique one-use code instead.
5. Send that unique code to the customer after the honest review is approved.

The discount shown on the website is informational. Stripe is the final authority: the server validates the Promotion Code again and attaches the Stripe Promotion Code ID to Checkout.

New function:

- `netlify/functions/validate-promo-code.js` — validates the entered Stripe Promotion Code and returns the current discount terms.

## Order tracking

This package now includes `track-order.html` and `netlify/functions/track-order.js`.

For orders placed after this deployment, the checkout function writes the following metadata to the Stripe PaymentIntent:

- `order_ref`
- `customer_email`
- `customer_name`
- `fulfillment_status` (starts as `Order received`)
- shipping city/province/postal code
- promotion code, when used

Customers can open `https://maisonyora.ca/track-order.html` and enter the **order reference + checkout email**. Both must match before any status is returned.

### When you ship an order

Open the payment in your Stripe Dashboard and edit its PaymentIntent metadata. Update/add:

- `fulfillment_status` = for example `Preparing`, `Shipped`, `Delivered`, or `Ready for pickup`
- `carrier` = for example `Canada Post`
- `tracking_number` = the carrier tracking number
- `tracking_url` = a full `https://...` carrier tracking URL
- `status_note` = optional short customer-facing note

The Track Order page will display these values automatically. Orders created before this version do not have the tracking metadata and will not be searchable by this page unless you add matching metadata to their PaymentIntents manually.
