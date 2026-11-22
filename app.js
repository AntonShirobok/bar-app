/* Бар · Mini App. Без сборки и зависимостей: один файл, экраны рисуются строками. */
"use strict";

const tg = window.Telegram ? window.Telegram.WebApp : null;
if (tg) { tg.ready(); tg.expand(); document.documentElement.dataset.tg = "1"; }

const $ = (s, el = document) => el.querySelector(s);
const view = $("#view");
const WD = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const MGEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

const S = { me: null, tab: "schedule", tk: null, stack: [], sched: { offset: 0, mode: "mine", day: null },
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

// ---------- навигация ----------
function go(tab) {
  S.tab = tab; S.stack = [];
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
  backBtn();
  window.scrollTo(0, 0);
  ({ schedule: renderSchedule, money: renderMoney, tk: renderTK, stock: renderStock, more: renderMore })[tab]();
}
function push(fn) { S.stack.push(fn); backBtn(); window.scrollTo(0, 0); fn(); }
function replaceTop(fn) { S.stack[S.stack.length - 1] = fn; fn(); }
function back() { S.stack.pop(); backBtn(); const f = S.stack[S.stack.length - 1]; f ? f() : go(S.tab); }
function backBtn() {
  if (!tg) return;
  if (S.stack.length) tg.BackButton.show(); else tg.BackButton.hide();
}
if (tg) tg.BackButton.onClick(back);
document.querySelectorAll("#tabs button").forEach(b => b.addEventListener("click", () => { haptic(); go(b.dataset.tab); }));
view.addEventListener("click", e => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const fn = ACT[el.dataset.act];
  if (fn) { haptic(); fn(el.dataset, el, e); }
});
const ACT = {};

// ================= ГРАФИК =================
async function renderSchedule() {
  setHead("График", S.me.schedule_name || "");
  loading();
  let d;
  try { d = await api("schedule", { offset: S.sched.offset }); } catch (e) { return fail(e); }
  S.schedData = d;
  const title = `${MONTHS[d.month - 1]} ${d.year}`;
  let html = `<div class="monthnav"><button data-act="schMonth" data-d="-1" ${S.sched.offset <= -2 ? "disabled" : ""}>‹</button>
    <b>${title}</b><button data-act="schMonth" data-d="1" ${S.sched.offset >= 2 ? "disabled" : ""}>›</button></div>
    <div class="seg"><button data-act="schMode" data-m="mine" class="${S.sched.mode === "mine" ? "on" : ""}">Мои смены</button>
    <button data-act="schMode" data-m="all" class="${S.sched.mode === "all" ? "on" : ""}">Кто на смене</button></div>`;
  if (!d.title) { view.innerHTML = html + empty("🗓", `В таблице графика нет листа «${title}»`); return; }
  html += S.sched.mode === "mine" ? scheduleMine(d) : scheduleAll(d);
  view.innerHTML = html;
  const on = $(".day.on"); if (on) on.scrollIntoView({ inline: "center", block: "nearest" });
}
function scheduleMine(d) {
  if (!d.me) return `<div class="card">${empty("🙋", "Не нашёл тебя в графике.")}<button class="btn" data-act="profile">Выбрать себя</button></div>`;
  const today = d.today;
  const sh = d.mine;
  const total = sh.reduce((a, s) => a + (s.hours || 0), 0);
  let html = `<div class="card"><div class="row between"><div><div class="big num">${sh.length}</div><div class="muted small">смен в месяце</div></div>
    <div class="right"><div class="big num">${hrs(total)}</div><div class="muted small">часов по графику</div></div></div>
    <button class="btn" data-act="calendar">📅 Добавить смены в календарь</button></div>`;
  if (!sh.length) return html + `<div class="card">${empty("🌴", "В этом месяце смен нет")}</div>`;
  const past = sh.filter(s => s.day < today);
  const shown = S.sched.showPast ? sh : sh.filter(s => s.day >= today);
  if (past.length) html += `<button class="btn ghost" style="margin:0 0 10px" data-act="schPast">${S.sched.showPast ? "Скрыть прошедшие" : `Показать прошедшие · ${past.length}`}</button>`;
  if (!shown.length) return html + `<div class="card">${empty("✅", "Смены в этом месяце закончились")}</div>`;
  html += `<div class="card" style="padding:0">`;
  for (const s of shown) {
    const x = dt(s.day);
    const cls = s.day === today ? "today" : (s.day < today ? "past" : "");
    const time = s.start ? `${s.start}–${s.end}` : h(s.text);
    html += `<div class="shift ${cls}"><div class="d"><b>${x.getDate()}</b><small>${WD[x.getDay()]}</small></div>
      <div class="grow"><div class="t num" style="font-weight:600">${time}${s.day === today ? ' <span class="tag">сегодня</span>' : ""}</div>
      <div class="s small muted">${h(s.section)}${s.station ? ` · точка ${h(s.station)}` : ""}${s.hours ? ` · ${hrs(s.hours)} ч` : ""}</div></div></div>`;
  }
  return html + "</div>";
}
function scheduleAll(d) {
  const days = new Date(d.year, d.month, 0).getDate();
  const todayD = dt(d.today);
  const isCur = todayD.getFullYear() === d.year && todayD.getMonth() + 1 === d.month;
  if (!S.sched.day || S.sched.day > days) S.sched.day = isCur ? todayD.getDate() : 1;
  const mineDays = new Set(d.mine.map(s => dt(s.day).getDate()));
  let html = `<div class="days">`;
  for (let i = 1; i <= days; i++) {
    const x = new Date(d.year, d.month - 1, i);
    const cls = [i === S.sched.day ? "on" : "", mineDays.has(i) ? "mine" : "", isCur && i === todayD.getDate() ? "today" : ""].join(" ");
    html += `<button class="day ${cls}" data-act="schDay" data-i="${i}"><small>${WD[x.getDay()]}</small><b>${i}</b></button>`;
  }
  html += `</div>`;
  const day = String(S.sched.day);
  const groups = {};
  for (const p of d.people) {
    const v = p.shifts[day];
    if (!v) continue;
    (groups[p.section] = groups[p.section] || []).push([p.name === p.section ? "" : p.name, v, p.name === d.me]);
  }
  const iso = `${d.year}-${String(d.month).padStart(2, "0")}-${day.padStart(2, "0")}`;
  html += `<div class="muted small" style="margin:0 4px 6px">${human(iso)}</div>`;
  const keys = Object.keys(groups);
  if (!keys.length) return html + `<div class="card">${empty("🫥", "Никого нет в графике")}</div>`;
  for (const sec of keys) {
    html += `<div class="card"><h2>${h(sec)}</h2><div class="list">`;
    for (const [name, v, me] of groups[sec]) {
      html += `<div class="item" ${me ? 'style="background:var(--soft)"' : ""}><div class="grow t">${h(name || v)}</div>
        ${name ? `<div class="num muted">${h(v)}</div>` : ""}</div>`;
    }
    html += `</div></div>`;
  }
  return html;
}
ACT.schMonth = ds => { S.sched.offset += Number(ds.d); S.sched.day = null; renderSchedule(); };
ACT.schPast = () => { S.sched.showPast = !S.sched.showPast; renderSchedule(); };
ACT.schMode = ds => { S.sched.mode = ds.m; renderSchedule(); };
ACT.schDay = ds => { S.sched.day = Number(ds.i); renderScheduleFromCache(); };
function renderScheduleFromCache() {
  const d = S.schedData;
  const top = view.innerHTML.split('<div class="days">')[0];
  view.innerHTML = top + scheduleAll(d);
  const on = $(".day.on"); if (on) on.scrollIntoView({ inline: "center", block: "nearest" });
}
ACT.calendar = async (ds, el) => {
  el.disabled = true;
  try {
    const c = await api("calendar");
    if (tg) tg.openLink(c.page); else window.open(c.page);
      } catch (e) { toast(e.message); }
  el.disabled = false;
};

// ================= ДЕНЬГИ =================
async function renderMoney() {
  setHead("Деньги", S.me.tips_name || "");
  if (!S.me.tips_name) {
    view.innerHTML = `<div class="card">${empty("🙈", "Сначала выбери себя в таблице чаевых")}<button class="btn" data-act="profile">Выбрать себя</button></div>`;
    return;
  }
  loading();
  const [w, m] = await Promise.allSettled([api("week", { offset: S.money.week }), api("money", { offset: S.money.offset })]);
  let html = "";
  html += m.status === "fulfilled" ? monthCard(m.value) : `<div class="card">${empty("😕", h(m.reason.message))}</div>`;
  html += w.status === "fulfilled" ? weekCard(w.value) : `<div class="card"><h2>Неделя</h2>${empty("😕", h(w.reason.message))}
      ${S.money.week ? '<button class="btn ghost" data-act="week" data-d="1">К текущей неделе</button>' : ""}</div>`;
  view.innerHTML = html;
}
function monthCard(r) {
  let html = `<div class="card"><div class="monthnav" style="margin-bottom:4px"><button data-act="moMonth" data-d="-1">‹</button>
    <b>${h(r.title)}</b><button data-act="moMonth" data-d="1" ${S.money.offset >= 0 ? "disabled" : ""}>›</button></div>`;
  if (r.row) {
    const x = r.row;
    html += `<div class="stat"><span>Часы</span><b class="num">${hrs(x.hours)}</b></div>`;
    if (x.rate && x.rate >= 5000) html += `<div class="stat"><span>Оклад</span><span class="num">${money(x.rate)}</span></div>`;
    else if (x.rate) html += `<div class="stat"><span>По ставке <span class="muted small">${hrs(x.hours)} × ${money(x.rate)}</span></span><span class="num">${money(x.hours * x.rate)}</span></div>`;
    if (x.tips) html += `<div class="stat"><span>Чаевые${x.share ? ` <span class="muted small">доля ${h(x.share)}</span>` : ""}</span><span class="num">${money(x.tips)}</span></div>`;
    if (x.deduct) html += `<div class="stat"><span>Вычет</span><span class="num" style="color:var(--danger)">−${money(x.deduct)}</span></div>`;
    for (const e of r.extra) html += `<div class="stat small muted"><span>в т.ч. «${h(e.name)}»</span><span class="num">${hrs(e.hours)} ч${e.total ? " · " + money(e.total) : ""}</span></div>`;
    if (x.total !== null) html += `<div class="total"><span>Итого к выплате</span><span class="big num">${money(x.total)}</span></div>`;
    html += `<div class="muted small" style="margin-top:6px">Из листа «${h(r.tab)}»</div>`;
  } else {
    html += `<div class="stat"><span>Отработано пока</span><b class="num">${hrs(r.hours)} ч</b></div>
      <div class="muted small">${h(r.source)}</div>`;
    if (r.rate_hint && r.rate_hint < 5000) html += `<div class="total"><span>По ставке ≈</span><span class="big num">${money(r.hours * r.rate_hint)}</span></div>
      <div class="muted small">${hrs(r.hours)} × ${money(r.rate_hint)}, без чаевых</div>`;
    else if (r.rate_hint) html += `<div class="stat"><span>Оклад</span><span class="num">${money(r.rate_hint)}</span></div>`;
    html += `<div class="muted small" style="margin-top:8px"><span class="tag warn">предварительно</span> Чаевые посчитаются, когда в таблице появится лист месяца.</div>`;
  }
  return html + "</div>";
}
function weekCard(w) {
  const me = w.me;
  const mon = dt(w.monday);
  const end = new Date(mon); end.setDate(end.getDate() + 6);
  let html = `<div class="card"><div class="row between"><h2 style="margin:0">Неделя ${mon.getDate()}.${String(mon.getMonth() + 1).padStart(2, "0")} – ${end.getDate()}.${String(end.getMonth() + 1).padStart(2, "0")}</h2>
    <div class="btns" style="gap:4px">${S.money.week === 0 ? '<button class="btn sm ghost" data-act="week" data-d="-1">‹ прошлая</button>' : '<button class="btn sm ghost" data-act="week" data-d="1">текущая ›</button>'}</div></div>`;
  if (me) html += `<div class="row between" style="margin:10px 0 4px"><div><div class="muted small">Тебе к выдаче</div><div class="big num">${h(me.pay || "—")}</div></div>
    <div class="right"><div class="muted small">Взял</div><div class="num" style="font-size:18px;font-weight:600">${h(me.took || "—")}</div></div></div>`;
  else html += `<div class="muted small" style="margin:8px 0">Не нашёл «${h(w.tips_name)}» на листе «${h(w.tab)}».</div>`;
  html += `<table class="t" style="margin-top:6px"><tr><th>День</th><th class="r">Мои часы</th><th class="r">Бар</th><th class="r">Зал</th></tr>`;
  const today = S.me.today;
  w.days.forEach((d, i) => {
    const mine = me ? me.hours[i] : "";
    const sent = me && me.sent ? me.sent[i] : "";
    const canDel = me && (mine || (sent && sent !== "нет")) && d.date <= today;
    html += `<tr class="${d.date === today ? "hl" : ""}"><td>${human(d.date).split(",")[0]} ${dt(d.date).getDate()}</td>
      <td class="r">${mine ? h(mine) : '<span class="muted">—</span>'}${sent && sent !== "нет" ? `<div class="muted small">${h(sent)}</div>` : ""}
      ${canDel ? `<div><a class="pf small" data-act="hoursDel" data-date="${d.date}">удалить</a></div>` : ""}</td>
      <td class="r">${h(d.bar || "—")}</td><td class="r">${h(d.hall || "—")}</td></tr>`;
  });
  html += `</table><div class="muted small" style="margin-top:6px">Лист «${h(w.tab)}»${w.netmonet ? ` · Нетмонет ${h(w.netmonet)}` : ""}</div>`;
  if (S.money.week === 0) html += `<button class="btn" data-act="hoursForm">＋ Записать часы</button>`;
  return html + "</div>";
}
ACT.moMonth = ds => { S.money.offset = Math.min(0, S.money.offset + Number(ds.d)); renderMoney(); };
ACT.week = ds => { S.money.week = Math.min(0, S.money.week + Number(ds.d)); renderMoney(); };
ACT.hoursForm = () => push(renderHoursForm);
ACT.hoursDel = async ds => {
  if (!(await confirmBox(`Удалить часы за ${human(ds.date)}?`))) return;
  try {
    const r = await api("hours_delete", { date: ds.date });
    toast(`Удалил${r.old ? ` (было ${r.old} ч)` : ""}`); renderMoney();
  } catch (e) { toast(e.message); }
};
function confirmBox(text) {
  return new Promise(res => { if (tg && tg.showConfirm) tg.showConfirm(text, ok => res(ok)); else res(confirm(text)); });
}
async function renderHoursForm() {
  setHead("Записать часы", S.me.tips_name);
  let roles = [];
  try { const w = await api("week"); roles = (w.me && w.me.roles) || []; } catch (e) {}
  const opts = [];
  for (let i = 0; i < 7; i++) {
    const d = dt(S.me.today); d.setDate(d.getDate() - i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    opts.push(`<option value="${iso}">${i === 0 ? "Сегодня, " : i === 1 ? "Вчера, " : ""}${human(iso)}</option>`);
  }
  let sched = "";
  try {
    const mine = (S.schedData && S.schedData.mine) || [];
    const s = mine.find(x => x.day === S.me.today && x.start);
    if (s) sched = `<button class="btn ghost" data-act="asSched" data-s="${s.start}" data-e="${s.end}">Как в графике: ${s.start}–${s.end}</button>`;
  } catch (e) {}
  view.innerHTML = `<div class="card">
    <label class="l">День</label><select class="f" id="hDay">${opts.join("")}</select>
    <div class="grid2"><div><label class="l">Пришёл</label><input class="f" id="hS" type="time" value="12:00"></div>
    <div><label class="l">Ушёл</label><input class="f" id="hE" type="time" value="00:00"></div></div>
    ${roles.length ? `<label class="l">Роль</label><select class="f" id="hR"><option value="">Основная</option>${roles.map(r => `<option>${h(r)}</option>`).join("")}</select>` : ""}
    <div class="muted small" style="margin-top:8px">Смена после полуночи считается за день, когда начиналась.</div>
    ${sched}<button class="btn" data-act="hoursSave">Записать</button></div>`;
}
ACT.asSched = ds => { $("#hS").value = ds.s; $("#hE").value = ds.e; };
ACT.hoursSave = async (ds, el) => {
  el.disabled = true;
  try {
    const r = await api("hours_save", { date: $("#hDay").value, start: $("#hS").value, end: $("#hE").value, role: $("#hR") ? $("#hR").value : "" });
    tg && tg.HapticFeedback.notificationOccurred("success");
    toast(`✅ ${hrs(r.hours)} ч → «${r.tab}»`);
    back();
  } catch (e) { toast(e.message); el.disabled = false; }
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
  let html = `<div class="card"><div class="row between"><h3>${r.pf ? "🧪 " : ""}${h(r.name)}</h3>${badge(r)}</div>
    <div class="muted small">${[r.yield ? `выход ${fmt(r.yield)} ${h(r.unit)}` : "", r.packets && !r.pf ? `${fmt(r.packets)} пак.` : "", r.portion && !r.pf ? `порция ${fmt(r.portion)} ${h(r.unit)}` : ""].filter(Boolean).join(" · ")}</div>`;
  if (r.allergens.length) html += `<div style="margin-top:8px">${r.allergens.map(a => `<span class="tag warn">${h(S.tk.allergen_titles[a])}</span>`).join(" ")}
    ${r.allergens_checked ? "" : '<span class="muted small">— подсказка, не проверено</span>'}</div>`;
  html += `</div><div class="card"><h2>Пересчитать</h2><div class="chips">
    ${[["batch", "Как в ТК"], ["ml", r.unit === "гр" ? "Граммы" : "Миллилитры"], ...(ps && !r.pf ? [["pack", "Пакеты"]] : []), ...(r.portion && !r.pf ? [["port", "Порции"]] : [])]
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
    replaceTop(() => renderRecipe(id, { mode: c.mode, n: v > 0 ? v : 1 }));
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
  try { d = await api("stock"); } catch (e) { return fail(e); }
  const items = S.stockAll ? d.items : d.items.filter(i => i.make > 0);
  const need = d.items.filter(i => i.make > 0).length;
  let html = `<div class="seg"><button data-act="stockMode" data-a="0" class="${S.stockAll ? "" : "on"}">Нужно сделать · ${need}</button>
    <button data-act="stockMode" data-a="1" class="${S.stockAll ? "on" : ""}">Весь сток</button></div>`;
  if (!items.length) { view.innerHTML = html + `<div class="card">${empty("✅", "Всё есть, ничего делать не нужно")}</div>`; return; }
  const groups = {};
  for (const i of items) (groups[i.section] = groups[i.section] || []).push(i);
  for (const [sec, list] of Object.entries(groups)) {
    html += `<div class="card"><h2>${h(sec)}</h2><div class="list">${list.map(i => `<div class="item"><div class="grow"><div class="t">${h(i.name)}</div>
      <div class="s">есть ${fmt(i.have ?? 0) || 0} из ${fmt(i.need ?? 0) || 0} ${h(i.unit)}</div></div>
      ${i.make > 0 ? `<div class="right"><b class="num">${fmt(i.make)}</b> <span class="muted small">${h(i.unit)}</span></div>` : '<span class="tag ok">есть</span>'}</div>`).join("")}</div></div>`;
  }
  view.innerHTML = html;
}
ACT.stockMode = ds => { S.stockAll = ds.a === "1"; renderStock(); };

// ================= ЕЩЁ =================
function renderMore() {
  setHead("Ещё");
  view.innerHTML = `<div class="card" style="padding:0"><div class="list" style="margin:0">
    <div class="item tap chev" data-act="open" data-s="allergens"><span style="font-size:22px">🥜</span><div class="grow"><div class="t">Аллергены</div><div class="s">Составы и фильтр «без…»</div></div></div>
    <div class="item tap chev" data-act="open" data-s="guest"><span style="font-size:22px">🎪</span><div class="grow"><div class="t">Гостевая смена</div><div class="s">Заказ, сообщение и таблица</div></div></div>
    <div class="item tap chev" data-act="profile"><span style="font-size:22px">🙋</span><div class="grow"><div class="t">Профиль</div><div class="s">${h(S.me.schedule_name || "кто я в графике и в таблице чаевых")}</div></div></div>
    ${S.me.is_owner ? `<div class="item tap chev" data-act="open" data-s="admin"><span style="font-size:22px">🔐</span><div class="grow"><div class="t">Админ</div><div class="s">Доступ, зарплаты, Нетмонет</div></div></div>` : ""}
  </div></div>
  <div class="muted small" style="text-align:center;margin-top:14px">Данные из Google Таблиц обновляются раз в 10 минут, график — тоже</div>`;
}
ACT.open = ds => push({ allergens: renderAllergens, guest: renderGuest, admin: renderAdmin }[ds.s]);
ACT.profile = () => push(renderProfile);

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

// ---------- профиль ----------
async function renderProfile() {
  setHead("Профиль");
  loading();
  let p;
  try { p = await api("people"); } catch (e) { return fail(e); }
  const secs = {};
  for (const x of p.schedule) (secs[x.section] = secs[x.section] || []).push(x.name);
  view.innerHTML = `<div class="card"><h2>Кто я в графике</h2>
    <select class="f" id="pS"><option value="">— не выбрано —</option>${Object.entries(secs).map(([s, ns]) => `<optgroup label="${h(s)}">${ns.map(n => `<option ${n === S.me.schedule_name ? "selected" : ""}>${h(n)}</option>`).join("")}</optgroup>`).join("")}</select>
    <div class="muted small" style="margin-top:6px">По этому имени — «Мои смены» и календарь.</div></div>
    <div class="card"><h2>Кто я в таблице чаевых</h2>
    <select class="f" id="pT"><option value="">— не выбрано —</option>${p.tips.map(n => `<option ${n === S.me.tips_name ? "selected" : ""}>${h(n)}</option>`).join("")}</select>
    <div class="muted small" style="margin-top:6px">По этому имени — часы, чаевые и зарплата. Видишь только свои.</div>
    ${p.tips.length ? "" : '<div class="small" style="color:var(--danger);margin-top:6px">Таблица чаевых сейчас недоступна</div>'}</div>
    <button class="btn" data-act="pSave">Сохранить</button>
    <div class="muted small" style="text-align:center;margin-top:12px">Telegram: ${h(S.me.tg_name)} · ID ${S.me.id}</div>`;
}
ACT.pSave = async (ds, el) => {
  el.disabled = true;
  const body = { schedule_name: $("#pS").value };
  if ($("#pT").value) body.tips_name = $("#pT").value;
  try {
    await api("profile", body);
    S.me = await api("me");
    toast("Сохранил"); back();
  } catch (e) { toast(e.message); el.disabled = false; }
};

// ---------- админ ----------
async function renderAdmin() {
  setHead("Админ");
  loading();
  let a;
  try { a = await api("admin_overview"); } catch (e) { return fail(e); }
  const pend = a.users.filter(u => u.status === "pending");
  const ok = a.users.filter(u => u.status === "approved");
  const rej = a.users.filter(u => u.status === "rejected");
  const row = u => `<div class="item"><div class="grow"><div class="t">${h(u.name || "Без имени")} ${u.username ? `<span class="muted small">@${h(u.username)}</span>` : ""}</div>
    <div class="s">${h([u.schedule_name, u.tips_name].filter(Boolean).join(" · ") || "имя в таблицах не выбрано")}</div></div>
    ${u.owner ? '<span class="tag">владелец</span>' : u.status === "approved" ? `<button class="btn sm danger" data-act="aUser" data-id="${u.id}" data-ok="0">Закрыть</button>`
      : `<div class="btns" style="gap:4px"><button class="btn sm" data-act="aUser" data-id="${u.id}" data-ok="1">Пустить</button>${u.status === "pending" ? `<button class="btn sm danger" data-act="aUser" data-id="${u.id}" data-ok="0">✕</button>` : ""}</div>`}</div>`;
  let html = "";
  if (pend.length) html += `<div class="card"><h2>Заявки · ${pend.length}</h2><div class="list">${pend.map(row).join("")}</div></div>`;
  html += `<div class="card"><h2>Есть доступ · ${ok.length}</h2><div class="list">${ok.map(row).join("") || '<div class="item muted">Пока никого</div>'}</div></div>`;
  if (rej.length) html += `<div class="card"><h2>Отклонены</h2><div class="list">${rej.map(row).join("")}</div></div>`;
  html += `<div class="card"><h2>Чаевые и зарплаты</h2>
    <div class="list"><div class="item tap chev" data-act="aOpen" data-s="tips"><div class="t">Неделя: к выдаче по всем</div></div>
    <div class="item tap chev" data-act="aOpen" data-s="salary"><div class="t">Зарплата всех за месяц</div></div></div>
    <label class="l">Нетмонет за эту неделю</label><div class="row"><input class="f num" id="aNm" type="number" inputmode="decimal" placeholder="9080"><button class="btn sm" data-act="aNm">Записать</button></div>
    <label class="l">Неделя с ${h(a.week.monday)} пишется в лист</label>
    <select class="f" id="aWeek">${a.week.tabs.map(t => `<option ${t === a.week.tab ? "selected" : ""}>${h(t)}</option>`).join("") || `<option>${h(a.week.tab)}</option>`}</select></div>`;
  html += `<div class="card"><h2>Данные</h2><button class="btn ghost" data-act="aRefresh">🔄 Перечитать таблицы сейчас</button>
    <button class="btn ghost" data-act="aAllergen">🧾 Дописать аллергены из ТК в таблицу</button>
    <div class="muted small" style="margin-top:8px">Лист «Аллергены» в таблице «Бар · приложение»: ${a.allergen_sheet ? "заполнен" : "пока пустой"}.<br>
    Бот на компьютере: ${a.bot_online ? "на связи" : "не на связи — «Чай» и напоминания ждут его"}</div></div>`;
  view.innerHTML = html;
  $("#aWeek").addEventListener("change", async e => { try { await api("admin_week", { tab: e.target.value }); toast("Лист недели изменён"); } catch (er) { toast(er.message); } });
}
ACT.aUser = async ds => {
  try { await api("admin_user", { id: Number(ds.id), ok: ds.ok === "1" }); toast(ds.ok === "1" ? "Доступ открыт" : "Доступ закрыт"); renderAdmin(); }
  catch (e) { toast(e.message); }
};
ACT.aNm = async (ds, el) => {
  const v = $("#aNm").value; if (!v) return;
  el.disabled = true;
  try { const r = await api("admin_netmonet", { amount: v }); toast(`Нетмонет ${r.amount} → «${r.tab}»`); $("#aNm").value = ""; } catch (e) { toast(e.message); }
  el.disabled = false;
};
ACT.aRefresh = async (ds, el) => { el.disabled = true; try { await api("admin_refresh"); S.tk = null; S.al = null; toast("Обновил"); } catch (e) { toast(e.message); } el.disabled = false; };
ACT.aAllergen = async (ds, el) => { el.disabled = true; try { const r = await api("admin_allergen_fill"); S.al = null; toast(r.added ? `Добавил позиций: ${r.added}` : "Новых позиций нет"); if (tg) tg.openLink(r.url); else window.open(r.url); } catch (e) { toast(e.message); } el.disabled = false; };
ACT.aOpen = ds => push(ds.s === "tips" ? renderAdminTips : () => renderAdminSalary(-1));
async function renderAdminTips() {
  setHead("К выдаче за неделю"); loading();
  try {
    const t = await api("admin_tips");
    view.innerHTML = `<div class="card"><h2>Лист «${h(t.tab)}»</h2><table class="t"><tr><th>Кто</th><th class="r">Взял</th><th class="r">К выдаче</th></tr>
      ${t.people.map(p => `<tr><td>${h(p.name)}</td><td class="r">${h(p.took || "—")}</td><td class="r"><b>${h(p.pay || "—")}</b></td></tr>`).join("")}</table></div>`;
  } catch (e) { fail(e); }
}
async function renderAdminSalary(off) {
  setHead("Зарплата всех"); loading();
  try {
    const s = await api("admin_salary", { offset: off });
    const sum = s.rows.reduce((a, r) => a + (r.total || 0), 0);
    view.innerHTML = `<div class="monthnav"><button data-act="aSal" data-o="${off - 1}">‹</button><b>${h(s.title)}</b><button data-act="aSal" data-o="${off + 1}" ${off >= 0 ? "disabled" : ""}>›</button></div>
      <div class="card">${s.tab ? `<table class="t"><tr><th>Кто</th><th class="r">Часы</th><th class="r">Итого</th></tr>
      ${s.rows.map(r => `<tr><td>${h(r.name)}</td><td class="r">${hrs(r.hours)}</td><td class="r"><b>${money(r.total)}</b></td></tr>`).join("")}
      <tr><td><b>Всего</b></td><td></td><td class="r"><b>${money(sum)}</b></td></tr></table>` : empty("🗓", "Листа за этот месяц нет")}</div>`;
  } catch (e) { fail(e); }
}
ACT.aSal = ds => replaceTop(() => renderAdminSalary(Number(ds.o)));

// ---------- старт ----------
(async function init() {
  try {
    S.me = await api("me");
  } catch (e) {
    $("#tabs").style.display = "none";
    setHead("Бар");
    view.innerHTML = e.status === 403 ? empty("🔒", "Доступ ещё не одобрен.<br>Напиши боту /start — владелец получит заявку.")
      : empty("📱", h(e.message) + (tg && tg.initData ? "" : "<br><br>Открой приложение кнопкой в боте."));
    return;
  }
  const start = (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) || "schedule";
  go(["schedule", "money", "tk", "stock", "more"].includes(start) ? start : "schedule");
})();
