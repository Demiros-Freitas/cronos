// Cronos · etapas da rodada no combate: Início da Rodada → turnos → Fim da Rodada → (tempo anda) → próxima rodada.
// Inspirado no Triaxis. A etapa fica numa flag do combate; o rastreador mostra onde a rodada está, a tela anuncia a etapa
// e o chat traz o que costuma acontecer ali (efeitos que acabam, lembretes do mestre). Outros módulos podem ouvir
// os ganchos "cronosRoundStart" e "cronosRoundEnd" (combat, round).
const ID = "brumas-cronos";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const isActiveGM = () => game.user.isGM && (game.users.activeGM?.id ?? game.user.id) === game.user.id;
const on = () => { try { return game.settings.get(ID, "roundPhases") !== false; } catch (e) { return false; } };
const FASES = {
  inicio: { nome: "Início da Rodada", cor: "#d8b45c" },
  turnos: { nome: "Turnos", cor: "#c9615a" },
  fim: { nome: "Fim da Rodada", cor: "#c97a45" },
};
const ORDEM = ["inicio", "turnos", "fim"];
export const faseOf = (cb) => cb?.started ? (cb.getFlag?.(ID, "fase") ?? "turnos") : null;
const lista = (k) => { try { return String(game.settings.get(ID, k) ?? "").split(/\s*[;\n]\s*/).map(s => s.trim()).filter(Boolean); } catch (e) { return []; } };

export function registerRoundSettings() {
  game.settings.register(ID, "roundPhases", { name: "Etapas da rodada no combate", hint: "Cada rodada passa por Início da Rodada, os turnos e Fim da Rodada antes de o tempo andar. O botão de próximo turno avança as etapas; o rastreador mostra em qual está.", scope: "world", config: true, type: Boolean, default: true, requiresReload: true });
  game.settings.register(ID, "phaseChat", { name: "Anunciar as etapas no chat", hint: "Mensagem no início e no fim de cada rodada, com os lembretes e os efeitos que terminam.", scope: "world", config: true, type: String, choices: { todos: "Para todos", mestre: "Só para o mestre", nao: "Não anunciar" }, default: "todos" });
  game.settings.register(ID, "phaseBanner", { name: "Faixa na tela ao mudar de etapa", hint: "Mostra por um instante \"Início da Rodada 2\", \"Fim da Rodada 2\" no meio da tela.", scope: "client", config: true, type: Boolean, default: true });
  game.settings.register(ID, "phaseStartList", { name: "Lembretes do Início da Rodada", hint: "Separe com ponto e vírgula. Aparecem no chat do mestre.", scope: "world", config: true, type: String, default: "Ações de covil e efeitos do lugar; Efeitos que acontecem no início da rodada; O clima ou o terreno mudam?" });
  game.settings.register(ID, "phaseEndList", { name: "Lembretes do Fim da Rodada", hint: "Separe com ponto e vírgula. Aparecem no chat do mestre.", scope: "world", config: true, type: String, default: "Testes de resistência de fim de rodada; Magias e efeitos que terminam; Concentração ainda ativa?" });
}

/* ---------- a máquina de etapas (embrulha o combate do sistema) ---------- */
export function hookRoundPhases() {
  if (!on()) return;
  const C = CONFIG.Combat?.documentClass; const P = C?.prototype; if (!P || P.__cronosFases) return; P.__cronosFases = true;
  const orig = { startCombat: P.startCombat, nextTurn: P.nextTurn, nextRound: P.nextRound, previousTurn: P.previousTurn, previousRound: P.previousRound };
  // jogador que encerra a vez e cai numa troca de etapa: o mestre faz a troca
  const viaGM = (cb, action) => { game.socket?.emit(`module.${ID}`, { type: "fase", combatId: cb.id, action }); return cb; };
  const setFase = (cb, f) => cb.update({ [`flags.${ID}.fase`]: f });

  P.startCombat = async function (...a) { const r = await orig.startCombat.apply(this, a); if (game.user.isGM) await setFase(this, "inicio"); return r; };
  P.nextRound = async function (...a) {
    if (!this.started) return orig.nextRound.apply(this, a);
    if (faseOf(this) !== "fim") { if (!game.user.isGM) return viaGM(this, "nextRound"); await setFase(this, "fim"); return this; }
    const r = await orig.nextRound.apply(this, a); await setFase(this, "inicio"); return r; // o Foundry faz o tempo andar uma rodada aqui
  };
  P.nextTurn = async function (...a) {
    if (!this.started) return orig.nextTurn.apply(this, a);
    const f = faseOf(this);
    if (f === "inicio") { if (!game.user.isGM) return viaGM(this, "nextTurn"); await setFase(this, "turnos"); return this; }
    if (f === "fim") return this.nextRound();
    return orig.nextTurn.apply(this, a); // no último turno, o Foundry chama nextRound, que leva ao Fim da Rodada
  };
  P.previousTurn = async function (...a) {
    if (!this.started) return orig.previousTurn.apply(this, a);
    const f = faseOf(this);
    if (f === "fim") { if (!game.user.isGM) return this; await setFase(this, "turnos"); return this; }
    if (f === "inicio") { if (!game.user.isGM || this.round <= 1) return this; const r = await orig.previousRound.apply(this, a); await setFase(this, "fim"); return r; }
    if ((this.turn ?? 0) <= 0) { if (!game.user.isGM) return this; await setFase(this, "inicio"); return this; }
    return orig.previousTurn.apply(this, a);
  };
  P.previousRound = async function (...a) {
    if (!this.started || !game.user.isGM) return orig.previousRound.apply(this, a);
    if (faseOf(this) !== "inicio") { await this.update({ turn: 0, [`flags.${ID}.fase`]: "inicio" }); return this; } // volta ao início desta rodada
    if (this.round <= 1) return this;
    const r = await orig.previousRound.apply(this, a); await setFase(this, "inicio"); return r;
  };
  game.socket?.on(`module.${ID}`, async (m) => {
    if (m?.type !== "fase" || !isActiveGM()) return; const cb = game.combats.get(m.combatId); if (!cb) return;
    if (m.action === "nextRound") await cb.nextRound(); else if (m.action === "nextTurn") await cb.nextTurn();
  });

  // anúncio: faixa na tela (todos) e mensagem no chat (o mestre manda uma vez)
  Hooks.on("updateCombat", (cb, ch) => {
    const nf = ch?.flags?.[ID]?.fase; if (!nf || !cb.started) return;
    if (nf === "turnos") { try { ui.combat?.render?.(); } catch (e) { /* */ } return; }
    banner(nf, cb.round);
    const k = `${cb.id}|${cb.round}|${nf}`; if (isActiveGM() && !said.has(k)) { said.add(k); announce(cb, nf).catch(e => console.warn(`${ID} | etapa`, e)); } // voltando etapas, não repete no chat
    Hooks.callAll(nf === "inicio" ? "cronosRoundStart" : "cronosRoundEnd", cb, cb.round);
  });
  Hooks.on("combatStart", (cb) => setTimeout(() => { if (faseOf(cb) === "inicio") banner("inicio", cb.round); }, 300));

  // rastreador: a caixa da etapa no alto, com a trilha Início · Turnos · Fim
  Hooks.on("renderCombatTracker", (app, html) => { try { decorate(html instanceof HTMLElement ? html : html?.[0] ?? app.element); } catch (e) { console.warn(`${ID} | rastreador`, e); } });
}

function decorate(root) {
  if (!root) return; root.querySelector(".cronos-fase")?.remove();
  const cb = game.combat; const f = faseOf(cb); root.classList.toggle("cronos-roundphase", f === "inicio" || f === "fim");
  if (!f) return;
  const fi = FASES[f]; const i = ORDEM.indexOf(f);
  const vez = f === "turnos" && cb.combatant ? (cb.combatant.isOwner || game.user.isGM || !cb.combatant.hidden ? cb.combatant.name : "???") : "";
  const box = document.createElement("div"); box.className = `cronos-fase f-${f}`; box.style.setProperty("--cf", fi.cor);
  box.innerHTML = `<span class="cf-kicker">Rodada ${cb.round}</span><strong class="cf-name">${fi.nome}</strong>${vez ? `<span class="cf-sub">Vez de ${esc(vez)}</span>` : ""}
    <div class="cf-trilha">${ORDEM.map((e, k) => `<span class="cf-pip ${k < i ? "feito" : ""} ${k === i ? "atual" : ""}" style="--cp:${FASES[e].cor}" title="${FASES[e].nome}"></span>`).join(`<span class="cf-fio"></span>`)}</div>
    ${game.user.isGM && f !== "turnos" ? `<span class="cf-hint">Próximo turno: ${f === "inicio" ? "começar os turnos" : "encerrar a rodada (o tempo anda)"}</span>` : ""}`;
  const list = root.querySelector("ol.combat-tracker, .combat-tracker, ol.directory-list");
  if (list?.parentElement) list.parentElement.insertBefore(box, list); else root.prepend(box);
}

let bannerT = null; const said = new Set();
function banner(f, round) {
  try { if (!game.settings.get(ID, "phaseBanner")) return; } catch (e) { /* */ }
  const fi = FASES[f]; if (!fi) return;
  document.getElementById("cronos-fase-banner")?.remove(); clearTimeout(bannerT);
  const el = document.createElement("div"); el.id = "cronos-fase-banner"; el.style.setProperty("--cf", fi.cor);
  el.innerHTML = `<span class="cfb-kicker">Rodada ${round}</span><strong>${fi.nome}</strong>`;
  document.body.appendChild(el); requestAnimationFrame(() => el.classList.add("show"));
  bannerT = setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 600); }, 2200);
}

/** Efeitos com duração em rodadas que terminam nesta rodada. */
function ending(cb) {
  const out = [];
  for (const c of cb.combatants) { const a = c.actor; if (!a) continue;
    for (const e of a.appliedEffects ?? a.effects ?? []) { const d = e.duration ?? {}; if (e.disabled || !(d.rounds > 0)) continue;
      const start = d.startRound ?? 0; if (start + d.rounds <= cb.round) out.push(`${c.name}: ${e.name}`); } }
  return out;
}
async function announce(cb, f) {
  const mode = game.settings.get(ID, "phaseChat"); if (mode === "nao") return;
  const fi = FASES[f]; const items = lista(f === "inicio" ? "phaseStartList" : "phaseEndList"); const end = f === "fim" ? ending(cb) : [];
  const secs = CONFIG.time?.roundTime ?? 6; let clock = "";
  try { const api = game.modules.get(ID)?.api; if (api?.format) clock = api.format(game.time.worldTime); } catch (e) { /* */ }
  const card = (body) => `<div class="cronos-fase-chat" style="--cf:${fi.cor}"><div class="cfc-head"><span>Rodada ${cb.round}</span><strong>${fi.nome}</strong></div>${body}</div>`;
  const ul = (lab, xs) => xs.length ? `<p class="cfc-lab">${lab}</p><ul>${xs.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : "";
  const pub = `${f === "fim" ? `<p class="cfc-time">Ao seguir, o tempo anda ${secs} s.</p>` : clock && (mode === "mestre" || game.settings.get(ID, "playerTime") !== "periodo") ? `<p class="cfc-time">${esc(clock)}</p>` : ""}${ul("Terminam agora", end)}`;
  const gms = ChatMessage.getWhisperRecipients("GM").map(u => u.id); const flags = { [ID]: { fase: f } }; const speaker = { alias: "Cronos" };
  if (mode === "mestre") return void await ChatMessage.create({ content: card(pub + ul("Lembretes", items)), speaker, whisper: gms, flags });
  await ChatMessage.create({ content: card(pub), speaker, flags });
  if (items.length) await ChatMessage.create({ content: card(ul("Lembretes do mestre", items)), speaker, whisper: gms, flags });
}
