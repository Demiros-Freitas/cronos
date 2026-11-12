// Cronos · irmão do Atlas. Calendário do mundo, controle do tempo (como um player) e eventos do ano.
// O tempo é sempre o relógio do Foundry (game.time.worldTime); o Cronos só dá nome aos dias e o faz andar.
import { togglePop } from "./popout.js";
import { registerRoundSettings, hookRoundPhases } from "./rounds.js";
const ID = "brumas-cronos";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const uid = () => Math.random().toString(36).slice(2, 10);
const isActiveGM = () => game.user.isGM && (game.users.activeGM?.id ?? game.user.id) === game.user.id;

/* ================= calendários prontos ================= */
const AETHER_MONTHS = ["Lumia", "Solária", "Estelar", "Lunaris", "Crepusca", "Auroria", "Noturna", "Brisária", "Alba", "Raiora", "Fulgura", "Umbra"];
export const PRESETS = {
  aether: { name: "Calendário Imperial de Aether", yearZero: 1, era: "", hoursPerDay: 24, minutesPerHour: 60, secondsPerMinute: 60, weekResets: true,
    months: [...AETHER_MONTHS.map(n => ({ name: n, days: 30 })), { name: "Interlúnis", days: 5, intercalary: true }],
    weekdays: ["Albor", "Duran", "Triven", "Quadra", "Quorra", "Seryn", "Velin"],
    seasons: [{ name: "Primavera", month: 0, day: 1 }, { name: "Verão", month: 3, day: 15 }, { name: "Outono", month: 6, day: 1 }, { name: "Inverno", month: 9, day: 15 }], equinox: { month: 0, day: 1 } },
  gregoriano: { name: "Gregoriano", yearZero: 1, era: "", hoursPerDay: 24, minutesPerHour: 60, secondsPerMinute: 60, weekResets: false,
    months: [["Janeiro", 31], ["Fevereiro", 28], ["Março", 31], ["Abril", 30], ["Maio", 31], ["Junho", 30], ["Julho", 31], ["Agosto", 31], ["Setembro", 30], ["Outubro", 31], ["Novembro", 30], ["Dezembro", 31]].map(([name, days]) => ({ name, days })),
    weekdays: ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"],
    seasons: [{ name: "Primavera", month: 2, day: 20 }, { name: "Verão", month: 5, day: 21 }, { name: "Outono", month: 8, day: 22 }, { name: "Inverno", month: 11, day: 21 }], equinox: { month: 2, day: 20 } },
  harptos: { name: "Harptos (Reinos Esquecidos)", yearZero: 1490, era: "DR", hoursPerDay: 24, minutesPerHour: 60, secondsPerMinute: 60, weekResets: true,
    months: [["Hammer", 30], ["Midwinter", 1, 1], ["Alturiak", 30], ["Ches", 30], ["Tarsakh", 30], ["Greengrass", 1, 1], ["Mirtul", 30], ["Kythorn", 30], ["Flamerule", 30], ["Midsummer", 1, 1], ["Eleasis", 30], ["Eleint", 30], ["Highharvestide", 1, 1], ["Marpenoth", 30], ["Uktar", 30], ["Feast of the Moon", 1, 1], ["Nightal", 30]].map(([name, days, ic]) => ({ name, days, intercalary: !!ic })),
    weekdays: ["Primeiro", "Segundo", "Terceiro", "Quarto", "Quinto", "Sexto", "Sétimo", "Oitavo", "Nono", "Décimo"],
    seasons: [{ name: "Primavera", month: 3, day: 19 }, { name: "Verão", month: 7, day: 20 }, { name: "Outono", month: 11, day: 21 }, { name: "Inverno", month: 16, day: 20 }], equinox: { month: 3, day: 19 } }
};
export function normCal(c = {}) {
  const base = PRESETS.aether; const months = Array.isArray(c.months) && c.months.length ? c.months : base.months;
  return { name: c.name || base.name, yearZero: Math.round(num(c.yearZero, base.yearZero)), era: c.era ?? "", hoursPerDay: Math.max(1, Math.round(num(c.hoursPerDay, 24))), minutesPerHour: Math.max(1, Math.round(num(c.minutesPerHour, 60))), secondsPerMinute: Math.max(1, Math.round(num(c.secondsPerMinute, 60))),
    weekResets: c.weekResets ?? base.weekResets, months: months.map(m => ({ name: m.name || "Mês", days: Math.max(1, Math.round(num(m.days, 30))), intercalary: !!m.intercalary })),
    weekdays: Array.isArray(c.weekdays) && c.weekdays.length ? c.weekdays : base.weekdays, seasons: Array.isArray(c.seasons) ? c.seasons : base.seasons, equinox: c.equinox ?? base.equinox };
}
const cal = () => normCal(game.settings.get(ID, "calendar") ?? {});

/* ================= matemática das datas ================= */
const secDayOf = (c) => c.hoursPerDay * c.minutesPerHour * c.secondsPerMinute;
const dpyOf = (c) => c.months.reduce((s, m) => s + m.days, 0);
const doyOf = (c, month, day) => c.months.slice(0, month).reduce((s, m) => s + m.days, 0) + (day - 1);
/** Data de um instante t (segundos). month: índice; day: 1…; weekday: índice ou null em dias intercalares. */
export function toDate(t, c = cal()) {
  const sd = secDayOf(c), dpy = dpyOf(c); const days = Math.floor(t / sd); const rest = t - days * sd;
  const yi = Math.floor(days / dpy); const doy = days - yi * dpy; let acc = 0, month = 0;
  for (let i = 0; i < c.months.length; i++) { if (doy < acc + c.months[i].days) { month = i; break; } acc += c.months[i].days; }
  const day = doy - acc + 1; const M = c.months[month];
  // dia da semana: dias intercalares ficam fora da semana
  const reg = (d0) => c.months.slice(0, month).reduce((s, m) => s + (m.intercalary ? 0 : m.days), 0) + d0;
  const nW = c.weekdays.length; let weekday = null;
  if (!M.intercalary) { const inYear = reg(day - 1); const regPerYear = c.months.reduce((s, m) => s + (m.intercalary ? 0 : m.days), 0); const total = c.weekResets ? inYear : yi * regPerYear + inYear; weekday = ((total % nW) + nW) % nW; }
  const h = Math.floor(rest / (c.minutesPerHour * c.secondsPerMinute)); const mi = Math.floor((rest % (c.minutesPerHour * c.secondsPerMinute)) / c.secondsPerMinute); const s = Math.floor(rest % c.secondsPerMinute);
  return { year: c.yearZero + yi, yi, month, day, doy, weekday, hour: h, minute: mi, second: s, days, intercalary: M.intercalary, monthName: M.name, weekdayName: weekday == null ? "" : c.weekdays[weekday] };
}
/** Instante do começo de um dia (ano, mês, dia), mais a hora do dia (segundos). */
export function toTime(year, month, day, sec = 0, c = cal()) { return ((year - c.yearZero) * dpyOf(c) + doyOf(c, month, day)) * secDayOf(c) + sec; }
/** Nomes das 4 estações do calendário em ordem a partir do equinócio da primavera (primavera, verão, outono, inverno). */
function seasonNames(c) { const list = [...(c.seasons ?? [])].map(s => ({ ...s, d: doyOf(c, s.month, s.day) })).sort((a, b) => a.d - b.d); if (list.length !== 4) return ["Primavera", "Verão", "Outono", "Inverno"];
  const eq = c.equinox ? doyOf(c, c.equinox.month, c.equinox.day) : list[0].d; const dpy = dpyOf(c); let k = 0, best = Infinity; list.forEach((s, i) => { const dd = Math.min(((s.d - eq) % dpy + dpy) % dpy, ((eq - s.d) % dpy + dpy) % dpy); if (dd < best) { best = dd; k = i; } });
  return [0, 1, 2, 3].map(i => list[(k + i) % 4].name); }
/** Estação no lugar de onde o relógio é visto (com o Atlas e um mapa-múndi em globo: pela inclinação do planeta e pela latitude);
 *  sem isso, a estação do calendário. Devolve { name, tip }. */
export function seasonHere(t, c = cal()) {
  const at = game.modules.get("brumas-atlas"); let S = null; try { S = at?.active ? at.api?.seasonAt?.(t) : null; } catch (e) { /* */ }
  if (!S) return { name: seasonOf(toDate(t, c), c), tip: "Estação do calendário" };
  const N = seasonNames(c); const lat = Number.isFinite(S.lat) ? `${Math.abs(S.lat).toFixed(0)}° ${S.lat >= 0 ? "N" : "S"}` : "";
  if (S.idx == null) return { name: S.extra || "Sem estações", tip: "O eixo do planeta não é inclinado: o ano todo é igual" };
  const base = N[S.idx];
  if (S.zone === "tropical") return { name: S.extra === "chuvas" ? "Estação das chuvas" : "Estação seca", tip: `${lat} · nos trópicos o ano se divide entre chuvas (sol a pino) e seca · no calendário: ${base}` };
  return { name: S.extra ? `${base} · ${S.extra}` : base, tip: `${lat}${S.zone === "polar" ? " · além do círculo polar" : ""}${S.lat < 0 ? " · hemisfério sul: estações trocadas" : ""}` };
}
export function seasonOf(D, c = cal()) { const list = [...(c.seasons ?? [])].map(s => ({ ...s, d: doyOf(c, s.month, s.day) })).sort((a, b) => a.d - b.d); if (!list.length) return ""; let cur = list[list.length - 1]; for (const s of list) if (D.doy >= s.d) cur = s; return cur.name; }
const pad = (n) => String(n).padStart(2, "0");
export function fmtDate(t, c = cal(), long = true) { const D = toDate(t, c); const y = `${D.year}${c.era ? ` ${c.era}` : ""}`; return D.intercalary ? `${D.day}º dia de ${D.monthName}, ${y}` : `${D.day} de ${D.monthName} de ${y}${long && D.weekdayName ? ` · ${D.weekdayName}` : ""}`; }
export const fmtTime = (t, c = cal(), sec = false) => { const D = toDate(t, c); return `${pad(D.hour)}:${pad(D.minute)}${sec ? `:${pad(D.second)}` : ""}`; };

/* ================= configurações ================= */
function register() {
  game.settings.register(ID, "calendar", { scope: "world", config: false, type: Object, default: PRESETS.aether, onChange: () => { syncFoundry(); refreshAll(); } });
  game.settings.register(ID, "events", { scope: "world", config: false, type: Object, default: [], onChange: () => refreshAll() });
  game.settings.register(ID, "run", { scope: "world", config: false, type: Object, default: { on: false, rate: 60 }, onChange: (v) => { refreshAll(); Hooks.callAll("cronosRun", v); } });
  game.settings.register(ID, "playersSee", { name: "Jogadores veem o relógio", hint: "Mostra a data e a hora (sem os controles) para os jogadores.", scope: "world", config: true, type: Boolean, default: true, onChange: () => refreshAll() });
  // imersão: o que os jogadores enxergam do tempo
  game.settings.register(ID, "playerTime", { name: "Hora para os jogadores", hint: "Com \"parte do dia\", os jogadores não veem a hora exata: veem Madrugada, Amanhecer, Manhã, Meio-dia, Tarde, Crepúsculo, Noite… (pelo sol do lugar, com o Atlas). O mestre sempre vê a hora.", scope: "world", config: true, type: String, choices: { exata: "Hora exata", periodo: "Só a parte do dia" }, default: "exata", onChange: () => renderClock(true) });
  game.settings.register(ID, "playerTemp", { name: "Temperatura para os jogadores", hint: "Com \"sensação\", em vez dos graus aparece Frio, Frio e úmido, Quente e abafado…", scope: "world", config: true, type: String, choices: { exata: "Em graus", sensacao: "Pela sensação" }, default: "exata", onChange: () => refreshAll() });
  game.settings.register(ID, "sunCheck", { name: "Ler a hora pelo sol pede um teste", hint: "Com a hora escondida, o jogador que clicar no sol (no Céu de hoje) faz um teste. Passando, vê a hora exata por alguns segundos. Uma tentativa por hora de jogo.", scope: "world", config: true, type: Boolean, default: true });
  game.settings.register(ID, "sunSkill", { name: "Perícia do teste do sol", scope: "world", config: true, type: String, choices: { sur: "Sobrevivência", nat: "Natureza", prc: "Percepção", ins: "Intuição", inv: "Investigação", arc: "Arcanismo" }, default: "sur" });
  game.settings.register(ID, "sunDC", { name: "CD do teste do sol", scope: "world", config: true, type: Number, range: { min: 5, max: 30, step: 1 }, default: 12 });
  game.settings.register(ID, "sunSecs", { name: "Segundos com a hora à vista (teste do sol)", scope: "world", config: true, type: Number, range: { min: 3, max: 60, step: 1 }, default: 15 });
  game.settings.register(ID, "pauseWithGame", { name: "Pausar o tempo com o jogo", hint: "Com o jogo pausado, o relógio em andamento para.", scope: "world", config: true, type: Boolean, default: true });
  game.settings.register(ID, "pos", { scope: "client", config: false, type: Object, default: {} });
  game.settings.register(ID, "hidden", { scope: "client", config: false, type: Boolean, default: false, onChange: () => { showClockAgain(); try { ui.controls?.render?.(); } catch (e) { /* */ } } });
  game.settings.register(ID, "hideInCombat", { name: "Esconder o relógio em combate", hint: "Durante um combate em andamento na cena, o relógio some e volta sozinho quando o combate acaba.", scope: "client", config: true, type: Boolean, default: true, onChange: () => showClockAgain() });
  game.settings.register(ID, "calView", { scope: "client", config: false, type: String, default: "grade" });
  game.settings.register(ID, "dock", { name: "Posição do relógio", hint: "O relógio fica no meio da tela, em cima ou embaixo, e se ajusta à largura.", scope: "client", config: true, type: String, choices: { top: "Em cima, no centro", bottom: "Embaixo, no centro" }, default: "top", onChange: () => renderClock(true) });
}
/** Passa o calendário para o Foundry também (outros módulos e a ficha usam o calendário do mundo). */
let synced = false;
/** Índice da estação (na ordem do ano) de uma data, ou null. */
function seasonIdx(D, c = cal()) { const list = [...(c.seasons ?? [])].map(s => doyOf(c, s.month, s.day)).sort((a, b) => a - b); if (!list.length) return null; let k = list.length - 1; list.forEach((d, i) => { if (D.doy >= d) k = i; }); return k; }
/** O calendário do Foundry (e o do D&D, que herda dele) passa a contar os dias pela matemática do Cronos:
 *  dias intercalares fora da semana, semana que recomeça no ano, estações… Assim tudo que mostra data no Foundry bate com o relógio. */
function cronosCalendarClass() {
  const Base = CONFIG.time.worldCalendarClass; if (!Base || Base.__cronos) return Base;
  class CronosCalendar extends Base {
    timeToComponents(time = 0) {
      try { const c = cal(); const D = toDate(time, c);
        return { day: D.doy, dayOfMonth: D.day - 1, dayOfWeek: D.weekday ?? 0, hour: D.hour, leapYear: false, minute: D.minute, month: D.month, season: seasonIdx(D, c) ?? undefined, second: D.second, year: D.yi, intercalary: !!D.intercalary };
      } catch (e) { return super.timeToComponents(time); }
    }
  }
  CronosCalendar.__cronos = true; CronosCalendar.__base = Base; return CronosCalendar;
}
function syncFoundry() {
  if (!synced && !game.ready) return; // só depois que o Foundry montou o próprio calendário (nunca atrapalha o carregamento)
  const prev = CONFIG.time?.worldCalendarConfig, prevClass = CONFIG.time?.worldCalendarClass;
  try {
    const c = cal(); if (!CONFIG.time) return; const dpy = dpyOf(c);
    const ss = [...(c.seasons ?? [])].map(s => ({ name: s.name, d: doyOf(c, s.month, s.day), m: s.month })).sort((a, b) => a.d - b.d);
    const seasons = ss.map((s, i) => { const nx = ss[(i + 1) % ss.length]; const end = ((nx.d - 1 + dpy) % dpy); return { name: s.name, abbreviation: s.name.slice(0, 3), monthStart: s.m + 1, monthEnd: null, dayStart: s.d + 1, dayEnd: end + 1 }; })
      .map(s => ({ ...s, monthEnd: s.monthStart }));
    CONFIG.time.worldCalendarConfig = { name: c.name, description: "Calendário do Cronos", years: { yearZero: c.yearZero, firstWeekday: 0, leapYear: null },
      months: { values: c.months.map((m, i) => ({ name: m.name, abbreviation: m.name.slice(0, 3), ordinal: i + 1, days: m.days, leapDays: m.days, intercalary: m.intercalary })) },
      days: { values: c.weekdays.map((n, i) => ({ name: n, abbreviation: n.slice(0, 3), ordinal: i + 1 })), daysPerYear: dpy, hoursPerDay: c.hoursPerDay, minutesPerHour: c.minutesPerHour, secondsPerMinute: c.secondsPerMinute },
      seasons: { values: seasons } };
    const K = cronosCalendarClass(); if (K) CONFIG.time.worldCalendarClass = K;
    game.time?.initializeCalendar?.(); synced = true;
    try { ui.calendar?.render?.(); globalThis.dnd5e?.ui?.calendar?.render?.(); } catch (e) { /* */ }
  } catch (e) { console.warn(`${ID} | não deu para passar o calendário ao Foundry (o Cronos continua funcionando)`, e); try { CONFIG.time.worldCalendarConfig = prev; CONFIG.time.worldCalendarClass = prevClass; game.time?.initializeCalendar?.(); } catch (er) { /* */ } }
}
/** Calendários que vêm com o Foundry e com o D&D (gregoriano, Greyhawk, Harptos, Khorvaire…), para começar o do Cronos a partir deles. */
export function foundryPresets() {
  const out = []; const L = (s) => { try { return game.i18n.localize(String(s ?? "")); } catch (e) { return String(s ?? ""); } };
  for (const k of game.system?.id === "dnd5e" ? (CONFIG.DND5E?.calendar?.calendars ?? []) : []) if (k?.config?.months) out.push({ label: L(k.label), cfg: k.config });
  const greg = foundry.data?.SIMPLIFIED_GREGORIAN_CALENDAR_CONFIG; if (greg && !out.some(o => o.cfg === greg)) out.push({ label: "Gregoriano (Foundry)", cfg: greg });
  return out.map(o => ({ ...o, L }));
}
export function fromFoundry({ label, cfg, L }) {
  const months = (cfg.months?.values ?? []).map(m => ({ name: L(m.name), days: Math.max(1, Number(m.days) || 1), intercalary: !!m.intercalary }));
  const at = (doy0) => { let acc = 0; for (let i = 0; i < months.length; i++) { if (doy0 < acc + months[i].days) return { month: i, day: doy0 - acc + 1 }; acc += months[i].days; } return { month: 0, day: 1 }; };
  const seasons = (cfg.seasons?.values ?? []).map(s => ({ name: L(s.name), ...(Number.isFinite(s.dayStart) ? at(s.dayStart - 1) : { month: Math.max(0, (s.monthStart ?? 1) - 1), day: 1 }) }));
  const d = cfg.days ?? {}; const spring = seasons.find(s => /spring|primavera/i.test(s.name)) ?? seasons[0];
  return normCal({ name: L(cfg.name) || label, yearZero: cfg.years?.yearZero ?? 0, era: "", hoursPerDay: d.hoursPerDay ?? 24, minutesPerHour: d.minutesPerHour ?? 60, secondsPerMinute: d.secondsPerMinute ?? 60,
    months, weekdays: (d.values ?? []).map(w => L(w.name)), weekResets: false, seasons, equinox: spring ? { month: spring.month, day: spring.day } : undefined });
}

/* ================= eventos (notas do calendário) ================= */
const events = () => { const e = game.settings.get(ID, "events"); return Array.isArray(e) ? e : []; };
/** Eventos de um dia: os do ano todo (year vazio) e os daquele ano. */
export function eventsOn(year, month, day) { const gm = game.user.isGM; return events().filter(e => e.month === month && e.day === day && (e.year == null || e.year === year) && (gm || e.players)); }
/** Lê os eventos do diário "Calendário" (linhas como "15 de Lunaris — Solstício de Verão [Astronômico] texto…"). */
async function importFromJournal() {
  const c = cal(); const names = c.months.map(m => m.name); const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const found = []; const seen = new Set(events().map(e => `${e.month}|${e.day}|${norm(e.title)}`));
  for (const j of game.journal) for (const p of j.pages) { if (p.type !== "text") continue; const txt = (p.text?.content ?? "").replace(/<\/(p|li|h\d|tr|div)>/g, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
    const re = /(\d{1,2})\s*(?:º)?\s*de\s+([A-Za-zÀ-ÿ]+)\s*[—–-]\s*([^\[\n]+?)\s*\[([^\]]+)\]\s*([^\n]*)/g; let m;
    while ((m = re.exec(txt))) { const mi = names.findIndex(n => norm(n) === norm(m[2])); if (mi < 0) continue; const day = Number(m[1]); if (day < 1 || day > c.months[mi].days) continue;
      const key = `${mi}|${day}|${norm(m[3].trim())}`; if (seen.has(key)) continue; seen.add(key); found.push({ id: uid(), year: null, month: mi, day, title: m[3].trim(), tag: m[4].trim(), text: m[5].trim().slice(0, 400), players: true }); } }
  if (!found.length) { ui.notifications.info("Cronos · nenhum evento novo encontrado nos diários."); return; }
  await game.settings.set(ID, "events", [...events(), ...found]); ui.notifications.info(`Cronos · ${found.length} evento(s) importado(s) dos diários.`);
}

/* ================= o relógio andando (só o mestre ativo) ================= */
let tick = null;
function startTicker() {
  clearInterval(tick); tick = setInterval(async () => {
    if (!isActiveGM()) return; const r = game.settings.get(ID, "run"); if (!r?.on) return; if (game.paused && game.settings.get(ID, "pauseWithGame")) return;
    try { await game.time.advance(Math.max(1, num(r.rate, 60))); } catch (e) { /* */ }
  }, 1000);
}
const RATES = [[1, "1×"], [10, "10×"], [60, "1 min/s"], [600, "10 min/s"], [3600, "1 h/s"]];

/* ================= interface: o relógio (player) ================= */
let clockEl = null, calEl = null, cfgEl = null; const view = { y: null, m: null, sel: null };
const api0 = () => { const at = game.modules.get("brumas-atlas"); return at?.active ? at.api : null; };
/* ---------- imersão: partes do dia e sensação térmica ---------- */
let revealUntil = 0;
/** A hora exata está escondida para este usuário agora? */
export function timeHidden() { return !game.user.isGM && game.settings.get(ID, "playerTime") === "periodo" && Date.now() > revealUntil; }
/** Parte do dia: pelo sol do lugar (com o Atlas), senão pelo relógio. */
export function periodOf(t = now()) {
  let sn = null; try { sn = api0()?.sunAt?.(t) ?? null; } catch (e) { /* */ }
  if (sn) { const { alt, H, maxAlt } = sn; const morning = H < 0;
    if (alt < -12) return Math.abs(H) > 165 ? "Meia-noite" : morning ? "Madrugada" : "Noite";
    if (alt < -0.8) return morning ? "Alvorada" : "Crepúsculo";
    if (alt < Math.min(10, Math.max(3, maxAlt * 0.3))) return morning ? "Amanhecer" : "Entardecer";
    if (Math.abs(H) < 12) return "Meio-dia";
    return morning ? "Manhã" : "Tarde"; }
  const c = cal(); const D = toDate(t, c); const h = (D.hour + D.minute / c.minutesPerHour) * 24 / c.hoursPerDay;
  for (const [lim, n] of [[0.5, "Meia-noite"], [4.5, "Madrugada"], [5.5, "Alvorada"], [7, "Amanhecer"], [11.5, "Manhã"], [12.5, "Meio-dia"], [17, "Tarde"], [18.5, "Entardecer"], [19.5, "Crepúsculo"], [23.5, "Noite"]]) if (h < lim) return n;
  return "Meia-noite";
}
/** A hora como este usuário pode vê-la. */
export function publicTime(t = now()) { return timeHidden() ? periodOf(t) : fmtTime(t); }
/** Sensação térmica em palavras. */
export function feelOf(temp, climate, force = 0) {
  const T = Number(temp); if (!Number.isFinite(T)) return "";
  const base = T <= -10 ? "Gélido" : T <= 0 ? "Congelante" : T <= 7 ? "Muito frio" : T <= 13 ? "Frio" : T <= 18 ? "Fresco" : T <= 24 ? "Ameno" : T <= 29 ? "Quente" : T <= 35 ? "Muito quente" : "Escaldante";
  let extra = "";
  if (["chuva", "tempestade", "neblina"].includes(climate)) extra = T >= 25 ? "abafado" : "úmido";
  else if (climate === "calor" || (T >= 27 && climate === "limpo")) extra = "seco";
  if (!extra && Number(force) >= 5 && T < 20) extra = "ventoso";
  return extra ? `${base} e ${extra}` : base;
}
const tempText = (wx) => { if (!Number.isFinite(wx?.temp)) return ""; return !game.user.isGM && game.settings.get(ID, "playerTemp") === "sensacao" ? feelOf(wx.temp, wx.climate, wx.wind) : `${Math.round(wx.temp)}°`; };
/** Ler a hora pelo sol (clique no sol do Céu de hoje): teste de perícia; passando, a hora exata aparece por alguns segundos. */
export async function sunCheck() {
  const n = (m, k = "info") => globalThis.ui?.notifications?.[k]?.(m);
  if (game.user.isGM) { n(`Pelo sol: ${fmtTime(now())} (${periodOf()}).`); return; }
  if (!timeHidden()) return;
  let sn = null; try { sn = api0()?.sunAt?.() ?? null; } catch (e) { /* */ }
  if (sn && sn.alt < 0) { n("O sol não está no céu agora."); return; }
  if (!game.settings.get(ID, "sunCheck")) { n(`Pelo sol, deve ser ${periodOf().toLowerCase()}.`); return; }
  const last = Number(game.user.getFlag(ID, "sunTry")); if (Number.isFinite(last) && Math.abs(game.time.worldTime - last) < 3600) { n("Você já tentou ler o sol há pouco. Espere ele andar um pouco no céu."); return; }
  const actor = game.user.character ?? game.actors?.find(a => a.isOwner && a.type === "character"); if (!actor) { n("Escolha o seu personagem (Configurar Jogador) para tentar ler o sol.", "warn"); return; }
  const skill = game.settings.get(ID, "sunSkill") || "sur", dc = Number(game.settings.get(ID, "sunDC")) || 12, secs = Number(game.settings.get(ID, "sunSecs")) || 15;
  let total = null;
  try { const r = await actor.rollSkill({ skill, target: dc }); const roll = Array.isArray(r) ? r[0] : r; total = roll?.total ?? null; }
  catch (e) { try { const r = await actor.rollSkill(skill, { targetValue: dc }); total = r?.total ?? null; } catch (e2) { console.warn("brumas-cronos | teste do sol", e2); } }
  if (total == null) return; // cancelado
  await game.user.setFlag(ID, "sunTry", game.time.worldTime);
  if (total >= dc) { revealUntil = Date.now() + secs * 1000; n(`Pela altura do sol, ${actor.name} calcula: ${fmtTime(now())}.`); updateClock(true); setTimeout(() => updateClock(true), secs * 1000 + 60); }
  else n(`${actor.name} olha para o sol, mas não consegue precisar a hora. Parece ${periodOf().toLowerCase()}.`);
}
function moonsOn(t) { const at = game.modules.get("brumas-atlas"); return at?.active && at.api?.moonsAt ? (() => { try { return at.api.moonsAt(t); } catch (e) { return []; } })() : []; }
const moonSvg = (mo, r = 7) => { const k = mo.phase * 2 - 1, rx = Math.abs(k) * r, dir = mo.waxing ? 1 : -1; return `<svg width="${r * 2 + 2}" height="${r * 2 + 2}" viewBox="${-r - 1} ${-r - 1} ${r * 2 + 2} ${r * 2 + 2}"><circle r="${r}" fill="#1b2030" stroke="#3a4160"/><path d="M0 ${-r} A${r} ${r} 0 0 ${dir > 0 ? 1 : 0} 0 ${r} A${rx} ${r} 0 0 ${(k > 0) === (dir > 0) ? 1 : 0} 0 ${-r}Z" fill="${esc(mo.color || "#e8e4d8")}"/></svg>`; };
/* ---------- tempo suave: entre um passo e outro do relógio, o tempo "corre" na tela ---------- */
let lastWT = null, lastAt = 0;
const running = () => { const r = game.settings.get(ID, "run") ?? {}; return !!r.on && !(game.paused && game.settings.get(ID, "pauseWithGame")); };
/** Instante de agora para desenhar (segundos de jogo, com fração). */
export function now() {
  const wt = Number(game.time?.worldTime) || 0; if (lastWT == null || !running()) return wt;
  const rate = num((game.settings.get(ID, "run") ?? {}).rate, 60); const el = (performance.now() - lastAt) / 1000;
  return lastWT + Math.min(rate * 1.02, Math.max(0, el) * rate);
}
function markTime() { lastWT = Number(game.time?.worldTime) || 0; lastAt = performance.now(); }

/* ---------- o relógio: montado uma vez, depois só os textos e o céu mudam (menus abertos não fecham) ---------- */
let clockKey = "";
/** O relógio está escondido? (pelo botão, ou por estar em combate) */
function clockHidden() {
  if (game.settings.get(ID, "hidden")) return true;
  try { if (game.settings.get(ID, "hideInCombat")) { const cb = game.combats?.active ?? game.combat; if (cb?.started && (!cb.scene || cb.scene.id === canvas?.scene?.id)) return true; } } catch (e) { /* */ }
  return false;
}
/** Ao reaparecer, o relógio é medido e redesenhado (escondido, a faixa do céu tem largura zero e fica vazia). */
function showClockAgain() {
  const was = clockEl?.classList.contains("cr-hidden"); renderClock();
  if (clockEl && !clockEl.classList.contains("cr-hidden") && was !== false) requestAnimationFrame(() => { fitKey = ""; fitClock(); requestAnimationFrame(() => updateClock(true)); });
}
for (const h of ["combatStart", "updateCombat", "deleteCombat", "createCombat", "canvasReady"]) Hooks.on(h, () => setTimeout(showClockAgain, 50));
function renderClock(force = false) {
  if (!game.user.isGM && !game.settings.get(ID, "playersSee")) { clockEl?.remove(); clockEl = null; clockKey = ""; return; }
  const r = game.settings.get(ID, "run") ?? {}; const gm = game.user.isGM; const key = JSON.stringify([gm, !!r.on, num(r.rate, 60), game.paused]);
  if (!clockEl) { clockEl = document.createElement("div"); clockEl.id = "cronos-clock"; if (game.user.isGM) clockEl.classList.add("gm"); document.body.appendChild(clockEl); bindClock(); force = true; }
  clockEl.classList.toggle("cr-hidden", clockHidden());
  clockEl.classList.toggle("bottom", game.settings.get(ID, "dock") === "bottom"); fitClock();
  if (force || key !== clockKey) {
    clockKey = key; const c = cal();
    clockEl.innerHTML = `<div class="cr-dial" data-cr="sky" title="Céu de agora · clique: abrir o céu · botão direito: janela da carta estelar"><div class="cr-dsky"></div><div class="cr-dring"></div><div class="cr-dhand"></div></div>
      <div class="cr-mid"><div class="cr-date"></div><div class="cr-sub"><span class="cr-season" data-cr="here"></span><span class="cr-wx"></span><span class="cr-moons"></span></div>
        <div class="cr-timeRow"><b class="cr-clock"></b>${r.on ? `<span class="cr-live ${game.paused && game.settings.get(ID, "pauseWithGame") ? "paused" : ""}">${game.paused && game.settings.get(ID, "pauseWithGame") ? "pausado" : `▶ ${esc(RATES.find(x => x[0] === num(r.rate, 60))?.[1] ?? "")}`}</span>` : ""}</div></div>
      <div class="cr-bar" data-cr="sky" title="O dia de hoje: sol, luas e nuvens"></div>
      ${gm ? `<div class="cr-ctrl">
        <div class="cr-row"><button data-cr="adv" data-v="-${secDayOf(c)}" title="Voltar 1 dia">⏮</button><button data-cr="adv" data-v="-3600" title="Voltar 1 hora">−1h</button><button data-cr="adv" data-v="-600" title="Voltar 10 minutos">−10m</button>
        <button class="cr-play ${r.on ? "on" : ""}" data-cr="play" title="${r.on ? "Pausar o tempo" : "Fazer o tempo andar"}">${r.on ? "⏸" : "▶"}</button>
        <button data-cr="adv" data-v="600" title="Avançar 10 minutos">+10m</button><button data-cr="adv" data-v="3600" title="Avançar 1 hora">+1h</button><button data-cr="adv" data-v="${secDayOf(c)}" title="Avançar 1 dia">⏭</button></div>
        <div class="cr-row"><select data-cr="rate" title="Velocidade do tempo andando">${RATES.map(([v, l]) => `<option value="${v}" ${num(r.rate, 60) === v ? "selected" : ""}>${l}</option>`).join("")}</select>
        <button data-cr="dawn" title="Pular para o próximo amanhecer (6h)">☀</button><button data-cr="dusk" title="Pular para o próximo anoitecer (18h)">☾</button><button data-cr="cal" title="Calendário">📅</button><button data-cr="cfg" title="Configurar o calendário">⚙</button></div></div>` : `<div class="cr-ctrl"><button data-cr="cal" title="Calendário">📅</button></div>`}`;
    dialAt = 0;
  }
  updateClock(true);
}
let dialAt = 0, lastText = "";
/** Atualiza só o que muda: data, hora, estação, clima, luas e o céu do mostrador. */
function updateClock(full = false) {
  if (!clockEl) return; const c = cal(); const t = now(); const gm = game.user.isGM; const D = toDate(t, c);
  const q = (s) => clockEl.querySelector(s);
  const date = fmtDate(t, c); if (q(".cr-date").textContent !== date) q(".cr-date").textContent = date;
  const hid = timeHidden(); const ck = q(".cr-clock"); const ct = hid ? periodOf(t) : fmtTime(t, c, true); if (ck.textContent !== ct) ck.textContent = ct;
  ck.classList.toggle("period", hid); ck.classList.toggle("revealed", !gm && !hid && game.settings.get(ID, "playerTime") === "periodo");
  q(".cr-dhand").style.display = hid ? "none" : "";
  const dayP = (D.hour * c.minutesPerHour + D.minute + D.second / c.secondsPerMinute) / (c.hoursPerDay * c.minutesPerHour);
  q(".cr-dhand").style.transform = `rotate(${(dayP * 360).toFixed(2)}deg)`; // ponteiro de 24 h: meio-dia em cima, meia-noite embaixo
  const pn = performance.now(); if (!full && pn - dialAt < (running() ? 120 : 2000)) return; dialAt = pn;
  const SH = seasonHere(t, c); const season = SH.name; const se = q(".cr-season"); if (se.textContent !== season) se.textContent = season;
  const here = api0()?.here?.(); const tip = `${SH.tip}${here ? `\nVisto de: ${here.label}${here.unit && here.unit !== here.label ? ` (${here.unit})` : ""}` : ""}`; if (se.title !== tip) se.title = tip;
  const dial = q(".cr-dial"); const dt = `${here ? `Céu visto de ${here.label}` : "Céu de agora"} · clique: abrir o céu · botão direito: carta estelar numa janela`; if (dial && dial.title !== dt) dial.title = dt;
  const at = game.modules.get("brumas-atlas"); const api = at?.active ? at.api : null;
  const wx = api?.weatherNow?.(); const wxT = wx && (gm || wx.players) ? `\u00a0·\u00a0${wx.label}${tempText(wx) ? `\u00a0${tempText(wx).includes("°") ? "" : "· "}${tempText(wx)}` : ""}` : "";
  if (q(".cr-wx").textContent !== wxT) q(".cr-wx").textContent = wxT;
  const moons = moonsOn(t); const mh = moons.map(mo => `<span class="cr-moon" title="${esc(mo.name)}: ${esc(mo.label)}">${moonSvg(mo, 6)}</span>`).join("");
  const mk = moons.map(m => m.label).join("|"); if (q(".cr-moons").dataset.k !== mk) { q(".cr-moons").innerHTML = mh; q(".cr-moons").dataset.k = mk; }
  // mostrador: o céu do Atlas visto daqui (se houver mapa celeste); senão, um céu simples pela hora
  const ds = parseInt(getComputedStyle(clockEl).getPropertyValue("--dial")) || 74; let sky = null; try { sky = api?.skyDial?.(t, ds) ?? null; } catch (e) { /* */ }
  q(".cr-dsky").innerHTML = sky ?? simpleDial(dayP, moons, wx, ds, t);
  const bar = q(".cr-bar"); if (bar) { bar.classList.remove("empty"); const bw = bar.clientWidth; /* mede sem o "vazio", que esconde a faixa e zera a largura */ let h = null; if (bw > 80) { try { h = api?.skyBar?.(bw, undefined, bar.clientHeight || 46, hid ? periodOf(t) : null) ?? null; } catch (e) { /* */ } } bar.innerHTML = h ?? ""; bar.classList.toggle("empty", !h); }
}
/** Céu simples (sem o Atlas): cor pela hora, sol e lua num arco, nuvens pelo clima. */
function simpleDial(dayP, moons, wx, size, t) {
  const a = (dayP - 0.25) * Math.PI * 2; const sunAlt = Math.sin(a); const day = Math.max(0, Math.min(1, (sunAlt + 0.15) / 0.4));
  const mix = (c1, c2, k) => c1.map((v, i) => Math.round(v + (c2[i] - v) * k)); const top = mix([10, 14, 30], [70, 140, 210], day), bot = mix([24, 30, 52], [170, 210, 240], day);
  const cx = size / 2, R = size * 0.38; const sx = cx - Math.cos(a) * R, sy = cx + 8 - Math.sin(a) * R;
  const cover = { nublado: 0.55, neblina: 0.5, chuva: 0.75, tempestade: 0.88, neve: 0.7, nevasca: 0.85 }[wx?.climate] ?? 0;
  const stars = day < 0.5 ? [...Array(18)].map((_, i) => `<circle cx="${(i * 37 % size)}" cy="${(i * 23 % (size * 0.6))}" r="0.8" fill="#fff" fill-opacity="${(0.8 - day).toFixed(2)}"/>`).join("") : "";
  const mo = moons[0]; const ma = a - Math.PI * 2 * 0.25; const mx = cx - Math.cos(ma) * R, my = cx + 8 - Math.sin(ma) * R;
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><defs><linearGradient id="crg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(${top})"/><stop offset="1" stop-color="rgb(${bot})"/></linearGradient></defs>
    <rect width="${size}" height="${size}" fill="url(#crg)"/>${stars}${sunAlt > -0.2 ? `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="6" fill="#ffd85a"/>` : ""}${mo && my < cx + 8 ? `<g transform="translate(${mx.toFixed(1)} ${my.toFixed(1)})">${moonSvg(mo, 5).replace(/<\/?svg[^>]*>/g, "")}</g>` : ""}
    ${cover ? `<rect width="${size}" height="${size}" fill="#9aa4b2" fill-opacity="${(cover * 0.6).toFixed(2)}"/>` : ""}<rect y="${cx + 8}" width="${size}" height="${size}" fill="#1a2016" fill-opacity=".85"/></svg>`;
}
/** O relógio ocupa o centro de cima (ou de baixo), entre os painéis do Foundry, e se ajusta à largura da tela. */
/* ---------- lugar do relógio: no meio, sem cobrir nada ----------
   Mede o que ocupa a faixa de cima (ou de baixo) da tela: à esquerda, os controles, a lista de cenas e o painel do Atlas;
   à direita, a barra lateral. O relógio fica no vão entre eles. Se o vão for estreito demais, ele empurra as colunas
   laterais para baixo (ou para cima) e usa a largura do meio. */
const MIN_W = 560, MAX_W = 980, GAP = 10;
let fitKey = "";
function bandRects(sel, band, bottom, H, off = 0) {
  const out = []; for (const el of document.querySelectorAll(sel)) { if (!el || el === clockEl || clockEl?.contains(el)) continue;
    const r = el.getBoundingClientRect(); if (r.width < 4 || r.height < 4) continue; const cs = getComputedStyle(el); if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
    const t = r.top - (bottom ? -off : off), b = r.bottom - (bottom ? -off : off); // sem o empurrão que já foi dado
    const inBand = bottom ? b > H - band && t < H : t < band && b > 0; if (inBand) out.push(r); }
  return out;
}
function fitClock() {
  if (!clockEl) return; if (clockEl.classList.contains("cr-hidden")) { document.body.classList.remove("cronos-push"); fitKey = ""; return; } // escondido: não reserva espaço
  const W = window.innerWidth, H = window.innerHeight; const bottom = clockEl.classList.contains("bottom");
  const ch = clockEl.offsetHeight || 64; const band = ch + GAP + 6;
  const off = document.body.classList.contains("cronos-push") ? (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--cronos-band")) || 0) : 0; // mede como se não houvesse empurrão
  const L = bandRects("#ui-left > *, #ui-left > * > *, #atlas-dock .atlas-dock-panel, #atlas-dock .atlas-dock-tab, #scene-controls, #controls, #scene-navigation, #navigation", band, bottom, H, off).filter(r => r.left < W / 2);
  const R = bandRects("#ui-right > *, #ui-right > * > *, #sidebar, #sidebar-tabs", band, bottom, H, off).filter(r => r.right > W / 2);
  const left = Math.max(0, ...L.map(r => r.right)) + GAP, right = Math.min(W, ...R.map(r => r.left)) - GAP;
  let lo = left, hi = right, push = false;
  if (hi - lo < MIN_W) { push = true; lo = GAP; hi = W - GAP; } // não cabe no vão: abre espaço empurrando as colunas
  const w = Math.round(Math.max(Math.min(MIN_W, hi - lo), Math.min(MAX_W, hi - lo)));
  const k = `${lo}|${hi}|${w}|${push}|${ch}|${bottom}`; if (k === fitKey) { document.body.classList.toggle("cronos-push", push); return; } fitKey = k;
  clockEl.style.width = `${w}px`; clockEl.style.left = `${Math.round((lo + hi) / 2)}px`;
  document.body.classList.toggle("cronos-push", push); document.body.classList.toggle("cronos-bottom", bottom);
  document.documentElement.style.setProperty("--cronos-band", `${band}px`); document.documentElement.style.setProperty("--cronos-top-gap", bottom ? "12px" : `${Math.round(ch + 14)}px`);
  const wasWide = clockEl.classList.contains("wide"); clockEl.classList.toggle("wide", w >= 720);
  if (w >= 720) requestAnimationFrame(() => updateClock(true)); // largura mudou: a faixa do céu é redesenhada no tamanho novo
  void wasWide;
}
setInterval(() => { try { fitClock(); } catch (e) { /* */ } }, 700); // painéis abrem e fecham o tempo todo: confere sempre
window.addEventListener("resize", () => fitClock());
Hooks.on("collapseSidebar", () => setTimeout(fitClock, 250));
/** Laço de animação: enquanto o tempo anda, a hora e o céu se movem sem trancos. */
let animRaf = null;
function animLoop() { if (animRaf) return; const step = () => { if (!clockEl || !running()) { animRaf = null; updateClock(true); return; } updateClock(); animRaf = requestAnimationFrame(step); }; animRaf = requestAnimationFrame(step); }
function bindClock() {
  clockEl.addEventListener("click", async (e) => { const b = e.target.closest("[data-cr]"); if (!b || b.tagName === "SELECT") return; const a = b.dataset.cr; const c = cal();
    if (a === "adv") return game.time.advance(Number(b.dataset.v));
    if (a === "play") { const r = game.settings.get(ID, "run") ?? {}; return game.settings.set(ID, "run", { ...r, on: !r.on }); }
    if (a === "dawn" || a === "dusk") { const D = toDate(game.time.worldTime, c); const target = (a === "dawn" ? 6 : 18) * c.minutesPerHour * c.secondsPerMinute; const now = (D.hour * c.minutesPerHour + D.minute) * c.secondsPerMinute + D.second; let d = target - now; if (d <= 0) d += secDayOf(c); return game.time.advance(d); }
    if (a === "here") { const api = api0(); const P = api?.herePlaces?.(); if (!game.user.isGM || !P) return;
      const opts = P.list.map(o => `<option value="${esc(o.v)}" ${o.v === P.cur ? "selected" : ""}>${esc(o.label)}</option>`).join("");
      const v = await foundry.applications.api.DialogV2.prompt({ window: { title: "Relógio visto de…" }, content: `<p>O mostrador, o clima e as estações mostram este lugar para todos.</p><select name="here" style="width:100%">${opts}</select>`, ok: { label: "Usar", callback: (ev, btn) => btn.form.elements.here.value }, rejectClose: false }).catch(() => null);
      if (v) await api.setHere(v); return; }
    if (a === "sky") { const at = game.modules.get("brumas-atlas"); if (at?.active && at.api?.openSky) return at.api.openSky(); return toggleCalendar(); }
    if (a === "cal") return toggleCalendar(); if (a === "cfg") return toggleConfig(); });
  // botão direito no mostrador: a janela do céu (carta estelar ou céu de hoje)
  clockEl.addEventListener("contextmenu", (e) => { const b = e.target.closest("[data-cr='sky']"); if (!b) return; e.preventDefault(); e.stopPropagation();
    const at = game.modules.get("brumas-atlas"); if (at?.active && at.api?.openSkyWindow) at.api.openSkyWindow(); });
  clockEl.addEventListener("change", (e) => { const s = e.target.closest("[data-cr='rate']"); if (s) { const r = game.settings.get(ID, "run") ?? {}; game.settings.set(ID, "run", { ...r, rate: Number(s.value) }); } });

}

/* ================= interface: o calendário ================= */
function panel(id, title) { const el = document.createElement("div"); el.id = id; el.className = "cronos-panel"; el.innerHTML = `<header><b>${esc(title)}</b><button data-pop title="Destacar em outra janela"><i class="fa-solid fa-arrow-up-right-from-square"></i></button><button data-x title="Fechar">✕</button></header><div class="cp-body"></div>`; document.body.appendChild(el);
  el.querySelector("[data-pop]").addEventListener("click", (e) => { e.stopPropagation(); const r = el.getBoundingClientRect(); togglePop(el, { title: `Cronos · ${title}`, width: Math.max(380, r.width), height: Math.max(420, r.height) }); }); el.querySelector("[data-x]").addEventListener("click", () => { el.remove(); if (el === calEl) calEl = null; if (el === cfgEl) cfgEl = null; }); return el; }
function toggleCalendar() { if (calEl) { calEl.remove(); calEl = null; return; } const D = toDate(game.time.worldTime); view.y = D.year; view.m = D.month; view.sel = D.day; calEl = panel("cronos-cal", "Calendário"); bindCal(); renderCal(); }
const hereTip = () => { const h = api0()?.here?.(); return h ? `Estações vistas de ${h.label}` : "Estações do calendário"; };
const calMode = () => { try { return game.settings.get(ID, "calView") || "grade"; } catch (e) { return "grade"; } };
function renderCal() {
  if (!calEl) return; if (calMode() === "disco") return renderDisc(); const c = cal(); const now = toDate(game.time.worldTime, c); const M = c.months[view.m]; const gm = game.user.isGM; const nW = c.weekdays.length;
  const first = toDate(toTime(view.y, view.m, 1, 0, c), c); const lead = M.intercalary ? 0 : first.weekday ?? 0;
  const cells = []; for (let i = 0; i < lead; i++) cells.push(`<span class="cc-e"></span>`);
  const sd0 = secDayOf(c); const seasonDay = (d) => seasonHere(toTime(view.y, view.m, d, sd0 / 2, c), c).name; let prevS = seasonHere(toTime(view.y, view.m, 1, sd0 / 2, c) - sd0, c).name; const mS = [];
  for (let d = 1; d <= M.days; d++) { const ev = eventsOn(view.y, view.m, d);
    const sN = seasonDay(d); const sChange = sN !== prevS; prevS = sN; if (!mS.includes(sN)) mS.push(sN); const isNow = now.year === view.y && now.month === view.m && now.day === d; const mo = moonsOn(toTime(view.y, view.m, d, secDayOf(c) / 2, c))[0];
    cells.push(`<button class="cc-d ${isNow ? "now" : ""} ${view.sel === d ? "sel" : ""} ${sChange ? "cc-ss" : ""}" data-cd="${d}" ${sChange ? `title="Começa: ${esc(sN)}"` : ""}><b>${d}</b>${mo && (mo.label === "cheia" || mo.label === "nova" || mo.label.startsWith("quarto")) ? `<span class="cc-mo">${moonSvg(mo, 5)}</span>` : ""}${ev.length ? `<i class="cc-ev">${ev.slice(0, 3).map(() => "•").join("")}</i>` : ""}</button>`); }
  calEl.querySelector(".cp-body").innerHTML = `<div class="cc-nav"><button data-cn="-1">‹</button><div class="grow"><b>${esc(M.name)}</b> <span>${view.y}${c.era ? ` ${esc(c.era)}` : ""}</span>${M.intercalary ? ` <small>(fora da semana)</small>` : ""}<small class="cc-season" title="${esc(hereTip())}">${esc(mS.join(" → "))}</small></div><button data-cn="1">›</button><button data-cn="hoje" title="Voltar para hoje">Hoje</button><button data-cn="mode" title="Ver como disco (calendário antigo)">◎</button></div>
    ${M.intercalary ? "" : `<div class="cc-wd">${c.weekdays.map(w => `<span>${esc(w.slice(0, 3))}</span>`).join("")}</div>`}
    <div class="cc-grid" style="grid-template-columns:repeat(${M.intercalary ? Math.min(M.days, 7) : nW},1fr)">${cells.join("")}</div>
    ${dayBlock(c)}`;
}
/* ---------- calendário em disco (como os antigos: um disco que gira, com o dia escolhido sob o ponteiro) ---------- */
const SEASON_COL = (n) => { const k = String(n).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (k.includes("primavera")) return "#6f9a54"; if (k.includes("verao")) return "#c9a24a"; if (k.includes("outono")) return "#b06a3a"; if (k.includes("inverno")) return "#5c7fa8";
  if (k.includes("chuva")) return "#4f8f8a"; if (k.includes("seca")) return "#a8874e"; if (k.includes("sem")) return "#7a7a7a"; return "#8a7d66"; };
let discRot = null;
function renderDisc() {
  const c = cal(); const gm = game.user.isGM; const now = toDate(game.time.worldTime, c); const dpy = dpyOf(c); const sd = secDayOf(c); const A = 360 / dpy;
  if (!view.sel) { view.m = now.month; view.sel = now.day; }
  const S = 400, C = S / 2, R1 = 192, R2 = 160, R3 = 140, R4 = 120, R5 = 100, R6 = 86; const D2R = Math.PI / 180;
  const pt = (r, deg) => [C + r * Math.sin(deg * D2R), C - r * Math.cos(deg * D2R)];
  const arc = (r0, r1, a0, a1) => { const big = a1 - a0 > 180 ? 1 : 0; const [x0, y0] = pt(r1, a0), [x1, y1] = pt(r1, a1), [x2, y2] = pt(r0, a1), [x3, y3] = pt(r0, a0);
    return `M${x0.toFixed(1)} ${y0.toFixed(1)}A${r1} ${r1} 0 ${big} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}A${r0} ${r0} 0 ${big} 0 ${x3.toFixed(1)} ${y3.toFixed(1)}Z`; };
  const g = [];
  // meses
  let acc = 0;
  c.months.forEach((M, mi) => { const a0 = acc * A, a1 = (acc + M.days) * A; const mid = (a0 + a1) / 2;
    g.push(`<path d="${arc(R2, R1, a0, a1)}" class="cd-mo ${M.intercalary ? "ic" : mi % 2 ? "odd" : ""}"/>`);
    const [tx, ty] = pt((R1 + R2) / 2, mid); g.push(`<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" class="cd-mn" transform="rotate(${mid.toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)})">${esc(M.intercalary ? M.name : M.name)}</text>`);
    acc += M.days; });
  // dias: fatias clicáveis, marcas, eventos, luas e estações
  let prevS = null, sStart = 0; const sArcs = []; const ticks = [], hits = [], evs = [], moons = [];
  acc = 0;
  c.months.forEach((M, mi) => { for (let d = 1; d <= M.days; d++, acc++) {
    const a0 = acc * A, a1 = (acc + 1) * A, mid = a0 + A / 2; const t = toTime(view.y, mi, d, sd / 2, c);
    const long = d === 1 ? R3 - 4 : d % 10 === 0 ? R3 + 6 : d % 5 === 0 ? R3 + 10 : R3 + 14; const [x0, y0] = pt(R2, a0), [x1, y1] = pt(long, a0);
    ticks.push(`<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" class="${d === 1 ? "m" : ""}"/>`);
    const ev = eventsOn(view.y, mi, d); const isNow = now.year === view.y && now.month === mi && now.day === d; const isSel = view.m === mi && view.sel === d;
    hits.push(`<path d="${arc(R3, R2, a0, a1)}" class="cd-day${isNow ? " now" : ""}${isSel ? " sel" : ""}" data-cdd="${mi}:${d}"><title>${esc(fmtDate(t, c, false))}${ev.length ? ` — ${ev.map(e => e.title).join(", ")}` : ""}</title></path>`);
    if (ev.length) { const [ex, ey] = pt(R2 - 4, mid); evs.push(`<circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="2.2" class="cd-ev"/>`); }
    const mo = moonsOn(t)[0]; if (mo && (mo.label === "cheia" || mo.label === "nova")) { const [mx, my] = pt((R4 + R5) / 2, mid); moons.push(`<circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="4" class="cd-moon ${mo.label === "cheia" ? "full" : "new"}"><title>${esc(mo.name)} ${mo.label}</title></circle>`); }
    const sN = seasonHere(t, c).name; if (sN !== prevS) { if (prevS != null) sArcs.push([sStart, acc, prevS]); prevS = sN; sStart = acc; }
  } });
  if (prevS != null) sArcs.push([sStart, acc, prevS]);
  for (const [s0, s1, n] of sArcs) { const a0 = s0 * A, a1 = s1 * A; g.push(`<path d="${arc(R4, R3 - 6, a0, a1)}" fill="${SEASON_COL(n)}" class="cd-se"><title>${esc(n)}</title></path>`);
    if (a1 - a0 > 18) { const mid = (a0 + a1) / 2; const [tx, ty] = pt((R4 + R3 - 6) / 2, mid); g.push(`<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" class="cd-sn" transform="rotate(${mid.toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)})">${esc(n)}</text>`); } }
  g.push(`<g class="cd-ticks">${ticks.join("")}</g>`, ...hits, ...evs, ...moons);
  g.push(`<circle cx="${C}" cy="${C}" r="${R5}" class="cd-ring"/><circle cx="${C}" cy="${C}" r="${R1}" class="cd-ring out"/>`);
  // hoje: uma pequena chama na borda
  if (now.year === view.y) { const ta = (doyOf(c, now.month, now.day) + 0.5) * A; const [hx, hy] = pt(R1 + 1, ta); g.push(`<circle cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="4.5" class="cd-today"><title>Hoje</title></circle>`); }
  const selDoy = doyOf(c, view.m, view.sel); const rot = -((selDoy + 0.5) * A);
  const from = discRot ?? rot; discRot = rot;
  // centro (fixo): ano, dia escolhido e a estação
  const selT = toTime(view.y, view.m, view.sel, sd / 2, c); const SH = seasonHere(selT, c);
  const hub = `<circle cx="${C}" cy="${C}" r="${R6}" class="cd-hub"/>
    ${[...Array(16)].map((_, i) => { const [x0, y0] = pt(R6 - 2, i * 22.5), [x1, y1] = pt(R6 - (i % 2 ? 8 : 14), i * 22.5); return `<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" class="cd-ray"/>`; }).join("")}
    <text x="${C}" y="${C - 22}" class="cd-y">${view.y}${c.era ? ` ${esc(c.era)}` : ""}</text>
    <text x="${C}" y="${C + 2}" class="cd-d">${view.sel}</text>
    <text x="${C}" y="${C + 20}" class="cd-dm">${esc(c.months[view.m]?.name ?? "")}</text>
    <text x="${C}" y="${C + 36}" class="cd-ds">${esc(SH.name)}</text>`;
  const pointer = `<path d="M${C - 9} 2 L${C + 9} 2 L${C} ${C - R1 + 14} Z" class="cd-ptr"/>`;
  calEl.querySelector(".cp-body").innerHTML = `<div class="cc-nav"><button data-cn="-1" title="Ano anterior">‹</button><div class="grow"><b>${view.y}${c.era ? ` ${esc(c.era)}` : ""}</b> <small class="cc-season" title="${esc(hereTip())}">Gire o disco: clique num dia</small></div><button data-cn="1" title="Próximo ano">›</button><button data-cn="hoje" title="Voltar para hoje">Hoje</button><button data-cn="mode" class="on" title="Ver como grade">▦</button></div>
    <div class="cd-wrap"><svg class="cd" viewBox="0 0 ${S} ${S}"><g class="cd-rot" style="transform:rotate(${from}deg)">${g.join("")}</g>${hub}${pointer}</svg></div>
    <div class="cd-leg"><span><i class="cd-l ev"></i>evento</span><span><i class="cd-l full"></i>lua cheia</span><span><i class="cd-l new"></i>lua nova</span><span><i class="cd-l today"></i>hoje</span></div>
    ${dayBlock(c)}`;
  const rg = calEl.querySelector(".cd-rot"); if (rg && from !== rot) requestAnimationFrame(() => requestAnimationFrame(() => { rg.style.transform = `rotate(${rot}deg)`; }));
}
/** Detalhe do dia escolhido (eventos e o formulário do mestre): o mesmo na grade e no disco. */
function dayBlock(c) {
  const gm = game.user.isGM; const sd0 = secDayOf(c);
  const sel = view.sel ? eventsOn(view.y, view.m, view.sel) : []; const selT = view.sel ? toTime(view.y, view.m, view.sel, 0, c) : null;
  return view.sel ? `<div class="cc-day"><div class="cc-dh"><b>${esc(fmtDate(selT, c))}</b><small class="cc-season">${esc(seasonHere(selT + sd0 / 2, c).name)}</small>${gm ? `<button data-ca="goto" title="Levar o relógio do mundo para este dia (mesma hora)">Ir para este dia</button>` : ""}</div>
      ${sel.map(e => `<div class="cc-evt"><div class="grow"><b>${esc(e.title)}</b>${e.tag ? ` <span class="tag">${esc(e.tag)}</span>` : ""}${e.year == null ? ` <span class="tag rep">todo ano</span>` : ""}${!e.players ? ` <span class="tag gm">só o mestre</span>` : ""}${e.text ? `<small>${esc(e.text)}</small>` : ""}</div>${gm ? `<button data-ca="del" data-id="${e.id}" title="Apagar">✕</button>` : ""}</div>`).join("") || `<small class="muted">Nenhum evento neste dia.</small>`}
      ${gm ? `<form class="cc-add"><input name="title" placeholder="Novo evento…" required><input name="tag" placeholder="Tipo (ex.: Festival)"><label><input type="checkbox" name="rep" checked> todo ano</label><label><input type="checkbox" name="pl" checked> jogadores veem</label><button type="submit">Adicionar</button></form>` : ""}</div>` : "";
}
function bindCal() {
  calEl.addEventListener("click", async (e) => { const c = cal();
    const n = e.target.closest("[data-cn]"); if (n && n.dataset.cn === "mode") { await game.settings.set(ID, "calView", calMode() === "disco" ? "grade" : "disco"); return renderCal(); }
    if (n && calMode() === "disco" && n.dataset.cn !== "hoje") { view.y += Number(n.dataset.cn); return renderCal(); }
    const dd = e.target.closest("[data-cdd]"); if (dd) { const [m, d] = dd.dataset.cdd.split(":").map(Number); view.m = m; view.sel = d; return renderCal(); }
    if (n) { if (n.dataset.cn === "hoje") { const D = toDate(game.time.worldTime, c); view.y = D.year; view.m = D.month; view.sel = D.day; } else { view.m += Number(n.dataset.cn); if (view.m < 0) { view.m = c.months.length - 1; view.y--; } if (view.m >= c.months.length) { view.m = 0; view.y++; } view.sel = null; } return renderCal(); }
    const d = e.target.closest("[data-cd]"); if (d) { view.sel = Number(d.dataset.cd); return renderCal(); }
    const a = e.target.closest("[data-ca]"); if (!a || !game.user.isGM) return;
    if (a.dataset.ca === "goto") { const D = toDate(game.time.worldTime, c); const sec = (D.hour * c.minutesPerHour + D.minute) * c.secondsPerMinute + D.second; return game.time.advance(toTime(view.y, view.m, view.sel, sec, c) - game.time.worldTime); }
    if (a.dataset.ca === "del") return game.settings.set(ID, "events", events().filter(x => x.id !== a.dataset.id)); });
  calEl.addEventListener("submit", (e) => { e.preventDefault(); const f = e.target; if (!game.user.isGM || !view.sel) return;
    game.settings.set(ID, "events", [...events(), { id: uid(), year: f.rep.checked ? null : view.y, month: view.m, day: view.sel, title: f.title.value.trim(), tag: f.tag.value.trim(), text: "", players: f.pl.checked }]); });
}

/* ================= interface: configurar o calendário ================= */
function toggleConfig() { if (cfgEl) { cfgEl.remove(); cfgEl = null; return; } cfgEl = panel("cronos-cfg", "Configurar o calendário"); bindCfg(); renderCfg(); }
let draft = null;
function renderCfg() {
  if (!cfgEl) return; draft ??= structuredClone(cal()); const c = draft;
  const fp = foundryPresets();
  cfgEl.querySelector(".cp-body").innerHTML = `<div class="cf-presets">Começar de: ${Object.entries(PRESETS).map(([k, p]) => `<button data-cp="${k}">${esc(p.name)}</button>`).join("")}</div>
    ${fp.length ? `<div class="cf-presets">Do Foundry e do sistema: ${fp.map((p, i) => `<button data-fp="${i}" title="Copia meses, semana e estações (anos bissextos ficam de fora)">${esc(p.label)}</button>`).join("")}</div>` : ""}
    <label>Nome<input data-cf="name" value="${esc(c.name)}"></label>
    <div class="cf-row"><label>Ano em que o relógio começa<input type="number" data-cf="yearZero" value="${c.yearZero}"></label><label>Era (ex.: DR)<input data-cf="era" value="${esc(c.era)}"></label></div>
    <div class="cf-row"><label>Horas por dia<input type="number" min="1" data-cf="hoursPerDay" value="${c.hoursPerDay}"></label><label>Minutos por hora<input type="number" min="1" data-cf="minutesPerHour" value="${c.minutesPerHour}"></label><label>Segundos por minuto<input type="number" min="1" data-cf="secondsPerMinute" value="${c.secondsPerMinute}"></label></div>
    <h4>Meses · ${c.months.length} · ${dpyOf(normCal(c))} dias no ano</h4>
    <div class="cf-months">${c.months.map((m, i) => `<div class="cf-m"><input data-cm="${i}" data-k="name" value="${esc(m.name)}"><input type="number" min="1" data-cm="${i}" data-k="days" value="${m.days}" title="Dias"><label title="Dias intercalares: fora da semana (como Interlúnis)"><input type="checkbox" data-cm="${i}" data-k="intercalary" ${m.intercalary ? "checked" : ""}> fora da semana</label><button data-cmd="up" data-i="${i}" title="Subir">↑</button><button data-cmd="del" data-i="${i}" title="Tirar">✕</button></div>`).join("")}<button data-cmd="add">+ Mês</button></div>
    <h4>Semana</h4><label>Dias da semana (separados por vírgula)<input data-cf="weekdays" value="${esc(c.weekdays.join(", "))}"></label>
    <label class="cf-chk"><input type="checkbox" data-cf="weekResets" ${c.weekResets ? "checked" : ""}> O ano sempre começa no primeiro dia da semana</label>
    <h4>Estações e céu</h4><div class="cf-row"><label>Equinócio de primavera: mês<select data-cf="eqm">${c.months.map((m, i) => `<option value="${i}" ${c.equinox?.month === i ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select></label><label>dia<input type="number" min="1" data-cf="eqd" value="${c.equinox?.day ?? 1}"></label></div>
    <small>O Atlas usa este equinócio para as estações, a luz do mundo e o caminho do sol.</small>
    <div class="cf-seasons">${(c.seasons ?? []).map((s, i) => `<div class="cf-m"><input data-cs="${i}" data-k="name" value="${esc(s.name)}"><select data-cs="${i}" data-k="month">${c.months.map((m, j) => `<option value="${j}" ${s.month === j ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select><input type="number" min="1" data-cs="${i}" data-k="day" value="${s.day}"><button data-cmd="sdel" data-i="${i}">✕</button></div>`).join("")}<button data-cmd="sadd">+ Estação</button></div>
    <h4>Eventos</h4><div class="cf-row"><button data-cmd="import">Importar eventos dos diários</button><small>Lê linhas como “15 de Lunaris — Solstício de Verão [Astronômico] …” (${events().length} evento(s) agora).</small></div>
    <div class="cf-foot"><button data-cmd="cancel">Cancelar</button><button class="gold" data-cmd="save">Salvar o calendário</button></div>`;
}
function bindCfg() {
  cfgEl.addEventListener("input", (e) => { const el = e.target; const c = draft; const v = el.type === "checkbox" ? el.checked : el.value;
    if (el.dataset.cf) { const k = el.dataset.cf; if (k === "weekdays") c.weekdays = String(v).split(",").map(s => s.trim()).filter(Boolean); else if (k === "eqm") c.equinox = { ...(c.equinox ?? {}), month: Number(v) }; else if (k === "eqd") c.equinox = { ...(c.equinox ?? {}), day: Number(v) }; else c[k] = el.type === "number" ? Number(v) : v; }
    if (el.dataset.cm != null) { const m = c.months[Number(el.dataset.cm)]; m[el.dataset.k] = el.dataset.k === "days" ? Number(v) : v; }
    if (el.dataset.cs != null) { const s = c.seasons[Number(el.dataset.cs)]; s[el.dataset.k] = el.dataset.k === "name" ? v : Number(v); } });
  cfgEl.addEventListener("click", async (e) => { const b = e.target.closest("[data-cmd],[data-cp],[data-fp]"); if (!b) return; const c = draft;
    if (b.dataset.cp) { draft = structuredClone(PRESETS[b.dataset.cp]); return renderCfg(); }
    if (b.dataset.fp != null) { const p = foundryPresets()[Number(b.dataset.fp)]; if (p) { draft = structuredClone(fromFoundry(p)); ui.notifications.info(`Cronos · ${p.label} carregado. Confira e salve.`); } return renderCfg(); }
    const i = Number(b.dataset.i); switch (b.dataset.cmd) {
      case "add": c.months.push({ name: `Mês ${c.months.length + 1}`, days: 30 }); break;
      case "del": c.months.splice(i, 1); break;
      case "up": if (i > 0) [c.months[i - 1], c.months[i]] = [c.months[i], c.months[i - 1]]; break;
      case "sadd": (c.seasons ??= []).push({ name: "Estação", month: 0, day: 1 }); break;
      case "sdel": c.seasons.splice(i, 1); break;
      case "import": await importFromJournal(); break;
      case "cancel": draft = null; cfgEl.remove(); cfgEl = null; return;
      case "save": await game.settings.set(ID, "calendar", normCal(c)); draft = null; ui.notifications.info("Cronos · calendário salvo."); cfgEl.remove(); cfgEl = null; return;
    } renderCfg(); });
}

/* ================= ligação com o resto ================= */
let raf = null; function refreshAll() { if (raf) return; raf = requestAnimationFrame(() => { raf = null; renderClock(); renderCal(); animLoop(); }); }
/** O relógio do mundo andou: só os textos do relógio mudam; o calendário só é redesenhado quando o dia muda. */
let lastDay = null;
function onTime() { markTime(); updateClock(true); animLoop(); const D = toDate(game.time.worldTime); const k = `${D.year}|${D.doy}`; if (k !== lastDay) { lastDay = k; renderCal(); } }
Hooks.once("init", () => { register(); try { registerRoundSettings(); } catch (e) { console.warn(`${ID} | etapas`, e); } });
Hooks.once("ready", () => { try { hookRoundPhases(); } catch (e) { console.warn(`${ID} | etapas`, e); } });
Hooks.once("ready", () => {
  syncFoundry(); markTime(); startTicker(); renderClock(); animLoop();
  const mod = game.modules.get(ID);
  if (mod) mod.api = {
    toDate: (t = game.time.worldTime) => toDate(t), toTime, format: (t = game.time.worldTime) => `${fmtDate(t)} · ${fmtTime(t)}`, calendar: () => cal(), eventsOn,
    /** Para o Atlas: hora do dia (0–1), parte do ano (0–1, começo do ano = 0), duração do dia e do ano, e o equinócio (parte do ano). */
    yearInfo: (t = game.time.worldTime) => { const c = cal(); const sd = secDayOf(c), dpy = dpyOf(c); const D = toDate(t, c); return { dayFrac: (t - D.days * sd) / sd, yearFrac: (D.doy + (t - D.days * sd) / sd) / dpy, secDay: sd, dpy, equinox: doyOf(c, c.equinox?.month ?? 0, c.equinox?.day ?? 1) / dpy }; },
    /** Instante de agora para desenhar (suave enquanto o tempo anda) e se o tempo está andando. */
    now: () => now(), running: () => running(),
    play: (on = true) => game.settings.set(ID, "run", { ...(game.settings.get(ID, "run") ?? {}), on }), open: toggleCalendar,
    /** Imersão: a hora como este usuário pode vê-la, se ela está escondida, a parte do dia, a sensação térmica e o teste do sol. */
    publicTime: (t) => publicTime(t ?? now()), timeHidden: () => timeHidden(), period: (t) => periodOf(t ?? now()), feel: feelOf, sunCheck: () => sunCheck()
  };
  Hooks.callAll("cronosReady", mod?.api);
});
Hooks.on("updateWorldTime", () => onTime());
Hooks.on("pauseGame", () => refreshAll());
// o lugar de onde o relógio é visto, a inclinação do planeta e o clima moram nas cenas do Atlas
Hooks.on("updateScene", (s, ch) => { if (ch?.flags?.["brumas-atlas"]) refreshAll(); });

/* botão na barra da esquerda (grupo dos tokens): mostra ou esconde o relógio, só para quem clicou */
const clockOn = () => !game.settings.get(ID, "hidden");
Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user.isGM && !game.settings.get(ID, "playersSee")) return;
  const tool = { name: "cronosClock", title: "Relógio do Cronos (mostrar ou esconder)", icon: "fa-solid fa-clock", toggle: true, active: clockOn(), order: 99, button: false,
    onChange: (event, active) => game.settings.set(ID, "hidden", !active),
    onClick: (active) => game.settings.set(ID, "hidden", typeof active === "boolean" ? !active : clockOn()) };
  if (Array.isArray(controls)) { const g = controls.find(c => c.name === "token"); if (g) g.tools.push(tool); return; } // Foundry 12
  const g = controls.tokens ?? controls.token; if (g?.tools) { delete tool.onClick; g.tools.cronosClock = tool; }
});
