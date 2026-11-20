# Pedal Plate sales counter: setup

The sales counter is the page at `pedalplate.in/sales` (`sales.html`). Sales are stored in a
Google Sheet that you own, through a small Google Apps Script (`sales/apps-script/Code.gs`).
Until the script URL is added to the page, `/sales` runs in **demo mode** with sample data
that stays on the phone.

Setup takes about 10 minutes and is done once.

## 1. Create the Sheet and the script

1. Sign in to the Google account the business will use, and create a new Google Sheet
   named **Pedal Plate Sales**.
2. In the Sheet, open **Extensions → Apps Script**.
3. Delete the sample code, paste in the whole of `sales/apps-script/Code.gs`, and save.
4. Near the top of the code, change `FIRST_FOUNDER_NAME` and `FIRST_FOUNDER_PIN` to your own
   name and a 4-digit PIN. Save.
5. In the toolbar, choose the function **setup** and click **Run**. Approve the permissions
   (it only needs access to this Sheet). This creates the tabs, a sample menu, two carts
   with a ₹500 float, and your founder login.
6. Change `FIRST_FOUNDER_PIN` back to `'0000'` in the code and save, so the PIN isn't left in
   the script. Once the app is connected (step 3), log in, tap your initial at the top, and set a
   new PIN there.

## 2. Publish the script as a web app

1. Click **Deploy → New deployment**, and choose type **Web app**.
2. Set **Execute as: Me** and **Who has access: Anyone**.
   (Anyone can reach the URL, but every action except login needs a valid PIN session.)
3. Click **Deploy** and copy the **Web app URL** (it ends in `/exec`).

## 3. Connect the page

In **both** `sales.html` and `club.html` (the customer's Pedal Club card), set the same URL:

```js
const API_URL = 'https://script.google.com/macros/s/…/exec';
```

Commit, and push after the owner's OK. `pedalplate.in/sales#demo` still opens demo mode
for training.

## 4. Fill in the Sheet

| Tab | What to edit |
|---|---|
| **Menu** | Easiest from the app: founder → **Menu** to switch today's combos on or off, change prices, or add a combo. In the Sheet: one row per combo **and size**, same `item_id` for the Half and Full rows, `type` is `veg` or `nonveg`, `active` `yes`/`no`. Prices here are what taps use. Partners' phones pick up changes within a minute. |
| **Carts** | One row per cart: `cart_id` (e.g. `C3`), name, `float` (₹ kept in the pouch every morning), `active`. |
| **Settings** | `undo_minutes`, `session_hours`, `pin_length`, `timezone`, and the Pedal Club rules below. |
| **Partners** | Add partners from the app (founder → Partners → Add partner). Add more founders by running `addFounder` from the Apps Script editor. Never delete rows: switch people off instead. |

The other tabs (**Sales, Closes, BankUpi, Sessions, Log, Customers, Passes, Stamps, Bills**) are written by the app. Read them,
build charts or pivot tables from them, but don't edit their columns.

## Daily use

- **Partners:** log in with the PIN, tap **Cash** or **UPI** after every plate, **Close my day**
  at the end (pouch count, boxes, plates left over). Tap your initial at the top to change your PIN.
- **Founders:** **Today** (any day with the date picker, plus the UPI check against the bank),
  **Menu** (today's combos and prices), **Reports** (any date range up to 3 months, with
  **Daily summary** and **Every sale** CSV downloads that open in Excel or Google Sheets),
  **Partners** (add, reset PIN, switch off, recent changes), **Sell**.

## WhatsApp bills and Pedal Club

**Bill (optional).** After tapping Cash/UPI, the partner taps **WhatsApp bill**, ticks the
customer's plates (the latest ones are ticked already), types the number (or the last 4 digits
for a regular) and taps **Make bill**. **Open WhatsApp** opens a chat with the bill filled in on
the cart phone; the partner presses send. This uses normal WhatsApp, so it costs nothing.
First-time numbers need the customer's OK (tick box).

**Pedal Club (reward).** Each paid walk-in plate on a bill gets one stamp. After `club_stamps`
stamps (9), the next combo is free: every 10th meal. Settings:

| Setting | Default | Meaning |
|---|---|---|
| `club_on` | yes | `no` pauses new stamps (earned free meals can still be claimed) |
| `club_stamps` | 9 | paid plates per card; the next one is free |
| `club_days` | 30 | a card is valid this many days, counting the day of its first stamp |
| `club_daily_cap` | 2 | most stamps per phone number per day, across all carts |
| `club_stamp_minutes` | 60 | a plate can get its stamp only this long after it was tapped |
| `club_grace_days` | 7 | a free meal that becomes ready near the end can still be claimed this many days later |
| `club_new_flag` | 15 | flag a partner who adds this many new customers in a day |
| `site_url`, `bill_footer` | | card link and last line of every bill |

A changed rule applies to cards from then on (validity is fixed when a card starts).

**Free meal.** Partner taps **Free meal**, finds the number, and types the 4-digit code from
the customer's card (pedalplate.in/club, link in their bill). It is saved as a ₹0 sale
("Free" in Reports), so plates, boxes and stock still match. Five wrong codes lock that
number's claims for 6 hours.

**Rules that stop misuse:** stamps only come from a sale saved in the Sheet, tapped by the
same partner, today, within 60 minutes; each sale is stamped once; undoing a sale removes its
stamps; corporate, bulk, home delivery and free plates never get stamps; one card being
filled per number; the free meal needs the customer's code; partners see masked numbers.
Founders see flags under **Club → Needs a look** (a partner's own number, a card filled
unusually fast, wrong-code lockouts, stamps by hand, free meals without code).

**Founder fallback (manual).** Under **Club**: **Add stamps by hand** (for plates that missed
their stamp: no signal, a partner forgot, a complaint; a reason is required and it is logged),
**Tell them on WhatsApp** afterwards, search a customer to remove a stamp, cancel a free
meal, put a number on hold, resend the card link or delete their data. On the **Free meal**
screen, founders can tick **Customer can't show the code** and give a reason.

**Notifications.** Every bill already carries the stamp count and card link, sent from the cart
phone at no cost. Fully automatic messages (with nobody pressing send) need the WhatsApp
Business Platform, which Meta charges per message; not set up.

**Customer data.** Phone numbers are only in the **Customers** tab. If someone asks to be
removed: Club → find them → **Delete their data**. Their stamps and bills stay without the number.

## Updating the script later

1. Paste the new `Code.gs` over the old one and save.
2. Run **setup** again. It only adds missing tabs and columns (for example the `leftover`
   column in **Closes**); it never deletes data.
3. **Deploy → Manage deployments → Edit → Version: New version → Deploy.** The URL stays the same.

## How the money check works

- **Cash, per partner:** each cart's pouch starts the day with its fixed float. At close,
  the pouch should hold `float + cash sales − cash spent`. The app shows the difference
  and how much to hand over.
- **UPI, whole business:** all carts share one QR, so a founder enters the day's UPI from the
  bank in **Today → UPI check**, and the app compares it with UPI tapped by all partners.
- **Boxes:** boxes sent out minus boxes returned should equal plates tapped.

## Limits to know

- Google Sheets holds 10 million cells. At about 2,500 plates a day the **Sales** tab fills in
  roughly a year. Before then, copy old months to an archive Sheet, or move the backend to a
  database. The page talks to the backend through one `api()` function, so only that function
  changes.
- Apps Script answers in 1–2 seconds. Taps never wait for it: they are queued on the phone and
  sent in the background.
