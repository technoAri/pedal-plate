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
   the script.

## 2. Publish the script as a web app

1. Click **Deploy → New deployment**, and choose type **Web app**.
2. Set **Execute as: Me** and **Who has access: Anyone**.
   (Anyone can reach the URL, but every action except login needs a valid PIN session.)
3. Click **Deploy** and copy the **Web app URL** (it ends in `/exec`).

## 3. Connect the page

In `sales.html`, set:

```js
const API_URL = 'https://script.google.com/macros/s/…/exec';
```

Commit, and push after the owner's OK. `pedalplate.in/sales#demo` still opens demo mode
for training.

## 4. Fill in the Sheet

| Tab | What to edit |
|---|---|
| **Menu** | One row per combo **and size**. Same `item_id` for the Half and Full rows of one combo. `type` is `veg` or `nonveg`. Set `active` to `no` to hide a combo. Prices here are what taps use. |
| **Carts** | One row per cart: `cart_id` (e.g. `C3`), name, `float` (₹ kept in the pouch every morning), `active`. |
| **Settings** | `undo_minutes`, `session_hours`, `pin_length`, `timezone`. |
| **Partners** | Add partners from the app (founder → Partners → Add partner). Add more founders by running `addFounder` from the Apps Script editor. Never delete rows: switch people off instead. |

The other tabs (**Sales, Closes, BankUpi, Sessions, Log**) are written by the app. Read them,
build charts or pivot tables from them, but don't edit their columns.

## Updating the script later

1. Paste the new `Code.gs` over the old one and save.
2. Run **setup** again. It only adds missing tabs and columns; it never deletes data.
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
