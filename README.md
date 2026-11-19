# Monthly Expense Tracker

A personal expense tracking web app built with vanilla JavaScript and Firebase. Tracks credit card and cash purchases, groups them by billing cycle, and provides monthly/yearly spending summaries.

## Features

- **Google Sign-In** — all data is per-user, stored in Firebase Firestore
- **SOA Billing Cycles** — purchases are attributed to billing months based on each bank's Statement of Account (SOA) date, mimicking credit card billing
- **Monthly View** — grouped by bank and category, sortable columns, expandable rows for multiple transactions
- **Bank Summary** — per-month overview of each bank's total, actual SOA amount, and paid status with sortable columns
- **Summary View** — yearly spending breakdown with pie chart (by category) and totals by bank/category
- **Recurring Expenses** — (optional) configure monthly recurring charges (subscriptions, mortgages) that auto-generate on app open
- **Budget Tracking** — set a default monthly budget with per-month overrides; shows remaining/overspent

## Setup

1. Open `index.html` in a browser (no build step required)
2. Sign in with your Google account
3. Default banks and categories are created on first login

## Usage

### Adding Purchases

Click **+ Add Purchase** in the header. Select a bank, category, date, and amount. For the "Others" category, you can specify a custom description.

### SOA Billing Logic

Each bank has an SOA date (day of month). A purchase made on or after that day is attributed to the *next* month's billing cycle. For example, with BPI (SOA date 15), a purchase on June 20 counts toward July's bill. Cash (SOA date 0) always uses the calendar month.

### Monthly Navigation

Use the left/right arrows to browse billing months. Click **Today** to jump back to the current month. The budget panel shows your budget, total spent, and remaining balance.

**Remaining** deducts household reservations as well as actual purchases. Grocery reserves its full ₱15,000 allocation until the 15th of its billing month. Grocery purchases use that reservation, so they do not reduce Remaining a second time; spending above ₱15,000 reduces Remaining further. On the 15th (using the device's local date), only the unused grocery allocation is released into that month's Remaining balance. It does not increase the next month's budget. Purchases still follow their bank's SOA billing month. **Actual spent** includes recorded expenses only and excludes card repayments and unspent reservations. The release is calculated whenever the monthly view renders, including on app load or month navigation.

The grocery row's **Status** shows **Available to spend**, the unused portion of its ₱15,000 allocation (zero when exhausted). This is a tracking figure only and does not add money to **Remaining** before the 15th. Overspending is shown separately in the same status cell.

### Bank Summary

Below the budget panel, a summary table shows each billable bank (excludes Cash) for the current month:

- **Total** — computed total of all non-payment purchases for that bank
- **SOA** — the actual amount from your Statement of Account (entered manually)
- **Paid** — whether you've already paid this bank's bill

Click the edit button on any row to update the SOA amount and paid status. Data is saved per bank per month.

### Summary

Switch to the **Summary** tab to see yearly totals broken down by category (pie chart) and by bank. Use the year dropdown to view different years.

Click **Download CSV** to download `expense-report-YYYY.csv` for the selected year. The report includes the annual total, all 12 monthly totals, totals by bank and category, and individual transactions. It follows SOA billing years (so a late-December card purchase may appear in the following year's report) and excludes **Payment** card repayments, matching the Summary view. All amounts are in PHP. Years without expenses produce a report with zero totals and no transactions. The CSV opens in Excel or other spreadsheet apps.

### Settings

Click the gear icon to access settings:

- **Features** — enable/disable the Recurring Expenses tab
- **Budget** — set a default monthly budget or override for the current month
- **Categories** — add or remove expense categories
- **Banks** — add or remove banks (each with an SOA date)

### Recurring Expenses

Enable via Settings > Features > "Enable Recurring Expenses". Then switch to the **Recurring** tab to configure templates:

- **Bank** — which bank/card is charged
- **Category** — expense category
- **Amount** — fixed monthly amount
- **Day of Month** — what day the charge hits (1–31)
- **End Date** — (optional) last month it should generate (e.g., 2027-02 for a payment ending in February 2027)
- **Active** — toggle to pause/resume without deleting

On each app open, any active recurring templates that haven't been generated for the current billing month are automatically created as purchases. Editing a template does not re-trigger for the current month. Deleting a generated purchase will not cause it to regenerate.

## Tech Stack

- Vanilla JavaScript (no framework) — `app.js`
- Tailwind CSS (CDN) + custom styles — `styles.css`
- Chart.js (CDN)
- Firebase Auth + Firestore (CDN, compat mode)

## Firestore Structure

```
users/{uid}/
  purchases/     — individual expense records
  categories/    — user's expense categories
  banks/         — bank names + SOA dates
  recurring/     — recurring expense templates
  recurringLog/  — tracks which templates have been generated for which billing month
  bankMonthly/   — per-bank per-month data (SOA amount, paid status), keyed as {bankName}-{year}-{month}
  (document)     — stores settings (budget, feature flags)
```
