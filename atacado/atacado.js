// ATACADO · ORÇAMENTOS (dono, 29/10/2026 15:35: módulo Atacado, tela Orçamentos; 30/10 12:22 e 12:53: aprovar baixa o estoque da AV).
// Proposta: contexto/propostas-telas/2026-10-29-orcamento-burger-cpf.md (chat Atacado). A conta é toda do banco: a tela nunca manda custo.
// orc_calcular só mostra; orc_salvar grava com o custo do dia; orc_situacao aprova, recusa ou volta a orçado (a baixa e a devolução são do banco).
// O valor por pessoa não leva frete (dono, 30/10): preço dos lanches ÷ pessoas.
const ORC_PAPEIS = ['DONO', 'FINANCEIRO'];
const ORC_SIT = { ORCADO: ['Orçado', 'var(--tx-2)'], APROVADO: ['Aprovado', 'var(--farol-ok)'], RECUSADO: ['Recusado', 'var(--farol-fora)'] };
// o exemplo do dono (45 pessoas, 132%, frete R$ 30), por lanche: muda o número de pessoas e a lista acompanha
const ORC_PADRAO = [['HAMBURGUER DE CARNE RECEITA', 1], ['PAO TRADICIONAL', 1], ['MOZARELA FATIA MP', 0.02], ['ALFACE AMERICANA MP', 0.01], ['TOMATE MP', 0.025],
                    ['PEPINO AGRIDOCE MP', 0.025], ['MOLHO ESPECIAL RECEITA', 0.02], ['MAIONESE HELLMANS MP', 0.02], ['BACON EM CUBOS FRITO RECEITA', 0.03]];
const ORC = { papel: undefined, aba: 'montar', base: null, cliente: '', pessoas: '', lucro: '', frete: '', linhas: [{ item: '', qtd: '', por: 'LANCHE' }], calc: null, erro: null,
              seq: 0, salvando: false, hist: null, itens: {}, aberto: null };
const orcR = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const orcQ = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const orcD = (v) => v ? new Date(String(v).length <= 10 ? v + 'T12:00:00' : v).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit' }) : '';
const orcFonte = (x) => x.custo_fonte === 'NF' ? `NF ${orcD(x.custo_data).slice(0, 5)}` : 'ficha da receita';
const orcPorPessoa = (o) => Number(o.n_lanches) ? Number(o.preco_total) / Number(o.n_lanches) : 0;
const orcEl = (id) => document.getElementById(id);
const ORC_CAMPO = 'padding:7px 9px;border-radius:6px;background:var(--surface-2);color:var(--tx-1);border:1px solid var(--line);font:inherit;font-size:13px;box-sizing:border-box;';

function orcEstilo() {
  if (orcEl('orcEstilo')) return;
  const s = document.createElement('style'); s.id = 'orcEstilo';
  s.textContent = `
    #orcImpressao { display:none; }
    @media print {
      body.orc-imprimindo > *:not(#orcImpressao) { display:none !important; }
      body.orc-imprimindo { background:#fff !important; padding:0 !important; }
      body.orc-imprimindo::before { display:none !important; }
      body.orc-imprimindo #orcImpressao { display:block; color:#000; font-size:13px; }
      #orcImpressao table { width:100%; border-collapse:collapse; }
      #orcImpressao th, #orcImpressao td { color:#000 !important; background:#fff !important; border:1px solid #888; padding:5px 8px; text-align:left; }
      #orcImpressao h3 { color:#000; margin:0 0 10px; }
      #orcImpressao .orc-nao-imprime { display:none; }
    }`;
  document.head.appendChild(s);
}
async function entrarOrcamentos() {
  orcEstilo();
  const v = orcEl('view-orcamentos');
  if (!v) return;
  if (ORC.papel === undefined) {
    v.innerHTML = '<div class="contexto">Lendo…</div>';
    const r = await trRpcSeguro('tr_meu_papel', {});
    ORC.papel = r.ok ? await r.json() : null;
  }
  if (!ORC_PAPEIS.includes(ORC.papel)) { v.innerHTML = '<h2>Orçamentos</h2><div class="contexto">Sem acesso a esta tela.</div>'; return; }
  try {
    if (!ORC.base) ORC.base = await consultarTudo('vw_orc_item_escolha?select=item,un,custo_un,custo_fonte,custo_data,grupo&order=item');
  } catch (e) { v.innerHTML = `<h2>Orçamentos</h2><div class="contexto" style="color:var(--farol-fora);">✗ Não consegui ler a lista de itens: ${trEscH(e.message)}</div>`; return; }
  orcRender();
  if (ORC.aba === 'historico') orcHistorico();
}
function orcTrocarAba(a) { ORC.aba = a; orcRender(); if (a === 'historico') orcHistorico(); }
function orcRender() {
  const v = orcEl('view-orcamentos'); if (!v) return;
  const aba = (k, r) => `<button type="button" onclick="orcTrocarAba('${k}')" style="background:none;border:0;border-bottom:3px solid ${ORC.aba === k ? 'var(--marca-amarelo)' : 'transparent'};padding:8px 12px;cursor:pointer;font:inherit;font-weight:700;color:${ORC.aba === k ? 'var(--tx-1)' : 'var(--tx-3)'};">${r}</button>`;
  v.innerHTML = `<h2>Orçamentos</h2>
    <div style="display:flex;flex-wrap:wrap;gap:2px;border-bottom:1px solid var(--line);margin:0 0 12px;">${aba('montar', 'Montar')}${aba('historico', 'Histórico')}</div>
    <div id="orcCorpo">${ORC.aba === 'montar' ? orcMontarHtml() : orcHistoricoHtml()}</div>
    <datalist id="orcBaseLista">${(ORC.base || []).map((b) => `<option value="${trEscH(b.item)}"></option>`).join('')}</datalist>`;
}

// ---------------------------------------------------------------- Montar
function orcMontarHtml() {
  const rot = 'font-size:12px;color:var(--tx-3);display:block;text-align:left;';
  return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:12px;max-width:820px;">
      <label style="${rot}">Cliente<input style="${ORC_CAMPO}width:100%;" value="${trEscH(ORC.cliente)}" oninput="ORC.cliente=this.value"></label>
      <label style="${rot}">Pessoas<input id="orcPessoas" type="number" min="1" step="1" style="${ORC_CAMPO}width:100%;" value="${trEscH(ORC.pessoas)}" oninput="ORC.pessoas=this.value;orcAgendar()"></label>
      <label style="${rot}">% de lucro<input id="orcLucro" type="number" min="0" step="1" style="${ORC_CAMPO}width:100%;" value="${trEscH(ORC.lucro)}" oninput="ORC.lucro=this.value;orcAgendar()"></label>
      <label style="${rot}">Frete (R$)<input id="orcFrete" type="number" min="0" step="0.01" style="${ORC_CAMPO}width:100%;" value="${trEscH(ORC.frete)}" oninput="ORC.frete=this.value;orcAgendar()"></label>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
      <button type="button" class="preset-btn" onclick="orcMaisItem()">+ item</button>
      <button type="button" class="preset-btn" onclick="orcPadrao()">Burger padrão</button>
    </div>
    <div id="tabelaOrcItens"><table><thead><tr><th>Item</th><th style="text-align:right;">Quantidade</th><th>Por</th><th style="text-align:right;">Total</th><th style="text-align:right;">Custo do item</th><th>Origem</th><th style="text-align:right;">Custo</th><th></th></tr></thead>
      <tbody>${ORC.linhas.map(orcLinhaHtml).join('')}</tbody></table></div>
    <div id="orcTotais" style="margin-top:12px;">${orcTotaisHtml()}</div>`;
}
function orcLinhaHtml(l, i) {
  return `<tr id="orcL${i}">
      <td style="min-width:260px;"><input list="orcBaseLista" style="${ORC_CAMPO}width:100%;" value="${trEscH(l.item)}" placeholder="buscar na base" onchange="orcLinha(${i},'item',this.value)"></td>
      <td style="text-align:right;"><input type="number" min="0" step="0.001" style="${ORC_CAMPO}width:90px;text-align:right;" value="${trEscH(l.qtd)}" oninput="orcLinha(${i},'qtd',this.value)"></td>
      <td><select style="${ORC_CAMPO}" onchange="orcLinha(${i},'por',this.value)"><option value="LANCHE"${l.por === 'LANCHE' ? ' selected' : ''}>por lanche</option><option value="TOTAL"${l.por === 'TOTAL' ? ' selected' : ''}>total</option></select></td>
      <td class="orc-c1" style="text-align:right;"></td><td class="orc-c2" style="text-align:right;"></td><td class="orc-c3" style="font-size:12px;color:var(--tx-3);"></td><td class="orc-c4" style="text-align:right;"></td>
      <td><button type="button" class="preset-btn" title="Tirar a linha" onclick="orcTirar(${i})">×</button></td></tr>`;
}
function orcValida(l) { return l.item && Number(l.qtd) > 0 && (ORC.base || []).some((b) => b.item === l.item); }
function orcLinha(i, campo, valor) { ORC.linhas[i][campo] = valor; orcAgendar(); }
function orcMaisItem() { ORC.linhas.push({ item: '', qtd: '', por: 'LANCHE' }); orcRender(); orcPintar(); }
function orcTirar(i) { ORC.linhas.splice(i, 1); if (!ORC.linhas.length) ORC.linhas.push({ item: '', qtd: '', por: 'LANCHE' }); orcRender(); orcAgendar(); }
function orcPadrao() {
  ORC.linhas = ORC_PADRAO.map(([item, qtd]) => ({ item, qtd: String(qtd), por: 'LANCHE' }));
  if (!ORC.pessoas) ORC.pessoas = '45';
  if (!ORC.lucro) ORC.lucro = '132';
  if (!ORC.frete) ORC.frete = '30';
  orcRender(); orcAgendar();
}
function orcItensDe() { return ORC.linhas.filter(orcValida).map((l) => ({ item: l.item, qtd: Number(l.qtd), por: l.por })); }
// a prévia leva quase 2 s: só quando a pessoa para de digitar
function orcAgendar() { clearTimeout(orcAgendar._t); orcAgendar._t = setTimeout(orcCalcular, 500); }
async function orcCalcular() {
  const itens = orcItensDe(), n = Number(ORC.pessoas);
  const seq = ++ORC.seq;
  if (!itens.length || !(n > 0)) { ORC.calc = null; ORC.erro = null; orcPintar(); return; }
  const tot = orcEl('orcTotais'); if (tot) tot.style.opacity = '.55';
  const r = await trRpcSeguro('orc_calcular', { p_n_lanches: n, p_pct_lucro: Number(ORC.lucro) || 0, p_itens: itens, p_frete: Number(ORC.frete) || 0 });
  if (seq !== ORC.seq) return;
  if (r.ok) { ORC.calc = await r.json(); ORC.erro = null; } else { ORC.calc = null; ORC.erro = await trErroDe(r); }
  orcPintar();
}
function orcPintar() {
  if (ORC.aba !== 'montar') return;
  let k = 0;
  ORC.linhas.forEach((l, i) => {
    const tr = orcEl('orcL' + i); if (!tr) return;
    const ok = orcValida(l), x = ok && ORC.calc && (ORC.calc.itens || [])[k];
    if (ok) k++;
    const foraDaBase = l.item && !(ORC.base || []).some((b) => b.item === l.item);
    tr.querySelector('.orc-c1').textContent = x ? `${orcQ(x.qtd_total)} ${x.un}` : '';
    tr.querySelector('.orc-c2').textContent = x ? `${orcR(x.custo_un)}/${x.un}` : '';
    tr.querySelector('.orc-c3').textContent = x ? orcFonte(x) : foraDaBase ? 'fora da base' : '';
    tr.querySelector('.orc-c3').style.color = foraDaBase ? 'var(--farol-fora)' : '';
    tr.querySelector('.orc-c4').textContent = x ? orcR(x.custo_linha) : '';
  });
  const t = orcEl('orcTotais');
  if (t) { t.style.opacity = ''; t.innerHTML = orcTotaisHtml(); }
}
function orcTotaisHtml() {
  const c = ORC.calc, card = (r, v, cl) => `<div class="card ${cl || 'neutral'}"><div class="card-lbl">${r}</div><div class="card-val">${c ? orcR(v) : '–'}</div></div>`;
  return `<div class="cards">${card('Custo', c && c.custo_total)}${card('Lucro', c && c.lucro)}${card('Frete', c && c.frete)}${card('Total ao cliente', c && c.total_cliente, 'blue')}${card('Por pessoa, sem frete', c && c.por_pessoa)}</div>
    ${ORC.erro ? `<div class="contexto" style="color:var(--farol-fora);text-align:left;">✗ ${trEscH(ORC.erro)}</div>` : ''}
    <button type="button" class="preset-btn active" style="font-size:14px;padding:10px 18px;"${ORC.salvando ? ' disabled' : ''} onclick="orcSalvar()">Salvar orçamento</button>`;
}
async function orcSalvar() {
  if (ORC.salvando) return;
  const itens = orcItensDe(), n = Number(ORC.pessoas);
  const fora = ORC.linhas.filter((l) => (l.item || l.qtd) && !orcValida(l));
  if (!(n > 0)) return avisoAcao('atencao', '! Informe o número de pessoas.');
  if (!itens.length) return avisoAcao('atencao', '! Coloque ao menos um item da base com quantidade.');
  if (fora.length) return avisoAcao('atencao', `! Corrija ou tire: ${fora.map((l) => l.item || 'linha sem item').join(', ')}.`);
  ORC.salvando = true; orcPintar();
  avisoAcao('enviando', 'Salvando o orçamento…');
  const r = await trRpcSeguro('orc_salvar', { p_cliente: ORC.cliente.trim() || null, p_n_lanches: n, p_pct_lucro: Number(ORC.lucro) || 0, p_itens: itens, p_obs: null, p_frete: Number(ORC.frete) || 0 });
  ORC.salvando = false;
  if (!r.ok) { orcPintar(); return avisoAcao('erro', `✗ Não salvou: ${await trErroDe(r)}.`, orcSalvar); }
  const id = await r.json();
  avisoAcao('ok', `✓ Orçamento nº ${id} salvo — às ${avisoHora()}.`);
  Object.assign(ORC, { cliente: '', pessoas: '', lucro: '', frete: '', linhas: [{ item: '', qtd: '', por: 'LANCHE' }], calc: null, erro: null, aba: 'historico', aberto: Number(id) });
  orcRender(); orcHistorico();
}

// ---------------------------------------------------------------- Histórico
async function orcHistorico() {
  try {
    ORC.hist = await consultarTudo('orc_orcamento?select=id,tipo,cliente,n_lanches,pct_lucro,custo_total,preco_total,frete,total_cliente,situacao,criado_por,criado_em,aprovado_em,aprovado_por&order=id.desc');
    ORC.erroHist = null;
  } catch (e) { ORC.erroHist = e.message; }
  if (ORC.aberto && !ORC.itens[ORC.aberto]) await orcLerItens(ORC.aberto);
  if (ORC.aba === 'historico') orcRender();
}
async function orcLerItens(id) {
  ORC.itens[id] = await consultarTudo(`orc_orcamento_item?select=ordem,item,un,qtd_total,custo_un,custo_fonte,custo_data,custo_linha&orcamento_id=eq.${Number(id)}&order=ordem`).catch(() => []);
}
async function orcAbrir(id) {
  ORC.aberto = ORC.aberto === id ? null : id;
  if (ORC.aberto && !ORC.itens[id]) await orcLerItens(id);
  orcRender();
}
function orcHistoricoHtml() {
  if (ORC.erroHist) return `<div class="contexto" style="color:var(--farol-fora);">✗ Não consegui ler o histórico: ${trEscH(ORC.erroHist)}</div>`;
  if (!ORC.hist) return '<div class="contexto">Lendo…</div>';
  if (!ORC.hist.length) return '<div class="contexto">Nenhum orçamento salvo.</div>';
  const dir = 'style="text-align:right;"';
  return `<div id="tabelaOrcHist"><table><thead><tr><th>Nº</th><th>Data</th><th>Quem</th><th>Cliente</th><th ${dir}>Pessoas</th><th ${dir}>% lucro</th><th ${dir}>Custo</th><th ${dir}>Frete</th><th ${dir}>Total ao cliente</th><th ${dir}>Por pessoa</th><th>Situação</th></tr></thead><tbody>
    ${ORC.hist.map((o) => { const s = ORC_SIT[o.situacao] || [o.situacao, 'var(--tx-3)'];
      return `<tr style="cursor:pointer;${ORC.aberto === o.id ? 'background:var(--surface-2);' : ''}" onclick="orcAbrir(${o.id})"><td>${o.id}</td><td>${orcD(o.criado_em)}</td><td>${trEscH(String(o.criado_por || '').split('@')[0])}</td><td>${trEscH(o.cliente || '')}</td>
        <td ${dir}>${o.n_lanches}</td><td ${dir}>${orcQ(o.pct_lucro)}%</td><td ${dir}>${orcR(o.custo_total)}</td><td ${dir}>${orcR(o.frete)}</td><td ${dir}>${orcR(o.total_cliente)}</td><td ${dir}>${orcR(orcPorPessoa(o))}</td>
        <td style="color:${s[1]};font-weight:700;">${s[0]}</td></tr>
        ${ORC.aberto === o.id ? `<tr><td colspan="11" style="white-space:normal;cursor:default;" onclick="event.stopPropagation()">${orcDetalheHtml(o)}</td></tr>` : ''}`; }).join('')}
    </tbody></table></div>`;
}
function orcBotaoSit(o, sit, rot, forte) { return o.situacao === sit ? '' : `<button type="button" class="preset-btn${forte ? ' active' : ''}" onclick="orcSituacao(${o.id}, '${sit}')">${rot}</button>`; }
function orcSeparacaoHtml(o) {
  const L = ORC.itens[o.id] || [];
  return `<h3 style="margin:0 0 8px;font-size:15px;">Lista de separação · orçamento nº ${o.id}</h3>
    <table><thead><tr><th>Item</th><th style="text-align:right;">Quantidade</th><th>Un</th></tr></thead>
    <tbody>${L.map((x) => `<tr><td>${trEscH(x.item)}</td><td style="text-align:right;">${orcQ(x.qtd_total)}</td><td>${trEscH(x.un)}</td></tr>`).join('')}</tbody></table>`;
}
function orcClienteHtml(o) {
  const lin = (r, v, b) => `<tr><td>${b ? `<b>${r}</b>` : r}</td><td style="text-align:right;">${b ? `<b>${v}</b>` : v}</td></tr>`;
  return `<h3 style="margin:0 0 8px;font-size:15px;">Orçamento nº ${o.id}${o.cliente ? ' · ' + trEscH(o.cliente) : ''}</h3>
    <table><tbody>${lin('Pessoas', o.n_lanches)}${lin('Lanches', orcR(o.preco_total))}${Number(o.frete) ? lin('Frete', orcR(o.frete)) : ''}${lin('Total', orcR(o.total_cliente), true)}${lin('Valor por pessoa, sem frete', orcR(orcPorPessoa(o)))}</tbody></table>
    <div style="margin-top:6px;font-size:12px;">${orcD(o.criado_em)}</div>`;
}
function orcDetalheHtml(o) {
  const L = ORC.itens[o.id] || [];
  return `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:4px 0 12px;">
      ${orcBotaoSit(o, 'APROVADO', 'Aprovar', true)}${orcBotaoSit(o, 'RECUSADO', 'Recusar')}${orcBotaoSit(o, 'ORCADO', 'Voltar para orçado')}
      ${o.situacao === 'APROVADO' && o.aprovado_em ? `<span style="font-size:12px;color:var(--tx-3);">aprovado em ${orcD(o.aprovado_em)}${o.aprovado_por ? ' por ' + trEscH(String(o.aprovado_por).split('@')[0]) : ''}</span>` : ''}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px;align-items:start;">
      <div>${orcSeparacaoHtml(o)}<div style="margin-top:8px;"><button type="button" class="preset-btn" onclick="orcImprimir(${o.id},'separacao')">🖨 Imprimir a lista</button></div></div>
      <div>${orcClienteHtml(o)}<div style="margin-top:8px;"><button type="button" class="preset-btn" onclick="orcImprimir(${o.id},'cliente')">🖨 Imprimir o orçamento</button></div></div>
      <div><h3 style="margin:0 0 8px;font-size:15px;">Custo do dia</h3><table><thead><tr><th>Item</th><th style="text-align:right;">Custo do item</th><th>Origem</th><th style="text-align:right;">Custo</th></tr></thead>
        <tbody>${L.map((x) => `<tr><td>${trEscH(x.item)}</td><td style="text-align:right;">${orcR(x.custo_un)}/${trEscH(x.un)}</td><td style="font-size:12px;">${orcFonte(x)}</td><td style="text-align:right;">${orcR(x.custo_linha)}</td></tr>`).join('')}</tbody>
        <tfoot><tr class="sub"><td colspan="3">Custo</td><td style="text-align:right;">${orcR(o.custo_total)}</td></tr></tfoot></table></div>
    </div>`;
}
function orcImprimir(id, qual) {
  const o = (ORC.hist || []).find((x) => x.id === id); if (!o) return;
  let p = orcEl('orcImpressao');
  if (!p) { p = document.createElement('div'); p.id = 'orcImpressao'; document.body.appendChild(p); }
  p.innerHTML = qual === 'separacao' ? orcSeparacaoHtml(o) : orcClienteHtml(o);
  document.body.classList.add('orc-imprimindo');
  const fim = () => { document.body.classList.remove('orc-imprimindo'); window.removeEventListener('afterprint', fim); };
  window.addEventListener('afterprint', fim);
  window.print();
}
async function orcSituacao(id, sit) {
  const ok = { APROVADO: 'Aprovado: a lista de separação sai do estoque da AV', RECUSADO: 'Recusado', ORCADO: 'Voltou para orçado' }[sit];
  avisoAcao('enviando', 'Mudando a situação…');
  const r = await trRpcSeguro('orc_situacao', { p_id: id, p_situacao: sit });
  if (!r.ok) return avisoAcao('erro', `✗ Não mudou: ${await trErroDe(r)}.`, () => orcSituacao(id, sit));
  const o = (ORC.hist || []).find((x) => x.id === id), tinhaBaixa = o && o.situacao === 'APROVADO';
  avisoAcao('ok', `✓ ${ok}${sit !== 'APROVADO' && tinhaBaixa ? '; a baixa do estoque foi desfeita' : ''} — às ${avisoHora()}.`);
  await orcHistorico();
}
