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
  Menu:     ['item_id', 'name', 'type', 'size', 'price', 'active', 'sort'],
  Carts:    ['cart_id', 'name', 'float', 'active'],
  Partners: ['partner_id', 'name', 'role', 'cart_id', 'phone', 'backup', 'active', 'start_date', 'pin_hash', 'salt', 'created_at'],
  Sessions: ['token', 'partner_id', 'cart_id', 'expires_at'],
  Sales:    ['sale_id', 'created_at', 'date', 'partner_id', 'partner_name', 'cart_id', 'item_id', 'item_name', 'size', 'price', 'qty', 'amount', 'pay', 'source', 'status', 'void_by', 'void_at'],
  Closes:   ['close_id', 'date', 'partner_id', 'partner_name', 'cart_id', 'plates', 'sales_total', 'cash_sales', 'upi_sales', 'float', 'spent', 'pouch_expected', 'pouch_counted', 'difference', 'handed_over', 'boxes_out', 'boxes_back', 'note', 'closed_at'],
  BankUpi:  ['date', 'amount', 'upi_tapped', 'difference', 'entered_by', 'entered_at'],
  Log:      ['at', 'by', 'action', 'details'],
};

const DEFAULT_SETTINGS = [
  ['timezone', 'Asia/Kolkata', 'Used for the sales date'],
  ['session_hours', '18', 'How long a login lasts on a phone'],
  ['undo_minutes', '2', 'How long a partner can undo their own last sale'],
  ['pin_length', '4', 'Digits in generated PINs'],
];

// Edit these two lines before running setup() the first time, then change the PIN from the app.
const FIRST_FOUNDER_NAME = 'Arindam';
const FIRST_FOUNDER_PIN = '9999';

/* ---------- entry points ---------- */

function doPost(e) {
  let req = {};
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
  close: { fn: closeDay },
  today: { founder: true, fn: founderToday },
  bankUpi: { founder: true, fn: saveBankUpi },
  partnersList: { founder: true, fn: () => ({ partners: rows('Partners').map(p => publicPartner(p)) }) },
  partnersAdd: { founder: true, fn: addPartner },
  partnersUpdate: { founder: true, fn: updatePartner },
  partnersResetPin: { founder: true, fn: resetPin },
  logList: { founder: true, fn: () => ({ log: rowsTail('Log', 60).reverse() }) },
  logout: { fn: (req, s) => { deleteWhere('Sessions', r => r.token === req.token); return {}; } },
  setCart: { fn: (req, s) => {
    const cart = rows('Carts').find(c => String(c.cart_id) === String(req.cart_id) && truthy(c.active));
    if (!cart) fail('That cart is not active.');
    withLock(() => updateWhere('Sessions', r => r.token === req.token, { cart_id: String(cart.cart_id) }));
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
  const p = rows('Partners').find(r => r.pin_hash && r.pin_hash === hashPin(pin, r.salt));
  if (!p) { cache.put('login_fails', String(fails + 1), 600); fail("That PIN isn't recognised. Try again."); }
  if (!truthy(p.active)) fail(p.name + "'s PIN is switched off. Ask a founder.");
  const cart = String(req.cart_id || p.cart_id || '');
  const token = Utilities.getUuid() + Utilities.getUuid().slice(0, 8);
  const hours = Number(setting('session_hours', 18));
  withLock(() => {
    deleteWhere('Sessions', r => new Date(r.expires_at) < new Date());
    append('Sessions', { token, partner_id: p.partner_id, cart_id: cart, expires_at: new Date(Date.now() + hours * 3600e3).toISOString() });
  });
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
  let done = false;
  withLock(() => {
    const sh = sheet('Sales'); const data = sh.getDataRange().getValues(); const h = data[0];
    const ci = name => h.indexOf(name);
    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][ci('sale_id')]) !== id) continue;
      const isFounder = s.partner.role === 'founder';
      const own = String(data[i][ci('partner_id')]) === String(s.partner.partner_id);
      const age = (Date.now() - new Date(data[i][ci('created_at')]).getTime()) / 60000;
      if (!isFounder && (!own || age > undoMin + 1)) fail('This sale can no longer be undone. Ask a founder to correct it.');
      sh.getRange(i + 1, ci('status') + 1, 1, 3).setValues([['void', s.partner.name, new Date().toISOString()]]);
      if (isFounder && !own) logAction(s.partner.name, 'void sale', id + ' (' + data[i][ci('partner_name')] + ')');
      done = true; break;
    }
  });
  return { voided: done };
}

function mineToday(req, s) {
  const d = dateKey(new Date());
  const sales = todaysSales(d).filter(r => String(r.partner_id) === String(s.partner.partner_id));
  const close = rows('Closes').filter(r => r.date === d && String(r.partner_id) === String(s.partner.partner_id)).pop() || null;
  return { date: d, totals: totalsOf(sales), close };
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
  sales.forEach(r => { const k = r.item_name + (r.size ? ' · ' + r.size : ''); byItem[k] = (byItem[k] || 0) + Number(r.qty); });
  const bank = rows('BankUpi').filter(r => r.date === d).pop() || null;
  return { date: d, totals: totalsOf(sales), perPartner, byItem, bank };
}

function saveBankUpi(req, s) {
  const d = dateKey(new Date());
  const amount = Number(req.amount);
  if (!(amount >= 0)) fail('Enter the UPI amount.');
  const tapped = totalsOf(todaysSales(d)).upi;
  const row = { date: d, amount, upi_tapped: tapped, difference: amount - tapped, entered_by: s.partner.name, entered_at: new Date().toISOString() };
  withLock(() => append('BankUpi', row));
  return { bank: row };
}

function addPartner(req, s) {
  const name = String(req.name || '').trim().slice(0, 40);
  if (!name) fail('Enter a first name.');
  const pin = newPin();
  const salt = Utilities.getUuid();
  const p = {
    partner_id: 'P' + Date.now().toString(36).toUpperCase(), name, role: 'partner', cart_id: String(req.cart_id || ''),
    phone: String(req.phone || '').slice(0, 20), backup: req.backup ? 'yes' : 'no', active: 'yes',
    start_date: String(req.start_date || dateKey(new Date())), pin_hash: hashPin(pin, salt), salt, created_at: new Date().toISOString(),
  };
  withLock(() => append('Partners', p));
  logAction(s.partner.name, 'added partner', name + ' (' + (p.cart_id || 'no cart') + (p.backup === 'yes' ? ', backup' : '') + ')');
  return { partner: publicPartner(p), pin };
}

function updatePartner(req, s) {
  const changes = {};
  if (req.cart_id != null) changes.cart_id = String(req.cart_id);
  if (req.active != null) changes.active = req.active ? 'yes' : 'no';
  if (req.backup != null) changes.backup = req.backup ? 'yes' : 'no';
  let target;
  withLock(() => {
    target = updateWhere('Partners', r => String(r.partner_id) === String(req.partner_id), changes);
    if (!target) fail('Partner not found.');
    if (target.role === 'founder' && changes.active === 'no' && String(target.partner_id) === String(s.partner.partner_id)) fail("You can't switch off your own login.");
    if (changes.active === 'no') deleteWhere('Sessions', r => String(r.partner_id) === String(req.partner_id));
  });
  logAction(s.partner.name, 'updated partner', target.name + ': ' + Object.keys(changes).map(k => k + '=' + changes[k]).join(', '));
  return { partner: publicPartner(Object.assign(target, changes)) };
}

function resetPin(req, s) {
  const p = rows('Partners').find(r => String(r.partner_id) === String(req.partner_id));
  if (!p) fail('Partner not found.');
  if (p.role === 'founder' && String(p.partner_id) === String(s.partner.partner_id)) fail("Ask another founder to reset your PIN.");
  const pin = newPin(); const salt = Utilities.getUuid();
  withLock(() => {
    updateWhere('Partners', r => String(r.partner_id) === String(p.partner_id), { pin_hash: hashPin(pin, salt), salt });
    deleteWhere('Sessions', r => String(r.partner_id) === String(p.partner_id));
  });
  logAction(s.partner.name, 'reset PIN', p.name);
  return { pin, partner: publicPartner(p) };
}

/* ---------- business helpers ---------- */

function getConfig() {
  const items = {};
  rows('Menu').filter(r => truthy(r.active)).sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0)).forEach(r => {
    const it = items[r.item_id] = items[r.item_id] || { item_id: r.item_id, name: r.name, type: String(r.type).toLowerCase().indexOf('non') === 0 ? 'nonveg' : 'veg', sizes: [] };
    it.sizes.push({ size: r.size || 'Full', price: Number(r.price) });
  });
  const settings = {}; rows('Settings').forEach(r => settings[r.key] = r.value);
  delete settings.timezone;
  return {
    menu: Object.keys(items).map(k => items[k]),
    carts: rows('Carts').filter(c => truthy(c.active)).map(c => ({ cart_id: String(c.cart_id), name: c.name || c.cart_id, float: Number(c.float) || 0 })),
    settings, date: dateKey(new Date()),
  };
}

function getMenuIndex() {
  const idx = {}; rows('Menu').forEach(r => idx[r.item_id + '|' + (r.size || 'Full')] = r); return idx;
}

function todaysSales(d) {
  return rowsTail('Sales', 6000).filter(r => r.date === d && r.status !== 'void');
}

function totalsOf(list) {
  const t = { plates: 0, total: 0, cash: 0, upi: 0, manualPlates: 0 };
  list.forEach(r => {
    const q = Number(r.qty) || 0, a = Number(r.amount) || (Number(r.price) * q);
    t.plates += q; t.total += a;
    if (r.pay === 'UPI') t.upi += a; else t.cash += a;
    if (r.source === 'manual') t.manualPlates += q;
  });
  return t;
}

function publicPartner(p, cartOverride) {
  return { partner_id: String(p.partner_id), name: p.name, role: p.role === 'founder' ? 'founder' : 'partner',
    cart_id: String(cartOverride != null ? cartOverride : p.cart_id || ''), backup: truthy(p.backup), active: truthy(p.active), start_date: p.start_date || '' };
}

function getSession(token) {
  if (!token) return null;
  const s = rows('Sessions').find(r => r.token === token);
  if (!s || new Date(s.expires_at) < new Date()) return null;
  const p = rows('Partners').find(r => String(r.partner_id) === String(s.partner_id));
  if (!p || !truthy(p.active)) return null;
  return { partner: p, cart_id: String(s.cart_id || p.cart_id || '') };
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

function hashPin(pin, salt) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(salt) + ':' + String(pin));
  return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function logAction(by, action, details) { withLock(() => append('Log', { at: new Date().toISOString(), by, action, details })); }

function setting(key, fallback) {
  const r = rows('Settings').find(x => x.key === key); return r && r.value !== '' ? r.value : fallback;
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
const DATE_ONLY = { date: true, start_date: true };
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

function rows(name) { return toObjects(sheet(name).getDataRange().getValues()); }

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
}

function updateWhere(name, test, changes) {
  const sh = sheet(name); const data = sh.getDataRange().getValues(); const h = data[0];
  for (let i = 1; i < data.length; i++) {
    const o = {}; h.forEach((k, j) => o[k] = data[i][j]);
    if (!test(o)) continue;
    Object.keys(changes).forEach(k => { const j = h.indexOf(k); if (j >= 0) sh.getRange(i + 1, j + 1).setValue(changes[k]); });
    return o;
  }
  return null;
}

function deleteWhere(name, test) {
  const sh = sheet(name); const data = sh.getDataRange().getValues(); const h = data[0];
  for (let i = data.length - 1; i >= 1; i--) {
    const o = {}; h.forEach((k, j) => o[k] = data[i][j] instanceof Date ? data[i][j].toISOString() : data[i][j]);
    if (test(o)) sh.deleteRow(i + 1);
  }
}

function withLock(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) fail('Busy right now. Try again in a moment.');
  try { return fn(); } finally { lock.releaseLock(); }
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
  if (rows('Settings').length === 0) appendMany('Settings', DEFAULT_SETTINGS.map(r => ({ key: r[0], value: r[1], note: r[2] })));
  if (rows('Carts').length === 0) appendMany('Carts', [{ cart_id: 'C1', name: 'Cart 1', float: 500, active: 'yes' }, { cart_id: 'C2', name: 'Cart 2', float: 500, active: 'yes' }]);
  if (rows('Menu').length === 0) appendMany('Menu', [
    { item_id: 'RPCK', name: 'Reshmi Polao + Chicken Kosha', type: 'nonveg', size: 'Half', price: 50, active: 'yes', sort: 1 },
    { item_id: 'RPCK', name: 'Reshmi Polao + Chicken Kosha', type: 'nonveg', size: 'Full', price: 80, active: 'yes', sort: 1 },
    { item_id: 'PMP', name: 'Polao + Matar Paneer', type: 'veg', size: 'Full', price: 70, active: 'yes', sort: 2 },
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
  const salt = Utilities.getUuid();
  append('Partners', { partner_id: 'F' + Date.now().toString(36).toUpperCase(), name, role: 'founder', cart_id: '', phone: '', backup: 'no', active: 'yes',
    start_date: dateKey(new Date()), pin_hash: hashPin(pin, salt), salt, created_at: new Date().toISOString() });
  ui.alert(name + ' added as a founder.');
}
