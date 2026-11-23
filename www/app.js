'use strict';
/*
 * اللواء وائل شوبير — تقويم وتذكيرات
 * All data stays on the device (Capacitor Preferences on Android, localStorage in a browser).
 * Security note: user-entered text is only ever written with textContent, never innerHTML.
 */
(function () {
  // ---------------------------------------------------------------- platform
  const Cap = window.Capacitor;
  const isNative = !!(Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform());
  const Plugins = (Cap && Cap.Plugins) || {};
  const LN = isNative ? Plugins.LocalNotifications || null : null;
  const Prefs = isNative ? Plugins.Preferences || null : null;

  // ---------------------------------------------------------------- constants
  const STORE_KEY = 'wael.items.v1';
  const BACKUP_KEY = 'wael.items.unreadable';
  const LOCALE = 'ar-EG';
  const MAX_ITEMS = 2000;
  const MAX_TITLE = 80;
  const MAX_NOTE = 300;
  const MAX_DONE_DATES = 120;
  const MAX_PENDING = 400;      // Android allows ~500 alarms per app; keep a safety margin.
  const MAX_PER_REPEAT = 30;    // upcoming occurrences scheduled per repeating item (topped up on every open)
  const CHANNEL_ID = 'wael-reminders';
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  const ID_RE = /^[a-z0-9-]{8,64}$/i;

  const KINDS = ['event', 'reminder'];
  const REMIND_OPTIONS = [
    { v: 0, label: 'في الموعد', before: '' },
    { v: 10, label: 'قبل ١٠ دقائق', before: 'بعد ١٠ دقائق' },
    { v: 30, label: 'قبل ٣٠ دقيقة', before: 'بعد ٣٠ دقيقة' },
    { v: 60, label: 'قبل ساعة', before: 'بعد ساعة' },
    { v: 1440, label: 'قبل يوم', before: 'غدًا' },
    { v: -1, label: 'بدون تذكير', before: '' },
  ];
  const REPEAT_OPTIONS = [
    { v: 'none', label: 'مرة واحدة' },
    { v: 'daily', label: 'كل يوم' },
    { v: 'weekly', label: 'كل أسبوع' },
    { v: 'monthly', label: 'كل شهر' },
  ];
  const REMIND_VALUES = REMIND_OPTIONS.map((o) => o.v);
  const REPEAT_VALUES = REPEAT_OPTIONS.map((o) => o.v);
  const DEFAULT_REMIND = { event: 30, reminder: 0 };

  // ---------------------------------------------------------------- formatting
  const fmt = {
    monthYear: new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' }),
    dayLong: new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' }),
    time: new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit' }),
    num: new Intl.NumberFormat(LOCALE),
    hijri: safeFormatter('ar-EG-u-ca-islamic-umalqura', { day: 'numeric', month: 'long', year: 'numeric' }),
    hijriMonth: safeFormatter('ar-EG-u-ca-islamic-umalqura', { month: 'long', year: 'numeric' }),
    hijriMonthOnly: safeFormatter('ar-EG-u-ca-islamic-umalqura', { month: 'long' }),
  };
  function safeFormatter(locale, opts) {
    try { return new Intl.DateTimeFormat(locale, opts); } catch (_) { return null; }
  }
  function formatSafe(f, d) {
    try { return f ? f.format(d) : ''; } catch (_) { return ''; }
  }

  // ---------------------------------------------------------------- dates
  const pad = (n) => String(n).padStart(2, '0');
  const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  function parseKey(k) {
    const [y, m, d] = k.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function isValidKey(k) {
    if (typeof k !== 'string' || !DATE_RE.test(k)) return false;
    const d = parseKey(k);
    const y = d.getFullYear();
    return keyOf(d) === k && y >= 2000 && y <= 2100;
  }
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
  const dayDiff = (a, b) => Math.round((b - a) / 86400000); // DST-safe for local midnights
  function addMonthsClamped(start, n) {
    const first = new Date(start.getFullYear(), start.getMonth() + n, 1);
    const dim = daysInMonth(first.getFullYear(), first.getMonth());
    return new Date(first.getFullYear(), first.getMonth(), Math.min(start.getDate(), dim));
  }
  function atTime(d, time) {
    const [hh, mm] = time.split(':').map(Number);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm, 0, 0);
  }
  const todayKey = () => keyOf(new Date());
  const fmtTime = (time) => fmt.time.format(atTime(new Date(), time));

  // ---------------------------------------------------------------- recurrence
  function occursOn(it, key) {
    if (key < it.date) return false; // ISO keys compare correctly as strings
    switch (it.repeat) {
      case 'none': return key === it.date;
      case 'daily': return true;
      case 'weekly': return parseKey(it.date).getDay() === parseKey(key).getDay();
      case 'monthly': {
        const s = parseKey(it.date);
        const d = parseKey(key);
        return d.getDate() === Math.min(s.getDate(), daysInMonth(d.getFullYear(), d.getMonth()));
      }
      default: return false;
    }
  }

  /** Occurrence dates of an item, starting shortly before `from`. */
  function occurrencesFrom(it, from, limit) {
    const start = parseKey(it.date);
    if (it.repeat === 'none') return [start];
    let i = 0;
    if (from > start) {
      const days = dayDiff(start, from);
      if (it.repeat === 'daily') i = days - 2;
      else if (it.repeat === 'weekly') i = Math.floor(days / 7) - 1;
      else i = (from.getFullYear() - start.getFullYear()) * 12 + (from.getMonth() - start.getMonth()) - 1;
      i = Math.max(0, i);
    }
    const out = [];
    for (let n = 0; n < limit; n += 1, i += 1) {
      if (it.repeat === 'daily') out.push(addDays(start, i));
      else if (it.repeat === 'weekly') out.push(addDays(start, i * 7));
      else out.push(addMonthsClamped(start, i));
    }
    return out;
  }

  // ---------------------------------------------------------------- data
  function newId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    const b = new Uint8Array(16);
    window.crypto.getRandomValues(b);
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  }

  function cleanText(v, max) {
    if (typeof v !== 'string') return '';
    // Strip control characters (keep normal whitespace and newlines), collapse runs of blank lines.
    return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
  }

  /** Validates anything read from storage or the form. Returns a clean item or null. */
  function sanitize(o) {
    if (!o || typeof o !== 'object') return null;
    const title = cleanText(o.title, MAX_TITLE).replace(/\s+/g, ' ');
    if (!title) return null;
    if (!isValidKey(o.date) || typeof o.time !== 'string' || !TIME_RE.test(o.time)) return null;
    const done = Array.isArray(o.done)
      ? Array.from(new Set(o.done.filter(isValidKey))).sort().slice(-MAX_DONE_DATES)
      : [];
    return {
      id: typeof o.id === 'string' && ID_RE.test(o.id) ? o.id : newId(),
      kind: KINDS.includes(o.kind) ? o.kind : 'event',
      title,
      note: cleanText(o.note, MAX_NOTE),
      date: o.date,
      time: o.time,
      remind: REMIND_VALUES.includes(o.remind) ? o.remind : -1,
      repeat: REPEAT_VALUES.includes(o.repeat) ? o.repeat : 'none',
      done,
      createdAt: Number.isFinite(o.createdAt) ? o.createdAt : Date.now(),
    };
  }

  async function readStore() {
    if (Prefs) return (await Prefs.get({ key: STORE_KEY })).value;
    try { return window.localStorage.getItem(STORE_KEY); } catch (_) { return null; }
  }
  async function writeStore(key, value) {
    if (Prefs) { await Prefs.set({ key, value }); return; }
    window.localStorage.setItem(key, value); // may throw (quota / private mode) — handled by caller
  }

  async function loadItems() {
    let raw = null;
    try {
      raw = await readStore();
    } catch (err) {
      console.error('Storage read failed:', err && err.message);
      toast('تعذّر فتح البيانات المحفوظة', true);
      return [];
    }
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed && parsed.items) ? parsed.items : [];
      const seen = new Set();
      const items = [];
      for (const o of list.slice(0, MAX_ITEMS)) {
        const it = sanitize(o);
        if (it && !seen.has(it.id)) { seen.add(it.id); items.push(it); }
      }
      return items;
    } catch (err) {
      // Keep the unreadable copy so nothing is silently lost when we save next.
      console.error('Stored data is unreadable; keeping a backup copy.');
      try { await writeStore(BACKUP_KEY, raw); } catch (_) { /* best effort */ }
      return [];
    }
  }

  let saveChain = Promise.resolve();
  function persist() {
    const payload = JSON.stringify({ v: 1, items: state.items });
    saveChain = saveChain
      .then(() => writeStore(STORE_KEY, payload))
      .catch((err) => {
        console.error('Storage write failed:', err && err.message);
        toast('تعذّر الحفظ، حاول مرة أخرى', true);
      });
    return saveChain;
  }

  // ---------------------------------------------------------------- state
  const now0 = new Date();
  const state = {
    items: [],
    view: new Date(now0.getFullYear(), now0.getMonth(), 1),
    selected: keyOf(now0),
    editingId: null,
    lastToday: keyOf(now0),
  };

  // ---------------------------------------------------------------- DOM helpers
  const $ = (id) => document.getElementById(id);
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === false || v == null) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (const c of children) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }
  // Static, developer-authored SVG markup only (never user data).
  const ICONS = {
    bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    repeat: '<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  };
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = ICONS[name];
    return svg;
  }

  let toastTimer = 0;
  function toast(msg, isError) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.toggle('error', !!isError);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 3800 : 2200);
  }

  const remindLabel = (v) => (REMIND_OPTIONS.find((o) => o.v === v) || {}).label || '';
  const repeatLabel = (v) => (REPEAT_OPTIONS.find((o) => o.v === v) || {}).label || '';
  const itemsOn = (key) => state.items
    .filter((it) => occursOn(it, key))
    .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : a.createdAt - b.createdAt));

  // ---------------------------------------------------------------- render
  function renderHeader() {
    const now = new Date();
    const greet = now.getHours() < 12 ? 'صباح الخير' : 'مساء الخير';
    $('greeting').textContent = `${greet} · ${fmt.dayLong.format(now)}`;
  }

  function renderCalendar() {
    const y = state.view.getFullYear();
    const m = state.view.getMonth();
    $('monthTitle').textContent = fmt.monthYear.format(state.view);
    const first = formatSafe(fmt.hijriMonth, new Date(y, m, 1));
    const last = formatSafe(fmt.hijriMonth, new Date(y, m, daysInMonth(y, m)));
    const firstName = formatSafe(fmt.hijriMonthOnly, new Date(y, m, 1));
    $('hijriTitle').textContent = first === last ? first : `${firstName || first} – ${last}`;

    // Build a quick lookup of which kinds appear on each day of this month.
    const dim = daysInMonth(y, m);
    const marks = new Array(dim + 1);
    for (let d = 1; d <= dim; d += 1) {
      const key = `${y}-${pad(m + 1)}-${pad(d)}`;
      let ev = false;
      let rem = false;
      for (const it of state.items) {
        if ((it.kind === 'event' ? ev : rem)) continue;
        if (occursOn(it, key)) { if (it.kind === 'event') ev = true; else rem = true; }
        if (ev && rem) break;
      }
      marks[d] = { ev, rem };
    }

    const grid = $('grid');
    const frag = document.createDocumentFragment();
    const lead = (new Date(y, m, 1).getDay() + 1) % 7; // week starts on Saturday
    for (let i = 0; i < lead; i += 1) frag.append(h('div', { class: 'day-cell blank', 'aria-hidden': 'true' }));
    const tKey = todayKey();
    for (let d = 1; d <= dim; d += 1) {
      const date = new Date(y, m, d);
      const key = keyOf(date);
      const cls = ['day-cell'];
      if (date.getDay() === 5) cls.push('weekend');
      if (key === tKey) cls.push('today');
      if (key === state.selected) cls.push('selected');
      if (key < tKey) cls.push('past');
      const dots = h('span', { class: 'dots', 'aria-hidden': 'true' },
        marks[d].ev ? h('i', { class: 'dot event' }) : null,
        marks[d].rem ? h('i', { class: 'dot reminder' }) : null);
      let label = fmt.dayLong.format(date);
      if (marks[d].ev || marks[d].rem) label += ' — فيه مواعيد';
      frag.append(h('button', {
        type: 'button', class: cls.join(' '), role: 'gridcell', 'data-key': key,
        'aria-label': label, 'aria-pressed': key === state.selected ? 'true' : 'false',
        'aria-current': key === tKey ? 'date' : false,
      }, h('span', { class: 'num', text: fmt.num.format(d) }), dots));
    }
    grid.replaceChildren(frag);
  }

  function renderDay() {
    const key = state.selected;
    const date = parseKey(key);
    const tKey = todayKey();
    let title = fmt.dayLong.format(date);
    if (key === tKey) title = `اليوم · ${title}`;
    else if (key === keyOf(addDays(parseKey(tKey), 1))) title = `غدًا · ${title}`;
    $('dayTitle').textContent = title;

    const list = itemsOn(key);
    $('dayCount').textContent = countLabel(list.length);
    $('empty').hidden = list.length > 0;

    const frag = document.createDocumentFragment();
    for (const it of list) {
      const isDone = it.kind === 'reminder' && it.done.includes(key);
      const [hhmm, ampm] = splitTime(fmtTime(it.time));
      const meta = h('div', { class: 'item-meta' });
      if (it.remind >= 0) meta.append(h('span', null, icon('bell'), remindLabel(it.remind)));
      if (it.repeat !== 'none') meta.append(h('span', null, icon('repeat'), repeatLabel(it.repeat)));
      if (!meta.childNodes.length) meta.append(h('span', null, it.kind === 'event' ? 'موعد' : 'تذكير'));

      const main = h('button', {
        type: 'button', class: 'item-main', 'data-edit': it.id,
        'aria-label': `${it.kind === 'event' ? 'موعد' : 'تذكير'}: ${it.title}، الساعة ${fmtTime(it.time)}. اضغط للتعديل`,
      },
      h('span', { class: 'item-time' }, hhmm, ampm ? h('small', { text: ampm }) : null),
      h('span', { class: 'item-body' },
        h('span', { class: 'item-title', text: it.title }),
        it.note ? h('span', { class: 'item-note', text: it.note }) : null,
        meta));

      const li = h('li', { class: `item ${it.kind}${isDone ? ' done' : ''}`, 'data-id': it.id }, main);
      if (it.kind === 'reminder') {
        const check = h('button', {
          type: 'button', class: 'check', role: 'checkbox', 'aria-checked': isDone ? 'true' : 'false',
          'aria-label': isDone ? 'تم — اضغط لإلغاء' : 'اضغط عند الإنجاز', 'data-done': it.id,
        }, h('span', null, icon('check')));
        li.append(check);
      }
      frag.append(li);
    }
    $('items').replaceChildren(frag);
  }

  function countLabel(n) {
    if (n === 0) return '';
    if (n === 1) return 'عنصر واحد';
    if (n === 2) return 'عنصران';
    return `${fmt.num.format(n)} ${n <= 10 ? 'عناصر' : 'عنصرًا'}`;
  }

  function splitTime(s) {
    const m = s.match(/^(.*?)[\s  ]+(\S+)$/);
    return m ? [m[1], m[2]] : [s, ''];
  }

  function render() {
    renderHeader();
    renderCalendar();
    renderDay();
  }

  // ---------------------------------------------------------------- navigation
  function selectDate(key, opts) {
    if (!isValidKey(key)) return;
    state.selected = key;
    const d = parseKey(key);
    state.view = new Date(d.getFullYear(), d.getMonth(), 1);
    render();
    if (opts && opts.flashId) {
      requestAnimationFrame(() => {
        const el = document.querySelector(`.item[data-id="${CSS.escape(opts.flashId)}"]`);
        if (el) { el.classList.add('flash'); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      });
    }
  }
  function shiftMonth(delta) {
    state.view = new Date(state.view.getFullYear(), state.view.getMonth() + delta, 1);
    renderCalendar();
  }

  // ---------------------------------------------------------------- notifications
  let schedChain = Promise.resolve();
  let schedQueued = false;
  /** Coalesces bursts of changes into one reschedule and never runs two at once. */
  function requestReschedule() {
    if (!LN || schedQueued) return schedChain;
    schedQueued = true;
    schedChain = schedChain.then(async () => {
      schedQueued = false;
      try { await rescheduleAll(); } catch (err) { console.error('Scheduling failed:', err && err.message); }
      await refreshBanner();
    });
    return schedChain;
  }

  function notificationBody(it, remindMin) {
    const when = REMIND_OPTIONS.find((o) => o.v === remindMin);
    let line;
    if (it.kind === 'event') {
      line = remindMin > 0 ? `موعدك ${when.before} · الساعة ${fmtTime(it.time)}` : `حان موعدك · الساعة ${fmtTime(it.time)}`;
    } else {
      line = remindMin > 0 ? `تذكير ${when.before} · الساعة ${fmtTime(it.time)}` : 'حان وقت التذكير';
    }
    return it.note ? `${line}\n${it.note.slice(0, 140)}` : line;
  }

  async function rescheduleAll() {
    const perm = await LN.checkPermissions();
    // Always clear what we scheduled before, so edits and deletions never leave stale alarms.
    const pending = await LN.getPending();
    if (pending && pending.notifications && pending.notifications.length) {
      await LN.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
    }
    if (perm.display !== 'granted') return;

    const now = Date.now();
    const from = addDays(new Date(), -1);
    const active = state.items.filter((it) => it.remind >= 0);
    const repeating = active.filter((it) => it.repeat !== 'none').length;
    const perRepeat = repeating ? Math.max(3, Math.min(MAX_PER_REPEAT, Math.floor(MAX_PENDING / repeating))) : 0;

    const queue = [];
    for (const it of active) {
      const occ = occurrencesFrom(it, from, it.repeat === 'none' ? 1 : perRepeat + 3);
      for (const d of occ) {
        const key = keyOf(d);
        if (it.kind === 'reminder' && it.done.includes(key)) continue;
        const at = atTime(d, it.time).getTime() - it.remind * 60000;
        if (at <= now + 1000) continue;
        queue.push({ at, it, key });
      }
    }
    queue.sort((a, b) => a.at - b.at);
    const notifications = queue.slice(0, MAX_PENDING).map((q, i) => ({
      id: i + 1,
      title: q.it.title,
      body: notificationBody(q.it, q.it.remind),
      largeBody: notificationBody(q.it, q.it.remind),
      channelId: CHANNEL_ID,
      smallIcon: 'ic_stat_notify',
      iconColor: '#1E4D3B',
      autoCancel: true,
      schedule: { at: new Date(q.at), allowWhileIdle: true },
      extra: { itemId: q.it.id, date: q.key },
    }));
    if (notifications.length) await LN.schedule({ notifications });
  }

  async function ensurePermission() {
    if (!LN) return true;
    try {
      let p = await LN.checkPermissions();
      if (p.display === 'prompt' || p.display === 'prompt-with-rationale') p = await LN.requestPermissions();
      return p.display === 'granted';
    } catch (err) {
      console.error('Permission check failed:', err && err.message);
      return false;
    }
  }

  let bannerAction = null;
  async function refreshBanner() {
    const banner = $('banner');
    if (!LN || !state.items.some((it) => it.remind >= 0)) { banner.hidden = true; return; }
    try {
      const p = await LN.checkPermissions();
      if (p.display !== 'granted') {
        $('bannerText').textContent = 'التنبيهات مقفلة، فلن تصلك التذكيرات. اسمح بها من إعدادات الهاتف.';
        $('bannerBtn').textContent = 'السماح';
        bannerAction = async () => {
          const ok = await ensurePermission();
          if (ok) { await requestReschedule(); toast('تم تفعيل التنبيهات'); } else {
            toast('افتح الإعدادات ← التطبيقات ← اللواء وائل شوبير ← الإشعارات', true);
          }
        };
        banner.hidden = false;
        return;
      }
      if (typeof LN.checkExactNotificationSetting === 'function') {
        const ex = await LN.checkExactNotificationSetting();
        if (ex && ex.exact_alarm === 'denied') {
          $('bannerText').textContent = 'لكي تصل التذكيرات في وقتها بالضبط، فعّل «المنبهات والتذكيرات».';
          $('bannerBtn').textContent = 'تفعيل';
          bannerAction = async () => {
            try { await LN.changeExactNotificationSetting(); } catch (_) { /* user can do it manually */ }
          };
          banner.hidden = false;
          return;
        }
      }
      banner.hidden = true;
    } catch (err) {
      console.error('Banner check failed:', err && err.message);
      banner.hidden = true;
    }
  }

  async function setupNotifications() {
    if (!LN) return;
    try {
      await LN.createChannel({
        id: CHANNEL_ID,
        name: 'المواعيد والتذكيرات',
        description: 'تنبيهات المواعيد والتذكيرات التي تضيفها',
        importance: 5,
        visibility: 1,
        vibration: true,
        lights: true,
        lightColor: '#D4A63E',
      });
    } catch (err) {
      console.error('Channel setup failed:', err && err.message);
    }
    try {
      await LN.addListener('localNotificationActionPerformed', (ev) => {
        const extra = ev && ev.notification && ev.notification.extra;
        if (extra && isValidKey(extra.date)) {
          closeSheet(true);
          selectDate(extra.date, { flashId: typeof extra.itemId === 'string' ? extra.itemId : null });
        }
      });
    } catch (err) {
      console.error('Listener setup failed:', err && err.message);
    }
  }

  // ---------------------------------------------------------------- sheet (add / edit)
  const form = $('form');
  function buildChips() {
    const remind = $('remindChips');
    for (const o of REMIND_OPTIONS) {
      remind.append(h('label', { class: 'chip' },
        h('input', { type: 'radio', name: 'remind', value: String(o.v) }),
        h('span', { text: o.label })));
    }
    const repeat = $('repeatChips');
    for (const o of REPEAT_OPTIONS) {
      repeat.append(h('label', { class: 'chip' },
        h('input', { type: 'radio', name: 'repeat', value: o.v }),
        h('span', { text: o.label })));
    }
    const dates = $('dateChips');
    [['اليوم', 0], ['غدًا', 1], ['بعد غد', 2]].forEach(([label, offset]) => {
      dates.append(h('button', { type: 'button', class: 'chip', 'data-offset': String(offset), 'aria-pressed': 'false', text: label }));
    });
  }

  function syncDateChips() {
    const v = $('date').value;
    const base = parseKey(todayKey());
    for (const b of $('dateChips').querySelectorAll('button')) {
      b.setAttribute('aria-pressed', v === keyOf(addDays(base, Number(b.dataset.offset))) ? 'true' : 'false');
    }
  }

  function setRadio(name, value) {
    const el = form.querySelector(`input[name="${name}"][value="${CSS.escape(String(value))}"]`);
    if (el) el.checked = true;
  }
  const getRadio = (name) => {
    const el = form.querySelector(`input[name="${name}"]:checked`);
    return el ? el.value : null;
  };

  function syncKindLabels() {
    const kind = getRadio('kind');
    $('titleLabel').textContent = kind === 'reminder' ? 'بماذا نذكّرك؟' : 'ما هو الموعد؟';
    $('title').placeholder = kind === 'reminder' ? 'مثال: الدواء، اتصال، دفع فاتورة' : 'مثال: اجتماع، زيارة، مناسبة';
  }

  function syncRemindHint() {
    const hint = $('remindHint');
    if (!LN && getRadio('remind') !== '-1') {
      hint.textContent = 'التنبيهات تعمل في تطبيق الأندرويد.';
      hint.hidden = false;
    } else {
      hint.hidden = true;
    }
  }

  function defaultTime() {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    return `${pad(d.getHours())}:00`;
  }

  let remindTouched = false;
  function openSheet(item) {
    state.editingId = item ? item.id : null;
    form.reset();
    clearErrors();
    remindTouched = !!item;
    $('sheetTitle').textContent = item ? 'تعديل' : 'إضافة جديدة';
    $('deleteBtn').hidden = !item;
    const kind = item ? item.kind : 'event';
    setRadio('kind', kind);
    $('title').value = item ? item.title : '';
    $('note').value = item ? item.note : '';
    const tKey = todayKey();
    $('date').value = item ? item.date : (state.selected < tKey ? tKey : state.selected);
    $('time').value = item ? item.time : defaultTime();
    setRadio('remind', item ? item.remind : DEFAULT_REMIND[kind]);
    setRadio('repeat', item ? item.repeat : 'none');
    syncKindLabels();
    syncDateChips();
    syncRemindHint();

    $('backdrop').hidden = false;
    $('sheet').hidden = false;
    document.body.style.overflow = 'hidden';
    $('sheet').querySelector('.sheet-body').scrollTop = 0;
    if (!(history.state && history.state.sheet)) history.pushState({ sheet: true }, '');
    if (!item) setTimeout(() => $('title').focus(), 280);
  }

  function hideSheet() {
    $('sheet').hidden = true;
    $('backdrop').hidden = true;
    $('confirm').hidden = true;
    document.body.style.overflow = '';
    state.editingId = null;
  }
  /** Closes through history so the Android back button and the X button behave the same. */
  function closeSheet(silent) {
    if ($('sheet').hidden) return;
    if (history.state && history.state.sheet) {
      history.back();
      if (silent) hideSheet();
    } else {
      hideSheet();
    }
  }

  function clearErrors() {
    for (const id of ['titleError', 'whenError']) $(id).hidden = true;
    for (const id of ['title', 'date', 'time']) $(id).removeAttribute('aria-invalid');
  }

  let saving = false;
  async function onSubmit(e) {
    e.preventDefault();
    if (saving) return; // ignore double taps
    clearErrors();
    const draft = {
      id: state.editingId || newId(),
      kind: getRadio('kind'),
      title: $('title').value,
      note: $('note').value,
      date: $('date').value,
      time: $('time').value,
      remind: Number(getRadio('remind')),
      repeat: getRadio('repeat'),
    };
    let bad = false;
    if (!cleanText(draft.title, MAX_TITLE)) {
      $('titleError').hidden = false; $('title').setAttribute('aria-invalid', 'true'); bad = true;
    }
    if (!isValidKey(draft.date) || !TIME_RE.test(draft.time)) {
      $('whenError').hidden = false;
      if (!isValidKey(draft.date)) $('date').setAttribute('aria-invalid', 'true');
      if (!TIME_RE.test(draft.time)) $('time').setAttribute('aria-invalid', 'true');
      bad = true;
    }
    if (bad) { (bad && $('titleError').hidden ? $('date') : $('title')).focus(); return; }

    const existing = state.items.find((x) => x.id === state.editingId);
    if (!existing && state.items.length >= MAX_ITEMS) { toast('وصلت للحد الأقصى، احذف بعض العناصر القديمة', true); return; }
    const sameSchedule = existing && existing.date === draft.date && existing.repeat === draft.repeat;
    const item = sanitize({
      ...draft,
      done: sameSchedule ? existing.done : [],
      createdAt: existing ? existing.createdAt : Date.now(),
    });
    if (!item) { toast('تأكد من البيانات وحاول مرة أخرى', true); return; }

    saving = true;
    try {
      if (existing) state.items = state.items.map((x) => (x.id === item.id ? item : x));
      else state.items.push(item);
      await persist();
      closeSheet(true);
      selectDate(item.date, { flashId: item.id });

      if (item.remind >= 0 && LN) {
        const ok = await ensurePermission();
        await requestReschedule();
        toast(ok ? `تم الحفظ · سنذكّرك ${remindLabel(item.remind)}` : 'تم الحفظ، لكن التنبيهات مقفلة', !ok);
      } else {
        await requestReschedule();
        toast(existing ? 'تم حفظ التعديل' : 'تمت الإضافة');
      }
    } finally {
      saving = false;
    }
  }

  function askDelete() {
    const it = state.items.find((x) => x.id === state.editingId);
    if (!it) return;
    $('confirmText').textContent = `«${it.title}»${it.repeat !== 'none' ? ' وكل تكراراته' : ''} — لا يمكن التراجع عن الحذف.`;
    $('confirm').hidden = false;
    $('confirmNo').focus();
  }
  async function doDelete() {
    const id = state.editingId;
    $('confirm').hidden = true;
    if (!id) return;
    state.items = state.items.filter((x) => x.id !== id);
    await persist();
    closeSheet(true);
    render();
    await requestReschedule();
    toast('تم الحذف');
  }

  async function toggleDone(id) {
    const it = state.items.find((x) => x.id === id);
    if (!it) return;
    const key = state.selected;
    const done = new Set(it.done);
    if (done.has(key)) done.delete(key); else done.add(key);
    const updated = sanitize({ ...it, done: Array.from(done) });
    if (!updated) return;
    state.items = state.items.map((x) => (x.id === id ? updated : x));
    renderDay();
    await persist();
    await requestReschedule();
    if (updated.done.includes(key)) toast('أحسنت، تم ✓');
  }

  // ---------------------------------------------------------------- events
  function bindEvents() {
    $('prevMonth').addEventListener('click', () => shiftMonth(-1));
    $('nextMonth').addEventListener('click', () => shiftMonth(1));
    $('todayBtn').addEventListener('click', () => selectDate(todayKey()));
    $('fab').addEventListener('click', () => openSheet(null));
    $('emptyAdd').addEventListener('click', () => openSheet(null));
    $('closeSheet').addEventListener('click', () => closeSheet());
    $('backdrop').addEventListener('click', () => closeSheet());
    $('deleteBtn').addEventListener('click', askDelete);
    $('confirmYes').addEventListener('click', doDelete);
    $('confirmNo').addEventListener('click', () => { $('confirm').hidden = true; });
    $('bannerBtn').addEventListener('click', () => { if (bannerAction) bannerAction(); });
    form.addEventListener('submit', onSubmit);

    $('grid').addEventListener('click', (e) => {
      const cell = e.target.closest('.day-cell[data-key]');
      if (cell) selectDate(cell.dataset.key);
    });
    $('items').addEventListener('click', (e) => {
      const done = e.target.closest('[data-done]');
      if (done) { toggleDone(done.dataset.done); return; }
      const edit = e.target.closest('[data-edit]');
      if (edit) {
        const it = state.items.find((x) => x.id === edit.dataset.edit);
        if (it) openSheet(it);
      }
    });

    form.addEventListener('change', (e) => {
      if (e.target.name === 'kind') {
        syncKindLabels();
        if (!remindTouched) setRadio('remind', DEFAULT_REMIND[getRadio('kind')]);
      }
      if (e.target.name === 'remind') { remindTouched = true; syncRemindHint(); }
      if (e.target.id === 'date') syncDateChips();
    });
    $('date').addEventListener('input', syncDateChips);
    $('title').addEventListener('input', () => { $('titleError').hidden = true; $('title').removeAttribute('aria-invalid'); });
    $('title').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('title').blur(); } });
    $('dateChips').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-offset]');
      if (!b) return;
      $('date').value = keyOf(addDays(parseKey(todayKey()), Number(b.dataset.offset)));
      $('date').removeAttribute('aria-invalid');
      $('whenError').hidden = true;
      syncDateChips();
    });

    window.addEventListener('popstate', () => {
      if (!$('confirm').hidden) { $('confirm').hidden = true; history.pushState({ sheet: true }, ''); return; }
      if (!$('sheet').hidden) hideSheet();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('confirm').hidden) $('confirm').hidden = true;
      else closeSheet();
    });

    // Swipe the calendar to change month (RTL: swipe right → next month).
    let sx = 0; let sy = 0; let tracking = false;
    const cal = document.querySelector('.calendar');
    cal.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) { tracking = false; return; }
      tracking = true; sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    }, { passive: true });
    cal.addEventListener('touchend', (e) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx; const dy = t.clientY - sy;
      if (Math.abs(dx) > 60 && Math.abs(dy) < 50) shiftMonth(dx > 0 ? 1 : -1);
    }, { passive: true });

    // Coming back to the app: refresh "today", and top up repeating reminders.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      const t = todayKey();
      if (t !== state.lastToday) {
        if (state.selected === state.lastToday) selectDate(t); else render();
        state.lastToday = t;
      } else {
        renderHeader();
      }
      requestReschedule();
    });
  }

  // ---------------------------------------------------------------- start
  async function start() {
    buildChips();
    bindEvents();
    render();
    state.items = await loadItems();
    render();
    await setupNotifications();
    await requestReschedule();
  }

  start().catch((err) => {
    console.error('Startup failed:', err && err.message);
    toast('حدث خطأ أثناء التشغيل، أعد فتح التطبيق', true);
  });
})();
