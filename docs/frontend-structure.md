# Frontend Structure

## Product Goals

- Fast service entry in under 10 seconds
- Clear admin controls for pricing, finances, and subscriptions
- Minimal cognitive load for staff during busy hours
- Mobile-first layout for phones and small tablets at the counter

## Route Tree

```text
/login
/app
  /dashboard
  /service-entry
  /customers
  /customers/:customerId
  /services
  /commissions
  /expenses
  /sms
  /subscription
  /settings/staff
/super
  /tenants
  /tenants/:tenantId
```

## Main Screens

### 1. Staff Service Entry

This is the highest-priority screen and should open immediately after login for `staff`.

Layout:

- Phone number search at the top
- Existing customer match list beneath the input
- "Create customer" inline shortcut if no match exists
- Large predefined service buttons from the active price list
- Staff selector prefilled with the logged-in staff member
- Auto-filled price and commission preview
- Optional notes field
- Primary `Save & Send Thank You` button

Flow:

1. Staff enters customer phone
2. Existing customer is matched or created
3. Staff taps a predefined service
4. Price and commission auto-populate
5. Staff optionally adds notes
6. Record is saved and thank-you SMS is queued

### 2. Dashboard

Visible to `shop_admin` and `super_admin`.

Widgets:

- Today revenue
- This month revenue
- Expenses this month
- Commission paid this month
- Net profit this month
- Top-performing staff
- Recent services

### 3. Services / Price List

Visible to everyone, editable only by admin roles.

Capabilities:

- List active services
- Add or deactivate services
- Set price, description, duration, commission mode, and commission value
- Publish clean customer-facing price list

### 4. Customer Management

Capabilities:

- Search by phone or name
- View visit history
- Show lifetime value and last visit date
- Store notes and SMS marketing opt-in

### 5. Commissions

Admin view:

- Monthly staff ranking
- Commission accrued from service records
- Commission payout history
- Exportable monthly commission statement

Staff view:

- Optional self-only monthly commission summary

### 6. Expenses

Admin-only.

Capabilities:

- Log expense category, description, amount, and date
- Filter daily or monthly
- Include payouts in profit reporting

### 7. SMS Center

Admin-only.

Capabilities:

- Promotion composer
- Customer segment picker
- Preview message count
- Recent SMS log table

### 8. Subscription Status

Admin-only.

Capabilities:

- Current plan and renewal date
- Expired or suspended warning banner
- Billing history

## Suggested Component Structure

```text
src/
  app/
    (auth)/
    (shop)/
    (super)/
  components/
    shell/
    dashboard/
    service-entry/
    customers/
    services/
    commissions/
    expenses/
    sms/
  lib/
    api/
    auth/
    format/
    permissions/
```

## Role UX Rules

- `super_admin`: sees global tenant management and suspension controls
- `shop_admin`: full shop control including price list, staff, expenses, reports, SMS, and subscription status
- `staff`: lands directly on service entry and does not see finance/admin navigation

## Performance Notes

- Preload active services on login
- Keep the service-entry form on a single screen
- Use phone lookup first because it is the fastest customer identifier in this business
- Cache the current price list locally for fast taps during peak hours
