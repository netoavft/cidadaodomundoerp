// =====================================================================================================================
//  SELETOR DE LOJA ÚNICO (quarta 28/10/2026, dono: "cada um abre na própria loja", "o seletor muda de verdade cada tela",
//  tela que ainda não obedece diz que não obedece — nunca finge). Proposta: contexto/propostas-telas/2026-10-28-seletor-loja-unico.md
//
//  Quem vê qual loja vem do banco, de UM lugar: rpc painel_minhas_lojas() -> {lojas, loja_inicial, travado}. A segurança
//  continua nas views (filial só lê a dela); aqui só se escolhe o que mostrar.
//  A escolha vale enquanto a aba estiver aberta (sessionStorage, que a casca e as páginas dentro dela dividem); abrir de
//  novo volta à própria loja. A casca muda a loja e avisa cada moldura por postMessage {tipo:'casca-loja', loja}.
//
//  Para a página:  await lojaCarregar();  lojaAtual() -> 'AGUA VERDE' | 'AHU' | 'SÃO BRAZ' | 'REDE' | null (sem cadastro)
//                  naRede();  lojaNome(l);  aoMudarLoja((loja) => recarregar());
//  Este arquivo não depende do nucleo.js (a casca usa sem ele): lê SUPABASE_URL / SUPABASE_ANON_KEY e a sessão rmbSessao.
// =====================================================================================================================
const LOJA_REDE = 'REDE';
const LOJA_NOMES = { 'AGUA VERDE': 'Água Verde', 'AHU': 'Ahú', 'SÃO BRAZ': 'São Braz', 'SAO BRAZ': 'São Braz',
                     'BOQUEIRAO': 'Boqueirão', 'REDE': 'Rede (as 3)' };
let LOJA_INFO = null;            // { lojas:[], loja_inicial, travado }  — lojas vazio = login sem loja cadastrada
const LOJA_OUVINTES = [];

function lojaNome(l) { return LOJA_NOMES[l] || (l ? String(l).charAt(0) + String(l).slice(1).toLowerCase() : ''); }

async function lojaCarregar() {
  if (LOJA_INFO) return LOJA_INFO;
  let s = null; try { s = JSON.parse(localStorage.getItem('rmbSessao') || 'null'); } catch (e) {}
  const tok = (s && s.access_token) || SUPABASE_ANON_KEY;
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/painel_minhas_lojas', {
      method: 'POST', headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
      body: '{}' });
    if (!r.ok) return null;                                  // sem resposta: não inventa loja (lojaAtual fica null)
    const d = await r.json();
    const lin = Array.isArray(d) ? d[0] : d;
    LOJA_INFO = { lojas: (lin && lin.lojas) || [], loja_inicial: lin ? lin.loja_inicial : null, travado: !!(lin && lin.travado) };
  } catch (e) { return null; }
  return LOJA_INFO;
}

function lojaAtual() {
  if (!LOJA_INFO || !LOJA_INFO.lojas.length) return null;
  let l = null; try { l = sessionStorage.getItem('painelLoja'); } catch (e) {}
  if (LOJA_INFO.travado || !l || !LOJA_INFO.lojas.includes(l)) l = LOJA_INFO.loja_inicial || LOJA_INFO.lojas[0];
  return l;
}
function naRede() { return lojaAtual() === LOJA_REDE; }
function lojaTravada() { return !!(LOJA_INFO && LOJA_INFO.travado); }

// só a casca chama: grava a escolha e avisa quem estiver ouvindo nesta janela
function lojaEscolher(l) {
  if (!LOJA_INFO || LOJA_INFO.travado || !LOJA_INFO.lojas.includes(l)) return false;
  try { sessionStorage.setItem('painelLoja', l); } catch (e) {}
  LOJA_OUVINTES.forEach((fn) => { try { fn(l); } catch (e) {} });
  return true;
}

function aoMudarLoja(fn) { LOJA_OUVINTES.push(fn); }
// dentro da casca: a casca avisa a moldura; a página relê a escolha (sessionStorage é o mesmo) e chama os ouvintes
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || !e.data || e.data.tipo !== 'casca-loja' || e.source !== window.parent) return;
  LOJA_OUVINTES.forEach((fn) => { try { fn(lojaAtual()); } catch (x) {} });
});
