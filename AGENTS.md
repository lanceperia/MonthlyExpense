# Monthly Expense Tracker: agent guide

## Project and entry points

This is a personal expense tracker for PHP amounts, card billing cycles, cash
purchases, household allocations, recurring expenses, loans, and yearly reports.
Keep changes focused and preserve the existing vanilla JavaScript architecture.

- `index.html`: app markup, dialogs, inline event handlers, and CDN dependencies.
- `app.js`: Firebase configuration, authentication, Firestore access, state,
  calculations, rendering, CSV export, and event handlers.
- `styles.css`: custom styling over Tailwind; charcoal surfaces and teal accents.
- `tests/household-budget.test.cjs`: grocery allocations, manual release,
  commitments, actual spending, and SOA boundaries.
- `tests/yearly-report.test.cjs`: billing-year reports, totals, CSV escaping,
  empty years, and download behavior.
- `README.md`: setup and user-facing behavior; update when behavior changes.

There is no package manifest, build step, bundler, or checked-in dependency tree.
The page loads Tailwind CSS, Chart.js, and Firebase compat SDKs from CDNs.
Open `index.html` in a browser and sign in with Google for normal use. Authentication
and CDN loading require network access. Do not introduce a framework or build
pipeline for a small change.

## Financial rules

Keep actual expenses, reserved money, and card repayments distinct.

### Monthly budget and household allocations

- The selected budget is `settings.monthOverrides[year + '-' + month]`, falling
  back to `settings.defaultBudget`. A zero override is valid; use nullish fallback.
- `HOUSEHOLD_BUDGETS` defines the monthly allocations: Grocery PHP 15,000,
  PLDT PHP 1,500, Water Bill PHP 500, and Meralco PHP 6,000.
- Household purchases appear in the household table and must be excluded from
  the ordinary purchases used to calculate commitments, avoiding double counting.
- Utilities reserve their allocation until at least one purchase is recorded
  for that category and billing month, then commit the category's actual total.
  Their Paid/Unpaid household status is based on recorded purchases, independently
  of the bank statement's paid flag.
- `getMonthlyCommitment()` combines non-household expenses with household
  commitments and excludes `Payment` repayments.
- Main **Remaining** equals the selected budget minus total commitments.
  Negative values display as **Overspent**.
- The monthly **Total spent** figure equals total commitments, including
  unused household reservations and excluding `Payment`. It must reconcile with
  Remaining/Overspent. Reports continue to show actual purchases only.
- The user explicitly wants household allocations included in **Total spent**.
  Do not split the monthly panel into Actual spent and Reserved figures or rename
  the combined total Spent + reserved. Show Total budget, Total spent, and
  Remaining/Overspent. Grocery's Available to spend stays in its Status cell.

### Grocery behavior explicitly requested by the user

- Include the full PHP 15,000 allocation in Total spent immediately for every
  unreleased billing month. Grocery purchases consume that allocation without
  being counted twice. Commitment is `Math.max(15000, spent)` before release.
- Release is manual, using the button in the grocery Status cell. There is no
  automatic date cutoff. This replaces the earlier 15th-of-next-month rule.
- Show **Available to spend** as `Math.max(0, 15000 - spent)` for tracking only.
  Show **Release PHP <unused amount>** only while unused money is positive and
  the month has not been released. Hide the button at or above PHP 15,000 spent.
- Spending above PHP 15,000 continues to increase Total spent without a cap,
  both before and after release. For example, PHP 16,000 groceries commits PHP 16,000.
- On release, commitment becomes actual grocery spending. Only the unused portion
  returns to that billing month's Remaining. Do not increase the next month's budget.
- Persist release state as `settings.groceryReleasedMonths[year + '-' + month]`
  with zero-based months on the user document. Missing entries mean unreleased.
  Merge only the selected flag so other settings and months are preserved.
- Update local state only after a successful save. Block duplicate clicks while
  saving, keep funds allocated on failure, and stop clicks from expanding the row.
- Release is per billing month across all banks and cash. Continue using existing
  bank SOA attribution for purchases. Later edits recalculate actual spending.
- Example: PHP 7,200 spent commits PHP 15,000 before release and PHP 7,200 after;
  the button releases PHP 7,800. It disappears after successful release.

### SOA billing and dates

- `getBillingMonth()` is the central purchase attribution function. A purchase
  **on or after** a bank's SOA day belongs to the next billing month, including
  December-to-January rollover. Earlier purchases belong to the purchase month.
- Cash, a bank with SOA day zero, and an unknown bank use the calendar month.
- Default SOA days are BPI 15; BDO, RCBC, and UB 9; Cash 0. Banks are editable.
- JavaScript billing months are **zero-based**. Preserve existing persisted keys:
  budget overrides use `year-month` without padding; bank monthly documents use
  `bankName-year-MM` with a padded zero-based month; loan payment documents use
  `loanId-year-MM` with a padded zero-based month.
- Purchase dates are `YYYY-MM-DD`, interpreted locally at noon by the billing
  helper. Loan `startMonth` and HTML month inputs use normal `YYYY-MM` values
  with one-based months. Do not silently normalize stored keys or date formats.
- Recurring log `billingMonth` currently uses `year-MM` with a padded zero-based
  month. Check comparisons with HTML month values carefully if changing end dates.
- On load, `autoAdvanceIfAllPaid()` advances the selected month once if every
  configured billable bank is marked paid. This does not change grocery release rules.

### Reports, recurring expenses, and loans

- Yearly summaries and CSV reports use **billing year**, not purchase calendar year,
  and exclude `Payment`. Report actual purchases, not household reservations.
- Keep monthly totals, bank totals, category totals, and transaction totals reconciled.
  Include all twelve months and handle an empty year.
- CSV exports use PHP amounts, two decimal places, UTF-8 BOM, CRLF separators,
  quoted/escaped cells, and protection for formula-like text. Preserve numeric
  negatives and revoke download object URLs.
- Recurring expenses and loans are controlled by `recurringEnabled` and
  `loansEnabled` settings. Preserve their tab visibility behavior.
- Recurring generation uses `recurringLog` to avoid regenerating a template for
  the same billing month. Deleting a generated purchase does not delete that log.
  `buildPurchaseDate()` clamps the configured day to the last day of the month.
- Loan schedules and paid flags have separate state and collections. Do not assume
  that toggling a loan payment creates an expense purchase.

## Data and implementation conventions

Google authentication sets `currentUser`. `userDoc(collection)` scopes all
collection operations to `users/{uid}/{collection}`. Settings live on the user
document and are saved with merge semantics.

| Collection | Main fields / purpose |
| --- | --- |
| `purchases` | `bank`, `category`, `date`, `amount`, `othersText` |
| `categories` | `name` |
| `banks` | `name`, `soaDate` |
| `bankMonthly` | Manual `soaAmount` and `paid` flags per bank and billing month |
| `recurring` | `bank`, `category`, `amount`, `dayOfMonth`, `active`, `endDate` |
| `recurringLog` | `recurringId`, `billingMonth` |
| `loans` | `bank`, `name`, `amount`, `startMonth`, `duration` |
| `loanPayments` | `paid` per loan and month |

- In-memory records include their Firestore document `id`. Update local state
  after successful writes and render the affected view.
- Preserve existing user data and document identifiers; schema changes require
  an explicit migration strategy, not silent reinterpretation.
- Category `Payment` means card repayment, a transfer rather than a second expense.
  Category `Others` uses `othersText` for its display/grouping label when supplied.
- Keep functions called from inline HTML handlers globally accessible, and keep
  DOM IDs synchronized between markup and JavaScript.
- Prefer `textContent` and DOM creation for user-controlled values. Do not add
  unescaped user input to HTML strings or inline event attributes.
- Preserve keyboard labels, expandable rows, mobile layouts, and money formatting.
- Use sample data and stubbed Firebase for previews and automated tests. Normal
  sign-in can create defaults and generate recurring purchases; avoid writing
  production financial records merely to verify a UI change.
- Do not commit real financial exports, personal records, authentication tokens,
  browser profiles, generated screenshots, or temporary preview files.

## Validation and delivery

Run from the repository root in PowerShell:

```powershell
node --test tests/household-budget.test.cjs tests/yearly-report.test.cjs
node --check app.js
git diff --check
git status --short
```

Use explicit test paths: the installed Node/PowerShell combination does not expand
`tests/*.test.cjs` for `node --test`. Tests use Node's built-in test runner and VM
with Firebase/DOM stubs; no package installation or real Firebase access is needed.
Add focused tests for financial logic and boundary changes. Documentation-only
changes do not require new tests.

For UI changes, show a reviewable preview or before/after example using sample
figures, and state any limits to visual verification. For budget changes, check
manual release persistence and failures, empty purchases, exact-budget spending, overspending,
repayments, SOA cutoff days, future months, and year rollover as applicable.

Inspect the diff and preserve unrelated user edits. The user has requested review
before committing and pushing changes; show the result first unless the current
request already authorizes commit/push. Do not infer authorization for a new change
from approval of an earlier change. When requested, commit only the intended files,
push to the verified remote/branch, and report the actual outcome. Do not report
a successful push when only the local commit succeeded.
