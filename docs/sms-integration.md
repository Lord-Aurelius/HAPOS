# SMS Integration

## Provider

Africa's Talking is the SMS provider for:

- Automated thank-you messages after each completed service
- Manual promotional campaigns sent by shop admins

## Environment Variables

- `AFRICASTALKING_USERNAME`
- `AFRICASTALKING_API_KEY`
- `AFRICASTALKING_BASE_URL`
- `AFRICASTALKING_SENDER_ID`

## Delivery Modes

### Automated Thank-You

Trigger:

- A new `service_record` is successfully committed

Flow:

1. Create the service record in PostgreSQL
2. Insert an `sms_logs` row with `status = 'queued'`
3. Background worker sends the SMS
4. Update `sms_logs.status` to `sent` or `failed`
5. Store provider message id and raw response metadata

Recommended template:

`Thank you for visiting {{shop_name}} today. We appreciate you, {{customer_name}}.`

### Manual Promotions

Trigger:

- `shop_admin` submits a promotion campaign

Flow:

1. Filter customers by `marketing_opt_in = true`
2. Create one `sms_logs` row per recipient
3. Send in batches through a worker
4. Track success and failure per recipient

## Safety Rules

- Do not send promotions to customers without marketing opt-in
- Normalize all customer numbers to E.164 format before delivery
- Use queued delivery so service entry stays fast
- Log provider response codes for reconciliation
- Retry transient failures, but never duplicate already-successful sends

## Africa's Talking Notes

- Use the official messaging endpoint selected by environment:
  - Sandbox: `https://api.sandbox.africastalking.com/version1/messaging`
  - Live: `https://api.africastalking.com/version1/messaging`
- Branded sending requires an approved sender ID or shortcode tied to the Africa's Talking account
- Delivery reports are supported, so callback/webhook processing should be added in production

## Suggested Message Templates

Thank-you:

`Thanks for visiting {{shop_name}}, {{customer_name}}. We look forward to seeing you again.`

Promotion:

`{{shop_name}} special offer this week: {{offer_text}}. Book now or visit us today.`

## Operational Recommendation

Keep the SMS worker separate from the synchronous API request path. The service-record API should succeed even if the SMS provider is temporarily unavailable, while the queued SMS job retries safely in the background.
