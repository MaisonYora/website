# Maison YoRa automated review workflow

## Automated review moderation + one coupon per email

This package now automates the review reward workflow instead of requiring manual `ReviewCoupons` updates.

### What happens

1. A customer submits the website review form.
2. `submit-review.js` sends the review to the Google Sheet through the Apps Script web app.
3. A row is added to the `Reviews` tab with status `Pending`.
4. If that email has never been issued a review reward, `ReviewCoupons` receives one `Pending` row.
5. You open `/review-admin.html`, enter the private admin key, and approve or reject the review.
6. On approval, the server creates one unique Stripe Promotion Code for 10% off, limited to one redemption and expiring 30 days after approval.
7. The code is stored in `ReviewCoupons` and the Apps Script emails it to the customer.
8. The approved review appears automatically on the public website.
9. Review reward codes contain the recipient email in Stripe metadata. Both coupon validation and final checkout reject the reward if a different checkout email tries to use it.

The reward is issued for an approved honest review regardless of rating. Only one review reward is issued per email address. Customers may submit additional reviews, but they do not receive additional review coupons.

### Additional Netlify environment variables

Add these alongside `STRIPE_SECRET_KEY` and `SITE_URL`:

- `REVIEW_SHEET_WEB_APP_URL` = the deployed Google Apps Script Web App URL.
- `REVIEW_SHEET_SECRET` = a long random secret used only between Netlify and Apps Script.
- `REVIEW_ADMIN_KEY` = a different long random password used to open the approval actions on `/review-admin.html`.
- `REVIEW_COUPON_ID` = the Stripe **10% off / duration once** coupon ID. This is the underlying Stripe coupon, not a customer-facing promotion code.

Mark `STRIPE_SECRET_KEY`, `REVIEW_SHEET_SECRET`, and `REVIEW_ADMIN_KEY` as secret values in Netlify. After adding or changing variables, redeploy the site.

### Google Apps Script setup

1. Open the same Google Sheet used by Maison YoRa.
2. Choose **Extensions > Apps Script**.
3. Replace the editor contents with `review-sheet-apps-script.gs` from this package.
4. In Apps Script, open **Project Settings > Script properties**. Add:
   - Property: `REVIEW_SHEET_SECRET`
   - Value: exactly the same random value you put in Netlify.
5. Deploy > **New deployment** > **Web app**.
6. Execute as: **Me**.
7. Who has access: **Anyone**. The endpoint still requires the private shared secret on every operation.
8. Copy the `/exec` Web App URL into Netlify as `REVIEW_SHEET_WEB_APP_URL`.
9. Redeploy Netlify.

On first review submission, the script creates/initializes these tabs if needed:

`Reviews`

`review_id | submitted_at | name | email | rating | review | status | approved_at | published | reward_status | admin_note`

`ReviewCoupons`

`email | customer_name | review_id | review_date | status | promo_code | discount | issue_date | expiry_date | stripe_promotion_code_id | notes`

Do not rename these headers after the workflow is live.

### Approval page

Open:

`https://maisonyora.ca/review-admin.html`

Enter the value you set as `REVIEW_ADMIN_KEY`, then select **Approve + issue reward if eligible** or **Reject**. The page is not linked from the public navigation and is marked `noindex`, but the admin key is still required for every backend action.

When a review is approved and the email is eligible, Apps Script sends the reward email from the Google account that owns/runs the script. Google Apps Script mail quotas apply. If automatic email fails, the promotion code is still saved in `ReviewCoupons` and displayed in the admin result so it can be sent manually.
