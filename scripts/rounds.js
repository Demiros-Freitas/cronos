// Cronos · gestor de turnos com Início e Fim da Rodada (no espírito do Triaxis), para a iniciativa do D&D.
// Rodada: Início da Rodada → as vezes, na ordem da iniciativa → Fim da Rodada → (o tempo anda) → nova rodada.
// - Início e Fim da Rodada são faixas fixas no rastreador; cada uma tem um espaço para itens (arraste um item: ação de covil,
//   efeito do lugar…) que ficam guardados na cena e podem ser usados sempre que a rodada passa por ali.
// - Quem já agiu desce para baixo do Fim da Rodada, em cinza; a ordem é numerada e as linhas deslizam ao mudar de lugar.
// - Macros também entram nas faixas; as marcadas com ⚡ rodam sozinhas quando a rodada chega ali (recebem combat, round, fase).
// - Grupos: vários combatentes agem juntos, na vez do de maior iniciativa (um bloco recolhível no rastreador).
// Outros módulos podem ouvir os ganchos "cronosRoundStart" e "cronosRoundEnd" (combat, round).
const ID = "brumas-cronos";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const isActiveGM = () => game.user.isGM && (game.users.activeGM?.id ?? game.user.id) === game.user.id;
const on = () => { try { return game.settings.get(ID, "roundPhases") !== false; } catch (e) { return false; } };
const REDUCED = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
const FASES = {
  inicio: { nome: "Início da Rodada", cor: "#d8b45c" },
  turnos: { nome: "Turnos", cor: "#c9615a" },
  fim: { nome: "Fim da Rodada", cor: "#c97a45" },
};
const ORDEM = ["inicio", "turnos", "fim"];
const CORES = ["#c9a24a", "#5fa8a0", "#b8574e", "#8b7ae6", "#6f9cc9", "#a8845a"];
export const faseOf = (cb) => cb?.started ? (cb.getFlag?.(ID, "fase") ?? "turnos") : null;

export function registerRoundSettings() {
  game.settings.register(ID, "roundPhases", { name: "Início e Fim da Rodada no combate", hint: "O rastreador de combate ganha as faixas de Início e Fim da Rodada (com espaço para itens, como ações de covil), a ordem numerada, os grupos e as animações. A iniciativa continua a do sistema.", scope: "world", config: true, type: Boolean, default: true, requiresReload: true });
  game.settings.register(ID, "phaseBanner", { name: "Faixa na tela ao virar a rodada", hint: "Mostra por um instante \"Início da Rodada 2\" ou \"Fim da Rodada 2\" no meio da tela.", scope: "client", config: true, type: Boolean, default: true });
}

/* ================= ordem: combatentes sozinhos e grupos ================= */
const gruposOf = (cb) => { const g = cb?.getFlag?.(ID, "grupos"); return Array.isArray(g) ? g.filter(x => x?.id && x.membros?.length) : []; };
const skipDefeated = () => { try { return !!game.settings.get("core", "combatTrackerConfig")?.skipDefeated; } catch (e) { return false; } };
/** Entidades na ordem da iniciativa: { chave, grupo?, rep, membros }. O grupo age na vez do membro de maior iniciativa. */
export function entidades(cb) {
  const turns = cb?.turns ?? []; const by = new Map(); for (const g of gruposOf(cb)) for (const id of g.membros) by.set(id, g);
  const out = []; const seen = new Set();
  for (const c of turns) { const g = by.get(c.id);
    if (!g) { out.push({ chave: c.id, rep: c, membros: [c] }); continue; }
    if (seen.has(g.id)) continue; seen.add(g.id);
    out.push({ chave: `g:${g.id}`, grupo: g, rep: c, membros: turns.filter(x => by.get(x.id) === g) }); }
  return out;
}
const vivo = (e) => !skipDefeated() || e.membros.some(m => !m.defeated);
const idxDaVez = (cb, E = entidades(cb)) => { const c = cb.combatant; return c ? E.findIndex(e => e.membros.some(m => m.id === c.id)) : -1; };

/* ================= a máquina (embrulha o combate do sistema) ================= */
export function hookRoundPhases() {
  if (!on()) return;
  const C = CONFIG.Combat?.documentClass; const P = C?.prototype; if (!P || P.__cronosFases) return; P.__cronosFases = true;
  const orig = { startCombat: P.startCombat, nextTurn: P.nextTurn, nextRound: P.nextRound, previousTurn: P.previousTurn, previousRound: P.previousRound };
  const viaGM = (cb, action) => { game.socket?.emit(`module.${ID}`, { type: "fase", combatId: cb.id, action, userId: game.user.id }); return cb; };
  const set = (cb, fase, turn) => cb.update({ ...(turn != null ? { turn } : {}), [`flags.${ID}.fase`]: fase });
  const repIdx = (cb, e) => e ? cb.turns.findIndex(t => t.id === e.rep.id) : null;

  P.startCombat = async function (...a) { const r = await orig.startCombat.apply(this, a); if (game.user.isGM) await set(this, "inicio"); return r; };
  P.nextRound = async function (...a) {
    if (!this.started) return orig.nextRound.apply(this, a);
    if (!game.user.isGM) return viaGM(this, "nextRound");
    if (faseOf(this) !== "fim") { await set(this, "fim"); return this; }
    const r = await orig.nextRound.apply(this, a); // o Foundry faz o tempo andar uma rodada aqui
    const E = entidades(this); await set(this, "inicio", repIdx(this, E.find(vivo) ?? E[0])); return r;
  };
  P.nextTurn = async function (...a) {
    if (!this.started) return orig.nextTurn.apply(this, a);
    if (!game.user.isGM) return viaGM(this, "nextTurn");
    const f = faseOf(this); const E = entidades(this);
    if (f === "fim") return this.nextRound();
    if (f === "inicio") { const e = E.find(vivo); if (!e) { await set(this, "fim"); return this; } await set(this, "turnos", repIdx(this, e)); return this; }
    const i = idxDaVez(this, E); const prox = E.slice(i + 1).find(vivo);
    if (!prox) { await set(this, "fim"); return this; }
    await this.update({ turn: repIdx(this, prox) }); return this;
  };
  P.previousTurn = async function (...a) {
    if (!this.started) return orig.previousTurn.apply(this, a);
    if (!game.user.isGM) return this;
    const f = faseOf(this); const E = entidades(this);
    if (f === "fim") { const e = [...E].reverse().find(vivo); await set(this, "turnos", repIdx(this, e)); return this; }
    if (f === "inicio") { if (this.round <= 1) return this; const r = await orig.previousRound.apply(this, a); await set(this, "fim"); return r; }
    const i = idxDaVez(this, E); const ant = E.slice(0, Math.max(0, i)).reverse().find(vivo);
    if (!ant) { await set(this, "inicio", repIdx(this, E.find(vivo) ?? E[0])); return this; }
    await this.update({ turn: repIdx(this, ant) }); return this;
  };
  P.previousRound = async function (...a) {
    if (!this.started || !game.user.isGM) return orig.previousRound.apply(this, a);
    const E = entidades(this);
    if (faseOf(this) !== "inicio") { await set(this, "inicio", repIdx(this, E.find(vivo) ?? E[0])); return this; } // volta ao início desta rodada
    if (this.round <= 1) return this;
    const r = await orig.previousRound.apply(this, a); const E2 = entidades(this); await set(this, "inicio", repIdx(this, E2.find(vivo) ?? E2[0])); return r;
  };
  game.socket?.on(`module.${ID}`, async (m) => {
    if (m?.type !== "fase" || !isActiveGM()) return; const cb = game.combats.get(m.combatId); if (!cb) return;
    const u = game.users.get(m.userId); const dono = cb.combatant?.actor?.testUserPermission?.(u, "OWNER");
    if (!u?.isGM && !dono) return; // jogador só passa a própria vez
    if (m.action === "nextRound") await cb.nextRound(); else if (m.action === "nextTurn") await cb.nextTurn();
  });

  // virada de etapa: faixa na tela e ganchos para outros módulos
  Hooks.on("updateCombat", (cb, ch) => {
    const nf = ch?.flags?.[ID]?.fase; if (!nf || !cb.started) return;
    if (nf === "inicio" || nf === "fim") { banner(nf, cb.round); Hooks.callAll(nf === "inicio" ? "cronosRoundStart" : "cronosRoundEnd", cb, cb.round); autoMacros(cb, nf); }
  });
  Hooks.on("combatStart", (cb) => setTimeout(() => { if (faseOf(cb) === "inicio") banner("inicio", cb.round); }, 300));
  Hooks.on("renderCombatTracker", (app, html) => { try { decorate(app, html instanceof HTMLElement ? html : html?.[0] ?? app.element); } catch (e) { console.warn(`${ID} | rastreador`, e); } });
  Hooks.on("updateScene", (s, ch) => { if (ch?.flags?.[ID] && sceneOf(game.combat)?.id === s.id) ui.combat?.render?.(); });
}

/* ================= itens do Início e do Fim da Rodada (guardados na cena) ================= */
const sceneOf = (cb) => cb?.scene ?? canvas?.scene ?? null;
const itensDe = (cb, tipo) => { const v = sceneOf(cb)?.getFlag?.(ID, "roundItems")?.[tipo]; return Array.isArray(v) ? v : []; };
async function salvarItens(cb, tipo, lista) { const sc = sceneOf(cb); if (!sc || !game.user.isGM) return; const cur = foundry.utils.deepClone(sc.getFlag(ID, "roundItems") ?? {}); cur[tipo] = lista; await sc.setFlag(ID, "roundItems", cur); ui.combat?.render?.(); }
/** Item solto (do diretório ou de um compêndio) não tem quem o use: ele é copiado para um ator de apoio, "Ações da Rodada". */
async function itemNoApoio(src) {
  let a = game.actors.find(x => x.getFlag(ID, "apoio"));
  if (!a) { const type = CONFIG.Actor?.dataModels?.npc || game.system.id === "dnd5e" ? "npc" : (game.documentTypes?.Actor ?? []).find(t => t !== "base") ?? "npc";
    a = await Actor.create({ name: "Ações da Rodada", type, img: "icons/svg/clockwork.svg", flags: { [ID]: { apoio: true } } }); }
  const data = src.toObject(); delete data._id; data.flags = { ...(data.flags ?? {}), [ID]: { origem: src.uuid } };
  let it = a.items.find(i => i.getFlag(ID, "origem") === src.uuid);
  if (it) await it.update({ name: data.name, img: data.img, system: data.system }); else [it] = await a.createEmbeddedDocuments("Item", [data]);
  return a.items.get(it.id) ?? it;
}
/** Macros marcadas como automáticas rodam sozinhas quando a rodada chega à faixa (uma vez por rodada; voltar etapas não repete). */
const jaRodou = new Set();
async function autoMacros(cb, fase) {
  if (!isActiveGM()) return; const k = `${cb.id}|${cb.round}|${fase}`; if (jaRodou.has(k)) return; jaRodou.add(k);
  for (const x of itensDe(cb, fase)) { if (x.kind !== "Macro" || x.auto === false) continue;
    try { const m = await fromUuid(x.uuid); await m?.execute?.({ combat: cb, round: cb.round, fase, cronos: true }); } catch (e) { console.warn(`${ID} | macro da rodada`, e); ui.notifications.warn(`Cronos · a macro "${x.name}" deu erro (veja o console).`); } }
}
async function usarItem(uuid) {
  let it = await fromUuid(uuid); if (!it) return ui.notifications.warn("Cronos · o item não existe mais.");
  if (it.documentName === "Macro") { const cb = game.combat; return it.execute({ combat: cb, round: cb?.round, fase: faseOf(cb), cronos: true }); }
  if (!it.actor && it.documentName === "Item" && game.user.isGM) { try { it = await itemNoApoio(it); } catch (e) { console.warn(`${ID} | ação da rodada`, e); } }
  if (typeof it.use === "function") return it.use();
  if (typeof it.roll === "function") return it.roll();
  return it.sheet?.render(true);
}
/** Efeitos com duração em rodadas que terminam nesta rodada. */
function terminam(cb) {
  const out = [];
  for (const c of cb.combatants) { const a = c.actor; if (!a) continue;
    for (const e of a.appliedEffects ?? a.effects ?? []) { const d = e.duration ?? {}; if (e.disabled || !(d.rounds > 0)) continue;
      if ((d.startRound ?? 0) + d.rounds <= cb.round) out.push(`${c.name}: ${e.name}`); } }
  return out;
}

/* ================= desenho do rastreador ================= */
const abertos = new Set(); const gruposAbertos = new Set();
const posAnt = new Map(); // chave da linha -> posição na última vez (para as linhas deslizarem)
const rodadaVista = new Map(); let virada = null; // { combatId, round, t0 }
const VIRADA_MS = 1700;

function decorate(app, root) {
  if (!root) return; const cb = game.combat; const doc = root.ownerDocument ?? document;
  root.querySelectorAll(".cr-fase-box,.cr-acts,.cr-tempo,.cr-bound,.cr-bound-panel,.cr-grupo-head,.cr-badge").forEach(n => n.remove());
  root.classList.add("cr-tracker");
  const largura = () => root.classList.toggle("cr-wide", root.clientWidth >= 520); largura();
  if (!root._crRO) { const RO = doc.defaultView?.ResizeObserver ?? globalThis.ResizeObserver; if (RO) { root._crRO = new RO(largura); root._crRO.observe(root); } }
  const header = root.querySelector(".combat-tracker-header, header");
  const list = root.querySelector("ol.combat-tracker, #combat-tracker, ol.directory-list, ol.plain");
  const mk = (html) => { const t = doc.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  if (!cb || !cb.started) {
    const box = mk(`<div class="cr-fase-box cr-fase-off"><span class="cr-orn l"></span><div class="cr-fase-centro"><span class="cr-kicker">Gestor de turnos</span><strong class="cr-fase-name">${cb ? "Preparação" : "Fora de combate"}</strong>${cb ? `<span class="cr-fase-sub">Role a iniciativa e comece o combate</span>` : ""}</div><span class="cr-orn r"></span></div>`);
    header ? header.after(box) : root.prepend(box); posAnt.clear(); return;
  }
  const gm = game.user.isGM; const f = faseOf(cb); const fi = FASES[f]; const E = entidades(cb); const iv = idxDaVez(cb, E);
  const agiu = (k) => f === "fim" || (f === "turnos" && k < iv);
  root.classList.toggle("cr-roundphase", f !== "turnos");
  const daVez = f === "turnos" ? E[iv] : null;
  const nomeVez = daVez ? (daVez.grupo ? `${daVez.grupo.nome} (grupo)` : (daVez.rep.isOwner || gm || !daVez.rep.hidden ? daVez.rep.name : "???")) : "";

  // caixa da etapa (no alto)
  const passo = ORDEM.indexOf(f);
  const trilha = ORDEM.map((e, k) => `<span class="cr-pip ${k < passo ? "feito" : ""} ${k === passo ? "atual" : ""}" style="--cp:${FASES[e].cor}" title="${FASES[e].nome}"></span>`).join(`<span class="cr-fio"></span>`);
  const box = mk(`<div class="cr-fase-box" style="--cf:${fi.cor}"><span class="cr-orn l"></span><div class="cr-fase-centro">
    <span class="cr-kicker">Rodada ${cb.round}</span><strong class="cr-fase-name"><span class="cr-sig"></span>${f === "turnos" ? "Turno" : fi.nome}<span class="cr-sig"></span></strong>
    ${daVez ? `<span class="cr-fase-sub">${iv + 1}º a agir · ${esc(nomeVez)}</span>` : ""}<div class="cr-trilha">${trilha}</div></div><span class="cr-orn r"></span></div>`);
  header ? header.after(box) : root.prepend(box);
  if (gm) {
    const prox = { inicio: "Primeira Vez", turnos: E.slice(iv + 1).some(vivo) ? "Passar a Vez" : "Fim da Rodada", fim: "Nova Rodada" }[f];
    box.after(mk(`<div class="cr-acts"><div class="cr-act-grupo"><button type="button" class="cr-act" data-cr-act="voltar-rodada" title="Voltar ao início da rodada (se já estiver nele, à rodada anterior)"><i class="fas fa-backward"></i></button><button type="button" class="cr-act" data-cr-act="voltar" title="Voltar uma etapa"><i class="fas fa-step-backward"></i></button></div>
      <button type="button" class="cr-act" data-cr-act="grupo" title="Formar um grupo (agem juntos, na vez do de maior iniciativa). Tokens selecionados já vêm marcados."><i class="fas fa-people-group"></i></button>
      <button type="button" class="cr-act cr-act-principal" data-cr-act="avancar"><span>${prox}</span><i class="fas fa-step-forward"></i></button></div>`));
  }
  // na etapa de Início ou Fim da Rodada: as ações da rodada à mão, logo abaixo dos botões
  if (f === "inicio" || f === "fim") { const its = itensDe(cb, f).filter(x => gm || (x.show && x.kind !== "Macro"));
    if (its.length) { const ref = root.querySelector(".cr-acts") ?? box;
      ref.after(mk(`<div class="cr-tempo" style="--cf:${fi.cor}"><span class="cr-tempo-tit"><span class="cr-sig"></span>Ações ${f === "inicio" ? "do Início" : "do Fim"} da Rodada</span><div class="cr-tempo-lista">${its.map(x => { const it = fromUuidSync?.(x.uuid); const nome = it?.name ?? x.name ?? "Ação"; const img = it?.img ?? x.img ?? "icons/svg/clockwork.svg";
        return `<button type="button" class="cr-tempo-btn ${x.kind === "Macro" ? "macro" : ""}" data-cr-act="usar" data-uuid="${esc(x.uuid)}" ${gm ? "" : "disabled"} title="${x.kind === "Macro" ? `Rodar de novo: ${esc(nome)}${x.auto !== false ? " (já rodou sozinha)" : ""}` : gm ? `Usar: ${esc(nome)}` : esc(nome)}"><img src="${esc(img || "icons/svg/dice-target.svg")}" alt=""><span>${esc(nome)}</span>${x.kind === "Macro" && x.auto !== false ? `<i class="fas fa-bolt cr-auto"></i>` : ""}</button>`; }).join("")}</div></div>`)); } }
  if (!list) return;

  // linhas: quem vai agir, Fim da Rodada, quem já agiu (cinza). Numeração cronológica.
  const li = (id) => list.querySelector(`li.combatant[data-combatant-id="${id}"]`);
  const primeiro = new Map();
  E.forEach((e, k) => {
    const passado = agiu(k); const vez = daVez === e;
    if (!e.grupo) { const el = li(e.rep.id); if (!el) return; el.classList.toggle("cr-past", passado); el.classList.toggle("cr-vez", vez); el.dataset.crKey = e.chave; primeiro.set(e.chave, el); badge(el, k + 1, passado); return; }
    const g = e.grupo; const els = e.membros.map(m => li(m.id)).filter(Boolean); if (!els.length) return;
    const aberto = vez || gruposAbertos.has(g.id);
    const retratos = e.membros.slice(0, 4).map(m => `<img class="${m.defeated ? "caido" : ""}" src="${esc(m.img || m.actor?.img || "icons/svg/mystery-man.svg")}" alt="">`).join("");
    const dePe = e.membros.filter(m => !m.defeated).length; const ini = e.rep.initiative;
    const head = mk(`<li class="cr-grupo-head ${vez ? "cr-grupo-vez" : ""} ${passado ? "cr-past" : ""} ${aberto ? "aberto" : ""}" data-cr-grupo="${g.id}" data-cr-key="${e.chave}" style="--cg:${g.cor}" title="${aberto ? "Recolher" : "Expandir"} grupo">
      <span class="cr-badge ${passado ? "feito" : ""}">${k + 1}</span><span class="cr-retratos">${retratos}</span>
      <div class="cr-grupo-info"><strong class="cr-grupo-nome"><i class="fas fa-people-group"></i>${esc(g.nome)}</strong><span class="cr-grupo-sub">${dePe}/${e.membros.length} de pé · na vez de ${esc(e.rep.name)}${ini != null ? ` · ${Math.round(ini)}` : ""}</span></div>
      ${gm ? `<button type="button" class="cr-grupo-editar" data-cr-act="grupo" data-grupo="${g.id}" title="Editar o grupo"><i class="fas fa-gear"></i></button>` : ""}<i class="fas fa-chevron-down cr-grupo-chev"></i></li>`);
    els[0].before(head); primeiro.set(e.chave, head);
    for (const el of els) { el.classList.add("cr-membro"); el.classList.toggle("cr-oculto", !aberto); el.classList.toggle("cr-past", passado); el.classList.toggle("cr-vez", vez); el.style.setProperty("--cg", g.cor); el.dataset.crKey = `m:${el.dataset.combatantId}`; }
    // mantém a ordem: membros logo depois do cabeçalho
    let ref = head; for (const el of els) { ref.after(el); ref = el; }
  });
  // reordena: todos na ordem; os que já agiram vão para o fim
  const blocos = E.map((e, k) => ({ k, el: primeiro.get(e.chave), e })).filter(b => b.el);
  const nodesDe = (b) => { const out = [b.el]; if (b.e.grupo) out.push(...b.e.membros.map(m => li(m.id)).filter(Boolean)); return out; };
  const vao = blocos.filter(b => !agiu(b.k)), foram = blocos.filter(b => agiu(b.k));
  for (const b of [...vao, ...foram]) for (const n of nodesDe(b)) list.appendChild(n);

  // faixas do Início e do Fim da Rodada, com os itens
  const faixa = (tipo) => {
    const ativo = f === tipo; const aberto = ativo || abertos.has(tipo); const itens = itensDe(cb, tipo).filter(x => gm || x.show);
    const passou = tipo === "inicio" && f !== "inicio";
    const row = mk(`<li class="cr-bound cr-bound-${tipo} ${ativo ? "ativo" : ""} ${passou ? "passou" : ""} ${aberto ? "aberto" : ""}" data-cr-bound="${tipo}" data-cr-key="b:${tipo}" title="${aberto ? "Recolher" : "Expandir"}">
      <span class="cr-sig"></span><span class="cr-bound-label">${FASES[tipo].nome}</span>${itens.length ? `<span class="cr-bound-n" title="Itens nesta faixa">${itens.length}</span>` : ""}<span class="cr-bound-round">R${cb.round}</span><i class="fas fa-chevron-down cr-bound-chev"></i></li>`);
    if (!aberto) return [row];
    const fx = tipo === "fim" && gm ? terminam(cb) : [];
    const chips = itens.map(x => { const it = fromUuidSync?.(x.uuid); const nome = it?.name ?? x.name ?? "Item"; const img = it?.img ?? x.img ?? (x.kind === "Macro" ? "icons/svg/dice-target.svg" : "icons/svg/item-bag.svg");
      if (x.kind === "Macro") return `<div class="cr-item cr-macro ${ativo ? "pronto" : ""}" data-uuid="${esc(x.uuid)}"><button type="button" class="cr-item-usar" data-cr-act="usar" data-uuid="${esc(x.uuid)}" title="Rodar a macro agora" ${gm ? "" : "disabled"}><img src="${esc(img)}" alt=""><span>${esc(nome)}</span>${x.auto !== false ? `<i class="fas fa-bolt cr-auto" title="Roda sozinha"></i>` : ""}</button>
        ${gm ? `<button type="button" class="cr-item-mini ${x.auto !== false ? "on" : ""}" data-cr-act="auto" data-tipo="${tipo}" data-uuid="${esc(x.uuid)}" title="${x.auto !== false ? "Roda sozinha quando a rodada chega aqui: clique para só rodar à mão" : "Só roda à mão: clique para rodar sozinha"}"><i class="fas fa-bolt"></i></button><button type="button" class="cr-item-mini" data-cr-act="tirar" data-tipo="${tipo}" data-uuid="${esc(x.uuid)}" title="Tirar desta faixa"><i class="fas fa-xmark"></i></button>` : ""}</div>`;
      return `<div class="cr-item ${ativo ? "pronto" : ""}" data-uuid="${esc(x.uuid)}"><button type="button" class="cr-item-usar" data-cr-act="usar" data-uuid="${esc(x.uuid)}" title="${gm || it?.isOwner ? `Usar ${esc(nome)}` : esc(nome)}" ${gm || it?.isOwner ? "" : "disabled"}><img src="${esc(img)}" alt=""><span>${esc(nome)}</span></button>
        ${gm ? `<button type="button" class="cr-item-mini" data-cr-act="ver" data-tipo="${tipo}" data-uuid="${esc(x.uuid)}" title="${x.show ? "Os jogadores veem: clique para esconder" : "Só você vê: clique para mostrar aos jogadores"}"><i class="fas ${x.show ? "fa-eye" : "fa-eye-slash"}"></i></button><button type="button" class="cr-item-mini" data-cr-act="tirar" data-tipo="${tipo}" data-uuid="${esc(x.uuid)}" title="Tirar desta faixa"><i class="fas fa-xmark"></i></button>` : ""}</div>`; }).join("");
    const panel = mk(`<li class="cr-bound-panel cr-bound-panel-${tipo}" data-cr-drop="${tipo}">
      ${chips ? `<div class="cr-itens">${chips}</div>` : gm ? "" : `<span class="cr-vazio">Nada acontece ${tipo === "inicio" ? "no início" : "no fim"} da rodada.</span>`}
      ${gm ? `<div class="cr-drop"><i class="fas fa-hand-pointer"></i> Arraste um item ou uma macro para cá (covil, efeito do lugar…). Macros com ⚡ rodam sozinhas.</div>` : ""}
      ${fx.length ? `<div class="cr-terminam"><span class="cr-panel-title">Terminam agora</span>${fx.map(t => `<span>${esc(t)}</span>`).join("")}</div>` : ""}</li>`);
    return [row, panel];
  };
  const ini = faixa("inicio"); list.prepend(...ini);
  const fim = faixa("fim"); const primPassado = foram[0]?.el; if (primPassado) primPassado.before(...fim); else list.append(...fim);

  // animações: virada de rodada e linhas deslizando para o novo lugar
  const antes = rodadaVista.get(cb.id); rodadaVista.set(cb.id, cb.round);
  if (antes != null && cb.round > antes && f === "inicio") virada = { combatId: cb.id, round: cb.round, t0: performance.now() };
  const linhas = [...list.querySelectorAll("[data-cr-key]")];
  if (!REDUCED()) {
    if (virada?.combatId === cb.id && virada.round === cb.round && performance.now() - virada.t0 < VIRADA_MS) animarVirada(list, performance.now() - virada.t0);
    else for (const el of linhas) { const p = posAnt.get(el.dataset.crKey); if (p == null) continue; const dy = p - el.offsetTop; if (Math.abs(dy) > 2) el.animate?.([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 480, easing: "cubic-bezier(.2,.8,.2,1)" }); }
  }
  posAnt.clear(); for (const el of linhas) posAnt.set(el.dataset.crKey, el.offsetTop);

  // eventos (uma vez por raiz)
  if (!root._crBound) { root._crBound = true;
    root.addEventListener("click", (ev) => onClick(ev, root));
    root.addEventListener("dragover", (ev) => { const z = ev.target.closest?.("[data-cr-drop],[data-cr-bound]"); if (z && game.user.isGM) { ev.preventDefault(); z.classList.add("cr-drop-on"); } });
    root.addEventListener("dragleave", (ev) => ev.target.closest?.("[data-cr-drop],[data-cr-bound]")?.classList.remove("cr-drop-on"));
    root.addEventListener("drop", (ev) => onDrop(ev));
  }
}
function badge(el, n, feito) {
  el.querySelector(".cr-badge")?.remove(); const b = (el.ownerDocument ?? document).createElement("span"); b.className = `cr-badge ${feito ? "feito" : ""}`; b.textContent = n;
  const alvo = el.querySelector(".token-image, img") ; if (alvo) alvo.before(b); else el.prepend(b);
}
function animarVirada(list, dec) {
  const off = `${-Math.round(dec)}ms`; const ini = list.querySelector(".cr-bound-inicio"), fim = list.querySelector(".cr-bound-fim");
  if (ini) { ini.style.setProperty("--cr-off", off); ini.classList.add("cr-virada"); if (dec < 300) { ini.classList.add("como-fim"); ini.querySelector(".cr-bound-label").textContent = "Fim da Rodada"; setTimeout(() => { ini.classList.remove("como-fim"); const l = ini.querySelector(".cr-bound-label"); if (l) l.textContent = "Início da Rodada"; }, 300 - dec); } }
  [...list.querySelectorAll("li.combatant:not(.cr-oculto), li.cr-grupo-head")].forEach((el, i) => { el.style.setProperty("--cr-off", off); el.style.setProperty("--cr-i", i); el.classList.add("cr-sobe"); });
  if (fim) { fim.style.setProperty("--cr-off", off); fim.classList.add("cr-surge"); }
}

async function onClick(ev, root) {
  const cb = game.combat; if (!cb) return;
  const a = ev.target.closest?.("[data-cr-act]");
  if (a) { ev.preventDefault(); ev.stopPropagation(); const act = a.dataset.crAct;
    if (act === "avancar") return cb.nextTurn();
    if (act === "voltar") return cb.previousTurn();
    if (act === "voltar-rodada") return cb.previousRound();
    if (act === "grupo") return dialogoGrupo(cb, a.dataset.grupo ?? null);
    if (act === "usar") return usarItem(a.dataset.uuid);
    if (act === "tirar" || act === "ver" || act === "auto") { const t = a.dataset.tipo; const l = itensDe(cb, t).map(x => ({ ...x }));
      const i = l.findIndex(x => x.uuid === a.dataset.uuid); if (i < 0) return; if (act === "tirar") l.splice(i, 1); else if (act === "auto") l[i].auto = l[i].auto === false; else l[i].show = !l[i].show; return salvarItens(cb, t, l); }
    return; }
  const b = ev.target.closest?.("[data-cr-bound]"); if (b) { const t = b.dataset.crBound; abertos.has(t) ? abertos.delete(t) : abertos.add(t); return ui.combat?.render?.(); }
  const g = ev.target.closest?.("[data-cr-grupo]"); if (g && !ev.target.closest("li.combatant")) { const id = g.dataset.crGrupo; gruposAbertos.has(id) ? gruposAbertos.delete(id) : gruposAbertos.add(id); return ui.combat?.render?.(); }
}
async function onDrop(ev) {
  const z = ev.target.closest?.("[data-cr-drop],[data-cr-bound]"); if (!z || !game.user.isGM) return; ev.preventDefault(); ev.stopPropagation(); z.classList.remove("cr-drop-on");
  const TE = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor; const d = TE?.getDragEventData?.(ev) ?? {};
  if (!["Item", "Macro"].includes(d.type) || !d.uuid) return ui.notifications.warn("Cronos · arraste um item ou uma macro (do diretório, de um compêndio, de uma ficha ou da barra de macros).");
  const it = await fromUuid(d.uuid); const cb = game.combat; const tipo = z.dataset.crDrop ?? z.dataset.crBound; const l = itensDe(cb, tipo).map(x => ({ ...x }));
  if (l.some(x => x.uuid === d.uuid)) return;
  l.push(d.type === "Macro" ? { uuid: d.uuid, kind: "Macro", name: it?.name ?? "Macro", img: it?.img ?? "", show: false, auto: true } : { uuid: d.uuid, name: it?.name ?? "Item", img: it?.img ?? "", show: false });
  abertos.add(tipo); await salvarItens(cb, tipo, l);
}

/* ================= grupos ================= */
async function dialogoGrupo(cb, gid) {
  if (!game.user.isGM) return; const G = gruposOf(cb).map(g => ({ ...g, membros: [...g.membros] })); const g = gid ? G.find(x => x.id === gid) : null;
  const sel = new Set(g ? g.membros : (canvas?.tokens?.controlled ?? []).map(t => cb.combatants.find(c => c.tokenId === t.id)?.id).filter(Boolean));
  const cor0 = g?.cor ?? CORES[G.length % CORES.length];
  const linhas = cb.combatants.contents.map(c => { const outro = G.find(x => x.id !== gid && x.membros.includes(c.id));
    return `<label class="cr-un-membro"><input type="checkbox" name="m" value="${c.id}" ${sel.has(c.id) ? "checked" : ""}><img src="${esc(c.img || c.actor?.img || "icons/svg/mystery-man.svg")}" alt=""><span>${esc(c.name)}</span>${outro ? `<small>sai de ${esc(outro.nome)}</small>` : ""}</label>`; }).join("");
  const content = `<div class="cr-un-form"><label class="cr-un-nome">Nome <input type="text" name="nome" value="${esc(g?.nome ?? "Grupo")}"></label>
    <div class="cr-un-cores">${CORES.map(c => `<label style="--cg:${c}"><input type="radio" name="cor" value="${c}" ${c === cor0 ? "checked" : ""}><span></span></label>`).join("")}</div>
    <p class="cr-un-dica">Agem juntos, na vez do membro de maior iniciativa.</p><div class="cr-un-lista">${linhas}</div></div>`;
  const D = foundry.applications?.api?.DialogV2; if (!D) return;
  const buttons = [{ action: "ok", label: g ? "Salvar" : "Formar grupo", default: true, callback: (e, btn) => btn.form }];
  if (g) buttons.push({ action: "dissolver", label: "Desfazer grupo", callback: () => "dissolver" });
  const r = await D.wait({ window: { title: g ? "Editar grupo" : "Formar grupo" }, content, buttons, rejectClose: false });
  if (!r) return;
  let novos = G;
  if (r === "dissolver") novos = G.filter(x => x.id !== gid);
  else { const fd = new FormData(r); const membros = fd.getAll("m"); const nome = String(fd.get("nome") || "Grupo").trim(); const cor = String(fd.get("cor") || cor0);
    if (membros.length < 2) return ui.notifications.warn("Cronos · um grupo precisa de pelo menos dois combatentes.");
    novos = G.map(x => ({ ...x, membros: x.membros.filter(m => !membros.includes(m) || x.id === gid) })).filter(x => x.membros.length >= 2 || x.id === gid);
    const item = { id: gid ?? foundry.utils.randomID(), nome, cor, membros };
    const i = novos.findIndex(x => x.id === item.id); if (i >= 0) novos[i] = item; else novos.push(item); }
  await cb.update({ [`flags.${ID}.grupos`]: novos });
}

/* ================= faixa na tela ================= */
let bannerT = null;
function banner(f, round) {
  try { if (!game.settings.get(ID, "phaseBanner")) return; } catch (e) { /* */ }
  const fi = FASES[f]; if (!fi) return;
  document.getElementById("cronos-fase-banner")?.remove(); clearTimeout(bannerT);
  const el = document.createElement("div"); el.id = "cronos-fase-banner"; el.className = `f-${f}`; el.style.setProperty("--cf", fi.cor);
  el.innerHTML = `<span class="cfb-kicker">Rodada ${round}</span><strong><span class="cr-sig"></span>${fi.nome}<span class="cr-sig"></span></strong>`;
  document.body.appendChild(el); requestAnimationFrame(() => el.classList.add("show"));
  bannerT = setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 600); }, 2000);
}
