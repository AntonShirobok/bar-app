/* Бар · Mini App. Без сборки и зависимостей: один файл, экраны рисуются строками. */
"use strict";
const APP_VER = (document.currentScript && (document.currentScript.src.split("v=")[1] || "")) || "dev";  // номер из index.html — видно, свежая ли копия

const tg = window.Telegram ? window.Telegram.WebApp : null;
if (tg) { tg.ready(); tg.expand(); document.documentElement.dataset.tg = "1"; }

/** Тема: auto — как в Telegram, light / dark — своя, сильнее телеграмной. Хранится на этом телефоне. */
const THEME_BG = { light: ["#f1f1f4", "#ffffff"], dark: ["#0e0e11", "#1a1a1f"] };
function applyTheme(t, fromUser) {
  const root = document.documentElement;
  if (THEME_BG[t]) root.dataset.theme = t; else delete root.dataset.theme;
  if (!tg || (!THEME_BG[t] && !fromUser)) return;  // «как в Telegram» при запуске — ничего не трогаем
  try {
    const [bg, card] = THEME_BG[t] || ["bg_color", "bg_color"];
    if (tg.setHeaderColor) tg.setHeaderColor(THEME_BG[t] ? bg : "bg_color");
    if (tg.setBackgroundColor) tg.setBackgroundColor(THEME_BG[t] ? bg : "bg_color");
    if (tg.setBottomBarColor) tg.setBottomBarColor(THEME_BG[t] ? card : "bottom_bar_bg_color");
  } catch (e) { /* старый Telegram — только страница */ }
}
let THEME = "auto";
try { THEME = localStorage.getItem("bar:theme") || "auto"; } catch (e) {}
applyTheme(THEME);

const $ = (s, el = document) => el.querySelector(s);
const view = $("#view");
const WD = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const MGEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

const S = { me: null, tab: "home", tk: null, stack: [], sched: { offset: 0, day: null }, menuMode: "bar",
            money: { offset: 0, week: 0 }, tkf: { sheet: 0, q: "", pf: false }, stockAll: false, alFilter: new Set() };

// ---------- утилиты ----------
function h(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function fmt(x) {
  if (x === null || x === undefined || isNaN(x)) return "";
  const a = Math.abs(x);
  let s = a >= 10 ? String(Math.round(x)) : (a < 1 ? x.toFixed(2) : x.toFixed(1));
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s.replace(".", ",") || "0";
}
function money(v) { return v === null || v === undefined ? "—" : Math.round(v).toLocaleString("ru-RU") + " ₽"; }
function hrs(v) { return v === null || v === undefined ? "—" : String(Math.round(v * 100) / 100).replace(".", ","); }
function dt(iso) { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); }
function human(iso) { const d = dt(iso); return `${WD[d.getDay()]}, ${d.getDate()} ${MGEN[d.getMonth()]}`; }
function toast(t) { const el = $("#toast"); el.textContent = t; el.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("on"), 2600); }
function haptic(kind = "light") { try { tg && tg.HapticFeedback.impactOccurred(kind); } catch (e) {} }
function setHead(title, sub = "") { $("#title").textContent = title; $("#sub").textContent = sub; }
function loading() { view.innerHTML = '<div class="loader"></div>'; }
function empty(icon, text) { return `<div class="empty"><span class="e">${icon}</span>${text}</div>`; }

/** Запрос к Apps Script: POST {action, initData, ...}. text/plain — чтобы браузер не делал лишний preflight. */
async function api(action, params = {}) {
  const url = (window.BAR_CONFIG || {}).API_URL;
  if (!url) { const err = new Error("Приложение ещё не настроено: нет адреса скрипта в config.js"); err.status = 500; throw err; }
  let r;
  try {
    r = await fetch(url, { method: "POST", redirect: "follow", headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, initData: tg && tg.initData ? tg.initData : "", ...params }) });
  } catch (e) { throw new Error("Нет связи с сервером. Проверь интернет и попробуй ещё раз."); }
  let j = {};
  try { j = await r.json(); } catch (e) { throw new Error("Сервер ответил странно — попробуй ещё раз через минуту"); }
  if (!j.ok) { const err = new Error(j.error || "Ошибка"); err.status = j.status || 500; throw err; }
  return j.data;
}
function fail(e) { view.innerHTML = empty("😕", h(e.message)); }

// Кэш на телефоне: экран сразу рисуется из прошлых данных, свежие подтягиваются в фоне.
const UID = (tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.id) || "x";
const LS = {
  get(k) { try { return JSON.parse(localStorage.getItem(`bar:${UID}:${k}`)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(`bar:${UID}:${k}`, JSON.stringify(v)); } catch (e) {} },
};
S.tok = 0;
/** Нарисовать из кэша (если есть), запросить свежее и перерисовать, если пользователь ещё на этом экране и данные изменились. */
async function fresh(key, action, params, draw) {
  const tok = ++S.tok, cached = LS.get(key);
  if (cached) draw(cached, true); else loading();
  try {
    const d = await api(action, params);
    LS.set(key, d);
    if (tok === S.tok && JSON.stringify(d) !== JSON.stringify(cached)) draw(d, false);
  } catch (e) {
    if (tok !== S.tok) return;
    if (!cached) fail(e); else toast("Не обновилось: " + e.message);
  }
}

// ---------- навигация ----------
function go(tab) {
  S.tab = tab; S.stack = [];
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
  backBtn();
  window.scrollTo(0, 0);
  ({ home: renderHome, schedule: renderSchedule, menu: renderMenu, more: renderMore, bar: renderBar })[tab]();
}
function push(fn) { S.stack.push(fn); backBtn(); window.scrollTo(0, 0); fn(); }
function replaceTop(fn) { S.stack[S.stack.length - 1] = fn; fn(); }
function back() { S.stack.pop(); backBtn(); const f = S.stack[S.stack.length - 1]; f ? f() : go(S.tab); }
function backBtn() {
  if (!tg) return;
  if (S.stack.length) tg.BackButton.show(); else tg.BackButton.hide();
}
if (tg) tg.BackButton.onClick(back);
$("#tabs").addEventListener("click", e => { const b = e.target.closest("button[data-tab]"); if (b) { haptic(); go(b.dataset.tab); } });
view.addEventListener("click", e => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const fn = ACT[el.dataset.act];
  if (fn) { haptic(); fn(el.dataset, el, e); }
});
const ACT = {};

// ================= ГЛАВНАЯ =================
function firstName() {
  const n = (S.me.tg_name || "").trim().split(/\s+/)[0];
  return n || "";
}

/** Кольцо «ставка / процент от продаж» — из чего зарплата. Чаевые сюда не входят. Подписи рядом, чтобы читалось и без цвета. */
function donut(split) {
  const R = 34, C = 2 * Math.PI * R, a = C * split.base_pct / 100;
  return `<div class="split">
    <svg viewBox="0 0 88 88" width="88" height="88" role="img" aria-label="Ставка ${split.base_pct}%, процент от продаж ${split.pct_pct}%">
      <circle cx="44" cy="44" r="${R}" fill="none" stroke="var(--c-tips)" stroke-width="12"/>
      <circle cx="44" cy="44" r="${R}" fill="none" stroke="var(--c-base)" stroke-width="12"
        stroke-dasharray="${a} ${C - a}" transform="rotate(-90 44 44)"/>
    </svg>
    <div class="legend">
      <div><span class="dot" style="background:var(--c-base)"></span>${split.oklad ? "Оклад" : "Ставка"} <b>${split.base_pct}%</b><div class="muted small num">${money(split.base)}</div></div>
      <div><span class="dot" style="background:var(--c-tips)"></span>Процент <b>${split.pct_pct}%</b><div class="muted small num">${money(split.pct)}</div></div>
    </div></div>`;
}

async function renderHome() {
  setHead(firstName() ? `Привет, ${firstName()}` : "Главная", human(S.me.today));
  if (S.booting) { const c = LS.get("dash"); if (c) drawHome(c); else loading(); return; }  // главную принесёт boot
  fresh("dash", "dashboard", {}, drawHome);
}
function initialsOf(name) {
  const w = String(name || "").trim().split(/\s+/);
  return ((w[0] || "?")[0] + (w[1] ? w[1][0] : "")).toUpperCase();
}
const num0 = v => parseFloat(String(v || "").replace(/\s/g, "").replace(",", ".")) || 0;

/** Главная: смена → деньги месяца → неделя → быстрые действия → бар → кто сегодня. */
function drawHome(d) {
  S.dash = d;
  let html = "";

  // 1. ближайшая смена — цветная карточка
  if (d.next) {
    const n = d.next, when = n.day === d.today ? "сегодня" : n.day === addDaysIso(d.today, 1) ? "завтра" : human(n.day);
    const team = n.team || [];
    html += `<div class="card hero2"><div class="small">Ближайшая смена · ${h(when)}</div>
      <div class="row between" style="align-items:flex-end;margin-top:2px"><div class="hero-time num">${n.start}–${n.end}</div>
      <div class="small">${hrs(n.hours)} ч${n.station ? ` · точка ${h(n.station)}` : ""}</div></div>
      ${team.length ? `<div class="ava-row">${team.slice(0, 4).map(t => `<span class="ava-s" title="${h(t)}">${h(initialsOf(t))}</span>`).join("")}
        <span class="small">${team.length > 4 ? `и ещё ${team.length - 4}` : "с тобой"}</span></div>` : ""}</div>`;
  } else if (S.me.schedule_name) {
    html += `<div class="card">${empty("🌴", "Ближайших смен в графике нет")}</div>`;
  } else {
    html += `<div class="card">${empty("🙈", "Владелец ещё не связал тебя с графиком")}</div>`;
  }

  // 2. деньги за месяц: сумма, полоса «ставка / процент», плитки
  if (d.month) {
    const m = d.month, x = m.row;
    const sp = m.split, basePct = sp ? sp.base_pct : 100;
    const done = d.month_shifts !== undefined ? d.month_shifts - d.month_left : null;
    html += `<div class="card"><div class="row between small muted"><span>${h(m.title)} · ${x ? (m.live ? "зарплата сейчас" : "зарплата к выплате") : "предварительно"}</span>
      ${m.prev_title ? `<span class="link" data-act="moPrev">${h(m.prev_title)} ›</span>` : ""}</div>`;
    if (x) {
      html += `<div class="big num" style="margin:2px 0 8px">${money(x.total)}</div>
        <div class="mbar"><i style="width:${basePct}%;background:var(--c-base)"></i><i style="width:${100 - basePct}%;background:var(--c-tips)"></i></div>
        <div class="legend2 small muted"><span><span class="dot" style="background:var(--c-base)"></span>${x.rate >= 5000 ? "оклад" : "ставка"} ${money(sp ? sp.base : 0)}</span>
        <span><span class="dot" style="background:var(--c-tips)"></span>${sp && sp.pct ? `процент ${money(sp.pct)}` : m.live ? "процент — ждём продажи" : "процент 0"}</span></div>
        ${x.deduct ? `<div class="small muted">Вычет −${money(x.deduct)}</div>` : ""}`;
    } else {
      html += `<div class="big num" style="margin:2px 0 4px">${m.estimate ? "≈" + money(m.estimate) : hrs(m.hours) + " ч"}</div>
        <div class="small muted">${m.estimate ? `по ставке за ${hrs(m.hours)} ч, без процента` : `отработано ${h(m.source || "")}`}</div>`;
    }
    html += `<div class="kpis"><div><small>Часы</small><b class="num">${hrs(x ? x.hours : m.hours)}</b></div>
      <div><small>Чаевые</small><b class="num">${m.tips ? money(m.tips.sum).replace(/\s?₽$/, "") : "—"}</b></div>
      <div><small>Смен</small><b class="num">${done !== null ? `${done} / ${d.month_shifts}` : "—"}</b></div></div></div>`;
  }

  // 2б. официант: свой месяц — ставка × часы и свои чаевые
  if (d.waiter) html += waiterCard(d.waiter);
  if (d.waiter_weeks && d.waiter_weeks.length) html += waiterWeeksHtml(d.waiter_weeks);

  // 3. неделя: к выдаче и столбики по дням
  if (d.week && d.week.me && S.me.can_hours) {
    html += weekCarouselHtml(d.week);
  } else if (!S.me.tips_name && S.me.can_hours) {
    html += `<div class="card muted small">Деньги появятся, когда владелец свяжет тебя с таблицей чаевых.</div>`;
  }

  // 4. быстрые действия
  const qa = [];
  if (d.waiter) qa.push(`<div class="card tapcard qa" data-act="wDay"><span class="qa-ic">💵</span><b>Чаевые за смену</b><small class="muted">и время, если не как в графике</small></div>`);
  if (S.me.can_hours) qa.push(`<div class="card tapcard qa" data-act="hoursForm"><span class="qa-ic">🕒</span><b>Записать часы</b><small class="muted">за смену</small></div>`);
  if (d.stock_to_make !== undefined) qa.push(`<div class="card tapcard qa" data-act="openStock"><span class="qa-ic">🧪</span><b>Заготовки</b>
    <small style="color:${d.stock_to_make ? "var(--warn)" : "var(--ok)"}">${d.stock_to_make ? `нужно ${d.stock_to_make} поз.` : "всё есть"}</small></div>`);
  if (qa.length) html += `<div class="qa-grid ${qa.length === 1 ? "one" : ""}">${qa.join("")}</div>`;

  // 5. бар сейчас — одной строкой
  if (d.bar) {
    const titles = d.bar.counter_titles || [{ key: "highball", icon: "🥃" }, { key: "champagne", icon: "🍾" }];
    html += `<div class="card tapcard row between" data-act="openBar"><div><div class="small muted">Грязнульки · отметились ${d.bar.total}</div>
      <div style="font-weight:600">${titles.map(t => `${t.icon} ${(d.bar.counters[t.key] || 0).toLocaleString("ru-RU")}`).join(" · ")}</div></div><span class="chev"></span></div>`;
  }

  // 6. кто сегодня
  if (d.today_team && d.today_team.length) {
    const groups = {};
    d.today_team.forEach(p => (groups[p.section] = groups[p.section] || []).push(p));
    html += `<div class="card"><h2>Сегодня на смене</h2>${Object.entries(groups).map(([sec, ps]) => `<div class="muted small" style="margin-top:6px">${h(sec)}</div>
      <div class="chips wrap">${ps.map(p => `<span class="chip ${p.me ? "on" : ""}">${h(p.name)} <span class="num">${p.start}</span></span>`).join("")}</div>`).join("")}</div>`;
  }
  if (d.errors && d.errors.length) html += `<div class="muted small" style="text-align:center">Не всё загрузилось: ${h(d.errors.join("; "))}</div>`;
  view.innerHTML = html;
  initWeekCarousel();
}
function addDaysIso(iso, n) { const x = dt(iso); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; }
ACT.openStock = () => push(renderStock);
ACT.moHistory = () => push(renderMoneyHistory);
ACT.moPrev = () => { S.money.offset = -1; push(renderMoneyHistory); };

/** Чаевые — отдельно от зарплаты: сумма колонки «Чаевые» по неделям месяца. */
function tipsLine(t) {
  if (!t || (!t.weeks && !t.missed)) return "";
  return `<div class="sep"></div><div class="stat"><span>Чаевые за месяц <span class="muted small">по неделям · ${t.weeks} нед.</span></span><b class="num">${money(t.sum)}</b></div>
    <div class="muted small">Выдаются понедельно, в зарплату не входят.${t.missed ? " Часть недель уже перезаписана в таблице." : ""}</div>`;
}
ACT.weekDetail = () => push(renderWeekDetail);

async function renderMoneyHistory() {
  setHead("Деньги по месяцам", S.me.tips_name || "");
  loading();
  let m;
  try { m = await api("money", { offset: S.money.offset }); } catch (e) { return fail(e); }
  view.innerHTML = monthCard(m);
}
function monthCard(r) {
  let html = `<div class="monthnav"><button data-act="moMonth" data-d="-1">‹</button>
    <b>${h(r.title)}</b><button data-act="moMonth" data-d="1" ${S.money.offset >= 0 ? "disabled" : ""}>›</button></div><div class="card">`;
  if (r.row && r.live) html += `<div class="muted small" style="margin-bottom:6px"><span class="tag warn">идёт месяц</span> по «ТабельБот»</div>`;
  if (r.row) {
    const x = r.row;
    html += `<div class="stat"><span>Часы</span><b class="num">${hrs(x.hours)}</b></div>`;
    if (x.rate && x.rate >= 5000) html += `<div class="stat"><span>Оклад</span><span class="num">${money(x.rate)}</span></div>`;
    else if (x.rate) html += `<div class="stat"><span>По ставке <span class="muted small">${hrs(x.hours)} × ${money(x.rate)}</span></span><span class="num">${money(x.hours * x.rate)}</span></div>`;
    if (x.pct) html += `<div class="stat"><span>Процент от продаж${x.share ? ` <span class="muted small">доля ${h(x.share)}</span>` : ""}</span><span class="num">${money(x.pct)}</span></div>`;
    else if (r.live && !(x.rate >= 5000)) html += `<div class="stat"><span>Процент от продаж</span><span class="muted small">ещё не внесён</span></div>`;
    if (x.deduct) html += `<div class="stat"><span>Вычет</span><span class="num" style="color:var(--danger)">−${money(x.deduct)}</span></div>`;
    for (const e of r.extra) html += `<div class="stat small muted"><span>в т.ч. «${h(e.name)}»</span><span class="num">${hrs(e.hours)} ч${e.total ? " · " + money(e.total) : ""}</span></div>`;
    if (x.total !== null) html += `<div class="total"><span>${r.live ? "Зарплата сейчас" : "Зарплата к выплате"}</span><span class="big num">${money(x.total)}</span></div>`;
    if (r.split && r.split.pct) html += donut(r.split);
    html += `<div class="muted small" style="margin-top:6px">Из листа «${h(r.tab)}»</div>`;
  } else {
    html += `<div class="stat"><span>Отработано пока</span><b class="num">${hrs(r.hours)} ч</b></div><div class="muted small">${h(r.source)}</div>`;
    if (r.rate_hint && r.rate_hint < 5000) html += `<div class="total"><span>По ставке ≈</span><span class="big num">${money(r.hours * r.rate_hint)}</span></div>
      <div class="muted small">${hrs(r.hours)} × ${money(r.rate_hint)}, без процента от продаж</div>`;
    else if (r.rate_hint) html += `<div class="stat"><span>Оклад</span><span class="num">${money(r.rate_hint)}</span></div>`;
    html += `<div class="muted small" style="margin-top:8px"><span class="tag warn">предварительно</span> Процент от продаж посчитается в «ТабельБот» и листе месяца.</div>`;
  }
  return html + tipsLine(r.tips) + "</div>";
}
ACT.moMonth = ds => { S.money.offset = Math.min(0, S.money.offset + Number(ds.d)); renderMoneyHistory(); };

async function renderWeekDetail() {
  setHead("Неделя", S.me.tips_name || "");
  loading();
  let w;
  try { w = await api("week", { offset: S.money.week }); } catch (e) {
    view.innerHTML = `<div class="card">${empty("😕", h(e.message))}${S.money.week ? '<button class="btn ghost" data-act="week" data-d="1">К текущей неделе</button>' : ""}</div>`;
    return;
  }
  view.innerHTML = weekCard(w);
}
function weekCard(w) {
  const me = w.me, mon = dt(w.monday), end = new Date(mon); end.setDate(end.getDate() + 6);
  const p2 = n => String(n).padStart(2, "0");
  let html = `<div class="card"><div class="row between"><h2 style="margin:0">${mon.getDate()}.${p2(mon.getMonth() + 1)} – ${end.getDate()}.${p2(end.getMonth() + 1)}</h2>
    <div class="btns" style="gap:4px;flex:none"><button class="btn sm ghost" data-act="week" data-d="-1">‹</button>
    <button class="btn sm ghost" data-act="week" data-d="1" ${S.money.week >= 0 ? "disabled" : ""}>›</button></div></div>
    ${w.archived ? '<div class="muted small">из архива недель</div>' : ""}`;
  if (me) html += `<div class="row between" style="margin:10px 0 4px"><div><div class="muted small">Тебе к выдаче</div><div class="big num">${h(me.pay || "—")}</div></div>
    <div class="right"><div class="muted small">Взял</div><div class="num" style="font-size:18px;font-weight:600">${h(me.took || "—")}</div></div></div>`;
  else html += `<div class="muted small" style="margin:8px 0">Не нашёл «${h(w.tips_name)}» на листе «${h(w.tab)}».</div>`;
  html += `<table class="t" style="margin-top:6px"><tr><th>День</th><th class="r">Мои часы</th><th class="r">Бар</th><th class="r">Зал</th></tr>`;
  const today = S.me.today;
  w.days.forEach((d, i) => {
    const mine = me ? me.hours[i] : "", sent = me && me.sent ? me.sent[i] : "";
    const canDel = me && (mine || (sent && sent !== "нет")) && d.date <= today;
    html += `<tr class="${d.date === today ? "hl" : ""}"><td>${WD[dt(d.date).getDay()]} ${dt(d.date).getDate()}</td>
      <td class="r">${mine ? h(mine) : '<span class="muted">—</span>'}${sent && sent !== "нет" ? `<div class="muted small">${h(sent)}</div>` : ""}
      ${canDel ? `<div><a class="pf small" data-act="hoursDel" data-date="${d.date}">удалить</a></div>` : ""}</td>
      <td class="r">${h(d.bar || "—")}</td><td class="r">${h(d.hall || "—")}</td></tr>`;
  });
  html += `</table><div class="muted small" style="margin-top:6px">${w.archived ? "Архив" : "Лист"} «${h(w.tab)}»${w.netmonet ? ` · Нетмонет ${h(w.netmonet)}` : ""}</div>`;
  if (S.money.week === 0) html += `<button class="btn" data-act="hoursForm">＋ Записать часы</button>`;
  return html + "</div>";
}
ACT.week = ds => { S.money.week = Math.min(0, S.money.week + Number(ds.d)); renderWeekDetail(); };

// ---------- неделя на главной: карусель — текущая справа, 4 прошлых подгружены заранее; тап — подробности ----------
const WEEKS_BACK = 4;
function weekTitle(w, off) {
  if (off === 0) return "Эта неделя";
  if (off === -1) return "Прошлая неделя";
  if (!w || !w.monday) return "Неделя";
  const m = dt(w.monday), e = new Date(m); e.setDate(e.getDate() + 6);
  return `${m.getDate()} ${MGEN[m.getMonth()].slice(0, 3)} – ${e.getDate()} ${MGEN[e.getMonth()].slice(0, 3)}`;
}
function homeWeekHtml(w, off) {
  const me = w.me, today = S.me.today;
  if (!me) return `<div class="row between small muted"><span>${h(weekTitle(w, off))}</span></div><div class="muted small" style="margin:12px 0">Тебя нет на листе «${h(w.tab)}»</div>`;
  const hh = me.hours.map(num0), total = hh.reduce((a, v) => a + v, 0), max = Math.max(12, ...hh);
  return `<div class="row between small muted"><span>${h(weekTitle(w, off))} · к выдаче</span><span>${hrs(total)} ч${me.took ? ` · взял ${h(me.took)}` : ""}</span></div>
    <div class="num" style="font-size:22px;font-weight:700;margin:2px 0 10px">${h(me.pay || "—")}</div>
    <div class="wbars">${w.days.map((x, i) => `<div class="${x.date === today ? "on" : ""}"><i class="${hh[i] ? "f" : ""}" style="height:${hh[i] ? Math.max(18, hh[i] / max * 100) : 14}%"></i>
      <small>${WD[dt(x.date).getDay()].toLowerCase()}${hh[i] ? " " + hrs(hh[i]) : ""}</small></div>`).join("")}</div>`;
}
function weekSlide(x) {
  const body = x.w ? homeWeekHtml(x.w, x.off)
    : `<div class="small muted">${x.off === -1 ? "Прошлая неделя" : "Неделя"}</div><div class="muted small" style="margin:12px 0">${x.error ? h(x.error) : "Загружаю…"}</div>`;
  return `<div class="card tapcard wslide" data-act="weekSlide" data-o="${x.off}">${body}</div>`;
}
function weekDots(off) {
  const all = [];
  for (let o = -WEEKS_BACK; o <= 0; o++) all.push(`<i class="${o === off ? "on" : ""}"></i>`);
  return `${all.join("")}<span>${off < 0 ? "← к этой неделе" : "свайп → прошлые недели"}</span>`;
}
function weekCarouselHtml(cur) {
  const prev = LS.get("wkPrev") || [];
  const slides = [];
  for (let o = -WEEKS_BACK; o < 0; o++) slides.push(prev.find(x => x.off === o) || { off: o });
  slides.push({ off: 0, w: cur });
  return `<div class="wcar" id="wcar">${slides.map(weekSlide).join("")}</div><div class="wdots" id="wdots">${weekDots(0)}</div>`;
}
/** Встать на текущую неделю, следить за листанием, подгрузить прошлые недели. */
/** Карусель недель: встать на текущую (справа), при листании — переключать точки. */
function bindCarousel(car) {
  S.homeWeek = 0;
  car.scrollLeft = car.scrollWidth;
  let t = null;
  car.addEventListener("scroll", () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const idx = Math.round(car.scrollLeft / car.clientWidth), off = idx - WEEKS_BACK;
      if (off !== S.homeWeek) { S.homeWeek = off; haptic(); const d = $("#wdots"); if (d) d.innerHTML = weekDots(off); }
    }, 60);
  }, { passive: true });
}
function initWeekCarousel() {
  const car = $("#wcar");
  if (!car) return;
  bindCarousel(car);
  if (car.dataset.kind === "waiter") return;  // недели официанта уже пришли с главной
  if (S.wkPrevT && Date.now() - S.wkPrevT < 60000) return;  // главная рисуется дважды (кэш и свежая) — второй раз не грузим
  S.wkPrevT = Date.now();
  api("weeks_recent", { n: WEEKS_BACK }).then(r => {
    LS.set("wkPrev", r.weeks);
    const c = $("#wcar");
    if (!c) return;
    r.weeks.forEach(x => { const el = c.querySelector(`[data-o="${x.off}"]`); if (el) el.innerHTML = weekSlideInner(x); });
  }).catch(() => {});
}
function weekSlideInner(x) { const d = document.createElement("div"); d.innerHTML = weekSlide(x); return d.firstElementChild.innerHTML; }
ACT.weekSlide = ds => { S.money.week = Number(ds.o); push(renderWeekDetail); };

// ---------- неделя официанта на главной: та же карусель, столбики — часы, сверху — заработано за неделю ----------
function waiterWeekSlide(w) {
  const today = S.me.today, max = Math.max(10, ...w.days.map(x => x.hours));
  const title = weekTitle(w, w.off);
  return `<div class="card tapcard wslide" data-act="wWeek" data-o="${w.off}">
    <div class="row between small muted"><span>${h(title)} · заработано</span><span>${hrs(w.hours)} ч · чаевые ${money(w.tips)}</span></div>
    <div class="num" style="font-size:22px;font-weight:700;margin:2px 0 10px">${money(w.total)}</div>
    <div class="wbars">${w.days.map(x => `<div class="${x.date === today ? "on" : ""}"><i class="${x.hours ? "f" : ""}" style="height:${x.hours ? Math.max(18, x.hours / max * 100) : 14}%"></i>
      <small>${WD[dt(x.date).getDay()].toLowerCase()}${x.hours ? " " + hrs(x.hours) : ""}</small></div>`).join("")}</div></div>`;
}
function waiterWeeksHtml(weeks) {
  const list = weeks.slice(0, WEEKS_BACK + 1).reverse();  // слева прошлые, справа текущая
  return `<div class="wcar" id="wcar" data-kind="waiter">${list.map(waiterWeekSlide).join("")}</div><div class="wdots" id="wdots">${weekDots(0)}</div>`;
}
ACT.wWeek = ds => {  // неделя → экран месяца, где эта неделя
  const w = (S.dash && S.dash.waiter_weeks || []).find(x => x.off === Number(ds.o));
  const t = dt(S.me.today), m = w ? dt(w.days[6].date > S.me.today ? S.me.today : w.days[6].date) : t;
  push(() => renderWaiterMonth((m.getFullYear() - t.getFullYear()) * 12 + m.getMonth() - t.getMonth()));
};
ACT.hoursForm = () => push(renderHoursForm);
ACT.hoursDel = async ds => {
  if (!(await confirmBox(`Удалить часы за ${human(ds.date)}?`))) return;
  try {
    const r = await api("hours_delete", { date: ds.date });
    toast(`Удалил${r.old ? ` (было ${r.old} ч)` : ""}`); renderWeekDetail();
  } catch (e) { toast(e.message); }
};
function confirmBox(text) {
  return new Promise(res => { if (tg && tg.showConfirm) tg.showConfirm(text, ok => res(ok)); else res(confirm(text)); });
}
/** Время в 24-часовом формате: два списка (часы 00–23, минуты), без AM/PM из настроек телефона. */
function timeSel(id, val) {
  const [hh, mm] = String(val || "12:00").split(":").map(Number);
  const p2 = n => String(n).padStart(2, "0");
  const mins = [...new Set([...Array(12).keys()].map(i => i * 5).concat([mm || 0]))].sort((a, b) => a - b);
  return `<div class="tsel"><select class="f" id="${id}H" aria-label="Часы">${[...Array(24).keys()].map(x => `<option ${x === hh ? "selected" : ""}>${p2(x)}</option>`).join("")}</select>
    <span>:</span><select class="f" id="${id}M" aria-label="Минуты">${mins.map(x => `<option ${x === mm ? "selected" : ""}>${p2(x)}</option>`).join("")}</select></div>`;
}
function timeVal(id) { return `${$(`#${id}H`).value}:${$(`#${id}M`).value}`; }

async function renderHoursForm() {
  setHead("Записать часы", S.me.tips_name);
  const roles = (S.dash && S.dash.week && S.dash.week.me && S.dash.week.me.roles) || [];
  const opts = [];
  for (let i = 0; i < 7; i++) {
    const d = dt(S.me.today); d.setDate(d.getDate() - i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    opts.push(`<option value="${iso}">${i === 0 ? "Сегодня, " : i === 1 ? "Вчера, " : ""}${human(iso)}</option>`);
  }
  const nx = S.dash && S.dash.next && S.dash.next.day === S.me.today ? S.dash.next : null;
  view.innerHTML = `<div class="card">
    <label class="l">День</label><select class="f" id="hDay">${opts.join("")}</select>
    <div class="grid2"><div><label class="l">Пришёл</label>${timeSel("hS", nx ? nx.start : "12:00")}</div>
    <div><label class="l">Ушёл</label>${timeSel("hE", nx ? nx.end : "00:00")}</div></div>
    ${roles.length ? `<label class="l">Роль</label><select class="f" id="hR"><option value="">Основная</option>${roles.map(r => `<option>${h(r)}</option>`).join("")}</select>` : ""}
    <div class="muted small" style="margin-top:8px">Смена после полуночи считается за день, когда начиналась.</div>
    <button class="btn" data-act="hoursSave">Записать</button></div>`;
}
ACT.hoursSave = async (ds, el) => {
  el.disabled = true;
  try {
    const r = await api("hours_save", { date: $("#hDay").value, start: timeVal("hS"), end: timeVal("hE"), role: $("#hR") ? $("#hR").value : "" });
    try { tg && tg.HapticFeedback.notificationOccurred("success"); } catch (e) {}
    toast(`✅ ${hrs(r.hours)} ч → «${r.tab}»`);
    back();
  } catch (e) { toast(e.message); el.disabled = false; }
};

// ================= ГРАФИК: календарный месяц =================
async function renderSchedule() {
  setHead("График", S.me.schedule_name || "");
  fresh("sch" + S.sched.offset, "schedule", { offset: S.sched.offset }, d => { S.schedData = d; drawSchedule(); });
}
function drawSchedule() {
  const d = S.schedData, title = `${MONTHS[d.month - 1]} ${d.year}`;
  let html = `<div class="monthnav"><button data-act="schMonth" data-d="-1" ${S.sched.offset <= -2 ? "disabled" : ""}>‹</button>
    <b>${title}</b><button data-act="schMonth" data-d="1" ${S.sched.offset >= 2 ? "disabled" : ""}>›</button></div>`;
  if (!d.title) { view.innerHTML = html + `<div class="card">${empty("🗓", `В таблице графика нет листа «${title}»`)}</div>`; return; }
  const days = new Date(d.year, d.month, 0).getDate();
  const todayD = dt(d.today), isCur = todayD.getFullYear() === d.year && todayD.getMonth() + 1 === d.month;
  if (!S.sched.day || S.sched.day > days) S.sched.day = isCur ? todayD.getDate() : 1;
  const mine = {};
  d.mine.forEach(s => { const k = dt(s.day).getDate(); (mine[k] = mine[k] || []).push(s); });
  const timed = d.mine.filter(s => s.start), total = timed.reduce((a, s) => a + (s.hours || 0), 0);
  if (d.me) html += `<div class="row between small" style="margin:0 4px 8px"><span><b>${timed.length}</b> смен · <b>${hrs(total)}</b> ч</span>
    <a class="pf" data-act="calendar">📅 В календарь телефона</a></div>`;
  else html += `<div class="card muted small">Владелец ещё не связал тебя с графиком — ниже общий график.</div>`;
  const lead = (new Date(d.year, d.month - 1, 1).getDay() + 6) % 7;
  html += `<div class="cal"><div class="wd">Пн</div><div class="wd">Вт</div><div class="wd">Ср</div><div class="wd">Чт</div><div class="wd">Пт</div><div class="wd">Сб</div><div class="wd">Вс</div>`;
  for (let i = 0; i < lead; i++) html += `<div></div>`;
  for (let i = 1; i <= days; i++) {
    const my = mine[i] || [], first = my.find(s => s.start) || my[0];
    const cls = ["cd", my.length ? (first && first.start ? "mine" : "mark") : "", i === S.sched.day ? "sel" : "", isCur && i === todayD.getDate() ? "today" : "",
      isCur && i < todayD.getDate() ? "past" : ""].join(" ");
    html += `<button class="${cls}" data-act="schDay" data-i="${i}"><b>${i}</b><small>${first ? h(first.start || first.text) : ""}</small></button>`;
  }
  html += `</div>`;
  html += `<div id="dayPanel">${dayPanel(d, S.sched.day, mine[S.sched.day] || [])}</div>`;
  view.innerHTML = html;
}
function dayPanel(d, day, my) {
  const iso = `${d.year}-${String(d.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  let html = `<div class="card"><h3>${human(iso)}</h3>`;
  if (my.length) html += my.map(s => `<div class="myshift"><b class="num">${s.start ? `${s.start}–${s.end}` : h(s.text)}</b>
    <span class="muted small">${h(s.section)}${s.station ? ` · точка ${h(s.station)}` : ""}${s.hours ? ` · ${hrs(s.hours)} ч` : ""}</span></div>`).join("");
  else if (d.me) html += `<div class="muted small" style="margin-bottom:6px">У тебя выходной</div>`;
  const groups = {};
  for (const p of d.people) {
    const v = p.shifts[String(day)];
    if (!v) continue;
    (groups[p.section] = groups[p.section] || []).push([p.name === p.section ? "" : p.name, v, p.name === d.me]);
  }
  const keys = Object.keys(groups);
  if (!keys.length) html += `<div class="muted small">Никого нет в графике</div>`;
  for (const sec of keys) {
    html += `<div class="muted small" style="margin-top:10px">${h(sec)}</div><div class="list">`;
    for (const [name, v, me] of groups[sec]) html += `<div class="item${me ? " meitem" : ""}"><div class="grow">${h(name || v)}</div>${name ? `<div class="num muted small">${h(v)}</div>` : ""}</div>`;
    html += `</div>`;
  }
  return html + `</div>`;
}
ACT.schMonth = ds => { S.sched.offset += Number(ds.d); S.sched.day = null; renderSchedule(); };
ACT.schDay = ds => { S.sched.day = Number(ds.i); drawSchedule(); $("#dayPanel").scrollIntoView({ behavior: "smooth", block: "nearest" }); };
ACT.calendar = async (ds, el) => {
  el.style.pointerEvents = "none";
  try {
    const c = await api("calendar");
    if (tg) tg.openLink(c.page); else window.open(c.page);
  } catch (e) { toast(e.message); }
  el.style.pointerEvents = "";
};

// ================= ТК =================
async function loadTK() {
  if (!S.tk) S.tk = await api("tk");
  return S.tk;
}
async function renderTK() {
  setHead("Тех. карты");
  if (!S.tk) loading();
  let d;
  try { d = await loadTK(); } catch (e) { return fail(e); }
  const f = S.tkf;
  let html = `<input class="search" id="tkq" placeholder="Поиск по названию или составу" value="${h(f.q)}">`;
  html += `<div class="chips">${d.sheets.map(s => `<button class="chip ${!f.q && f.sheet === s.idx ? "on" : ""}" data-act="tkSheet" data-i="${s.idx}">${h(s.title)}</button>`).join("")}</div>`;
  html += `<div id="tkList"></div>`;
  view.innerHTML = html;
  $("#tkq").addEventListener("input", e => { f.q = e.target.value; drawTKList(); view.querySelectorAll(".chip").forEach(c => c.classList.toggle("on", !f.q && Number(c.dataset.i) === f.sheet)); });
  drawTKList();
}
function norm(s) { return s.toLowerCase().replace(/ё/g, "е"); }
function drawTKList() {
  const d = S.tk, f = S.tkf;
  let list;
  if (f.q.trim()) {
    const words = norm(f.q).split(/\s+/).filter(Boolean);
    list = d.recipes.filter(r => { const hay = norm(r.name + " " + r.ing.map(i => i.name).join(" ")); return words.every(w => hay.includes(w)); });
    list.sort((a, b) => (norm(a.name).includes(words[0]) ? 0 : 1) - (norm(b.name).includes(words[0]) ? 0 : 1) || a.pf - b.pf);
  } else {
    list = d.recipes.filter(r => r.sheet === f.sheet);
  }
  const box = $("#tkList");
  if (!list.length) { box.innerHTML = `<div class="card">${empty("🔍", "Ничего не нашёл")}</div>`; return; }
  const groups = [];
  for (const r of list) {
    const g = f.q ? (r.pf ? "ПФ и допы" : "Позиции") : (r.pf ? "ПФ и допы" : (r.section || "Позиции"));
    let grp = groups.find(x => x[0] === g); if (!grp) groups.push(grp = [g, []]);
    grp[1].push(r);
  }
  groups.sort((a, b) => (a[0] === "ПФ и допы") - (b[0] === "ПФ и допы"));
  box.innerHTML = groups.map(([g, rs]) => `<div class="card"><h2>${h(g)} · ${rs.length}</h2><div class="list">${rs.slice(0, 200).map(r => `
    <div class="item tap chev" data-act="recipe" data-id="${r.id}"><div class="grow"><div class="t">${r.pf ? "🧪 " : ""}${h(r.name)} ${badge(r)}</div>
    <div class="s">${h(r.ing.slice(0, 4).map(i => i.name).join(", "))}${r.ing.length > 4 ? "…" : ""}</div></div></div>`).join("")}</div></div>`).join("");
}
function badge(r) {
  const m = (r.marker || "").toUpperCase();
  if (m.includes("NEW")) return '<span class="tag ok">NEW</span>';
  if (m.includes("ВЫВОД")) return '<span class="tag bad">выводим</span>';
  return "";
}
ACT.tkSheet = ds => { S.tkf.sheet = Number(ds.i); S.tkf.q = ""; renderTK(); };
ACT.recipe = ds => push(() => renderRecipe(ds.id));

function byId(id) { return S.tk.recipes.find(r => r.id === id); }
function packetSize(r) { return r.yield && r.packets ? r.yield / r.packets : null; }
function scale(r, vol) {
  return r.ing.map(i => {
    if (i.per !== null && r.portion) return i.per * vol / r.portion;
    if (i.amount !== null && r.yield) return i.amount * vol / r.yield;
    return null;
  });
}
function renderRecipe(id, calc) {
  const r = byId(id);
  if (!r) { view.innerHTML = empty("😕", "Тех. карта пропала — обнови список"); return; }
  setHead(r.name, (S.tk.sheets.find(s => s.idx === r.sheet) || {}).title || "");
  const ps = packetSize(r);
  const c = calc || { mode: "batch", n: 1 };
  const vol = c.mode === "ml" ? c.n : c.mode === "pack" ? c.n * (ps || 0) : c.mode === "port" ? c.n * (r.portion || 0) : (r.yield || null);
  const amounts = vol ? scale(r, vol) : r.ing.map(i => i.amount);
  let html = c.stock ? `<div class="card soft"><div class="row between"><div><div class="muted small">Сток · ${h(c.stock.name)}</div>
      <div>Нужно сделать <b class="num">${fmt(c.stock.make)} ${h(c.stock.unit)}</b>${c.note ? ` <span class="muted small">— ${h(c.note)}</span>` : ""}</div></div>
      <button class="btn sm ghost" data-act="stockPick" data-n="${h(c.stock.name)}">Другая ТК</button></div></div>` : "";
  html += `<div class="card"><div class="row between"><h3>${r.pf ? "🧪 " : ""}${h(r.name)}</h3>${badge(r)}</div>
    <div class="muted small">${[r.yield ? `выход ${fmt(r.yield)} ${h(r.unit)}` : "", r.packets && !r.pf ? `${fmt(r.packets)} пак.` : "", r.portion && !r.pf ? `порция ${fmt(r.portion)} ${h(r.unit)}` : ""].filter(Boolean).join(" · ")}</div>`;
  if (r.allergens.length) html += `<div style="margin-top:8px">${r.allergens.map(a => `<span class="tag warn">${h(S.tk.allergen_titles[a])}</span>`).join(" ")}
    ${r.allergens_checked ? "" : '<span class="muted small">— подсказка, не проверено</span>'}</div>`;
  html += `</div><div class="card"><h2>Пересчитать</h2><div class="chips">
    ${[["batch", "Как в ТК"], ["ml", r.unit === "гр" ? "Граммы" : "Миллилитры"], ...(ps && (!r.pf || c.mode === "pack") ? [["pack", "Пакеты"]] : []), ...(r.portion && !r.pf ? [["port", "Порции"]] : [])]
      .map(([m, t]) => `<button class="chip ${c.mode === m ? "on" : ""}" data-act="calcMode" data-id="${r.id}" data-m="${m}">${t}</button>`).join("")}</div>`;
  if (c.mode !== "batch") html += `<div class="row"><input class="f num" id="calcN" type="number" inputmode="decimal" min="0" step="any" value="${c.n}" style="max-width:140px">
    <span class="muted">${c.mode === "ml" ? h(r.unit) : c.mode === "pack" ? `пак. × ${fmt(ps)} ${h(r.unit)}` : `порц. × ${fmt(r.portion)} ${h(r.unit)}`}</span></div>
    ${vol ? `<div class="muted small" style="margin-top:6px">Итого выход: <b>${fmt(vol)} ${h(r.unit)}</b></div>` : ""}`;
  html += `<table class="t" style="margin-top:8px"><tr><th>Компонент</th><th class="r">Кол-во</th></tr>`;
  r.ing.forEach((i, n) => {
    const a = amounts[n];
    const name = i.link ? `<span class="pf" data-act="recipe" data-id="${i.link}">🧪 ${h(i.name)}</span>` : h(i.name);
    html += `<tr><td>${name}</td><td class="r num">${a !== null && a !== undefined ? `${fmt(a)} ${h(i.unit)}` : '<span class="muted">—</span>'}</td></tr>`;
  });
  html += `</table></div>`;
  if (r.method) html += `<div class="card"><h2>Приготовление</h2><div class="method">${h(r.method.trim())}</div></div>`;
  const usedIn = S.tk.recipes.filter(x => x.ing.some(i => i.link === r.id));
  if (usedIn.length) html += `<div class="card"><h2>Используется в</h2><div class="list">${usedIn.map(x => `<div class="item tap chev" data-act="recipe" data-id="${x.id}"><div class="t">${h(x.name)}</div></div>`).join("")}</div></div>`;
  view.innerHTML = html;
  const inp = $("#calcN");
  if (inp) inp.addEventListener("change", e => {
    const v = parseFloat(String(e.target.value).replace(",", "."));
    replaceTop(() => renderRecipe(id, { ...c, n: v > 0 ? v : 1, note: "" }));
  });
}
ACT.calcMode = ds => {
  const r = byId(ds.id), ps = packetSize(r);
  const n = ds.m === "ml" ? (r.yield || 1000) : ds.m === "pack" ? (r.packets || 1) : ds.m === "port" ? Math.round((r.yield || 0) / (r.portion || 1)) || 10 : 1;
  replaceTop(() => renderRecipe(ds.id, { mode: ds.m, n }));
};

// ================= ЗАГОТОВКИ =================
async function renderStock() {
  setHead("Заготовки", "Сток ПФ");
  loading();
  let d;
  try { [d] = await Promise.all([api("stock"), loadTK()]); } catch (e) { return fail(e); }
  S.stock = d;
  const items = S.stockAll ? d.items : d.items.filter(i => i.make > 0);
  const need = d.items.filter(i => i.make > 0).length;
  let html = `<div class="seg"><button data-act="stockMode" data-a="0" class="${S.stockAll ? "" : "on"}">Нужно сделать · ${need}</button>
    <button data-act="stockMode" data-a="1" class="${S.stockAll ? "on" : ""}">Весь сток</button></div>`;
  if (!items.length) { view.innerHTML = html + `<div class="card">${empty("✅", "Всё есть, ничего делать не нужно")}</div>`; return; }
  const groups = {};
  for (const i of items) (groups[i.section] = groups[i.section] || []).push(i);
  for (const [sec, list] of Object.entries(groups)) {
    html += `<div class="card"><h2>${h(sec)}</h2><div class="list">${list.map(i => `<div class="item ${i.link ? "tap chev" : ""}" ${i.link ? `data-act="stockOpen" data-n="${h(i.name)}"` : ""}><div class="grow"><div class="t">${i.link ? "🧪 " : ""}${h(i.name)}</div>
      <div class="s">есть ${fmt(i.have ?? 0) || 0} из ${fmt(i.need ?? 0) || 0} ${h(i.unit)}${i.link ? "" : ` · <span class="link" data-act="stockPick" data-n="${h(i.name)}">привязать ТК</span>`}</div></div>
      ${i.make > 0 ? `<div class="right"><b class="num">${fmt(i.make)}</b> <span class="muted small">${h(i.unit)}</span></div>` : '<span class="tag ok">есть</span>'}</div>`).join("")}</div></div>`;
  }
  view.innerHTML = html;
}
ACT.stockMode = ds => { S.stockAll = ds.a === "1"; renderStock(); };

/** Сколько сделать по ТК: пакеты/бутылки/штуки — пакетами ТК, кг — граммами, л — миллилитрами. */
function stockCalc(i, r) {
  const u = String(i.unit || "").toLowerCase().replace(/\.$/, ""), make = i.make > 0 ? i.make : 0;
  const stock = { name: i.name, make, unit: i.unit };
  if (!make) return { mode: "batch", n: 1, stock, note: "по стоку всё есть" };
  if (u === "кг" && r.unit === "гр") return { mode: "ml", n: make * 1000, stock };
  if (u === "л" && r.unit === "мл") return { mode: "ml", n: make * 1000, stock };
  if (r.yield && r.packets) return { mode: "pack", n: make, stock };
  return { mode: "batch", n: 1, stock, note: "в ТК нет пакетов — посчитай по выходу" };
}
ACT.stockOpen = ds => {
  const i = (S.stock && S.stock.items || []).find(x => x.name === ds.n), r = i && byId(i.link);
  if (!r) return toast("Тех. карта не найдена — обнови список");
  push(() => renderRecipe(r.id, stockCalc(i, r)));
};
ACT.stockPick = (ds, el, e) => { if (e) e.stopPropagation(); push(() => renderStockPick(ds.n)); };

/** Выбор тех. карты для позиции стока: сначала похожие по словам, поиск по всем. */
function renderStockPick(name) {
  setHead("Привязать ТК", name);
  const words = s => String(s).toLowerCase().replace(/ё/g, "е").replace(/\([^)]*\)/g, " ").split(/[^0-9a-zа-я]+/).filter(w => w.length > 2);
  const mine = words(name);
  const score = r => words(r.name).filter(w => mine.some(m => m.slice(0, 4) === w.slice(0, 4))).length;
  const i = (S.stock && S.stock.items || []).find(x => x.name === name);
  const draw = q => {
    const qq = q.trim().toLowerCase().replace(/ё/g, "е");
    let list = S.tk.recipes.map(r => ({ r, s: score(r) }));
    list = qq ? list.filter(x => x.r.name.toLowerCase().replace(/ё/g, "е").includes(qq)) : list.filter(x => x.s > 0 || x.r.pf);
    list.sort((a, b) => b.s - a.s || (b.r.pf - a.r.pf) || a.r.name.localeCompare(b.r.name));
    $("#spList").innerHTML = list.length ? `<div class="list">${list.slice(0, 60).map(x => `<div class="item tap" data-act="stockLink" data-n="${h(name)}" data-id="${x.r.id}">
      <div class="grow"><div class="t">${x.r.pf ? "🧪 " : ""}${h(x.r.name)}</div><div class="s">${h((S.tk.sheets.find(s => s.idx === x.r.sheet) || {}).title || "")}</div></div></div>`).join("")}</div>` : empty("🔎", "Ничего не нашлось");
  };
  view.innerHTML = `<input class="search" id="spq" placeholder="Поиск тех. карты">
    ${i && i.link ? `<button class="btn ghost" data-act="stockLink" data-n="${h(name)}" data-id="">Убрать привязку</button>` : ""}
    <div class="card" style="padding:0" id="spList"></div>`;
  $("#spq").addEventListener("input", e => draw(e.target.value));
  draw("");
}
ACT.stockLink = async ds => {
  try {
    const res = await api("stock_link", { stock: ds.n, recipe_id: ds.id || null });
    const i = S.stock && S.stock.items.find(x => x.name === ds.n);
    if (i) { i.link = res.link; i.link_saved = !!res.link; }
    toast(res.link ? "Привязано — теперь открывается из заготовок" : "Привязка убрана");
    S.stack.pop();  // экран выбора
    const top = S.stack[S.stack.length - 1];
    if (res.link && i && top && top !== renderStock) { S.stack[S.stack.length - 1] = () => renderRecipe(res.link, stockCalc(i, byId(res.link))); }
    backBtn(); (S.stack[S.stack.length - 1] || (() => go(S.tab)))();
  } catch (e) { toast(e.message); }
};

// ================= МЕНЮ =================
async function renderMenu() {
  setHead("Меню");
  fresh("menu", "menu", {}, d => { S.menu = d; preloadPhotos(d); drawMenuScreen(); });
}
function drawMenuScreen() {
  const m = S.menu;
  let html = `<div class="seg"><button data-act="menuMode" data-m="bar" class="${S.menuMode === "bar" ? "on" : ""}">Бар</button>
    <button data-act="menuMode" data-m="kitchen" class="${S.menuMode === "kitchen" ? "on" : ""}">Кухня</button></div>`;
  const kitchen = S.menuMode === "kitchen";
  if (kitchen && m.kitchen.error && !m.kitchen.items.length) {
    view.innerHTML = html + `<div class="card">${empty("🍽", h(m.kitchen.error))}</div>`;
    return;
  }
  html += `<input class="search" id="mq" placeholder="Поиск по названию или составу" value="${h(S.menuQ || "")}">`;
  html += `<div class="muted small" style="margin:0 4px 6px">Показать <b>без</b>:</div><div class="chips">${Object.keys(m.titles).map(c =>
    `<button class="chip ${S.alFilter.has(c) ? "on" : ""}" data-act="menuAl" data-c="${c}">${h(m.titles[c])}</button>`).join("")}</div><div id="menuList"></div>`;
  view.innerHTML = html;
  $("#mq").addEventListener("input", e => { S.menuQ = e.target.value; drawMenu(); });
  drawMenu();
}
/** Первое число в строке: «58 кл на 100гр.» → 58, «139 гр» → 139. */
function firstNum(v) {
  const m = /(\d+(?:[.,]\d+)?)/.exec(String(v || ""));
  return m ? parseFloat(m[1].replace(",", ".")) : null;
}
/** Калорийность порции: из КБЖУ (лист «КБЖУ»), иначе из меню кухни. В меню обычно уже на порцию;
 *  если написано «на 100 гр» — пересчитываем на выход. */
function kcalTotal(i) {
  if (i.kbju) return `${Math.round(i.kbju.kcal)} ккал`;
  const v = firstNum(i.calories), w = firstNum(i.weight);
  if (v === null) return i.calories ? h(i.calories) : "";
  if (/100/.test(String(i.calories).replace(/^\s*\d+/, ""))) return w ? `${Math.round(v * w / 100)} ккал` : `${Math.round(v)} ккал/100 г`;
  return `${Math.round(v)} ккал`;
}
const g1 = v => v === null || v === undefined ? "—" : String(Math.round(v * 10) / 10).replace(".", ",");
function kcal(v) { return kcalTotal({ calories: v }); }
function menuItems() {
  const m = S.menu, q = norm(S.menuQ || "");
  return (S.menuMode === "kitchen" ? m.kitchen.items : m.bar)
    .filter(i => (!q || norm(i.name + " " + (i.name_en || "") + " " + i.composition + " " + (i.sauce || "")).includes(q)) && ![...S.alFilter].some(c => i.allergens.includes(c)));
}
function alTags(i) {
  const m = S.menu;
  const tags = i.allergens.map(a => `<span class="tag bad">${h(m.titles[a])}</span>`).concat((i.allergens_other || []).map(a => `<span class="tag">${h(a)}</span>`));
  return tags.length ? `<div class="tags">${tags.join(" ")}${i.checked ? "" : ' <span class="muted small">не проверено</span>'}</div>` : "";
}
/** Меню по разделам, разделы свёрнуты: нажал на раздел — открылся. При поиске и фильтре открыты все, где что-то нашлось. */
function drawMenu() {
  const items = menuItems(), box = $("#menuList"), kitchen = S.menuMode === "kitchen", m = S.menu;
  if (!items.length) { box.innerHTML = `<div class="card">${empty("🔍", "Ничего не подходит")}</div>`; return; }
  const groups = {};
  items.forEach(i => (groups[i.section || "Меню"] = groups[i.section || "Меню"] || []).push(i));
  let order = Object.entries(groups).sort((x, y) => (/соус/i.test(x[0]) ? 1 : 0) - (/соус/i.test(y[0]) ? 1 : 0));
  const meta = {};
  if (!kitchen && m.bar_sections) {  // порядок и пояснения разделов — как в таблице меню
    const idx = Object.fromEntries(m.bar_sections.map((x, n) => [x.name, n]));
    m.bar_sections.forEach(x => (meta[x.name] = x));
    order = order.sort((x, y) => (idx[x[0]] ?? 99) - (idx[y[0]] ?? 99));
  }
  const searching = !!(S.menuQ || "").trim() || S.alFilter.size > 0;
  S.menuOpen = S.menuOpen || new Set();
  box.innerHTML = order.map(([g, list]) => {
    const key = S.menuMode + "|" + g, open = searching || S.menuOpen.has(key), x = meta[g] || {};
    const sub = [x.note, x.volume ? `цена за ${x.volume.replace(/(\d)\s*мл/, "$1 мл")}` : ""].filter(Boolean).join(" · ");
    const anyPhoto = list.some(i => i.photo);
    return `<div class="card acc ${open ? "open" : ""}"><button class="acc-h" data-act="menuSec" data-k="${h(key)}">
        <span class="grow"><b>${h(g)}</b>${sub ? `<span class="muted small"> · ${h(sub)}</span>` : ""}</span><span class="muted small num">${list.length}</span><span class="acc-c"></span></button>
      ${open ? `<div class="acc-b">${list.map(i => menuRow(i, kitchen, anyPhoto)).join("")}</div>` : ""}</div>`;
  }).join("");
}
function menuRow(i, kitchen, anyPhoto) {
  const price = i.price ? money(i.price) : i.price_text ? h(i.price_text) + " ₽" : "";
  const info = kitchen ? [h(i.weight || ""), kcalTotal(i), i.kbju ? `Б ${g1(i.kbju.p)} · Ж ${g1(i.kbju.f)} · У ${g1(i.kbju.c)}` : ""]
    : [i.volume ? h(i.volume.replace(/(\d)\s*мл/, "$1 мл")) : "", i.name_en && i.name_en !== i.name ? h(i.name_en) : ""];
  const line = info.filter(Boolean).join(" · ");
  return `<div class="dish ${kitchen ? "tap" : ""}" ${kitchen ? `data-act="dish" data-k="${h(i.section + "|" + i.name)}"` : ""}>${i.photo ? `<img src="${h(photoSrc(i.photo, 240))}" alt="" width="76" height="76" decoding="async">` : (kitchen && anyPhoto ? '<div class="nophoto">🍽</div>' : "")}
      <div class="grow"><div class="row between" style="align-items:flex-start"><div class="t">${h(i.name)} ${i.new ? '<span class="tag ok">NEW</span>' : ""}</div>
      ${price ? `<b class="num" style="white-space:nowrap">${price}</b>` : ""}</div>
      ${line ? `<div class="muted small">${line}</div>` : ""}
      ${i.composition ? `<div class="s ${kitchen ? "clamp" : ""}">${h(i.composition)}</div>` : ""}
      ${alTags(i)}
    </div></div>`;
}
ACT.menuSec = ds => {
  S.menuOpen = S.menuOpen || new Set();
  if (S.menuOpen.has(ds.k)) S.menuOpen.delete(ds.k); else S.menuOpen.add(ds.k);
  haptic();
  drawMenu();
};
ACT.menuMode = ds => { S.menuMode = ds.m; renderMenu(); };
ACT.menuAl = (ds, el) => { S.alFilter.has(ds.c) ? S.alFilter.delete(ds.c) : S.alFilter.add(ds.c); el.classList.toggle("on"); drawMenu(); };
ACT.dish = ds => push(() => renderDish(ds.k));
function renderDish(k) {
  const i = S.menu.kitchen.items.find(x => x.section + "|" + x.name === k);
  if (!i) { view.innerHTML = empty("😕", "Блюдо пропало из меню"); return; }
  setHead(i.name, i.section);
  const row = (t, v) => v ? `<div class="stat"><span>${t}</span><span class="right">${h(v)}</span></div>` : "";
  view.innerHTML = `${i.photo ? `<img class="hero-photo" src="${h(photoSrc(i.photo, 1000))}" alt="${h(i.name)}">` : ""}
    <div class="card"><div class="row between" style="align-items:flex-start"><h3>${h(i.name)}</h3>${i.price ? `<b class="num" style="font-size:18px">${money(i.price)}</b>` : ""}</div>
      ${i.description ? `<div style="margin-top:6px">${h(i.description)}</div>` : ""}
      ${alTags(i)}${Object.keys(i.allergens_via || {}).length ? '<div class="muted small" style="margin-top:4px">' + Object.entries(i.allergens_via).map(([c, n]) => h(S.menu.titles[c]) + ' — из «' + h(n.join('», «')) + '»').join('; ') + '</div>' : ''}</div>
    <div class="card"><h2>Состав</h2><div>${i.composition ? linkify(i.composition, i.name) : "—"}</div>
      ${i.sauce ? `<h2 style="margin-top:12px">Соус</h2><div>${linkify(i.sauce, i.name)}</div>` : ""}</div>
    ${(i.details || []).length ? `<div class="card">${i.details.map(x => `<h2 style="margin-top:8px">${h(x.label)}</h2><div>${h(x.value)}</div>`).join("")}</div>` : ""}
    <div class="card">${row("Выход", i.weight || (i.kbju && i.kbju.g ? i.kbju.g + " г" : ""))}${i.calories || i.kbju ? `<div class="stat"><span>Калорийность, порция</span><span class="right">${kcalTotal(i)}</span></div>` : ""}
      ${i.kbju ? `<div class="stat"><span>Белки · жиры · углеводы</span><span class="right num">${g1(i.kbju.p)} · ${g1(i.kbju.f)} · ${g1(i.kbju.c)} г</span></div>` : ""}${row("Время приготовления", i.time)}${row("Аллергены / диета", i.allergens_text)}</div>
    ${i.notes && i.notes.length ? `<div class="card"><h2>Пояснения</h2>${i.notes.map(n => `<p class="small" style="margin:0 0 8px">${h(n)}</p>`).join("")}</div>` : ""}`;
}

// ================= ЕЩЁ =================
function renderMore() {
  setHead("Ещё");
  const row = (act, s, icon, t, sub) => `<div class="item tap chev" data-act="${act}" ${s ? `data-s="${s}"` : ""}><span style="font-size:22px">${icon}</span><div class="grow"><div class="t">${t}</div><div class="s">${sub}</div></div></div>`;
  let html = "";
  if (S.me.can_bar) html += `<div class="card" style="padding:0"><h2 style="padding:12px 14px 0">Бар</h2><div class="list" style="margin:0">
    ${row("open", "tk", "🍸", "Тех. карты", "Поиск, ПФ, калькулятор батча")}
    ${row("open", "stock", "🧪", "Заготовки", "Что нужно сделать по стоку")}
    ${row("open", "guest", "🎪", "Гостевая смена", "Заказ, сообщение и Excel")}</div></div>`;
  if (S.me.can_hours) html += `<div class="card" style="padding:0"><div class="list" style="margin:0">
    ${row("open", "myhours", "🕒", "Мои часы", "Смены по дням: с какого и до какого")}</div></div>`;
  if (S.me.can_waiter) html += `<div class="card" style="padding:0"><div class="list" style="margin:0">
    ${row("open", "waiter", "💵", "Мои смены и чаевые", "Часы из графика, свои чаевые, деньги за месяц")}</div></div>`;
  html += `<div class="card" style="padding:0"><div class="list" style="margin:0">
    ${row("open", "allergens", "🥜", "Аллергены", "Составы и фильтр «без…»")}
    ${row("open", "profile", "🙋", "Профиль", h(S.me.role || "роль не назначена"))}
    ${row("open", "bar", "🍻", "Грязнульки", "Кто сейчас в баре, счётчики")}
    ${S.me.is_owner ? row("open", "admin", "🔐", "Админ", "Сотрудники, роли, зарплаты, Нетмонет") : ""}</div></div>
    <div class="card"><h2>Тема</h2><div class="seg theme">${[["auto", "Как в Telegram"], ["light", "Светлая"], ["dark", "Тёмная"]]
      .map(([k, t]) => `<button data-act="theme" data-t="${k}" class="${THEME === k ? "on" : ""}">${t}</button>`).join("")}</div></div>
    <div class="muted small" style="text-align:center;margin-top:14px">Данные из Google Таблиц обновляются раз в 10 минут<br>версия ${APP_VER}</div>`;
  view.innerHTML = html;
}
ACT.theme = ds => {
  THEME = ds.t;
  try { localStorage.setItem("bar:theme", THEME); } catch (e) {}
  applyTheme(THEME, true);
  renderMore();
};
ACT.open = ds => push({ waiter: () => renderWaiterMonth(0), myhours: renderMyHours, bar: renderBar, tk: renderTK, stock: renderStock, allergens: renderAllergens, guest: renderGuest, admin: renderAdmin, profile: renderProfile }[ds.s]);

// ---------- официант: месяц, день ----------
/** Карточка на главной: сколько заработал за месяц — ставка за часы и свои чаевые. */
function waiterCard(m) {
  const sum = m.base + m.tips, bp = sum ? Math.round(m.base / sum * 100) : 100;
  if (!m.linked) return `<div class="card muted small">Владелец ещё не связал тебя с графиком — часы посчитать не из чего.</div>`;
  return `<div class="card tapcard" data-act="wMonth"><div class="row between small muted"><span>${h(MONTHS[m.month - 1])} · заработано</span>
      ${m.prev_title ? `<span class="link" data-act="wPrev">${h(m.prev_title)} ›</span>` : ""}</div>
    <div class="big num" style="margin:2px 0 8px">${money(sum)}</div>
    <div class="mbar"><i style="width:${bp}%;background:var(--c-base)"></i><i style="width:${100 - bp}%;background:var(--c-tips)"></i></div>
    <div class="legend2 small muted"><span><span class="dot" style="background:var(--c-base)"></span>ставка ${money(m.base)} <span class="muted">(${hrs(m.hours)} ч × ${money(m.rate)})</span></span>
      <span><span class="dot" style="background:var(--c-tips)"></span>чаевые ${money(m.tips)}</span></div>
    <div class="kpis"><div><small>Часы</small><b class="num">${hrs(m.hours)}</b></div><div><small>Смен</small><b class="num">${m.shifts}</b></div>
      <div><small>Ещё смен</small><b class="num">${m.left}</b></div></div></div>`;
}
ACT.wMonth = () => push(() => renderWaiterMonth(0));
ACT.wPrev = (ds, el, e) => { if (e) e.stopPropagation(); push(() => renderWaiterMonth(-1)); };
ACT.wDay = ds => push(() => renderWaiterDay(ds.d || null));

function renderWaiterMonth(off) {
  S.wOff = off;
  setHead("Мои смены и чаевые", S.me.schedule_name || "");
  fresh("wm" + off, "waiter_month", { offset: off }, d => { if (S.wOff === off) { S.wm = d; drawWaiterMonth(d, off); } });
}
function drawWaiterMonth(m, off) {
  const today = S.me.today;
  let html = `<div class="monthnav"><button data-act="wNav" data-o="${off - 1}">‹</button><b>${h(m.title)}</b>
    <button data-act="wNav" data-o="${off + 1}" ${off >= 0 ? "disabled" : ""}>›</button></div>`;
  html += `<div class="card"><div class="row between"><div><div class="muted small">Заработано</div><div class="big num">${money(m.total)}</div></div>
    <div class="right small muted">ставка ${money(m.base)}<br>чаевые ${money(m.tips)}</div></div>
    <div class="muted small" style="margin-top:6px">${hrs(m.hours)} ч × ${money(m.rate)}${m.personal ? " (личная ставка)" : ""} · смен ${m.shifts}</div></div>`;
  if (!m.linked) html += `<div class="card muted small">Владелец ещё не связал тебя с графиком.</div>`;
  if (!m.days.length) html += `<div class="card">${empty("🗓", "Смен в этом месяце нет")}</div>`;
  else html += `<div class="card" style="padding:0"><div class="list" style="margin:0">${m.days.map(d => {
    const fut = d.date > today;
    const time = d.off ? '<span class="tag">не работал</span>' : d.start ? `${h(d.start)}–${h(d.end)} · ${hrs(d.hours)} ч${d.edited ? ' <span class="tag">поправлено</span>' : ""}` : "—";
    const tips = d.tips ? `<b class="num">${money(d.tips)}</b>` : fut ? "" : '<span class="muted small">чаевые?</span>';
    return `<div class="item ${fut ? "" : "tap chev"}" ${fut ? "" : `data-act="wDay" data-d="${d.date}"`}><div class="grow">
      <div class="t">${h(human(d.date))}${d.date === today ? ' <span class="tag ok">сегодня</span>' : ""}</div><div class="s">${time}</div></div><div class="right">${tips}</div></div>`;
  }).join("")}</div></div>`;
  html += `<button class="btn" data-act="wDay">＋ Чаевые за смену</button>`;
  view.innerHTML = html;
}
ACT.wNav = ds => replaceTop(() => renderWaiterMonth(Math.min(0, Number(ds.o))));

/** День официанта: чаевые, время (по умолчанию — из графика), «не работал». */
async function renderWaiterDay(date) {
  setHead("Чаевые за смену", S.me.schedule_name || "");
  // этот и прошлый месяц — чтобы у каждого дня было время из графика (записать можно до начала прошлого месяца)
  S.wmc = S.wmc || {};
  if (!S.wmc[0] && S.dash && S.dash.waiter) S.wmc[0] = S.dash.waiter;
  if (!S.wmc[0] || !S.wmc[-1]) {
    loading();
    try { [S.wmc[0], S.wmc[-1]] = await Promise.all([S.wmc[0] || api("waiter_month", { offset: 0 }), S.wmc[-1] || api("waiter_month", { offset: -1 })]); }
    catch (e) { return fail(e); }
  }
  const m = S.wmc[0], today = S.me.today, byDate = {};
  [S.wmc[-1], S.wmc[0], S.wm].forEach(x => ((x && x.days) || []).forEach(d => (byDate[d.date] = d)));
  S.wDays = byDate;
  const opts = [], t = dt(today), first = `${t.getMonth() === 0 ? t.getFullYear() - 1 : t.getFullYear()}-${String(t.getMonth() === 0 ? 12 : t.getMonth()).padStart(2, "0")}-01`;
  for (let i = 0, iso = today; iso >= first; i++, iso = addDaysIso(today, -i)) {
    const x = byDate[iso];
    opts.push({ iso, label: `${i === 0 ? "Сегодня, " : i === 1 ? "Вчера, " : ""}${human(iso)}${x && x.off ? " · не работал" : x && x.start ? ` · ${x.start}–${x.end}` : ""}${x && x.tips ? ` · ${money(x.tips)}` : ""}` });
  }
  if (!date) {  // последний день со сменой, где чаевых ещё нет
    const cand = Object.values(byDate).filter(x => x.date <= today && !x.off && x.start).sort((a, b) => a.date < b.date ? -1 : 1).reverse();
    date = (cand.find(x => !x.tips) || cand[0] || { date: today }).date;
  }
  if (!opts.some(o => o.iso === date)) opts.push({ iso: date, label: human(date) });
  const draw = () => {
    const x = byDate[date] || {};
    view.innerHTML = `<div class="card">
      <label class="l" style="margin-top:0">День</label>
      <select class="f" id="wDay">${opts.map(o => `<option value="${o.iso}" ${o.iso === date ? "selected" : ""}>${h(o.label)}</option>`).join("")}</select>
      <label class="l">Мои чаевые за смену, ₽</label>
      <input class="f num" id="wTips" type="number" inputmode="numeric" min="0" step="50" placeholder="1500" value="${x.tips || ""}">
      <div class="grid2"><div><label class="l">Пришёл</label>${timeSel("wS", x.start || x.sched_start || "12:00")}</div>
      <div><label class="l">Ушёл</label>${timeSel("wE", x.end || x.sched_end || "00:00")}</div></div>
      <div class="muted small" style="margin-top:6px">${x.sched_start ? `По графику ${h(x.sched_start)}–${h(x.sched_end)}. Время меняй, только если ушёл раньше или задержался.` : "В графике смены на этот день нет — укажи время сам."}</div>
      <button class="btn" data-act="wSave">Записать</button>
      ${x.sched_start && !x.off ? '<button class="btn ghost" data-act="wOff">Не работал в этот день</button>' : ""}
      ${x.edited ? '<button class="btn ghost" data-act="wReset">Время — как в графике</button>' : ""}</div>`;
    $("#wDay").addEventListener("change", e => { date = e.target.value; draw(); });
  };
  draw();
}
async function wSend(body, msg) {
  try {
    const m = await api("waiter_save", body);
    S.wm = m; S.wmc = {};
    if (S.dash && S.dash.waiter && m.month === S.dash.waiter.month) { S.dash.waiter = Object.assign(m, { prev_title: S.dash.waiter.prev_title }); LS.set("dash", S.dash); }
    try { tg && tg.HapticFeedback.notificationOccurred("success"); } catch (e) {}
    toast(msg(m)); back();
  } catch (e) { toast(e.message); }
}
ACT.wSave = (ds, el) => {
  const tips = $("#wTips").value.trim(), date = $("#wDay").value, d = (S.wDays || {})[date] || {};
  const start = timeVal("wS"), end = timeVal("wE");
  const same = d.sched_start && start === d.sched_start && end === d.sched_end;  // время как в графике — не храним
  el.disabled = true;
  wSend({ date, tips, start: same ? "" : start, end: same ? "" : end }, m => `✅ Записал · за месяц ${money(m.total)}`).finally(() => { el.disabled = false; });
};
ACT.wOff = () => { const date = $("#wDay").value; wSend({ date, off: true, tips: $("#wTips").value.trim() }, () => "Отметил: не работал"); };
ACT.wReset = () => { const date = $("#wDay").value; wSend({ date, tips: $("#wTips").value.trim() }, () => "Время — как в графике"); };

// ---------- мои часы ----------
function renderMyHours() {
  S.myh = S.myh || 0;
  setHead("Мои часы", S.me.tips_name || "");
  const off = S.myh;
  fresh("myh" + off, "my_hours", { offset: off }, d => { if (S.myh === off) drawMyHours(d); });
}
function drawMyHours(d) {
  let html = `<div class="card"><div class="row between"><button class="btn sm ghost" data-act="myhM" data-d="-1">‹</button>
    <h2 style="margin:0">${h(d.title)}</h2>
    <button class="btn sm ghost" data-act="myhM" data-d="1" ${d.offset >= 0 ? "disabled" : ""}>›</button></div>
    <div class="row between" style="margin-top:10px"><div><div class="big num">${hrs(d.total)} ч</div>
    <div class="muted small">смен: ${d.rows.length}</div></div></div></div>`;
  if (!d.rows.length) html += `<div class="card">${empty("🕒", "В этом месяце смен пока нет")}</div>`;
  else html += `<div class="card"><table class="t"><tr><th>День</th><th>С – до</th><th class="r">Часы</th></tr>
    ${d.rows.map(r => `<tr class="${r.date === S.me.today ? "hl" : ""}"><td>${WD[dt(r.date).getDay()]} ${dt(r.date).getDate()}</td>
      <td class="num">${h(r.start || "?")} – ${h(r.end || "?")}</td><td class="r num">${hrs(r.hours)}</td></tr>`).join("")}</table></div>`;
  html += `<div class="muted small" style="text-align:center">Откуда: ${h(d.source)}</div>`;
  view.innerHTML = html;
}
ACT.myhM = ds => { S.myh = Math.min(0, (S.myh || 0) + Number(ds.d)); renderMyHours(); };

function renderProfile() {
  setHead("Профиль");
  view.innerHTML = `<div class="card">
    <div class="stat"><span>Роль</span><b>${h(S.me.role || "не назначена")}</b></div>
    <div class="stat"><span>В графике</span><span>${h(S.me.schedule_name || "—")}</span></div>
    <div class="stat"><span>В таблице чаевых</span><span>${h(S.me.tips_name || "—")}</span></div>
    <div class="muted small" style="margin-top:10px">Роль и имена назначает владелец. Если что-то не так — напиши ему.</div></div>
    <div class="muted small" style="text-align:center">Telegram: ${h(S.me.tg_name)} · ID ${S.me.id}</div>`;
}
// ---------- аллергены ----------
async function renderAllergens() {
  setHead("Аллергены");
  loading();
  let d;
  try { d = S.al || (S.al = await api("allergens")); } catch (e) { return fail(e); }
  const codes = Object.keys(d.titles);
  let html = `<input class="search" id="alq" placeholder="Поиск позиции">
    <div class="muted small" style="margin:0 4px 6px">Показать позиции <b>без</b>:</div>
    <div class="chips" style="flex-wrap:wrap">${codes.map(c => `<button class="chip ${S.alFilter.has(c) ? "on" : ""}" data-act="alF" data-c="${c}">${h(d.titles[c])}</button>`).join("")}</div>`;
  if (!d.configured) html += `<div class="card small"><span class="tag warn">не проверено</span> Таблица аллергенов ещё не подключена — ниже подсказки по составу ТК. Проверяйте по этикеткам.</div>`;
  html += `<div id="alList"></div>`;
  view.innerHTML = html;
  $("#alq").addEventListener("input", drawAl);
  drawAl();
}
function drawAl() {
  const d = S.al, q = norm(($("#alq") || {}).value || "");
  const list = d.items.filter(i => (!q || norm(i.name + " " + i.composition).includes(q)) && ![...S.alFilter].some(c => i.allergens.includes(c)));
  const box = $("#alList");
  if (!list.length) { box.innerHTML = `<div class="card">${empty("🔍", "Ничего не подходит")}</div>`; return; }
  const groups = {};
  for (const i of list) (groups[i.section || "Без раздела"] = groups[i.section || "Без раздела"] || []).push(i);
  box.innerHTML = Object.entries(groups).map(([g, items]) => `<div class="card"><h2>${h(g)} · ${items.length}</h2><div class="list">${items.slice(0, 150).map(i => `
    <div class="item"><div class="grow"><div class="t">${h(i.name)} ${i.checked ? '<span class="tag ok">проверено</span>' : '<span class="tag warn">не проверено</span>'}</div>
    <div class="s">${h(i.composition)}</div>
    <div style="margin-top:4px">${i.allergens.length ? i.allergens.map(a => `<span class="tag bad">${h(d.titles[a])}</span>`).join(" ") : '<span class="muted small">аллергены не найдены</span>'}</div>
    ${i.note ? `<div class="s">${h(i.note)}</div>` : ""}</div></div>`).join("")}</div></div>`).join("");
}
ACT.alF = (ds, el) => { S.alFilter.has(ds.c) ? S.alFilter.delete(ds.c) : S.alFilter.add(ds.c); el.classList.toggle("on"); drawAl(); };

// ---------- гостевая смена ----------
async function renderGuest() {
  setHead("Гостевая смена");
  loading();
  let o;
  try { [o] = await Promise.all([api("guest_get"), loadTK()]); } catch (e) { return fail(e); }
  S.guest = o;
  drawGuest();
}
function drawGuest() {
  const o = S.guest;
  const total = o.items.reduce((a, i) => a + i.n, 0);
  let html = `<div class="card"><label class="l" style="margin-top:0">Название смены</label>
    <input class="f" id="gTitle" placeholder="Гостевая смена · дата, место" value="${h(o.title)}"></div>`;
  html += `<div class="card"><h2>Коктейли · ${total} порций</h2>`;
  if (!o.items.length) html += empty("🍹", "Пока пусто — добавь коктейли");
  else html += `<div class="list">${o.items.map((i, n) => `<div class="item"><div class="grow t">${h(i.name)}</div>
    <div class="stepper"><button data-act="gQty" data-n="${n}" data-d="-10">−</button><input class="num" data-n="${n}" type="number" inputmode="numeric" value="${i.n}">
    <button data-act="gQty" data-n="${n}" data-d="10">+</button></div></div>`).join("")}</div>`;
  html += `<button class="btn ghost" data-act="gAdd">＋ Добавить коктейль</button></div>`;
  if (o.items.length) html += `<div class="card"><button class="btn" data-act="gSend">💬 Прислать в чат</button>
    <div class="muted small" style="margin-top:8px">В чат с ботом придёт состав на все порции и ПФ на смену, под ним — кнопка «📄 Собрать таблицу» (Excel).</div>
    <button class="btn danger" data-act="gClear">Очистить</button></div>`;
  view.innerHTML = html;
  $("#gTitle").addEventListener("change", e => { o.title = e.target.value; saveGuest(); });
  view.querySelectorAll(".stepper input").forEach(inp => inp.addEventListener("change", e => {
    const v = parseInt(e.target.value, 10); const n = Number(e.target.dataset.n);
    if (v > 0) o.items[n].n = v; else o.items.splice(n, 1);
    saveGuest(); drawGuest();
  }));
}
async function saveGuest() { try { S.guest = await api("guest_put", S.guest); } catch (e) { toast(e.message); } }
ACT.gQty = ds => { const it = S.guest.items[Number(ds.n)]; it.n = it.n + Number(ds.d); if (it.n <= 0) S.guest.items.splice(Number(ds.n), 1); saveGuest(); drawGuest(); };
ACT.gClear = async () => { if (await confirmBox("Очистить список?")) { S.guest = { title: "", items: [] }; await saveGuest(); drawGuest(); } };
ACT.gSend = async (ds, el) => { el.disabled = true; try { const r = await api("guest_send"); toast(r.bot_online ? "Отправил в чат с ботом" : "Отправил в чат. Таблицу бот соберёт, когда включится компьютер"); } catch (e) { toast(e.message); } el.disabled = false; };
ACT.gAdd = () => push(renderGuestPick);
function renderGuestPick() {
  setHead("Добавить коктейль");
  view.innerHTML = `<input class="search" id="gq" placeholder="Поиск коктейля"><div class="card" style="padding:0"><div class="list" style="margin:0" id="gList"></div></div>`;
  const draw = () => {
    const q = norm($("#gq").value);
    const have = new Set(S.guest.items.map(i => i.name));
    const list = S.tk.recipes.filter(r => !r.pf && r.portion && (!q || norm(r.name).includes(q))).slice(0, 80);
    $("#gList").innerHTML = list.map(r => `<div class="item tap" data-act="gPick" data-id="${r.id}"><div class="grow"><div class="t">${h(r.name)}</div>
      <div class="s">${h((S.tk.sheets.find(s => s.idx === r.sheet) || {}).title || "")} · ${fmt(r.portion)} ${h(r.unit)}</div></div>${have.has(r.name) ? '<span class="tag ok">в списке</span>' : ""}</div>`).join("") || empty("🔍", "Ничего не нашёл");
  };
  $("#gq").addEventListener("input", draw);
  draw();
}
ACT.gPick = async ds => {
  const r = byId(ds.id);
  const ex = S.guest.items.find(i => i.name === r.name);
  if (ex) ex.n += 50; else S.guest.items.push({ id: r.id, name: r.name, n: 50 });
  await saveGuest();
  toast(`${r.name}: ${(ex || S.guest.items[S.guest.items.length - 1]).n} порций`);
  back();
};

// ---------- админ ----------
// Админка: стартовый экран — плитки-разделы, внутри — список людей. Открывается из сохранённых данных.
const ADMIN_CATS = {
  new: { icon: "🔔", title: "Заявки", hint: "Ждут твоего разрешения", test: u => !u.owner && u.status === "pending" },
  staff: { icon: "🧑‍🍳", title: "Сотрудники", hint: "Все, у кого роль не «гость»", test: u => u.status === "approved" && (u.owner || (u.role && u.role !== "гость")) },
  guests: { icon: "🍽", title: "Гости", hint: "Видят только меню", test: u => !u.owner && u.status === "approved" && (!u.role || u.role === "гость") },
  closed: { icon: "🚫", title: "Доступ закрыт", hint: "Бот им ничего не показывает", test: u => u.status === "rejected" },
};
async function renderAdmin() {
  setHead("Админ");
  fresh("adm", "admin_overview", {}, d => { S.adm = d; drawAdminHome(); });
}
function drawAdminHome() {
  const a = S.adm, n = c => a.users.filter(ADMIN_CATS[c].test).length;
  const t = (act, key, icon, title, sub, warn) => `<div class="tile" data-act="${act}" data-c="${key}">
    <div class="ticon">${icon}</div><div class="t">${title}</div><div class="muted small">${sub}</div>${warn ? '<span class="dotwarn"></span>' : ""}</div>`;
  view.innerHTML = `<div class="tiles">
    ${t("aCat", "new", ADMIN_CATS.new.icon, "Заявки", n("new") ? `<b>${n("new")}</b> ждут` : "нет", n("new") > 0)}
    ${t("aCat", "staff", ADMIN_CATS.staff.icon, "Сотрудники", `${n("staff")} чел.`)}
    ${t("aCat", "guests", ADMIN_CATS.guests.icon, "Гости", `${n("guests")} чел.`)}
    ${t("aCat", "closed", ADMIN_CATS.closed.icon, "Доступ закрыт", `${n("closed")} чел.`)}
    ${t("aSec", "counters", "🥃", "Счётчики", "Хайболы, шампейн шауэры")}
    ${t("aSec", "money", "💰", "Деньги", "Выплаты, зарплаты, Нетмонет")}
    ${t("aSec", "menu", "🍽", "Меню", "Скрыть разделы и позиции")}
    ${t("aSec", "data", "⚙️", "Данные", a.bot_online ? "бот на связи" : "бот не на связи", !a.bot_online)}
  </div>`;
}
ACT.aCat = ds => push(() => renderAdminList(ds.c));
ACT.aSec = ds => push(ds.c === "money" ? renderAdminMoney : ds.c === "counters" ? renderAdminCounters : ds.c === "menu" ? renderAdminMenu : renderAdminData);

// ---------- админка: что показывать в меню ----------
/** Разделы и позиции с переключателями: выключил — у всех пропало из меню (в таблицах ничего не меняется). */
async function renderAdminMenu() {
  setHead("Меню", "что показывать");
  S.am = S.am || { mode: "bar", open: new Set() };
  if (!S.amData) loading();
  try { S.amData = await api("admin_menu"); } catch (e) { return fail(e); }
  drawAdminMenu();
}
function drawAdminMenu() {
  const d = S.amData, mode = S.am.mode, hid = d.hidden, list = d[mode];
  const groups = {};
  list.forEach(i => (groups[i.section] = groups[i.section] || []).push(i));
  let order = Object.keys(groups);
  if (mode === "bar" && d.bar_sections.length) order = d.bar_sections.filter(x => groups[x]);
  const sw = (kind, key, on, label) => `<label class="switch" title="${h(label)}"><input type="checkbox" data-kind="${kind}" data-key="${h(key)}" ${on ? "checked" : ""}><span></span></label>`;
  const hiddenCount = Object.keys(hid.s).filter(k => k.startsWith(mode + "|")).length + Object.keys(hid.i).filter(k => k.startsWith(mode + "|")).length;
  view.innerHTML = `<div class="seg"><button data-act="amMode" data-m="bar" class="${mode === "bar" ? "on" : ""}">Бар</button>
      <button data-act="amMode" data-m="kitchen" class="${mode === "kitchen" ? "on" : ""}">Кухня</button></div>
    <div class="muted small" style="margin:0 4px 8px">Выключил — у всех пропадает из меню. В таблицах ничего не меняется, включить обратно можно здесь же.${hiddenCount ? ` Сейчас скрыто: <b>${hiddenCount}</b>.` : ""}</div>
    ${order.map(g => {
      const sk = mode + "|" + g, secOn = !hid.s[sk], open = S.am.open.has(sk), items = groups[g];
      const off = items.filter(i => hid.i[sk + "|" + i.name]).length;
      return `<div class="card acc ${open ? "open" : ""}"><div class="acc-h" style="cursor:default">
          <button class="grow acc-t" data-act="amSec" data-k="${h(sk)}"><b style="${secOn ? "" : "opacity:.45"}">${h(g)}</b>
            <span class="muted small"> · ${items.length - off}/${items.length}</span><span class="acc-c"></span></button>
          ${sw("s", sk, secOn, "Показывать раздел")}</div>
        ${open ? `<div class="acc-b">${items.map(i => { const ik = sk + "|" + i.name, on = !hid.i[ik];
          return `<div class="item" style="${secOn ? "" : "opacity:.45"}"><div class="grow"><div class="t" style="${on ? "" : "text-decoration:line-through;color:var(--hint)"}">${h(i.name)}</div>
            ${i.price ? `<div class="s num">${money(i.price)}</div>` : ""}</div>${sw("i", ik, on, "Показывать позицию")}</div>`; }).join("")}</div>` : ""}</div>`;
    }).join("")}`;
  view.querySelectorAll(".switch input").forEach(inp => inp.addEventListener("change", async () => {
    const kind = inp.dataset.kind, key = inp.dataset.key, hide = !inp.checked, H = () => S.amData.hidden;
    if (hide) H()[kind][key] = 1; else delete H()[kind][key];
    drawAdminMenu();
    try {
      await api("admin_menu_hide", { kind, key, hide });  // на экране уже переключено — ответ не подставляем, чтобы не затереть быстрые нажатия
      S.menu = null; LS.set("menu", null);
    } catch (e) { toast(e.message); if (hide) delete H()[kind][key]; else H()[kind][key] = 1; drawAdminMenu(); }
  }));
}
ACT.amMode = ds => { S.am.mode = ds.m; drawAdminMenu(); };
ACT.amSec = ds => { if (S.am.open.has(ds.k)) S.am.open.delete(ds.k); else S.am.open.add(ds.k); drawAdminMenu(); };

function renderAdminList(cat) {
  const c = ADMIN_CATS[cat];
  setHead(c.title, c.hint);
  const draw = () => {
    const list = S.adm.users.filter(c.test);
    if (!list.length) { view.innerHTML = `<div class="card">${empty(c.icon, "Здесь пока никого")}</div>`; return; }
    view.innerHTML = `<div class="card" style="padding:0"><div class="list" style="margin:0">${list.map(u => {
      const tag = u.owner ? '<span class="tag">владелец</span>' : u.status === "rejected" ? '<span class="tag bad">закрыт</span>'
        : `<span class="tag">${h(u.role || "гость")}</span>`;
      const linked = h([u.schedule_name, u.tips_name].filter(Boolean).join(" · ") || "не связан с таблицами");
      const quick = u.status === "pending" ? `<div class="btns" style="gap:4px;flex:none"><button class="btn sm" data-act="aUser" data-id="${u.id}" data-ok="1">Пустить</button>
        <button class="btn sm danger" data-act="aUser" data-id="${u.id}" data-ok="0">✕</button></div>` : '<span class="chev"></span>';
      return `<div class="item tap" data-act="aEdit" data-id="${u.id}"><div class="ava">${h(initials(u.name))}</div>
        <div class="grow"><div class="t">${h(u.name || "Без имени")} ${u.username ? `<span class="muted small">@${h(u.username)}</span>` : ""}</div>
        <div class="s">${u.status === "pending" ? '<span class="tag warn">заявка</span>' : tag} ${linked}</div></div>${quick}</div>`;
    }).join("")}</div></div><div class="muted small" style="text-align:center">Нажми на человека, чтобы назначить роль и имена в таблицах.</div>`;
  };
  if (S.adm) draw();
  fresh("adm", "admin_overview", {}, d => { S.adm = d; draw(); });
}
function initials(name) {
  const p = String(name || "?").trim().split(/\s+/);
  return ((p[0] || "?")[0] + (p[1] ? p[1][0] : "")).toUpperCase();
}
function renderAdminMoney() {
  setHead("Деньги");
  const a = S.adm;
  view.innerHTML = `<div class="card" style="padding:0"><div class="list" style="margin:0">
    <div class="item tap chev" data-act="aOpen" data-s="tips"><div class="t">Неделя: к выдаче по всем</div></div>
    <div class="item tap chev" data-act="aOpen" data-s="salary"><div class="t">Зарплата всех за месяц</div></div>
    <div class="item tap chev" data-act="aRates"><div class="t">Ставка за час по ролям</div></div></div></div>
    <div class="card"><label class="l" style="margin-top:0">Нетмонет</label>
    <select class="f" id="aNmWeek">${nmOptions(LS.get("nmWeeks")) || `<option value="">Эта неделя · «${h(a.week.tab)}»</option><option disabled>загружаю прошлые недели…</option>`}</select>
    <div class="row" style="margin-top:8px"><input class="f num" id="aNm" type="number" inputmode="decimal" placeholder="9080"><button class="btn sm" data-act="aNm">Записать</button></div>
    <div class="muted small" style="margin-top:8px">Можно за эту неделю или за прошлые, пока их лист не занят новой неделей. Лист для этой недели выбирается сам; исправить — в «Данных».</div></div>`;
  api("admin_netmonet_weeks").then(r => {  // прошлые недели и что уже вписано; запоминаем — в следующий раз список сразу полный
    LS.set("nmWeeks", r.weeks);
    const sel = $("#aNmWeek");
    if (!sel) return;
    const keep = sel.value;
    sel.innerHTML = nmOptions(r.weeks);
    sel.value = keep;
    if (sel.selectedIndex < 0) sel.selectedIndex = 0;
  }).catch(() => { const sel = $("#aNmWeek"); if (sel && sel.options[1] && sel.options[1].disabled) sel.options[1].remove(); });
}
function nmOptions(weeks) {
  if (!weeks || !weeks.length) return "";
  const dm = iso => `${+iso.slice(8, 10)}.${iso.slice(5, 7)}`;
  return weeks.map((w, n) => `<option value="${n ? w.monday : ""}">${n === 0 ? "Эта неделя · " : n === 1 ? "Прошлая · " : ""}${dm(w.monday)}–${dm(addDaysIso(w.monday, 6))} · ${h(w.tab)}${w.value ? ` · ${h(w.value)}` : ""}</option>`).join("");
}
function renderAdminData() {
  setHead("Данные");
  const a = S.adm;
  view.innerHTML = `<div class="card"><button class="btn ghost" data-act="aRefresh">🔄 Перечитать таблицы сейчас</button>
    <button class="btn ghost" data-act="aAllergen">🧾 Дописать аллергены из ТК в таблицу</button></div>
    <div class="card tapcard row between" data-act="aClear"><div><div class="t">🧹 Очистить листы недель</div>
      <div class="muted small">Перед новым месяцем: стирает часы и чаевые, сначала копирует в архив</div></div><span class="chev"></span></div>
    <div class="card"><label class="l" style="margin-top:0">Лист для этой недели (с ${h(human(a.week.monday))})</label>
    <select class="f" id="aWeek">${a.week.tabs.map(t => `<option ${t === a.week.tab ? "selected" : ""}>${h(t)}</option>`).join("") || `<option>${h(a.week.tab)}</option>`}</select>
    <div class="muted small" style="margin-top:6px">Выбирается сам: следующий после прошлой недели. Меняй, только если программа ошиблась — сюда пойдут все часы и чаевые этой недели. Посмотреть другие недели — «Деньги» → «Неделя».</div></div>
    <div class="card"><div class="stat"><span>Бот на компьютере</span><span>${a.bot_online ? '<span class="tag ok">на связи</span>' : '<span class="tag bad">не на связи</span>'}</span></div>
    <div class="stat"><span>Лист «Аллергены»</span><span>${a.allergen_sheet ? "заполнен" : "пустой"}</span></div>
    <div class="muted small" style="margin-top:6px">Без бота не работают «Чай» в чате, часы в личке и напоминания. Приложение работает и без него.</div></div>`;
  $("#aWeek").addEventListener("change", async e => {
    const t = e.target.value;
    if (!confirm(`Писать неделю с ${human(a.week.monday)} в лист «${t}»? Все часы и чаевые этой недели пойдут туда.`)) { e.target.value = a.week.tab; return; }
    try { await api("admin_week", { tab: t }); a.week.tab = t; toast("Лист недели изменён"); }
    catch (er) { e.target.value = a.week.tab; toast(er.message); }
  });
}

/** Ставка за час по ролям. Сейчас считает деньги официантов; у барменов деньги — из «ТабельБот». */
ACT.aRates = () => push(renderRates);
async function renderRates() {
  setHead("Ставка за час");
  loading();
  let r;
  try { r = await api("admin_rates"); } catch (e) { return fail(e); }
  view.innerHTML = `<div class="card" style="padding:0"><div class="list" style="margin:0">${r.roles.map(x => `<div class="item"><div class="grow"><div class="t">${h(x.role)}</div>
      <div class="s">${r.waiter_roles.includes(x.role) ? "считает деньги в приложении" : "пока не используется"}</div></div>
      <input class="f num" style="max-width:96px" type="number" inputmode="numeric" min="0" step="10" value="${x.rate || ""}" placeholder="0" data-role="${h(x.role)}">
      <span class="muted small">₽/ч</span></div>`).join("")}</div></div>
    <button class="btn" data-act="aRatesSave">Сохранить</button>
    <div class="muted small" style="margin-top:8px">Личную ставку человека — в его карточке (Админ → человек). Она сильнее ставки роли.
      Деньги барменов считаются по «ТабельБот», эти ставки на них не влияют.</div>`;
  S.ratesWas = Object.fromEntries(r.roles.map(x => [x.role, String(x.rate || "")]));
}
ACT.aRatesSave = async (ds, el) => {
  el.disabled = true;
  try {
    for (const inp of view.querySelectorAll("input[data-role]")) {
      if (inp.value.trim() === (S.ratesWas[inp.dataset.role] || "")) continue;
      await api("admin_rate_set", { role: inp.dataset.role, rate: Number(inp.value || 0) });
    }
    toast("Ставки сохранены"); back();
  } catch (e) { toast(e.message); el.disabled = false; }
};

/** Очистка листов недель по кнопке: что выбрано — копируется в «Архив недель» и стирается. */
ACT.aClear = () => push(renderWeeksClear);
async function renderWeeksClear(done, tr) {
  setHead("Очистить листы недель");
  loading();
  let w;
  try { w = await api("admin_weeks_info"); } catch (e) { return fail(e); }
  const pick = new Set(w.tabs.filter(t => t.filled > 0 && !t.current).map(t => t.tab));
  const trInfo = w.transfer;
  const draw = () => {
    view.innerHTML = `${tr ? `<div class="card soft small">${tr.error ? `⚠️ ${h(tr.error)}` : `Неделя с ${h(human(tr.monday))} перенесена из «${h(tr.from)}» в «${h(tr.to)}»: ${tr.moved} записей. Дальше пишется в «${h(tr.to)}».`}</div>` : ""}
      ${trInfo ? `<div class="card small">🔁 Эта неделя (с ${h(human(trInfo.monday))}) — переходная, сейчас пишется в «${h(trInfo.from)}». После очистки она сама переедет в «${h(trInfo.to)}» со всеми записями${pick.has(trInfo.to) ? "" : ` — для этого отметь «${h(trInfo.to)}»`}.</div>` : ""}
      ${done ? `<div class="card soft">${done.map(x => `<div class="small">«${h(x.tab)}»: ${x.skipped ? h(x.skipped) : `стёрто ${x.cleared}, в архив — ${x.archived} строк`}</div>`).join("")}</div>` : ""}
      <div class="card" style="padding:0"><div class="list" style="margin:0">${w.tabs.map(t => `<label class="item tap">
        <input type="checkbox" data-t="${h(t.tab)}" ${pick.has(t.tab) ? "checked" : ""} style="width:20px;height:20px;flex:none">
        <div class="grow"><div class="t">${h(t.tab)} ${t.current ? '<span class="tag warn">эта неделя</span>' : ""}</div>
        <div class="s">${t.monday ? `неделя с ${h(human(t.monday))} · ` : ""}${t.filled ? `заполнено ячеек: ${t.filled}` : "пустой"}</div></div></label>`).join("")}</div></div>
      <button class="btn danger" id="wcGo" ${pick.size ? "" : "disabled"}>Очистить выбранные · ${pick.size}</button>
      <div class="muted small" style="margin-top:8px">Стираются часы по дням, «Чаевые бар/зал», «Взял» и Нетмонет. Имена, проценты и формулы остаются.
        Перед очисткой всё копируется в лист «Архив недель» в таблице приложения — чаевые прошлых недель в приложении не пропадут.
        Сначала закрепи месяц из «ТабельБот»: он считает часы по листам недель.</div>`;
    view.querySelectorAll("input[type=checkbox]").forEach(cb => cb.addEventListener("change", () => {
      if (cb.checked) pick.add(cb.dataset.t); else pick.delete(cb.dataset.t);
      draw();
    }));
    $("#wcGo").addEventListener("click", async () => {
      const list = [...pick];
      const cur = w.tabs.find(t => t.current && pick.has(t.tab));
      if (!confirm(`Очистить: ${list.join(", ")}?${cur ? `\n\n«${cur.tab}» — лист этой недели, в нём текущие часы и чаевые.` : ""}\n\nПеред очисткой всё сохранится в «Архив недель».`)) return;
      $("#wcGo").disabled = true; $("#wcGo").textContent = "Очищаю…";
      try { const r = await api("admin_weeks_clear", { tabs: list }); toast("Готово"); replaceTop(() => renderWeeksClear(r.done, r.transfer)); }
      catch (e) { toast(e.message); draw(); }
    });
  };
  draw();
}

/** Открыть / закрыть доступ: на экране сразу, запрос — в фоне. */
ACT.aUser = async (ds, el, e) => {
  if (e) e.stopPropagation();
  const id = Number(ds.id), ok = ds.ok === "1";
  const u = S.adm && S.adm.users.find(x => x.id === id);
  const prev = u && { status: u.status, new: u.new };
  if (u) { u.status = ok ? "approved" : "rejected"; u.new = false; if (ok && !u.role) u.role = "гость"; LS.set("adm", S.adm); }
  S.stack[S.stack.length - 1]();
  try {
    await api("admin_user", { id, ok });
    toast(ok ? "Доступ открыт" : "Доступ закрыт");
  } catch (er) {
    if (u) { Object.assign(u, prev); LS.set("adm", S.adm); S.stack[S.stack.length - 1](); }
    toast(er.message);
  }
};
ACT.aEdit = (ds, el, e) => { if (e.target.closest("button")) return; push(() => renderAdminUser(Number(ds.id))); };

/** Экран сотрудника: доступ, роль, имя в графике и в таблице чаевых. Подсказки — по графику. */
function renderAdminUser(id) {
  setHead("Сотрудник");
  fresh("admp" + id, "admin_people", { id }, p => drawAdminUser(p));
}
function drawAdminUser(p) {
  const u = p.user, sg = p.suggest;
  const cur = S.adm && S.adm.users.find(x => x.id === u.id);
  if (cur) u.status = cur.status;
  const secs = {};
  p.schedule.forEach(x => (secs[x.section] = secs[x.section] || []).push(x.name));
  const sn = u.schedule_name || sg.schedule_name || "", tn = u.tips_name || sg.tips_name || "";
  const rl = u.role && u.role !== "гость" ? u.role : (sg.role || u.role || "");
  const hint = (c, s) => !c && s ? ' <span class="tag warn">подсказка</span>' : "";
  const status = u.owner ? "владелец" : ({ approved: "есть доступ", pending: "ждёт разрешения", rejected: "доступ закрыт" }[u.status] || "—");
  view.innerHTML = `<div class="card row" style="gap:12px"><div class="ava big">${h(initials(u.name))}</div>
    <div class="grow"><h3>${h(u.name || "Без имени")}</h3><div class="muted small">${u.username ? "@" + h(u.username) + " · " : ""}${status}</div></div></div>
    ${u.owner ? "" : `<div class="btns" style="margin-bottom:10px">${u.status === "approved"
      ? `<button class="btn danger" data-act="aUser" data-id="${u.id}" data-ok="0">Закрыть доступ</button>`
      : `<button class="btn" data-act="aUser" data-id="${u.id}" data-ok="1">${u.status === "pending" ? "Пустить" : "Открыть доступ"}</button>
         ${u.status === "pending" ? `<button class="btn danger" data-act="aUser" data-id="${u.id}" data-ok="0">Отклонить</button>` : ""}`}</div>`}
    <div class="card">
      <label class="l" style="margin-top:0">Роль${hint(u.role && u.role !== "гость" ? u.role : "", sg.role)}</label>
      <select class="f" id="uRole"><option value="">— не назначена —</option>${p.roles.map(r => `<option ${r === rl ? "selected" : ""}>${h(r)}</option>`).join("")}</select>
      <div class="muted small" style="margin-top:4px">Гость видит только меню. ТК, заготовки и учёт часов — бармены и администраторы.</div>
      <label class="l">Кто в графике${hint(u.schedule_name, sg.schedule_name)}</label>
      <select class="f" id="uSched"><option value="">— не связан —</option>${Object.entries(secs).map(([s, ns]) => `<optgroup label="${h(s)}">${ns.map(n => `<option ${n === sn ? "selected" : ""}>${h(n)}</option>`).join("")}</optgroup>`).join("")}</select>
      <label class="l">Кто в таблице чаевых${hint(u.tips_name, sg.tips_name)}</label>
      <select class="f" id="uTips"><option value="">— не связан —</option>${p.tips.map(n => `<option ${n === tn ? "selected" : ""}>${h(n)}</option>`).join("")}</select>
      ${p.tips.length ? "" : '<div class="small" style="color:var(--danger);margin-top:4px">Таблица чаевых сейчас недоступна</div>'}
      ${p.rate ? `<label class="l">Личная ставка, ₽/ч</label>
      <input class="f num" id="uRate" type="number" inputmode="numeric" min="0" step="10" value="${p.rate.personal ? p.rate.rate : ""}" placeholder="по роли: ${p.rate.role_rate || 0}">
      <div class="muted small" style="margin-top:4px">Пусто — ставка роли (Админ → Деньги → Ставка за час). Сейчас считает деньги официантов.</div>` : ""}
      <button class="btn" data-act="aSaveUser" data-id="${u.id}">Сохранить</button></div>
    ${tsCard(p, u)}`;
}
function tsCard(p, u) {
  if (!p.can_hours && !p.timesheet) return "";
  let body;
  if (p.timesheet) body = `<div class="muted small">Бот пишет сюда часы и сам добавляет лист каждого месяца.</div>
    <button class="btn ghost" data-act="link" data-url="${h(p.timesheet.url)}">Открыть табель</button>`;
  else if (u.tips_name) body = `<div class="muted small">Табеля пока нет. Заведу по образцу табеля Романа и перенесу уже записанные смены.</div>
    <button class="btn ghost" data-act="aTs" data-id="${u.id}">Завести табель</button>`;
  else body = `<div class="muted small">Табель заведётся сам, когда выберешь имя в таблице чаевых.</div>`;
  return `<div class="card"><h2>📒 Личный табель</h2>${body}</div>`;
}
ACT.link = ds => { if (tg) tg.openLink(ds.url); else window.open(ds.url); };
ACT.aTs = async (ds, el) => {
  el.disabled = true; el.textContent = "Завожу… (до 20 секунд)";
  try {
    const r = await api("admin_timesheet", { id: Number(ds.id) });
    toast(r.created ? `Табель заведён${r.filled ? `, перенёс смен: ${r.filled}` : ""}` : "Табель уже есть");
    el.outerHTML = `<button class="btn ghost" data-act="link" data-url="${h(r.url)}">Открыть табель</button>`;
  } catch (e) { toast(e.message); el.disabled = false; el.textContent = "Завести табель"; }
};
ACT.aSaveUser = async (ds, el) => {
  el.disabled = true;
  const id = Number(ds.id), body = { id, role: $("#uRole").value, schedule_name: $("#uSched").value, tips_name: $("#uTips").value };
  if ($("#uRate")) body.rate = $("#uRate").value.trim();
  try {
    const r = await api("admin_user_update", body);
    if (r.timesheet && r.timesheet.created) toast("Сохранил и завёл личный табель");
    else if (r.timesheet && r.timesheet.error) toast("Сохранил, но табель не завёлся: " + r.timesheet.error);
    const u = S.adm && S.adm.users.find(x => x.id === id);
    if (u) { Object.assign(u, { role: body.role, schedule_name: body.schedule_name, tips_name: body.tips_name, new: false }); LS.set("adm", S.adm); }
    if (id === S.me.id) { S.me = await api("me"); LS.set("me", S.me); }
    if (!r.timesheet) toast("Сохранил");
    back();
  } catch (e) { toast(e.message); el.disabled = false; }
};
ACT.aNm = async (ds, el) => {
  const v = $("#aNm").value; if (!v) return;
  el.disabled = true;
  const wk = $("#aNmWeek") ? $("#aNmWeek").value : "";
  try {
    const r = await api("admin_netmonet", { amount: v, monday: wk });
    toast(`Нетмонет ${r.amount} → «${r.tab}» (неделя с ${human(r.monday)})`); $("#aNm").value = "";
    const o = $("#aNmWeek") && $("#aNmWeek").selectedOptions[0];
    if (o) o.textContent = o.textContent.replace(/( · \d+ неделя)( · .*)?$/, `$1 · ${r.amount}`);
  } catch (e) { toast(e.message); }
  el.disabled = false;
};
ACT.aRefresh = async (ds, el) => { el.disabled = true; try { await api("admin_refresh"); S.tk = null; S.al = null; toast("Обновил"); } catch (e) { toast(e.message); } el.disabled = false; };
ACT.aAllergen = async (ds, el) => { el.disabled = true; try { const r = await api("admin_allergen_fill"); S.al = null; toast(r.added ? `Добавил позиций: ${r.added}` : "Новых позиций нет"); if (tg) tg.openLink(r.url); else window.open(r.url); } catch (e) { toast(e.message); } el.disabled = false; };
ACT.aOpen = ds => push(ds.s === "tips" ? () => renderAdminTips() : () => renderAdminSalary(0));
/** Только просмотр: выбор листа здесь не меняет, куда пишется неделя. */
async function renderAdminTips(tab) {
  setHead("К выдаче за неделю"); loading();
  try {
    const t = await api("admin_tips", tab ? { tab } : {});
    view.innerHTML = `<div class="chips wrap" style="margin-bottom:8px">${t.tabs.map(x => `<button class="chip ${x === t.tab ? "on" : ""}" data-act="aTipsTab" data-t="${h(x)}">${h(x)}${x === t.current ? " · сейчас" : ""}</button>`).join("")}</div>
      <div class="card"><h2>Лист «${h(t.tab)}»</h2><div class="muted small" style="margin:-4px 0 8px">${t.tab === t.current ? "эта неделя" : t.monday ? `неделя с ${h(human(t.monday))}` : "старая неделя"}</div><table class="t"><tr><th>Кто</th><th class="r">Взял</th><th class="r">К выдаче</th></tr>
      ${t.people.map(p => `<tr><td>${h(p.name)}</td><td class="r">${h(p.took || "—")}</td><td class="r"><b>${h(p.pay || "—")}</b></td></tr>`).join("")}</table></div>`;
  } catch (e) { fail(e); }
}
async function renderAdminSalary(off) {
  setHead("Зарплата всех"); loading();
  try {
    const s = await api("admin_salary", { offset: off });
    const sum = s.rows.reduce((a, r) => a + (r.total || 0), 0);
    view.innerHTML = `<div class="monthnav"><button data-act="aSal" data-o="${off - 1}">‹</button><b>${h(s.title)}</b><button data-act="aSal" data-o="${off + 1}" ${off >= 0 ? "disabled" : ""}>›</button></div>
      ${s.live ? `<div class="muted small" style="margin-bottom:6px"><span class="tag warn">идёт месяц</span> по «ТабельБот», итог — после закрытия месяца</div>` : ""}
      <div class="card">${s.tab ? `<table class="t"><tr><th>Кто</th><th class="r">Часы</th><th class="r">Итого</th></tr>
      ${s.rows.map(r => `<tr><td>${h(r.name)}</td><td class="r">${hrs(r.hours)}</td><td class="r"><b>${money(r.total)}</b></td></tr>`).join("")}
      <tr><td><b>Всего</b></td><td></td><td class="r"><b>${money(sum)}</b></td></tr></table>` : empty("🗓", "Листа за этот месяц нет")}</div>`;
  } catch (e) { fail(e); }
}
ACT.aSal = ds => replaceTop(() => renderAdminSalary(Number(ds.o)));
ACT.aTipsTab = ds => replaceTop(() => renderAdminTips(ds.t));

// ---------- справочник соусов: ссылки в составе и окно снизу ----------
const GL_NOT = "[^0-9a-zа-я]";
function glossTerms() {
  const g = (S.menu && S.menu.kitchen && S.menu.kitchen.glossary) || [];
  if (S._glTerms && S._glFor === g) return S._glTerms;
  const terms = [];
  g.forEach((e, i) => [e.name].concat(e.aliases || []).forEach(t => {
    const words = t.toLowerCase().replace(/ё/g, "е").replace(/[^0-9a-zа-я]+/g, " ").trim().split(" ").filter(Boolean);
    if (words.join(" ").length >= 3) terms.push({ i, len: words.join(" ").length, re: new RegExp(`(^|${GL_NOT})(${words.join(`${GL_NOT}+`)})(?=$|${GL_NOT})`, "g") });
  }));
  terms.sort((a, b) => b.len - a.len);
  S._glTerms = terms; S._glFor = g;
  return terms;
}
/** Текст → HTML, где названия из справочника — ссылки. Своё имя (у самого соуса) не подсвечиваем. */
function linkify(text, selfName) {
  const g = (S.menu && S.menu.kitchen && S.menu.kitchen.glossary) || [];
  const src = String(text || ""), low = src.toLowerCase().replace(/ё/g, "е");
  const taken = [];
  for (const t of glossTerms()) {
    if (selfName && g[t.i].name === selfName) continue;
    t.re.lastIndex = 0;
    let m;
    while ((m = t.re.exec(low))) {
      const s = m.index + m[1].length, e = s + m[2].length;
      if (!taken.some(x => s < x.e && e > x.s)) taken.push({ s, e, i: t.i });
      if (t.re.lastIndex === m.index) t.re.lastIndex++;
    }
  }
  taken.sort((a, b) => a.s - b.s);
  let out = "", pos = 0;
  for (const x of taken) {
    out += h(src.slice(pos, x.s)) + `<a class="gl" data-gi="${x.i}">${h(src.slice(x.s, x.e))}</a>`;
    pos = x.e;
  }
  return out + h(src.slice(pos));
}
function openGloss(i) {
  const e = S.menu.kitchen.glossary[i];
  if (!e) return;
  let sh = $("#sheet");
  if (!sh) {
    sh = document.createElement("div");
    sh.id = "sheet";
    document.body.appendChild(sh);
    sh.addEventListener("click", ev => {
      const a = ev.target.closest("[data-gi]");
      if (a) { haptic(); openGloss(Number(a.dataset.gi)); return; }
      if (ev.target === sh || ev.target.closest(".sheet-x")) closeGloss();
    });
  }
  const tags = (e.allergens || []).map(a => `<span class="tag bad">${h(S.menu.titles[a])}</span>`)
    .concat((e.allergens_other || []).map(a => `<span class="tag">${h(a)}</span>`)).join(" ");
  sh.innerHTML = `<div class="sheet-card" role="dialog" aria-label="${h(e.name)}"><div class="row between"><h3>${h(e.name)}</h3>
    <button class="sheet-x" aria-label="Закрыть">✕</button></div>
    <div style="margin-top:6px">${e.composition ? linkify(e.composition, e.name) : '<span class="muted">Состав не заполнен</span>'}</div>
    ${tags ? `<div class="tags" style="margin-top:10px">${tags}</div>` : ""}</div>`;
  requestAnimationFrame(() => sh.classList.add("on"));
}
function closeGloss() { const sh = $("#sheet"); if (sh) sh.classList.remove("on"); }
view.addEventListener("click", ev => { const a = ev.target.closest("[data-gi]"); if (a) { haptic(); openGloss(Number(a.dataset.gi)); } });

// ---------- фото меню: маленькие превью, прямые ссылки с кэшем на сутки ----------
/** Ссылка Google Диска → прямая ссылка на картинку нужной ширины в WebP (кэшируется телефоном, без переадресаций). */
function photoSrc(url, w) {
  const m = /[?&]id=([\w-]+)/.exec(url || "") || /\/d\/([\w-]+)/.exec(url || "");
  return m ? `https://lh3.googleusercontent.com/d/${m[1]}=w${w}-rw` : url;
}
const preloaded = new Set();
/** Превью меню грузим заранее в фоне — к моменту открытия «Кухни» они уже в кэше. */
function preloadPhotos(menu) {
  const list = ((menu && menu.kitchen && menu.kitchen.items) || []).filter(i => i.photo).map(i => photoSrc(i.photo, 240));
  list.forEach(src => { if (preloaded.has(src)) return; preloaded.add(src); const im = new Image(); im.decoding = "async"; im.src = src; });
}

// ================= БАР: чекины и счётчики =================
function countersHtml(p) {
  const titles = p.counter_titles || [{ key: "highball", title: "Хайболов выпито", icon: "🥃" }, { key: "champagne", title: "Шампейн шауэров", icon: "🍾" }];
  return `<div class="counters">${titles.map(t => `<div><div class="cnum num">${(p.counters[t.key] || 0).toLocaleString("ru-RU")}</div>
    <div class="muted small">${t.icon} ${h(t.title)}</div></div>`).join("")}</div>`;
}
ACT.openBar = () => push(renderBar);
function renderBar() {
  setHead("Грязнульки", human(S.me.today));
  fresh("bar", "presence", {}, drawBar);
}
function drawBar(p) {
  S.bar = p;
  const me = p.me, bb = p.busbro || { bros: [], incoming: [], outgoing: [] };
  let html = `<div class="card hero">${countersHtml(p)}</div>`;
  if (me && me.in) {
    html += `<div class="card"><div class="row between"><div><b>Ты в баре</b> с ${h(me.time)}${me.anon ? ' <span class="tag">невидимка</span>' : ""}</div></div>
      <div class="btns" style="margin-top:8px"><button class="btn ghost" data-act="checkin" data-anon="${me.anon ? 0 : 1}">${me.anon ? "Показать меня" : "Стать невидимкой"}</button>
      <button class="btn danger" data-act="checkout">Я ушёл</button></div></div>`;
  } else {
    html += `<div class="card"><button class="btn" data-act="checkin" data-anon="0">📍 Я в баре</button>
      <button class="btn ghost" data-act="checkin" data-anon="1">👻 Отметиться невидимкой</button>
      <div class="muted small" style="margin-top:6px">Невидимку видно только в общем числе гостей. Отметки сбрасываются к утру.</div></div>`;
  }
  if (bb.incoming.length) {
    html += `<div class="card"><h2>Зовут в BusBro</h2><div class="list">${bb.incoming.map(x => `<div class="item"><div class="ava">${h(initials(x.name))}</div>
      <div class="grow t">${h(x.name)}</div>
      <button class="btn sm" data-act="broAnswer" data-h="${h(x.h)}" data-y="1">Принять</button>
      <button class="btn sm ghost" data-act="broAnswer" data-h="${h(x.h)}" data-y="0">Не сейчас</button></div>`).join("")}</div></div>`;
  }
  const broTag = { active: '<span class="tag ok">BusBro</span>', out: '<span class="tag">позвал</span>', in: '<span class="tag warn">зовёт</span>' };
  html += `<div class="card"><h2>Сейчас в баре · ${p.total}</h2>`;
  if (!p.here.length && !p.anon) html += `<div class="muted small">Пока никто не отметился</div>`;
  else html += `<div class="list">${p.here.map(x => {
      const tap = x.key ? ` tap" data-act="broTap" data-k="${h(x.key)}" data-n="${h(x.name)}" data-s="${h(x.bro || "")}" data-h="${h(x.h || "")}` : "";
      return `<div class="item${x.me ? " meitem" : ""}${tap}"><div class="ava">${h(initials(x.name))}</div>
      <div class="grow t">${h(x.name)}</div>${broTag[x.bro] || ""}<div class="muted small num">с ${h(x.time)}</div></div>`;
    }).join("")}
      ${p.anon ? `<div class="item muted">👻 и ещё ${p.anon} инкогнито</div>` : ""}</div>`;
  html += `</div>`;
  if (p.busbro) html += busbroCard(bb);
  view.innerHTML = html;
}
/** «Мои BusBro»: друзья по бару, уведомления о них и отправленные приглашения. */
function busbroCard(bb) {
  let html = `<div class="card"><h2>Мои BusBro${bb.bros.length ? " · " + bb.bros.length : ""}</h2>`;
  if (!bb.bros.length && !bb.outgoing.length) {
    return html + `<div class="muted small">Нажми на человека в «Сейчас в баре», чтобы позвать в BusBro. Когда кто-то из вас отмечается в Bus (не невидимкой), бот пишет второму. Ник и профиль Telegram никто не видит.</div></div>`;
  } else {
    html += `<div class="list">${bb.bros.map(x => `<div class="item"><div class="ava">${h(initials(x.name))}</div>
      <div class="grow t">${h(x.name)}${x.mute ? ' <span class="tag">без уведомлений</span>' : ""}</div>
      <button class="btn sm ghost" data-act="broMute" data-h="${h(x.h)}" data-m="${x.mute ? 0 : 1}" aria-label="${x.mute ? "Включить уведомления" : "Выключить уведомления"}">${x.mute ? "🔕" : "🔔"}</button>
      <button class="btn sm ghost" data-act="broRemove" data-h="${h(x.h)}" data-n="${h(x.name)}" aria-label="Убрать из BusBro">✕</button></div>`).join("")}
      ${bb.outgoing.map(x => `<div class="item"><div class="ava">${h(initials(x.name))}</div>
      <div class="grow"><div class="t">${h(x.name)}</div><div class="s">ждём ответа</div></div>
      <button class="btn sm ghost" data-act="broRemove" data-h="${h(x.h)}" data-n="${h(x.name)}" data-out="1">Отозвать</button></div>`).join("")}</div>`;
  }
  html += `<div class="muted small" style="margin-top:8px">Бот пишет BusBro, когда ты отмечаешься не невидимкой, — каждому не чаще раза за вечер. Ник и профиль Telegram никто не видит.</div></div>`;
  return html;
}
async function barAction(action, params, el, done) {
  if (el) el.disabled = true;
  try { const p = await api(action, params); LS.set("bar", p); haptic("medium"); drawBar(p); if (done) toast(done); }
  catch (e) { toast(e.message); if (el) el.disabled = false; }
}
ACT.checkin = (ds, el) => barAction("checkin", { anon: ds.anon === "1" }, el);
ACT.broTap = async (ds, el) => {
  if (ds.s === "active") return toast(`${ds.n} — твой BusBro`);
  if (ds.s === "out") return toast("Позвал — ждём ответа");
  if (ds.s === "in") {
    if (await confirmBox(`${ds.n} зовёт тебя в BusBro. Принять?`)) barAction("busbro_answer", { h: ds.h, yes: true }, el, "Теперь вы BusBro 🤝");
    return;
  }
  const me = S.bar && S.bar.me;
  if (!(me && me.in)) return toast("Позвать в BusBro можно, когда ты в баре — сначала отметься");
  if (me.anon) return toast("Невидимка никого не зовёт — сначала нажми «Показать меня»");
  if (await confirmBox(`Позвать ${ds.n} в BusBro? Когда кто-то из вас отметится в Bus, бот напишет второму. Ник и профиль Telegram никто не увидит.`)) {
    barAction("busbro_invite", { key: ds.k }, el, "Позвал — бот передаст приглашение");
  }
};
ACT.broAnswer = (ds, el) => barAction("busbro_answer", { h: ds.h, yes: ds.y === "1" }, el, ds.y === "1" ? "Теперь вы BusBro 🤝" : "");
ACT.broMute = (ds, el) => barAction("busbro_mute", { h: ds.h, mute: ds.m === "1" }, el, ds.m === "1" ? "Уведомления выключены" : "Уведомления включены");
ACT.broRemove = async (ds, el) => {
  const q = ds.out ? `Отозвать приглашение для ${ds.n}? Позвать снова можно будет через месяц после первого приглашения.`
    : `Убрать ${ds.n} из BusBro? Уведомлений друг о друге больше не будет. Бот никому не напишет.`;
  if (await confirmBox(q)) barAction("busbro_remove", { h: ds.h }, el);
};
ACT.checkout = async (ds, el) => { if (await confirmBox("Отметить, что ты ушёл?")) barAction("checkout", {}, el); };

function renderAdminCounters() {
  setHead("Счётчики");
  const p = S.bar || LS.get("bar") || (S.dash && S.dash.bar) || { counters: {} };
  const c = p.counters || {};
  const row = (k, title) => `<label class="l">${title}</label><div class="row">
    <input class="f num" id="cnt_${k}" type="number" inputmode="numeric" min="0" value="${c[k] || 0}">
    <button class="btn sm ghost" data-act="cntAdd" data-k="${k}" data-n="1">+1</button>
    <button class="btn sm ghost" data-act="cntAdd" data-k="${k}" data-n="5">+5</button></div>`;
  view.innerHTML = `<div class="card">${row("highball", "🥃 Хайболов выпито")}${row("champagne", "🍾 Шампейн шауэров")}
    <button class="btn" data-act="cntSave">Сохранить</button>
    <div class="muted small" style="margin-top:6px">Цифры видят все, у кого есть доступ: на главной и во вкладке «Бар».</div></div>`;
}
async function saveCounters(body, el) {
  if (el) el.disabled = true;
  try {
    const c = await api("admin_counters", body);
    ["highball", "champagne"].forEach(k => { const i = $("#cnt_" + k); if (i) i.value = c[k]; });
    const b = LS.get("bar"); if (b) { b.counters = c; LS.set("bar", b); S.bar = b; }
    toast("Счётчики обновлены");
  } catch (e) { toast(e.message); }
  if (el) el.disabled = false;
}
ACT.cntAdd = (ds, el) => saveCounters({ add: { [ds.k]: Number(ds.n) } }, el);
ACT.cntSave = (ds, el) => saveCounters({ set: { highball: $("#cnt_highball").value, champagne: $("#cnt_champagne").value } }, el);

// ---------- старт ----------
const TABS = {
  home: ["🏠", "Главная"], schedule: ["📅", "График"], menu: ["🍽", "Меню"], more: ["☰", "Ещё"], bar: ["🍻", "Грязнульки"],
};
function setTabs(list) {
  $("#tabs").innerHTML = list.map(t => `<button data-tab="${t}"><span class="ic">${TABS[t][0]}</span><span>${TABS[t][1]}</span></button>`).join("");
  $("#tabs").style.display = "";
}
function startUI() {
  if (S.me.is_guest) {  // гость: «Бар» (чекин, кто здесь, счётчики) и «Меню»
    setTabs(["bar", "menu"]);
    S.menuMode = "kitchen";
    go("bar");
    return;
  }
  setTabs(["home", "schedule", "menu", "more"]);
  // кнопка в сообщении бота открывает приложение с ?tab=bar (уведомления BusBro)
  const start = (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) || new URLSearchParams(location.search).get("tab") || "home";
  if (start === "bar") { go("home"); push(renderBar); return; }
  go(["home", "schedule", "menu", "more"].includes(start) ? start : "home");
}

/** Заранее подгружаем другие вкладки в кэш, чтобы они открывались мгновенно. */
function prefetch() {
  if (S.me.is_guest) return;
  setTimeout(async () => {
    const jobs = [["sch0", "schedule", { offset: 0 }], ["menu", "menu", {}]];
    if (S.me.is_owner) jobs.push(["adm", "admin_overview", {}]);
    for (const [key, action, params] of jobs) {
      try { const d = await api(action, params); LS.set(key, d); if (key === "menu") preloadPhotos(d); } catch (e) {}
    }
  }, 300);
}

(async function init() {
  const cachedMe = LS.get("me");
  if (cachedMe) { S.me = cachedMe; S.booting = true; startUI(); }
  let boot;
  try {
    try { boot = await api("boot"); }
    catch (e) {  // скрипт ещё старой версии — по-старому, двумя запросами
      if (!/неизвестное действие/.test(e.message)) throw e;
      const me = await api("me");
      boot = { me, dashboard: me.is_guest ? null : await api("dashboard") };
    }
  } catch (e) {
    S.booting = false;
    if (cachedMe && e.status !== 403 && e.status !== 401) { toast("Не обновилось: " + e.message); if (S.tab === "home" && !S.stack.length) renderHome(); return; }
    $("#tabs").style.display = "none";
    setHead("Бар");
    view.innerHTML = e.status === 403 ? empty("🔒", h(e.message) + (/одобрен/.test(e.message) ? "<br>Напиши боту /start — владелец получит заявку." : ""))
      : empty("📱", h(e.message) + (tg && tg.initData ? "" : "<br><br>Открой приложение кнопкой в боте."));
    return;
  }
  S.booting = false;
  const roleChanged = !cachedMe || cachedMe.is_guest !== boot.me.is_guest;
  S.me = boot.me;
  LS.set("me", boot.me);
  if (boot.dashboard) LS.set("dash", boot.dashboard);
  if (boot.menu) LS.set("menu", boot.menu);
  if (boot.presence) LS.set("bar", boot.presence);
  if (roleChanged) startUI();
  else if (S.tab === "home" && !S.stack.length && boot.dashboard) drawHome(boot.dashboard);
  else if (S.me.is_guest && !S.stack.length) {  // гостю — обновить тот экран, на котором он сейчас
    if (S.tab === "bar" && boot.presence) drawBar(boot.presence);
    else if (S.tab === "menu" && boot.menu) { S.menu = boot.menu; drawMenuScreen(); }
  }
  prefetch();
})();
