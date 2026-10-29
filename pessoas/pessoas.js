// Pessoas (RH) do painel Cidadão do Mundo: Reembolsos, Pagamento fora da folha, Cargos e salários (VT/VA, folha,
// adiantamento, bonificação), Correções na Flash e Descontos em folha. Saiu de docs/dashboard.html em 26/10/2026 (bloco 4
// do painel em módulos): MOVIDO, não copiado, em três trechos aqui em sequência. Carregado pelo dashboard.html e por
// docs/pessoas/index.html, depois do nucleo.js (consultarTudo, fmt, rmbSessao, rmbFazerLogin, ffDdmm, trFetch, trRpc,
// souODono). mostrarModulo é de cada página. Dado pessoal: quem lê o quê decide o banco (frente RH conferiu em 26/10).
// Quem mexe aqui: o chat "Telas do painel"; os dados são da frente RH.

// ------------------------------------------------------------------
// MODULO REEMBOLSOS (aplicado da fila em 16/08/2026). O pagamento ja
// vinha do Saipos; o que nao existia era a FILA — quanto a empresa deve
// agora e ha quantos dias. Fonte: vw_rmb_*. A ESCRITA (lancar gasto,
// foto da nota, aprovar) usa login individual do Supabase: policies no
// banco decidem quem pode o que (o status de nascimento e do gatilho,
// nao do navegador). anon segue so leitura. Pre-requisito: os 4 usuarios
// criados no Supabase e rmb_pessoas.email preenchido (REEMBOLSOS-PAINEL.md).
let REEMBOLSOS = null;
const RMB_SUBTIPOS = ['TAXAS COZINHA', 'MOTOBOY', 'TAXAS SALAO', 'SISTEMA DE GESTAO',
                      'USO E CONSUMO', 'MANUTENCAO', 'DESPESAS ADMINISTRATIVAS'];
// 26/10/2026: EMAIL_DONO, carregarEmailDono e souODono moram no nucleo.js (o Caixa usa, o painel também).



function rmbSair() { localStorage.removeItem('rmbSessao'); renderModuloReembolsos(REEMBOLSOS); }

// Cada modulo trata o pos-login do seu jeito. A funcao compartilhada so
// autentica e devolve true/false.
async function reembolsosLogin() {
  if (!(await rmbFazerLogin())) return;   // o erro ja esta escrito na tela
  await entrarReembolsos();
}





async function rmbEnviarGasto() {
  const msg = document.getElementById('rmbFormMsg');
  const pessoa = document.getElementById('rmbPessoa').value;
  const data = document.getElementById('rmbData').value;
  const valor = Number(String(document.getElementById('rmbValor').value).replace(',', '.'));
  const descricao = document.getElementById('rmbDesc').value.trim();
  const subtipo = document.getElementById('rmbSubtipo').value || null;
  const arquivo = document.getElementById('rmbNota').files[0] || null;
  if (!pessoa || !data || !valor || !descricao) {
    msg.textContent = 'Preencha quem, quando, quanto e o que foi.'; msg.style.display = 'block'; return;
  }
  msg.textContent = 'Enviando...'; msg.style.display = 'block';
  try {
    let caminho = null;
    if (arquivo) {
      caminho = `${pessoa}/${Date.now()}-${arquivo.name.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
      let up = await fetch(`${SUPABASE_URL}/storage/v1/object/comprovantes/${caminho}`, {
        method: 'POST',
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${rmbSessao().access_token}` },
        body: arquivo,
      });
      if (await rmbRenovarSeExpirado(up)) {
        up = await fetch(`${SUPABASE_URL}/storage/v1/object/comprovantes/${caminho}`, {
          method: 'POST',
          headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${rmbSessao().access_token}` },
          body: arquivo,
        });
      }
      if (!up.ok) throw new Error('a foto da nota não subiu (' + up.status + ')');
    }
    let r = await fetch(`${SUPABASE_URL}/rest/v1/rmb_gastos`, {
      method: 'POST',
      headers: rmbHeaders({ Prefer: 'return=minimal' }),
      body: JSON.stringify({ pessoa, data_gasto: data, valor, descricao, subtipo,
                             unidade: 'AGUA VERDE', comprovante_url: caminho, origem: 'PAINEL' }),
    });
    if (await rmbRenovarSeExpirado(r)) {
      r = await fetch(`${SUPABASE_URL}/rest/v1/rmb_gastos`, {
        method: 'POST', headers: rmbHeaders({ Prefer: 'return=minimal' }),
        body: JSON.stringify({ pessoa, data_gasto: data, valor, descricao, subtipo,
                               unidade: 'AGUA VERDE', comprovante_url: caminho, origem: 'PAINEL' }),
      });
    }
    if (!r.ok) throw new Error((await r.text()).slice(0, 160));
    REEMBOLSOS = null;
    await entrarReembolsos();
  } catch (e) {
    msg.textContent = 'Não gravou: ' + e.message + ' — o banco recusa gasto lançado em nome de outra pessoa (só o Neto pode).';
    msg.style.display = 'block';
  }
}

async function rmbDecidir(id, status) {
  let r = await fetch(`${SUPABASE_URL}/rest/v1/rmb_gastos?id=eq.${id}`, {
    method: 'PATCH',
    headers: rmbHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify({ status, aprovado_por: 'NETO', aprovado_em: new Date().toISOString() }),
  });
  if (await rmbRenovarSeExpirado(r)) {
    r = await fetch(`${SUPABASE_URL}/rest/v1/rmb_gastos?id=eq.${id}`, {
      method: 'PATCH', headers: rmbHeaders({ Prefer: 'return=minimal' }),
      body: JSON.stringify({ status, aprovado_por: 'NETO', aprovado_em: new Date().toISOString() }),
    });
  }
  if (!r.ok) { alert('Não gravou a decisão — só o dono aprova (policy do banco).'); return; }
  REEMBOLSOS = null;
  await entrarReembolsos();
}

async function rmbVerNota(caminho) {
  const s = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/comprovantes/${caminho}`, {
    method: 'POST', headers: rmbHeaders(), body: JSON.stringify({ expiresIn: 3600 }),
  });
  const d = await s.json();
  if (d.signedURL) window.open(`${SUPABASE_URL}/storage/v1${d.signedURL}`, '_blank');
  else alert('Não consegui abrir a nota (o bucket é privado — precisa estar logado).');
}

async function carregarReembolsos() {
  const [saldo, fila, orfaos] = await Promise.all([
    consultarTudo('vw_rmb_saldo_pessoa?select=*&order=a_receber.desc'),
    consultarTudo('vw_rmb_fila?select=*&order=data_gasto.asc'),
    consultarTudo('vw_rmb_sem_registro?select=debito'),
  ]);
  return { saldo, fila, orfaos };
}

// ------------------------------------------------------------------
// Cartao & maquininha (Rede, adquirente do Itau). Fonte: API da Rede em
// producao, lida pela nossa conciliadora VICENTE E IKOMA. Ligado ao painel em
// 18/08/2026 — o que a rede paga de MDR e de aluguel de maquininha, por loja e
// por bandeira, direto da fonte. Views: vw_rede_taxas_efetivas (venda x MDR) e
// vw_rede_aluguel (cobranca de aluguel por loja/mes). Ambas ja medidas seguras
// no timeout de 3s do anon (rede_vendas ~15k linhas, nada perto de fato_pedidos).
// 26/10/2026: o mergulho do dia do Fechamento de Caixas (conciliação de cartão) mora em docs/caixa/caixa.js.


async function entrarReembolsos() {
  const alvo = document.getElementById('view-reembolsos');
  if (!alvo) return;
  await carregarEmailDono();   // decide se aparecem os botoes de aprovar
  if (REEMBOLSOS === null) {
    alvo.innerHTML = '<div class="contexto">Carregando os reembolsos...</div>';
    REEMBOLSOS = await carregarReembolsos();
  }
  renderModuloReembolsos(REEMBOLSOS);
}

function renderModuloReembolsos(dados) {
  const { saldo, fila, orfaos } = dados || {};   // aceita nulo: ver bug do login de 21/08
  const alvo  = document.getElementById('view-reembolsos');
  if (!alvo) return;
  const reais = (v) => 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits:2, maximumFractionDigits:2 });
  const ddmm  = (d) => new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' });
  const sessao = rmbSessao();
  const souDono = souODono();

  const totalAberto = saldo.reduce((a, p) => a + Number(p.a_receber), 0);
  const orfaoValor  = orfaos.reduce((a, l) => a + Number(l.debito), 0);

  // Um card por pessoa: quanto devemos e ha quantos dias espera.
  const cards = saldo.map(p => {
    const dias = p.espera_mais_antiga_dias;
    // a cor e fato (esta esperando ha muito), nao julgamento
    const cor = dias == null ? '#8a897e' : dias > 30 ? '#ff6b6b' : dias > 15 ? '#f5a623' : '#3fb950';
    return `<div class="card" style="border:1px solid ${cor};">
      <div style="font-size:12px; color:#a5a49a; text-transform:uppercase;">${p.pessoa}</div>
      <div style="font-size:26px; font-weight:700;">${reais(p.a_receber)}</div>
      <div style="font-size:12px; color:#a5a49a;">${
        Number(p.a_receber) === 0 ? 'nada em aberto'
        : `${p.gastos_em_aberto} gasto${p.gastos_em_aberto > 1 ? 's' : ''} · o mais antigo espera <b style="color:${cor};">${dias} dias</b>`
      }</div>
      <div style="font-size:11px; color:#8a897e; margin-top:4px;">já devolvido: ${reais(p.ja_reembolsado_total)}</div>
    </div>`;
  }).join('');

  const linhas = fila.map(g => {
    const badge  = { PENDENTE:'#f5a623', APROVADO:'#3fb950', REVISAR:'#ff6b6b' }[g.status] || '#8a897e';
    const rotulo = { PENDENTE:'esperando você', APROVADO:'pode pagar', REVISAR:'revisar' }[g.status] || g.status;
    // Aprovar/recusar saiu em 21/08/2026 junto com as regras do banco: o modulo
    // volta ao assunto mais para a frente, com o desenho refeito. Deixar o botao
    // sem a policy por tras so entregaria erro a quem clicasse. (souDono segue
    // calculado porque o resto da tela usa.)
    const acoes = '';
    return `<tr>
      <td style="padding:5px 8px; color:#a5a49a;">${ddmm(g.data_gasto)}</td>
      <td style="padding:5px 8px;">${g.pessoa}</td>
      <td style="padding:5px 8px;">${g.descricao}</td>
      <td style="padding:5px 8px; color:#a5a49a;">${g.subtipo || 'sem classificação'}</td>
      <td style="padding:5px 8px; text-align:right; font-weight:600;">${reais(g.valor)}</td>
      <td style="padding:5px 8px; text-align:right; color:#a5a49a;">${g.dias_esperando} d</td>
      <td style="padding:5px 8px;"><span style="color:${badge}; border:1px solid ${badge}; border-radius:12px; padding:2px 8px; font-size:11px;">${rotulo}</span>${acoes}</td>
      <td style="padding:5px 8px;">${g.comprovante_url
        ? (sessao ? `<a href="javascript:void(0)" onclick="rmbVerNota('${g.comprovante_url}')" style="color:#a5a49a;">nota</a>`
                  : '<span style="color:#8a897e;" title="entre para ver">nota 🔒</span>')
        : '<span style="color:#8a897e;">sem nota</span>'}</td>
    </tr>`;
  }).join('');

  const hoje = new Date().toISOString().slice(0, 10);
  const blocoEntrar = sessao
    ? `<div class="contexto" style="text-align:left;">
        logado como <b>${sessao.email}</b> · <a href="javascript:void(0)" onclick="rmbSair()" style="color:#a5a49a;">sair</a>
        <div class="contexto" style="border-color:#e8b04b; margin-top:10px;">
          <b>Lançamento pausado.</b> As regras de quem lança e de quem aprova saíram do banco
          em 21/08/2026, a pedido do dono — elas foram desenhadas antes de o painel ter login
          por pessoa. O módulo segue mostrando a fila e o histórico; lançar volta quando o
          assunto for retomado. Enquanto isso, gasto novo entra pelo importador, como sempre
          entrou.</div>
      </div>`
    : `<div class="contexto" style="text-align:left;">
        <a href="javascript:void(0)" onclick="document.getElementById('rmbLoginBox').style.display='block'; this.style.display='none';" style="color:#a5a49a;">Entrar para lançar um gasto ou ver as notas →</a>
        <div id="rmbLoginBox" style="display:none; margin-top:8px;">
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <input id="rmbEmail" type="email" placeholder="e-mail" style="flex:1; min-width:180px; background:#232321; border:1px solid #34332f; color:#fff; border-radius:8px; padding:8px;">
            <input id="rmbSenha" type="password" placeholder="senha" style="flex:1; min-width:140px; background:#232321; border:1px solid #34332f; color:#fff; border-radius:8px; padding:8px;">
            <button onclick="reembolsosLogin()" style="background:#c8102e; border:none; color:#fff; font-weight:700; border-radius:8px; padding:8px 18px; cursor:pointer;">Entrar</button>
          </div>
          <div id="rmbLoginErro" style="display:none; color:#ff6b6b; font-size:12px; margin-top:6px;"></div>
        </div>
      </div>`;

  alvo.innerHTML = `
    <div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">Reembolsos</div>
    <div class="caption-label" style="text-align:center;">
      Quanto a empresa deve para quem gastou do próprio bolso, e há quanto tempo essa pessoa espera.
    </div>
    ${blocoEntrar}
    <div class="cards">${cards}</div>
    ${totalAberto > 0
      ? `<div class="caption-label" style="text-align:center;">Em aberto agora: <b>${reais(totalAberto)}</b>.</div>`
      : `<div class="caption-label" style="text-align:center;">Nada em aberto — todo reembolso registrado já foi devolvido.</div>`}
    ${linhas ? `
      <div class="section-label">A fila</div>
      <table style="width:100%; font-size:13px;">
        <tr style="color:#8a897e; font-size:11px; text-transform:uppercase;">
          <td style="padding:5px 8px;">gasto em</td><td style="padding:5px 8px;">quem</td>
          <td style="padding:5px 8px;">o que foi</td><td style="padding:5px 8px;">categoria</td>
          <td style="padding:5px 8px; text-align:right;">valor</td>
          <td style="padding:5px 8px; text-align:right;">esperando</td>
          <td style="padding:5px 8px;">situação</td><td style="padding:5px 8px;">comprovante</td>
        </tr>${linhas}
      </table>` : ''}
    ${orfaoValor > 0 ? `
      <div class="contexto" style="border-color:#f5a623;">
        <b>${orfaos.length} pagamentos de reembolso (${reais(orfaoValor)}) apareceram no financeiro sem passar pela fila.</b>
        Ou é uma pessoa ainda não cadastrada, ou alguém foi pago por fora do combinado —
        conferir antes de concluir. Cadastrar é um INSERT em <code>rmb_pessoas</code>.
      </div>` : ''}
    <div class="caption-label">A <b>Jane</b> também tem crédito no módulo <a href="javascript:void(0)" onclick="mostrarModulo('rh')" style="color:#a5a49a;">Descontos em folha</a>
    (dinheiro que ela emprestou a funcionários) — são dívidas de origens diferentes e não estão somadas aqui.</div>`;
}

// ------------------------------------------------------------------
// MODULO DESCONTOS EM FOLHA (aplicado da fila em 16/08/2026).
// Vales e emprestimos que a empresa adianta ao funcionario e recupera
// no contracheque. Fonte: tabelas rh_* (planilha GASTOS FUNCIONARIOS
// DESCONTAR, aba Base). A tela responde tres perguntas, nesta ordem:
// quanto sai da proxima folha, quanto devemos a quem emprestou do
// bolso, e o que esta travado.
// ------------------------------------------------------------------
let RH = null;
// Pessoa fixada (12/09/2026): a tela era a unica do grupo sem nenhuma interacao —
// cinco tabelas empilhadas que nao conversam, e para saber tudo de uma pessoa
// cruzava-se quatro listas com o olho. Clicar num nome recorta a tela nele, clicar
// de novo solta. A lista de nomes fica INTEIRA de proposito: e por ela que se troca
// de pessoa. Mesmo mecanismo do modulo evolucao.
let RH_PESSOA = null;
// O nome vai por INDICE, nunca como string dentro do onclick: nome com apostrofo
// quebraria o atributo em silencio.
let RH_NOMES = [];
function rhFixar(i) {
  const nome = RH_NOMES[i];
  if (!nome) return;
  RH_PESSOA = (RH_PESSOA === nome) ? null : nome;
  renderModuloRh();
}
function rhSoltar() { RH_PESSOA = null; renderModuloRh(); }


// ===== PAGAMENTO FORA DA FOLHA (04/09/2026) =====
// Quem fica um tempo sem registro recebe por calculo proprio: adiantamento no
// dia 20 (ou o dia util anterior) e o saldo no 5o dia util do mes seguinte.
// Parametros da pessoa em rh_ff_pessoas; o que muda por mes (gratificacao do
// salao, ajuste) em rh_ff_meses — e a Hellen quem informa; a baixa fica em
// rh_ff_pagamentos. As parcelas em aberto entram sozinhas no Fluxo projetado
// (vw_fin_contas_pagar). Le e grava como a pessoa logada: RLS pode_ver_pessoal
// (Neto, Fabio, Hellen); quem nao tem acesso ve a tela vazia.
let FF = null;
async function entrarForaFolha() {
  const alvo = document.getElementById('view-forafolha');
  if (!alvo) return;
  if (!FF) alvo.innerHTML = '<div class="contexto">Carregando o pagamento fora da folha...</div>';
  // Baixa automatica (30/09/2026): o que o Saipos ja pagou AO CENTAVO fecha antes
  // de a tela abrir. Tambem roda no fim de toda carga do import_saipos.py; aqui e'
  // so para nao esperar a proxima carga. Falhar nao impede a tela.
  try { await trRpc('rh_ff_baixa_automatica', {}); } catch (e) {}
  const [rp, rm, rc] = await Promise.all([
    trFetch('rh_ff_pessoas?select=*&order=nome'),
    // futuro: desde 19/10/2026 a view vai 90 dias a frente (Fluxo projetado e robo); a tela fica ate o mes corrente
    trFetch('vw_rh_ff_meses?select=*&futuro=is.false&order=nome,mes.desc'),
    trFetch('vw_rh_ff_casamento_saipos?select=*'),
  ]);
  if (!rp.ok || !rm.ok) {
    alvo.innerHTML = `<div class="contexto" style="border-color:#ff6b6b;">Não consegui carregar: ${await trErroDe(rp.ok ? rm : rp)}.
      Esta tela precisa de login (Neto, Fabio ou Hellen).</div>`;
    return;
  }
  FF = { pessoas: await rp.json(), meses: await rm.json(), saipos: rc.ok ? await rc.json() : [], editando: FF ? FF.editando : null };
  renderForaFolha();
}
function ffMesTxt(d) { return new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }); }
// Aceita "3.261,66", "3261,66", "298.19" e "298" — o campo mostra em pt-BR, mas
// quem digita costuma usar ponto como decimal (foi assim que o 298,19 entrou).
function ffNum(v) {
  let s = String(v ?? '').trim().replace(/\s|R\$/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');   // 3.261 = milhar
  return Number(s) || 0;
}
function ffDecidir(v) { return v === null || v === undefined ? '<i style="color:#e3b341;">a decidir</i>' : (Number(v) ? 'R$ ' + fmt(Number(v)) : 'não entra'); }

function renderForaFolha() {
  const alvo = document.getElementById('view-forafolha');
  if (!alvo || !FF) return;
  const hoje = trHoje();
  if (!FF.pessoas.length) {
    alvo.innerHTML = '<div class="contexto">Ninguém cadastrado para receber fora da folha — ou este login não tem acesso a dados de pessoal (é do Neto, do Fabio e da Hellen).</div>';
    return;
  }
  let h = `<div class="caption-label" style="max-width:820px;">
    <b>Como funciona:</b> quem está sem registro recebe pelo cálculo daqui, não pela folha. Entram salário, gratificação fixa e a
    <b>gratificação do salão</b> (varia — informe aqui todo mês); desconta-se a parte dela do vale transporte. Não entram INSS,
    vale alimentação (vai pelo cartão da Flash) nem consumo (não se marca mais).
    O <b>adiantamento</b> sai no dia 20 e é descontado do <b>saldo</b>, pago no <b>5º dia útil</b> do mês seguinte
    (o 5º dia útil conta o sábado; se cair no fim de semana ou feriado, antecipa para o dia útil anterior).
    As duas parcelas aparecem no Fluxo projetado e em Contas a pagar até serem pagas. <b>A baixa é automática</b>: quando o
    pagamento chega do Saipos com o valor exato, a parcela fecha sozinha; se o valor for diferente, aparece o botão "confirmar".
    <span id="ffMsg" style="margin-left:6px;"></span></div>`;

  // O TAMANHO DA SEMANA ANTES DAS PESSOAS (12/09/2026). O loop abaixo mostra uma
  // pessoa de cada vez; quem abre a tela precisa saber primeiro quanto sai nos
  // proximos 7 dias, em quantas parcelas e o que ja passou do vencimento — sem
  // isso e preciso somar de cabeca rolando a tela. Mesmas regras do card de cada
  // pessoa (adiantamento so conta se houver valor; saldo conta ate ser baixado).
  const emSeteDias = new Date(hoje + 'T12:00:00');
  emSeteDias.setDate(emSeteDias.getDate() + 7);
  const limite7 = emSeteDias.toLocaleDateString('en-CA');
  const todasAbertas = [];
  FF.pessoas.forEach(pp => {
    FF.meses.filter(m => m.pessoa_id === pp.id).forEach(m => {
      if (Number(m.adiantamento) > 0 && !m.adiantamento_pago_em)
        todasAbertas.push({ pid: pp.id, nome: pp.nome, venc: m.vence_adiantamento, valor: Number(m.adiantamento) });
      if (!m.saldo_pago_em)
        todasAbertas.push({ pid: pp.id, nome: pp.nome, venc: m.vence_saldo, valor: Number(m.saldo) });
    });
  });
  todasAbertas.sort((a, b) => a.venc.localeCompare(b.venc));
  const ate7 = todasAbertas.filter(a => a.venc <= limite7);
  const atrasadas = todasAbertas.filter(a => a.venc < hoje);
  if (todasAbertas.length) h += `<div class="contexto" style="text-align:left; margin-top:10px;">
    <b>R$ ${fmt(ate7.reduce((s, a) => s + a.valor, 0))} a pagar nos próximos 7 dias</b>
    · ${ate7.length} parcela(s) · ${atrasadas.length
      ? `<a href="javascript:void(0)" style="color:var(--farol-fora);" title="ir para ${atrasadas[0].nome}, a vencida mais antiga" onclick="document.getElementById('ff-p${atrasadas[0].pid}').scrollIntoView({ behavior: 'smooth', block: 'start' })">${atrasadas.length} vencida(s)</a>`
      : 'nenhuma vencida'}
    <span style="color:var(--tx-3);">· R$ ${fmt(todasAbertas.reduce((s, a) => s + a.valor, 0))} em aberto no total</span></div>`;

  for (const p of FF.pessoas) {
    const meses = FF.meses.filter(m => m.pessoa_id === p.id);
    const abertas = [];
    meses.forEach(m => {
      if (Number(m.adiantamento) > 0 && !m.adiantamento_pago_em) abertas.push({ venc: m.vence_adiantamento, valor: Number(m.adiantamento), o_que: 'adiantamento de ' + ffMesTxt(m.mes) });
      if (!m.saldo_pago_em) abertas.push({ venc: m.vence_saldo, valor: Number(m.saldo), o_que: 'saldo de ' + ffMesTxt(m.mes) });
    });
    abertas.sort((a, b) => a.venc.localeCompare(b.venc));
    const prox = abertas[0];
    const vencidas = abertas.filter(a => a.venc < hoje);

    h += `<div class="contexto" id="ff-p${p.id}" style="margin-top:14px;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
        <div><b style="font-size:15px;">${p.nome}</b> <span style="color:#a5a49a;">· ${p.unidade} · sai da conta ${p.conta}</span></div>
        <button class="preset-btn" onclick="ffEditar(${p.id})">${FF.editando === p.id ? 'fechar' : 'editar parâmetros'}</button>
      </div>
      <div class="cards" style="margin-top:10px;">
        <div class="card ${vencidas.length ? 'red' : 'blue'}"><div class="card-lbl">Próximo pagamento</div>
          <div class="card-val">${prox ? 'R$ ' + fmt(prox.valor) : '—'}</div>
          <div class="card-pct">${prox ? ffDdmm(prox.venc) + ' · ' + prox.o_que + (prox.venc < hoje ? ' · VENCIDA' : '') : 'nada em aberto'}</div></div>
        <div class="card neutral"><div class="card-lbl">Em aberto</div>
          <div class="card-val">R$ ${fmt(abertas.reduce((s, a) => s + a.valor, 0))}</div>
          <div class="card-pct">${abertas.length} parcela(s)${vencidas.length ? ' · ' + vencidas.length + ' vencida(s)' : ''}</div></div>
        <div class="card neutral"><div class="card-lbl">Parâmetros</div>
          <div class="card-pct" style="line-height:1.6;">Salário R$ ${fmt(Number(p.salario_base))} · Gratificação fixa R$ ${fmt(Number(p.gratificacao))} ·
            Adiantamento R$ ${fmt(Number(p.adiantamento))}<br>Desconto consumo: ${ffDecidir(p.desconto_consumo)} · Vale transporte: ${ffDecidir(p.vale_transporte)}<br>
            ${Number(p.desconto_divida) ? `<span title="${p.desconto_divida_motivo || ''}">Desconto dívida: R$ ${fmt(Number(p.desconto_divida))}/mês</span><br>` : ''}
            Fora da folha desde ${ffDdmm(p.inicio)}/${p.inicio.slice(0, 4)}${p.fim ? ' até ' + ffDdmm(p.fim) + '/' + p.fim.slice(0, 4) : ''}</div></div>
      </div>
      ${p.observacao ? `<div class="caption-label" style="margin-top:6px;">${p.observacao}</div>` : ''}`;

    if (FF.editando === p.id) {
      const inp = (id, v, extra = '') => `<input id="${id}" value="${v ?? ''}" ${extra} style="background:#232321; border:1px solid #34332f; border-radius:6px; color:#fff; padding:5px 8px; width:120px;">`;
      h += `<div class="contexto" style="margin-top:10px; max-width:760px;">
        <b>Parâmetros do cálculo</b> (valores mensais, em reais — copiados do último holerite cheio)
        <div style="display:grid; grid-template-columns:auto auto; gap:6px 14px; align-items:center; margin-top:8px;">
          <span>Salário base</span>${inp('ffSal' + p.id, p.salario_base)}
          <span>Gratificação fixa</span>${inp('ffGra' + p.id, p.gratificacao)}
          <span>Adiantamento (dia 20)</span>${inp('ffAdi' + p.id, p.adiantamento)}
          <span>Desconto consumo <small style="color:#a5a49a;">(vazio = a decidir · 0 = não entra)</small></span>${inp('ffCon' + p.id, p.desconto_consumo)}
          <span>Vale transporte (parte dela) <small style="color:#a5a49a;">(vazio = a decidir · 0 = não entra)</small></span>${inp('ffVt' + p.id, p.vale_transporte)}
          <span>Fora da folha desde</span>${inp('ffIni' + p.id, p.inicio, 'type="date"')}
          <span>Até <small style="color:#a5a49a;">(vazio = segue até avisar)</small></span>${inp('ffFim' + p.id, p.fim, 'type="date"')}
          <span>Observação</span>${inp('ffObs' + p.id, p.observacao, 'style="width:360px;"')}
          <span>Empregador (sai no recibo)</span>${inp('ffEmp' + p.id, p.empregador, 'style="width:360px;"')}
          <span>CNPJ (sai no recibo)</span>${inp('ffCnpj' + p.id, p.cnpj, 'style="width:200px;"')}
        </div>
        <div style="margin-top:8px;"><button class="preset-btn" onclick="ffSalvarPessoa(${p.id})">salvar parâmetros</button></div>
      </div>`;
    }

    // Duas tabelas, de proposito: o CALCULO do mes (numeros numa linha so, com o
    // salao e o ajuste editaveis) e as PARCELAS a pagar (uma linha por parcela,
    // com baixa e recibo). Tudo junto dava 11 colunas e linhas de 3 andares.
    const inp = (id, v, ph, w, borda) => `<input id="${id}" value="${v ?? ''}" placeholder="${ph}" style="background:#232321; border:1px solid ${borda || '#34332f'}; border-radius:6px; color:#fff; padding:4px 6px; width:${w}px; text-align:right;">`;
    const temConsumo = meses.some(m => m.desconto_consumo === null || Number(m.desconto_consumo) > 0);
    const temDivida = meses.some(m => Number(m.desconto_divida) > 0);
    const desc = (v) => v === null ? '<i style="color:#e3b341;">a decidir</i>' : (Number(v) ? '−' + fmt(Number(v)) : '—');
    h += `<div class="caption-label" style="margin-top:14px;"><b>Cálculo do mês</b> — informe o salão (e um ajuste, se houver) e clique em salvar; o saldo recalcula na hora.</div>
      <div style="overflow-x:auto;"><table style="white-space:nowrap;">
      <tr><th>Mês</th><th style="text-align:right;">Salário</th><th style="text-align:right;">Grat. fixa</th><th style="text-align:right;">Salão do mês</th>
          <th style="text-align:right;">Ajuste (+/−)</th><th>Motivo</th><th></th>${temConsumo ? '<th style="text-align:right;">Consumo</th>' : ''}<th style="text-align:right;">VT</th>${temDivida ? `<th style="text-align:right;" title="${p.desconto_divida_motivo || ''}">Dívida</th>` : ''}
          <th style="text-align:right;">Bruto</th><th style="text-align:right;">Adiantamento</th><th style="text-align:right;">Saldo</th></tr>`;
    for (const m of meses) {
      const key = `${p.id}_${m.mes.slice(0, 7)}`;
      h += `<tr>
        <td><b>${ffMesTxt(m.mes)}</b>${Number(m.fracao) < 1 ? `<br><small style="color:#e3b341;">${m.dias}/30 dias (${ffDdmm(m.periodo_ini)} a ${ffDdmm(m.periodo_fim)})</small>` : ''}
            ${m.informado_por ? `<br><small style="color:#a5a49a;">salão por ${m.informado_por.split('@')[0].split(' ')[0]}${m.informado_em ? ' em ' + ffDdmm(m.informado_em.slice(0, 10)) : ''}</small>` : ''}</td>
        <td style="text-align:right;">${fmt(Number(m.salario))}</td>
        <td style="text-align:right;">${fmt(Number(m.gratificacao_fixa))}</td>
        <td style="text-align:right;">${inp('ffSalao_' + key, m.gratificacao_salao === null ? '' : fmt(Number(m.gratificacao_salao)), 'informar', 90, m.gratificacao_salao === null ? '#e3b341' : null)}</td>
        <td style="text-align:right;">${inp('ffAj_' + key, Number(m.ajuste) ? fmt(Number(m.ajuste)) : '', '0', 70)}</td>
        <td><input id="ffMot_${key}" value="${m.ajuste_motivo || ''}" placeholder="motivo" style="background:#232321; border:1px solid #34332f; border-radius:6px; color:#fff; padding:4px 6px; width:120px;"></td>
        <td><button class="preset-btn" onclick="ffInformar(${p.id}, '${m.mes}')">salvar</button></td>
        ${temConsumo ? `<td style="text-align:right;">${desc(m.desconto_consumo)}</td>` : ''}
        <td style="text-align:right;">${desc(m.vale_transporte)}</td>
        ${temDivida ? `<td style="text-align:right;">${desc(m.desconto_divida)}</td>` : ''}
        <td style="text-align:right;"><b>${fmt(Number(m.bruto))}</b></td>
        <td style="text-align:right;">−${fmt(Number(m.adiantamento))}</td>
        <td style="text-align:right;"><b>${fmt(Number(m.saldo))}</b>${(m.pendencias || []).length ? '<br><small style="color:#e3b341;">' + m.pendencias.join('<br>') + '</small>' : ''}</td>
      </tr>`;
    }
    h += `</table></div>
      <div class="caption-label" style="margin-top:14px;"><b>Parcelas a pagar</b> — marque como paga quando o dinheiro sair; o recibo abre pronto para imprimir ou salvar em PDF.</div>
      <div style="overflow-x:auto;"><table style="white-space:nowrap;">
      <tr><th>Mês</th><th>Parcela</th><th>Vencimento</th><th style="text-align:right;">Valor</th><th>Situação</th><th>Baixa</th><th>Recibo</th></tr>`;
    const parcelas = [];
    meses.forEach(m => {
      if (Number(m.adiantamento) > 0) parcelas.push({ m, nome: 'ADIANTAMENTO', rot: 'Adiantamento', venc: m.vence_adiantamento, valor: Number(m.adiantamento), pagoEm: m.adiantamento_pago_em, valorPago: m.adiantamento_pago });
      parcelas.push({ m, nome: 'SALDO', rot: 'Saldo do mês', venc: m.vence_saldo, valor: Number(m.saldo), pagoEm: m.saldo_pago_em, valorPago: m.saldo_pago });
    });
    // Do mais NOVO para o mais velho, igual a tabela de calculo do mes logo
    // acima (que vem do banco em mes.desc). As duas tabelas sao da mesma pessoa e
    // liam em ordens opostas — quem conferia uma na outra lia de baixo para cima
    // numa delas. O `abertas` do card continua crescente: la a pergunta e qual e
    // a PROXIMA a vencer.
    parcelas.sort((a, b) => b.venc.localeCompare(a.venc));
    for (const x of parcelas) {
      const key = `${p.id}_${x.m.mes.slice(0, 7)}`;
      const vencida = !x.pagoEm && x.venc < hoje;
      const hojeVence = !x.pagoEm && x.venc === hoje;
      const origem = x.nome === 'SALDO' ? x.m.saldo_origem : x.m.adiantamento_origem;
      const doSaipos = origem && origem.startsWith('SAIPOS');
      // pagamento do Saipos que NAO bateu ao centavo: so baixa com o "confirmar" (regra do dono, 30/09)
      const cand = !x.pagoEm && (FF.saipos || []).find(c => c.pessoa_id === p.id && c.mes === x.m.mes && c.parcela === x.nome);
      h += `<tr>
        <td>${ffMesTxt(x.m.mes)}</td><td>${x.rot}</td>
        <td style="color:${vencida ? '#ff6b6b' : hojeVence ? '#e3b341' : 'inherit'}; font-weight:${vencida || hojeVence ? 'bold' : 'normal'};">${ffDdmm(x.venc)}/${x.venc.slice(0, 4)}${vencida ? ' · VENCIDA' : hojeVence ? ' · HOJE' : ''}</td>
        <td style="text-align:right;"><b>R$ ${fmt(x.valor)}</b></td>
        <td>${x.pagoEm ? `<span style="color:#3fb950;">paga em ${ffDdmm(x.pagoEm)} (R$ ${fmt(Number(x.valorPago))})</span>${doSaipos ? ` <small style="color:#a5a49a;" title="baixa pelo pagamento lançado no Saipos">· ${origem === 'SAIPOS_AUTO' ? 'Saipos, automática' : 'Saipos, confirmada'}</small>` : ''}` : 'em aberto'}</td>
        <td>${x.pagoEm
            ? `<a href="javascript:void(0)" style="color:#a5a49a;" onclick="ffDesfazer(${p.id}, '${x.m.mes}', '${x.nome}')">desfazer</a>`
            : cand
            ? `<span style="color:#e3b341;" title="${cand.saipos_descricao}">Saipos pagou R$ ${fmt(Number(cand.saipos_valor))} em ${ffDdmm(cand.saipos_data)} · ${Number(cand.diferenca) > 0 ? '+' : '−'}${fmt(Math.abs(Number(cand.diferenca)))}</span>
               <button class="preset-btn" onclick="ffConfirmarSaipos(${p.id}, '${x.m.mes}', '${x.nome}')">confirmar</button>`
            : `<input type="date" id="ffDt_${key}_${x.nome}" value="${hoje}" style="background:#232321; border:1px solid #34332f; border-radius:6px; color:#fff; padding:3px 5px;">
               <button class="preset-btn" onclick="ffBaixar(${p.id}, '${x.m.mes}', '${x.nome}', ${x.valor})">marcar paga</button>`}</td>
        <td><a href="javascript:void(0)" style="color:#a5a49a;" title="abre o recibo pronto para imprimir ou salvar em PDF" onclick="ffRecibo(${p.id}, '${x.m.mes}', '${x.nome}')">🧾 recibo</a></td>
      </tr>`;
    }
    h += `</table></div>
    </div>`;
  }
  h += `<div class="caption-label" style="max-width:820px; margin-top:10px;" title="O 5º dia útil conta de segunda a sábado, fora de feriado — tabela feriados: nacional, Paraná e Curitiba.">Saldo = salário + gratificação fixa + salão + ajuste − consumo − VT − dívida − adiantamento.
    Mês em que a pessoa entra ou sai no meio é proporcional em trintavos.</div>`;
  alvo.innerHTML = h;
}
// Valor por extenso em reais (recibo). Cobre ate 999 milhoes.
function ffExtenso(valor) {
  const u = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  const d = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  const c = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
  const ate999 = (n) => {
    if (n === 0) return '';
    if (n === 100) return 'cem';
    const p = [];
    if (n >= 100) p.push(c[Math.floor(n / 100)]);
    const r = n % 100;
    if (r >= 20) { p.push(d[Math.floor(r / 10)]); if (r % 10) p.push(u[r % 10]); }
    else if (r > 0) p.push(u[r]);
    return p.join(' e ');
  };
  const inteiro = (n) => {
    if (n === 0) return 'zero';
    const partes = [];
    const mi = Math.floor(n / 1e6), mil = Math.floor((n % 1e6) / 1000), resto = n % 1000;
    if (mi) partes.push(mi === 1 ? 'um milhão' : ate999(mi) + ' milhões');
    if (mil) partes.push(mil === 1 ? 'mil' : ate999(mil) + ' mil');
    if (resto) partes.push(ate999(resto));
    // "e" antes do ultimo bloco quando ele e' menor que cem ou redondo de centena
    if (partes.length > 1 && (resto < 100 || resto % 100 === 0) && resto) { const ult = partes.pop(); return partes.join(', ') + ' e ' + ult; }
    return partes.join(', ');
  };
  const cent = Math.round(Math.abs(valor) * 100);
  const reais = Math.floor(cent / 100), cents = cent % 100;
  let s = reais ? inteiro(reais) + (reais === 1 ? ' real' : ' reais') : '';
  if (cents) s += (s ? ' e ' : '') + inteiro(cents) + (cents === 1 ? ' centavo' : ' centavos');
  return s || 'zero reais';
}

// Recibo da parcela (adiantamento ou saldo) pronto para imprimir / salvar em PDF —
// mesmo mecanismo da lista de separacao: janela nova + print(). O demonstrativo
// e' o calculo do mes que a tela mostra; nada e' recalculado aqui.
function ffRecibo(pessoaId, mes, parcela) {
  const p = FF.pessoas.find(x => x.id === pessoaId);
  const m = FF.meses.find(x => x.pessoa_id === pessoaId && x.mes === mes);
  if (!p || !m) return;
  const n = (v) => Number(v) || 0;
  const dLong = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
  const mesLong = ffMesTxt(mes);
  const saldo = parcela === 'SALDO';
  const valor = saldo ? n(m.saldo) : n(m.adiantamento);
  const pagoEm = saldo ? m.saldo_pago_em : m.adiantamento_pago_em;
  const venc = saldo ? m.vence_saldo : m.vence_adiantamento;
  const dataRecibo = pagoEm || (venc <= trHoje() ? venc : trHoje());
  const titulo = saldo ? 'RECIBO DE PAGAMENTO' : 'RECIBO DE ADIANTAMENTO SALARIAL';
  const referente = saldo
    ? `ao pagamento do saldo de <b>${mesLong}</b>, conforme demonstrativo abaixo`
    : `ao adiantamento salarial de <b>${mesLong}</b>, a ser descontado no pagamento do saldo do mês`;
  const linha = (rot, v, neg) => v ? `<tr><td>${rot}</td><td class="v">${neg ? '−' : ''}${fmt(Math.abs(v))}</td></tr>` : '';
  const demonstrativo = saldo ? `
    <h2>Demonstrativo de ${mesLong}${n(m.fracao) < 1 ? ` (${m.dias}/30 dias)` : ''}</h2>
    <table>
      ${linha('Salário', n(m.salario))}
      ${linha('Gratificação', n(m.gratificacao_fixa))}
      ${linha('Gratificação salão', n(m.gratificacao_salao))}
      ${n(m.ajuste) > 0 ? linha('Ajuste' + (m.ajuste_motivo ? ' — ' + m.ajuste_motivo : ''), n(m.ajuste)) : ''}
      <tr class="tot"><td>Total de vencimentos</td><td class="v">${fmt(n(m.salario) + n(m.gratificacao_fixa) + n(m.gratificacao_salao) + Math.max(0, n(m.ajuste)))}</td></tr>
      ${n(m.ajuste) < 0 ? linha('Ajuste' + (m.ajuste_motivo ? ' — ' + m.ajuste_motivo : ''), n(m.ajuste), true) : ''}
      ${linha('Desconto consumo', n(m.desconto_consumo), true)}
      ${linha('Vale transporte', n(m.vale_transporte), true)}
      ${linha('Desconto dívida' + (m.desconto_divida_motivo ? ' — ' + m.desconto_divida_motivo : ''), n(m.desconto_divida), true)}
      ${linha('Adiantamento salarial' + (m.adiantamento_pago_em ? ' (pago em ' + ffDdmm(m.adiantamento_pago_em) + ')' : ''), n(m.adiantamento), true)}
      <tr class="tot"><td>Valor líquido</td><td class="v">${fmt(valor)}</td></tr>
    </table>` : '';
  const w = window.open('', '_blank');
  if (!w) { alert('O navegador bloqueou a janela do recibo — libere pop-ups para este site.'); return; }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Recibo — ${p.nome.split(' ')[0]} — ${mesLong}</title><style>
    body { font-family:Arial, sans-serif; color:#000; margin:36px 48px; max-width:720px; font-size:14px; line-height:1.5; }
    h1 { font-size:18px; letter-spacing:1px; text-align:center; margin:0 0 4px; }
    .valor { text-align:right; font-size:16px; margin-bottom:18px; }
    h2 { font-size:12px; text-transform:uppercase; border-bottom:1.5px solid #000; padding-bottom:2px; margin:22px 0 6px; }
    table { width:100%; border-collapse:collapse; }
    td { padding:4px 6px; border-bottom:1px solid #ccc; }
    td.v { text-align:right; white-space:nowrap; width:130px; }
    tr.tot td { font-weight:bold; border-bottom:2px solid #000; }
    .ass { margin-top:60px; }
    .ass .linha { border-top:1px solid #000; width:320px; padding-top:4px; }
    @media print { .naoimprime { display:none; } body { margin:0; } }
  </style></head><body>
    <button class="naoimprime" onclick="window.print()" style="float:right; padding:8px 14px;">Imprimir / salvar PDF</button>
    <h1>${titulo}</h1>
    <div class="valor"><b>R$ ${fmt(valor)}</b></div>
    <p>Recebi de <b>${p.empregador || '(empregador não informado — preencha em "editar parâmetros")'}</b>${p.cnpj ? `, CNPJ ${p.cnpj},` : ''}
      a importância de <b>R$ ${fmt(valor)}</b> (${ffExtenso(valor)}), referente ${referente}.</p>
    ${demonstrativo}
    <p style="margin-top:24px;">Curitiba, ${dLong(dataRecibo)}.</p>
    <div class="ass"><div class="linha"><b>${p.nome}</b></div></div>
  </body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => { try { w.print(); } catch (e) {} }, 400);
}

function ffAviso(txt, ok) {
  // 29/10/2026: o recado vai à barra do resultado (fixa no pé, com a hora; não some no redesenho)
  if (ok) return avisoAcao('ok', `✓ ${txt.replace(/\.$/, '')} — às ${avisoHora()}.`);
  return avisoAcao(/^Não deu/.test(txt) ? 'erro' : 'atencao', /^Não deu/.test(txt) ? `✗ Não gravou: ${txt.replace(/^Não deu: /, '')}. Tente de novo.` : `! ${txt}`);
}
function ffEditar(id) { FF.editando = FF.editando === id ? null : id; renderForaFolha(); }
async function ffInformar(pessoa, mes) {
  const key = `${pessoa}_${mes.slice(0, 7)}`;
  const salaoTxt = document.getElementById('ffSalao_' + key).value.trim();
  avisoAcao('enviando', 'Gravando…');
  const r = await trRpcSeguro('rh_ff_informar_mes', {
    p_pessoa: pessoa, p_mes: mes,
    p_salao: salaoTxt === '' ? null : ffNum(salaoTxt),
    p_ajuste: ffNum(document.getElementById('ffAj_' + key).value),
    p_motivo: document.getElementById('ffMot_' + key).value,
  });
  if (!r.ok) { ffAviso('Não deu: ' + await trErroDe(r), false); return; }
  await entrarForaFolha();
  ffAviso('Mês salvo — o saldo já foi recalculado.', true);
}
async function ffBaixar(pessoa, mes, parcela, valor) {
  const dt = document.getElementById(`ffDt_${pessoa}_${mes.slice(0, 7)}_${parcela}`);
  avisoAcao('enviando', 'Gravando…');
  const r = await trRpcSeguro('rh_ff_baixar', { p_pessoa: pessoa, p_mes: mes, p_parcela: parcela, p_pago_em: (dt && dt.value) || trHoje(), p_valor: valor });
  if (!r.ok) { ffAviso('Não deu: ' + await trErroDe(r), false); return; }
  await entrarForaFolha();
  ffAviso('Marcada como paga — saiu do Fluxo projetado.', true);
}
async function ffConfirmarSaipos(pessoa, mes, parcela) {
  avisoAcao('enviando', 'Gravando…');
  const r = await trRpcSeguro('rh_ff_confirmar_saipos', { p_pessoa: pessoa, p_mes: mes, p_parcela: parcela });
  if (!r.ok) { ffAviso('Não deu: ' + await trErroDe(r), false); return; }
  await entrarForaFolha();
  ffAviso('Baixa confirmada com o valor do Saipos. Se a diferença tem motivo, lance como ajuste do mês.', true);
}
async function ffDesfazer(pessoa, mes, parcela) {
  avisoAcao('enviando', 'Gravando…');
  const r = await trRpcSeguro('rh_ff_desfazer_baixa', { p_pessoa: pessoa, p_mes: mes, p_parcela: parcela });
  if (!r.ok) { ffAviso('Não deu: ' + await trErroDe(r), false); return; }
  await entrarForaFolha();
  ffAviso('Baixa desfeita — a parcela voltou para o Fluxo projetado.', true);
}
async function ffSalvarPessoa(id) {
  const v = (s) => document.getElementById(s + id).value.trim();
  const opc = (s) => v(s) === '' ? null : ffNum(v(s));   // vazio = a decidir; 0 = nao entra
  avisoAcao('enviando', 'Gravando…');
  const r = await trRpcSeguro('rh_ff_salvar_pessoa', {
    p_id: id, p_salario: ffNum(v('ffSal')), p_gratificacao: ffNum(v('ffGra')), p_adiantamento: ffNum(v('ffAdi')),
    p_consumo: opc('ffCon'), p_vt: opc('ffVt'), p_inicio: v('ffIni'), p_fim: v('ffFim') || null, p_observacao: v('ffObs'),
    p_empregador: v('ffEmp'), p_cnpj: v('ffCnpj'),
  });
  if (!r.ok) { ffAviso('Não deu: ' + await trErroDe(r), false); return; }
  FF.editando = null;
  await entrarForaFolha();
  ffAviso('Parâmetros salvos — todos os meses foram recalculados.', true);
}

// ------------------------------------------------------------------
// CARGOS E SALÁRIOS (22/09/2026; refeito 19/10/2026) — o controle da folha dentro do painel.
// Dono, 19/10: "eliminar minhas planilhas e trazer todo o controle pra dentro do painel ... plano de cargos e
// salários atualizado, composição do custo por funcionário envolvendo todos os gastos, rateio por setor atualizado
// (que alimenta o custo dos canais), cálculo mensal de VT e VA no último dia útil do mês e a lista de quem pega
// adiantamento no dia 20". O cadastro (rh_pessoa) se edita AQUI por rh_pessoa_salvar; o custo realizado vem do
// contas a pagar (vw_rh_custo_*), o mesmo número da DRE; o setor de cada pessoa mantém o rateio dos canais.
// Quem vê e grava: pode_ver_pessoal (dono, Fabio, Hellen). A aba Correções na Flash também abre sozinha como a
// tela 'flash', para a Arissa (sem salário). Banco: script/sql/rh_pessoas_modulo.sql.
// ------------------------------------------------------------------
let CARGOS = null;
let CARGOS_F = { tela: 'cargos', aba: 'pessoas', unidade: null, setor: null, mes: null, desligados: false, editando: null };
// 29/10/2026: a ordem segue o trabalho do mês (dono: uma página com as atividades em abas no alto)
const CG_ABAS = [['pessoas', 'Cargos e salários'], ['vtva', 'VT e VA'], ['folha', 'Conferência da folha'], ['ferias', 'Férias'], ['adt', 'Adiantamento'],
                 ['bonif', 'Bonificação'], ['tabela', 'Tabela de cargos'], ['custo', 'Custo por pessoa'], ['setor', 'Por setor'],
                 ['saipos', 'Acertos no Saipos'], ['flash', 'Correções na Flash']];
// 29/10/2026 (dono): os passos do mês, na ordem do trabalho (período 26 a 25). Calcular ≠ conferir: o passo 2 é o que a casa
// calcula; o passo 4 é a conferência do que a contabilidade devolveu.
const CG_PASSOS = [
  { n: 1, rot: 'Cadastro', leg: 'quem é quem', abas: [['pessoas', 'Cargos e salários'], ['tabela', 'Tabela de cargos']] },
  { n: 2, rot: 'Cálculos', leg: 'a casa calcula', abas: [['vtva', 'VT e VA'], ['adt', 'Adiantamento'], ['dez', '10% do salão'], ['bonif', 'Bonificação trimestral'], ['ferias', 'Férias']] },
  { n: 3, rot: 'Envio à contabilidade', leg: 'arquivo e planilha', abas: [['envio', 'Envio à contabilidade']] },
  { n: 4, rot: 'Conferência da folha', leg: 'o que voltou', abas: [['folha', 'Conferência da folha']] },
];
const CG_ACOMP = [['custo', 'Custo por pessoa'], ['setor', 'Por setor'], ['saipos', 'Acertos no Saipos'], ['flash', 'Correções na Flash']];
// 29/10/2026 13:51 (dono): cada passo é uma tela do menu Pessoas. Cada tela mostra só as suas abas (o código é o mesmo).
const CG_TELAS = {
  cargos: { titulo: 'Cargos e salários', leg: 'A Flash é a base oficial da folha: aqui aparecem as diferenças entre ela, o nosso cadastro e a folha da contabilidade.',
            abas: [['pessoas', 'Cargos e salários'], ['tabela', 'Tabela de cargos']] },
  // 29/10/2026 14:24 (dono): o que era "Acompanhar" virou tela própria (custo) ou foi para o Financeiro (acertos)
  pcusto: { titulo: 'Custo da folha', leg: 'Quanto a folha custou de verdade (contas a pagar), por pessoa e por setor. Só consulta.', abas: [['custo', 'Custo por pessoa'], ['setor', 'Por setor']] },
  pacertos: { titulo: 'Acertos da folha no Saipos', leg: 'As provisões de adiantamento, VT e VA que o robô acerta no Saipos.', abas: [['saipos', 'Acertos no Saipos']] },
  pcalc: { titulo: 'Cálculos da folha', leg: 'O que a casa calcula para a folha, na ordem de vencimento.',
           abas: [['adt', 'Adiantamento · paga dia 20'], ['dez', '10% do salão · fecha a partir do dia 25'], ['vtva', 'VT e VA · último dia útil'], ['bonif', 'Bonificação trimestral · a partir do dia 25']] },
  pferias: { titulo: 'Férias', leg: 'As que vão vencer e as já lançadas. O simulador de valores e a projeção no contas a pagar entram aqui.', abas: [['ferias', 'Férias']] },
  presc: { titulo: 'Rescisões', leg: 'Simulador e conferência das rescisões enviadas pela contabilidade, com projeção no contas a pagar.', abas: [['resc', 'Rescisões']] },
  penvio: { titulo: 'Envio à contabilidade', leg: 'Os nossos cálculos + as horas da Flash: conferir e montar o que vai para a contabilidade.', abas: [['envio', 'Envio à contabilidade']] },
  pconf: { titulo: 'Conferência da folha', leg: 'Tudo o que enviamos, conferido contra a folha que a contabilidade devolveu.', abas: [['folha', 'Conferência da folha']] },
};
function cgAlvo() { return document.getElementById('view-' + (CARGOS_F.tela || 'cargos')) || document.getElementById('view-cargos'); }
function cgEntrarTela(t) {
  CARGOS_F.tela = t;
  const ok = CG_TELAS[t].abas.map(([k]) => k).concat(CG_TELAS[t].acomp ? CG_ACOMP.map(([k]) => k) : []);
  if (!ok.includes(CARGOS_F.aba)) CARGOS_F.aba = CG_TELAS[t].abas[0][0];
  return entrarCargos();
}
const entrarPesCargos = () => cgEntrarTela('cargos'), entrarPesCalc = () => cgEntrarTela('pcalc'), entrarPesFerias = () => cgEntrarTela('pferias'),
      entrarPesResc = () => cgEntrarTela('presc'), entrarPesEnvio = () => cgEntrarTela('penvio'), entrarPesConf = () => cgEntrarTela('pconf'),
      entrarPesCusto = () => cgEntrarTela('pcusto'), entrarPesAcertos = () => cgEntrarTela('pacertos');

const CG_SETORES = ['ADMIN', 'COZINHA', 'DELIVERY', 'PRODUÇÃO', 'SALÃO'];
const CG_DEPTOS = ['ATENDIMENTO', 'COZINHA', 'PRODUÇÃO', 'OPERACIONAL', 'LIMPEZA', 'ADMINISTRATIVO'];
const CG_EMPRESAS = { 'AGUA VERDE': ['FF AGUA VERDE', 'CIDADAO AV'], 'AHU': ['CIDADAO AHU'], 'SÃO BRAZ': ['FF SAO BRAZ'] };

const cgN = (v) => Number(v) || 0;
const cgR = (v) => cgN(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const cgR0 = (v) => cgN(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const cgEsc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const cgNome = (s) => String(s || '').toLowerCase().replace(/(^|\s|\()\S/g, (c) => c.toUpperCase());
const cgData = (d) => d ? new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString('pt-BR') : '–';
const cgMesRot = (d) => d ? new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) : '';
function cgMesIso(delta) { const h = new Date(); const d = new Date(h.getFullYear(), h.getMonth() + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; }

// 28/10/2026 (seletor de loja único): a loja vem do topo da casca (nucleo/loja.js); Rede = todas. Sem o loja.js (painel
// antigo) os chips de loja da própria tela continuam.
let PES_OUVE_LOJA = false;
function pesComSeletor() { return typeof lojaAtual === 'function' && typeof LOJA_INFO !== 'undefined' && !!LOJA_INFO; }
function pesLojaVista() { if (!pesComSeletor()) return null; const l = lojaAtual(); return l && l !== 'REDE' ? l : null; }
async function pesLojaPreparar() {
  if (typeof lojaCarregar !== 'function') return;
  await lojaCarregar();
  if (PES_OUVE_LOJA) return;
  PES_OUVE_LOJA = true;
  aoMudarLoja(() => { if (typeof window.reentrarTela === 'function') window.reentrarTela(); else if (CARGOS) renderModuloCargos(); });
}
async function entrarCargos() {
  await pesLojaPreparar();
  const alvo = cgAlvo();
  if (!alvo) return;
  if (CARGOS) { renderModuloCargos(); return; }
  alvo.innerHTML = '<div class="contexto">Carregando a folha...</div>';
  try {
    const desde = cgMesIso(-5);
    const [pessoas, tabela, custo, setor, conf, vtva, adt, flash, saipos, bonif, cs, faltasFF] = await Promise.all([
      consultarTudo('vw_rh_pessoas?select=*&order=unidade,nome'),
      consultarTudo('vw_rh_cargos_tabela?select=*&order=unidade,familia,nivel,horas'),
      consultarTudo(`vw_rh_custo_pessoa_mes?select=*&mes=gte.${desde}&mes=lte.${cgMesIso(0)}&order=unidade,nome`),
      consultarTudo(`vw_rh_custo_setor_mes?select=*&mes=gte.${desde}&mes=lte.${cgMesIso(0)}&order=unidade,setor`),
      consultarTudo(`vw_rh_custo_mes_conferencia?select=*&mes=gte.${desde}&mes=lte.${cgMesIso(0)}`),
      consultarTudo(`vw_rh_vt_va_mes?select=*&mes=gte.${cgMesIso(-1)}&order=unidade,nome`),
      consultarTudo(`vw_rh_adiantamento_mes?select=*&mes=gte.${cgMesIso(-1)}&order=unidade,nome`),
      consultarTudo('vw_rh_flash_pendencias?select=*&order=unidade,nome,ordem'),
      consultarTudo('vw_rh_saipos_acertos?select=*&order=vencimento,tipo,unidade_pagadora,quem').catch(() => []),
      consultarTudo('vw_rh_bonificacao_ciclo?select=*&order=unidade,nome').catch(() => []),
      consultarTudo('vw_rh_cargos_salarios?select=*').catch(() => []),
      consultarTudo('vw_rh_faltas_flash_folha?select=*&order=mes.desc,unidade,nome').catch(() => []),
    ]);
    CARGOS = { pessoas, tabela, custo, setor, conf, vtva, adt, flash, saipos, bonif,
               cs: new Map((cs || []).map((x) => [x.pessoa_id, x])), pagou: {}, faltasFF: faltasFF || [] };
  } catch (e) {
    alvo.innerHTML = `<div class="contexto">Não consegui carregar a folha: ${cgEsc(e.message)}</div>`;
    return;
  }
  if (!CARGOS.pessoas.length) {
    alvo.innerHTML = '<div class="contexto">Nada para mostrar — este login não vê dados de pessoal.</div>';
    return;
  }
  renderModuloCargos();
}
async function cgRecarregar(aviso) { CARGOS = null; await entrarCargos(); if (aviso) cgAviso(aviso, true); }
function cgAviso(txt, ok) {
  // 29/10/2026: o recado vai à barra do resultado (fixa no pé, com a hora; não some no redesenho)
  if (ok) return avisoAcao('ok', `✓ ${txt.replace(/\.$/, '')} — às ${avisoHora()}.`);
  return avisoAcao(/^Não deu/.test(txt) ? 'erro' : 'atencao', /^Não deu/.test(txt) ? `✗ Não gravou: ${txt.replace(/^Não deu: /, '')}. Tente de novo.` : `! ${txt}`);
}
function cargosAba(a) { CARGOS_F.aba = a; CARGOS_F.editando = null; renderModuloCargos(); }
function cargosFiltrar(campo, valor) { CARGOS_F[campo] = (CARGOS_F[campo] === valor) ? null : valor; renderModuloCargos(); }
function cargosLimpar() { CARGOS_F.unidade = null; CARGOS_F.setor = null; renderModuloCargos(); }
function cargosMes(m) { CARGOS_F.mes = m; renderModuloCargos(); }

function cgChip(rot, ativo, onclick) {
  return `<button type="button" class="preset-btn ${ativo ? 'active' : ''}" onclick="${onclick}" style="padding:3px 10px;">${cgEsc(rot)}${ativo ? ' ✕' : ''}</button>`;
}
function cgFiltroUnidade(lista) {
  const F = CARGOS_F;
  if (pesComSeletor()) return F.setor ? `<div style="margin:8px 0 12px;"><a href="javascript:void(0)" onclick="cargosLimpar()" style="font-size:12px;color:var(--tx-4);">limpar o setor</a></div>` : '';
  const us = [...new Set(lista.map(x => x.unidade))];
  return `<div style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 12px;align-items:center;">
    ${us.map(u => cgChip(u, F.unidade === u, `cargosFiltrar('unidade','${cgEsc(u)}')`)).join('')}
    ${F.unidade || F.setor ? `<a href="javascript:void(0)" onclick="cargosLimpar()" style="font-size:12px;color:var(--tx-4);margin-left:6px;">limpar</a>` : ''}</div>`;
}
function cgSeletorMes(meses, atual) {
  return `<div style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0;">${meses.map(m =>
    `<button type="button" class="preset-btn ${m === atual ? 'active' : ''}" onclick="cargosMes('${m}')">${cgMesRot(m)}</button>`).join('')}</div>`;
}

function renderModuloCargos() {
  const alvo = cgAlvo();
  if (!alvo || CARGOS === null) return;
  const F = CARGOS_F;
  if (pesComSeletor()) F.unidade = pesLojaVista();
  const flashN = cgFlashDaLoja(CARGOS.flash).length;
  // 29/10/2026 (dono): as atividades do RH em abas no alto, no formato da tela de Conferências
  // 29/10/2026 (dono): o módulo é Pessoas; a tela da folha segue os passos do mês, numerados, e o que não é passo fica em Acompanhar
  const T = CG_TELAS[F.tela || 'cargos'] || CG_TELAS.cargos;
  const btAba = (k, r, ativo, grande) => `<button type="button" onclick="cargosAba('${k}')" style="background:none;border:none;border-bottom:3px solid ${ativo ? 'var(--marca-amarelo)' : 'transparent'};color:${ativo ? 'var(--tx-1)' : 'var(--tx-3)'};font:inherit;font-weight:700;font-size:${grande ? 14 : 13}px;padding:${grande ? '9px 12px' : '6px 10px'};cursor:pointer;text-align:left;">${r}</button>`;
  let h = `<h2>${T.titulo}</h2>
    <div class="caption-label" style="text-align:left;margin:-4px 0 8px;">${T.leg}</div>
    ${T.abas.length > 1 ? `<div style="display:flex;flex-wrap:wrap;gap:2px;border-bottom:1px solid var(--line);margin:0 0 10px;">${T.abas.map(([k, r]) => btAba(k, r, F.aba === k, true)).join('')}</div>` : ''}
    ${T.acomp ? `<div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;justify-content:flex-end;margin:0 0 12px;font-size:12px;color:var(--tx-4);">Acompanhar:
      ${CG_ACOMP.map(([k, r]) => `<a href="javascript:void(0)" onclick="cargosAba('${k}')" style="color:${F.aba === k ? 'var(--tx-1)' : 'var(--tx-3)'};font-weight:${F.aba === k ? 700 : 400};margin-left:8px;">${r}${k === 'flash' && flashN ? ` (${flashN})` : ''}</a>`).join('')}</div>` : ''}
    <div id="cgMsg" style="font-size:12px;min-height:16px;margin-bottom:4px;"></div>`;
  if (F.aba === 'pessoas') h += cgAbaPessoas();
  else if (F.aba === 'tabela') h += cgAbaTabela();
  else if (F.aba === 'custo') h += cgAbaCusto();
  else if (F.aba === 'setor') h += cgAbaSetor();
  else if (F.aba === 'vtva') h += cgAbaVtVa();
  else if (F.aba === 'folha') h += cgAbaFolha();
  else if (F.aba === 'ferias') h += cgAbaFerias();
  else if (F.aba === 'adt') h += cgAbaAdt();
  else if (F.aba === 'bonif') h += cgAbaBonif();
  else if (F.aba === 'saipos') h += cgAbaSaipos();
  else if (F.aba === 'flash') h += cgListaFlash(CARGOS.flash);
  else if (F.aba === 'dez') h += cgEmMontagem('10% do salão', 'A conta da sua planilha (casa 30%, descontos fixos, 90% cozinha e 10% salão, proporcional de quem entrou no mês, quebra do salão fora) refeita com a taxa de serviço do Saipos. Fecha no dia 25 e vai para o envio à contabilidade.');
  else if (F.aba === 'resc') h += cgEmMontagem('Rescisões', 'Um simulador de rescisão (quanto custa e quando sai, com projeção no contas a pagar) e a conferência de cada rescisão que a contabilidade envia (TRCT) contra o nosso cálculo.');
  else if (F.aba === 'envio') h += cgEmMontagem('Envio à contabilidade', 'Junta, por pessoa, as horas da Flash, o 10%, cada falta com a data, o desconto do VT de quem pega e o adiantamento. Gera o arquivo da contabilidade (primeiro um de teste) e a planilha de conferência. A Hellen confere aqui antes de enviar.');
  alvo.innerHTML = h;
}

// ---------- PESSOAS (o cadastro) ----------
function cgAbaPessoas() {
  const F = CARGOS_F;
  const base = CARGOS.pessoas.filter(p => F.desligados ? !p.ativo : p.ativo);
  // 29/10/2026: a folha da contabilidade e a Flash ao lado do cadastro (vw_rh_cargos_salarios); "a conferir" = as três não batem
  const cs = (p) => CARGOS.cs.get(p.id) || null;
  const aConf = (p) => { const c = cs(p); return !!(c && cgLista(c.conferencia).length); };
  const visTodos = base.filter(p => (!F.unidade || p.unidade === F.unidade) && (!F.setor || p.setor_rateio === F.setor));
  const vis = F.soConferir ? visTodos.filter(aConf) : visTodos;
  const nConf = visTodos.filter(aConf).length;
  const comp = [...CARGOS.cs.values()].map((c) => c.folha_competencia).filter(Boolean).sort().pop();
  const fora = vis.filter(p => p.situacao_tabela === 'DIFERENTE DA TABELA' || p.situacao_tabela === 'CARGO SEM CÉLULA');
  const totSal = vis.reduce((s, p) => s + cgN(p.salario), 0), totPrev = vis.reduce((s, p) => s + cgN(p.custo_previsto), 0);
  const setores = [...new Set(base.filter(p => !F.unidade || p.unidade === F.unidade).map(p => p.setor_rateio).filter(Boolean))].sort();
  const sit = (p) => p.situacao_tabela === 'NA TABELA' ? '<span style="color:var(--farol-ok);">na tabela</span>'
    : p.situacao_tabela === 'DIFERENTE DA TABELA' ? `<span style="color:var(--farol-perto);">tabela diz ${cgR(p.salario_tabela)}</span>`
    : p.situacao_tabela === 'CARGO SEM CÉLULA' ? '<span style="color:var(--farol-perto);">cargo sem célula</span>'
    : `<span style="color:var(--tx-4);">${p.situacao_tabela === 'SEM PLANO NO AHÚ' ? 'Ahú sem plano' : 'fora do plano'}</span>`;
  let h = `<div class="cards">
      <div class="card neutral"><div class="card-lbl">${F.desligados ? 'Desligados' : 'Pessoas na folha'}</div><div class="card-val">${vis.length}</div><div class="card-pct">${F.unidade || F.setor ? 'no recorte' : 'três lojas, sem pró-labore'}</div></div>
      <div class="card neutral"><div class="card-lbl">Salário base por mês</div><div class="card-val">${cgR0(totSal)}</div><div class="card-pct">média ${cgR0(vis.length ? totSal / vis.length : 0)}</div></div>
      <div class="card blue"><div class="card-lbl">Custo previsto por mês</div><div class="card-val">${cgR0(totPrev)}</div><div class="card-pct">com VT, VA, FGTS, 13º e férias</div></div>
      <div class="card ${fora.length ? 'highlight' : 'neutral'}"><div class="card-lbl">Salário fora da tabela</div><div class="card-val">${fora.length}</div><div class="card-pct">${fora.length ? 'valor não bate com o cargo' : 'todo mundo enquadrado'}</div></div>
      ${CARGOS.cs.size && !F.desligados ? `<div class="card ${nConf ? 'highlight' : 'neutral'}" style="cursor:pointer;" onclick="CARGOS_F.soConferir=!CARGOS_F.soConferir;renderModuloCargos()" title="cadastro, folha da contabilidade e Flash não batem — clique para filtrar">
        <div class="card-lbl">A conferir ${F.soConferir ? '(filtrando ✕)' : ''}</div><div class="card-val">${nConf}</div><div class="card-pct">${nConf ? 'cadastro × folha × Flash' : 'as três fontes batem'}${cgFlashDaLoja(CARGOS.flash).length ? ` · ${cgFlashDaLoja(CARGOS.flash).length} correções na Flash` : ''}</div></div>` : ''}
    </div>
    ${cgFiltroUnidade(base)}
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin:-4px 0 10px;align-items:center;">
      ${setores.map(s => cgChip(s, F.setor === s, `cargosFiltrar('setor','${cgEsc(s)}')`)).join('')}
      <span style="flex:1"></span>
      <button type="button" class="preset-btn" onclick="CARGOS_F.desligados=!CARGOS_F.desligados;renderModuloCargos()">${F.desligados ? 'Ver quem está na folha' : 'Ver desligados'}</button>
      <button type="button" class="preset-btn" onclick="cgEditar(0)">+ Nova pessoa</button>
    </div>`;
  const avisos = vis.filter(p => p.obs_rh);
  if (avisos.length) h += `<div class="contexto">Para o RH: ${avisos.map(p => `<b>${cgEsc(cgNome(p.nome).split(' ')[0])}</b> — ${cgEsc(String(p.obs_rh).toLowerCase())}`).join('; ')}.</div>`;
  if (F.editando === 0) h += cgFormPessoa(null);
  h += `<div id="tabelaCgPessoas" style="overflow-x:auto;"><table>
    <thead><tr><th>Loja</th><th>Nome</th><th>Cargo</th><th style="text-align:right;">Jornada</th><th style="text-align:right;">Salário</th><th>Tabela</th><th>Setor</th><th>Turno</th><th style="text-align:right;">VT</th><th>VA</th><th>Adiant.</th><th style="text-align:right;">Custo previsto</th><th>Admissão</th>${CARGOS.cs.size ? `<th style="text-align:right;">Folha ${comp ? cgMesRot(comp) : ''}</th><th>Flash</th><th>Conferir</th>` : ''}<th></th></tr></thead>
    <tbody>${vis.map(p => `<tr>
      <td>${cgEsc(p.unidade)}</td>
      <td>${cgEsc(cgNome(p.nome))}${p.contrato !== 'CLT' ? ` <span style="font-size:10px;color:var(--farol-perto);">${cgEsc(p.contrato.toLowerCase())}</span>` : ''}</td>
      <td title="${cgEsc(p.cargo_completo || '')}">${cgEsc(cgNome(p.cargo_completo || p.cargo))}</td>
      <td style="text-align:right;">${p.horas ? p.horas + 'h' : '–'}</td>
      <td style="text-align:right;">${cgR(p.salario)}</td>
      <td>${sit(p)}</td>
      <td>${p.setor_rateio ? `<a href="javascript:void(0)" onclick="cargosFiltrar('setor','${cgEsc(p.setor_rateio)}')" style="color:inherit;">${cgEsc(p.setor_rateio)}</a>` : '<span style="color:var(--farol-perto);">sem setor</span>'}</td>
      <td>${cgEsc(p.turno || '–')}</td>
      <td style="text-align:right;" title="${p.vt_por_dia} por dia × ${p.vt_dias} dias">${p.vt_por_dia ? cgR(p.vt_previsto) : '–'}</td>
      <td>${p.recebe_va ? 'sim' : 'não'}</td>
      <td>${p.pega_adiantamento && p.contrato === 'CLT' ? 'sim' : 'não'}</td>
      <td style="text-align:right;font-weight:600;">${cgR(p.custo_previsto)}</td>
      <td>${cgData(p.admissao)}${p.desligamento ? `<br><span style="font-size:11px;color:var(--tx-4);">saiu ${cgData(p.desligamento)}</span>` : ''}</td>
      ${CARGOS.cs.size ? cgColunasConferir(cs(p), p) : ''}
      <td><a href="javascript:void(0)" onclick="cgEditar(${p.id})" style="font-size:12px;">editar</a></td>
    </tr>${F.editando === p.id ? `<tr><td colspan="${CARGOS.cs.size ? 17 : 14}">${cgFormPessoa(p)}${cgPagouHtml(p)}</td></tr>` : ''}`).join('')}</tbody>
    <tfoot><tr class="sub"><td colspan="4">Total</td><td style="text-align:right;">${cgR(totSal)}</td><td colspan="6"></td><td style="text-align:right;">${cgR(totPrev)}</td><td colspan="${CARGOS.cs.size ? 5 : 2}"></td></tr></tfoot>
  </table></div>
  <div class="contexto" style="margin-top:8px;">Custo previsto = salário + VT + VA + FGTS 8% + 13º e férias provisionados (com FGTS). O realizado, do contas a pagar, está na tela Custo da folha.</div>`;
  // 29/10/2026 (dono): "Correções na Flash" entrou no "A conferir" — filtrando, a lista do que corrigir na Flash vem junto
  if (F.soConferir && cgFlashDaLoja(CARGOS.flash).length) h += `<div class="section-label" style="text-align:left;">O que corrigir na Flash</div>` + cgListaFlash(CARGOS.flash);
  return h;
}
function cgEmMontagem(titulo, texto) {
  return `<div class="contexto" style="text-align:left;border-color:var(--farol-perto);"><b>${cgEsc(titulo)} — em montagem.</b><div style="margin-top:6px;">${cgEsc(texto)}</div>
    <div style="margin-top:6px;color:var(--tx-4);font-size:12px;">Os números estão sendo conferidos pelo RH; esta parte entra aqui quando estiverem prontos.</div></div>`;
}
function cgEditar(id) {
  CARGOS_F.editando = CARGOS_F.editando === id ? null : id; renderModuloCargos();
  if (CARGOS_F.editando && CARGOS.cs && CARGOS.pagou[id] === undefined) cgPagouCarregar(id);
}
function cgLista(v) { return Array.isArray(v) ? v.filter(Boolean) : v ? String(v).split(';').map((s) => s.trim()).filter(Boolean) : []; }
// as três colunas da conferência: o salário que a folha pagou, a Flash e o que não bate (textos da vw_rh_cargos_salarios)
function cgColunasConferir(c, p) {
  if (!c) return '<td></td><td></td><td></td>';
  const fs = c.folha_salario == null ? '<span style="color:var(--tx-5);">–</span>'
    : `${cgR(c.folha_salario)}${cgN(c.folha_salario) === cgN(p.salario) ? ' <span style="color:var(--farol-ok);">✓</span>' : ''}`;
  const fl = !c.flash_status ? '<span style="color:var(--tx-5);">–</span>'
    : c.flash_status === 'ACTIVE' ? '<span style="color:var(--farol-ok);">✓ ativo</span>' : `<span style="color:var(--farol-perto);">${cgEsc(String(c.flash_status).toLowerCase())}</span>`;
  const cf = cgLista(c.conferencia);
  return `<td style="text-align:right;white-space:nowrap;">${fs}</td><td style="white-space:nowrap;">${fl}</td>
    <td style="font-size:11.5px;color:var(--farol-perto);white-space:normal;min-width:140px;">${cf.map(cgEsc).join('<br>')}</td>`;
}
// "O que a contabilidade pagou": as rubricas da última folha fechada da pessoa (rh_folha_mensal + rh_folha_rubrica)
async function cgPagouCarregar(id) {
  CARGOS.pagou[id] = null;
  try {
    const m = (await consultarTudo(`rh_folha_mensal?select=*&pessoa_id=eq.${id}&order=competencia.desc&limit=1`))[0];
    if (!m) { CARGOS.pagou[id] = { vazio: true }; }
    else {
      const rub = await consultarTudo(`rh_folha_rubrica?select=*&competencia=eq.${m.competencia}&empresa=eq.${encodeURIComponent(m.empresa)}&matricula=eq.${encodeURIComponent(m.matricula)}&order=ordem`);
      CARGOS.pagou[id] = { m, rub };
    }
  } catch (e) { CARGOS.pagou[id] = { erro: e.message }; }
  if (CARGOS_F.editando === id) renderModuloCargos();
}
function cgPagouHtml(p) {
  if (!CARGOS.cs || !CARGOS.cs.size) return '';
  const x = CARGOS.pagou[p.id];
  if (x === undefined || x === null) return '<div class="contexto" style="text-align:left;">Lendo o que a contabilidade pagou…</div>';
  if (x.erro) return `<div class="contexto" style="text-align:left;">Não consegui ler a folha: ${cgEsc(x.erro)}</div>`;
  if (x.vazio) return '<div class="contexto" style="text-align:left;">Ainda não há folha fechada da contabilidade para esta pessoa.</div>';
  const { m, rub } = x;
  return `<div class="section-label" style="margin-top:6px; text-align:left;">O que a contabilidade pagou — ${cgMesRot(m.competencia)} · ${cgEsc(m.empresa)}</div>
    <div id="tabelaCgPagou" style="overflow-x:auto; max-width:680px;"><table><thead><tr><th>Rubrica</th><th style="text-align:right;">Referência</th><th style="text-align:right;">Provento</th><th style="text-align:right;">Desconto</th></tr></thead><tbody>
    ${rub.map((r) => `<tr><td>${cgEsc(r.codigo)} · ${cgEsc(r.rubrica)}</td><td style="text-align:right;color:var(--tx-4);">${cgEsc(r.referencia || '')}</td>
      <td style="text-align:right;color:var(--farol-ok);">${r.tipo === 'P' ? cgR(r.valor) : ''}</td><td style="text-align:right;color:var(--tx-3);">${r.tipo === 'D' ? cgR(r.valor) : ''}</td></tr>`).join('')}
    </tbody><tfoot><tr class="sub"><td colspan="2">Proventos ${cgR(m.proventos)} · descontos ${cgR(m.descontos)} · <b>líquido ${cgR(m.liquido)}</b>${m.fgts != null ? ` · FGTS ${cgR(m.fgts)}` : ''}</td><td></td><td></td></tr></tfoot></table></div>`;
}

function cgFormPessoa(p) {
  const v = p || { unidade: CARGOS_F.unidade || 'AGUA VERDE', contrato: 'CLT', horas: 220, recebe_va: true, pega_adiantamento: true, recebe_bonificacao: true, usa_ponto: true, no_plano: true, vt_por_dia: 2, vt_dias: 24, apelidos: [] };
  const id = p ? p.id : 0;
  const cargos = [...new Set(CARGOS.tabela.map(t => t.cargo))].sort();
  const sel = (nome, opcoes, atual) => `<select id="cgF_${nome}_${id}" style="width:100%">${opcoes.map(o =>
    `<option value="${cgEsc(o)}" ${String(o) === String(atual == null ? '' : atual) ? 'selected' : ''}>${cgEsc(o === '' ? '—' : o)}</option>`).join('')}</select>`;
  const inp = (nome, atual, tipo = 'text') => `<input id="cgF_${nome}_${id}" type="${tipo}" value="${cgEsc(atual == null ? '' : atual)}" style="width:100%">`;
  const chk = (nome, atual, rot) => `<label style="display:inline-flex;gap:4px;align-items:center;margin-right:12px;"><input id="cgF_${nome}_${id}" type="checkbox" ${atual ? 'checked' : ''}>${rot}</label>`;
  const campo = (rot, html) => `<label style="display:flex;flex-direction:column;gap:2px;font-size:11px;color:var(--tx-4);">${rot}${html}</label>`;
  return `<div style="background:var(--surface-2);border:1px solid var(--line);border-radius:6px;padding:12px;margin:8px 0;">
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;">
      ${campo('Nome completo', inp('nome', v.nome))}
      ${campo('Loja', sel('unidade', ['AGUA VERDE', 'AHU', 'SÃO BRAZ'], v.unidade))}
      ${campo('Empresa da folha', sel('empresa', ['', 'FF AGUA VERDE', 'CIDADAO AV', 'CIDADAO AHU', 'FF SAO BRAZ'], v.empresa))}
      ${campo('Contrato', sel('contrato', ['CLT', 'INTERMITENTE', 'SEM REGISTRO'], v.contrato))}
      ${campo('Cargo do plano', `<input id="cgF_cargo_${id}" list="cgCargos" value="${cgEsc(v.cargo || '')}" style="width:100%" onchange="cgSugerirSalario(${id})"><datalist id="cgCargos">${cargos.map(c => `<option value="${cgEsc(c)}">`).join('')}</datalist>`)}
      ${campo('Setor no nome do cargo', sel('departamento', ['', ...CG_DEPTOS], v.departamento))}
      ${campo('Nome do cargo com setor', inp('cargo_completo', v.cargo_completo))}
      ${campo('Jornada (horas/mês)', sel('horas', ['180', '220'], v.horas))}
      ${campo('Salário base', inp('salario', v.salario, 'number'))}
      ${campo('Setor do rateio dos canais', sel('setor_rateio', ['', ...CG_SETORES], v.setor_rateio))}
      ${campo('Turno', sel('turno', ['', 'DIA', 'NOITE', 'DIA/ NOITE'], v.turno))}
      ${campo('VT por dia', inp('vt_por_dia', v.vt_por_dia, 'number'))}
      ${campo('Dias de trabalho no mês', inp('vt_dias', v.vt_dias, 'number'))}
      ${campo('Admissão', inp('admissao', v.admissao ? String(v.admissao).slice(0, 10) : '', 'date'))}
      ${campo('Desligamento', inp('desligamento', v.desligamento ? String(v.desligamento).slice(0, 10) : '', 'date'))}
      ${campo('Matrícula', inp('matricula', v.matricula))}
      ${campo('Como aparece no contas a pagar', inp('apelidos', [v.apelido, ...(v.apelidos || [])].filter(Boolean).join(', ')))}
      ${campo('Observação para o RH', inp('obs_rh', v.obs_rh))}
    </div>
    <div style="margin-top:8px;font-size:12px;">${chk('recebe_va', v.recebe_va, 'recebe VA')}${chk('pega_adiantamento', v.pega_adiantamento, 'pega adiantamento')}${chk('recebe_bonificacao', v.recebe_bonificacao, 'recebe bonificação')}${chk('usa_ponto', v.usa_ponto, 'bate ponto na Flash')}${chk('no_plano', v.no_plano, 'está no plano de cargos')}</div>
    <div id="cgSug_${id}" style="font-size:12px;color:var(--tx-4);margin-top:6px;"></div>
    <div style="margin-top:8px;display:flex;gap:8px;"><button type="button" class="preset-btn active" onclick="cgSalvar(${id})">Salvar</button><button type="button" class="preset-btn" onclick="cgEditar(${id})">Cancelar</button></div>
  </div>`;
}
function cgSugerirSalario(id) {
  const g = (n) => document.getElementById(`cgF_${n}_${id}`);
  const cargo = (g('cargo').value || '').toUpperCase().trim();
  const und = g('unidade').value === 'SÃO BRAZ' ? 'SÃO BRAZ' : 'AGUA VERDE';
  const t = CARGOS.tabela.find(x => x.unidade === und && x.cargo === cargo && String(x.horas) === g('horas').value);
  const el = document.getElementById('cgSug_' + id);
  if (t) { el.innerHTML = `Tabela: ${cgR(t.salario)} <a href="javascript:void(0)" onclick="document.getElementById('cgF_salario_${id}').value='${t.salario}'">usar</a>`; }
  else el.textContent = '';
}
async function cgSalvar(id) {
  const g = (n) => document.getElementById(`cgF_${n}_${id}`);
  const nomes = g('apelidos').value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  const cargo = g('cargo').value.toUpperCase().trim();
  const m = cargo.match(/^([A-ZÇÃÕÁÉÍÓÚÂÊ]+).*?NIVEL\s*(\d)/);
  const corpo = {
    nome: g('nome').value, unidade: g('unidade').value, empresa: g('empresa').value, contrato: g('contrato').value,
    cargo, cargo_completo: g('cargo_completo').value, departamento: g('departamento').value,
    familia: m ? m[1].replace(/^COZINHEIR.*/, 'COZINHEIRO') : '', nivel: m ? m[2] : '',
    horas: g('horas').value, salario: g('salario').value, setor_rateio: g('setor_rateio').value, turno: g('turno').value,
    vt_por_dia: g('vt_por_dia').value, vt_dias: g('vt_dias').value, admissao: g('admissao').value,
    desligamento: g('desligamento').value, matricula: g('matricula').value, obs_rh: g('obs_rh').value,
    apelido: nomes[0] || '', apelidos: nomes.slice(1),
    recebe_va: g('recebe_va').checked, pega_adiantamento: g('pega_adiantamento').checked, recebe_bonificacao: g('recebe_bonificacao').checked,
    usa_ponto: g('usa_ponto').checked, no_plano: g('no_plano').checked,
  };
  if (!corpo.nome || !cargo || !corpo.salario) { cgAviso('Preencha nome, cargo e salário.', false); return; }
  avisoAcao('enviando', 'Gravando…');
  const r = await trRpcSeguro('rh_pessoa_salvar', { p_id: id || null, p: corpo });
  if (!r.ok) { cgAviso('Não deu: ' + await trErroDe(r), false); return; }
  CARGOS_F.editando = null;
  await cgRecarregar('Salvo. O setor já vale para o rateio dos canais; o custo realizado se atualiza com a próxima carga do contas a pagar.');
}

// ---------- TABELA DE CARGOS ----------
function cgAbaTabela() {
  const ordem = ['AUXILIAR', 'ASSISTENTE', 'COZINHEIRO', 'ESTOQUISTA', 'LIDER', 'SUPERVISOR', 'GERENTE'];
  const unid = [...new Set(CARGOS.tabela.map(t => t.unidade))];
  const ocup = {};
  for (const p of CARGOS.pessoas.filter(p => p.ativo && p.no_plano)) {
    const u = p.unidade === 'SÃO BRAZ' ? 'SÃO BRAZ' : 'AGUA VERDE';
    const k = `${u}|${p.familia}|${p.nivel}|${p.horas}`; ocup[k] = (ocup[k] || 0) + 1;
  }
  let h = `<div class="contexto">Salário base bruto depois do dissídio de 6,11% (vigência ${cgMesRot(CARGOS.tabela[0] && CARGOS.tabela[0].vigencia)}). O Ahú usa a tabela da Água Verde. O setor (Atendimento, Cozinha, Produção, Operacional, Limpeza) entra só no nome do cargo — o salário é o do cargo. Entre parênteses, quantas pessoas estão em cada célula.</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:14px;">`;
  for (const u of unid) {
    const linhas = {};
    for (const t of CARGOS.tabela.filter(t => t.unidade === u)) (linhas[t.cargo] = linhas[t.cargo] || { fam: t.familia, nivel: t.nivel, cargo: t.cargo })[t.horas] = t.salario;
    const ord = Object.values(linhas).sort((a, b) => (ordem.indexOf(a.fam) - ordem.indexOf(b.fam)) || (cgN(a.nivel) - cgN(b.nivel)));
    const cel = (l, hs) => { const n = ocup[`${u}|${l.fam}|${l.nivel}|${hs}`]; return l[hs] != null ? `${cgR(l[hs])}${n ? ` <span style="color:var(--tx-4);font-size:11px;">(${n})</span>` : ''}` : '–'; };
    h += `<div><div style="font-size:12px;color:var(--tx-4);margin-bottom:4px;">${cgEsc(u)}</div>
      <div id="tabelaCgTabela${u.replace(/\W/g, '')}"><table><thead><tr><th>Cargo</th><th style="text-align:right;">180 h</th><th style="text-align:right;">220 h</th></tr></thead>
      <tbody>${ord.map(l => `<tr><td>${cgEsc(cgNome(l.cargo))}</td><td style="text-align:right;">${cel(l, 180)}</td><td style="text-align:right;">${cel(l, 220)}</td></tr>`).join('')}</tbody></table></div></div>`;
  }
  return h + '</div>';
}

// ---------- CUSTO REALIZADO POR PESSOA ----------
function cgMesesCusto() { return [...new Set(CARGOS.conf.map(c => String(c.mes).slice(0, 10)))].sort().reverse(); }
function cgAbaCusto() {
  const F = CARGOS_F;
  const meses = cgMesesCusto();
  const mes = meses.includes(F.mes) ? F.mes : (meses[1] || meses[0]);   // padrão: o último mês fechado
  const linhas = CARGOS.custo.filter(c => String(c.mes).slice(0, 10) === mes && (!F.unidade || c.unidade === F.unidade))
                             .sort((a, b) => cgN(b.total) - cgN(a.total));
  const conf = CARGOS.conf.filter(c => String(c.mes).slice(0, 10) === mes && (!F.unidade || c.unidade === F.unidade));
  const soma = (k) => linhas.reduce((s, c) => s + cgN(c[k]), 0);
  const total = soma('total'), prev = conf.some(c => c.tem_previsto);
  const ex = linhas.filter(c => c.fora_do_cadastro);
  let h = cgSeletorMes(meses.slice(0, 6), mes) + cgFiltroUnidade(CARGOS.conf) + `
    <div class="cards">
      <div class="card blue"><div class="card-lbl">Custo da folha no mês</div><div class="card-val">${cgR0(total)}</div><div class="card-pct">${prev ? 'ainda com provisões do Saipos' : 'tudo pago'}</div></div>
      <div class="card neutral"><div class="card-lbl">Pessoas com lançamento</div><div class="card-val">${linhas.length}</div><div class="card-pct">${ex.length ? `${ex.length} fora do cadastro (ex-funcionários)` : 'todas no cadastro'}</div></div>
      <div class="card neutral"><div class="card-lbl">Guias e gastos rateados</div><div class="card-val">${cgR0(soma('encargos_rateados') + soma('outros_rateados'))}</div><div class="card-pct">INSS, FGTS, medicina, uniforme…</div></div>
      <div class="card neutral"><div class="card-lbl">Empréstimos e vales fora</div><div class="card-val">${cgR0(conf.reduce((s, c) => s + cgN(c.emprestimos_fora), 0))}</div><div class="card-pct">voltam pelo desconto em folha</div></div>
    </div>
    <div id="tabelaCgCusto" style="overflow-x:auto;"><table>
      <thead><tr><th>Loja</th><th>Nome</th><th>Setor</th><th style="text-align:right;">Salário e adiant.</th><th style="text-align:right;">VT</th><th style="text-align:right;">VA</th><th style="text-align:right;">Rescisão, férias, 13º</th><th style="text-align:right;">Bonificação</th><th style="text-align:right;">Encargos (rateio)</th><th style="text-align:right;">Outros (rateio)</th><th style="text-align:right;">Total</th></tr></thead>
      <tbody>${linhas.map(c => `<tr>
        <td>${cgEsc(c.unidade)}</td><td>${cgEsc(cgNome(c.nome))}${c.fora_do_cadastro ? ' <span style="font-size:10px;color:var(--tx-4);">ex-funcionário</span>' : ''}</td>
        <td>${cgEsc(c.setor_rateio || '–')}</td>
        <td style="text-align:right;">${cgR(c.salario)}</td><td style="text-align:right;">${cgR(c.vt)}</td><td style="text-align:right;">${cgR(c.va)}</td>
        <td style="text-align:right;">${cgR(c.rescisao_ferias_13)}</td><td style="text-align:right;">${cgR(c.bonificacao)}</td>
        <td style="text-align:right;color:var(--tx-4);">${cgR(c.encargos_rateados)}</td><td style="text-align:right;color:var(--tx-4);">${cgR(cgN(c.outros_rateados) + cgN(c.outros_diretos))}</td>
        <td style="text-align:right;font-weight:600;">${cgR(c.total)}</td></tr>`).join('')}</tbody>
      <tfoot><tr class="sub"><td colspan="3">Total</td><td style="text-align:right;">${cgR(soma('salario'))}</td><td style="text-align:right;">${cgR(soma('vt'))}</td><td style="text-align:right;">${cgR(soma('va'))}</td><td style="text-align:right;">${cgR(soma('rescisao_ferias_13'))}</td><td style="text-align:right;">${cgR(soma('bonificacao'))}</td><td style="text-align:right;">${cgR(soma('encargos_rateados'))}</td><td style="text-align:right;">${cgR(soma('outros_rateados') + soma('outros_diretos'))}</td><td style="text-align:right;">${cgR(total)}</td></tr></tfoot>
    </table></div>
    <div class="contexto" style="margin-top:8px;">Do contas a pagar, os 18 subtipos de folha da DRE (menos empréstimos e vales). Guia e gasto coletivo entram pela parte do salário de cada um no mês.</div>`;
  return h;
}

// ---------- POR SETOR (o rateio dos canais) ----------
function cgAbaSetor() {
  const F = CARGOS_F;
  const meses = cgMesesCusto();
  const mes = meses.includes(F.mes) ? F.mes : (meses[1] || meses[0]);
  const linhas = CARGOS.setor.filter(s => String(s.mes).slice(0, 10) === mes && (!F.unidade || s.unidade === F.unidade));
  const tot = linhas.reduce((s, x) => s + cgN(x.total), 0);
  const sem = linhas.filter(s => s.setor === 'SEM SETOR').reduce((s, x) => s + cgN(x.total), 0);
  const soma = (k) => cgR(linhas.reduce((s, x) => s + cgN(x[k]), 0));
  return cgSeletorMes(meses.slice(0, 6), mes) + cgFiltroUnidade(CARGOS.conf) + `
    ${sem > 0.5 ? `<div class="contexto" style="border-color:var(--farol-perto);">${cgR0(sem)} sem setor neste mês: gente que não está no cadastro. Cadastre (ou dê o setor) na aba Pessoas.</div>` : ''}
    <div id="tabelaCgSetor" style="overflow-x:auto;"><table>
      <thead><tr><th>Loja</th><th>Setor</th><th style="text-align:right;">Pessoas</th><th style="text-align:right;">Salário</th><th style="text-align:right;">VT e VA</th><th style="text-align:right;">Outros diretos</th><th style="text-align:right;">Rateados</th><th style="text-align:right;">Total</th><th style="text-align:right;">% da loja</th></tr></thead>
      <tbody>${linhas.map(s => `<tr><td>${cgEsc(s.unidade)}</td><td>${cgEsc(s.setor)}</td><td style="text-align:right;">${cgN(s.pessoas)}</td>
        <td style="text-align:right;">${cgR(s.salario)}</td><td style="text-align:right;">${cgR(s.beneficios)}</td><td style="text-align:right;">${cgR(s.outros_diretos)}</td>
        <td style="text-align:right;color:var(--tx-4);">${cgR(s.rateados)}</td><td style="text-align:right;font-weight:600;">${cgR(s.total)}</td>
        <td style="text-align:right;">${(100 * cgN(s.share)).toFixed(0)}%</td></tr>`).join('')}</tbody>
      <tfoot><tr class="sub"><td colspan="3">Total</td><td style="text-align:right;">${soma('salario')}</td><td style="text-align:right;">${soma('beneficios')}</td><td style="text-align:right;">${soma('outros_diretos')}</td><td style="text-align:right;">${soma('rateados')}</td><td style="text-align:right;">${cgR(tot)}</td><td></td></tr></tfoot>
    </table></div>
    <div class="contexto" style="margin-top:8px;">É o setor de cada pessoa no cadastro que reparte a folha entre os canais em Resultado por canal. Trocou o setor de alguém, o rateio acompanha.</div>`;
}

// ---------- VT E VA DO MÊS ----------
function cgAbaVtVa() {
  const F = CARGOS_F;
  const meses = [...new Set(CARGOS.vtva.map(v => String(v.mes).slice(0, 10)))].sort().reverse();
  const prox = cgMesIso(1);
  if (!meses.includes(prox)) meses.unshift(prox);
  const mes = meses.includes(F.mes) ? F.mes : meses[0];
  const linhas = CARGOS.vtva.filter(v => String(v.mes).slice(0, 10) === mes && (!F.unidade || v.unidade === F.unidade));
  const fechado = linhas.length && linhas.every(v => v.fechado_em);
  const totVt = linhas.reduce((s, v) => s + cgN(v.vt_valor), 0), totVa = linhas.reduce((s, v) => s + cgN(v.va_valor), 0);
  const porEmp = {};
  for (const v of linhas) { const k = v.empresa || v.unidade; porEmp[k] = (porEmp[k] || 0) + cgN(v.vt_valor) + cgN(v.va_valor); }
  let h = cgSeletorMes(meses.slice(0, 4), mes) + cgFiltroUnidade(CARGOS.pessoas) + `
    <div class="cards">
      <div class="card blue"><div class="card-lbl">VT + VA de ${cgMesRot(mes)}</div><div class="card-val">${cgR0(totVt + totVa)}</div><div class="card-pct">VT ${cgR0(totVt)} · VA ${cgR0(totVa)}</div></div>
      <div class="card neutral"><div class="card-lbl">Por empresa</div><div class="card-val" style="font-size:14px;line-height:1.5;">${Object.entries(porEmp).map(([k, v]) => `${cgEsc(k)}: ${cgR0(v)}`).join('<br>') || '–'}</div></div>
      <div class="card ${fechado ? 'pos' : 'highlight'}"><div class="card-lbl">Situação</div><div class="card-val" style="font-size:16px;">${!linhas.length ? 'não calculado' : fechado ? 'fechado' : 'aberto'}</div><div class="card-pct">${fechado ? `por ${cgEsc(linhas[0].fechado_por || '')}` : 'calcula sozinho no último dia útil'}</div></div>
    </div>
    ${linhas.length ? (() => { const dt = (k) => linhas.map((v) => v[k]).filter(Boolean).sort().pop();
      const fx = (s) => s ? new Date(s).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', ' às') : '';
      const ca = dt('calculado_em'), fe = dt('fechado_em'), en = dt('enviado_em');
      return `<div style="font-size:13px;margin:-4px 0 10px;color:var(--tx-3);">${ca ? 'Calculado em ' + fx(ca) : 'Não calculado'} · ${fe ? '<span style="color:var(--farol-ok);">fechado em ' + fx(fe) + '</span>' : 'não fechado'} · ${en ? '<span style="color:var(--farol-ok);">enviado em ' + fx(en) + '</span>' : 'não enviado'}</div>`; })() : ''}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
      ${!fechado ? `<button type="button" class="preset-btn" onclick="cgVtCalcular('${mes}')">${linhas.length ? 'Recalcular' : 'Calcular agora'}</button>` : ''}
      ${linhas.length ? `<button type="button" class="preset-btn ${fechado ? '' : 'active'}" onclick="cgVtFechar('${mes}', ${fechado})">${fechado ? 'Reabrir' : 'Fechar o mês'}</button>` : ''}
    </div>`;
  if (!linhas.length) return h + `<div class="contexto">O VT e o VA de ${cgMesRot(mes)} são calculados sozinhos no último dia útil do mês anterior. Para ver antes, use "Calcular agora".</div>`;
  h += `<div id="tabelaCgVtVa" style="overflow-x:auto;"><table>
    <thead><tr><th>Loja</th><th>Nome</th><th style="text-align:right;">Dias</th><th style="text-align:right;">Faltas</th><th style="text-align:right;">VT por dia</th><th style="text-align:right;">VT</th><th style="text-align:right;">VA</th><th style="text-align:right;">Total</th><th>Ajuste</th></tr></thead>
    <tbody>${linhas.map(v => `<tr>
      <td>${cgEsc(v.unidade)}</td><td>${cgEsc(cgNome(v.nome))}${v.editado ? ' <span style="font-size:10px;color:var(--farol-perto);">ajustado</span>' : ''}</td>
      <td style="text-align:right;">${fechado ? v.vt_dias : `<input id="cgV_d_${v.pessoa_id}" type="number" value="${v.vt_dias}" style="width:52px">`}</td>
      <td style="text-align:right;">${fechado ? v.faltas : `<input id="cgV_f_${v.pessoa_id}" type="number" value="${v.faltas}" style="width:52px">`}</td>
      <td style="text-align:right;">${fechado ? v.vt_por_dia : `<input id="cgV_p_${v.pessoa_id}" type="number" value="${v.vt_por_dia}" style="width:52px">`}</td>
      <td style="text-align:right;">${cgR(v.vt_valor)}</td>
      <td style="text-align:right;">${fechado ? cgR(v.va_valor) : `<input id="cgV_a_${v.pessoa_id}" type="number" value="${v.va_valor}" style="width:72px">`}</td>
      <td style="text-align:right;font-weight:600;">${cgR(cgN(v.vt_valor) + cgN(v.va_valor))}</td>
      <td>${fechado ? cgEsc(v.motivo || '') : `<input id="cgV_m_${v.pessoa_id}" placeholder="motivo" value="${cgEsc(v.motivo || '')}" style="width:120px"> <a href="javascript:void(0)" onclick="cgVtAjustar('${mes}', ${v.pessoa_id})" style="font-size:12px;">salvar</a>`}</td>
    </tr>`).join('')}</tbody>
    <tfoot><tr class="sub"><td colspan="5">Total</td><td style="text-align:right;">${cgR(totVt)}</td><td style="text-align:right;">${cgR(totVa)}</td><td style="text-align:right;">${cgR(totVt + totVa)}</td><td></td></tr></tfoot>
  </table></div>
  <div class="contexto" style="margin-top:8px;">VT = (dias − faltas do mês anterior na Flash) × vales por dia × ${cgR(6.13)}. Falta de 20 dias ou mais não desconta (é falta de batida). Fechado, o valor vai para a fila do robô acertar a provisão no Saipos.</div>`;
  h += cgFaltasFFHtml(mes, fechado, linhas);
  return h;
}
// 29/10/2026 (chat RH): a falta que a contabilidade descontou na folha e a Flash não passou ao VT (vw_rh_faltas_flash_folha)
function cgFaltasFFHtml(mes, fechado, linhas) {
  const F = CARGOS_F;
  const L = (CARGOS.faltasFF || []).filter((x) => x.usa_ponto !== false && cgLista(x.conferencia).length && (!F.unidade || x.unidade === F.unidade));
  if (!(CARGOS.faltasFF || []).length) return '';
  const noMes = new Set(linhas.map((v) => v.pessoa_id));
  // só a folha mais recente oferece o desconto: a falta de um mês velho já teve a vez dela (evita descontar duas vezes)
  const ultimo = (CARGOS.faltasFF || []).map((x) => String(x.mes)).sort().pop();
  return `<details ${L.length ? 'open' : ''} style="margin-top:14px;"><summary style="cursor:pointer;font-weight:700;">Faltas: Flash × folha ${L.length ? `<span style="color:var(--farol-perto);">(${L.length} para olhar)</span>` : '<span style="color:var(--farol-ok);">— batem</span>'}</summary>
    <div class="caption-label" style="text-align:left;margin:6px 0;">O que a contabilidade descontou de falta na folha contra o que a Flash passou para o VT. Dia descontado na folha e não no VT: use "descontar no próximo VT" (preenche o ajuste; você confere e salva).</div>
    ${L.length ? `<div id="tabelaCgFaltasFF" style="overflow-x:auto;"><table><thead><tr><th>Mês</th><th>Nome</th><th style="text-align:right;">Flash</th><th style="text-align:right;">Folha</th><th>O que não bate</th><th></th></tr></thead><tbody>
      ${L.map((x) => { const dif = cgN(x.dias_folha) - cgN(x.dias_flash);
        const pode = !fechado && dif > 0 && noMes.has(x.pessoa_id) && String(x.mes) === ultimo;
        return `<tr><td>${cgMesRot(x.mes)}</td><td>${cgEsc(cgNome(x.apelido || x.nome))}</td>
          <td style="text-align:right;">${cgN(x.dias_flash)} ${cgN(x.dias_flash) === 1 ? 'dia' : 'dias'}</td>
          <td style="text-align:right;">${cgN(x.dias_folha)} ${cgN(x.dias_folha) === 1 ? 'dia' : 'dias'}${cgN(x.valor_descontado_folha) ? ` <span style="color:var(--tx-4);">(${cgR(x.valor_descontado_folha)})</span>` : ''}</td>
          <td style="font-size:12px;color:var(--farol-perto);white-space:normal;">${cgLista(x.conferencia).map(cgEsc).join('<br>')}</td>
          <td>${pode ? `<a href="javascript:void(0)" style="font-size:12px;" onclick="cgFaltaDescontar(${x.pessoa_id}, ${dif}, '${cgEsc(cgMesRot(x.mes))}')">descontar no próximo VT</a>` : ''}</td></tr>`; }).join('')}
    </tbody></table></div>` : ''}</details>`;
}
function cgFaltaDescontar(pessoa, dias, mesTxt) {
  const f = document.getElementById('cgV_f_' + pessoa), m = document.getElementById('cgV_m_' + pessoa);
  if (!f) return avisoAcao('atencao', '! Esta pessoa não está no VT do mês aberto.');
  f.value = cgN(f.value) + dias; f.style.borderColor = 'var(--marca-amarelo)';
  if (m) m.value = `+${dias} ${dias === 1 ? 'falta' : 'faltas'} da folha de ${mesTxt} (não vieram da Flash)`;
  f.scrollIntoView({ block: 'center' }); f.focus();
  avisoAcao('atencao', `! Faltas somadas na linha (${dias}). Confira e clique em "salvar" na linha para gravar.`);
}
async function cgVtCalcular(mes) {
  avisoAcao('enviando', `Calculando o VT e o VA de ${cgMesRot(mes)}…`);
  const r = await trRpcSeguro('rh_vt_va_calcular', { p_mes: mes });
  if (!r.ok) { cgAviso('Não deu: ' + await trErroDe(r), false); return; }
  CARGOS_F.mes = mes; await cgRecarregar(`VT e VA de ${cgMesRot(mes)} calculados`);
}
async function cgVtFechar(mes, reabrir) {
  if (reabrir && !confirm(`Reabrir o VT e o VA de ${cgMesRot(mes)}? O valor fechado deixa de valer até fechar de novo.`)) return;
  avisoAcao('enviando', reabrir ? 'Reabrindo…' : `Fechando o VT e o VA de ${cgMesRot(mes)}…`);
  const r = await trRpcSeguro('rh_vt_va_fechar', { p_mes: mes, p_reabrir: !!reabrir });
  if (!r.ok) { cgAviso('Não deu: ' + await trErroDe(r), false); return; }
  CARGOS_F.mes = mes; await cgRecarregar(reabrir ? `VT e VA de ${cgMesRot(mes)} reabertos` : `VT e VA de ${cgMesRot(mes)} fechados — o robô acerta as provisões do Saipos por este valor`);
}
async function cgVtAjustar(mes, pessoa) {
  const g = (k) => { const el = document.getElementById(`cgV_${k}_${pessoa}`); return el && el.value !== '' ? Number(el.value) : null; };
  avisoAcao('enviando', 'Gravando o ajuste…');
  const r = await trRpcSeguro('rh_vt_va_ajustar', { p_mes: mes, p_pessoa: pessoa, p_vt_dias: g('d'), p_faltas: g('f'), p_vt_por_dia: g('p'), p_va: g('a'),
    p_motivo: (document.getElementById('cgV_m_' + pessoa) || {}).value || null });
  if (!r.ok) { cgAviso('Não deu: ' + await trErroDe(r), false); return; }
  CARGOS_F.mes = mes; await cgRecarregar('Ajuste salvo — o recálculo não mexe mais nesta linha.');
}

// ---------- CONFERÊNCIA DA FOLHA (29/10/2026, chat RH) ----------
// A folha fechada da contabilidade (Extrato Mensal, lido por script/rh_folha_mensal.py com prova ao centavo) contra as guias
// e o cadastro: vw_rh_folha_conferencia_empresa e _pessoa. Só consulta. Lida na primeira vez que a aba abre.
const CG_PESOU = [['horas_extras', 'horas extras'], ['adicional_noturno', 'adicional noturno'], ['dez_por_cento', '10% do salão'],
                  ['confianca', 'gratificação de confiança'], ['faltas_valor', 'faltas descontadas'], ['adiantamento', 'adiantamento descontado']];
async function cgFolhaCarregar() {
  CARGOS.folha = null;
  try {
    const [emp, pes] = await Promise.all([consultarTudo('vw_rh_folha_conferencia_empresa?select=*&order=competencia.desc,empresa'),
                                          consultarTudo('vw_rh_folha_conferencia_pessoa?select=*&order=competencia.desc,unidade,nome')]);
    CARGOS.folha = { emp, pes, rub: {} };
  } catch (e) { CARGOS.folha = { erro: e.message }; }
  if (CARGOS_F.aba === 'folha') renderModuloCargos();
}
function cgAbaFolha() {
  const F = CARGOS_F;
  if (CARGOS.folha === undefined) { cgFolhaCarregar(); return '<div class="contexto">Lendo a folha da contabilidade…</div>'; }
  if (CARGOS.folha === null) return '<div class="contexto">Lendo a folha da contabilidade…</div>';
  if (CARGOS.folha.erro) return `<div class="contexto">Não consegui ler a folha: ${cgEsc(CARGOS.folha.erro)}</div>`;
  const { emp, pes } = CARGOS.folha;
  const comps = [...new Set(emp.map((x) => String(x.competencia).slice(0, 10)))].sort().reverse();
  if (!comps.length) return '<div class="contexto">Nenhuma folha fechada da contabilidade no banco ainda.</div>';
  const comp = comps.includes(F.folhaComp) ? F.folhaComp : comps[0];
  const E = emp.filter((x) => String(x.competencia).slice(0, 10) === comp);
  const P = pes.filter((x) => String(x.competencia).slice(0, 10) === comp && (!F.unidade || x.unidade === F.unidade));
  const ok = (a, b) => Math.abs(cgN(a) - cgN(b)) < 0.01;
  let h = `<div style="display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 10px;">${comps.slice(0, 6).map((c) =>
      `<button type="button" class="preset-btn ${c === comp ? 'active' : ''}" onclick="CARGOS_F.folhaComp='${c}';CARGOS_F.folhaCol=null;CARGOS_F.folhaAberta=null;renderModuloCargos()">${cgMesRot(c)}</button>`).join('')}</div>
    <div class="caption-label" style="text-align:left;">A folha fechada que a contabilidade devolveu, conferida contra as guias do mês e o cadastro. Só consulta.</div>
    <div class="cards">${E.map((x) => `<div class="card ${cgLista(x.conferencia).length ? 'highlight' : 'neutral'}" style="text-align:left;">
      <div class="card-lbl">${cgEsc(String(x.empresa).replace(/^\d+\s*-\s*/, ''))}</div>
      <div class="card-val" style="font-size:18px;">${cgR0(x.liquido)} <span style="font-size:12px;color:var(--tx-4);font-weight:600;">líquido · ${cgN(x.pessoas)} pessoas</span></div>
      <div class="card-pct" style="line-height:1.6;">proventos ${cgR0(x.proventos)}<br>
        FGTS folha ${cgR(x.fgts_folha)} × guia ${x.fgts_guia == null ? '—' : cgR(x.fgts_guia)} ${x.fgts_guia != null && ok(x.fgts_folha, x.fgts_guia) ? '<span style="color:var(--farol-ok);">✓</span>' : ''}<br>
        consignado ${cgR(x.consignado_folha)} × ${x.consignado_guia == null ? '—' : cgR(x.consignado_guia)} ${x.consignado_guia != null && ok(x.consignado_folha, x.consignado_guia) ? '<span style="color:var(--farol-ok);">✓</span>' : ''}<br>
        INSS da guia ${x.inss_guia == null ? '—' : cgR(x.inss_guia)}${x.guia_vencimento ? ` · vence ${cgData(x.guia_vencimento)}` : ''}</div>
      ${cgLista(x.conferencia).length ? `<div style="font-size:11.5px;color:var(--farol-perto);margin-top:4px;">${cgLista(x.conferencia).map(cgEsc).join('<br>')}</div>` : ''}</div>`).join('')}</div>
    ${cgFiltroUnidade(CARGOS.pessoas)}
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px;align-items:center;"><b style="font-size:12.5px;">O que pesou:</b>
      ${CG_PESOU.map(([k, r]) => { const s = P.reduce((a, x) => a + cgN(x[k]), 0); if (!s) return '';
        return `<button type="button" class="preset-btn ${F.folhaCol === k ? 'active' : ''}" onclick="CARGOS_F.folhaCol=CARGOS_F.folhaCol==='${k}'?null:'${k}';renderModuloCargos()">${r} ${cgR0(s)}${F.folhaCol === k ? ' ✕' : ''}</button>`; }).join('')}
      ${(() => { const n = P.filter((x) => cgLista(x.conferencia).length).length; return n ? `<button type="button" class="preset-btn ${F.folhaCol === 'conf' ? 'active' : ''}" style="border-color:var(--farol-perto);" onclick="CARGOS_F.folhaCol=CARGOS_F.folhaCol==='conf'?null:'conf';renderModuloCargos()">a conferir ${n}${F.folhaCol === 'conf' ? ' ✕' : ''}</button>` : '<span style="font-size:12px;color:var(--farol-ok);">✓ ninguém a conferir</span>'; })()}</div>`;
  const vis = P.filter((x) => !F.folhaCol || (F.folhaCol === 'conf' ? cgLista(x.conferencia).length : cgN(x[F.folhaCol])));
  const sit = (x) => x.tem_rescisao ? 'saiu' : x.tem_ferias ? 'férias' : x.afastado ? 'afastado' : (x.situacao || '').toLowerCase();
  const v0 = (v) => cgN(v) ? cgR(v) : '<span style="color:var(--tx-5);">–</span>';
  h += `<div id="tabelaCgFolha" style="overflow-x:auto;"><table><thead><tr><th>Nome</th><th>Situação</th><th style="text-align:right;">Salário</th><th style="text-align:right;">Horas extras</th>
      <th style="text-align:right;">Ad. noturno</th><th style="text-align:right;">10%</th><th style="text-align:right;">Faltas</th><th style="text-align:right;">Adiantamento</th><th style="text-align:right;">Líquido</th><th>Conferir</th></tr></thead><tbody>
    ${vis.map((x) => { const k = `${x.empresa}|${x.matricula}`, ab = F.folhaAberta === k;
      return `<tr style="cursor:pointer;" onclick='cgFolhaAbrir(${cgEsc(JSON.stringify(k))})'>
        <td>${cgEsc(cgNome(x.apelido || x.nome))} <span style="font-size:11px;color:var(--tx-5);">${cgEsc(x.unidade || '')}</span></td>
        <td>${cgEsc(sit(x))}</td><td style="text-align:right;">${v0(x.salario_folha)}</td><td style="text-align:right;">${v0(x.horas_extras)}</td>
        <td style="text-align:right;">${v0(x.adicional_noturno)}</td><td style="text-align:right;">${v0(x.dez_por_cento)}</td><td style="text-align:right;">${v0(x.faltas_valor)}</td>
        <td style="text-align:right;">${v0(x.adiantamento)}</td><td style="text-align:right;font-weight:700;">${cgR(x.liquido)}</td>
        <td style="font-size:11.5px;color:var(--farol-perto);white-space:normal;min-width:160px;">${cgLista(x.conferencia).map(cgEsc).join('<br>')}</td></tr>
        ${ab ? `<tr><td colspan="10">${cgFolhaRubHtml(x)}</td></tr>` : ''}`; }).join('')}
    </tbody><tfoot><tr class="sub"><td colspan="8">${vis.length} ${vis.length === 1 ? 'pessoa' : 'pessoas'}</td><td style="text-align:right;">${cgR(vis.reduce((a, x) => a + cgN(x.liquido), 0))}</td><td></td></tr></tfoot></table></div>`;
  return h;
}
async function cgFolhaAbrir(k) {
  CARGOS_F.folhaAberta = CARGOS_F.folhaAberta === k ? null : k; renderModuloCargos();
  const comp = CARGOS_F.folhaComp || [...new Set(CARGOS.folha.emp.map((x) => String(x.competencia).slice(0, 10)))].sort().pop();
  const kk = comp + '|' + k;
  if (!CARGOS_F.folhaAberta || CARGOS.folha.rub[kk] !== undefined) return;
  CARGOS.folha.rub[kk] = null;
  const [empresa, matricula] = k.split('|');
  try { CARGOS.folha.rub[kk] = await consultarTudo(`rh_folha_rubrica?select=*&competencia=eq.${comp}&empresa=eq.${encodeURIComponent(empresa)}&matricula=eq.${encodeURIComponent(matricula)}&order=ordem`); }
  catch (e) { CARGOS.folha.rub[kk] = { erro: e.message }; }
  renderModuloCargos();
}
function cgFolhaRubHtml(x) {
  const kk = String(x.competencia).slice(0, 10) + '|' + x.empresa + '|' + x.matricula, R = CARGOS.folha.rub[kk];
  if (!R) return '<span style="color:var(--tx-4);">Lendo as rubricas…</span>';
  if (R.erro) return `Não consegui ler: ${cgEsc(R.erro)}`;
  return `<div id="tabelaCgFolhaRub" style="overflow-x:auto;max-width:680px;"><table><thead><tr><th>Rubrica</th><th style="text-align:right;">Referência</th><th style="text-align:right;">Provento</th><th style="text-align:right;">Desconto</th></tr></thead><tbody>
    ${R.map((r) => `<tr><td>${cgEsc(r.codigo)} · ${cgEsc(r.rubrica)}</td><td style="text-align:right;color:var(--tx-4);">${cgEsc(r.referencia || '')}</td>
      <td style="text-align:right;color:var(--farol-ok);">${r.tipo === 'P' ? cgR(r.valor) : ''}</td><td style="text-align:right;color:var(--tx-3);">${r.tipo === 'D' ? cgR(r.valor) : ''}</td></tr>`).join('')}
    </tbody><tfoot><tr class="sub"><td colspan="4">Proventos ${cgR(x.proventos)} · descontos ${cgR(x.descontos)} · <b>líquido ${cgR(x.liquido)}</b></td></tr></tfoot></table></div>`;
}

// ---------- FÉRIAS (29/10/2026, chat RH) ----------
// Período aquisitivo contado da admissão do registro; prazo de gozo = fim do concessivo (depois dele, dobro). Valor é estimativa:
// (salário + média de HE, ad. noturno, confiança e 10% das folhas no banco) ÷ 30 × dias × 4/3. Programar é na Flash (Hellen).
// situação da vw_rh_ferias (refeita 29/10 a partir da programação da contabilidade): vale o começo do texto
const CG_FER_COR = [['em dobro', 'var(--farol-fora)'], ['obrigatória', 'var(--farol-perto)'], ['pode dar', 'var(--tx-1)'], ['programada', 'var(--farol-ok)'],
                    ['em formação', 'var(--tx-4)'], ['fora do cadastro', 'var(--farol-perto)'], ['saiu', 'var(--tx-4)']];
async function cgFeriasCarregar() {
  CARGOS.ferias = null;
  try {
    const [per, gozo] = await Promise.all([consultarTudo('vw_rh_ferias?select=*&order=limite_gozo.nullslast,nome'),
                                           consultarTudo('vw_rh_ferias_gozo?select=*&order=inicio.desc').catch(() => [])]);
    CARGOS.ferias = { per, gozo };
  } catch (e) { CARGOS.ferias = { erro: e.message }; }
  if (CARGOS_F.aba === 'ferias') renderModuloCargos();
}
function cgAbaFerias() {
  const F = CARGOS_F;
  if (CARGOS.ferias === undefined) { cgFeriasCarregar(); return '<div class="contexto">Lendo as férias…</div>'; }
  if (CARGOS.ferias === null) return '<div class="contexto">Lendo as férias…</div>';
  if (CARGOS.ferias.erro) return `<div class="contexto">Não consegui ler as férias: ${cgEsc(CARGOS.ferias.erro)}</div>`;
  const { per, gozo } = CARGOS.ferias;
  const sit = (x) => String(x.situacao || '');
  const cor = (s) => (CG_FER_COR.find(([k]) => s.startsWith(k)) || [null, 'var(--tx-3)'])[1];
  const alerta = (x) => /^(em dobro|obrigatória)/.test(sit(x));
  const acao = (x) => /^(em dobro|obrigatória|pode dar|fora do cadastro)/.test(sit(x));
  const formacao = (x) => /^em formação/.test(sit(x));
  const U = per.filter((x) => !F.unidade || x.unidade === F.unidade);
  const podem = U.filter((x) => /^(pode dar|obrigatória|em dobro)/.test(sit(x)));
  const A = U.filter(alerta);
  let h = '';
  if (A.length) h += `<div class="contexto" style="text-align:left;border-color:var(--farol-fora);">${A.map((x) =>
      `<div style="color:${cor(sit(x))};font-weight:700;">${cgEsc(cgNome(x.apelido || x.nome))} — ${cgN(x.dias_a_gozar)} dias — começar até ${cgData(x.limite_gozo)} — ${cgEsc(sit(x))}</div>`).join('')}</div>`;
  else h += `<div class="contexto" style="text-align:left;border-color:var(--farol-ok);"><b style="color:var(--farol-ok);">✓ Nenhuma férias obrigatória ou em dobro agora.</b></div>`;
  h += `<div class="cards">
      <div class="card neutral"><div class="card-lbl">Dias que podem ser dados</div><div class="card-val">${podem.reduce((a, x) => a + cgN(x.dias_a_gozar), 0)}</div><div class="card-pct">${podem.length} ${podem.length === 1 ? 'período vencido' : 'períodos vencidos'}</div></div>
      <div class="card neutral"><div class="card-lbl">Valor estimado desses dias</div><div class="card-val">${cgR0(podem.reduce((a, x) => a + cgN(x.valor_estimado), 0))}</div><div class="card-pct">com 1/3 de férias</div></div>
      <div class="card blue"><div class="card-lbl">Provisão em formação</div><div class="card-val">${cgR0(U.filter(formacao).reduce((a, x) => a + cgN(x.valor_estimado), 0))}</div><div class="card-pct">${U.filter(formacao).length} períodos correndo</div></div>
    </div>
    ${cgFiltroUnidade(CARGOS.pessoas)}
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin:-4px 0 10px;">
      <button type="button" class="preset-btn ${F.ferAcao ? 'active' : ''}" onclick="CARGOS_F.ferAcao=!CARGOS_F.ferAcao;renderModuloCargos()">só o que pede ação${F.ferAcao ? ' ✕' : ''}</button>
      <button type="button" class="preset-btn ${F.ferFormacao ? 'active' : ''}" onclick="CARGOS_F.ferFormacao=!CARGOS_F.ferFormacao;renderModuloCargos()">${F.ferFormacao ? 'esconder' : 'mostrar'} os períodos em formação</button></div>`;
  const vis = U.filter((x) => (F.ferAcao ? acao(x) : (F.ferFormacao || !formacao(x))));
  const goz = (pid) => (gozo || []).filter((g) => g.pessoa_id === pid);
  h += `<div id="tabelaCgFerias" style="overflow-x:auto;"><table><thead><tr><th>Nome</th><th>Loja</th><th>Período aquisitivo</th><th>Limite para começar</th>
      <th style="text-align:right;">Dias a gozar</th><th>Marcado na Flash</th><th style="text-align:right;">Valor estimado</th><th>Situação</th></tr></thead><tbody>
    ${vis.map((x) => { const k = `${x.pessoa_id}|${x.aquisitivo_inicio}`, ab = F.ferAberta === k, G = goz(x.pessoa_id);
      return `<tr style="cursor:pointer;" onclick="CARGOS_F.ferAberta=CARGOS_F.ferAberta==='${k}'?null:'${k}';renderModuloCargos()">
        <td>${cgEsc(cgNome(x.apelido || x.nome))}</td><td>${cgEsc(x.unidade || '')}</td>
        <td>${cgData(x.aquisitivo_inicio)} a ${cgData(x.aquisitivo_fim)}</td><td>${cgData(x.limite_gozo)}</td>
        <td style="text-align:right;">${cgN(x.dias_a_gozar)}${cgN(x.dias_gozados) || cgN(x.faltas) ? ` <span style="font-size:11px;color:var(--tx-4);">de ${cgN(x.dias_direito)}</span>` : ''}</td>
        <td style="font-size:12px;">${cgN(x.dias_programados) ? `${cgN(x.dias_programados)} dias${x.programado_na_flash ? ' · ' + cgEsc(String(x.programado_na_flash)) : ''}` : '<span style="color:var(--tx-5);">nada</span>'}</td>
        <td style="text-align:right;">${cgN(x.valor_estimado) ? cgR(x.valor_estimado) : '–'}</td>
        <td style="color:${cor(sit(x))};font-weight:700;white-space:normal;">${cgEsc(sit(x))}</td></tr>
        ${ab ? `<tr><td colspan="8"><b>Férias conhecidas de ${cgEsc(cgNome(x.apelido || x.nome))}:</b> ${G.length ? G.map((g) => `${cgData(g.inicio)} a ${cgData(g.fim)} (${cgN(g.dias_quitados)} dias · ${cgEsc(g.origem || '')})`).join(' · ') : 'nenhuma registrada.'}${cgN(x.dias_afastamento) ? ` · afastamento de ${cgN(x.dias_afastamento)} dias estica o limite` : ''}${cgN(x.faltas) ? ` · ${cgN(x.faltas)} faltas reduzem os dias` : ''}</td></tr>` : ''}`; }).join('')}
    </tbody></table></div>
    <div class="caption-label" style="text-align:left;margin-top:6px;">Referência: programação de férias da contabilidade${(() => { const d = per.map((x) => x.data_base).filter(Boolean).sort().pop(); return d ? ' de ' + cgData(d) : ''; })()}. Pode dar a partir do vencimento do 1º período; obrigatória antes do limite para começar. Programar é na Flash (Hellen). Valor é estimativa.</div>`;
  return h;
}

// ---------- ADIANTAMENTO DO DIA 20 ----------
function cgAbaAdt() {
  const F = CARGOS_F;
  const meses = [...new Set(CARGOS.adt.map(a => String(a.mes).slice(0, 10)))].sort().reverse();
  const atual = cgMesIso(0), prox = cgMesIso(1);
  for (const m of [prox, atual]) if (!meses.includes(m)) meses.push(m);
  meses.sort().reverse();
  const mes = meses.includes(F.mes) ? F.mes : (CARGOS.adt.some(a => String(a.mes).slice(0, 10) === atual) ? atual : meses[0]);
  const linhas = CARGOS.adt.filter(a => String(a.mes).slice(0, 10) === mes && (!F.unidade || a.unidade === F.unidade));
  const tot = linhas.reduce((s, a) => s + cgN(a.valor), 0);
  const enviado = linhas.find(a => a.enviado_em);
  const dia = linhas[0] ? linhas[0].dia_pagamento : null;
  const fora = CARGOS.pessoas.filter(p => p.ativo && (!F.unidade || p.unidade === F.unidade) && !linhas.some(a => a.pessoa_id === p.id));
  let h = cgSeletorMes(meses.slice(0, 3), mes) + cgFiltroUnidade(CARGOS.pessoas) + `
    <div class="cards">
      <div class="card blue"><div class="card-lbl">Adiantamento de ${cgMesRot(mes)}</div><div class="card-val">${cgR0(tot)}</div><div class="card-pct">${linhas.length} pessoas${dia ? ` · pago em ${cgData(dia)}` : ''}</div></div>
      <div class="card ${enviado ? 'pos' : 'neutral'}"><div class="card-lbl">Lista para o RH</div><div class="card-val" style="font-size:16px;">${enviado ? 'enviada' : 'não enviada'}</div><div class="card-pct">${enviado ? cgData(enviado.enviado_em) : 'sai sozinha no dia 15 (dia útil antes)'}</div></div>
    </div>
    ${!enviado ? `<div style="margin-bottom:10px;"><button type="button" class="preset-btn" onclick="cgAdtGerar('${mes}')">${linhas.length ? 'Refazer a lista' : 'Montar a lista agora'}</button></div>` : ''}`;
  if (!linhas.length) return h + '<div class="contexto">A lista sai do cadastro: quem marca "pega adiantamento", 40% do salário (proporcional para quem entrou no mês).</div>';
  h += `<div id="tabelaCgAdt" style="overflow-x:auto;"><table>
    <thead><tr><th>Loja</th><th>Nome</th><th>Cargo</th><th style="text-align:right;">Salário</th><th style="text-align:right;">Dias</th><th style="text-align:right;">Adiantamento</th><th>Ajuste</th></tr></thead>
    <tbody>${linhas.map(a => `<tr><td>${cgEsc(a.unidade)}</td><td>${cgEsc(cgNome(a.nome))}${a.editado ? ' <span style="font-size:10px;color:var(--farol-perto);">ajustado</span>' : ''}</td>
      <td>${cgEsc(cgNome(a.cargo))}</td><td style="text-align:right;">${cgR(a.salario)}</td><td style="text-align:right;">${a.dias}/30</td>
      <td style="text-align:right;font-weight:600;">${enviado ? cgR(a.valor) : `<input id="cgA_v_${a.pessoa_id}" type="number" value="${a.valor}" style="width:90px">`}</td>
      <td>${enviado ? cgEsc(a.motivo || '') : `<input id="cgA_m_${a.pessoa_id}" placeholder="motivo" value="${cgEsc(a.motivo || '')}" style="width:120px"> <a href="javascript:void(0)" onclick="cgAdtAjustar('${mes}', ${a.pessoa_id})" style="font-size:12px;">salvar</a>`}</td></tr>`).join('')}</tbody>
    <tfoot><tr class="sub"><td colspan="5">Total</td><td style="text-align:right;">${cgR(tot)}</td><td></td></tr></tfoot>
  </table></div>
  ${fora.length ? `<div class="contexto" style="margin-top:8px;">Não pegam neste mês: ${fora.map(p => cgEsc(cgNome(p.nome).split(' ')[0])).join(', ')}. Para mudar, marque "pega adiantamento" na aba Pessoas.</div>` : ''}`;
  return h;
}
async function cgAdtGerar(mes) {
  avisoAcao('enviando', 'Gravando…');
  const r = await trRpcSeguro('rh_adiantamento_gerar', { p_mes: mes });
  if (!r.ok) { cgAviso('Não deu: ' + await trErroDe(r), false); return; }
  CARGOS_F.mes = mes; await cgRecarregar('Lista montada pelo cadastro.');
}
async function cgAdtAjustar(mes, pessoa) {
  const v = document.getElementById('cgA_v_' + pessoa).value;
  avisoAcao('enviando', 'Gravando…');
  const r = await trRpcSeguro('rh_adiantamento_ajustar', { p_mes: mes, p_pessoa: pessoa, p_valor: Number(v), p_motivo: document.getElementById('cgA_m_' + pessoa).value || null });
  if (!r.ok) { cgAviso('Não deu: ' + await trErroDe(r), false); return; }
  CARGOS_F.mes = mes; await cgRecarregar('Ajuste salvo.');
}

// ---------- BONIFICAÇÃO TRIMESTRAL (vw_rh_bonificacao_ciclo; proposta da frente RH, 19/10/2026) ----------
// Dono, 19/10: "sempre atualizadas com a lista da última folha ... 600 (200 de cada mês) ... lançar pelo valor cheio
// de cada mês trabalhado"; 22/08: proporcional no mês em que a pessoa entra. A conta é toda do banco
// (script/sql/rh_bonificacao.sql); a tela só soma. As horas de falta da Flash aparecem para conferir — ainda não descontam.
function cargosCiclo(c) { CARGOS_F.ciclo = c; renderModuloCargos(); }
function cgAbaBonif() {
  const F = CARGOS_F;
  const todos = CARGOS.bonif || [];
  if (!todos.length) return '<div class="contexto">A bonificação ainda não tem ciclo calculado.</div>';
  const hoje = trHoje();
  const ciclos = [...new Set(todos.map(b => String(b.ciclo_inicio).slice(0, 10)))].sort();
  const aPagar = ciclos.find(c => todos.some(b => String(b.ciclo_inicio).slice(0, 10) === c && String(b.pagamento).slice(0, 10) >= hoje)) || ciclos[ciclos.length - 1];
  const ciclo = ciclos.includes(F.ciclo) ? F.ciclo : aPagar;
  const doCiclo = todos.filter(b => String(b.ciclo_inicio).slice(0, 10) === ciclo);
  const linhas = doCiclo.filter(b => !F.unidade || b.unidade === F.unidade);
  const mesRot = (k) => { const d = new Date(ciclo + 'T12:00:00'); d.setMonth(d.getMonth() + k); return d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''); };
  const nomeCiclo = (c) => { const b = todos.find(x => String(x.ciclo_inicio).slice(0, 10) === c); const d = new Date(c + 'T12:00:00');
    const m = (k) => { const x = new Date(d); x.setMonth(d.getMonth() + k); return x.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''); };
    return `${m(0)}–${m(1)}–${m(2)} · paga ${b ? cgData(b.pagamento) : ''}`; };
  const pag = doCiclo[0] ? doCiclo[0].pagamento : null;
  const unids = [...new Set(doCiclo.map(b => b.unidade))];
  const soma = (l) => l.reduce((s, b) => s + cgN(b.total), 0);
  const temDesc = linhas.some(b => cgN(b.desconto) !== 0);
  const falta = (hh) => cgN(hh) ? `<div style="font-size:11px;color:var(--tx-4);">falta ${String(Math.round(cgN(hh) * 10) / 10).replace('.', ',')} h</div>` : '';
  const mesCel = (v, hh) => `<td>${cgR(v)}${falta(hh)}</td>`;
  const naoRecebem = CARGOS.pessoas.filter(p => p.ativo && p.contrato === 'CLT' && (!F.unidade || p.unidade === F.unidade) && !linhas.some(b => b.pessoa_id === p.id));
  let h = `<div style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0;">${ciclos.map(c =>
      `<button type="button" class="preset-btn ${c === ciclo ? 'active' : ''}" onclick="cargosCiclo('${c}')">${nomeCiclo(c)}</button>`).join('')}</div>
    ${cgFiltroUnidade(doCiclo)}
    <div class="cards">
      ${unids.map(u => { const l = doCiclo.filter(b => b.unidade === u); return `<div class="card neutral"><div class="card-lbl">${cgEsc(u)}</div><div class="card-val">${cgR0(soma(l))}</div><div class="card-pct">${l.length} ${l.length === 1 ? 'pessoa' : 'pessoas'}</div></div>`; }).join('')}
      <div class="card blue"><div class="card-lbl">Rede</div><div class="card-val">${cgR0(soma(doCiclo))}</div><div class="card-pct">${doCiclo.length} pessoas${pag ? ` · paga ${cgData(pag)}` : ''}</div></div>
    </div>
    <div id="tabelaCgBonif" style="overflow-x:auto;"><table>
      <thead><tr><th>Loja</th><th>Nome</th><th>Admissão</th><th>${mesRot(0)}</th><th>${mesRot(1)}</th><th>${mesRot(2)}</th>${temDesc ? '<th>Desconto</th>' : ''}<th>Total</th></tr></thead>
      <tbody>${linhas.map(b => `<tr>
        <td>${cgEsc(b.unidade)}</td><td>${cgEsc(cgNome(b.nome))}</td><td>${cgData(b.admissao)}</td>
        ${mesCel(b.mes1, b.falta_h_mes1)}${mesCel(b.mes2, b.falta_h_mes2)}${mesCel(b.mes3, b.falta_h_mes3)}
        ${temDesc ? `<td>${cgN(b.desconto) ? cgR(-cgN(b.desconto)) : '–'}</td>` : ''}
        <td style="font-weight:600;">${cgR(b.total)}</td></tr>`).join('')}</tbody>
      <tfoot><tr class="sub"><td colspan="3">Total</td><td>${cgR(linhas.reduce((s, b) => s + cgN(b.mes1), 0))}</td><td>${cgR(linhas.reduce((s, b) => s + cgN(b.mes2), 0))}</td><td>${cgR(linhas.reduce((s, b) => s + cgN(b.mes3), 0))}</td>${temDesc ? `<td>${cgR(-linhas.reduce((s, b) => s + cgN(b.desconto), 0))}</td>` : ''}<td>${cgR(soma(linhas))}</td></tr></tfoot>
    </table></div>
    <div class="contexto" style="margin-top:8px;">R$ 200 por mês trabalhado (até R$ 600), proporcional no mês de entrada; a falta em cinza ainda não desconta.</div>
    ${naoRecebem.length ? `<div class="contexto" style="margin-top:8px;">Não recebem neste ciclo: ${naoRecebem.map(p => cgEsc(cgNome(p.nome).split(' ')[0])).join(', ')}. Para mudar, marque "recebe bonificação" na aba Pessoas.</div>` : ''}`;
  return h;
}

// ---------- ACERTOS NO SAIPOS (a parte da folha da fila do robô, vw_rh_saipos_acertos) ----------
const CG_SAIPOS_ACAO = { ALTERAR: 'Trocar o valor', ABRIR: 'Abrir a provisão', JA_CERTO: 'Já certo', PARE: 'Parado' };
const CG_SAIPOS_MOTIVO = { SEM_PROVISAO: 'falta a provisão no Saipos', PROVISAO_SOBRANDO: 'provisão para quem não recebe',
  NAO_FECHADO: 'esperando fechar o VT/VA no painel' };
function cgAbaSaipos() {
  const F = CARGOS_F;
  const linhas = (CARGOS.saipos || []).filter(s => !F.unidade || s.unidade_pagadora === F.unidade);
  if (!linhas.length) return '<div class="contexto">Nada da folha esperando acerto no Saipos.</div>';
  const n = (a, m) => linhas.filter(s => s.acao === a && (!m || s.motivo_codigo === m)).length;
  const rot = { FOLHA_ADIANTAMENTO: 'Adiantamento', FOLHA_VT: 'Vale-transporte', FOLHA_VA: 'Vale-alimentação', FOLHA_BONIFICACAO: 'Bonificação', FORA_DA_FOLHA: 'Salário por fora' };
  const ordem = (s) => s.acao === 'ALTERAR' ? 0 : s.motivo_codigo === 'SEM_PROVISAO' ? 1 : s.motivo_codigo === 'PROVISAO_SOBRANDO' ? 2 : 3;
  const ord = [...linhas].sort((a, b) => ordem(a) - ordem(b) || String(a.vencimento).localeCompare(String(b.vencimento)));
  return cgFiltroUnidade(linhas.map(s => ({ unidade: s.unidade_pagadora }))) + `
    <div class="cards">
      <div class="card ${n('ALTERAR') ? 'highlight' : 'neutral'}"><div class="card-lbl">Trocar o valor</div><div class="card-val">${n('ALTERAR')}</div><div class="card-pct">provisão com valor velho; o robô faz</div></div>
      <div class="card ${n('PARE', 'SEM_PROVISAO') ? 'highlight' : 'neutral'}"><div class="card-lbl">Falta a provisão</div><div class="card-val">${n('PARE', 'SEM_PROVISAO')}</div><div class="card-pct">abrir no Saipos (Hellen)</div></div>
      <div class="card ${n('PARE', 'PROVISAO_SOBRANDO') ? 'highlight' : 'neutral'}"><div class="card-lbl">Provisão sobrando</div><div class="card-val">${n('PARE', 'PROVISAO_SOBRANDO')}</div><div class="card-pct">tirar do Saipos (Hellen)</div></div>
      <div class="card neutral"><div class="card-lbl">Esperando fechar</div><div class="card-val">${n('PARE', 'NAO_FECHADO')}</div><div class="card-pct">VT e VA do mês seguinte</div></div>
    </div>
    <div id="tabelaCgSaipos" style="overflow-x:auto;"><table>
      <thead><tr><th>Vence</th><th>O quê</th><th>Loja</th><th>Quem</th><th style="text-align:right;">No painel</th><th style="text-align:right;">No Saipos</th><th>Ação</th></tr></thead>
      <tbody>${ord.map(s => `<tr>
        <td>${cgData(s.vencimento)}</td><td>${cgEsc(rot[s.tipo] || s.tipo)}</td><td>${cgEsc(s.unidade_pagadora)}</td><td>${cgEsc(cgNome(s.quem))}</td>
        <td style="text-align:right;">${cgR(s.valor_painel)}</td><td style="text-align:right;color:var(--tx-4);">${s.valor_saipos != null ? cgR(s.valor_saipos) : '–'}</td>
        <td style="font-size:12px;">${s.acao === 'PARE' ? `<span style="color:var(--farol-perto);">${cgEsc(CG_SAIPOS_MOTIVO[s.motivo_codigo] || s.motivo || 'parado')}</span>` : cgEsc(CG_SAIPOS_ACAO[s.acao] || s.acao)}</td></tr>`).join('')}</tbody>
    </table></div>
    <div class="contexto" style="margin-top:8px;">É a fila que o robô do contas a pagar lê: ele troca os valores; abrir e tirar provisão de salário fica com a Hellen. O Saipos mostra a troca na hora, a carga do painel só umas 2 horas depois.</div>`;
}

// ---------- CORREÇÕES NA FLASH (também a tela 'flash', da Arissa) ----------
const CG_FLASH_TIPO = { 'NAO ESTA NA FLASH': 'Cadastrar', 'INATIVO NA FLASH': 'Reativar', 'DESLIGADO ATIVO NA FLASH': 'Desativar',
  'EMPRESA': 'Empresa', 'CARGO': 'Cargo', 'DEPARTAMENTO': 'Departamento', 'MATRICULA': 'Matrícula', 'ADMISSAO': 'Admissão',
  'ATIVO NA FLASH FORA DO CADASTRO': 'Fora da folha' };
function cgFlashDaLoja(lista) { const v = pesLojaVista(); return v ? (lista || []).filter((i) => i.unidade === v) : (lista || []); }
function cgListaFlash(lista) {
  lista = cgFlashDaLoja(lista);
  if (!lista.length) return '<div class="contexto">A Flash bate com a folha do painel. Nada a corrigir.</div>';
  const pessoas = {};
  for (const i of lista) (pessoas[i.nome] = pessoas[i.nome] || { unidade: i.unidade, itens: [] }).itens.push(i);
  const porTipo = {};
  for (const i of lista) porTipo[i.tipo] = (porTipo[i.tipo] || 0) + 1;
  const lido = lista[0].flash_lido_em;
  const nPortal = lista.filter(i => i.como === 'PORTAL').length;
  return `<div class="cards">
      <div class="card highlight"><div class="card-lbl">Correções na Flash</div><div class="card-val">${lista.length}</div><div class="card-pct">em ${Object.keys(pessoas).length} pessoas</div></div>
      <div class="card neutral"><div class="card-lbl">Só pela tela da Flash</div><div class="card-val">${nPortal}</div><div class="card-pct">admissão, empresa, cadastro</div></div>
      <div class="card neutral"><div class="card-lbl">O resto</div><div class="card-val" style="font-size:14px;line-height:1.5;">${Object.entries(porTipo).map(([t, n]) => `${CG_FLASH_TIPO[t] || t}: ${n}`).join('<br>')}</div></div>
    </div>
    <div class="contexto">A folha do painel manda; a Flash tem de ficar igual. Corrigiu na Flash, o item some sozinho na leitura seguinte (Flash lida ${lido ? new Date(lido).toLocaleString('pt-BR') : '–'}).</div>
    <div id="tabelaCgFlash" style="overflow-x:auto;"><table>
      <thead><tr><th>Loja</th><th>Pessoa</th><th>O quê</th><th>Na Flash</th><th>Tem de ficar</th><th>O que fazer</th><th>Quem faz</th></tr></thead>
      <tbody>${Object.entries(pessoas).map(([nome, p]) => p.itens.map((i, k) => `<tr>
        ${k === 0 ? `<td rowspan="${p.itens.length}">${cgEsc(p.unidade)}</td><td rowspan="${p.itens.length}" style="font-weight:600;">${cgEsc(cgNome(nome))}</td>` : ''}
        <td>${cgEsc(CG_FLASH_TIPO[i.tipo] || i.tipo)}</td><td style="color:var(--tx-4);">${cgEsc(i.na_flash || '–')}</td>
        <td>${cgEsc(i.no_painel || '–')}</td><td style="font-size:12px;">${cgEsc(i.o_que_fazer)}</td>
        <td style="font-size:12px;white-space:nowrap;">${i.como === 'API' ? '<span style="color:var(--tx-4);">API (com o sim do dono)</span>' : '<b>Arissa, na tela da Flash</b>'}</td></tr>`).join('')).join('')}</tbody>
    </table></div>`;
}
let FLASHRH = null;
async function entrarFlashRh() {
  const alvo = document.getElementById('view-flash');
  if (!alvo) return;
  await pesLojaPreparar();
  alvo.innerHTML = '<div class="contexto">Carregando a lista...</div>';
  try { FLASHRH = await consultarTudo('vw_rh_flash_pendencias?select=*&order=unidade,nome,ordem'); }
  catch (e) { alvo.innerHTML = `<div class="contexto">Não consegui carregar: ${cgEsc(e.message)}</div>`; return; }
  alvo.innerHTML = `<div class="section-label" style="border-top:none;margin-top:0;padding-top:0;">Correções na Flash</div>` + cgListaFlash(FLASHRH);
}

async function entrarRh() {
  const alvo = document.getElementById('view-rh');
  if (!alvo) return;
  if (RH) { renderModuloRh(); return; }
  alvo.innerHTML = '<div class="contexto">Carregando os descontos em folha...</div>';
  try {
    const [colab, aberto, credor, credorDet, diverg] = await Promise.all([
      consultarTudo('vw_rh_colaboradores?select=*&order=a_descontar.desc'),
      consultarTudo('vw_rh_a_descontar?select=*&order=data_desconto.asc'),
      consultarTudo('vw_rh_credor?select=*&order=devolver_agora.desc'),
      consultarTudo('vw_rh_credor_detalhe?select=*&order=data_concessao.asc'),
      consultarTudo('vw_rh_divergencias?select=*&order=diferenca.desc'),
    ]);
    RH = { colab, aberto, credor, credorDet, diverg };
  } catch (e) {
    alvo.innerHTML = `<div class="contexto">Não consegui carregar os descontos em folha: ${e.message}</div>`;
    return;
  }
  renderModuloRh();
}

function renderModuloRh() {
  const alvo = document.getElementById('view-rh');
  if (!alvo || RH === null) return;
  const { colab } = RH;
  const n = (v) => Number(v) || 0;   // PostgREST pode devolver numeric como texto
  // ---- o recorte da pessoa fixada, num lugar so ----
  // Dali para baixo o modulo inteiro le estas listas ja recortadas: nao ha como um
  // pedaco da tela falar de uma pessoa e o outro de todo mundo. `colab` (a lista de
  // nomes) fica inteira, porque e o seletor. A conta de quem emprestou e o agregado
  // de credorDet por credor — as MESMAS contas da vw_rh_credor, linha a linha —,
  // entao ela tambem recorta sem inventar numero.
  const P = RH_PESSOA && colab.some(c => c.colaborador === RH_PESSOA) ? RH_PESSOA : null;
  const soP = (arr) => P ? arr.filter(r => r.colaborador === P) : arr;
  const aberto = soP(RH.aberto), credorDet = soP(RH.credorDet), diverg = soP(RH.diverg);
  const credor = !P ? RH.credor : (() => {
    const m = new Map();
    credorDet.forEach(d => {
      const a = m.get(d.credor) || { credor: d.credor, emprestimos: 0, funcionarios: 1, emprestado: 0,
        ja_descontado_do_funcionario: 0, a_descontar_do_funcionario: 0, ja_reembolsado: 0,
        a_reembolsar: 0, devolver_agora: 0 };
      a.emprestimos += 1;
      a.emprestado += n(d.valor_total);
      a.ja_descontado_do_funcionario += n(d.descontado);
      a.a_descontar_do_funcionario += n(d.a_descontar);
      a.ja_reembolsado += n(d.reembolsado);
      a.a_reembolsar = a.emprestado - a.ja_reembolsado;
      a.devolver_agora = a.ja_descontado_do_funcionario - a.ja_reembolsado;
      m.set(d.credor, a);
    });
    return [...m.values()].sort((x, y) => y.devolver_agora - x.devolver_agora);
  })();
  const soma = (arr, f) => arr.reduce((s, x) => s + n(f(x)), 0);
  const ddmm = (d) => d ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(2, 4) : '—';
  const mesTxt = (d) => new Date(d + 'T12:00:00')
    .toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '');

  if (!aberto.length && !colab.length) {
    alvo.innerHTML = '<div class="contexto">Sem descontos importados — rode <b>script/import_gastos_funcionarios.py</b>.</div>';
    return;
  }

  const totalAberto = soma(aberto, r => r.valor);
  const devolverAgora = soma(credor, c => c.devolver_agora);
  const aReceberCredor = soma(credor, c => c.a_descontar_do_funcionario);

  // Por dia de desconto. A planilha usa uma data unica como "estacionamento"
  // de divida antiga sem plano — se um so dia concentra mais de um quarto do
  // saldo, isso NAO e folha daquele mes e a tela precisa dizer.
  const porDia = {};
  aberto.forEach(r => { porDia[r.data_desconto] = (porDia[r.data_desconto] || 0) + n(r.valor); });
  const maiorDia = Object.entries(porDia).sort((a, b) => b[1] - a[1])[0] || [null, 0];
  const estacionado = totalAberto && maiorDia[1] / totalAberto > 0.25 ? maiorDia : null;

  // A proxima folha e o proximo dia de desconto que ainda vai acontecer —
  // tirando o dia estacionado, que nao e folha de verdade.
  const hojeIso = new Date().toISOString().slice(0, 10);
  const futuros = Object.keys(porDia)
    .filter(d => d >= hojeIso && (!estacionado || d !== estacionado[0])).sort();
  const proxDia = futuros[0] || null;
  const proxValor = proxDia ? porDia[proxDia] : 0;
  const proxN = proxDia ? aberto.filter(r => r.data_desconto === proxDia).length : 0;

  const divSoma = soma(diverg, d => d.diferenca);
  const faltaParcela = diverg.filter(d => d.tipo === 'FALTA PARCELA');

  const cards = `<div class="cards">
    <div class="card neutral"><div class="card-lbl">A descontar ${P ? '— ' + P : '(saldo total)'}</div>
      <div class="card-val">R$ ${fmt(totalAberto)}</div>
      <div class="card-pct">${aberto.length} parcelas de ${new Set(aberto.map(r => r.colaborador)).size} pessoas</div></div>
    <div class="card blue"><div class="card-lbl">Próxima folha</div>
      <div class="card-val">R$ ${fmt(proxValor)}</div>
      <div class="card-pct">${proxDia ? ddmm(proxDia) + ' · ' + proxN + ' parcelas' : 'nada agendado'}</div></div>
    <div class="card neg highlight"><div class="card-lbl">Devolver a quem emprestou</div>
      <div class="card-val">R$ ${fmt(devolverAgora)}</div>
      <div class="card-pct">já saiu do funcionário e não voltou pra pessoa</div></div>
    ${estacionado ? `<div class="card neg"><div class="card-lbl">Parado em ${ddmm(estacionado[0])}</div>
      <div class="card-val">R$ ${fmt(estacionado[1])}</div>
      <div class="card-pct">${pct(estacionado[1] / totalAberto * 100)}% do saldo num dia só — dívida sem plano</div></div>` : ''}
    ${diverg.length ? `<div class="card neutral"><div class="card-lbl">Não fecha na planilha</div>
      <div class="card-val">R$ ${fmt(divSoma)}</div>
      <div class="card-pct">${diverg.length} empréstimos · ${faltaParcela.length} sem parcela lançada</div></div>` : ''}
  </div>`;

  const contexto = estacionado ? `<div class="contexto" title="A planilha usa essa data para guardar dívida antiga que não tem plano de desconto — parte é de gente que já saiu. O cartão “Próxima folha” já ignora esse dia.">
    <b>R$ ${fmt(estacionado[1])} dos R$ ${fmt(totalAberto)} em aberto estão numa data só (${ddmm(estacionado[0])})</b> — dívida antiga, sem plano de desconto.
  </div>` : '';

  // ---- proximas folhas, mes a mes ----
  const porMes = {};
  aberto.forEach(r => {
    const p = porMes[r.mes] || (porMes[r.mes] = { valor: 0, n: 0, pessoas: new Set(), parado: 0 });
    p.valor += n(r.valor); p.n += 1; p.pessoas.add(r.colaborador);
    if (estacionado && r.data_desconto === estacionado[0]) p.parado += n(r.valor);
  });
  const linhasMes = Object.keys(porMes).sort().map(m => {
    const p = porMes[m];
    return `<tr><td>${mesTxt(m)}</td><td>${p.pessoas.size}</td><td>${p.n}</td>
      <td>R$ ${fmt(n(p.valor))}</td>
      <td class="${p.parado ? 'negativo' : ''}">${p.parado ? 'R$ ' + fmt(n(p.parado)) : '—'}</td></tr>`;
  }).join('');

  // ---- quem deve ----
  // A lista de nomes e o seletor da tela: clicar num nome fixa a pessoa, clicar de
  // novo solta. RH_NOMES guarda os nomes na ordem em que sao desenhados.
  const colabLista = colab.filter(c => n(c.a_descontar) > 0);
  RH_NOMES = colabLista.map(c => c.colaborador);
  const linhasColab = colabLista.map((c, i) => `<tr${c.colaborador === P ? ' style="background:var(--brand-wine);"' : ''}>
    <td onclick="rhFixar(${i})" style="cursor:pointer;" title="${c.colaborador === P ? 'clique para soltar o recorte' : 'clique para a tela falar só desta pessoa'}">${c.colaborador === P ? '✕ ' : ''}${c.colaborador}</td>
    <td>R$ ${fmt(n(c.a_descontar))}</td>
    <td>${c.parcelas_abertas}</td>
    <td>${ddmm(c.proximo_desconto)}</td>
    <td>${ddmm(c.quitacao_prevista)}</td>
    <td class="${n(c.sem_previsao) > 0 ? 'negativo' : ''}">${n(c.sem_previsao) > 0 ? 'R$ ' + fmt(n(c.sem_previsao)) : '—'}</td>
    <td>R$ ${fmt(n(c.ja_descontado))}</td></tr>`).join('');

  // ---- conta com quem emprestou do bolso ----
  const linhasCredor = credor.map(c => `<tr>
    <td>${c.credor}</td><td>${c.emprestimos}</td><td>${c.funcionarios}</td>
    <td>R$ ${fmt(n(c.emprestado))}</td>
    <td>R$ ${fmt(n(c.ja_descontado_do_funcionario))}</td>
    <td>R$ ${fmt(n(c.ja_reembolsado))}</td>
    <td class="negativo">R$ ${fmt(n(c.devolver_agora))}</td>
    <td>R$ ${fmt(n(c.a_descontar_do_funcionario))}</td></tr>`).join('');

  const linhasCredorDet = credorDet
    .filter(d => n(d.a_reembolsar) > 0)
    .sort((a, b) => n(b.a_reembolsar) - n(a.a_reembolsar))
    .map(d => `<tr>
      <td>${d.credor} → ${d.colaborador}</td>
      <td>${d.descricao}</td>
      <td>${ddmm(d.data_concessao)}</td>
      <td>R$ ${fmt(n(d.valor_total))}</td>
      <td>R$ ${fmt(n(d.descontado))}</td>
      <td>R$ ${fmt(n(d.a_descontar))}</td>
      <td class="negativo">R$ ${fmt(n(d.a_reembolsar))}</td>
      <td>${d.situacao}</td></tr>`).join('');

  // ---- o que nao fecha ----
  const linhasDiv = diverg.map(d => `<tr>
    <td>${d.colaborador}</td><td>${d.descricao}</td><td>${ddmm(d.data_concessao)}</td>
    <td>R$ ${fmt(n(d.valor_total))}</td><td>R$ ${fmt(n(d.soma_parcelas))}</td>
    <td class="${n(d.diferenca) > 0 ? 'negativo' : ''}">R$ ${fmt(n(d.diferenca))}</td>
    <td>${d.tipo}</td></tr>`).join('');

  alvo.innerHTML = `
    <div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">Descontos em folha</div>
    <div class="caption-label" style="text-align:center;">
      Vales e empréstimos que a empresa adiantou e recupera no contracheque. É saldo, não fluxo — sem janela de período.
    </div>
    ${P ? `<div class="contexto" style="border-color:var(--brand);">
      <b>Filtrando:</b>
      <button class="preset-btn active" onclick="rhSoltar()">${P} ✕</button>
      <div style="font-size:12px; color:var(--tx-3); margin-top:6px;">Os cartões e as quatro tabelas falam só desta pessoa. A lista "Quem ainda tem desconto a fazer" continua inteira, para você trocar de nome.</div>
    </div>` : ''}
    ${cards}${contexto}
    <div class="section-label">Quanto sai de cada folha</div>
    <div id="tabelaRhMes"><table>
      <tr><th>Mês</th><th>Pessoas</th><th>Parcelas</th><th>Valor</th><th>Do dia parado</th></tr>
      ${linhasMes}
      <tr class="liq"><td>TOTAL</td><td>${new Set(aberto.map(r => r.colaborador)).size}</td><td>${aberto.length}</td>
        <td>R$ ${fmt(totalAberto)}</td><td>${estacionado ? 'R$ ' + fmt(estacionado[1]) : '—'}</td></tr>
    </table></div>

    <div class="section-label">Quem ainda tem desconto a fazer</div>
    <div id="tabelaRhColab"><table>
      <tr><th>Funcionário</th><th>A descontar</th><th>Parcelas</th><th>Próximo</th>
          <th>Quitação prevista</th><th>Sem parcela</th><th>Já descontado</th></tr>
      ${linhasColab}
      ${(() => { const cs = colab.filter(c => n(c.a_descontar) > 0);
        const t = cs.reduce((a, c) => ({ v: a.v + n(c.a_descontar), p: a.p + Number(c.parcelas_abertas || 0),
          sp: a.sp + n(c.sem_previsao), jd: a.jd + n(c.ja_descontado) }), { v: 0, p: 0, sp: 0, jd: 0 });
        return `<tr class="liq"><td>TOTAL</td><td>R$ ${fmt(t.v)}</td><td>${t.p}</td><td>—</td><td>—</td>
          <td>${t.sp > 0.005 ? 'R$ ' + fmt(t.sp) : '—'}</td><td>R$ ${fmt(t.jd)}</td></tr>`; })()}
    </table></div>

    ${credor.length ? `
    <div class="section-label">Quem emprestou do próprio bolso</div>
    <div class="contexto" title="Devolver mais do que isso é pôr dinheiro novo: o resto ainda nem saiu do contracheque. A Jane também tem crédito no módulo Reembolsos (gastos do bolso pela empresa) — são dívidas de origens diferentes, não somadas aqui."><b>Devolver agora</b> é o que já foi descontado do funcionário e ainda não voltou para quem emprestou
      (a Jane também tem crédito em <a href="javascript:void(0)" onclick="mostrarModulo('reembolsos')" style="color:#a5a49a;">Reembolsos</a>).</div>
    <div id="tabelaRhCredor"><table>
      <tr><th>Quem emprestou</th><th>Empréstimos</th><th>Funcionários</th><th>Emprestado</th>
          <th>Já descontado</th><th>Já devolvido</th><th>Devolver agora</th><th>Ainda a descontar</th></tr>
      ${linhasCredor}
      ${(() => { const t = credor.reduce((a, c) => ({ e: a.e + Number(c.emprestimos || 0), f: a.f + Number(c.funcionarios || 0),
          em: a.em + n(c.emprestado), jd: a.jd + n(c.ja_descontado_do_funcionario), jr: a.jr + n(c.ja_reembolsado),
          da: a.da + n(c.devolver_agora), ad: a.ad + n(c.a_descontar_do_funcionario) }), { e: 0, f: 0, em: 0, jd: 0, jr: 0, da: 0, ad: 0 });
        return `<tr class="liq"><td>TOTAL</td><td>${t.e}</td><td>${t.f}</td><td>R$ ${fmt(t.em)}</td>
          <td>R$ ${fmt(t.jd)}</td><td>R$ ${fmt(t.jr)}</td><td>R$ ${fmt(t.da)}</td><td>R$ ${fmt(t.ad)}</td></tr>`; })()}
    </table></div>
    <div id="tabelaRhCredorDet" style="margin-top:10px;"><table>
      <tr><th>Empréstimo</th><th>Descrição</th><th>Data</th><th>Valor</th>
          <th>Descontado</th><th>A descontar</th><th>A devolver</th><th>Situação</th></tr>
      ${linhasCredorDet}
    </table></div>` : ''}

    ${diverg.length ? `
    <div class="section-label">Empréstimos que não fecham</div>
    <div class="contexto">A soma das parcelas não bate com o valor concedido — corrigir na planilha e reimportar, o painel não conserta sozinho.</div>
    <div id="tabelaRhDiverg"><table>
      <tr><th>Funcionário</th><th>Descrição</th><th>Data</th><th>Concedido</th>
          <th>Soma das parcelas</th><th>Diferença</th><th title="FALTA PARCELA: sobrou valor sem desconto lançado, ninguém está cobrando. PARCELA A MAIS: quase sempre vale replanejado, com a parcela antiga ainda na base.">Tipo</th></tr>
      ${linhasDiv}
    </table></div>` : ''}`;
}

