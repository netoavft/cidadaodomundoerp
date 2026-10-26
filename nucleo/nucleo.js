// Núcleo comum do painel Cidadão do Mundo (24/10/2026, painel em módulos).
// Saiu de docs/dashboard.html, MOVIDO e não copiado: conexão com o banco, leitura paginada, sessão de login, registro de
// uso e formatação. Toda página do painel (dashboard.html, listas/index.html, as próximas) carrega este arquivo ANTES do
// seu próprio código. Cada página define o que é dela: exigirLogin(recado) (a porta de login) — consultarTudo a chama
// quando a sessão vence. NA_CASCA/avisarCasca vêm do <head> de cada página.
// Quem mexe aqui: o chat "Telas do painel". Mudança aqui vale para todas as páginas de uma vez.

// ------------------------------------------------------------------
// Conexao com o Supabase (chave publica, somente leitura por RLS)
// ------------------------------------------------------------------
const SUPABASE_URL = "https://rtmgzsikwglsvpopbfbw.supabase.co";

const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ0bWd6c2lrd2dsc3Zwb3BiZmJ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU4NDgwMjcsImV4cCI6MjEwMTQyNDAyN30.-vwbQkcuAbbonmBVCeUWXjTg54uB5MNN94QmMlBxTA4";

// A chave anon continua indo no apikey (o PostgREST exige), mas quem manda no
// que pode ser lido e o Bearer: o token da pessoa logada.
function cabecalhoLeitura() {
  const s = rmbSessao();
  return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${(s && s.access_token) || SUPABASE_ANON_KEY}` };
}

// ORDEM ESTÁVEL NA PAGINAÇÃO (22/10/2026). O PostgREST entrega de 1.000 em 1.000; sem `order=` a ordem entre uma
// página e outra não é garantida e linha some ou repete em silêncio (na Evolução, "parte de combo" deu R$ 426 onde o
// banco tem R$ 846). Se a leitura passar de uma página e não tiver order=, recomeça ordenando pelas colunas do select.
// Com select=* não há como saber as colunas: avisa no console — essa leitura precisa de order= escrito.
function ordemDoSelect(caminho) {
  const m = caminho.match(/[?&]select=([^&]*)/);
  if (!m || m[1] === '*' || m[1].includes('(')) return null;
  const cols = decodeURIComponent(m[1]).split(',').map((c) => c.trim().split(':').pop().split('::')[0]).filter(Boolean);
  return cols.length ? cols.join(',') : null;
}

async function consultarTudo(caminho) {
  const PAGE = 1000;
  // uma pagina; podeRenovar=false no paralelo: 401 volta como erro marcado e o resto se le uma por vez
  // quem ja pede o proprio limit (ex.: "a ultima data", limit=1) leva uma pagina so, do tamanho que pediu.
  // Antes o limit=1000 da paginacao entrava depois e ganhava: "a ultima data" baixava a tabela inteira (24/10/2026).
  const proprioLimite = /[?&]limit=\d+/.test(caminho);
  const pagina = async (cam, offset, podeRenovar) => {
    const sep = cam.includes('?') ? '&' : '?';
    const url = proprioLimite ? `${SUPABASE_URL}/rest/v1/${cam}` : `${SUPABASE_URL}/rest/v1/${cam}${sep}limit=${PAGE}&offset=${offset}`;
    // Desde 21/08/2026 o painel le com o token de QUEM ESTA LOGADO: o papel
    // anon perdeu o SELECT (script/fechar_leitura_anonima.sql). Sem sessao
    // valida nao ha painel — e nao ha dado exposto a quem achar o repositorio.
    let resp = await fetch(url, { headers: cabecalhoLeitura() });
    // 26/10/2026: 503 PGRST002 = a API recarregando o mapa do banco depois de uma mudança de estrutura; passa em segundos
    for (let t = 1; resp.status === 503 && t <= 3; t++) {
      await new Promise(r => setTimeout(r, 1500 * t));
      resp = await fetch(url, { headers: cabecalhoLeitura() });
    }
    if (resp.status === 401) {
      if (!podeRenovar) { const e = new Error('401'); e.renovar = true; throw e; }
      if (await rmbRenovarSeExpirado(resp)) resp = await fetch(url, { headers: cabecalhoLeitura() });   // token renovado, tenta de novo
    }
    if (resp.status === 401) { exigirLogin('Sua sessão venceu. Entre de novo.'); throw new Error('sessão vencida'); }
    // Teto de 8 s estourado (57014): uma segunda tentativa, 1,5 s depois. A tela "Hoje" dispara
    // ~20 consultas juntas e a maior passa dos 8 s so na fila; sozinha leva 1,7 s (19/10/2026).
    if (resp.status === 500) {
      const txt = await resp.text();
      if (!txt.includes('57014')) throw new Error(`Erro 500 ao consultar ${cam}: ${txt}`);
      await new Promise(r => setTimeout(r, 1500));
      resp = await fetch(url, { headers: cabecalhoLeitura() });
    }
    if (!resp.ok) { const e = new Error(`Erro ${resp.status} ao consultar ${cam}: ${await resp.text()}`); e.status = resp.status; throw e; }
    return resp.json();
  };
  let t0 = performance.now();
  let p0 = await pagina(caminho, 0, true);
  if (proprioLimite || p0.length < PAGE) return p0;
  // mais de 1.000 linhas: precisa de ordem estavel, senao a paginacao repete/perde linha
  if (!/[?&]order=/.test(caminho)) {
    const ord = ordemDoSelect(caminho);
    if (ord) {
      const comOrdem = caminho + (caminho.includes('?') ? '&' : '?') + 'order=' + ord;
      try { t0 = performance.now(); p0 = await pagina(comOrdem, 0, true); caminho = comOrdem; }
      catch (e) {
        // coluna que o banco não sabe ordenar (json): volta à leitura de antes em vez de quebrar a tela
        if (e.status !== 400) throw e;
        console.warn('consultarTudo: não deu para ordenar pelo select, sigo sem ordem:', caminho.slice(0, 120));
      }
    } else console.warn('consultarTudo: mais de 1.000 linhas sem order= (paginação pode perder linha):', caminho.slice(0, 120));
  }
  let tudo = p0;
  if (p0.length < PAGE) return tudo;
  // 24/10/2026: 4 paginas de cada vez; view pesada (1a pagina > 1,5 s) segue uma por vez
  let par = (performance.now() - t0) > 1500 ? 1 : 4;
  let offset = PAGE;
  while (true) {
    let pags;
    try {
      pags = par === 1 ? [await pagina(caminho, offset, true)]
        : await Promise.all(Array.from({ length: par }, (_, i) => pagina(caminho, offset + i * PAGE, false)));
    } catch (e) {
      if (!e.renovar) throw e;
      par = 1; continue;   // login vencendo no meio: o resto uma por vez, com a renovacao de sempre
    }
    let acabou = false;
    for (const pg of pags) {
      tudo = tudo.concat(pg);
      if (pg.length < PAGE) { acabou = true; break; }
    }
    if (acabou) break;
    offset += pags.length * PAGE;
  }
  return tudo;
}

const MESES_ABREV = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

function fmt(v) { return (Math.abs(v) < 0.005 ? 0 : v).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2}); }

function pct(v) { return (Math.abs(v) < 0.05 ? 0 : v).toLocaleString('pt-BR', {minimumFractionDigits:1, maximumFractionDigits:1}); }

// Selo de variacao mostrado dentro do card.
//
// A leitura usa DOIS canais que nunca se contradizem:
//   - a PALAVRA ("subiu"/"caiu") diz o que aconteceu com o numero — fato, sem interpretacao;
//   - a COR diz se isso e bom ou ruim para o resultado — interpretacao.
// Antes so havia seta + cor, e o leitor tinha que combinar mentalmente os dois (uma seta pra
// baixo verde confunde, porque seta pra baixo "parece" ruim). Com a palavra explicita, o fato
// fica claro mesmo que a pessoa ignore a cor.
//
// tipo: 'maiorMelhor' (receita, lucro) | 'menorMelhor' (custo) | 'neutro' (investimento —
// gastar mais nao e bom nem ruim por si so, depende do retorno; nao cabe ao painel julgar).
function selo(atual, anterior, tipo = 'maiorMelhor') {
  if (anterior === null || anterior === undefined || !isFinite(anterior)) return '';

  const antesZero = Math.abs(anterior) < 0.005;
  const agoraZero = Math.abs(atual) < 0.005;
  if (antesZero && agoraZero) return '';

  const detalhe = `Antes: R$ ${fmt(anterior)} → agora: R$ ${fmt(atual)}`;

  // Saindo do zero nao existe percentual — o certo e dizer que apareceu agora.
  if (antesZero) {
    const cor = tipo === 'neutro' ? '#8a897e' : (tipo === 'maiorMelhor' ? '#3fb950' : '#ff6b6b');
    return `<div class="card-delta" style="color:${cor};" title="${detalhe}">apareceu neste período (antes era zero)</div>`;
  }

  const variacao = (atual - anterior) / Math.abs(anterior) * 100;
  if (!isFinite(variacao)) return '';

  if (Math.abs(variacao) < 0.05) {
    return `<div class="card-delta" style="color:#8a897e;" title="${detalhe}">sem mudança vs período anterior</div>`;
  }

  const subiu = variacao > 0;
  const palavra = subiu ? 'subiu' : 'caiu';
  const seta = subiu ? '▲' : '▼';
  let cor = '#8a897e';
  if (tipo === 'maiorMelhor') cor = subiu ? '#3fb950' : '#ff6b6b';
  else if (tipo === 'menorMelhor') cor = subiu ? '#ff6b6b' : '#3fb950';

  return `<div class="card-delta" style="color:${cor};" title="${detalhe}">${seta} ${palavra} ${pct(Math.abs(variacao))}% vs período anterior</div>`;
}

function rmbSessao() {
  try { return JSON.parse(localStorage.getItem('rmbSessao') || 'null'); } catch (e) { return null; }
}

function rmbHeaders(extra = {}) {
  const s = rmbSessao();
  // Sem sessao vale o proprio anon: a conciliacao marca sem login desde 19/08.
  return { apikey: SUPABASE_ANON_KEY,
           Authorization: `Bearer ${(s && s.access_token) || SUPABASE_ANON_KEY}`,
           'Content-Type': 'application/json', ...extra };
}

// UMA renovacao de cada vez. O refresh_token do Supabase e' de uso unico: ao
// usar, ele vira outro. O painel dispara dezenas de consultas em paralelo,
// entao um token vencido produzia dezenas de 401 simultaneos e dezenas de
// tentativas de renovar com o MESMO refresh_token — a primeira funcionava e as
// outras recebiam "token ja usado", que o codigo tratava como sessao invalida
// e apagava o login. Resultado: quem passasse de uma hora com o painel aberto
// era jogado para fora, com a sessao ainda viva no servidor. (21/08/2026)
let RENOVANDO = null;

async function rmbRenovar() {
  if (RENOVANDO) return RENOVANDO;          // ja tem uma em curso: espera ela
  RENOVANDO = (async () => {
    const s = rmbSessao();
    if (!s || !s.refresh_token) return false;
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: s.refresh_token }),
    });
    let novo = {};
    try { novo = await r.json(); } catch (e) {}
    if (!r.ok || !novo.access_token) {
      // Falha de rede nao e' motivo para deslogar ninguem — so a recusa do
      // servidor (400/401) significa que o refresh_token nao vale mais.
      if (r.status === 400 || r.status === 401) localStorage.removeItem('rmbSessao');
      return false;
    }
    localStorage.setItem('rmbSessao', JSON.stringify({
      access_token: novo.access_token, refresh_token: novo.refresh_token, email: s.email,
      expira_em: Date.now() + ((novo.expires_in || 3600) * 1000),
    }));
    return true;
  })();
  try { return await RENOVANDO; } finally { RENOVANDO = null; }
}

async function rmbRenovarSeExpirado(resp) {
  if (resp.status !== 401) return false;
  return rmbRenovar();
}

// Renova ANTES de sair disparando consulta. Sem isto, um token vencido vira
// dezenas de 401 e o painel pisca erro antes de se recuperar.
async function rmbGarantirTokenValido() {
  const s = rmbSessao();
  if (!s) return false;
  if (s.expira_em && Date.now() < s.expira_em - 60000) return true;   // ainda vale
  return rmbRenovar();
}

// QUAIS TELAS SAO ABERTAS (15/10/2026, pedido do dono: "junto com a medicao de uso").
// Antes de decidir o que sai do menu, medir — a reorganizacao de 12/09 cortou no chute e
// foi revertida. Uma linha por tela aberta em painel_uso (script/sql/painel_uso.sql): o
// e-mail sai do token no banco, nunca daqui; so o dono le. Falha aqui nunca atrapalha a tela.
// Redesenhar a MESMA tela (troca de filtro, setPerimetro) nao e' abertura nova: so conta de
// novo depois de 30 minutos.
let USO_ULTIMO = { tela: null, quando: 0 };

function registrarUso(tela) {
  try {
    const s = rmbSessao();
    if (!s || !s.access_token || !tela) return;
    const agora = Date.now();
    if (USO_ULTIMO.tela === tela && agora - USO_ULTIMO.quando < 30 * 60000) return;
    USO_ULTIMO = { tela, quando: agora };
    fetch(`${SUPABASE_URL}/rest/v1/rpc/painel_registrar_uso`, {
      method: 'POST', keepalive: true,
      headers: { ...cabecalhoLeitura(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_tela: tela, p_origem: NA_CASCA ? 'casca' : 'painel' }),
    }).catch(() => {});
  } catch (e) {}
}

// ------------------------------------------------------------------
// 24/10/2026 (bloco 2): auxiliares que as telas de Listas e de Estoque usam e o painel também. Saíram do listas.js
// (trHoje, trFetch, trRpc, trErroDe, trEscH) e do dashboard.html (fxSomaDias), com os mesmos nomes.
// ------------------------------------------------------------------
function trHoje() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()); }
async function trFetch(url, opts = {}) {
  const faz = () => fetch(`${SUPABASE_URL}/rest/v1/${url}`, { ...opts, headers: rmbHeaders(opts.headers || {}) });
  let r = await faz();
  if (await rmbRenovarSeExpirado(r)) r = await faz();
  return r;
}
async function trRpc(fn, args) {
  return trFetch(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args || {}) });
}
async function trErroDe(r) {
  try { const j = await r.json(); return j.message || j.hint || j.error_description || JSON.stringify(j).slice(0, 160); }
  catch (e) { return 'HTTP ' + r.status; }
}
function trEscH(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fxSomaDias(dataStr, n) { const d = new Date(dataStr + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

// ------------------------------------------------------------------
// 26/10/2026 (bloco 3): quem é o dono — saiu do dashboard.html; o Caixa e o painel usam.
// ------------------------------------------------------------------
// Quem e' o dono vem do BANCO (rmb_config.email_dono) — a mesma linha que a
// funcao eh_dono() consulta nas policies. Ate 21/08/2026 este e-mail estava
// escrito aqui como 'netoavft@gmail.com' e ficou para tras quando o dono mudou
// para o endereco da empresa, em 20/08: o painel escondia os botoes de aprovar
// reembolso do proprio dono, porque comparava com o endereco velho.
let EMAIL_DONO = null;

async function carregarEmailDono() {
  if (EMAIL_DONO !== null) return EMAIL_DONO;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rmb_config?chave=eq.email_dono&select=valor`,
                        { headers: rmbHeaders() });
  const d = r.ok ? await r.json() : [];
  EMAIL_DONO = (d[0] && d[0].valor) || '';
  return EMAIL_DONO;
}

function souODono() {
  const s = rmbSessao();
  return !!(s && s.email && EMAIL_DONO &&
            s.email.toLowerCase() === String(EMAIL_DONO).toLowerCase());
}

// ------------------------------------------------------------------
// 26/10/2026 (bloco 4): o login (o Plano e os Reembolsos usam) e a data curta (Fluxo, Contas a pagar, Pessoas).
// ------------------------------------------------------------------
// pref: prefixo dos ids dos campos. O modulo Plano usa os seus proprios
// ('plano'), porque os ids do Reembolsos existem em paralelo no documento e
// getElementById devolve o PRIMEIRO — quem abrisse Reembolsos e depois Plano
// mandaria credencial vazia (causa C de 21/08/2026).
async function rmbFazerLogin(pref) {
  const idE = pref ? pref + 'Email' : 'rmbEmail';
  const idS = pref ? pref + 'Senha' : 'rmbSenha';
  const idR = pref ? pref + 'LoginErro' : 'rmbLoginErro';
  const campoE = document.getElementById(idE), campoS = document.getElementById(idS);
  if (!campoE || !campoS) return false;
  const email = campoE.value.trim();
  const senha = campoS.value;
  const erroEl = document.getElementById(idR);
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: senha }),
  });
  const s = await r.json();
  if (!r.ok || !s.access_token) {
    if (erroEl) {
      erroEl.textContent = 'Não deu: ' + (s.error_description || s.msg || 'e-mail ou senha errados, ou usuário ainda não criado no Supabase (ver rotinas/REEMBOLSOS-PAINEL.md).');
      erroEl.style.display = 'block';
    }
    return false;
  }
  localStorage.setItem('rmbSessao', JSON.stringify({
    access_token: s.access_token, refresh_token: s.refresh_token,
    email: (s.user && s.user.email) || email,
    expira_em: Date.now() + ((s.expires_in || 3600) * 1000),
  }));
  // NAO redesenha modulo nenhum: quem chamou decide o que fazer. Antes daqui
  // saia um renderModuloReembolsos(REEMBOLSOS) que explodia quando o login vinha
  // do modulo Plano (REEMBOLSOS ainda null), matando a funcao DEPOIS de salvar a
  // sessao — o login funcionava e a tela nunca ficava sabendo (21/08/2026).
  return true;
}
function ffDdmm(d) { return d ? d.slice(8, 10) + '/' + d.slice(5, 7) : '—'; }
