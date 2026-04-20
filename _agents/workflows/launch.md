---
description: How to Launch ResumeXray to Production
---

Follow these steps to safely transition the application from development to a live production environment.

### 1. Environment Finalization
1. Ensure `NODE_ENV=production`.
2. Update `APP_URL` to your production domain (e.g., `https://resumexray.pro`).
3. Point `GOOGLE_CALLBACK_URL` and `STRIPE_WEBHOOK_SECRET` to the production values.

### 2. Database Preparation
// turbo
1. Create a persistent volume or mount for the `db/` directory.
2. Initialize the schema:
   ```bash
   sqlite3 db/resumexray.db < db/schema.sql
   ```

### 3. Security Check
// turbo
1. Run the health check locally to verify runtime stability:
   ```bash
   curl http://localhost:3000/health
   ```
2. Verify SSL cookies are working by checking the `set-cookie` header in production.

### 4. Stripe Webhooks
1. In the Stripe Dashboard, set the Webhook URL to `https://resumexray.pro/billing/webhook`.
2. Select events: `checkout.session.completed`, `customer.subscription.deleted`.
3. Copy the `whsec_...` secret and add it to your `.env`.

### 5. Final Launch
// turbo
1. Start the production server:
   ```bash
   npm start
   ```
2. Perform a "Guest Test":
   - Navigate to the site while logged out.
   - Perform 2 scans.
   - Verify the 3rd scan triggers the **Sign-up Wall**.
