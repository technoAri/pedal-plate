/**
 * Pedal Plate sales backend (Google Apps Script, bound to the sales Google Sheet).
 *
 * The sales page (sales.html, served at /sales) POSTs JSON here as text/plain:
 *   { "action": "login", "pin": "1234" }
 *   { "action": "record", "token": "...", "sales": [ ... ] }
 * Every reply is JSON: { ok: true, ... } or { ok: false, error: "message" }.
 *
 * The Sheet is the source of truth. Menu, prices, carts, floats and partners are
 * edited in the Sheet (or from the founder screens); nothing is hard-coded in the page.
 * To add a feature: add a tab to SCHEMA, add a handler to ACTIONS, and call it from
 * the page with api('yourAction', {...}).
 *
 * Setup: see sales/SETUP.md.
 */

const SCHEMA = {
  Settings: ['key', 'value', 'note'],
  Menu:     ['item_id', 'name', 'type', 'size', 'price', 'active', 'sort', 'website', 'days', 'photo', 'unit'],
  Carts:    ['cart_id', 'name', 'float', 'active'],
  Partners: ['partner_id', 'name', 'role', 'cart_id', 'phone', 'backup', 'active', 'start_date', 'pin_hash', 'salt', 'created_at'],
  Sessions: ['token', 'partner_id', 'cart_id', 'expires_at'],
  Sales:    ['sale_id', 'created_at', 'date', 'partner_id', 'partner_name', 'cart_id', 'item_id', 'item_name', 'size', 'price', 'qty', 'amount', 'pay', 'source', 'status', 'void_by', 'void_at', 'order_type', 'ref', 'order_id'],
  Closes:   ['close_id', 'date', 'partner_id', 'partner_name', 'cart_id', 'plates', 'sales_total', 'cash_sales', 'upi_sales', 'float', 'spent', 'pouch_expected', 'pouch_counted', 'difference', 'handed_over', 'boxes_out', 'boxes_back', 'note', 'closed_at', 'leftover', 'free_plates'],
  BankUpi:  ['date', 'amount', 'upi_tapped', 'difference', 'entered_by', 'entered_at'],
  Log:      ['at', 'by', 'action', 'details'],
  // Pedal Club and bills. Phone numbers live only in Customers, so deleting a customer is one row.
  Customers: ['customer_id', 'phone', 'name', 'card_token', 'consent_at', 'consent_by', 'created_at', 'blocked', 'blocked_by', 'deleted_at', 'flag_ok', 'verified'],
  Passes:   ['pass_id', 'customer_id', 'code', 'issued_date', 'issued_at', 'valid_till', 'status', 'redeemed_at', 'redeem_sale_id', 'redeemed_by', 'issued_by', 'flag_ok'],
  // Stamps.size: Full or Half (the plate that earned it). Blank = a stamp from before Half stamps, counted as Full.
  Stamps:   ['stamp_id', 'pass_id', 'customer_id', 'sale_id', 'date', 'created_at', 'partner_id', 'partner_name', 'cart_id', 'status', 'void_by', 'void_at', 'size'],
  // Bills.bill_to: the masked number of a "bill only" customer (not a Pedal Club member, number not saved).
  Bills:    ['bill_no', 'created_at', 'date', 'partner_id', 'partner_name', 'cart_id', 'customer_id', 'sale_ids', 'amount', 'stamps', 'pass_id', 'order_id', 'bill_to'],
};

// Extras (Menu rows with type "extra", e.g. Extra rice, Extra chicken) and the top-up that turns a free
// Half into a Full are money, not plates: they never count as plates and never earn stamps.
// In the Sales tab their size is "Extra" or "Top-up".
const NOT_PLATES = { Extra: true, 'Top-up': true };
function isPlate(r) { return !NOT_PLATES[String(r.size || '')]; }
function isExtraType(t) { return String(t || '').trim().toLowerCase() === 'extra'; }
function menuSize(r) { return isExtraType(r.type) ? 'Extra' : (r.size || 'Full'); }

const DEFAULT_SETTINGS = [
  ['timezone', 'Asia/Kolkata', 'Used for the sales date'],
  ['session_hours', '18', 'How long a login lasts on a phone'],
  ['undo_minutes', '2', 'How long a partner can undo their own last sale'],
  ['pin_length', '4', 'Digits in generated PINs'],
  ['club_on', 'yes', 'Pedal Club stamps on (yes) or paused (no). Earned free meals can still be claimed.'],
  ['club_stamps', '9', 'Paid plates per pass. The next plate is free (9 = every 10th meal free).'],
  ['club_days', '30', 'Days a pass is valid, counting the day it is issued'],
  ['club_daily_cap', '2', 'Most stamps one phone number can get in a day'],
  ['club_stamp_minutes', '60', 'A sale can get a stamp only this many minutes after it was tapped'],
  ['club_grace_days', '7', 'Extra days to claim a free meal that became ready near the end of the pass'],
  ['club_new_flag', '15', 'Flag a partner who adds this many new customers in one day'],
  ['site_url', 'https://pedalplate.in', 'Used for the Pedal Club card link in bills'],
  ['bill_footer', 'Thank you! Pre-book on WhatsApp: +91 76991 49899', 'Last line of every WhatsApp bill'],
  ['report_on', 'yes', 'Daily report at about 1 am (yes/no)'],
  ['report_emails', 'pedalplate.food@gmail.com', 'Who gets the daily report email (comma list)'],
  ['report_whatsapp', '', 'Daily report on WhatsApp: number:apikey from CallMeBot, comma list (e.g. 917699149899:123456)'],
];

// Edit these two lines before running setup() the first time, then change the PIN from the app.
const FIRST_FOUNDER_NAME = 'Arindam';
const FIRST_FOUNDER_PIN = '9999';   // set back to '0000' after setup() and change your PIN from the app (tap your name)

/* ---------- entry points ---------- */

function doPost(e) {
  let req = {};
  SETTINGS_CACHE = null; READ = {};
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const handler = ACTIONS[req.action];
    if (!handler) return reply({ ok: false, error: 'Unknown action' });
    const res = handler.public ? handler.fn(req) : withSession(req, handler);
    return reply(Object.assign({ ok: true }, res));
  } catch (err) {
    return reply({ ok: false, error: err && err.userMessage ? err.userMessage : 'Something went wrong. Try again.' , detail: String(err) });
  }
}

function doGet() {
  return reply({ ok: true, service: 'Pedal Plate sales', time: new Date().toISOString() });
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function fail(msg) { const e = new Error(msg); e.userMessage = msg; throw e; }

/* ---------- actions ---------- */

const ACTIONS = {
  login: { public: true, fn: login },
  config: { fn: (req, s) => ({ config: getConfig(), me: publicPartner(s.partner, s.cart_id) }) },
  record: { fn: recordSales },
  void: { fn: voidSale },
  mine: { fn: mineToday },
  changePin: { fn: changePin },
  close: { fn: closeDay },
  today: { founder: true, fn: founderToday },
  bankUpi: { founder: true, fn: saveBankUpi },
  partnersList: { founder: true, fn: () => ({ partners: rows('Partners').map(p => publicPartner(p)) }) },
  partnersAdd: { founder: true, fn: addPartner },
  partnersUpdate: { founder: true, fn: updatePartner },
  partnersResetPin: { founder: true, fn: resetPin },
  logList: { founder: true, fn: () => ({ log: rowsTail('Log', 60).reverse() }) },
  menuList: { founder: true, fn: () => ({ menu: menuAll() }) },
  menuUpdate: { founder: true, fn: menuUpdate },
  menuAdd: { founder: true, fn: menuAdd },
  report: { founder: true, fn: report },
  clubFind: { fn: clubFind },
  clubBill: { fn: clubBill },
  clubRedeem: { fn: clubRedeem },
  clubCard: { public: true, fn: clubCard },
  clubOverview: { founder: true, fn: clubOverview },
  clubCustomer: { founder: true, fn: clubCustomer },
  clubVoidStamp: { founder: true, fn: clubVoidStamp },
  clubBlock: { founder: true, fn: clubBlock },
  clubForget: { founder: true, fn: clubForget },
  clubUndoRedeem: { founder: true, fn: clubUndoRedeem },
  clubFlagOk: { founder: true, fn: clubFlagOk },
  clubManual: { founder: true, fn: clubManual },
  menuPublic: { public: true, fn: menuPublic },
  clubJoin: { public: true, fn: clubJoin },
  orderSave: { fn: orderSave },
  logout: { fn: (req, s) => { withLock(() => deleteWhere('Sessions', r => r.token === req.token)); CacheService.getScriptCache().remove('sess_' + req.token); return {}; } },
  setCart: { fn: (req, s) => {
    const cart = rows('Carts').find(c => String(c.cart_id) === String(req.cart_id) && truthy(c.active));
    if (!cart) fail('That cart is not active.');
    withLock(() => updateWhere('Sessions', r => r.token === req.token, { cart_id: String(cart.cart_id) }));
    rememberSession({ token: req.token, partner_id: s.partner.partner_id, cart_id: String(cart.cart_id), expires_at: s.expires_at }, s.partner.salt);
    return { me: publicPartner(s.partner, String(cart.cart_id)) };
  } },
};

function withSession(req, handler) {
  const s = getSession(req.token);
  if (!s) fail('Your login has expired. Enter your PIN again.');
  if (handler.founder && s.partner.role !== 'founder') fail('Only founders can do this.');
  return handler.fn(req, s);
}

function login(req) {
  const pin = String(req.pin || '');
  if (!/^\d{4,6}$/.test(pin)) fail('Enter your PIN.');
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('login_fails') || 0);
  if (fails >= 12) fail('Too many wrong PINs. Wait 10 minutes and try again.');
  const p = partnersCached().find(r => r.pin_hash && r.pin_hash === hashPin(pin, r.salt));
  if (!p) { cache.put('login_fails', String(fails + 1), 600); fail("That PIN isn't recognised. Try again."); }
  if (!truthy(p.active)) fail(p.name + "'s PIN is switched off. Ask a founder.");
  const cart = String(req.cart_id || p.cart_id || '');
  const token = Utilities.getUuid() + Utilities.getUuid().slice(0, 8);
  const hours = Number(setting('session_hours', 18));
  const sess = { token, partner_id: p.partner_id, cart_id: cart, expires_at: new Date(Date.now() + hours * 3600e3).toISOString() };
  withLock(() => {
    if (Math.random() < 0.05) deleteWhere('Sessions', r => new Date(r.expires_at) < new Date());   // tidy up now and then, not on every login
    append('Sessions', sess);
  });
  rememberSession(sess, p.salt);
  return { token, me: publicPartner(p, cart), config: getConfig(), expires_in_hours: hours };
}

function recordSales(req, s) {
  const list = Array.isArray(req.sales) ? req.sales.slice(0, 200) : [];
  if (!list.length) return { saved: [] };
  const menu = getMenuIndex();
  const saved = [];
  withLock(() => {
    const seen = new Set(rowsTail('Sales', 4000).map(r => r.sale_id));
    const out = [];
    list.forEach(x => {
      const id = String(x.sale_id || '');
      if (!id) return;
      if (seen.has(id)) { saved.push(id); return; }      // already stored: safe to resend after a bad signal
      const key = x.item_id + '|' + x.size;
      const m = menu[key];
      const source = x.source === 'manual' ? 'manual' : 'tap';
      const pay = x.pay === 'UPI' ? 'UPI' : x.pay === 'Cash' ? 'Cash' : '';
      if (!pay) return;
      // Taps always use the price in the Menu tab. Missed sales may carry the price the partner entered.
      const price = source === 'manual' && Number(x.price) > 0 ? Number(x.price) : (m ? Number(m.price) : NaN);
      const qty = Math.max(1, Math.min(500, Math.round(Number(x.qty) || 1)));
      if (!(price > 0)) return;
      const at = x.created_at ? new Date(x.created_at) : new Date();
      out.push({
        sale_id: id, created_at: at.toISOString(), date: dateKey(at), partner_id: s.partner.partner_id, partner_name: s.partner.name,
        cart_id: s.cart_id, item_id: x.item_id, item_name: m ? m.name : String(x.item_name || x.item_id), size: x.size,
        price, qty, amount: price * qty, pay, source, status: 'ok', void_by: '', void_at: '',
        order_type: ORDER_TYPES.indexOf(x.order_type) >= 0 ? x.order_type : 'walkin', ref: '',
      });
      seen.add(id); saved.push(id);
    });
    appendMany('Sales', out);
  });
  return { saved };
}

function voidSale(req, s) {
  const id = String(req.sale_id || '');
  const undoMin = Number(setting('undo_minutes', 2));
  let done = false, logged = null;
  withLock(() => {
    const sh = sheet('Sales'); const data = sh.getDataRange().getValues(); const h = data[0];
    const ci = name => h.indexOf(name);
    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][ci('sale_id')]) !== id) continue;
      const isFounder = s.partner.role === 'founder';
      const own = String(data[i][ci('partner_id')]) === String(s.partner.partner_id);
      const age = (Date.now() - new Date(data[i][ci('created_at')]).getTime()) / 60000;
      if (!isFounder && (!own || age > undoMin + 1)) fail('This sale can no longer be undone. Ask a founder to correct it.');
      if (data[i][ci('status')] === 'void') { done = true; break; }
      sh.getRange(i + 1, ci('status') + 1, 1, 3).setValues([['void', s.partner.name, new Date().toISOString()]]);
      if (isFounder && !own) logged = id + ' (' + data[i][ci('partner_name')] + ')';
      clubAfterVoid(id, String(ci('ref') >= 0 ? data[i][ci('ref')] : ''), s.partner.name);
      done = true; break;
    }
  });
  if (logged) logAction(s.partner.name, 'void sale', logged);   // outside the lock: logAction takes the lock itself
  return { voided: done };
}

function mineToday(req, s) {
  const d = dateKey(new Date());
  const sales = todaysSales(d).filter(r => String(r.partner_id) === String(s.partner.partner_id));
  const close = rows('Closes').filter(r => r.date === d && String(r.partner_id) === String(s.partner.partner_id)).pop() || null;
  return { date: d, totals: totalsOf(sales), close, config: getConfig(), me: publicPartner(s.partner, s.cart_id) };
}

function closeDay(req, s) {
  const d = dateKey(new Date());
  const pid = String(s.partner.partner_id);
  const t = totalsOf(todaysSales(d).filter(r => String(r.partner_id) === pid));
  const cart = rows('Carts').find(c => String(c.cart_id) === String(s.cart_id));
  const float = Number(cart ? cart.float : 0) || 0;
  const spent = Math.max(0, Number(req.spent) || 0);
  const counted = Number(req.pouch_counted);
  if (!(counted >= 0)) fail('Enter the pouch count.');
  const expected = float + t.cash - spent;
  const row = {
    close_id: Utilities.getUuid(), date: d, partner_id: pid, partner_name: s.partner.name, cart_id: s.cart_id,
    plates: t.plates, sales_total: t.total, cash_sales: t.cash, upi_sales: t.upi, float, spent,
    pouch_expected: expected, pouch_counted: counted, difference: counted - expected, handed_over: Math.max(0, counted - float),
    boxes_out: req.boxes_out === '' || req.boxes_out == null ? '' : Number(req.boxes_out),
    boxes_back: req.boxes_back === '' || req.boxes_back == null ? '' : Number(req.boxes_back),
    note: String(req.note || '').slice(0, 300), closed_at: new Date().toISOString(),
    leftover: req.leftover === '' || req.leftover == null ? '' : Math.max(0, Math.round(Number(req.leftover)) || 0),
    free_plates: t.freePlates,
  };
  withLock(() => append('Closes', row));   // a second close the same day is kept too; the latest one counts
  return { close: row, totals: t };
}

function founderToday(req) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(req.date || '') ? req.date : dateKey(new Date());
  const sales = todaysSales(d);
  const closes = rows('Closes').filter(r => r.date === d);
  const lastClose = {}; closes.forEach(c => lastClose[c.partner_id] = c);
  const by = {};
  sales.forEach(r => { (by[r.partner_id] = by[r.partner_id] || []).push(r); });
  const partners = rows('Partners').filter(p => by[p.partner_id] || (truthy(p.active) && p.role !== 'founder' && !truthy(p.backup)));
  const perPartner = partners.map(p => Object.assign({ partner: publicPartner(p), close: lastClose[p.partner_id] || null }, totalsOf(by[p.partner_id] || [])));
  const byItem = {};
  sales.forEach(r => { const k = r.item_name + (r.size && r.size !== 'Extra' ? ' · ' + r.size : ''); byItem[k] = (byItem[k] || 0) + Number(r.qty); });
  const bank = rows('BankUpi').filter(r => r.date === d).pop() || null;
  return { date: d, totals: totalsOf(sales), perPartner, byItem, bank };
}

function saveBankUpi(req, s) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(req.date || '') ? req.date : dateKey(new Date());
  const amount = Number(req.amount);
  if (!(amount >= 0)) fail('Enter the UPI amount.');
  const tapped = totalsOf(todaysSales(d)).upi;
  const row = { date: d, amount, upi_tapped: tapped, difference: amount - tapped, entered_by: s.partner.name, entered_at: new Date().toISOString() };
  withLock(() => append('BankUpi', row));
  return { bank: row };
}

// A founder may type the PIN (manual override); otherwise a random one is made.
function chosenPin(req, exceptId) {
  if (req.pin == null || String(req.pin).trim() === '') return newPin();
  const pin = String(req.pin).trim();
  if (!/^\d{4}$/.test(pin)) fail('The PIN must be 4 digits.');
  if (/^(\d)\1+$/.test(pin)) fail('Choose a PIN that is harder to guess (not 1111, 2222…).');
  if (pinTaken(pin, exceptId)) fail('That PIN is already in use. Choose another.');
  return pin;
}

function addPartner(req, s) {
  const name = String(req.name || '').trim().slice(0, 40);
  if (!name) fail('Enter a first name.');
  const pin = chosenPin(req);
  const salt = Utilities.getUuid();
  const p = {
    partner_id: newId('P'), name, role: 'partner', cart_id: String(req.cart_id || ''),
    phone: String(req.phone || '').slice(0, 20), backup: req.backup ? 'yes' : 'no', active: 'yes',
    start_date: String(req.start_date || dateKey(new Date())), pin_hash: hashPin(pin, salt), salt, created_at: new Date().toISOString(),
  };
  withLock(() => append('Partners', p));
  partnersChanged();
  logAction(s.partner.name, 'added partner', name + ' (' + (p.cart_id || 'no cart') + (p.backup === 'yes' ? ', backup' : '') + ')');
  return { partner: publicPartner(p), pin };
}

function updatePartner(req, s) {
  const changes = {};
  if (req.cart_id != null) changes.cart_id = String(req.cart_id);
  if (req.active != null) changes.active = req.active ? 'yes' : 'no';
  if (req.backup != null) changes.backup = req.backup ? 'yes' : 'no';
  if (changes.active === 'no' && String(req.partner_id) === String(s.partner.partner_id)) fail("You can't switch off your own login.");   // check before changing anything
  let target;
  withLock(() => {
    target = updateWhere('Partners', r => String(r.partner_id) === String(req.partner_id), changes);
    if (!target) fail('Partner not found.');
    if (changes.active === 'no') deleteWhere('Sessions', r => String(r.partner_id) === String(req.partner_id));
  });
  partnersChanged();
  logAction(s.partner.name, 'updated partner', target.name + ': ' + Object.keys(changes).map(k => k + '=' + changes[k]).join(', '));
  return { partner: publicPartner(Object.assign(target, changes)) };
}

function resetPin(req, s) {
  const p = rows('Partners').find(r => String(r.partner_id) === String(req.partner_id));
  if (!p) fail('Partner not found.');
  if (p.role === 'founder' && String(p.partner_id) === String(s.partner.partner_id)) fail("Change your own PIN under More → Change my PIN, or ask another founder.");
  const manual = req.pin != null && String(req.pin).trim() !== '';
  const pin = chosenPin(req, p.partner_id); const salt = Utilities.getUuid();
  withLock(() => {
    updateWhere('Partners', r => String(r.partner_id) === String(p.partner_id), { pin_hash: hashPin(pin, salt), salt });
    deleteWhere('Sessions', r => String(r.partner_id) === String(p.partner_id));
  });
  partnersChanged();   // cached logins check the PIN salt, so the old logins stop at once
  logAction(s.partner.name, manual ? 'set PIN by hand' : 'reset PIN', p.name);
  return { pin, partner: publicPartner(p) };
}

function changePin(req, s) {
  const oldPin = String(req.old_pin || ''), pin = String(req.new_pin || '');
  if (s.partner.pin_hash !== hashPin(oldPin, s.partner.salt)) fail('Your current PIN is not right.');
  if (!/^\d{4,6}$/.test(pin)) fail('The new PIN must be 4 to 6 digits.');
  if (/^(\d)\1+$/.test(pin)) fail('Choose a PIN that is harder to guess.');
  if (pinTaken(pin, s.partner.partner_id)) fail('That PIN is already in use. Choose another.');
  const salt = Utilities.getUuid();
  withLock(() => updateWhere('Partners', r => String(r.partner_id) === String(s.partner.partner_id), { pin_hash: hashPin(pin, salt), salt }));
  partnersChanged();
  rememberSession({ token: req.token, partner_id: s.partner.partner_id, cart_id: s.cart_id, expires_at: s.expires_at }, salt);   // stay logged in on this phone
  logAction(s.partner.name, 'changed own PIN', '');
  return {};
}

/* ----- menu (founders change today's combos and prices from the app) ----- */

// Website fields: website = yes (always show) / no (hide) / blank (show while switched on);
// days = "Mon,Wed,Fri" (card tags and the Today badge); photo = name of a processed photo in images/menu.
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function cleanDays(v) {
  const out = []; String(v || '').split(/[,\s\/]+/).forEach(x => { const i = DAY_NAMES.findIndex(d => d.toLowerCase() === x.slice(0, 3).toLowerCase()); if (i >= 0 && out.indexOf(DAY_NAMES[i]) < 0) out.push(DAY_NAMES[i]); });
  return out.sort((a, b) => DAY_NAMES.indexOf(a) - DAY_NAMES.indexOf(b)).join(',');
}
function menuAll() {
  const items = {};
  rows('Menu').sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0)).forEach(r => {
    const it = items[r.item_id] = items[r.item_id] || { item_id: String(r.item_id), name: r.name, type: isExtraType(r.type) ? 'extra' : String(r.type).toLowerCase().indexOf('non') === 0 ? 'nonveg' : 'veg', active: false, sizes: [],
      website: String(r.website || '').toLowerCase(), days: cleanDays(r.days), photo: String(r.photo || '').trim(), unit: String(r.unit || '').trim() };
    if (!it.sizes.some(z => z.size === menuSize(r))) it.sizes.push({ size: menuSize(r), price: Number(r.price) });
    if (truthy(r.active)) it.active = true;
    if (!it.website && r.website) it.website = String(r.website).toLowerCase();
    if (!it.days && r.days) it.days = cleanDays(r.days);
    if (!it.photo && r.photo) it.photo = String(r.photo).trim();
  });
  return Object.keys(items).map(k => items[k]);
}

// The website's menu (public, read-only). Cached for 5 minutes; app changes clear the cache at once.
function menuPublic() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('menu_public');
  if (hit) return JSON.parse(hit);
  const order = z => ({ Half: 0, Full: 1 })[z] == null ? 2 : ({ Half: 0, Full: 1 })[z];
  const items = menuAll().filter(m => m.type !== 'extra' && (m.website === 'yes' || (m.website !== 'no' && m.active))).map(m => ({
    name: m.name, type: m.type, today_on: m.active, days: m.days ? m.days.split(',') : [],
    photo: /^[a-z0-9-]{1,60}$/.test(m.photo) ? m.photo : '',
    sizes: m.sizes.filter(z => z.price > 0).sort((a, b) => order(a.size) - order(b.size)),
  })).filter(m => m.sizes.length);
  const full = items.map(m => (m.sizes.find(z => z.size === 'Full') || m.sizes[m.sizes.length - 1]).price);
  const out = { items, from: full.length ? Math.min.apply(null, full) : null, to: full.length ? Math.max.apply(null, full) : null, at: new Date().toISOString() };
  cache.put('menu_public', JSON.stringify(out), 300);
  return out;
}
function menuChanged() { const c = CacheService.getScriptCache(); c.remove('menu_public'); c.remove('config_v1'); }

// Change a combo: switch on/off, prices (a new size such as Half adds a row), name, type, website fields.
function menuUpdate(req, s) {
  const id = String(req.item_id || '');
  const prices = req.prices && typeof req.prices === 'object' ? req.prices : null;
  if (prices) Object.keys(prices).forEach(z => { if (!(Number(prices[z]) > 0)) fail('Enter a price for ' + z + '.'); if (!/^[A-Za-z ]{1,12}$/.test(z)) fail('Plate size must be a short word, like Half or Full.'); });
  const name = req.name != null ? String(req.name).trim().slice(0, 60) : null;
  if (name === '') fail('Enter the combo name.');
  if (name && rows('Menu').some(r => String(r.item_id) !== id && String(r.name).toLowerCase() === name.toLowerCase())) fail('Another combo already has that name.');
  const changes = {};
  if (req.active != null) changes.active = req.active ? 'yes' : 'no';
  if (name) changes.name = name;
  if (req.type === 'veg' || req.type === 'nonveg') changes.type = req.type;
  if (req.website != null) changes.website = req.website === 'yes' ? 'yes' : req.website === 'no' ? 'no' : '';
  if (req.days != null) changes.days = cleanDays(req.days);
  if (req.photo != null) changes.photo = /^[a-z0-9-]{0,60}$/.test(String(req.photo)) ? String(req.photo) : fail('Photo name: small letters, numbers and dashes only.');
  let found = null; const seen = {};
  withLock(() => {
    const sh = sheet('Menu'); const data = sh.getDataRange().getValues(); const h = data[0];
    const c = k => h.indexOf(k);
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][c('item_id')]) !== id) continue;
      found = found || { name: data[i][c('name')], type: data[i][c('type')], active: data[i][c('active')], sort: data[i][c('sort')], website: c('website') >= 0 ? data[i][c('website')] : '', days: c('days') >= 0 ? data[i][c('days')] : '', photo: c('photo') >= 0 ? data[i][c('photo')] : '' };
      Object.keys(changes).forEach(k => { if (c(k) >= 0) sh.getRange(i + 1, c(k) + 1).setValue(changes[k]); });
      const z = isExtraType(data[i][c('type')]) ? 'Extra' : data[i][c('size')] || 'Full'; seen[z] = true;
      if (prices && prices[z] != null) sh.getRange(i + 1, c('price') + 1).setValue(Number(prices[z]));
    }
    if (!found) return;
    const base = Object.assign({}, found, changes);
    const extra = prices ? Object.keys(prices).filter(z => !seen[z]) : [];
    appendMany('Menu', extra.map(z => ({ item_id: id, name: base.name, type: base.type, size: z, price: Number(prices[z]), active: base.active, sort: base.sort, website: base.website, days: base.days, photo: base.photo })));
  });
  if (!found) fail('That combo is not in the Menu tab.');
  menuChanged();
  logAction(s.partner.name, 'menu', id + ' ' + JSON.stringify(Object.assign({}, changes, prices ? { prices } : {})));
  return { menu: menuAll() };
}

function menuAdd(req, s) {
  const name = String(req.name || '').trim().slice(0, 60);
  if (!name) fail('Enter the combo name.');
  const type = req.type === 'nonveg' ? 'nonveg' : 'veg';
  const sizes = (Array.isArray(req.sizes) ? req.sizes : []).map(z => ({ size: String(z.size || 'Full').slice(0, 12), price: Number(z.price) })).filter(z => z.price > 0);
  if (!sizes.length) fail('Enter at least one price.');
  const all = rows('Menu');
  if (all.some(r => String(r.name).toLowerCase() === name.toLowerCase())) fail('That combo already exists. Switch it on instead.');
  const id = newId('M');
  const sort = all.reduce((m, r) => Math.max(m, Number(r.sort) || 0), 0) + 1;
  const days = cleanDays(req.days), website = req.website === 'yes' ? 'yes' : req.website === 'no' ? 'no' : '';
  withLock(() => appendMany('Menu', sizes.map(z => ({ item_id: id, name, type, size: z.size, price: z.price, active: 'yes', sort, website, days, photo: '' }))));
  menuChanged();
  logAction(s.partner.name, 'menu', 'added ' + name);
  return { menu: menuAll() };
}

/* ----- reports and export ----- */

function report(req) {
  const ok = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
  const to = ok(req.to) ? req.to : dateKey(new Date());
  const from = ok(req.from) ? req.from : to;
  if (from > to) fail('The start date is after the end date.');
  if ((new Date(to) - new Date(from)) / 864e5 > 92) fail('Choose up to 3 months at a time.');
  const sales = rows('Sales').filter(r => r.date >= from && r.date <= to && r.status !== 'void');
  const closes = rows('Closes').filter(r => r.date >= from && r.date <= to);
  const lastClose = {}; closes.forEach(c => lastClose[c.date + '|' + c.partner_id] = c);
  const days = {}, items = {}, partners = {};
  sales.forEach(r => {
    (days[r.date] = days[r.date] || []).push(r);
    const k = r.item_name + (r.size && r.size !== 'Extra' ? ' · ' + r.size : '');
    const it = items[k] = items[k] || { plates: 0, total: 0 }; it.plates += Number(r.qty) || 0; it.total += Number(r.amount) || 0;
    (partners[r.partner_name] = partners[r.partner_name] || []).push(r);
  });
  const leftoverBy = {}; Object.keys(lastClose).forEach(k => { const c = lastClose[k]; if (c.leftover !== '' && c.leftover != null) leftoverBy[c.date] = (leftoverBy[c.date] || 0) + Number(c.leftover); });
  const bank = {}; rows('BankUpi').filter(r => r.date >= from && r.date <= to).forEach(b => bank[b.date] = b);
  const perDay = Object.keys(days).concat(Object.keys(leftoverBy)).filter((d, i, a) => a.indexOf(d) === i).sort().map(d =>
    Object.assign({ date: d, leftover: leftoverBy[d] == null ? '' : leftoverBy[d], bank_upi: bank[d] ? Number(bank[d].amount) : '' }, totalsOf(days[d] || [])));
  return {
    from, to, totals: totalsOf(sales), perDay,
    byItem: Object.keys(items).map(k => Object.assign({ item: k }, items[k])).sort((a, b) => b.plates - a.plates),
    byPartner: Object.keys(partners).map(n => Object.assign({ name: n }, totalsOf(partners[n]))).sort((a, b) => b.total - a.total),
    sales: req.withSales ? sales.map(r => ({ date: r.date, time: r.created_at, partner: r.partner_name, cart: r.cart_id, item: r.item_name, size: r.size, qty: Number(r.qty), price: Number(r.price), amount: Number(r.amount), pay: r.pay, source: r.source, order_type: r.order_type || 'walkin', sale_id: r.sale_id })) : undefined,
  };
}

/* ----- Pedal Club (reward stamps) and WhatsApp bills -----
 * Rules (all in the Settings tab):
 *  - Every paid walk-in plate can earn one stamp. After club_stamps stamps (9), the next plate is free.
 *  - A pass is issued with its first stamp and is valid for club_days (30) days, counting that day.
 *    When it is used or runs out, the next stamp on the same number starts a new pass.
 *  - At most club_daily_cap (2) stamps per phone number per day, across all carts.
 *  - Stamps only come from a recorded sale (sale_id), tapped by the same partner today, within
 *    club_stamp_minutes. One sale is stamped once. Voiding the sale removes its stamps.
 *  - Corporate, bulk and home delivery sales, and free meals, never earn stamps.
 *  - The free meal needs the 4-digit code on the customer's own card (sent only to their WhatsApp).
 *    Five wrong codes lock that number's claims for 6 hours.
 *  - A free meal that becomes ready near the end of the pass can still be claimed for club_grace_days.
 *  - Partners see masked numbers; founders see full numbers and can undo, block or delete.
 */
const ORDER_TYPES = ['walkin', 'corporate', 'delivery'];

function clubRules() {
  return {
    on: truthy(setting('club_on', 'yes')),
    stamps: Math.max(1, Math.round(Number(setting('club_stamps', 9))) || 9),
    days: Math.max(1, Math.round(Number(setting('club_days', 30))) || 30),
    cap: Math.max(1, Math.round(Number(setting('club_daily_cap', 2))) || 2),
    minutes: Math.max(1, Number(setting('club_stamp_minutes', 60)) || 60),
    grace: Math.max(0, Math.round(Number(setting('club_grace_days', 7))) || 0),
    newFlag: Math.max(1, Number(setting('club_new_flag', 15)) || 15),
    site: String(setting('site_url', 'https://pedalplate.in')).replace(/\/+$/, ''),
    footer: String(setting('bill_footer', 'Thank you! Pre-book on WhatsApp: +91 76991 49899')),
  };
}

function normPhone(v) {
  let d = String(v == null ? '' : v).replace(/\D/g, '');
  if (d.length === 12 && d.indexOf('91') === 0) d = d.slice(2);
  if (d.length === 11 && d[0] === '0') d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : '';
}
function maskPhone(p) { p = String(p || ''); return p.length === 10 ? p.slice(0, 2) + '•••••' + p.slice(-3) : ''; }
function padCode(c) { return String(c == null ? '' : c).replace(/\D/g, '').padStart(4, '0').slice(-4); }
function addDaysKey(k, n) { const d = new Date(k + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function daysBetween(a, b) { return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 864e5); }

function clubLoad() {
  return {
    customers: rows('Customers').map(c => Object.assign(c, { customer_id: String(c.customer_id), phone: c.phone === '' ? '' : normPhone(c.phone) })),
    passes: rows('Passes').map(p => Object.assign(p, { pass_id: String(p.pass_id), customer_id: String(p.customer_id), code: padCode(p.code) })),
    stamps: rows('Stamps').filter(x => x.status !== 'void').map(x => Object.assign(x, { pass_id: String(x.pass_id), customer_id: String(x.customer_id), sale_id: String(x.sale_id) })),
  };
}

function findCustomer(D, phone) { return D.customers.find(c => !c.deleted_at && c.phone && c.phone === phone) || null; }

// What a pass looks like today. state: active (collecting), ready (free meal waiting), redeemed, expired.
function passView(p, D, R, today) {
  const st = D.stamps.filter(x => x.pass_id === p.pass_id).sort((a, b) => String(a.created_at) < String(b.created_at) ? -1 : 1);
  const n = st.length;
  let state, claimTill = '';
  if (p.status === 'redeemed') state = 'redeemed';
  else if (n >= R.stamps) {
    const readyOn = st[R.stamps - 1].date;
    claimTill = p.valid_till > addDaysKey(readyOn, R.grace) ? p.valid_till : addDaysKey(readyOn, R.grace);
    state = today <= claimTill ? 'ready' : 'expired';
  } else state = today > p.valid_till ? 'expired' : 'active';
  // F/H per stamp (blank size = an older stamp, counted as Full). Any Half among the counted stamps makes
  // the free meal a Half; the customer can pay the difference at the cart for a Full.
  const sizes = st.slice(0, R.stamps).map(x => String(x.size) === 'Half' ? 'H' : 'F');
  return { pass_id: p.pass_id, customer_id: p.customer_id, code: p.code, issued: p.issued_date, valid_till: p.valid_till, claim_till: claimTill,
    stamps: Math.min(n, R.stamps), need: R.stamps, state, redeemed_at: p.redeemed_at || '', stampList: st, sizes, free_size: sizes.indexOf('H') >= 0 ? 'Half' : 'Full' };
}

// Card summary for a customer: the pass being filled, free meals waiting, and how many stamps are left today.
function customerCard(c, D, R, today) {
  const views = D.passes.filter(p => p.customer_id === c.customer_id).map(p => passView(p, D, R, today));
  const active = views.find(v => v.state === 'active') || null;
  const ready = views.filter(v => v.state === 'ready');
  const usedToday = D.stamps.filter(x => x.customer_id === c.customer_id && x.date === today).length;
  return { views, active, ready, usedToday, capLeft: Math.max(0, R.cap - usedToday) };
}

function partnerSafe(c, card, R) {
  return { cid: c.customer_id, name: c.name || '', masked: maskPhone(c.phone), blocked: truthy(c.blocked),
    stamps: card.active ? card.active.stamps : 0, need: R.stamps, valid_till: card.active ? card.active.valid_till : '', sizes: card.active ? card.active.sizes : [],
    ready: card.ready.map(v => ({ pass_id: v.pass_id, claim_till: v.claim_till, free_size: v.free_size, sizes: v.sizes })), capLeft: card.capLeft };
}

// The QR on a customer's card is their card link (pedalplate.in/club#<key>). Scanning it finds them.
function cardKey(v) { const m = String(v || '').match(/([a-f0-9]{32,48})\s*$/i); return m ? m[1].toLowerCase() : ''; }

function clubFind(req, s) {
  const R = clubRules(), today = dateKey(new Date()), D = clubLoad();
  if (req.card != null) {
    const k = cardKey(req.card);
    const c = k ? D.customers.find(x => !x.deleted_at && x.card_token === k) : null;
    if (!c) fail('This is not a Pedal Club card, or it was replaced. Type the number instead.');
    return { matches: [Object.assign(partnerSafe(c, customerCard(c, D, R, today), R), { scanned: true })], isNew: false, club_on: R.on };
  }
  const q = String(req.q || '').replace(/\D/g, '');
  if (q.length === 4) {
    const list = D.customers.filter(c => !c.deleted_at && c.phone && c.phone.slice(-4) === q).slice(0, 5);
    return { matches: list.map(c => partnerSafe(c, customerCard(c, D, R, today), R)), isNew: false, club_on: R.on };
  }
  const phone = normPhone(q);
  if (!phone) fail('Type the 10-digit number, or the last 4 digits for a regular.');
  const c = findCustomer(D, phone);
  if (!c) return { matches: [], isNew: true, masked: maskPhone(phone), club_on: R.on };
  return { matches: [partnerSafe(c, customerCard(c, D, R, today), R)], isNew: false, club_on: R.on };
}

// Add stamps to a customer's card, starting a new card whenever the current one is full or missing.
// saleIds: sale ids, or {sale_id, size} for plates (size Full or Half; a plain id is a Full stamp).
function addStamps(c, D, R, today, saleIds, partnerId, partnerName, cartId) {
  const card0 = customerCard(c, D, R, today);
  let active = card0.active, given = 0, newPass = false;
  const newStamps = [];
  saleIds.forEach((sid, i) => {
    if (!active || active.stamps >= R.stamps) {
      const p = { pass_id: newId('PS'), customer_id: c.customer_id, code: newCode(), issued_date: today, issued_at: new Date().toISOString(),
        valid_till: addDaysKey(today, R.days - 1), status: 'open', redeemed_at: '', redeem_sale_id: '', redeemed_by: '', issued_by: partnerName, flag_ok: '' };
      append('Passes', p); D.passes.push(p); newPass = true;
      active = { pass_id: p.pass_id, stamps: 0 };
    }
    const u = typeof sid === 'object' && sid ? sid : { sale_id: sid, size: 'Full' };
    const st = { stamp_id: newId('ST'), pass_id: active.pass_id, customer_id: c.customer_id, sale_id: String(u.sale_id), date: today, created_at: new Date(Date.now() + i).toISOString(),
      partner_id: String(partnerId), partner_name: partnerName, cart_id: cartId || '', status: 'ok', void_by: '', void_at: '', size: u.size === 'Half' ? 'Half' : 'Full' };
    newStamps.push(st); D.stamps.push(st); active.stamps++; given++;
  });
  appendMany('Stamps', newStamps);
  return { given, newPass };
}

// Founder fallback: add stamps by hand (no signal at the cart, a partner forgot, a customer's complaint).
// Needs a reason, ignores the daily limit, and is logged. The stamp shows "by hand" in the history.
function clubManual(req, s) {
  const R = clubRules(), today = dateKey(new Date());
  const n = Math.round(Number(req.stamps));
  const reason = String(req.reason || '').trim().slice(0, 120);
  if (!(n >= 1 && n <= R.stamps)) fail('Add between 1 and ' + R.stamps + ' stamps.');
  if (reason.length < 3) fail('Write why you are adding these stamps.');
  let out = null, phoneMasked = '';
  withLock(() => {
    const D = clubLoad();
    let c = null;
    if (req.cid) c = D.customers.find(x => x.customer_id === String(req.cid) && !x.deleted_at);
    else {
      const phone = normPhone(req.phone);
      if (!phone) fail('Type a valid 10-digit mobile number.');
      c = findCustomer(D, phone);
      if (!c) {
        if (req.consent !== true) fail('Tick the box once the customer has agreed to us saving their number.');
        c = { customer_id: newId('CU'), phone, name: String(req.name || '').trim().slice(0, 40), card_token: Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8),
          consent_at: new Date().toISOString(), consent_by: s.partner.name, created_at: new Date().toISOString(), blocked: '', blocked_by: '', deleted_at: '', flag_ok: '', verified: 'yes' };
        append('Customers', c); D.customers.push(c);
      }
    }
    if (!c) fail('Customer not found.');
    if (truthy(c.blocked)) fail('This number is on hold. Lift the hold first.');
    confirmCard(c);   // the founder sends the card link to their WhatsApp
    const ids = []; for (let i = 0; i < n; i++) ids.push('manual');
    const r = addStamps(c, D, R, today, ids, s.partner.partner_id, s.partner.name + ' (by hand)', '');
    const card = customerCard(c, D, R, today);
    phoneMasked = maskPhone(c.phone);
    out = { given: r.given, newPass: r.newPass, stamps: card.active ? card.active.stamps : 0, need: R.stamps, ready: card.ready.length,
      link: R.site + '/club#' + c.card_token, wa_phone: '91' + c.phone, name: c.name || '', cid: c.customer_id };
  });
  logAction(s.partner.name, 'club: stamps by hand', phoneMasked + ' +' + n + ' · ' + reason);
  return out;
}

// Join online (public form at pedalplate.in/club). This only saves the name, number and consent:
// the card link still goes to that WhatsApp number with the first bill at the cart, which proves
// the number is theirs. The reply is the same whether or not the number was already in, so the form
// can't be used to check who is a member.
function clubJoin(req) {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get('club_joins') || 0);
  if (n >= 60) fail('Lots of people are joining right now. Please try again in a few minutes.');
  if (String(req.website || '') !== '') return { joined: true };   // hidden field: filled only by bots
  const phone = normPhone(req.phone);
  if (!phone) fail('Type your 10-digit WhatsApp number.');
  if (req.consent !== true) fail('Tick the box so we can save your number.');
  const name = String(req.name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!name) fail('Type your name.');
  cache.put('club_joins', String(n + 1), 3600);
  let added = false, out = null;
  withLock(() => {
    const D = clubLoad();
    const c = findCustomer(D, phone);
    if (c && isConfirmed(c)) { out = { joined: true, member: true }; return; }   // their card is in their WhatsApp bill
    if (c) {   // joined online before but never came to the cart: a fresh welcome card (the old online link stops working)
      const token = newToken();
      updateWhere('Customers', r => String(r.customer_id) === c.customer_id, c.name ? { card_token: token } : { card_token: token, name });
      out = { joined: true, link: clubRules().site + '/club#' + token }; return;
    }
    const token = newToken();
    append('Customers', { customer_id: newId('CU'), phone, name, card_token: token,
      consent_at: new Date().toISOString(), consent_by: 'website', created_at: new Date().toISOString(), blocked: '', blocked_by: '', deleted_at: '', flag_ok: '', verified: '' });
    added = true; out = { joined: true, link: clubRules().site + '/club#' + token };
  });
  if (added) logAction('Website', 'club: joined online', maskPhone(phone));
  return out;
}

// A number joined online is not proven to be the customer's. Its welcome card can be scanned at the
// cart, but the first WhatsApp bill (sent to that number) replaces the card link, and only that link
// is used from then on. So someone who joins with another person's number never sees their stamps.
function newToken() { return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8); }
function isConfirmed(c) { return c.consent_by !== 'website' || truthy(c.verified); }
function confirmCard(c) {
  if (isConfirmed(c)) return;
  c.card_token = newToken(); c.verified = 'yes';
  updateWhere('Customers', r => String(r.customer_id) === c.customer_id, { card_token: c.card_token, verified: 'yes' });
}

// When the daily stamp limit cuts an order short, Full plates get their stamps first.
function fullFirst(units) { const f = units.filter(u => u.size !== 'Half'), h = units.filter(u => u.size === 'Half'); units.length = 0; f.concat(h).forEach(u => units.push(u)); return units; }

function newCode() { let c; do { c = String(Math.floor(Math.random() * 10000)).padStart(4, '0'); } while (/^(\d)\1+$/.test(c)); return c; }

// Send a bill for some of this partner's sales, and add Pedal Club stamps if the customer is in.
function clubBill(req, s) {
  const R = clubRules(), today = dateKey(new Date());
  const ids = (Array.isArray(req.sale_ids) ? req.sale_ids : []).map(String).filter(Boolean).slice(0, 50);
  if (!ids.length) fail('Choose the plates for this bill.');
  const wantStamps = req.stamp !== false;
  let out = null, logNew = null;
  withLock(() => {
    const D = clubLoad();
    // customer
    let c = null, isNew = false;
    if (req.cid) { c = D.customers.find(x => x.customer_id === String(req.cid) && !x.deleted_at); if (!c) fail('Customer not found. Type the number again.'); }
    else {
      const phone = normPhone(req.phone);
      if (!phone) fail('Type a valid 10-digit mobile number.');
      c = findCustomer(D, phone);
      if (!c) {
        if (req.consent !== true) fail('Ask the customer if we can save their number, then tick the box.');
        c = { customer_id: newId('CU'), phone, name: String(req.name || '').trim().slice(0, 40), card_token: Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8),
          consent_at: new Date().toISOString(), consent_by: s.partner.name, created_at: new Date().toISOString(), blocked: '', blocked_by: '', deleted_at: '', flag_ok: '', verified: 'yes' };
        append('Customers', c); D.customers.push(c); isNew = true; logNew = c;
      } else if (!c.name && req.name) {
        c.name = String(req.name).trim().slice(0, 40);
        updateWhere('Customers', r => String(r.customer_id) === c.customer_id, { name: c.name });
      }
    }
    // sales
    const all = rowsTail('Sales', 6000); const byId = {}; all.forEach(r => byId[String(r.sale_id)] = r);
    const missing = ids.filter(id => !byId[id]);
    if (missing.length) fail(missing.length + (missing.length > 1 ? ' plates have' : ' plate has') + " not reached the Sheet yet. Wait for signal and try again.");
    const sales = ids.map(id => byId[id]).filter(r => r.status !== 'void' && String(r.partner_id) === String(s.partner.partner_id));
    if (!sales.length) fail('These plates are not yours or were cancelled.');
    const stamped = new Set(D.stamps.map(x => x.sale_id));
    const skip = { excluded: 0, old: 0, already: 0, free: 0, cap: 0, off: 0, blocked: 0 };
    const units = [];
    sales.forEach(r => {
      const q = Math.max(1, Number(r.qty) || 1), ot = r.order_type || 'walkin';
      const age = (Date.now() - new Date(r.created_at).getTime()) / 60000;
      if (r.pay === 'Free') skip.free += q;
      else if (ot !== 'walkin') skip.excluded += q;
      else if (stamped.has(String(r.sale_id))) skip.already += q;
      else if (r.date !== today || age > R.minutes) skip.old += q;
      else if (!isPlate(r)) { /* extras and top-ups: no stamps */ }
      else for (let i = 0; i < q; i++) units.push({ sale_id: String(r.sale_id), size: r.size === 'Half' ? 'Half' : 'Full' });
    });
    fullFirst(units);
    let given = 0, newPass = false;
    const card0 = customerCard(c, D, R, today);
    if (units.length && !wantStamps) { /* bill only */ }
    else if (units.length && !R.on) skip.off += units.length;
    else if (units.length && truthy(c.blocked)) skip.blocked += units.length;
    else if (units.length) {
      const allowed = Math.min(units.length, card0.capLeft);
      skip.cap += units.length - allowed;
      const r = addStamps(c, D, R, today, units.slice(0, allowed), s.partner.partner_id, s.partner.name, s.cart_id);
      given = r.given; newPass = r.newPass;
    }
    // bill
    const billsToday = rows('Bills').filter(b => b.date === today).length;
    const billNo = 'PP' + today.replace(/-/g, '').slice(2) + '-' + String(billsToday + 1).padStart(3, '0');
    const lines = {}; const pay = { Cash: 0, UPI: 0 }; let total = 0, freeLines = 0;
    sales.forEach(r => {
      const k = r.item_name + '|' + r.size + '|' + (r.pay === 'Free' ? 'free' : Number(r.price));
      const l = lines[k] = lines[k] || { name: r.item_name, size: r.size, qty: 0, price: r.pay === 'Free' ? 0 : Number(r.price), amount: 0, free: r.pay === 'Free' };
      const a = r.pay === 'Free' ? 0 : Number(r.amount) || 0;
      l.qty += Number(r.qty) || 1; l.amount += a; total += a; if (r.pay === 'Free') freeLines++;
      if (r.pay === 'UPI') pay.UPI += a; else if (r.pay === 'Cash') pay.Cash += a;
    });
    confirmCard(c);   // the bill goes to this WhatsApp number, so its link becomes the real card
    const card = customerCard(c, D, R, today);
    append('Bills', { bill_no: billNo, created_at: new Date().toISOString(), date: today, partner_id: String(s.partner.partner_id), partner_name: s.partner.name,
      cart_id: s.cart_id, customer_id: c.customer_id, sale_ids: sales.map(r => r.sale_id).join(','), amount: total, stamps: given, pass_id: card.active ? card.active.pass_id : '' });
    out = {
      bill: { no: billNo, at: new Date().toISOString(), cart_id: s.cart_id, lines: Object.keys(lines).map(k => lines[k]), total, pay },
      club: { on: R.on, given, newPass, skip, need: R.stamps, stamps: card.active ? card.active.stamps : 0, valid_till: card.active ? card.active.valid_till : '',
        ready: card.ready.map(v => ({ claim_till: v.claim_till })), blocked: truthy(c.blocked), link: R.site + '/club#' + c.card_token },
      customer: { cid: c.customer_id, name: c.name || '', masked: maskPhone(c.phone), isNew },
      wa_phone: '91' + c.phone, footer: R.footer,
    };
  });
  if (logNew) logAction(s.partner.name, 'club: new customer', maskPhone(logNew.phone));
  return out;
}

function clubRedeem(req, s) {
  const today = dateKey(new Date()), R = clubRules();
  const cache = CacheService.getScriptCache();
  let out = null, lockout = null;
  withLock(() => {
    const D = clubLoad();
    const c = D.customers.find(x => x.customer_id === String(req.cid || '') && !x.deleted_at);
    if (!c) fail('Customer not found. Type the number again.');
    if (truthy(c.blocked)) fail('Pedal Club is on hold for this number. Ask a founder.');
    const key = 'club_code_' + c.customer_id;
    const wrong = Number(cache.get(key) || 0);
    if (wrong >= 5) fail('Too many wrong codes for this number. Try again later or ask a founder.');
    const ready = D.passes.filter(p => p.customer_id === c.customer_id).map(p => passView(p, D, R, today)).filter(v => v.state === 'ready');
    if (!ready.length) fail('No free meal is ready on this number.');
    const code = padCode(req.code);
    const override = req.override === true && s.partner.role === 'founder';
    const scanned = !override && req.card != null && cardKey(req.card) !== '' && cardKey(req.card) === c.card_token;   // scanning their card counts as the code
    if (req.card != null && !scanned && !override) fail('That card belongs to someone else. Scan the right card or type the code.');
    if (req.override === true && !override) fail('Only founders can give a free meal without the code.');
    if (override && String(req.reason || '').trim().length < 3) fail('Write why the code is not available.');
    const pv = override || scanned ? ready[0] : ready.find(v => v.code === code && String(req.code || '').replace(/\D/g, '').length === 4);
    if (!pv) {
      cache.put(key, String(wrong + 1), 21600);
      if (wrong + 1 >= 5) lockout = maskPhone(c.phone);
      fail("That code doesn't match. Ask the customer to open their Pedal Club card and read the 4-digit code.");
    }
    const item = getConfig().menu.find(m => String(m.item_id) === String(req.item_id || ''));
    if (!item) fail("Choose one of today's combos.");
    const size = item.sizes.slice().sort((a, b) => b.price - a.price)[0];
    const sale = { sale_id: newId('CLUB'), created_at: new Date().toISOString(), date: today, partner_id: s.partner.partner_id, partner_name: s.partner.name,
      cart_id: s.cart_id, item_id: item.item_id, item_name: item.name, size: size.size, price: 0, qty: 1, amount: 0, pay: 'Free', source: 'club',
      status: 'ok', void_by: '', void_at: '', order_type: 'walkin', ref: 'club:' + pv.pass_id };
    append('Sales', sale);
    updateWhere('Passes', r => String(r.pass_id) === pv.pass_id, { status: 'redeemed', redeemed_at: sale.created_at, redeem_sale_id: sale.sale_id, redeemed_by: s.partner.name });
    cache.remove(key);
    out = { sale: { sale_id: sale.sale_id, item_name: item.name, size: size.size, value: size.price }, customer: { name: c.name || '', masked: maskPhone(c.phone) } };
  }, () => { if (lockout) logAction(s.partner.name, 'club: code lockout', lockout); });
  logAction(s.partner.name, req.override === true ? 'club: free meal without code' : 'club: free meal', out.customer.masked + ' · ' + out.sale.item_name + (req.override === true ? ' · ' + String(req.reason || '').trim().slice(0, 120) : ''));
  return out;
}

// Called inside the lock when a sale is voided.
function clubAfterVoid(saleId, ref, by) {
  const now = new Date().toISOString();
  const sh = SpreadsheetApp.getActive().getSheetByName('Stamps');
  if (sh && sh.getLastRow() > 1) {
    const data = sh.getDataRange().getValues(), h = data[0], c = k => h.indexOf(k);
    for (let i = 1; i < data.length; i++) if (String(data[i][c('sale_id')]) === saleId && data[i][c('status')] !== 'void')
      sh.getRange(i + 1, c('status') + 1, 1, 3).setValues([['void', by, now]]);
  }
  if (ref.indexOf('club:') === 0) updateWhere('Passes', r => String(r.pass_id) === ref.slice(5), { status: 'open', redeemed_at: '', redeem_sale_id: '', redeemed_by: '' });
}

// The customer's own card (public: the long token in their link is the key).
function clubCard(req) {
  const t = String(req.t || '');
  const cache = CacheService.getScriptCache();
  const bad = Number(cache.get('club_bad_tokens') || 0);
  if (bad > 300) fail('Too many requests. Try again in a few minutes.');
  if (!/^[a-f0-9]{32,48}$/i.test(t)) { cache.put('club_bad_tokens', String(bad + 1), 900); fail('This card link is not complete. Open the link from your WhatsApp bill.'); }
  if (!rows('Customers').some(x => x.card_token === t && !x.deleted_at)) { cache.put('club_bad_tokens', String(bad + 1), 900); fail('This card link has changed or was removed. Open the latest link from your WhatsApp bill, or join again.'); }
  const R = clubRules(), today = dateKey(new Date()), D = clubLoad();
  const c = D.customers.find(x => x.card_token === t && !x.deleted_at);
  if (!c) { cache.put('club_bad_tokens', String(bad + 1), 900); fail('This card link has changed or was removed. Open the latest link from your WhatsApp bill, or join again.'); }
  const card = customerCard(c, D, R, today);
  const recent = card.views.filter(v => v.state === 'active' || v.state === 'ready' || daysBetween(v.valid_till, today) <= 30).sort((a, b) => a.issued < b.issued ? 1 : -1);
  return {
    name: String(c.name || '').split(' ')[0], masked: maskPhone(c.phone), blocked: truthy(c.blocked), today, confirmed: isConfirmed(c),
    rules: { stamps: R.stamps, days: R.days, cap: R.cap, grace: R.grace, on: R.on },
    passes: recent.map(v => ({ code: v.state === 'active' || v.state === 'ready' ? v.code : '', issued: v.issued, valid_till: v.valid_till, claim_till: v.claim_till,
      stamps: v.stamps, need: v.need, state: v.state, redeemed_at: v.redeemed_at, dates: v.stampList.map(x => x.date), sizes: v.sizes, free_size: v.free_size })),
  };
}

/* founder screens */
function clubOverview(req) {
  const R = clubRules(), today = dateKey(new Date()), D = clubLoad();
  const live = D.customers.filter(c => !c.deleted_at);
  const views = D.passes.map(p => passView(p, D, R, today));
  const weekAgo = addDaysKey(today, -6), monthStart = today.slice(0, 8) + '01';
  const freeSales = rows('Sales').filter(r => r.pay === 'Free' && r.status !== 'void');
  const menuIdx = getMenuIndex();
  const valueOf = r => { const m = menuIdx[r.item_id + '|' + r.size]; return m ? Number(m.price) || 0 : 0; };
  const freeMonth = freeSales.filter(r => r.date >= monthStart);
  const stampsWeek = D.stamps.filter(x => x.date >= weekAgo);
  // flags
  const flags = [];
  const partnerPhones = {}; rows('Partners').forEach(p => { const ph = normPhone(p.phone); if (ph) partnerPhones[ph] = p.name; });
  live.forEach(c => { if (partnerPhones[c.phone] && !truthy(c.flag_ok) && D.stamps.some(x => x.customer_id === c.customer_id))
    flags.push({ kind: 'customer', id: c.customer_id, cid: c.customer_id, title: 'Number belongs to partner ' + partnerPhones[c.phone], who: maskPhone(c.phone) }); });
  views.forEach(v => {
    const p = D.passes.find(x => x.pass_id === v.pass_id);
    if (truthy(p.flag_ok)) return;
    const c = D.customers.find(x => x.customer_id === v.customer_id) || {};
    if (v.stamps >= R.stamps) {
      const days = daysBetween(v.stampList[0].date, v.stampList[R.stamps - 1].date) + 1;
      const byPartner = {}; v.stampList.forEach(x => byPartner[x.partner_name] = (byPartner[x.partner_name] || 0) + 1);
      const top = Object.keys(byPartner).sort((a, b) => byPartner[b] - byPartner[a])[0];
      if (days <= Math.ceil(R.stamps / R.cap) + 1) flags.push({ kind: 'pass', id: v.pass_id, cid: v.customer_id, title: 'Filled ' + R.stamps + ' stamps in ' + days + ' days (' + byPartner[top] + ' from ' + top + ')', who: (c.name || '') + ' ' + maskPhone(c.phone) });
    }
    if (v.state === 'redeemed' && v.stamps < R.stamps) flags.push({ kind: 'pass', id: v.pass_id, cid: v.customer_id, title: 'Free meal given, then a stamped sale was cancelled (' + v.stamps + '/' + R.stamps + ')', who: (c.name || '') + ' ' + maskPhone(c.phone) });
  });
  const burst = {}; live.forEach(c => { if (c.created_at && String(c.created_at).slice(0, 10) >= weekAgo) { const k = dateKey(new Date(c.created_at)) + '|' + c.consent_by; burst[k] = (burst[k] || 0) + 1; } });
  Object.keys(burst).forEach(k => { if (burst[k] >= R.newFlag) { const [d, who] = k.split('|'); flags.push({ kind: 'info', id: k, title: who + ' added ' + burst[k] + ' new customers on ' + d, who: '' }); } });
  rowsTail('Log', 300).filter(l => (l.action === 'club: stamps by hand' || l.action === 'club: free meal without code') && String(l.at).slice(0, 10) >= weekAgo)
    .forEach(l => flags.push({ kind: 'info', id: l.at, title: (l.action === 'club: stamps by hand' ? 'Stamps added by hand by ' : 'Free meal without code by ') + l.by + ': ' + l.details, who: '' }));
  rowsTail('Log', 300).filter(l => l.action === 'club: code lockout' && String(l.at).slice(0, 10) >= weekAgo)
    .forEach(l => flags.push({ kind: 'info', id: l.at, title: 'Five wrong free-meal codes for ' + l.details + ' (tried by ' + l.by + ')', who: '' }));
  return {
    rules: R, today,
    kpis: { members: live.length, newWeek: live.filter(c => String(c.created_at).slice(0, 10) >= weekAgo).length,
      activeCards: views.filter(v => v.state === 'active').length, readyNow: views.filter(v => v.state === 'ready').length,
      stampsWeek: stampsWeek.length, freeMonth: freeMonth.length, freeMonthValue: freeMonth.reduce((n, r) => n + valueOf(r), 0),
      billsWeek: rows('Bills').filter(b => b.date >= weekAgo).length },
    flags,
  };
}

function clubCustomer(req) {
  const R = clubRules(), today = dateKey(new Date()), D = clubLoad();
  const raw = String(req.q || '').trim(), q = raw.replace(/\D/g, '');
  let list;
  if (req.cid) list = D.customers.filter(c => c.customer_id === String(req.cid));
  else if (q.length >= 4) list = D.customers.filter(c => !c.deleted_at && c.phone.indexOf(q.length === 10 ? normPhone(q) || q : q) >= 0);
  else if (raw.length >= 2) list = D.customers.filter(c => !c.deleted_at && String(c.name).toLowerCase().indexOf(raw.toLowerCase()) >= 0);
  else fail('Type at least 4 digits of the number, or 2 letters of the name.');
  const bills = rows('Bills');
  return { customers: list.slice(0, 10).map(c => {
    const card = customerCard(c, D, R, today);
    return { cid: c.customer_id, name: c.name || '', phone: c.phone, created_at: c.created_at, consent_by: c.consent_by, blocked: truthy(c.blocked), deleted: !!c.deleted_at,
      link: c.card_token ? R.site + '/club#' + c.card_token : '', bills: bills.filter(b => String(b.customer_id) === c.customer_id).length,
      passes: card.views.sort((a, b) => a.issued < b.issued ? 1 : -1).map(v => ({ pass_id: v.pass_id, code: v.code, issued: v.issued, valid_till: v.valid_till, claim_till: v.claim_till,
        stamps: v.stamps, need: v.need, state: v.state, redeemed_at: v.redeemed_at,
        free_size: v.free_size, stampList: v.stampList.map(x => ({ stamp_id: x.stamp_id, date: x.date, partner: x.partner_name, cart: x.cart_id, sale_id: x.sale_id, size: String(x.size) === 'Half' ? 'Half' : 'Full' })) })) };
  }) };
}

function clubVoidStamp(req, s) {
  let found = null;
  withLock(() => { found = updateWhere('Stamps', r => String(r.stamp_id) === String(req.stamp_id || '') && r.status !== 'void', { status: 'void', void_by: s.partner.name, void_at: new Date().toISOString() }); });
  if (!found) fail('Stamp not found or already removed.');
  logAction(s.partner.name, 'club: removed stamp', found.stamp_id + ' (sale ' + found.sale_id + ', by ' + found.partner_name + ')');
  return {};
}

function clubBlock(req, s) {
  let c = null; const on = req.blocked === true;
  withLock(() => { c = updateWhere('Customers', r => String(r.customer_id) === String(req.cid || ''), { blocked: on ? 'yes' : '', blocked_by: on ? s.partner.name : '' }); });
  if (!c) fail('Customer not found.');
  logAction(s.partner.name, on ? 'club: hold' : 'club: hold lifted', maskPhone(normPhone(c.phone)));
  return {};
}

// Delete a customer's personal data (they asked us to). Stamps and bills stay, without the number.
function clubForget(req, s) {
  let c = null;
  withLock(() => { c = updateWhere('Customers', r => String(r.customer_id) === String(req.cid || '') && !r.deleted_at, { phone: '', name: '', card_token: '', deleted_at: new Date().toISOString() }); });
  if (!c) fail('Customer not found or already deleted.');
  logAction(s.partner.name, 'club: deleted customer data', String(c.customer_id));
  return {};
}

function clubUndoRedeem(req, s) {
  let p = null;
  withLock(() => {
    p = rows('Passes').find(r => String(r.pass_id) === String(req.pass_id || '') && r.status === 'redeemed');
    if (!p) fail('That free meal was not found.');
    updateWhere('Sales', r => String(r.sale_id) === String(p.redeem_sale_id), { status: 'void', void_by: s.partner.name, void_at: new Date().toISOString() });
    updateWhere('Passes', r => String(r.pass_id) === String(p.pass_id), { status: 'open', redeemed_at: '', redeem_sale_id: '', redeemed_by: '' });
  });
  logAction(s.partner.name, 'club: free meal cancelled', String(p.pass_id));
  return {};
}

function clubFlagOk(req, s) {
  const tab = req.kind === 'customer' ? 'Customers' : 'Passes', key = req.kind === 'customer' ? 'customer_id' : 'pass_id';
  let r = null;
  withLock(() => { r = updateWhere(tab, x => String(x[key]) === String(req.id || ''), { flag_ok: 'yes' }); });
  if (!r) fail('Not found.');
  logAction(s.partner.name, 'club: flag checked', String(req.id));
  return {};
}

/* ----- One order, saved whole -----
   The rider's phone sends each order as one package: plates, Cash/UPI, the customer (scanned card,
   known customer or typed number), a free meal, and whether to add stamps. The server saves it all in
   one step: plates, free meal, stamps and the bill. Sending the same order again (weak signal) returns
   the same answer and adds nothing. Orders made without signal arrive later: stamps follow the time of
   the order (daily limit counted for that day); orders more than 2 days old get no stamps.
   A sale is never lost because of a customer problem: an unknown card or missing consent only means
   no stamps and no bill. A free meal that can't be given stops the whole order (the phone only sends
   free meals with signal, so the rider sees it at once). */
function orderSave(req, s) {
  const o = req.order || {};
  const oid = String(o.order_id || '').replace(/[^\w-]/g, '').slice(0, 60);
  if (!oid) fail('Missing order id.');
  const R = clubRules(), today = dateKey(new Date());
  const t0 = o.created_at ? new Date(o.created_at) : new Date();
  const at = isNaN(t0) ? new Date() : new Date(Math.min(Date.now(), t0.getTime()));
  const day = dateKey(at);
  const pay = o.pay === 'UPI' ? 'UPI' : o.pay === 'Cash' ? 'Cash' : '';
  if (!pay) fail('Choose Cash or UPI.');
  const lines = (Array.isArray(o.lines) ? o.lines : []).map(l => ({ size: String(l.size || '').slice(0, 12), qty: Math.max(0, Math.min(500, Math.round(Number(l.qty) || 0))) })).filter(l => l.qty > 0);
  // Extras (optional, newer phones): [{item_id, qty}]. Sold alone or with plates; no stamps.
  const extrasIn = (Array.isArray(o.extras) ? o.extras : []).map(x => ({ item_id: String(x.item_id || '').slice(0, 40), qty: Math.max(0, Math.min(500, Math.round(Number(x.qty) || 0))) })).filter(x => x.qty > 0);
  if (!lines.length && !extrasIn.length) fail('Add at least one plate.');
  const menu = getMenuIndex();
  lines.forEach(l => { if (!menu[o.item_id + '|' + l.size] || isExtraType(menu[o.item_id + '|' + l.size].type)) fail('That combo or plate size is not on the menu.'); });
  extrasIn.forEach(x => { if (!menu[x.item_id + '|Extra']) fail('That extra is not on the menu.'); });
  const cache = CacheService.getScriptCache();
  let extra = { skip: { excluded: 0, old: 0, already: 0, free: 0, cap: 0, off: 0, blocked: 0 }, newPass: false, isNew: false, note: '' };
  let lockout = null, logNew = null, freeLog = null;
  withLock(() => {
    if (rowsTail('Sales', 6000).some(r => String(r.order_id) === oid)) { extra = null; return; }   // already saved
    const D = clubLoad();
    // customer
    let c = null, billOnly = '';
    if (o.cust && o.cust.card != null) {
      const k = cardKey(o.cust.card); c = k ? D.customers.find(x => !x.deleted_at && x.card_token === k) || null : null;
      if (!c) extra.note = 'card_unknown';
    } else if (o.cust && o.cust.cid) {
      c = D.customers.find(x => x.customer_id === String(o.cust.cid) && !x.deleted_at) || null;
      if (!c) extra.note = 'customer_unknown';
    } else if (o.cust && o.cust.phone != null) {
      const phone = normPhone(o.cust.phone);
      c = phone ? findCustomer(D, phone) : null;
      if (!c && phone && o.cust.consent === true) {
        c = { customer_id: newId('CU'), phone, name: String(o.cust.name || '').trim().slice(0, 40), card_token: newToken(), consent_at: at.toISOString(), consent_by: s.partner.name,
          created_at: new Date().toISOString(), blocked: '', blocked_by: '', deleted_at: '', flag_ok: '', verified: 'yes' };
        append('Customers', c); D.customers.push(c); extra.isNew = true; logNew = c;
      } else if (!c && phone && o.cust.bill_only === true) billOnly = phone;   // bill only: no member, number not saved
      else if (c && !c.name && o.cust.name) { c.name = String(o.cust.name).trim().slice(0, 40); updateWhere('Customers', r => String(r.customer_id) === c.customer_id, { name: c.name }); }
      else if (!c) extra.note = phone ? 'needs_consent' : 'bad_number';
    }
    // free meal (needs the customer, a ready card and proof: their scanned card, the code, or a founder's reason)
    const sizes = Object.keys(menu).filter(k => k.indexOf(o.item_id + '|') === 0 && !isExtraType(menu[k].type)).map(k => menu[k]).sort((a, b) => Number(b.price) - Number(a.price));
    const top = sizes[0] || { size: 'Full', price: 0, name: '' }, half = sizes.find(z => String(z.size) === 'Half') || null;
    let pv = null, freeSize = '', useSize = '', topup = 0;
    if (o.free) {
      if (!c) fail('The free meal needs the customer. Scan their card or type their number.');
      if (truthy(c.blocked)) fail('Pedal Club is on hold for this number. Ask a founder.');
      const key = 'club_code_' + c.customer_id, wrong = Number(cache.get(key) || 0);
      if (wrong >= 5) fail('Too many wrong codes for this number. Try again later or ask a founder.');
      const ready = D.passes.filter(p => p.customer_id === c.customer_id).map(p => passView(p, D, R, today)).filter(v => v.state === 'ready');
      if (!ready.length) fail('No free meal is ready on this number.');
      if (!lines.some(l => l.size === String(top.size || 'Full') || (half && l.size === 'Half'))) fail('Add a ' + (top.size || 'Full') + ' plate for the free meal.');
      const override = o.free.override === true && s.partner.role === 'founder';
      if (o.free.override === true && !override) fail('Only founders can give a free meal without the code.');
      if (override && String(o.free.reason || '').trim().length < 3) fail('Write why the code is not available.');
      const scanned = !override && o.cust && o.cust.card != null && cardKey(o.cust.card) === c.card_token;
      pv = override || scanned ? ready[0] : ready.find(v => v.code === padCode(o.free.code) && String(o.free.code || '').replace(/\D/g, '').length === 4) || null;
      if (!pv) { cache.put(key, String(wrong + 1), 21600); if (wrong + 1 >= 5) lockout = maskPhone(c.phone); fail("That code doesn't match. Ask the customer to open their Pedal Club card and read the 4-digit code."); }
      cache.remove(key);
      // A card with a Half stamp gives a free Half; "upgrade" makes it a Full for the difference in price.
      // Phones from before this change don't send o.free.size: they get a free Full, as before.
      if (pv.free_size === 'Half' && half && o.free.size) {
        freeSize = 'Half';
        if (o.free.upgrade === true) { useSize = String(top.size); topup = Math.max(0, Number(top.price) - Number(half.price)); }
        else useSize = 'Half';
      } else { freeSize = String(top.size || 'Full'); useSize = freeSize; }
      if (!lines.some(l => l.size === useSize)) fail('Add a ' + useSize + ' plate for the free meal.');
      freeLog = maskPhone(c.phone) + ' · ' + top.name + (freeSize === 'Half' ? ' (Half' + (topup ? ', topped up to Full' : '') + ')' : '') + (override ? ' · ' + String(o.free.reason).trim().slice(0, 120) : '');
    }
    // plates, extras, free meal and top-up
    const base = { created_at: at.toISOString(), date: day, partner_id: s.partner.partner_id, partner_name: s.partner.name, cart_id: s.cart_id, item_id: o.item_id,
      status: 'ok', void_by: '', void_at: '', order_type: 'walkin', order_id: oid };
    const sales = [];
    lines.forEach(l => {
      const m = menu[o.item_id + '|' + l.size], q = l.qty - (pv && l.size === useSize ? 1 : 0);
      if (q > 0) sales.push(Object.assign({}, base, { sale_id: oid + '-' + l.size, item_name: m.name, size: l.size, price: Number(m.price), qty: q, amount: Number(m.price) * q, pay, source: 'tap', ref: '' }));
    });
    if (pv) sales.push(Object.assign({}, base, { sale_id: oid + '-free', item_name: top.name, size: freeSize, price: 0, qty: 1, amount: 0, pay: 'Free', source: 'club', ref: 'club:' + pv.pass_id }));
    if (pv && topup > 0) sales.push(Object.assign({}, base, { sale_id: oid + '-topup', item_name: top.name, size: 'Top-up', price: topup, qty: 1, amount: topup, pay, source: 'club', ref: 'topup:' + pv.pass_id }));
    extrasIn.forEach(x => { const m = menu[x.item_id + '|Extra'];
      sales.push(Object.assign({}, base, { sale_id: oid + '-x-' + x.item_id, item_id: x.item_id, item_name: m.name, size: 'Extra', price: Number(m.price), qty: x.qty, amount: Number(m.price) * x.qty, pay, source: 'tap', ref: '' })); });
    appendMany('Sales', sales);
    if (pv) updateWhere('Passes', r => String(r.pass_id) === pv.pass_id, { status: 'redeemed', redeemed_at: at.toISOString(), redeem_sale_id: oid + '-free', redeemed_by: s.partner.name });
    // stamps: one per paid walk-in plate, F or H (not extras or top-ups), on the order's own day, daily limit for that day (Full plates first)
    const paid = sales.filter(r => r.pay !== 'Free'), units = [];
    paid.filter(isPlate).forEach(r => { for (let i = 0; i < r.qty; i++) units.push({ sale_id: r.sale_id, size: r.size === 'Half' ? 'Half' : 'Full' }); });
    fullFirst(units);
    if (c && units.length) {
      if (o.stamp === false) { /* bill only */ }
      else if (!R.on) extra.skip.off = units.length;
      else if (truthy(c.blocked)) extra.skip.blocked = units.length;
      else if (daysBetween(day, today) > 2) extra.skip.old = units.length;
      else {
        const used = D.stamps.filter(x => x.customer_id === c.customer_id && x.date === day).length;
        const allowed = Math.max(0, Math.min(units.length, R.cap - used));
        extra.skip.cap = units.length - allowed;
        if (allowed) extra.newPass = addStamps(c, D, R, day, units.slice(0, allowed), s.partner.partner_id, s.partner.name, s.cart_id).newPass;
      }
    }
    // bill
    if (c || billOnly) {
      if (c) confirmCard(c);
      const billsToday = rows('Bills').filter(b => b.date === today).length;
      const total = paid.reduce((n, r) => n + r.amount, 0);
      append('Bills', { bill_no: 'PP' + today.replace(/-/g, '').slice(2) + '-' + String(billsToday + 1).padStart(3, '0'), created_at: new Date().toISOString(), date: today,
        partner_id: String(s.partner.partner_id), partner_name: s.partner.name, cart_id: s.cart_id, customer_id: c ? c.customer_id : '', sale_ids: sales.map(r => r.sale_id).join(','),
        amount: total, stamps: c ? units.length - extra.skip.cap - extra.skip.old - extra.skip.off - extra.skip.blocked - (o.stamp === false ? units.length : 0) : 0, pass_id: '', order_id: oid,
        bill_to: billOnly ? maskPhone(billOnly) : '' });
    }
  }, () => { if (lockout) logAction(s.partner.name, 'club: code lockout', lockout); });
  if (logNew) logAction(s.partner.name, 'club: new customer', maskPhone(logNew.phone));
  if (freeLog) logAction(s.partner.name, o.free && o.free.override === true ? 'club: free meal without code' : 'club: free meal', freeLog);
  return orderResult(oid, s, extra, o);
}

// The reply for an order (also for a repeat send): the saved plates, and the bill if there is a customer.
// A "bill only" bill has no customer row: its number comes from the order the phone sent (kept nowhere else).
function orderResult(oid, s, extra, o) {
  const R = clubRules(), today = dateKey(new Date());
  const sales = rowsTail('Sales', 6000).filter(r => String(r.order_id) === oid && r.status !== 'void');
  const ids = sales.map(r => String(r.sale_id));
  const out = { order_id: oid, saved: ids, repeat: !extra, note: extra ? extra.note : '' };
  const fr = sales.find(r => r.pay === 'Free');
  if (fr) { const m = getMenuIndex()[fr.item_id + '|' + fr.size]; out.free = { sale_id: String(fr.sale_id), item_name: fr.item_name, size: fr.size, value: m ? Number(m.price) : 0 }; }
  const bill = rows('Bills').find(b => String(b.order_id) === oid);
  if (!bill) return out;
  const D = clubLoad();
  const c = bill.customer_id === '' ? null : D.customers.find(x => x.customer_id === String(bill.customer_id));
  const onlyPhone = !c && bill.customer_id === '' && o && o.cust && o.cust.bill_only === true ? normPhone(o.cust.phone) : '';
  if (!c && !onlyPhone) return out;
  const lines = {}; const pay = { Cash: 0, UPI: 0 }; let total = 0;
  sales.forEach(r => {
    const free = r.pay === 'Free', k = r.item_name + '|' + r.size + '|' + (free ? 'free' : Number(r.price));
    const l = lines[k] = lines[k] || { name: r.item_name, size: r.size, qty: 0, price: free ? 0 : Number(r.price), amount: 0, free };
    const a = free ? 0 : Number(r.amount) || 0; l.qty += Number(r.qty) || 1; l.amount += a; total += a;
    if (r.pay === 'UPI') pay.UPI += a; else if (r.pay === 'Cash') pay.Cash += a;
  });
  const billOut = { no: String(bill.bill_no), at: sales.length ? sales[0].created_at : bill.created_at, cart_id: String(bill.cart_id), lines: Object.keys(lines).map(k => lines[k]), total, pay };
  const skip = extra ? extra.skip : { excluded: 0, old: 0, already: 0, free: 0, cap: 0, off: 0, blocked: 0 };
  if (!c) return Object.assign(out, {
    bill: billOut,
    club: { on: R.on, given: 0, newPass: false, skip, need: R.stamps, stamps: 0, valid_till: '', ready: [], blocked: false, link: '', billOnly: true },
    customer: { cid: '', name: '', masked: maskPhone(onlyPhone), isNew: false, billOnly: true },
    wa_phone: '91' + onlyPhone, footer: R.footer,
  });
  const card = customerCard(c, D, R, today);
  const given = D.stamps.filter(x => ids.indexOf(x.sale_id) >= 0).length;
  return Object.assign(out, {
    bill: billOut,
    club: { on: R.on, given, newPass: extra ? extra.newPass : false, skip, need: R.stamps, stamps: card.active ? card.active.stamps : 0, valid_till: card.active ? card.active.valid_till : '',
      sizes: card.active ? card.active.sizes : [], ready: card.ready.map(v => ({ claim_till: v.claim_till, free_size: v.free_size })), blocked: truthy(c.blocked), link: R.site + '/club#' + c.card_token },
    customer: { cid: c.customer_id, name: c.name || '', masked: maskPhone(c.phone), isNew: extra ? extra.isNew : false },
    wa_phone: '91' + c.phone, footer: R.footer,
  });
}

/* ---------- business helpers ---------- */

function getConfig() {
  const c = cached('config_v1', 60, buildConfig);
  c.date = dateKey(new Date());
  return c;
}
function buildConfig() {
  const items = {}, extras = [];
  rows('Menu').filter(r => truthy(r.active)).sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0)).forEach(r => {
    if (isExtraType(r.type)) { if (Number(r.price) > 0 && !extras.some(x => x.item_id === String(r.item_id))) extras.push({ item_id: String(r.item_id), name: r.name, price: Number(r.price), unit: String(r.unit || '').trim() }); return; }
    const it = items[r.item_id] = items[r.item_id] || { item_id: r.item_id, name: r.name, type: String(r.type).toLowerCase().indexOf('non') === 0 ? 'nonveg' : 'veg', sizes: [] };
    it.sizes.push({ size: r.size || 'Full', price: Number(r.price) });
  });
  const settings = {}; rows('Settings').forEach(r => settings[r.key] = r.value);
  delete settings.timezone;
  return {
    menu: Object.keys(items).map(k => items[k]), extras,
    carts: rows('Carts').filter(c => truthy(c.active)).map(c => ({ cart_id: String(c.cart_id), name: c.name || c.cart_id, float: Number(c.float) || 0 })),
    settings, date: dateKey(new Date()),
  };
}

function getMenuIndex() {
  const idx = {}; rows('Menu').forEach(r => idx[r.item_id + '|' + menuSize(r)] = r); return idx;
}

function todaysSales(d) {
  return rowsTail('Sales', 6000).filter(r => r.date === d && r.status !== 'void');
}

function totalsOf(list) {
  const t = { plates: 0, total: 0, cash: 0, upi: 0, manualPlates: 0, freePlates: 0, extras: 0, extrasTotal: 0 };
  list.forEach(r => {
    const q = Number(r.qty) || 0, a = r.pay === 'Free' ? 0 : (Number(r.amount) || (Number(r.price) * q));
    if (isPlate(r)) t.plates += q; else if (r.size === 'Extra') { t.extras += q; t.extrasTotal += a; }
    t.total += a;
    if (r.pay === 'Free') t.freePlates += q;
    else if (r.pay === 'UPI') t.upi += a; else t.cash += a;
    if (r.source === 'manual') t.manualPlates += q;
  });
  return t;
}

function publicPartner(p, cartOverride) {
  return { partner_id: String(p.partner_id), name: p.name, role: p.role === 'founder' ? 'founder' : 'partner',
    cart_id: String(cartOverride != null ? cartOverride : p.cart_id || ''), backup: truthy(p.backup), active: truthy(p.active), start_date: p.start_date || '' };
}

// Logins are remembered for a few hours so most requests skip the Sessions tab. The PIN salt is
// stored with them: a PIN reset or change makes the old logins stop at once.
function getSession(token) {
  if (!token) return null;
  const cache = CacheService.getScriptCache();
  const hit = cache.get('sess_' + token);
  let s = hit ? JSON.parse(hit) : null;
  if (!s) { const r = rows('Sessions').find(x => x.token === token); if (!r) return null; s = { token, partner_id: String(r.partner_id), cart_id: String(r.cart_id || ''), expires_at: r.expires_at }; }
  if (new Date(s.expires_at) < new Date()) return null;
  const p = partnersCached().find(r => String(r.partner_id) === String(s.partner_id));
  if (!p || !truthy(p.active)) return null;
  if (s.salt && s.salt !== p.salt) return null;
  if (!hit) rememberSession(s, p.salt);
  return { partner: p, cart_id: String(s.cart_id || p.cart_id || ''), expires_at: s.expires_at };
}
function rememberSession(s, salt) {
  const left = Math.floor((new Date(s.expires_at) - new Date()) / 1000);
  if (left > 0) try { CacheService.getScriptCache().put('sess_' + s.token, JSON.stringify({ token: s.token, partner_id: String(s.partner_id), cart_id: String(s.cart_id || ''), expires_at: s.expires_at, salt }), Math.min(21600, left)); } catch (e) {}
}
function partnersCached() { return cached('partners_v1', 60, () => rows('Partners')); }
function partnersChanged() { CacheService.getScriptCache().remove('partners_v1'); }

// Short-term memory shared by all requests (Apps Script cache). Changes made in the app clear it;
// edits typed straight into the Sheet show within a minute.
function cached(key, seconds, build) {
  const c = CacheService.getScriptCache();
  const hit = c.get(key);
  if (hit) return JSON.parse(hit);
  const v = build();
  try { c.put(key, JSON.stringify(v), seconds); } catch (e) {}
  return v;
}

function newPin() {
  const len = Math.max(4, Math.min(6, Number(setting('pin_length', 4))));
  const used = new Set(); // PINs are hashed, so compare by trying each candidate against existing hashes
  const partners = rows('Partners');
  for (let tries = 0; tries < 50; tries++) {
    let pin = ''; for (let i = 0; i < len; i++) pin += Math.floor(Math.random() * 10);
    if (/^(\d)\1+$/.test(pin) || used.has(pin)) continue;
    if (!partners.some(p => p.pin_hash === hashPin(pin, p.salt))) return pin;
    used.add(pin);
  }
  fail('Could not create a PIN. Try again.');
}

// Time plus a random part, so two IDs made in the same millisecond never clash.
function newId(prefix) { return prefix + Date.now().toString(36).toUpperCase() + Utilities.getUuid().slice(0, 4).toUpperCase(); }

function pinTaken(pin, exceptId) {
  return rows('Partners').some(p => String(p.partner_id) !== String(exceptId || '') && p.pin_hash && p.pin_hash === hashPin(pin, p.salt));
}

function hashPin(pin, salt) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(salt) + ':' + String(pin));
  return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function logAction(by, action, details) { withLock(() => append('Log', { at: new Date().toISOString(), by, action, details })); }

let SETTINGS_CACHE = null;   // reset at the start of every request
function setting(key, fallback) {
  if (!SETTINGS_CACHE) SETTINGS_CACHE = cached('settings_v1', 60, () => { const o = {}; rows('Settings').forEach(x => o[x.key] = x.value); return o; });
  const v = SETTINGS_CACHE[key]; return v !== undefined && v !== '' ? v : fallback;
}

function dateKey(d) { return Utilities.formatDate(d, tz(), 'yyyy-MM-dd'); }

function truthy(v) { return v === true || /^(yes|y|true|1)$/i.test(String(v).trim()); }

/* ---------- sheet helpers ---------- */

function sheet(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) fail('The "' + name + '" tab is missing. Run setup() once.');
  return sh;
}

// Sheets turns text like "2026-11-04" into real dates, so date-only columns are read back as yyyy-MM-dd.
const DATE_ONLY = { date: true, start_date: true, issued_date: true, valid_till: true };
let TZ_CACHE = null;
function tz() {
  if (!TZ_CACHE) {
    const sh = SpreadsheetApp.getActive().getSheetByName('Settings');
    const r = sh ? sh.getDataRange().getValues().find(x => x[0] === 'timezone') : null;
    TZ_CACHE = (r && r[1]) || 'Asia/Kolkata';
  }
  return TZ_CACHE;
}

function toObjects(values) {
  const h = values[0] || [];
  return values.slice(1).filter(r => r.join('') !== '').map(r => {
    const o = {};
    h.forEach((k, i) => {
      const v = r[i];
      o[k] = v instanceof Date ? (DATE_ONLY[k] ? Utilities.formatDate(v, tz(), 'yyyy-MM-dd') : v.toISOString()) : v;
    });
    return o;
  });
}

// Each tab is read at most once per request (writes clear it).
let READ = {};
function rows(name) {
  if (!READ[name]) READ[name] = toObjects(sheet(name).getDataRange().getValues());
  return READ[name].map(o => Object.assign({}, o));
}
function changed(name) {
  delete READ[name];
  const c = CacheService.getScriptCache();
  if (name === 'Settings') { c.remove('settings_v1'); c.remove('config_v1'); SETTINGS_CACHE = null; }
  if (name === 'Menu' || name === 'Carts') { c.remove('config_v1'); c.remove('menu_public'); }
  if (name === 'Partners') c.remove('partners_v1');
}

function rowsTail(name, n) {
  const sh = sheet(name); const last = sh.getLastRow(); const cols = sh.getLastColumn();
  if (last < 2) return [];
  const h = sh.getRange(1, 1, 1, cols).getValues();
  const start = Math.max(2, last - n + 1);
  return toObjects(h.concat(sh.getRange(start, 1, last - start + 1, cols).getValues()));
}

function headerOf(sh) { return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]; }

function append(name, obj) { appendMany(name, [obj]); }

function appendMany(name, objs) {
  if (!objs.length) return;
  const sh = sheet(name); const h = headerOf(sh);
  sh.getRange(sh.getLastRow() + 1, 1, objs.length, h.length).setValues(objs.map(o => h.map(k => o[k] == null ? '' : o[k])));
  changed(name);
}

function updateWhere(name, test, changes) {
  const sh = sheet(name); const data = sh.getDataRange().getValues(); const h = data[0];
  for (let i = 1; i < data.length; i++) {
    const o = {}; h.forEach((k, j) => o[k] = data[i][j]);
    if (!test(o)) continue;
    Object.keys(changes).forEach(k => { const j = h.indexOf(k); if (j >= 0) sh.getRange(i + 1, j + 1).setValue(changes[k]); });
    changed(name);
    return o;
  }
  return null;
}

function deleteWhere(name, test) {
  const sh = sheet(name); const data = sh.getDataRange().getValues(); const h = data[0];
  for (let i = data.length - 1; i >= 1; i--) {
    const o = {}; h.forEach((k, j) => o[k] = data[i][j] instanceof Date ? data[i][j].toISOString() : data[i][j]);
    if (test(o)) { sh.deleteRow(i + 1); changed(name); }
  }
}

function withLock(fn, after) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) fail('Busy right now. Try again in a moment.');
  READ = {};   // read fresh inside the lock (another phone may have just written)
  try { return fn(); } finally { READ = {}; lock.releaseLock(); if (after) after(); }
}

/* ---------- one-time setup (run from the Apps Script editor) ---------- */

function setup() {
  const ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone('Asia/Kolkata');   // keeps sheet dates and sales dates on the same calendar day
  Object.keys(SCHEMA).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const h = SCHEMA[name];
    const existing = sh.getLastColumn() ? headerOf(sh) : [];
    // Add any missing columns at the end, so new versions of this script never break old sheets.
    const missing = h.filter(k => existing.indexOf(k) < 0);
    if (!existing.length || existing.join('') === '') sh.getRange(1, 1, 1, h.length).setValues([h]);
    else if (missing.length) sh.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold');
  });
  // Add any setting this version needs and the sheet doesn't have yet. Values already there are kept.
  const haveKeys = rows('Settings').map(r => r.key);
  appendMany('Settings', DEFAULT_SETTINGS.filter(r => haveKeys.indexOf(r[0]) < 0).map(r => ({ key: r[0], value: r[1], note: r[2] })));
  // Phone numbers, card codes and bill numbers are text: stop Sheets turning them into numbers.
  ['Customers', 'Passes', 'Bills'].forEach(n => sheet(n).getRange('A:Z').setNumberFormat('@'));
  if (rows('Carts').length === 0) appendMany('Carts', [{ cart_id: 'C1', name: 'Cart 1', float: 500, active: 'yes' }, { cart_id: 'C2', name: 'Cart 2', float: 500, active: 'yes' }]);
  if (rows('Menu').length === 0) appendMany('Menu', [
    { item_id: 'RPCK', name: 'Reshmi Polao + Chicken Kosha', type: 'nonveg', size: 'Half', price: 50, active: 'yes', sort: 1 },
    { item_id: 'RPCK', name: 'Reshmi Polao + Chicken Kosha', type: 'nonveg', size: 'Full', price: 80, active: 'yes', sort: 1 },
    { item_id: 'PMP', name: 'Polao + Matar Paneer', type: 'veg', size: 'Full', price: 70, active: 'yes', sort: 2 },
  ]);
  // Extras: added once. To stop selling one, switch it off (active = no) rather than deleting the row.
  if (!rows('Menu').some(r => isExtraType(r.type))) appendMany('Menu', [
    { item_id: 'XRICE', name: 'Extra rice', type: 'extra', size: 'Extra', price: 50, active: 'yes', sort: 90, website: 'no', unit: '' },
    { item_id: 'XCHK', name: 'Extra chicken', type: 'extra', size: 'Extra', price: 30, active: 'yes', sort: 91, website: 'no', unit: 'piece' },
  ]);
  if (!rows('Partners').some(p => p.role === 'founder')) {
    const salt = Utilities.getUuid();
    append('Partners', { partner_id: 'F1', name: FIRST_FOUNDER_NAME, role: 'founder', cart_id: '', phone: '', backup: 'no', active: 'yes',
      start_date: dateKey(new Date()), pin_hash: hashPin(FIRST_FOUNDER_PIN, salt), salt, created_at: new Date().toISOString() });
  }
  SpreadsheetApp.getActive().toast('Pedal Plate sales sheet is ready.');
}

/** Optional: run from the editor to add another founder (they can then add partners in the app). */
function addFounder() {
  const ui = SpreadsheetApp.getUi();
  const name = ui.prompt('Founder first name').getResponseText().trim();
  const pin = ui.prompt('PIN for ' + name + ' (4–6 digits)').getResponseText().trim();
  if (!name || !/^\d{4,6}$/.test(pin)) { ui.alert('Name and a 4–6 digit PIN are required.'); return; }
  if (pinTaken(pin)) { ui.alert('That PIN is already used by someone else. Choose another.'); return; }
  const salt = Utilities.getUuid();
  append('Partners', { partner_id: newId('F'), name, role: 'founder', cart_id: '', phone: '', backup: 'no', active: 'yes',
    start_date: dateKey(new Date()), pin_hash: hashPin(pin, salt), salt, created_at: new Date().toISOString() });
  ui.alert(name + ' added as a founder.');
}

/* ---------- daily report (email every night at about 1 am, India time) ----------
   Reports the business day that just ended: money, carts, what needs a look, combos and Pedal Club.
   One-time setup: run installDailyReport() from the Apps Script editor and allow "send email".
   sendReportNow() sends yesterday's report straight away (for a test).
   Settings (optional rows in the Settings tab): report_on (yes/no), report_emails (comma list),
   report_whatsapp (comma list of number:apikey from CallMeBot, e.g. 917699149899:123456). */

function installDailyReport() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'dailyReport').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailyReport').timeBased().atHour(1).nearMinute(0).everyDays(1).inTimezone('Asia/Kolkata').create();
  return 'Daily report scheduled for about 1 am every day (India time). Sending a test now.';
}
function sendReportNow() { return dailyReport(); }

function dailyReport() {
  SETTINGS_CACHE = null; READ = {};
  if (!truthy(setting('report_on', 'yes'))) return 'Report is switched off (Settings > report_on).';
  // The business day that just ended: 6 hours back from now, so a run anywhere between ~6 pm and ~6 am
  // still reports the right day (Google may start the 1 am run up to 15 minutes early or late).
  const day = dateKey(new Date(Date.now() - 6 * 3600 * 1000));
  const r = buildDailyReport(day);
  const out = [];
  const to = String(setting('report_emails', 'pedalplate.food@gmail.com')).split(/[,;\s]+/).filter(Boolean).join(',');
  if (to) { MailApp.sendEmail({ to, subject: r.subject, htmlBody: r.html, body: r.text, name: 'Pedal Plate reports' }); out.push('email: ' + to); }
  String(setting('report_whatsapp', '')).split(/[,;\s]+/).filter(Boolean).forEach(entry => {
    const m = entry.match(/^\+?(\d{10,13}):(\S+)$/); if (!m) { out.push('whatsapp: bad entry ' + entry); return; }
    try {
      const res = UrlFetchApp.fetch('https://api.callmebot.com/whatsapp.php?phone=' + m[1] + '&apikey=' + encodeURIComponent(m[2]) + '&text=' + encodeURIComponent(r.whatsapp), { muteHttpExceptions: true });
      out.push('whatsapp ' + m[1].slice(-4) + ': ' + res.getResponseCode());
    } catch (e) { out.push('whatsapp ' + m[1].slice(-4) + ': ' + e.message); }
  });
  return r.subject + ' -> ' + out.join(' | ');
}

function buildDailyReport(day) {
  const salesAll = rowsTail('Sales', 12000).filter(x => x.status !== 'void');
  const voids = rowsTail('Sales', 12000).filter(x => x.date === day && x.status === 'void');
  const sales = salesAll.filter(x => x.date === day);
  const t = totalsOf(sales);
  const wk = addDaysKey(day, -7), lastWeek = totalsOf(salesAll.filter(x => x.date === wk));
  const closes = {}; rows('Closes').filter(c => c.date === day).forEach(c => closes[c.partner_id] = c);
  const carts = {}; rows('Carts').forEach(c => carts[c.cart_id] = c.name || c.cart_id);
  const by = {}; sales.forEach(x => (by[x.partner_id] = by[x.partner_id] || []).push(x));
  const partners = rows('Partners').filter(p => by[p.partner_id]);
  const bank = rows('BankUpi').filter(b => b.date === day).pop() || null;
  const money = n => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
  const pct = (a, b) => b ? Math.round((a - b) * 100 / b) : null;
  const nice = k => Utilities.formatDate(new Date(k + 'T12:00:00+05:30'), 'Asia/Kolkata', 'EEE, d MMM');

  // per partner
  const rowsP = partners.map(p => {
    const pt = totalsOf(by[p.partner_id]), c = closes[p.partner_id] || null, diff = c ? Number(c.difference) || 0 : null;
    const cart = carts[(c && c.cart_id) || (by[p.partner_id][0] || {}).cart_id] || '';
    return { name: p.name, cart, t: pt, closed: !!c, diff, handed: c ? Number(c.handed_over) || 0 : null, left: c && c.leftover !== '' ? Number(c.leftover) : null };
  });

  // needs a look
  const flags = [];
  rowsP.filter(x => !x.closed).forEach(x => flags.push(`${x.name}${x.cart ? ' (' + x.cart + ')' : ''} did not close the day.`));
  rowsP.filter(x => x.closed && x.diff !== 0).forEach(x => flags.push(`${x.name}: cash ${money(Math.abs(x.diff))} ${x.diff < 0 ? 'short' : 'over'}.`));
  if (!bank && t.upi > 0) flags.push(`UPI not checked yet: ${money(t.upi)} tapped. Enter the bank amount in the app (Today, UPI check).`);
  else if (bank && Number(bank.difference) !== 0) flags.push(`UPI: bank ${money(bank.amount)} vs tapped ${money(bank.upi_tapped)} (${Number(bank.difference) < 0 ? money(-bank.difference) + ' less in the bank' : money(bank.difference) + ' more in the bank'}).`);
  if (t.manualPlates) flags.push(`${t.manualPlates} plate${t.manualPlates > 1 ? 's' : ''} added later by hand.`);
  if (voids.length) flags.push(`${voids.length} sale${voids.length > 1 ? 's' : ''} undone.`);

  // combos
  const items = {}, extrasBy = {}; sales.forEach(x => { if (!isPlate(x)) { if (x.size === 'Extra') { const e = extrasBy[x.item_name || x.item_id] = extrasBy[x.item_name || x.item_id] || { qty: 0, total: 0 }; e.qty += Number(x.qty) || 0; e.total += Number(x.amount) || 0; } return; } const k = x.item_name || x.item_id; const o = items[k] = items[k] || { plates: 0, total: 0, full: 0, half: 0 }; const q = Number(x.qty) || 0; o.plates += q; o.total += x.pay === 'Free' ? 0 : (Number(x.amount) || 0); if ((x.size || 'Full') === 'Half') o.half += q; else o.full += q; });
  const leftTotal = rowsP.reduce((n, x) => n + (x.left || 0), 0), anyLeft = rowsP.some(x => x.left != null);

  // Pedal Club
  let club = null;
  try {
    const stamps = rows('Stamps').filter(s => s.date === day && s.status !== 'void').length;
    const newMembers = rows('Customers').filter(c => String(c.created_at).slice(0, 10) === day || dateKey(new Date(c.created_at)) === day).length;
    const free = sales.filter(x => x.pay === 'Free').reduce((n, x) => n + (Number(x.qty) || 0), 0);
    const bills = rows('Bills').filter(b => b.date === day).length;
    club = { stamps, newMembers, free, bills };
  } catch (e) {}

  // last 7 days
  const week = [];
  for (let i = 6; i >= 0; i--) { const k = addDaysKey(day, -i), w = totalsOf(salesAll.filter(x => x.date === k)); week.push({ k, plates: w.plates, total: w.total }); }

  const ch = pct(t.total, lastWeek.total);
  const subject = `Pedal Plate · ${nice(day)} · ${money(t.total)} · ${t.plates} plates${flags.length ? ' · ' + flags.length + ' to check' : ' · all clear'}`;

  // ---------- HTML (email-safe: tables + inline styles, brand colours) ----------
  const C = { ink: '#2B2620', soft: '#6B5F51', brand: '#96601A', basil: '#3F7D4A', cream: '#FBF6EC', tint: '#F3E3C6', line: '#E8DCC8', chili: '#C0392B' };
  const td = (s, x = '') => `<td style="padding:8px 10px;border-bottom:1px solid ${C.line};font-size:14px;${x}">${s}</td>`;
  const th = (s, x = '') => `<th style="padding:8px 10px;border-bottom:2px solid ${C.line};font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:${C.soft};text-align:left;${x}">${s}</th>`;
  const h2 = s => `<h2 style="margin:26px 0 10px;font-size:16px;color:${C.brand};letter-spacing:.06em;text-transform:uppercase">${s}</h2>`;
  const box = (label, val, sub) => `<td style="padding:12px 14px;background:${C.cream};border-radius:12px;vertical-align:top"><div style="font-size:12px;color:${C.soft};text-transform:uppercase;letter-spacing:.06em">${label}</div><div style="font-size:22px;font-weight:800;color:${C.ink};margin-top:2px">${val}</div>${sub ? `<div style="font-size:12px;color:${C.soft};margin-top:2px">${sub}</div>` : ''}</td>`;
  const R = 'text-align:right';
  let h = `<div style="font-family:Poppins,Segoe UI,Arial,sans-serif;color:${C.ink};max-width:640px;margin:0 auto">`;
  h += `<div style="background:${C.ink};color:${C.cream};padding:18px 20px;border-radius:14px"><div style="font-size:13px;color:#E3AD57;letter-spacing:.08em;text-transform:uppercase;font-weight:700">Pedal Plate · Daily report</div><div style="font-size:24px;font-weight:800;margin-top:4px">${nice(day)}</div></div>`;
  h += `<table role="presentation" style="width:100%;border-collapse:separate;border-spacing:8px;margin:10px -8px 0"><tr>${box('Sales', money(t.total), ch == null ? '' : `${ch >= 0 ? '▲' : '▼'} ${Math.abs(ch)}% vs last ${Utilities.formatDate(new Date(day + 'T12:00:00+05:30'), 'Asia/Kolkata', 'EEE')}`)}${box('Plates', t.plates, t.plates ? 'avg ' + money(t.total / Math.max(1, t.plates - t.freePlates)) + ' / plate' : '')}${box('Cash', money(t.cash))}${box('UPI', money(t.upi))}</tr></table>`;
  h += h2(flags.length ? `Needs a look (${flags.length})` : 'Needs a look');
  h += flags.length ? `<ul style="margin:0;padding-left:20px">${flags.map(f => `<li style="margin:4px 0;font-size:14px">${f}</li>`).join('')}</ul>` : `<p style="margin:0;font-size:14px;color:${C.basil};font-weight:700">✓ All clear: every cart closed, cash and UPI match.</p>`;
  h += h2('By partner');
  h += rowsP.length ? `<table style="width:100%;border-collapse:collapse"><tr>${th('Partner')}${th('Plates', R)}${th('Cash', R)}${th('UPI', R)}${th('Close', R)}</tr>${rowsP.map(x => `<tr>${td(`<b>${x.name}</b>${x.cart ? `<br><span style="color:${C.soft};font-size:12px">${x.cart}</span>` : ''}`)}${td(x.t.plates, R)}${td(money(x.t.cash), R)}${td(money(x.t.upi), R)}${td(!x.closed ? `<span style="color:${C.chili};font-weight:700">Not closed</span>` : x.diff === 0 ? `<span style="color:${C.basil};font-weight:700">✓ Matches</span><br><span style="font-size:12px;color:${C.soft}">handed ${money(x.handed)}</span>` : `<span style="color:${C.chili};font-weight:700">${money(Math.abs(x.diff))} ${x.diff < 0 ? 'short' : 'over'}</span>`, R)}</tr>`).join('')}</table>` : `<p style="font-size:14px;color:${C.soft}">No sales recorded.</p>`;
  h += h2('By combo');
  const il = Object.keys(items).sort((a, b) => items[b].plates - items[a].plates);
  h += il.length ? `<table style="width:100%;border-collapse:collapse"><tr>${th('Combo')}${th('Full', R)}${th('Half', R)}${th('Sales', R)}</tr>${il.map(k => `<tr>${td(k)}${td(items[k].full, R)}${td(items[k].half || '–', R)}${td(money(items[k].total), R)}</tr>`).join('')}</table>` : '';
  const el = Object.keys(extrasBy);
  if (el.length) h += `<p style="font-size:14px;margin:10px 0 0">Extras: ${el.map(k => `${k} × <b>${extrasBy[k].qty}</b> (${money(extrasBy[k].total)})`).join(' · ')}</p>`;
  if (anyLeft) h += `<p style="font-size:14px;margin:10px 0 0">Plates left over at close: <b>${leftTotal}</b>${t.plates ? ` (${Math.round(leftTotal * 100 / (t.plates + leftTotal))}% of what was cooked)` : ''}</p>`;
  if (club) { h += h2('Pedal Club'); h += `<table role="presentation" style="width:100%;border-collapse:separate;border-spacing:8px;margin:0 -8px"><tr>${box('Stamps given', club.stamps)}${box('New members', club.newMembers)}${box('Free meals', club.free)}${box('Bills sent', club.bills)}</tr></table>`; }
  h += h2('Last 7 days');
  const max = Math.max(1, ...week.map(w => w.total));
  h += `<table style="width:100%;border-collapse:collapse">${week.map(w => `<tr>${td(Utilities.formatDate(new Date(w.k + 'T12:00:00+05:30'), 'Asia/Kolkata', 'EEE d'), 'width:70px;' + (w.k === day ? 'font-weight:700' : ''))}<td style="padding:6px 10px;border-bottom:1px solid ${C.line}"><div style="height:14px;border-radius:7px;background:${w.k === day ? C.brand : '#E3AD57'};width:${Math.max(2, Math.round(w.total * 100 / max))}%"></div></td>${td(money(w.total), R + ';width:90px')}${td(w.plates + ' pl', R + ';width:60px;color:' + C.soft)}</tr>`).join('')}</table>`;
  h += `<p style="margin:26px 0 0;font-size:12px;color:${C.soft}">Sent automatically every night at about 1 am from the Pedal Plate sales Sheet. Recipients and on/off: Settings tab (report_emails, report_on).</p></div>`;

  const text = [subject, '', 'Needs a look:', ...(flags.length ? flags.map(f => '- ' + f) : ['- All clear']), '',
    ...rowsP.map(x => `${x.name}: ${x.t.plates} plates, cash ${money(x.t.cash)}, UPI ${money(x.t.upi)}, ${!x.closed ? 'NOT CLOSED' : x.diff === 0 ? 'matches' : money(Math.abs(x.diff)) + (x.diff < 0 ? ' short' : ' over')}`)].join('\n');
  const wa = [`*Pedal Plate · ${nice(day)}*`,
    `Sales ${money(t.total)} · ${t.plates} plates${ch == null ? '' : ` (${ch >= 0 ? '+' : ''}${ch}% vs last week)`}`,
    `Cash ${money(t.cash)} · UPI ${money(t.upi)}`, ...(t.extras ? [`Extras: ${t.extras} (${money(t.extrasTotal)})`] : []), '',
    flags.length ? '*Needs a look:*' : '✅ All clear', ...flags.map(f => '• ' + f), '',
    ...rowsP.map(x => `${x.name}: ${x.t.plates} pl, ${!x.closed ? 'not closed' : x.diff === 0 ? 'cash ok' : money(Math.abs(x.diff)) + (x.diff < 0 ? ' short' : ' over')}`),
    ...(club ? ['', `Pedal Club: ${club.stamps} stamps · ${club.newMembers} new · ${club.free} free meals`] : []),
    '', 'Full report in your email.'].join('\n');
  return { subject, html: h, text, whatsapp: wa, flags, totals: t };
}
