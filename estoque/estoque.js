// Produção e estoque (Contagem, Planejar, Apontar, Controle, Posição) do painel Cidadão do Mundo.
// Saiu de docs/dashboard.html em 24/10/2026 (bloco 2 do painel em módulos): MOVIDO, não copiado.
// Carregado pelo dashboard.html e por docs/estoque/index.html, depois do nucleo.js (de onde vêm consultarTudo, fmt,
// rmbSessao, rmbHeaders, trFetch, trRpc, trErroDe, trEscH, fxSomaDias). mostrarModulo('producao') é de cada página.
// Quem mexe aqui: o chat "Telas do painel".

// ==================================================================
//  CONTAGEM DE ESTOQUE — a quarta-feira (12/09/2026)
//
//  CONTAGEM CEGA E REGRA, NAO DETALHE DE TELA. Enquanto a folha esta ABERTA o
//  painel NAO mostra o esperado. Se ele aparecer antes de a pessoa digitar, ela
//  digita o esperado — e o painel passa a produzir um numero que confirma a si
//  mesmo. O esperado so aparece depois de FECHAR, junto com a diferenca.
//
//  O esperado sai de vw_est_inventario_conferencia, que ancora na ultima
//  contagem FECHADA e IGNORA o ajuste do Saipos (a regra de ouro do
//  script/estoque_inventario.sql: o ajuste E o fechamento da contagem la, e se
//  entrar na conta a nossa contagem bate sempre e mede nada).
//
//  Primeira contagem de um item nao tem esperado, e isso e correto: ela e o
//  ponto de partida. Hoje 187 dos 410 itens tem saldo acumulado negativo no
//  razao, porque ele comeca em 02/01/2026 sem saldo de abertura.
// ==================================================================
let CTG = null;   // { papel, unidade, folha, escopo, itens, contado, conf }

function ctgHoje() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

async function ctgFetch(caminho, opcoes) {
  // 21/10/2026: o login vencia no meio da contagem ("JWT expired" ao abrir a folha) — renova antes e, se o
  // banco ainda assim recusar por login vencido (401), renova e tenta de novo uma vez.
  await rmbGarantirTokenValido();
  const chama = () => fetch(`${SUPABASE_URL}/rest/v1/${caminho}`,
                        { headers: rmbHeaders((opcoes || {}).extra || {}), ...(opcoes || {}) });
  let r = await chama();
  if (await rmbRenovarSeExpirado(r)) r = await chama();
  if (!r.ok) throw new Error((await r.text()).slice(0, 200));
  return r;
}

async function entrarContagem() {
  const alvo = document.getElementById('view-contagem');
  if (!alvo) return;
  const sessao = rmbSessao();
  if (!sessao) { alvo.innerHTML = `<div class="contexto">Entre no painel para contar o estoque.</div>`; return; }
  alvo.innerHTML = `<div class="contexto">Carregando…</div>`;
  try {
    if (!CTG || !CTG.papel) {
      const [rp, ru] = await Promise.all([trRpc('tr_meu_papel'), trRpc('tr_minha_unidade')]);
      const papel = rp.ok ? await rp.json() : null;
      if (!papel) {
        alvo.innerHTML = `<div class="contexto">Você está logado como <b>${sessao.email}</b>, mas este login ainda
          não tem papel na operação. Quem cadastra é o Neto, em <b>tr_usuarios</b>.</div>`;
        return;
      }
      CTG = { papel, unidade: (ru.ok ? await ru.json() : null) || 'AGUA VERDE' };
    }
    await ctgCarregar();
  } catch (e) {
    alvo.innerHTML = `<div class="contexto" style="border-color:var(--farol-fora);">Não consegui abrir a contagem: ${e.message}</div>`;
  }
}

// 27/10/2026: o nome da pessoa pelo login (vw_nome_do_login: apelido do RH → cadastro dos módulos → prefixo do e-mail)
let EST_NOMES = null;
async function estNomesCarregar() {
  if (EST_NOMES) return;
  try { EST_NOMES = new Map((await consultarTudo('vw_nome_do_login?select=email,nome')).map((r) => [String(r.email || '').toLowerCase(), r.nome])); }
  catch (e) { EST_NOMES = new Map(); }
}
function estNome(email) {
  const e = String(email || '').toLowerCase();
  if (!e) return '';
  const n = EST_NOMES && EST_NOMES.get(e);
  const s = n || e.split('@')[0];
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
async function ctgCarregar() {
  await estNomesCarregar();
  const u = encodeURIComponent(CTG.unidade);
  const folhas = await consultarTudo(`est_inventario?select=*&unidade=eq.${u}&order=data.desc&limit=12`);
  CTG.folha = folhas.find((f) => f.status === 'ABERTA') || folhas[0] || null;
  CTG.folhas = folhas;
  CTG.itens = [];
  CTG.conf = [];
  if (CTG.folha) {
    if (CTG.folha.status === 'ABERTA') {
      // ABERTA le so o que foi digitado — nunca a conferencia (contagem cega)
      CTG.itens = await consultarTudo(`est_inventario_itens?select=*&id_inventario=eq.${CTG.folha.id}`);
    } else {
      CTG.conf = await consultarTudo(`vw_est_inventario_conferencia?select=*&id_inventario=eq.${CTG.folha.id}&order=diferenca_reais.asc`);
    }
  }
  CTG.escopo = await consultarTudo(
    `vw_est_curva?select=nome_saipos,insumo,un,curva,custo,custo_fonte,dinheiro&unidade=eq.${u}&order=dinheiro.desc`);
  // a base do retrato serve a folha impressa (o grupo de cada item) e ao select da foto
  if (!CTG.base) {
    CTG.base = (await consultarTudo(`vw_est_folha_contagem?select=nome_base,nome_saipos_conta,nomes_saipos,etiquetas,qtd,un,tipo,situacao,grupo,ordem_grupo&unidade=eq.${u}&order=ordem_grupo,grupo,nome_base`)).map(ctgDaFolha);
    CTG._grupoDe = null;   // o grupo de cada item sai daqui; base nova, mapa novo
  }
  CTG.foraBase = CTG.folha ? await consultarTudo(`vw_est_contagem_fora_da_base?select=nome_saipos,nome_base,problema,quem,o_que_fazer&id_inventario=eq.${CTG.folha.id}`).catch(() => []) : [];
  CTG.fotos = [];
  CTG.fotoLinhas = [];
  if (CTG.folha && CTG.folha.status === 'ABERTA') {
    CTG.fotos = await consultarTudo(
      `est_contagem_foto?select=*&id_inventario=eq.${CTG.folha.id}&order=criado_em.desc`);
    const ids = CTG.fotos.map((f) => f.id);
    if (ids.length) {
      CTG.fotoLinhas = await consultarTudo(
        `est_contagem_foto_linha?select=*&id_foto=in.(${ids.join(',')})&order=linha`);
      // 21/10/2026: a unidade de cada item (Saipos x nossa) e a lista fechada para propor correcao
      try {
        const [uc, uv] = await Promise.all([
          consultarTudo(`vw_est_unidade_conferir?select=nome_base,nome_saipos_conta,un_contagem,un_nossa,un_decidida,situacao,proposta_id,un_proposta,proposta_quem,proposta_em&unidade=eq.${u}`),
          consultarTudo('vw_est_unidade_valida?select=*')]);
        CTG.unConf = new Map(uc.map((x) => [x.nome_saipos_conta, x]));
        CTG.unValidas = uv.map((x) => x.un || x.unidade || Object.values(x)[0]);
      } catch (e) { CTG.unConf = null; CTG.unValidas = null; }
    }
    // EM BRANCO NO PAPEL (dono, 22/10/2026: "esses itens que vêm em branco na contagem deveriam aparecer na grade de
    // conferência pra Rita; se realmente não tinha, ela preenche zero, caso contrário preenche o valor contado").
    // Célula em branco não gera linha na leitura da foto: a grade do Estoque (vw_est_contagem_grade) é que sabe.
    CTG.brancos = await consultarTudo(`vw_est_contagem_grade?select=linha,grupo,ordem_grupo,nome,nome_saipos_conta,un,situacao` +
      `&id_inventario=eq.${CTG.folha.id}&qtd_lida=is.null&situacao=in.(%22EM%20BRANCO%20NA%20FOTO%22,%22EM%20BRANCO%20NO%20FIM%20DA%20PAGINA%22,%22ESPERANDO%20CONFERENCIA%22)&order=ordem_grupo,linha`).catch(() => []);   // 22/10: o Estoque criou as linhas vazias (ESPERANDO CONFERENCIA, sem quantidade)
  } else CTG.brancos = [];
  ctgRender();
}

function ctgRender() {
  const alvo = document.getElementById('view-contagem');
  const f = CTG.folha;
  const aberta = f && f.status === 'ABERTA';
  const hoje = ctgHoje();
  const dia = new Date(hoje + 'T12:00:00').getDay();   // 3 = quarta

  let h = `<h2>Contagem de estoque</h2>
    <div class="caption-label">O que a prateleira tem contra o que o sistema diz — a diferença é a única perda medida da casa.</div>`;

  h += `<div class="contexto" style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
      <b>${CTG.unidade}</b>
      ${f ? `<span>folha de <b>${f.data.split('-').reverse().join('/')}</b> · ${f.escopo === 'CURVA_A' ? 'só os de maior valor' : 'tudo'} · ${aberta ? 'aberta' : 'fechada'}</span>` : '<span>nenhuma folha ainda</span>'}
      ${aberta ? '' : `<button class="preset-btn" onclick="ctgAbrir('CURVA_A')">Contar só os de maior valor</button>
                       <button class="preset-btn" onclick="ctgAbrir('GERAL')">Contar tudo</button>`}
      ${dia !== 3 && !aberta ? `<span style="color:var(--tx-4);">hoje não é quarta</span>` : ''}
    </div>`;

  if (!f) {
    h += `<div class="contexto">A contagem é toda quarta: a curva A na semana (<b>${CTG.escopo.filter((i) => i.curva === 'A').length} itens</b>,
      80% do dinheiro) e a geral uma vez por mês. Abra a folha e conte — o esperado só aparece depois de fechar.</div>`;
    alvo.innerHTML = h;
    return;
  }

  h += aberta ? ctgHtmlContar(f) : ctgHtmlConferencia(f);
  alvo.innerHTML = h;
}

// ---- A FOTO DA FOLHA (dono, 08/10/2026: "vamos tentar com o esquema do painel abrir a camera
// e ela mandar a foto direto por la"). O celular abre a camera, o painel reduz a imagem (a
// internet da cozinha e ruim), sobe para o balde que ja existe e guarda um LINK ASSINADO — e por
// ele que eu baixo para transcrever, porque nao existe chave de servico neste projeto.
// O que eu leio NAO vira contagem sozinho: fica em est_contagem_foto_linha ate alguem conferir.
async function ctgReduzirFoto(arquivo, maxLado, qualidade) {
  const url = URL.createObjectURL(arquivo);
  try {
    const img = await new Promise((ok, erro) => {
      const im = new Image(); im.onload = () => ok(im); im.onerror = erro; im.src = url;
    });
    const f = Math.min(1, maxLado / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * f); c.height = Math.round(img.height * f);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', qualidade));
    return blob || arquivo;          // navegador sem toBlob: sobe o original
  } catch (e) {
    return arquivo;                  // foto que o navegador não abriu: sobe como veio
  } finally { URL.revokeObjectURL(url); }
}

async function ctgEnviarFoto(el) {
  const arquivo = (el.files || [])[0];
  el.value = '';
  if (!arquivo || !CTG.folha) return;
  const grupo = (document.getElementById('ctgFotoGrupo') || {}).value || null;
  const aviso = document.getElementById('ctgFotoMsg');
  const diz = (t) => { if (aviso) { aviso.textContent = t; aviso.hidden = false; } };
  diz('Preparando a foto…');
  try {
    const blob = await ctgReduzirFoto(arquivo, 1800, 0.72);
    const caminho = `contagem/${CTG.folha.id}/${Date.now()}-${(grupo || 'folha').replace(/[^A-Za-z0-9]/g, '_')}.jpg`;
    diz(`Enviando (${Math.round(blob.size / 1024)} KB)…`);
    let up = await fetch(`${SUPABASE_URL}/storage/v1/object/comprovantes/${caminho}`, {
      method: 'POST', headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${rmbSessao().access_token}`,
                                 'Content-Type': 'image/jpeg' }, body: blob });
    if (await rmbRenovarSeExpirado(up)) {
      up = await fetch(`${SUPABASE_URL}/storage/v1/object/comprovantes/${caminho}`, {
        method: 'POST', headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${rmbSessao().access_token}`,
                                   'Content-Type': 'image/jpeg' }, body: blob });
    }
    if (!up.ok) throw new Error('a foto não subiu (' + up.status + ')');

    // link assinado: 30 dias. E por ele que a transcricao baixa a imagem.
    const dias = 30;
    const sg = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/comprovantes/${caminho}`, {
      method: 'POST', headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${rmbSessao().access_token}`,
                                 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 60 * 60 * 24 * dias }) });
    const d = sg.ok ? await sg.json() : {};
    const link = d.signedURL ? `${SUPABASE_URL}/storage/v1${d.signedURL}` : null;

    await ctgFetch('est_contagem_foto', {
      method: 'POST', extra: { Prefer: 'return=minimal' },
      body: JSON.stringify({ id_inventario: CTG.folha.id, unidade: CTG.unidade, grupo,
        caminho, url_assinada: link, quem: (rmbSessao() || {}).email,
        assinada_ate: new Date(Date.now() + dias * 86400000).toISOString() }),
    });
    diz('Foto enviada. Ela aparece aqui para conferir depois da transcrição.');
    await ctgCarregar();
  } catch (e) { diz('Não consegui enviar: ' + e.message); }
}

async function ctgDescartarFoto(id) {
  if (!confirm('Descartar esta foto? (ficou tremida, cortada, folha errada)')) return;
  try {
    await ctgFetch(`est_contagem_foto?id=eq.${id}`, {
      method: 'PATCH', extra: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'DESCARTADA' }) });
    await ctgCarregar();
  } catch (e) { alert('Não consegui descartar: ' + e.message); }
}

// Grava na contagem o que a transcricao leu, DEPOIS da conferencia na tela.
async function ctgAplicarFoto(id, semPergunta) {
  const linhas = (CTG.fotoLinhas || []).filter((l) => l.id_foto === id);
  if (!linhas.length) { alert('Esta foto ainda não tem leitura.'); return; }
  const campos = linhas.map((l) => {
    const el = document.getElementById('fl_' + l.id);
    return { nome_saipos: l.nome_saipos, qtd: el && el.value !== '' ? Number(String(el.value).replace(',', '.')) : null };
  });
  const ruim = campos.find((c) => c.qtd !== null && !isFinite(c.qtd));
  if (ruim) { alert('Tem número inválido em ' + ruim.nome_saipos); return; }
  const gravar = campos.filter((c) => c.qtd !== null);
  if (!gravar.length) { alert('Nenhum número para gravar.'); return; }
  if (!semPergunta && !confirm(`Gravar ${gravar.length} itens contados na folha ${CTG.folha.id}?`)) return;
  const escopo = new Map(CTG.escopo.map((i) => [i.nome_saipos, i]));
  try {
    await ctgFetch('est_inventario_itens?on_conflict=id_inventario,nome_saipos', {
      method: 'POST', extra: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(gravar.map((c) => {
        const i = escopo.get(c.nome_saipos) || {};
        return { id_inventario: CTG.folha.id, nome_saipos: c.nome_saipos, un: i.un || null,
                 qtd_contada: c.qtd, custo: i.custo || null, custo_fonte: i.custo_fonte || null,
                 contado_por: (rmbSessao() || {}).email };
      })),
    });
    await ctgFetch(`est_contagem_foto?id=eq.${id}`, {
      method: 'PATCH', extra: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'APLICADA' }) });
    if (!semPergunta) await ctgCarregar();
    return true;
  } catch (e) { alert('Não consegui gravar: ' + e.message); return false; }
}

// FAIXA "PARA VOCÊ APROVAR" na contagem (dono, 20/10/2026: "quanto menos cliques melhor" — ele não achou onde validar,
// e não havia nada dele: as 2 fotos paradas esperavam a transcrição). Diz primeiro se há algo para quem aprova; as fotos
// lidas sem nenhuma dúvida gravam todas num clique; as com dúvida seguem conferidas linha a linha logo abaixo.
function ctgFotosLidas() {
  return (CTG.fotos || []).filter((f) => f.status === 'TRANSCRITA').map((f) => {
    const ls = (CTG.fotoLinhas || []).filter((l) => l.id_foto === f.id);
    return { id: f.id, grupo: f.grupo, n: ls.length, duvidas: ls.filter((l) => l.duvida).length };
  }).filter((f) => f.n);
}
function ctgFaixa(fotos, faltando) {
  const lidas = ctgFotosLidas();
  const sem = lidas.filter((f) => !f.duvidas), com = lidas.filter((f) => f.duvidas);
  const esperando = fotos.filter((f) => f.status === 'AGUARDANDO');
  const desde = esperando.length ? new Date(Math.min(...esperando.map((f) => new Date(f.criado_em))))
    .toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }) : '';
  const nItens = lidas.reduce((s, f) => s + f.n, 0), nSem = sem.reduce((s, f) => s + f.n, 0);
  const linha = (t, acao) => `<div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center; padding:6px 0; border-top:1px solid var(--line);"><div style="flex:1 1 240px; min-width:0;">${t}</div>${acao || ''}</div>`;
  if (!lidas.length && !esperando.length) return '';   // nada lido nem esperando: a faixa nao aparece
  let h = `<div class="contexto" style="text-align:left;${lidas.length ? ' border-color:var(--farol-perto);' : ''}">
    <b>${lidas.length ? `Para você aprovar: ${nItens} ${nItens === 1 ? 'item lido' : 'itens lidos'} em ${lidas.length} ${lidas.length === 1 ? 'foto' : 'fotos'}` : 'Nada para você aprovar agora.'}</b>`;
  if (sem.length) h += linha(`${sem.length} ${sem.length === 1 ? 'foto' : 'fotos'} sem nenhuma dúvida (${nSem} itens)`,
    `<button class="preset-btn" style="border-color:var(--farol-ok); color:var(--tx-1);" onclick="ctgAplicarSemDuvida()">gravar ${sem.length === 1 ? 'esta foto' : 'as ' + sem.length + ' fotos'}</button>`);
  if (com.length) h += linha(`<span style="color:var(--farol-perto);">${com.length} ${com.length === 1 ? 'foto' : 'fotos'} com dúvida (${com.reduce((s, f) => s + f.duvidas, 0)} linhas em âmbar)</span>: confira logo abaixo e grave cada uma`);
  if (esperando.length) h += linha(`<span style="color:var(--tx-3);">${esperando.length} ${esperando.length === 1 ? 'foto esperando' : 'fotos esperando'} a transcrição desde ${desde} — não é com você</span>`);
  // 21/10/2026: as paginas que faltam ja estao no quadro de paginas logo abaixo — nao se repetem aqui
  return h + '</div>';
}
// as fotos sem dúvida, todas de uma vez: uma pergunta só; grava cada uma pelo mesmo caminho do botão da foto
async function ctgAplicarSemDuvida() {
  const sem = ctgFotosLidas().filter((f) => !f.duvidas);
  if (!sem.length) return;
  const n = sem.reduce((s, f) => s + f.n, 0);
  if (!confirm(`Gravar ${n} itens de ${sem.length} ${sem.length === 1 ? 'foto' : 'fotos'} na folha ${CTG.folha.id}?\n(só as fotos em que não fiquei em dúvida; vale o número que está no campo)`)) return;
  for (const f of sem) { if (!(await ctgAplicarFoto(f.id, true))) break; }
  await ctgCarregar();
}

function ctgHtmlFotos() {
  const fotos = (CTG.fotos || []).filter((f) => f.status !== 'DESCARTADA');
  const grupos = [...new Set((CTG.base || []).map(ctgGrupoDe))].sort();
  // 21/10/2026: o titulo do quadro e' o "2 · Mandar a foto" de fora; aqui so o botao (antes repetia titulo e frase)
  let h = `    <div class="contexto" style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
      <input type="file" accept="image/*" capture="environment" id="ctgFotoArq" style="display:none" onchange="ctgEnviarFoto(this)">
      <button class="preset-btn" onclick="document.getElementById('ctgFotoArq').click()">📷 Tirar foto da folha</button>
      <span id="ctgFotoMsg" class="caption-label" hidden></span>
    </div>`;

  // QUAIS PAGINAS JA CHEGARAM (dono, 15/10/2026). Antes a pessoa escolhia o grupo numa lista
  // antes de fotografar — um passo a mais e uma chance de errar. Agora EU identifico a pagina
  // pelas linhas que transcrevo (grupo_das_linhas, em script/fotos_contagem.py) e este quadro
  // mostra o que ja entrou e o que falta. Em 14/10 duas paginas nunca foram fotografadas
  // (PAES e OUTROS, 20 itens) e so se descobriu no fim — era exatamente isto que faltava ver.
  const enviados = new Set(fotos.map((f) => f.grupo).filter(Boolean));
  const faltando = grupos.filter((g) => !enviados.has(g));
  const aLer = fotos.filter((f) => !f.grupo).length;
  h = ctgFaixa(fotos, faltando) + h;   // 20/10/2026: o que é para aprovar vem primeiro
  if (grupos.length) {
    h += `<div class="contexto" style="${faltando.length ? 'border-color:var(--farol-perto);' : ''}">
      <b>${grupos.length - faltando.length} de ${grupos.length} páginas já chegaram.</b>
      ${faltando.length ? ` Falta${faltando.length === 1 ? '' : 'm'}: <b style="color:var(--farol-perto);">${faltando.join(' · ')}</b>.`
                        : ' <span style="color:var(--farol-ok);">A folha está completa.</span>'}
      ${aLer ? `<div class="caption-label">${aLer} ${aLer === 1 ? 'foto ainda sem página' : 'fotos ainda sem página'} — eu preencho ao transcrever.</div>` : ''}</div>`;
  }
  if (!fotos.length) return h;
  // A COLUNA DO ✓ (dono, 15/10/2026): "colocar um sinal ao lado de cada foto enviada, pro
  // usuário ter certeza que deu certo o envio". Quem está com o celular na mão precisa saber
  // que a foto CHEGOU — isso é uma pergunta, e o que ela vira depois é outra. Por isso o ✓
  // verde fala só da chegada, em toda linha, e a Situação conta o resto.
  // E a tabela entrou num `div id="tabela..."`: sem isso ela nasce sem a grade padrão (bordas,
  // cabeçalho, zebra) e a tela ficava com as colunas desalinhadas.
  h += `<div id="tabelaFotosContagem"><table><thead><tr>
      <th style="width:1%;"></th><th>Enviada</th><th>Página</th><th>Situação</th><th></th></tr></thead><tbody>`;
  fotos.forEach((f) => {
    const lidas = (CTG.fotoLinhas || []).filter((l) => l.id_foto === f.id).length;
    const quando = new Date(f.criado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const cor = f.status === 'APLICADA' ? 'var(--farol-ok)'
              : f.status === 'TRANSCRITA' ? 'var(--info)' : 'var(--tx-4)';
    h += `<tr><td style="color:var(--farol-ok); font-size:15px;"
             title="A foto chegou ao painel e está guardada">✓</td>
      <td style="white-space:nowrap;">${quando}<span class="caption-label"> · ${estNome(f.quem)}</span></td>
      <td>${f.grupo ? f.grupo : `<span style="color:var(--tx-5);">a identificar</span>`}</td>
      <td style="color:${cor};">${f.status === 'AGUARDANDO' ? 'recebida · esperando a transcrição'
            : f.status === 'TRANSCRITA' ? `<b>${lidas} ${lidas === 1 ? 'item lido' : 'itens lidos'} — confira abaixo</b>` : 'já gravada na contagem'}</td>
      <td>${f.status === 'AGUARDANDO' ? `<button class="preset-btn" onclick="ctgDescartarFoto(${f.id})">descartar</button>` : ''}</td></tr>`;
  });
  h += `</tbody></table></div>
    <div class="caption-label" style="margin-top:6px;">
      <span style="color:var(--farol-ok);">✓</span> chegou ao painel · nenhuma foto se perde depois deste sinal.</div>`;

  (CTG.fotos || []).filter((f) => f.status === 'TRANSCRITA').forEach((f) => {
    const linhas = (CTG.fotoLinhas || []).filter((l) => l.id_foto === f.id);
    if (!linhas.length) return;
    h += `<div class="section-label">Confira o que eu li na foto de ${f.grupo || 'toda a folha'}</div>
      <div class="caption-label">O que está em âmbar é onde eu fiquei em dúvida. Corrija o que precisar e grave.</div>
      <div id="tabelaConfereFoto"><table><thead><tr><th style="width:1%;">#</th><th>Item</th><th style="text-align:right;">Li na foto</th><th>Unidade</th><th>Corrigir unidade</th><th></th></tr></thead><tbody>`;
    linhas.forEach((l) => {
      h += `<tr${l.duvida ? ' style="background:var(--surface-2);"' : ''}>
        <td style="color:var(--tx-5);">${l.linha == null ? '' : l.linha}</td>
        <td>${ctgNomeHtml(l.nome_saipos)}${l.nota ? `<div class="caption-label" style="color:var(--farol-perto);">${l.nota}</div>` : ''}</td>
        <td style="text-align:right;"><input type="number" step="0.001" id="fl_${l.id}" value="${l.qtd_lida == null ? '' : l.qtd_lida}"
             style="width:110px; text-align:right; background:var(--surface-2); border:1px solid ${l.duvida ? 'var(--farol-perto)' : 'var(--line)'}; border-radius:8px; color:var(--tx-1); padding:6px 8px;"></td>
        ${ctgUnidadeCelulas(l.nome_saipos)}
        <td style="color:${l.duvida ? 'var(--farol-perto)' : 'var(--tx-5)'};">${l.duvida ? 'confira' : ''}</td></tr>`;
    });
    h += `</tbody></table></div><div class="contexto"><button class="preset-btn" onclick="ctgAplicarFoto(${f.id})">Gravar estes itens na contagem</button></div>`;
  });
  return h;
}

// ---- A FOLHA IMPRESSA (dono, 08/10/2026: "vamos criar uma listagem impressa que possamos
// separar por grupo, pra facilitar"). A pessoa conta com o papel na mao, anota, e a folha volta
// para o painel — digitada aqui ou pela foto, que eu transcrevo e ela confere antes de gravar.
// A folha e CEGA de proposito: nao traz o esperado. E cada linha tem NUMERO, que e o que torna a
// transcricao da foto conferivel ("linha 14 = 3,5") sem depender de ler o nome escrito a mao.
const CTG_GRUPO_ORDEM = ['CARNES', 'CONGELADOS', 'LATICINIOS', 'HORTIFRUTI', 'SECOS', 'PAES',
  'BEBIDAS', 'CHOPES', 'DOCES', 'VEGANOS'];

// 21/10/2026: a folha vem de vw_est_folha_contagem — UMA linha por nome da base (as etiquetas do Saipos que viram o
// mesmo nome somam numa linha), com o grupo e a ordem decididos no banco. nome_saipos aqui e' a etiqueta que RECEBE a
// contagem (nome_saipos_conta); a tela mostra so o nome da base.
function ctgDaFolha(r) {
  return { nome_saipos: r.nome_saipos_conta, nome_base: r.nome_base, nomes_saipos: r.nomes_saipos, un_saipos: r.un,
           qtd: r.qtd, tipo: r.tipo, situacao: r.situacao, grupo: r.grupo, ordem_grupo: r.ordem_grupo };
}
function ctgGrupoDe(i) {
  if (i.grupo) return i.grupo;
  if (i.subgrupo) return i.subgrupo;
  if (i.grupo_receita) return 'PREPAROS · ' + i.grupo_receita;
  if (i.tipo === 'RECEITA') return 'PREPAROS';
  return 'OUTROS';
}

// `soEsteGrupo` imprime um grupo só (dono, 14/10/2026: "quero a opção de imprimir elas por
// grupo"). Sem ele, sai a folha inteira. **A NUMERAÇÃO É SEMPRE A DA FOLHA INTEIRA**: a
// transcrição da foto acha o item pelo número da linha, e se cada grupo recomeçasse no 1 a mesma
// "linha 14" significaria um item em cada folha. Por isso a contagem corre sobre todos os grupos
// e só a impressão é filtrada.
async function ctgImprimir(soEsteGrupo) {
  const f = CTG.folha;
  if (!f) { alert('Abra a folha de contagem primeiro.'); return; }
  let base = CTG.base;
  if (!base) {
    const u = encodeURIComponent(CTG.unidade);
    base = CTG.base = (await consultarTudo(`vw_est_folha_contagem?select=nome_base,nome_saipos_conta,nomes_saipos,etiquetas,qtd,un,tipo,situacao,grupo,ordem_grupo&unidade=eq.${u}&order=ordem_grupo,grupo,nome_base`)).map(ctgDaFolha);
    CTG._grupoDe = null;
  }
  const itens = ctgListaDoPapel(f);
  if (!itens.length) { alert('Nada para imprimir nesta folha.'); return; }

  // ordem FIXA dentro do grupo: a numeracao impressa e o que a transcricao da foto usa para
  // saber de que item e cada numero. Se a ordem variar, "linha 14" deixa de significar algo.
  const { porGrupo, grupos: todos } = ctgPorGrupo(itens);
  const grupos = soEsteGrupo ? todos.filter((g) => g === soEsteGrupo) : todos;
  if (!grupos.length) { alert('Grupo não encontrado nesta folha: ' + soEsteGrupo); return; }
  // de onde cada grupo comeca a numerar, contando a folha inteira
  const comeca = {};
  let acumulado = 0;
  todos.forEach((g) => { comeca[g] = acumulado; acumulado += porGrupo[g].length; });

  const w = window.open('', '_blank');
  if (!w) { alert('O navegador bloqueou a janela de impressão — libere pop-ups para este site.'); return; }
  let n = 0;
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Contagem ${f.data} — ${CTG.unidade}</title><style>
    body { font-family:Arial, sans-serif; color:#000; margin:18px 24px; }
    .cab { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #000; padding-bottom:6px; }
    h1 { font-size:18px; margin:0; }
    .cod { font-size:26px; font-weight:bold; letter-spacing:1px; }
    .sub { font-size:11.5px; color:#45443f; margin:3px 0 0; }
    .assina { font-size:12px; margin:10px 0 0; }
    .assina span { display:inline-block; border-bottom:1px solid #000; width:190px; margin:0 18px 0 4px; }
    h2 { font-size:13px; text-transform:uppercase; background:#e8e6dc; border:1px solid #9c9b90;
         padding:4px 6px; margin:0 0 4px; page-break-after:avoid; }
    /* QUEM DECIDE A QUEBRA E O JS, nao o seletor: o primeiro grupo sai sem a classe .quebra e
       os outros saem com ela. Ja erramos duas vezes aqui. Era .grupo:first-of-type, que
       nunca pegava: o cabecalho e a linha de assinatura tambem sao <div>, entao o primeiro
       .grupo nao e o primeiro div do corpo — e saia uma folha em branco na frente da lista
       (dono, 14/10/2026, com o print da previa); depois .grupo + .grupo, que e correto mas
       depende de os grupos serem irmaos diretos. Marcar no HTML nao depende de nada. */
    .grupo { padding-top:10px; }
    .quebra { page-break-before:always; break-before:page; }
    table { width:100%; border-collapse:collapse; page-break-inside:auto; }
    td, th { border-bottom:1px solid #bbb; padding:5px 6px; font-size:12.5px; text-align:left; }
    tr { page-break-inside:avoid; }
    th { font-size:10px; text-transform:uppercase; color:#45443f; }
    .n { width:30px; color:#45443f; font-size:11px; }
    .un { width:46px; }
    .box { width:120px; border:1px solid #000 !important; height:26px; }
    @media print { .naoimprime { display:none; } body { margin:10px 14px; } }
  </style></head><body>
    <button class="naoimprime" onclick="window.print()" style="float:right; padding:8px 14px;">Imprimir / salvar PDF</button>
    <div class="cab">
      <div><h1>Contagem de estoque — ${CTG.unidade}</h1>
        <div class="sub">${soEsteGrupo ? `grupo <b>${soEsteGrupo}</b>` : (f.escopo === 'CURVA_A' ? 'curva A' : 'folha inteira')} ·
          ${grupos.reduce((a, g) => a + porGrupo[g].length, 0)} itens · conte e escreva o número na caixa ·
          item que não existe mais, risque · <b>o número da linha é o que vale na foto</b></div></div>
      <div style="text-align:right;"><div class="cod">FOLHA ${f.id}</div>
        <div class="sub">${f.data.split('-').reverse().join('/')}</div></div>
    </div>
    <div class="assina">Contado por:<span></span> Conferido por:<span></span> Hora:<span style="width:90px;"></span></div>
    ${grupos.map((g, iG) => `<div class="grupo${iG ? ' quebra' : ''}"><h2>${g} — ${porGrupo[g].length} itens · linhas ${comeca[g] + 1} a ${comeca[g] + porGrupo[g].length}</h2><table>
      <tr><th class="n">#</th><th>Item</th><th class="un">Un</th><th class="box">Contado</th></tr>
      ${porGrupo[g].map((i, k) => { n = comeca[g] + k + 1; return `<tr><td class="n">${n}</td>
        <td>${i.nome_base || i.nome_saipos}</td>
        <td class="un">${(i.un_saipos || '').toLowerCase()}</td><td class="box"></td></tr>`; }).join('')}
    </table></div>`).join('')}
  </body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => { try { w.print(); } catch (e) {} }, 400);
}

// TUDO NO PAPEL (dono, 14/10/2026, mudando o plano do mesmo dia): "vamos somente com as folhas
// impressas, quero a opção de imprimir elas por grupo e que fiquem em ordem alfabética" e
// "podemos eliminar por ora a contagem direto pela tela". A tela deixou de ter campo de digitar:
// ela imprime, recebe a foto e mostra o que foi lido para conferir e corrigir.
// O que o papel leva: a folha CURVA_A leva os itens de maior valor; a GERAL leva tudo. Fica de
// fora o que não se conta (baixado, fora de controle, "não usa").
// ⚠️ A MESMA regra está em script/fotos_contagem.py (folha_numerada): a transcrição da foto acha
// o item pelo NÚMERO da linha, então as duas listas têm de ser idênticas. Mudou uma, muda a outra.
// NOME DA BASE (dono: "o que vale é a base daqui para tudo que o portal mostra"; proposta de 21/10/2026): a linha
// mostra SÓ o nome padrão da base (dono, 21/10/2026: "No estoque não precisa trazer nome do Saipos, a regra é clara, usar
// somente a base daqui"). A ORDEM e a NUMERAÇÃO da folha não mudam (a transcrição da foto acha o item pelo número da linha).
function ctgNomeHtml(nomeSaipos) {
  if (CTG._nomeBaseDe !== CTG.base) {
    CTG._nomeBase = new Map();
    (CTG.base || []).forEach((i) => {
      CTG._nomeBase.set(i.nome_saipos, i.nome_base);
      String(i.nomes_saipos || '').split(' + ').filter(Boolean).forEach((e) => CTG._nomeBase.set(e, i.nome_base));
    });
    CTG._nomeBaseDe = CTG.base;
  }
  const b = CTG._nomeBase.get(nomeSaipos);
  return `<b>${b || nomeSaipos}</b>`;   // dono, 21/10/2026: "No estoque não precisa trazer nome do Saipos ... usar somente a base daqui"
}
// UNIDADE NA CONFERENCIA DA FOTO (dono, 21/10/2026: "aqui pode trazer uma coluna com a unidade, e um campo para
// correção, assim já matamos itens que estejam com a unidade errada na base"). Mostra a unidade em que se conta (a do
// Saipos, a da etiqueta) e, quando a nossa (ft_insumos.un_uso) discorda sem decisão, as duas. O campo NÃO muda a base:
// grava uma PROPOSTA (est_propor_unidade) que o chat do Estoque aplica com antes e depois.
function ctgUnidadeDe(nomeSaipos) {
  if (!CTG.unConf) return null;
  if (CTG.unConf.has(nomeSaipos)) return CTG.unConf.get(nomeSaipos);
  const linha = (CTG.base || []).find((i) => String(i.nomes_saipos || '').split(' + ').includes(nomeSaipos));
  if (linha) return CTG.unConf.get(linha.nome_saipos) || null;
  // a transcricao da foto grava ora a etiqueta do Saipos, ora o nome da base: acha pelos dois
  if (CTG._unPorBaseDe !== CTG.unConf) { CTG._unPorBase = new Map([...CTG.unConf.values()].map((v) => [v.nome_base, v])); CTG._unPorBaseDe = CTG.unConf; }
  return CTG._unPorBase.get(nomeSaipos) || null;
}
function ctgUnidadeCelulas(nomeSaipos) {
  const x = ctgUnidadeDe(nomeSaipos);
  if (!x) return '<td style="color:var(--tx-5);">—</td><td></td>';
  const dm = (t) => String(t || '').slice(8, 10) + '/' + String(t || '').slice(5, 7);
  const disc = x.situacao === 'DISCORDAM, SEM DECISAO';
  // A NOSSA unidade manda (dono, 21/10); sem a nossa, mostra a do Saipos e pede a proposta (Estoque, 22/10: 39 itens)
  const un = `<b>${trEscH(x.un_nossa || x.un_decidida || x.un_contagem || '—')}</b>` +
    (!x.un_nossa ? `<div class="caption-label" style="color:var(--farol-perto);">sem unidade na base (a do Saipos): proponha a certa</div>`
      : x.situacao === 'L = KG' ? `<div class="caption-label">L = KG, na mesma proporção</div>`
      : disc ? `<div class="caption-label" style="color:var(--farol-perto);">no Saipos: ${trEscH(x.un_contagem)}</div>` : '');
  const opcoes = (CTG.unValidas || []).map((v) => `<option value="${trEscH(v)}"${x.un_proposta === v ? ' selected' : ''}>${trEscH(v)}</option>`).join('');
  const prop = x.proposta_id ? `<div class="caption-label">proposta: ${trEscH(x.un_proposta)} · ${trEscH(estNome(x.proposta_quem))} ${dm(x.proposta_em)}</div>` : '';
  return `<td>${un}</td><td><select onchange="ctgProporUnidade(this, '${trEscH(x.nome_saipos_conta).replace(/'/g, '&#39;')}')"
      style="background:var(--surface-2); border:1px solid var(--line); border-radius:8px; color:var(--tx-1); padding:5px 6px; font:inherit;">
      <option value="">${x.proposta_id ? '' : 'está certa'}</option>${opcoes}</select>${prop}</td>`;
}
async function ctgProporUnidade(sel, nomeSaipos) {
  const v = sel.value;
  if (!v) return;
  try {
    await ctgFetch('rpc/est_propor_unidade', {
      method: 'POST', extra: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_unidade: CTG.unidade, p_nome_saipos: nomeSaipos, p_un_proposta: v, p_obs: 'conferência da foto da contagem' }),
    });
    const x = CTG.unConf && CTG.unConf.get(nomeSaipos);
    if (x) { x.proposta_id = -1; x.un_proposta = v; x.proposta_quem = (rmbSessao() || {}).email || ''; x.proposta_em = new Date().toISOString(); }
    sel.insertAdjacentHTML('afterend', `<div class="caption-label" style="color:var(--farol-ok);">✓ proposta ${trEscH(v)} enviada ao Estoque</div>`);
  } catch (e) { alert('Não consegui gravar a proposta: ' + e.message); sel.value = ''; }
}
// o que da folha não bate com a base (vw_est_contagem_fora_da_base): só aparece quando há linha
function ctgFaixaForaBase() {
  const L = CTG.foraBase || [];
  if (!L.length) return '';
  return `<div class="contexto" style="text-align:left; border-color:var(--farol-perto);"><b>${L.length} ${L.length === 1 ? 'item da folha não bate' : 'itens da folha não batem'} com a base</b>${
    L.map((r) => `<div style="font-size:12.5px; margin-top:4px;">${ctgNomeHtml(r.nome_saipos)}<span style="color:var(--tx-3);">${r.o_que_fazer ? ' — ' + r.o_que_fazer : ''}${r.quem === 'DONO' ? ' (decisão do Neto)' : ' (com o chat do Estoque; não muda a contagem)'}</span></div>`).join('')}</div>`;
}

function ctgListaDoPapel(f) {
  const fora = ['BAIXADO POR ELE', 'FORA DO CONTROLE DE ESTOQUE', 'MARCADO NAO USA'];
  const curvaA = new Set(CTG.escopo.filter((i) => i.curva === 'A').map((i) => i.nome_saipos));
  return (CTG.base || []).filter((i) => !fora.includes(i.situacao))
                         .filter((i) => f.escopo === 'GERAL' || curvaA.has(i.nome_saipos));
}

// Os itens agrupados, na ordem da folha impressa e em ordem alfabética dentro do grupo.
function ctgPorGrupo(lista) {
  const porGrupo = {};
  // 21/10/2026: a ordem e' a do banco (ordem_grupo, grupo, nome_base) — a mesma que o fotos_contagem.py numera
  lista.slice().sort((a, b) => (a.nome_base || a.nome_saipos || '').localeCompare(b.nome_base || b.nome_saipos || '', 'pt-BR'))
       .forEach((i) => { const g = ctgGrupoDe(i); (porGrupo[g] = porGrupo[g] || []).push(i); });
  const ordemDe = {};
  lista.forEach((i) => { const g = ctgGrupoDe(i); if (i.ordem_grupo != null && ordemDe[g] == null) ordemDe[g] = Number(i.ordem_grupo); });
  const ordem = (g) => { if (ordemDe[g] != null) return ordemDe[g]; const k = CTG_GRUPO_ORDEM.indexOf(g); return k < 0 ? 50 : k; };
  return { porGrupo, grupos: Object.keys(porGrupo).sort((a, b) => ordem(a) - ordem(b) || a.localeCompare(b, 'pt-BR')) };
}

// A TELA EM TRÊS QUADROS (dono, 14/10/2026): "vai ter um quadro com um botão pra impressão das
// listas, um quadro com um botão pra subir as fotos e um quadro com a lista gerada com a contagem
// pra conferência e correção". É a ordem do trabalho: imprime, conta no papel, fotografa, confere.
function ctgHtmlContar(f) {
  const papel = ctgListaDoPapel(f);
  const feito = new Map(CTG.itens.map((i) => [i.nome_saipos, i]));
  const n = CTG.itens.length;
  const { porGrupo, grupos } = ctgPorGrupo(papel);

  let h = ctgFaixaForaBase() + `<div class="cards cards-3">
      <div class="card ${n >= papel.length && papel.length ? 'pos' : 'neutral'}"><div class="card-lbl">Contados</div>
        <div class="card-val">${n} de ${papel.length}</div>
        <div class="card-pct">${CTG.itens.filter((x) => x.conferido_em).length} conferidos · ${grupos.length} ${grupos.length === 1 ? 'grupo' : 'grupos'} na folha</div></div>
      <div class="card neutral"><div class="card-lbl">Fotos a transcrever</div>
        <div class="card-val">${(CTG.fotos || []).filter((x) => x.status === 'AGUARDANDO').length}</div>
        <div class="card-pct">a leitura vira número só depois de conferida</div></div>
      <div class="card ${n >= papel.length && papel.length ? 'pos' : 'neutral'}"><div class="card-lbl">Fechar</div>
        <div class="card-val"><button class="preset-btn" onclick="ctgFechar()">Fechar e conferir</button></div>
        <div class="card-pct">o esperado aparece depois de fechar</div></div>
    </div>`;

  // ---------------- QUADRO 1: imprimir as listas ----------------
  // 21/10/2026 (dono): "mantemos somente a impressão de todas as listas de uma só vez" — saem os botões por grupo
  // (cada grupo continua saindo numa folha própria dentro da impressão). O check de contados vem depois.
  h += `<div class="section-label">1 · Imprimir as listas</div>
    <div class="caption-label">Cada grupo sai numa folha, com os itens em ordem alfabética.</div>
    <div style="margin:10px 0 2px;"><button class="preset-btn" onclick="ctgImprimir()"
      style="font-size:14px; padding:11px 16px;">🖨️ Imprimir tudo — ${papel.length} ${papel.length === 1 ? 'item' : 'itens'}</button></div>`;

  // ---------------- QUADRO 2: subir as fotos ----------------
  h += `<div class="section-label">2 · Mandar a foto da folha preenchida</div>`;
  h += ctgHtmlFotos();

  // ---------------- QUADRO 3: conferir e corrigir ----------------
  h += `<div class="section-label">3 · A contagem, para conferir e corrigir${n ? ` — ${n} ${n === 1 ? 'item' : 'itens'}` : ''}</div>
    <div id="ctgConferir">${ctgHtmlConferir()}</div>`;
  return h;
}

// A contagem direto na tela saiu em 14/10/2026 ("podemos eliminar por ora a contagem direto pela
// tela"): tudo vai pelo papel e volta pela foto. O que sobrou do caminho antigo — ctgSalvar e
// ctgHtmlConferir — continua servindo a CORRECAO no quadro 3, que e onde se digita hoje.

function ctgHtmlConferencia(f) {
  const c = CTG.conf;
  const falta = c.filter((x) => x.situacao === 'FALTA');
  const sobra = c.filter((x) => x.situacao === 'SOBRA');
  const partida = c.filter((x) => x.situacao === 'PONTO DE PARTIDA');
  const explicar = c.filter((x) => x.precisa_explicar && !Number(x.explicado_reais || 0));
  const rs = (a) => a.reduce((s, x) => s + Number(x.diferenca_reais || 0), 0);

  let h = `<div class="cards cards-3">
      <div class="card ${falta.length ? 'neg' : 'pos'}"><div class="card-lbl">Falta na prateleira</div>
        <div class="card-val">R$ ${fmt(Math.abs(rs(falta)))}</div><div class="card-pct">${falta.length} itens</div></div>
      <div class="card neutral"><div class="card-lbl">Sobra</div>
        <div class="card-val">R$ ${fmt(rs(sobra))}</div><div class="card-pct">${sobra.length} itens</div></div>
      <div class="card ${explicar.length ? 'highlight' : 'pos'}"><div class="card-lbl">Esperando explicação</div>
        <div class="card-val">${explicar.length}</div><div class="card-pct">diferença acima de R$ 500</div></div>
    </div>`;

  if (partida.length) {
    h += `<div class="contexto">${partida.length} ${partida.length === 1 ? 'item está sendo contado' : 'itens estão sendo contados'}
      pela primeira vez — ${partida.length === 1 ? 'ele é' : 'eles são'} o ponto de partida e não ${partida.length === 1 ? 'tem' : 'têm'} diferença.</div>`;
  }

  h += `<div class="section-label">Item a item</div>
    <div class="caption-label">Diferença acima de R$ 500 precisa de motivo escrito; o resto aparece para você ver.</div>
    <div id="tabelaConferencia"><table><thead><tr>
      <th>Item</th><th style="text-align:right;">Contado</th><th style="text-align:right;">Esperado</th>
      <th style="text-align:right;">Diferença</th><th style="text-align:right;">R$</th><th>Situação</th><th></th></tr></thead><tbody>`;
  c.forEach((x) => {
    const cor = x.situacao === 'FALTA' ? 'var(--farol-fora)'
              : x.situacao === 'SOBRA' ? 'var(--amber-2)'
              : x.situacao === 'BATEU' ? 'var(--farol-ok)' : 'var(--tx-5)';
    const temNome = Number(x.explicado_reais || 0) !== 0;
    h += `<tr><td>${ctgNomeHtml(x.nome_saipos)}</td>
      <td style="text-align:right;">${fmt(Number(x.qtd_contada))}</td>
      <td style="text-align:right;">${x.esperado === null ? '—' : fmt(Number(x.esperado))}</td>
      <td style="text-align:right; color:${cor};">${x.diferenca === null ? '—' : fmt(Number(x.diferenca))}</td>
      <td style="text-align:right; color:${cor};">${x.diferenca_reais === null ? '—' : fmt(Number(x.diferenca_reais))}</td>
      <td style="color:${cor};">${x.situacao}</td>
      <td>${x.precisa_explicar && !temNome ? `<button class="preset-btn" onclick="ctgExplicar(${x.id}, ${x.diferenca}, ${x.diferenca_reais})">explicar</button>`
            : temNome ? '<span style="color:var(--farol-ok);">explicado</span>' : ''}</td></tr>`;
  });
  h += `</tbody></table></div>`;
  return h;
}

async function ctgAbrir(escopo) {
  const s = rmbSessao();
  try {
    await ctgFetch('est_inventario', {
      method: 'POST', extra: { Prefer: 'return=representation' },
      body: JSON.stringify({ unidade: CTG.unidade, local: 'ESTOQUE', data: ctgHoje(), escopo, aberta_por: s.email }),
    });
    await ctgCarregar();
  } catch (e) { alert('Não consegui abrir a folha: ' + e.message); }
}

async function ctgSalvar(campo, nome, un, custo, custoFonte) {
  if (campo.value === '') return;
  const s = rmbSessao();
  campo.style.borderColor = 'var(--line)';
  try {
    await ctgFetch('est_inventario_itens?on_conflict=id_inventario,nome_saipos', {
      method: 'POST', extra: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ id_inventario: CTG.folha.id, nome_saipos: nome, un: un || null,
        qtd_contada: Number(campo.value), custo, custo_fonte: custoFonte || null, contado_por: s.email,
        // numero corrigido volta a NAO conferido: ninguem olhou o valor novo ainda
        conferido_em: null, conferido_por: null }),
    });
    campo.style.borderColor = 'var(--farol-ok)';
    // a cópia local tem de acompanhar a CORREÇÃO também, senão a lista de conferir mostra o
    // número velho até alguém recarregar a tela
    const ja = CTG.itens.find((i) => i.nome_saipos === nome);
    const agora = new Date().toISOString();
    if (ja) { ja.qtd_contada = Number(campo.value); ja.contado_em = agora; ja.contado_por = s.email; }
    else CTG.itens.push({ nome_saipos: nome, un: un || null, qtd_contada: Number(campo.value),
                          contado_em: agora, contado_por: s.email });
    const conf = document.getElementById('ctgConferir');
    if (conf) conf.innerHTML = ctgHtmlConferir();
  } catch (e) {
    campo.style.borderColor = 'var(--farol-fora)';
    alert('Não consegui gravar ' + nome + ': ' + e.message);
  }
}

// APAGAR A LINHA QUE FOI PARAR NO ITEM ERRADO (dono, 14/10/2026, depois de testar com a Rita:
// "pode acontecer da pessoa colocar o valor errado"). Corrigir o número é digitar por cima;
// apagar é para quando o número foi lançado no item errado. Só vale com a folha ABERTA — folha
// fechada já é o ponto de partida do saldo, e o banco barra pela policy.
async function ctgApagar(nome) {
  const j = CTG.itens.find((i) => i.nome_saipos === nome);
  if (!j) return;
  if (!confirm(`Apagar a contagem de ${nome} (${fmt(Number(j.qtd_contada))} ${j.un || ''})?\n\n`
             + `A linha some da folha e o item volta a aparecer como não contado.`)) return;
  try {
    await ctgFetch(`est_inventario_itens?id_inventario=eq.${CTG.folha.id}`
                   + `&nome_saipos=eq.${encodeURIComponent(nome)}`,
                   { method: 'DELETE', extra: { Prefer: 'return=minimal' } });
    CTG.itens = CTG.itens.filter((i) => i.nome_saipos !== nome);
    ctgRender();
  } catch (e) { alert('Não consegui apagar: ' + e.message); }
}

// A hora vem do banco em UTC (armadilha conhecida do projeto). Na tela, sempre São Paulo.
function ctgHora(v) {
  if (!v) return '';
  return new Date(v).toLocaleTimeString('pt-BR',
    { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
}

// CONFERIR E CORRIGIR — a lista do que já foi digitado, para revisar antes de fechar.
// O CHECK DE CONFERÊNCIA (dono, 14/10/2026: "pode ser check de marcação e um só ok no final").
// O número do quadro 3 nasceu da LEITURA DE UMA FOTO, e leitura de foto erra: enquanto ninguém
// marcar, ele está no sistema sem ter passado por olho humano. Marcar é local; o OK do fim é que
// grava quem conferiu e quando.
function ctgMarcar(nome, ligado) {
  CTG.marcados = CTG.marcados || new Set();
  if (ligado) CTG.marcados.add(nome); else CTG.marcados.delete(nome);
  const bt = document.getElementById('ctgBtOk');
  if (bt) {
    const n = CTG.marcados.size;
    bt.textContent = n ? `✓ OK — conferi ${n} ${n === 1 ? 'item' : 'itens'}` : '✓ OK — marque os itens conferidos';
    bt.style.borderColor = n ? 'var(--marca-amarelo)' : 'var(--line)';
  }
}
function ctgMarcarTodos(ligado) {
  CTG.marcados = new Set(ligado ? CTG.itens.filter((i) => !i.conferido_em).map((i) => i.nome_saipos) : []);
  ctgRender();
}
async function ctgConferirOk() {
  const nomes = [...(CTG.marcados || new Set())];
  if (!nomes.length) { alert('Marque os itens que você conferiu.'); return; }
  const s = rmbSessao();
  const agora = new Date().toISOString();
  try {
    const lista = nomes.map((n) => `"${n.replace(/"/g, '\\"')}"`).join(',');
    await ctgFetch(`est_inventario_itens?id_inventario=eq.${CTG.folha.id}&nome_saipos=in.(${encodeURIComponent(lista)})`, {
      method: 'PATCH', extra: { Prefer: 'return=minimal' },
      body: JSON.stringify({ conferido_em: agora, conferido_por: s.email }),
    });
    CTG.itens.forEach((i) => { if (nomes.includes(i.nome_saipos)) { i.conferido_em = agora; i.conferido_por = s.email; } });
    CTG.marcados = new Set();
    ctgRender();
  } catch (e) { alert('Não consegui marcar como conferido: ' + e.message); }
}

// o que ficou em branco no papel e ainda não foi preenchido aqui (some da lista assim que grava)
function ctgHtmlBrancos() {
  const ja = new Set(CTG.itens.map((i) => i.nome_saipos));
  const L = (CTG.brancos || []).filter((b) => !ja.has(b.nome_saipos_conta));
  if (!L.length) return '';
  let h = `<div class="contexto" style="text-align:left; border-color:var(--farol-perto); margin-bottom:10px;">
    <b style="color:var(--farol-perto);">${L.length} ${L.length === 1 ? 'item ficou em branco' : 'itens ficaram em branco'} no papel</b>
    <div style="font-size:12.5px; margin-top:2px;">Se não tinha, digite <b>0</b>; se tinha, digite o que foi contado. Grava ao sair do campo.</div>
    <div id="tabelaBrancos" style="margin-top:6px;"><table><thead><tr><th style="width:1%;">#</th><th>Item</th><th>Página</th><th style="text-align:right;">Contado</th></tr></thead><tbody>`;
  L.forEach((b) => {
    const nome = JSON.stringify(b.nome_saipos_conta).replace(/"/g, '&quot;');
    const e = (CTG.escopo || []).find((x) => x.nome_saipos === b.nome_saipos_conta) || {};
    h += `<tr><td style="color:var(--tx-5);">${b.linha == null ? '' : b.linha}</td>
      <td><b>${trEscH(b.nome)}</b>${b.situacao === 'EM BRANCO NO FIM DA PAGINA' ? '<div class="caption-label">no fim da página</div>' : ''}</td>
      <td style="color:var(--tx-4);">${trEscH(b.grupo || '')}</td>
      <td style="text-align:right; white-space:nowrap;"><input type="number" step="0.001" min="0" inputmode="decimal" placeholder="0 ou o valor"
           onchange="ctgSalvar(this, ${nome}, ${JSON.stringify(b.un || '').replace(/"/g, '&quot;')}, ${e.custo || 'null'}, ${JSON.stringify(e.custo_fonte || '').replace(/"/g, '&quot;')})"
           style="width:120px; text-align:right; background:var(--surface-2); border:1px solid var(--farol-perto); border-radius:8px; color:var(--tx-1); padding:8px;">
        <span style="color:var(--tx-5); font-size:11.5px;"> ${trEscH(b.un || '')}</span></td></tr>`;
  });
  return h + `</tbody></table></div></div>`;
}

function ctgHtmlConferir() {
  const feitos = CTG.itens.slice().sort((a, b) => (b.contado_em || '').localeCompare(a.contado_em || ''));
  const brancos = ctgHtmlBrancos();
  if (!feitos.length) {
    return brancos || `<div class="caption-label">Nada ainda — o que vier da foto aparece aqui para conferir e corrigir.</div>`;
  }
  const porNome = new Map(CTG.escopo.map((i) => [i.nome_saipos, i]));
  CTG.marcados = CTG.marcados || new Set();
  const jaConferidos = feitos.filter((j) => j.conferido_em).length;
  const faltam = feitos.length - jaConferidos;

  let h = brancos + `<div class="caption-label">O mais recente em cima. Corrija o número aqui mesmo, marque o que estiver certo
      e dê um OK no fim. ${jaConferidos ? `<b>${jaConferidos} de ${feitos.length} já conferidos.</b>` : ''}</div>`;
  if (faltam > 1) {
    h += `<div style="margin:8px 0 2px;"><button class="preset-btn" onclick="ctgMarcarTodos(true)">marcar os ${faltam} que faltam</button>
      ${CTG.marcados.size ? `<button class="preset-btn" onclick="ctgMarcarTodos(false)">limpar as marcas</button>` : ''}</div>`;
  }
  h += `<div id="tabelaConferir"><table><thead><tr>
      <th style="width:34px;">✓</th><th>Item</th><th style="text-align:right;">Contado</th><th>Hora</th><th></th></tr></thead><tbody>`;
  feitos.forEach((j) => {
    const i = porNome.get(j.nome_saipos) || {};
    const id = btoa(unescape(encodeURIComponent(j.nome_saipos))).replace(/[^A-Za-z0-9]/g, '');
    h += `<tr${j.conferido_em ? ' style="opacity:.72;"' : ''}>
      <td>${j.conferido_em
            ? `<span style="color:var(--farol-ok); font-weight:700;" title="Conferido por ${estNome(j.conferido_por)} às ${ctgHora(j.conferido_em)}">✓</span>`
            : `<input type="checkbox" id="ctgc_${id}" ${CTG.marcados.has(j.nome_saipos) ? 'checked' : ''}
                 onchange="ctgMarcar(${JSON.stringify(j.nome_saipos).replace(/"/g, '&quot;')}, this.checked)"
                 style="width:20px; height:20px;">`}</td>
      <td>${ctgNomeHtml(j.nome_saipos)}</td>
      <td style="text-align:right;"><input type="number" step="0.001" inputmode="decimal"
           id="ctgr_${id}" value="${j.qtd_contada}"
           onchange="ctgSalvar(this, ${JSON.stringify(j.nome_saipos).replace(/"/g, '&quot;')}, ${JSON.stringify(j.un || i.un || '').replace(/"/g, '&quot;')}, ${i.custo || 'null'}, ${JSON.stringify(i.custo_fonte || '').replace(/"/g, '&quot;')})"
           style="width:104px; text-align:right; background:var(--surface-2); border:1px solid var(--line); border-radius:8px; color:var(--tx-1); padding:8px;">
        <span style="color:var(--tx-5); font-size:11.5px;"> ${j.un || i.un || ''}</span></td>
      <td style="color:var(--tx-4); font-size:12px;">${ctgHora(j.contado_em)}</td>
      <td><button class="preset-btn" onclick="ctgApagar(${JSON.stringify(j.nome_saipos).replace(/"/g, '&quot;')})"
            title="Apagar esta linha da folha">apagar</button></td></tr>`;
  });
  h += `</tbody></table></div>`;
  h += `<div style="margin:12px 0 4px;"><button class="preset-btn" id="ctgBtOk" onclick="ctgConferirOk()"
      style="font-size:14px; padding:11px 18px;${CTG.marcados.size ? ' border-color:var(--marca-amarelo);' : ''}">${
      CTG.marcados.size ? `✓ OK — conferi ${CTG.marcados.size} ${CTG.marcados.size === 1 ? 'item' : 'itens'}`
                        : '✓ OK — marque os itens conferidos'}</button></div>`;
  return h;
}

// Fechar é o instante em que o ESPERADO é carimbado em cada linha, a partir do nosso saldo —
// por isso quem fecha é a função do banco (est_fechar_contagem), e não um PATCH de status.
// Depois do fechamento a própria contagem vira o ponto de partida do saldo: se o esperado não
// fosse gravado aqui, ele seria irrecuperável e toda diferença daria zero.
async function ctgFechar() {
  const esperados = ctgListaDoPapel(CTG.folha).length;
  const n = CTG.itens.length;
  if (n < esperados && !confirm(`Faltam ${esperados - n} itens sem contar. Fechar assim mesmo?`)) return;
  const semConferir = CTG.itens.filter((i) => !i.conferido_em).length;
  if (semConferir && !confirm(`${semConferir} ${semConferir === 1 ? 'item veio da foto e não foi conferido' : 'itens vieram da foto e não foram conferidos'}.

`
      + `Depois de fechar, o número vira o ponto de partida do saldo e não se corrige mais. Fechar assim mesmo?`)) return;
  try {
    const r = await ctgFetch('rpc/est_fechar_contagem', {
      method: 'POST', extra: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_id: CTG.folha.id }),
    });
    const res = (await r.json())[0] || {};
    // 23/10/2026: sem esperar — leva até 17 s a frio e a resposta pode se perder no pooler; o banco termina sozinho
    ctgFetch('rpc/est_refazer_extrato', { method: 'POST', extra: { 'Content-Type': 'application/json' }, body: '{}' })
      .catch((e) => console.warn('extrato do controle nao refeito:', e.message));
    await ctgCarregar();
    if (res.sem_esperado) {
      alert(`Folha fechada. ${res.com_esperado} ${res.com_esperado === 1 ? 'item tem' : 'itens têm'} comparação;`
            + ` ${res.sem_esperado} ${res.sem_esperado === 1 ? 'é' : 'são'} ponto de partida (o sistema ainda não`
            + ` conhecia esse saldo).`);
    }
  } catch (e) { alert('Não consegui fechar: ' + e.message); }
}

const CTG_TIPOS = [
  ['TRANSFERENCIA_NAO_LANCADA', 'Foi para a filial e ninguém baixou'],
  ['PRODUCAO_NAO_APONTADA', 'Virou preparo e não foi apontado'],
  ['ATACADO', 'Saiu para venda de atacado'],
  ['PERDA', 'Estragou, quebrou ou venceu'],
  ['ERRO_DE_CADASTRO', 'Unidade ou conversão errada no cadastro'],
  ['CONTAGEM_ERRADA', 'Contamos errado'],
  ['CONSUMO_INTERNO', 'Refeição da equipe, teste ou cortesia'],
  ['OUTRO', 'Outro'],
];

async function ctgExplicar(idItem, dif, difRs) {
  const s = rmbSessao();
  const opcoes = CTG_TIPOS.map(([k, t], i) => `${i + 1}. ${t}`).join('\n');
  const escolha = prompt(`Diferença de ${fmt(dif)} (R$ ${fmt(difRs)}).\nO que aconteceu?\n\n${opcoes}\n\nDigite o número:`);
  if (!escolha) return;
  const tipo = (CTG_TIPOS[Number(escolha) - 1] || [])[0];
  if (!tipo) { alert('Número inválido.'); return; }
  const obs = prompt('Alguma observação? (pode deixar em branco)') || null;
  const resp = tipo === 'PERDA' || tipo === 'CONSUMO_INTERNO'
    ? (prompt('Quem responde? (pode deixar em branco — a regra de desconto ainda não existe)') || null) : null;
  try {
    await ctgFetch('est_quebra', {
      method: 'POST', extra: { Prefer: 'return=minimal' },
      body: JSON.stringify({ id_item: idItem, tipo, qtd: dif, valor: difRs, responsavel: resp, observacao: obs, quem: s.email }),
    });
    await ctgCarregar();
  } catch (e) { alert('Não consegui gravar a explicação: ' + e.message); }
}

// ==================================================================
// APONTAR PRODUCAO — 08/10/2026
// ------------------------------------------------------------------
// Por que a tela existe: o motor do saldo (vw_est_movimento) tem duas pernas de producao —
// ENTRA a receita pronta e SAEM os ingredientes dela, pela NOSSA ficha (decisao do dono em
// 08/10: a venda tira a receita pronta; a producao tira o ingrediente). Sem alguem apontar,
// a receita so CAI com a venda e nunca sobe: saldo negativo de receita e o alarme de que
// faltou apontar, nao defeito da conta.
// O que o BANCO impoe (script/estoque_apontar_producao.sql), e por isso a tela nao precisa
// policiar: aponta-se no proprio nome, na propria loja, com data de ate 7 dias atras; desfazer
// so vale no que a propria pessoa lancou nas ultimas 12 horas; e apontamento gravado nao se
// edita — correcao depois disso e lancamento novo, para o historico nao sumir.
// ==================================================================
// ======================= PLANEJAR PRODUÇÃO (PLP) — 10/10/2026 =======================
// Pedido do dono (08/10/2026): "com base no saldo de estoque X volume de vendas, o modulo
// tenha condicoes de planejar o que precisamos produzir, criar uma ficha de separacao de
// insumos para o estoque separar e entregar para a producao".
// O HORIZONTE vem da decisao dele de 10/10/2026: "contagem vai ser toda quarta" — o plano
// fecha de quarta a quarta.
// A CONTA MORA NO BANCO (vw_est_plano_producao e vw_est_separacao). Esta tela nao recalcula
// nada: e por isso que o saldo daqui e o mesmo da tela de Contagem e do Estoque.
let PLP = null;   // { unidade, plano, separacao, idade, filtro, busca }

// ---- O CICLO EM QUATRO TELAS (dono, 27/10/2026): Planejar → Separação → Ordens → Apontar, cada uma com o histórico ----
let EST_TELA = null;      // a tela do ciclo aberta agora: plprod | separacao | ordens | producao
let EST_FILA = null;      // vw_est_fila_do_dia da loja
async function estFilaCarregar(unidade) {
  try { EST_FILA = (await consultarTudo(`vw_est_fila_do_dia?select=*&unidade=eq.${encodeURIComponent(unidade)}`))[0] || null; }
  catch (e) { EST_FILA = null; }
}
// a tira do topo: onde está o trabalho de agora; cada número leva à tela que resolve
function estFilaHtml() {
  return estFilaHtmlSo() + '<!--HIST-->';
}
function estFilaHtmlSo() {
  const f = EST_FILA;
  const etapas = [['plprod', 'Planejar'], ['separacao', 'Separação'], ['ordens', 'Ordens'], ['producao', 'Apontar']];
  const abas = `<div style="display:flex; gap:6px; flex-wrap:wrap; margin:2px 0 8px;">${etapas.map(([k, r], i) =>
    `<button class="preset-btn${EST_TELA === k ? ' active' : ''}" onclick="${EST_TELA === k ? '' : `mostrarModulo('${k}')`}">${i + 1}. ${r}</button>`).join('<span style="color:var(--tx-5); align-self:center;">›</span>')}</div>`;
  if (!f) return abas;
  const n = (v) => Number(v) || 0;
  const it = (tela, qtd, rot, cor) => `<a href="javascript:void(0)" onclick="${EST_TELA === tela ? '' : `mostrarModulo('${tela}')`}"
      style="color:${qtd ? cor : 'var(--tx-5)'}; ${qtd ? 'font-weight:700;' : ''} text-decoration:none; white-space:nowrap;">${qtd} ${rot}</a>`;
  const sit = String(f.plano_de_amanha || '').toUpperCase();
  const plano = `<a href="javascript:void(0)" onclick="${EST_TELA === 'plprod' ? '' : "mostrarModulo('plprod')"}" style="text-decoration:none; color:${sit === 'FECHADO' ? 'var(--farol-ok)' : 'var(--farol-perto)'}; font-weight:700; white-space:nowrap;">plano de ${ffDdmm(f.planejando_para)}: ${sit ? sit.toLowerCase() : 'não começou'}</a>`;
  return abas + `<div class="contexto" style="text-align:left; display:flex; flex-wrap:wrap; gap:4px 14px; font-size:13px;">
      <span style="color:var(--tx-4);">Onde está o trabalho:</span> ${plano}
      · ${it('separacao', n(f.listas_a_separar), 'a separar', 'var(--farol-perto)')}
      · ${it('separacao', n(f.listas_a_conferir), 'a conferir', 'var(--farol-perto)')}
      · ${it('separacao', n(f.listas_a_virar_ordem), 'a virar ordem', 'var(--farol-perto)')}
      · ${it('ordens', n(f.ordens_a_iniciar), 'ordem a iniciar', 'var(--farol-perto)')}
      · ${it('ordens', n(f.ordens_correndo), 'ordem correndo', 'var(--farol-ok)')}
      · ${it('ordens', n(f.receitas_sem_apontar), 'receita sem apontar', 'var(--farol-fora)')}</div>`;
}
function estQuando(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return isNaN(d) ? '—' : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '');
}
// histórico: as últimas linhas, com "ver mais"
const EST_HIST = {};
async function estHistCarregar(chave, view, unidade, ordem) {
  const lim = (EST_HIST[chave] && EST_HIST[chave].lim) || 30;
  try {
    const rows = await consultarTudo(`${view}?select=*&unidade=eq.${encodeURIComponent(unidade)}&order=${ordem}&limit=${lim + 1}`);
    const ant = EST_HIST[chave] || {};
    EST_HIST[chave] = { lim, rows: rows.slice(0, lim), mais: rows.length > lim, aberto: ant.aberto, det: ant.det, dets: {} };
  } catch (e) { EST_HIST[chave] = { lim, erro: e.message, rows: [], aberto: (EST_HIST[chave] || {}).aberto }; }
}
function estHistHtml(chave, titulo, legenda, cols, linhaFn) {
  const H = EST_HIST[chave];
  if (!H) return '';
  const aberto = !!H.aberto;
  const n = (H.rows || []).length;
  let h = `<div class="contexto" style="text-align:left; padding:8px 12px;">
    <a href="javascript:void(0)" onclick="estHistToggle('${chave}')" style="text-decoration:none; color:var(--tx-1); font-weight:700;">
      ${aberto ? '▾' : '▸'} ${titulo} <span style="color:var(--tx-4); font-weight:400;">· ${n}${H.mais ? '+' : ''} ${n === 1 ? 'registro' : 'registros'}</span></a>`;
  if (!aberto) return h + `</div>`;
  h += `<div class="caption-label" style="text-align:left;">${legenda}${EST_HIST_DET[chave] ? ' Clique numa linha para ver o detalhe.' : ''}</div>`;
  if (H.erro) return h + `<div style="color:var(--amber-2);">Não consegui ler o histórico agora: ${trEscH(H.erro)}</div></div>`;
  if (!n) return h + `<div style="color:var(--tx-4);">Nada registrado ainda.</div></div>`;
  const clicavel = !!EST_HIST_DET[chave];
  h += `<div id="tabelaHist_${chave}"><table><thead><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>
    ${H.rows.map((r) => {
      let tr = linhaFn(r);
      if (clicavel) {
        const sel = H.det === r.id;
        const at = `onclick="estHistAbrir('${chave}', ${Number(r.id)})" title="${sel ? 'clique para fechar' : 'clique para ver o detalhe'}"`;
        tr = /^<tr style="/.test(tr) ? tr.replace('<tr style="', `<tr ${at} style="cursor:pointer; ${sel ? 'background:var(--surface-2);' : ''}`)
                                     : tr.replace('<tr', `<tr ${at} style="cursor:pointer; ${sel ? 'background:var(--surface-2);' : ''}"`);
        if (sel) tr += `<tr><td colspan="${cols.length}" style="white-space:normal; padding:8px 12px 12px; background:var(--surface-2);">${(H.dets || {})[r.id] || 'Carregando…'}</td></tr>`;
      }
      return tr;
    }).join('')}</tbody></table></div>`;
  if (H.mais) h += `<div style="text-align:center; margin:8px 0;"><button class="preset-btn" onclick="estHistMais('${chave}')">ver mais antigos</button></div>`;
  return h + `</div>`;
}
// 27/10/2026 (dono): o histórico mora no topo, logo abaixo da tira — a tela marca o lugar e o histórico entra ali
function estHistTopo(h, ...args) { return h.includes('<!--HIST-->') ? h.replace('<!--HIST-->', estHistHtml(...args)) : h + estHistHtml(...args); }
function estRender() {
  if (EST_TELA === 'separacao') return sepRender();
  if (EST_TELA === 'ordens' || EST_TELA === 'producao') return prdRender();
  return plpRender();
}
function estHistToggle(chave) { EST_HIST[chave].aberto = !EST_HIST[chave].aberto; estRender(); }
async function estHistAbrir(chave, id) {
  const H = EST_HIST[chave];
  if (H.det === id) { H.det = null; return estRender(); }
  H.det = id; H.dets = H.dets || {};
  estRender();
  if (!H.dets[id]) {
    try { H.dets[id] = await EST_HIST_DET[chave](id); }
    catch (e) { H.dets[id] = `<span style="color:var(--farol-fora);">Não consegui ler o detalhe: ${trEscH(e.message)}</span>`; }
    if (H.det === id) estRender();
  }
}
// o detalhe de cada histórico (só leitura)
const estMini = (cols, linhas) => `<table style="width:100%; border-collapse:collapse; font-size:12.5px;"><thead><tr>${cols.map((c) =>
  `<th style="text-align:left; padding:3px 8px; color:var(--tx-4); font-size:11px; text-transform:uppercase; border-bottom:1px solid var(--line);">${c}</th>`).join('')}</tr></thead>
  <tbody>${linhas.map((l) => `<tr>${l.map((c) => `<td style="padding:3px 8px; border-bottom:1px solid var(--line);">${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const EST_HIST_DET = {
  plano: async (id) => {
    const [itens, seps, ords] = await Promise.all([
      consultarTudo(`est_plano_item?select=nome_base,qtd,un,sugerido,observacao&id_plano=eq.${id}&order=nome_base`),
      consultarTudo(`vw_est_historico_separacao?select=id,numero,familia,leitura,virou_a_ordem&id_plano=eq.${id}&order=numero`).catch(() => []),
      consultarTudo(`vw_est_historico_ordem?select=id,numero,familia,leitura,receitas,receitas_apontadas&id_plano=eq.${id}&order=numero`).catch(() => []),
    ]);
    let h = `<b>Receitas decididas (${itens.length})</b>` + (itens.length ? estMini(['Receita', 'Planejado', 'Sugestão na hora'],
      itens.map((i) => [trEscH(i.nome_base), `${fmt(Number(i.qtd))} ${trEscH(i.un || '')}`, i.sugerido == null ? '—' : fmt(Number(i.sugerido))])) : '<div style="color:var(--tx-4);">nenhuma</div>');
    h += `<div style="margin-top:8px;"><b>Listas de separação (${seps.length})</b></div>` + (seps.length ? estMini(['Lista', 'Família', 'Situação', 'Virou a ordem'],
      seps.map((s) => [trEscH(s.numero), trEscH(String(s.familia || 'individual').toLowerCase()), trEscH(s.leitura || ''), trEscH(s.virou_a_ordem || '—')])) : '<div style="color:var(--tx-4);">nenhuma gerada</div>');
    h += `<div style="margin-top:8px;"><b>Ordens de produção (${ords.length})</b></div>` + (ords.length ? estMini(['Ordem', 'Família', 'Receitas apontadas', 'Situação'],
      ords.map((o) => [trEscH(o.numero), trEscH(String(o.familia || 'individual').toLowerCase()), `${Number(o.receitas_apontadas) || 0} de ${Number(o.receitas) || 0}`, trEscH(o.leitura || '')])) : '<div style="color:var(--tx-4);">nenhuma ainda</div>');
    return h;
  },
  sep: async (id) => {
    const ls = await consultarTudo(`vw_est_separacao_folha?select=nome_base,un,qtd_prevista,qtd_separada,etapa,observacao,o_que_produzir&id=eq.${id}&order=nome_base`);
    ls.sort((a, b) => (a.etapa === 'CORTE' ? 0 : 1) - (b.etapa === 'CORTE' ? 0 : 1));
    return (ls[0] && ls[0].o_que_produzir ? `<div style="color:var(--tx-3); margin-bottom:4px;">produzir: ${trEscH(ls[0].o_que_produzir)}</div>` : '')
      + estMini(['Insumo', 'Previsto', 'Separado', 'Observação'], ls.map((l) => [
        (l.etapa === 'CORTE' ? '<b style="color:var(--amber-2);">[corte]</b> ' : '') + trEscH(l.nome_base),
        `${fmt(Number(l.qtd_prevista))} ${trEscH(l.un || '')}`, l.qtd_separada == null ? '—' : `${fmt(Number(l.qtd_separada))} ${trEscH(l.un || '')}`,
        trEscH(l.observacao || '')]));
  },
  ordem: async (id) => {
    const its = await consultarTudo(`vw_est_ordem_item?select=nome_base,qtd,un,ja_apontado,perda_apontada,leitura&id_ordem=eq.${id}&order=nome_base`);
    return estMini(['Receita', 'A ordem mandou', 'Apontado', 'Perda', 'Situação'], its.map((i) => [trEscH(i.nome_base),
      `${fmt(Number(i.qtd))} ${trEscH(i.un || '')}`, fmt(Number(i.ja_apontado || 0)), Number(i.perda_apontada) ? fmt(Number(i.perda_apontada)) : '—',
      trEscH(String(i.leitura || '').toLowerCase().replace('nao', 'não'))]));
  },
};
async function estHistMais(chave) { EST_HIST[chave].lim += 30; await estRecarregar(); }
// depois de uma ação, recarrega a tela do ciclo que está aberta
async function estRecarregar() {
  if (EST_TELA === 'separacao') return sepCarregar();
  if (EST_TELA === 'ordens' || EST_TELA === 'producao') return prdCarregar();
  return plpCarregar();
}
const EST_LEIT_COR = (l) => /esperando|falta|sem apontar|a separar|a conferir|aberto/i.test(l || '') ? 'var(--farol-perto)'
  : /cancel/i.test(l || '') ? 'var(--tx-5)' : 'var(--tx-3)';

// ---- SEPARAÇÃO (tela própria, 27/10/2026): as listas em aberto + o histórico ----
async function entrarSeparacao() {
  const alvo = document.getElementById('view-separacao');
  if (!alvo) return;
  EST_TELA = 'separacao';
  if (!rmbSessao()) { alvo.innerHTML = `<div class="contexto">Entre no painel para ver a separação.</div>`; return; }
  alvo.innerHTML = `<div class="contexto">Carregando…</div>`;
  try {
    if (!PLP || !PLP.unidade) {
      const ru = await trRpc('tr_minha_unidade');
      PLP = Object.assign(PLP || {}, { unidade: (ru.ok ? await ru.json() : null) || 'AGUA VERDE', filtro: null, busca: '' });
    }
    await sepCarregar();
  } catch (e) {
    alvo.innerHTML = `<div class="contexto" style="border-color:var(--farol-fora);">Não consegui abrir a tela: ${e.message}</div>`;
  }
}
async function sepCarregar() {
  await estNomesCarregar();
  const u = encodeURIComponent(PLP.unidade);
  const [seps] = await Promise.all([
    consultarTudo(`vw_est_separacao_folha?select=*&unidade=eq.${u}&situacao=in.(ABERTA,SEPARADA,CONFERIDA)&order=data_para,numero,nome_base`).catch(() => null),
    estFilaCarregar(PLP.unidade),
    estHistCarregar('sep', 'vw_est_historico_separacao', PLP.unidade, 'criado_em.desc'),
  ]);
  PLP.seps = seps;
  sepRender();
}
function sepRender() {
  const alvo = document.getElementById('view-separacao');
  if (!alvo) return;
  let h = `<h2>Separação</h2>` + estFilaHtml() + `<span id="plpMsg" style="font-size:12.5px;"></span>`;
  h += plpSepsHtml(null);
  h = estHistTopo(h, 'sep', 'Histórico das separações', 'Cada lista: quem separou, quem conferiu e em que ordem ela virou.',
    ['Lista', 'Para', 'Família', 'Separou', 'Conferiu', 'Insumos', 'Virou a ordem', 'Situação'],
    (s) => `<tr><td><b>${trEscH(s.numero)}</b></td><td>${ffDdmm(s.data_para)}</td><td>${trEscH(String(s.familia || 'individual').toLowerCase())}</td>
      <td>${s.separado_por ? `${trEscH(estNome(s.separado_por))} <span style="color:var(--tx-5); font-size:11px;">${estQuando(s.separada_em)}</span>` : '—'}</td>
      <td>${s.conferido_por ? `${trEscH(estNome(s.conferido_por))} <span style="color:var(--tx-5); font-size:11px;">${estQuando(s.conferida_em)}</span>` : '—'}</td>
      <td>${Number(s.insumos_registrados) || 0} de ${Number(s.insumos) || 0}</td>
      <td>${s.virou_a_ordem ? `<a href="javascript:void(0)" style="color:var(--brand);" onclick="mostrarModulo('ordens')">${trEscH(s.virou_a_ordem)}</a>` : '—'}</td>
      <td style="font-size:12px; color:${EST_LEIT_COR(s.leitura)};">${trEscH(s.leitura || '')}</td></tr>`);
  alvo.innerHTML = h;
}

// ---- ORDENS (tela própria, 27/10/2026): as ordens com o relógio e o apontar na linha + o histórico ----
async function entrarOrdens() {
  EST_TELA = 'ordens';
  return entrarProducao();
}


const PLP_SIT = [
  ['SEM SALDO - FALTA APONTAR', 'Sem saldo', 'neg'],
  ['ACABA ANTES DA QUARTA', 'Acaba antes da quarta', 'neg'],
  ['DA ATE A QUARTA', 'Dá até a quarta', 'pos'],
  ['PARADO', 'Parado', 'blue'],
  ['SEM VENDA MEDIDA', 'Sem venda medida', 'neutral'],
  ['MEDIDA A CONFIRMAR', 'Medida a confirmar', 'neutral'],
];

async function entrarPlprod() {
  const alvo = document.getElementById('view-plprod');
  if (!alvo) return;
  EST_TELA = 'plprod';
  const sessao = rmbSessao();
  if (!sessao) { alvo.innerHTML = `<div class="contexto">Entre no painel para ver o plano de produção.</div>`; return; }
  alvo.innerHTML = `<div class="contexto">Carregando…</div>`;
  try {
    if (!PLP || !PLP.unidade) {
      const ru = await trRpc('tr_minha_unidade');
      PLP = { unidade: (ru.ok ? await ru.json() : null) || 'AGUA VERDE',
              filtro: null, busca: '' };
    }
    await plpCarregar();
  } catch (e) {
    alvo.innerHTML = `<div class="contexto" style="border-color:var(--farol-fora);">Não consegui abrir a tela: ${e.message}</div>`;
  }
}

async function plpCarregar() {
  await estNomesCarregar();
  const u = encodeURIComponent(PLP.unidade);
  // 26/10/2026: em etapas — as views do plano recalculam o motor do saldo cada uma, e as quatro juntas passavam do teto
  // de 8 s (o dono viu o 57014 às 15:50). Primeiro o plano, depois separação + plano do dia, por último a grade.
  const [plano, idade] = await Promise.all([
    consultarTudo(`vw_est_plano_producao?select=*&unidade=eq.${u}&order=falta_em_reais.desc.nullslast`),
    consultarTudo(`vw_est_consumo_idade?select=*`),
  ]);
  // 27/10/2026 (dono): a ficha semanal (vw_est_separacao) saiu da tela; a separação mora na tela Separação
  const separacao = [];
  const [doDia] = await Promise.all([
    // 23/10/2026: o plano de AMANHÃ (sugestão × decisão), só receitas da base — etapa 1 do ciclo de produção
    consultarTudo(`vw_est_plano_do_dia?select=nome_base,grupo_receita,un,sugerido,id_plano,data_para,situacao_plano,planejado,leitura&unidade=eq.${u}`)
      .catch(() => null),
  ]);
  // 27/10/2026 (dono): as listas moram na tela Separação; aqui só a fila do dia e o histórico dos planos
  await Promise.all([estFilaCarregar(PLP.unidade), estHistCarregar('plano', 'vw_est_historico_plano', PLP.unidade, 'data_para.desc')]);
  // 26/10/2026 (dono): a grade de dias da praça — o que é do dia, o que completa e o que é de outro dia (conta do banco)
  const grade = await consultarTudo(`vw_est_plano_sugestao?select=data_do_plano,dia_da_semana,nome_base,un,sugerido,etapas_do_dia,hora_desde,hora_ate,dias_na_grade,leitura,ordem_na_tela,praca,duvida,duvida_qual,frequencia,ordem_praca,praca_da_receita,grupo_na_praca,tem_dia_na_grade,proxima_vez&unidade=eq.${u}&order=ordem_praca,grupo_na_praca,ordem_na_tela,nome_base`)
    .catch(() => null);
  PLP.grade = grade && grade.length ? new Map(grade.map((g) => [g.nome_base, g])) : null;
  PLP.gradeLista = grade || [];
  PLP.dia = doDia ? new Map(doDia.map((d) => [d.nome_base, d])) : null;
  // 23/10/2026 (etapa 2): a ordem que já nasceu deste plano, se houver
  PLP.ordem = null;
  const idPl = doDia && (doDia.find((d) => d.id_plano) || {}).id_plano;
  if (idPl) {
    try {
      const ords = await consultarTudo(`vw_est_ordem?select=id,numero,situacao&id_plano=eq.${idPl}&situacao=neq.CANCELADA&order=numero`);
      // 26/10/2026 (dono): uma ordem por família de proteína; a família de cada uma vem de vw_est_ordem_familia
      const fam = ords.length ? await consultarTudo(`vw_est_ordem_familia?select=id,familia,e_individual,receitas,precisa_cortar&id=in.(${ords.map((o) => o.id).join(',')})`).catch(() => []) : [];
      const famDe = new Map(fam.map((f) => [f.id, f]));
      PLP.ordens = ords.map((o) => ({ ...o, ...(famDe.get(o.id) || {}) }));
      PLP.ordem = PLP.ordens[0] || null;
    } catch (e) { PLP.ordem = null; PLP.ordens = []; }
  }
  PLP.dig = PLP.dig || {};
  PLP.plano = plano;
  PLP.separacao = separacao;
  PLP.idade = (idade || [])[0] || null;
  plpRender();
}

function plpFiltro(sit) {
  PLP.filtro = (PLP.filtro === sit) ? null : sit;
  plpRender();
}
function plpBusca(v) { PLP.busca = v; plpRender(); }

function plpRender() {
  const alvo = document.getElementById('view-plprod');
  if (!alvo || !PLP.plano) return;
  const foco = document.activeElement && document.activeElement.id === 'plpBusca';
  const plano = PLP.plano;
  const conta = (s) => plano.filter((p) => p.situacao === s).length;
  const soma = (s, campo) => plano.filter((p) => p.situacao === s)
                                  .reduce((a, p) => a + (Number(p[campo]) || 0), 0);
  const faltaTotal = plano.reduce((a, p) => a + (Number(p.falta_em_reais) || 0), 0);
  const nAcaba = conta('ACABA ANTES DA QUARTA') + conta('SEM SALDO - FALTA APONTAR');
  const quarta = (plano[0] && plano[0].proxima_quarta) || '';
  const dias = (plano[0] && plano[0].dias_ate_quarta) || 0;

  // o que a tela mostra agora: tudo, ou só o quadro clicado (27/10/2026, dono: o quadro é o filtro)
  const noFiltro = (p) => PLP.filtro === 'FALTA' ? ['ACABA ANTES DA QUARTA', 'SEM SALDO - FALTA APONTAR'].includes(p.situacao)
                                                 : p.situacao === PLP.filtro;
  let vis = PLP.filtro ? plano.filter(noFiltro) : plano;
  // 26/10/2026 (dono): a praça da receita — PRODUÇÃO, LANCHES, PRATOS (vw_est_plano_sugestao, conta do banco)
  const pracaDe = (p) => ((PLP.grade && PLP.grade.get(p.nome_base)) || {}).praca_da_receita || 'SEM PRAÇA';
  const grpDe = pracaDe;
  if (PLP.grupo) vis = vis.filter((p) => grpDe(p) === PLP.grupo);
  if (PLP.busca) {
    const b = PLP.busca.toLowerCase();
    vis = vis.filter((p) => (p.nome_saipos || '').toLowerCase().includes(b)
                         || (p.nome_base || '').toLowerCase().includes(b));
  }

  let h = `<h2>Planejar produção</h2>` + estFilaHtml();

  // aviso CONDICIONAL: retrato velho faz a tela mentir sem avisar
  if (PLP.idade && PLP.idade.retrato_atrasado) {
    h += `<div class="contexto" style="border-color:var(--farol-fora);">O consumo foi calculado até
      <b>${PLP.idade.retrato_ate}</b> e o banco já tem venda até <b>${PLP.idade.venda_ate}</b>.
      O que falta pode estar subestimado — rode <code>python script/recalcular_mv_estoque.py</code>.</div>`;
  }

  const cartao = (f) => `style="cursor:pointer; ${PLP.filtro === f ? 'outline:2px solid var(--info); outline-offset:2px;' : ''}"
      onclick="plpFiltro('${f}')" title="${PLP.filtro === f ? 'clique de novo para ver tudo' : 'clique para ver só estas na grade'}"`;
  h += `<div class="cards cards-3">
    <div class="card ${faltaTotal > 0 ? 'neg' : 'pos'}" ${cartao('FALTA')}>
      <div class="card-lbl">Falta produzir até quarta</div>
      <div class="card-val">R$ ${fmt(faltaTotal)}</div>
      <div class="card-pct">${nAcaba} ${nAcaba === 1 ? 'receita' : 'receitas'} não chega${nAcaba === 1 ? '' : 'm'} lá</div>
    </div>
    <div class="card ${conta('SEM SALDO - FALTA APONTAR') ? 'neg' : 'neutral'}" ${cartao('SEM SALDO - FALTA APONTAR')}>
      <div class="card-lbl">Sem saldo no sistema</div>
      <div class="card-val">${conta('SEM SALDO - FALTA APONTAR')}</div>
      <div class="card-pct">vende R$ ${fmt(soma('SEM SALDO - FALTA APONTAR', 'sai_por_dia_em_reais'))}/dia · falta apontar produção</div>
    </div>
    <div class="card blue" ${cartao('PARADO')}>
      <div class="card-lbl">Parado há mais de 45 dias</div>
      <div class="card-val">R$ ${fmt(soma('PARADO', 'valor_no_estoque'))}</div>
      <div class="card-pct">${conta('PARADO')} ${conta('PARADO') === 1 ? 'receita' : 'receitas'} de giro lento</div>
    </div>
  </div>`;

  h += `<div class="caption-label" style="text-align:left;">A conta vai até ${plpDm(quarta).slice(0, 5)} (quarta, dia da contagem${dias ? ` — falta${dias === 1 ? '' : 'm'} ${dias} ${dias === 1 ? 'dia' : 'dias'}` : ''}). Clique num quadro ou numa praça para filtrar a grade.</div>`;

  h += `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:14px 0 10px;">`;
  if (PLP.grade) {
    [['PRODUÇÃO', 'Produção'], ['LANCHES', 'Lanches'], ['PRATOS', 'Pratos']].forEach(([g, rot]) => {
      const n = plano.filter((p) => grpDe(p) === g).length;
      if (n) h += `<button class="preset-btn${PLP.grupo === g ? ' active' : ''}" onclick="PLP.grupo=PLP.grupo==='${g}'?null:'${g}'; plpRender();"
                     title="Ver só esta praça">${rot} · ${n}</button>`;
    });
  }
  h += `<input id="plpBusca" value="${(PLP.busca || '').replace(/"/g, '&quot;')}" oninput="plpBusca(this.value)"
          placeholder="procurar receita" style="flex:1;min-width:160px;background:var(--surface-2);
          border:1px solid var(--line);color:var(--tx-1);border-radius:6px;padding:7px 10px;font-size:13px;">
    </div>`;

  // POR GRUPO, EM ORDEM ALFABÉTICA DENTRO DELE (dono, 14/10/2026). O grupo é a FAMÍLIA DA
  // PROTEÍNA quando a receita tem uma — a cadeia que ele decidiu em 08/10, "sempre que essa
  // proteína entrar na produção, no apontamento ela se divide em vários produtos e receitas" —
  // e, quando não tem, o grupo da receita (PRATOS, LANCHES, PRODUCAO). Quem decide isso é a
  // base, não a tela: a coluna grupo_da_tela vem de ft_receita_base por vw_est_item.
  // 26/10/2026 (dono): por PRAÇA (produção 1, lanches 2, pratos 3) e, na produção, pela família da proteína
  const gInfo = (p) => (PLP.grade && PLP.grade.get(p.nome_base)) || null;
  const blocos = new Map();
  vis.slice().sort((a, b) => (a.nome_base || a.nome_saipos || '').localeCompare(b.nome_base || b.nome_saipos || '', 'pt-BR'))
     .forEach((p) => {
       const g = gInfo(p);
       const praca = (g && g.praca_da_receita) || 'SEM PRAÇA';
       const ordem = (g && Number(g.ordem_praca)) || 9;
       const fam = (g && g.grupo_na_praca && g.grupo_na_praca !== praca) ? g.grupo_na_praca : (g ? '' : (p.grupo_da_tela || ''));
       if (!blocos.has(praca)) blocos.set(praca, { ordem, fams: new Map() });
       const b = blocos.get(praca);
       if (!b.fams.has(fam)) b.fams.set(fam, []);
       b.fams.get(fam).push(p);
     });
  // 26/10/2026 (dono): primeiro o que é do dia; o que é de outro dia (e aguenta até lá) vai para o fim, apagado
  if (PLP.grade) blocos.forEach((b) => b.fams.forEach((arr) => arr.sort((x, y) => plpFaixa(x.nome_base).ord - plpFaixa(y.nome_base).ord)));
  const pracasOrd = [...blocos.keys()].sort((a, b) => blocos.get(a).ordem - blocos.get(b).ordem || a.localeCompare(b, 'pt-BR'));
  const famOrd = (m) => [...m.keys()].sort((a, b) => (/^SEM FAM/.test(a) ? 1 : 0) - (/^SEM FAM/.test(b) ? 1 : 0) || a.localeCompare(b, 'pt-BR'));
  const nomePracaT = (p) => p === 'PRODUÇÃO' ? 'Produção' : p === 'LANCHES' ? 'Lanches' : p === 'PRATOS' ? 'Pratos' : p.charAt(0) + p.slice(1).toLowerCase();

  h += plpBlocoPlano();
  h += `<div id="tabelaPlanoProducao"><table><thead><tr>
      <th>Receita</th><th>Tem hoje</th>
      <th title="A venda do balcão (descendo a nossa ficha) MAIS o que sai em lista para o Ahú e o São Braz. Média dos últimos 28 dias.">Sai por dia</th>
      <th>Dura até</th><th title="o que o estoque de hoje não cobre até a próxima quarta: é a sugestão">Falta (sugerido)</th>
      <th>R$ a produzir</th>${PLP.dia ? `<th title="o que a cozinha decidiu produzir; vazio = ainda não decidido">Planejar p/ ${plpDm(plpAmanha())}</th>` : ''}<th>Situação</th></tr></thead><tbody>`;
  const nCol = PLP.dia ? 8 : 7;
  if (!vis.length) {
    h += `<tr><td colspan="${nCol}">Nada nesta situação.</td></tr>`;
  }
  const somaR = (arr) => arr.reduce((s, p) => s + (Number(p.falta_em_reais) || 0), 0);
  pracasOrd.forEach((praca) => {
    const b = blocos.get(praca);
    const todos = [...b.fams.values()].flat();
    const rsP = somaR(todos);
    h += `<tr><td colspan="5" style="font-weight:800; font-size:15px; letter-spacing:.6px; padding-top:14px; border-bottom:2px solid var(--line-2);">${trEscH(nomePracaT(praca).toUpperCase())}
        <span style="color:var(--tx-4); font-weight:400; font-size:12.5px;">· ${todos.length} ${todos.length === 1 ? 'receita' : 'receitas'}</span></td>
      <td style="font-weight:800; padding-top:14px; border-bottom:2px solid var(--line-2);">${rsP ? 'R$ ' + fmt(rsP) : ''}</td>${PLP.dia ? '<td style="border-bottom:2px solid var(--line-2);"></td>' : ''}<td style="border-bottom:2px solid var(--line-2);"></td></tr>`;
   famOrd(b.fams).forEach((fam) => {
    const itens = b.fams.get(fam);
    if (fam) {
      const rs = somaR(itens);
      h += `<tr class="sub"><td colspan="5" style="font-weight:700; letter-spacing:.4px; padding-left:14px;">${trEscH(fam.length <= 3 ? fam : fam.charAt(0) + fam.slice(1).toLowerCase())}
          <span style="color:var(--tx-4); font-weight:400;">· ${itens.length}</span></td>
        <td style="font-weight:700;">${rs ? 'R$ ' + fmt(rs) : ''}</td>${PLP.dia ? '<td></td>' : ''}<td></td></tr>`;
    }
    itens.forEach((p) => {
      const cor = p.situacao === 'DA ATE A QUARTA' ? 'var(--farol-ok)'
                : (p.situacao === 'ACABA ANTES DA QUARTA' || p.situacao === 'SEM SALDO - FALTA APONTAR')
                  ? 'var(--farol-fora)'
                : p.situacao === 'PARADO' ? 'var(--info)' : 'var(--tx-4)';
      const rot = (PLP_SIT.find((s) => s[0] === p.situacao) || [null, p.situacao])[1];
      h += `<tr${PLP.grade && plpFaixa(p.nome_base).f === 'OUTRO' ? ' style="opacity:.5;"' : ''}>
        <td>${p.nome_base || p.nome_saipos}${p.de_onde_vem_o_custo ? ` <span style="color:var(--tx-5);font-size:11px;">(${p.de_onde_vem_o_custo})</span>` : ''}${
          (gInfo(p) || {}).tem_dia_na_grade === false && !/^SEM GRADE/.test((gInfo(p) || {}).leitura || '') ? ` <span style="font-size:11px; color:var(--amber-2);" title="é desta praça, mas a grade ainda não diz o dia em que se faz">· sem dia definido</span>` : ''}</td>
        <td style="${Number(p.saldo) <= 0 ? 'color:var(--farol-fora);font-weight:700;' : ''}">${fmt(Number(p.saldo))} ${p.un || ''}${
          p.saldo_negativo ? ` <span style="display:block;color:var(--tx-5);font-size:11px;" title="O sistema está negativo porque ninguém apontou a produção. A conta do que falta parte de zero, não deste número.">falta apontar</span>` : ''}</td>
        <td>${p.por_dia_28 == null ? '—' : fmt(Number(p.por_dia_28))}${
          Number(p.por_dia_28_transf) > 0 ? `<span style="display:block;color:var(--tx-5);font-size:11px;white-space:normal;">${fmt(Number(p.por_dia_28_venda))} balcão + ${fmt(Number(p.por_dia_28_transf))} filiais</span>` : ''}</td>
        <td style="white-space:nowrap;">${p.dura_ate ? plpDm(p.dura_ate) : '—'}</td>
        <td style="font-weight:700;">${p.falta == null ? '—' : fmt(Number(p.falta)) + ' ' + (p.un || '')}</td>
        <td>${p.falta_em_reais == null ? '—' : 'R$ ' + fmt(Number(p.falta_em_reais))}</td>
        ${PLP.dia ? plpCelulaPlano(p) : ''}
        <td style="color:${cor};font-size:12px;white-space:normal;min-width:80px;">${rot}</td></tr>`;
    });
   });
  });
  h += `</tbody></table></div>`;

  // 27/10/2026 (dono): o histórico dos planos
  h = estHistTopo(h, 'plano', 'Histórico dos planos', 'Cada plano: quem planejou, quantas listas gerou e quantas ordens já encerraram.',
    ['Para', 'Situação', 'Planejou', 'Receitas', 'Listas', 'Viraram ordem', 'Ordens encerradas', 'Leitura'],
    (p) => `<tr><td><b>${ffDdmm(p.data_para)}</b></td><td>${trEscH(String(p.situacao || '').toLowerCase())}</td>
      <td>${p.quem_planejou ? trEscH(estNome(p.quem_planejou)) : '—'} <span style="color:var(--tx-5); font-size:11px;">${estQuando(p.fechado_em || p.criado_em)}</span></td>
      <td>${Number(p.receitas_decididas) || 0}${p.receitas_no_plano != null ? ' de ' + p.receitas_no_plano : ''}</td>
      <td>${Number(p.listas_geradas) || 0}</td><td>${Number(p.listas_que_viraram_ordem) || 0}</td>
      <td>${Number(p.ordens_encerradas) || 0} de ${Number(p.ordens) || 0}</td>
      <td style="font-size:12px; color:${EST_LEIT_COR(p.leitura)};">${trEscH(p.leitura || '')}</td></tr>`);

  alvo.innerHTML = h;
  if (foco) {
    const i = document.getElementById('plpBusca');
    if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  }
}

// PLANO DE AMANHÃ (etapa 1 do ciclo de produção; dono aprovou o desenho em 22/10/2026). A sugestão é o que falta até a
// quarta; a decisão é da cozinha e mora em est_plano (só por função). Vazio = ainda não decidido, NUNCA zero; digitar 0
// tira a receita do plano. Fechado, o plano vira a base da ordem de produção (etapa 2); para mudar, reabre-se
// (rpc/est_plano_reabrir, com motivo) — o banco recusa se já houver ordem viva: aí cancela-se a ordem primeiro.
function plpAmanha() { return fxSomaDias(prdHoje(), 1); }
// dd/mm/aaaa em toda a tela (dono, 23/10/2026)
function plpDm(iso) { const s = String(iso || ''); return s.length >= 10 ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : s; }
function plpQtd(v) { const n = Number(v); return Number.isInteger(n) ? String(n) : fmt(n); }
function plpFechado() {
  const um = PLP.dia && [...PLP.dia.values()].find((d) => d.id_plano);
  return um && /FECHAD/i.test(um.situacao_plano || '') ? um : null;
}
// 26/10/2026 (dono, opção A): a grade manda no Preencher; de outro dia só entra se o estoque acaba antes do dia dela.
// A próxima data do dia dela vem pronta da view (proxima_vez), não de conta da tela.
function plpFaixa(nome) {
  const g = PLP.grade && PLP.grade.get(nome);
  const l = (g && g.leitura) || '';
  if (/^DO DIA/.test(l)) return { f: 'DIA', ord: 0 };
  // 26/10/2026 (Estoque): ritmo sem dia fixo (mensal, quinzenal, se necessário) e o estoque pedindo
  if (/^O SALDO PEDE|^COMPLETA/.test(l)) return { f: 'SALDO', ord: 2 };
  if (/^SEM GRADE/.test(l)) return { f: 'SEMDIA', ord: 2 };
  if (/^DE OUTRO DIA/.test(l)) {
    const prox = g.proxima_vez || null;
    const p = (PLP.plano || []).find((x) => x.nome_base === nome) || {};
    const acaba = p.dura_ate || null;
    if (prox && (!acaba || acaba < prox)) return { f: 'ADIANTAR', ord: 1, prox, acaba };
    return { f: 'OUTRO', ord: 4, prox };
  }
  return { f: 'NADA', ord: 3 };
}
function plpCelulaPlano(p) {
  const d = PLP.dia.get(p.nome_base);
  if (!d) return '<td style="color:var(--tx-5);">—</td>';
  const fechado = !!plpFechado();
  const k = d.nome_base;
  const v = PLP.dig[k] !== undefined ? PLP.dig[k] : (d.planejado == null ? '' : plpQtd(d.planejado));
  const mudou = PLP.dig[k] !== undefined && String(PLP.dig[k]) !== (d.planejado == null ? '' : plpQtd(d.planejado));
  const LEIT = { 'AINDA NAO DECIDIDO': ['ainda não decidido', 'var(--tx-5)'],
                 'PLANEJADO COBRE O QUE FALTA': ['cobre o que falta', 'var(--farol-ok)'],
                 'PLANEJADO MENOR QUE O QUE FALTA': ['menor que o que falta', 'var(--farol-perto)'],
                 'PLANEJADO SEM O MOTOR PEDIR': ['sem o estoque pedir', 'var(--info)'] };
  const [lt, lc] = LEIT[d.leitura] || [String(d.leitura || '').toLowerCase(), 'var(--tx-5)'];
  const g = PLP.grade && PLP.grade.get(k);
  const tagGrade = !g ? '' : /^DO DIA/.test(g.leitura) ? `<div style="font-size:11px; color:var(--farol-ok);" title="na grade de dias da praça">do dia${g.etapas_do_dia ? ' · ' + trEscH(g.etapas_do_dia) : ''}</div>`
    : /^O SALDO PEDE|^COMPLETA/.test(g.leitura) ? `<div style="font-size:11px; color:var(--info);" title="não tem dia fixo na semana (mensal, quinzenal ou quando precisar) e o estoque está pedindo">o saldo pede · sem dia fixo</div>`
    : /^DE OUTRO DIA/.test(g.leitura) ? (() => { const fx = plpFaixa(k);
        return fx.f === 'ADIANTAR'
          ? `<div style="font-size:11px; color:var(--farol-fora); font-weight:700;" title="na grade o dia dela é outro, mas o estoque não aguenta até lá">adiantar: ${fx.acaba ? 'acaba ' + plpDm(fx.acaba).slice(0, 5) : 'sem saldo — falta apontar'}, o dia dela é ${plpDm(fx.prox).slice(0, 5)}</div>`
          : `<div style="font-size:11px; color:var(--tx-5);" title="na grade o dia dela é outro e o estoque aguenta até lá">dia dela: ${trEscH(g.dias_na_grade || '')}${fx.prox ? ' (' + plpDm(fx.prox).slice(0, 5) + ')' : ''}</div>`; })()
    : /^SEM GRADE/.test(g.leitura) ? `<div style="font-size:11px; color:var(--amber-2);" title="precisa e não está na grade de nenhuma praça">sem dia na grade</div>` : '';
  const tagDuv = g && g.duvida ? `<div style="font-size:11px; color:var(--amber-2);" title="${trEscH(g.duvida_qual || '')}">(?) dúvida na grade</div>` : '';
  return `<td style="white-space:nowrap;"><input type="number" step="0.001" min="0" inputmode="decimal" value="${v}"
      ${fechado ? 'disabled' : ''} placeholder="${Number(d.sugerido) > 0 ? plpQtd(Math.ceil(Number(d.sugerido) * 100) / 100) : ''}"
      oninput="PLP.dig[${trEscH(JSON.stringify(k))}]=this.value;" onchange="plpSalvarUm(${trEscH(JSON.stringify(k))})"
      style="width:76px; background:var(--surface-2); border:1px solid ${mudou ? 'var(--farol-perto)' : 'var(--info)'}; border-radius:8px; color:var(--tx-1); padding:5px 8px; font-weight:700;">
      <span style="color:var(--tx-4); font-size:11px;">${d.un || ''}</span>
      <div id="${plpIdK(k)}" style="font-size:11px; color:${mudou ? 'var(--farol-perto)' : lc};">${mudou ? 'salvando…' : lt}</div>${tagGrade}${tagDuv}</td>`;
}
// 26/10/2026: o que a grade de dias da praça manda fazer no dia do plano (vw_est_plano_sugestao; foto do dono)
function plpQuadroGrade() {
  if (!PLP.gradeLista || !PLP.gradeLista.length) return '';
  const G = PLP.gradeLista, dia = (G[0] || {}).dia_da_semana || '';
  const qtd = (g) => Number(g.sugerido) > 0 ? ` <span style="color:var(--tx-4);">${plpQtd(Math.ceil(Number(g.sugerido) * 100) / 100)} ${trEscH(g.un || '')}</span>` : '';
  const hora = (g) => g.hora_ate ? ` <span style="color:var(--tx-5);">até ${String(g.hora_ate).slice(0, 5)}</span>` : g.hora_desde ? ` <span style="color:var(--tx-5);">a partir de ${String(g.hora_desde).slice(0, 5)}</span>` : '';
  // 26/10/2026: a dúvida não esconde a linha — aparece marcada, com o texto do banco
  const duv = (g) => g.duvida ? ` <span style="color:var(--amber-2); font-weight:700;" title="${trEscH(g.duvida_qual || 'linha da grade com dúvida')}">(?)</span>` : '';
  const freq = (g) => g.frequencia === 'DIARIA' ? ' <span style="color:var(--tx-5);">· todo dia</span>' : g.frequencia === 'SE_NECESSARIO' ? ' <span style="color:var(--tx-5);">· se necessário</span>' : '';
  const linha = (g) => `<div style="font-size:13px;">${trEscH(g.nome_base)}${duv(g)}${g.etapas_do_dia ? ` <span style="color:var(--tx-3);">· ${trEscH(g.etapas_do_dia)}</span>` : ''}${freq(g)}${hora(g)}${qtd(g)}</div>`;
  const doDia = G.filter((g) => /^DO DIA/.test(g.leitura));
  const ordP = (p) => { const x = G.find((g) => (g.praca_da_receita || g.praca) === p); return (x && Number(x.ordem_praca)) || 9; };
  const pracas = [...new Set(doDia.map((g) => g.praca_da_receita || g.praca || 'PRODUÇÃO'))].sort((a, b) => ordP(a) - ordP(b) || a.localeCompare(b));
  const semGrade = G.filter((g) => /^SEM GRADE/.test(g.leitura));
  const completa = G.filter((g) => /^O SALDO PEDE|^COMPLETA/.test(g.leitura));
  const outro = G.filter((g) => /^DE OUTRO DIA/.test(g.leitura));
  const comDuvida = G.filter((g) => g.duvida && /^DO DIA/.test(g.leitura));
  const col = (titulo, cor, arr, f) => `<div><div style="color:${cor}; font-weight:700; font-size:12.5px;">${titulo} (${arr.length})</div>
      ${arr.length ? arr.map(f).join('') : '<div style="color:var(--tx-5);">nada</div>'}</div>`;
  const nomePraca = (p) => p === 'PRODUÇÃO' ? 'Produção' : p === 'LANCHES' ? 'Lanches' : p === 'PRATOS' ? 'Pratos' : p.charAt(0) + p.slice(1).toLowerCase();
  return `<div class="contexto" style="text-align:left;">
      <b>O que a grade manda fazer na ${trEscH(dia)}</b> <span style="color:var(--tx-5); font-size:12px;">(a folha dos dias de cada praça; o número é o que falta até a quarta)</span>
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:10px 18px; margin-top:8px;">
        ${pracas.map((p) => col('Do dia · ' + nomePraca(p), 'var(--farol-ok)', doDia.filter((g) => (g.praca_da_receita || g.praca || 'PRODUÇÃO') === p), linha)).join('')}
        ${col('Precisa, mas é de outro dia', 'var(--farol-perto)', outro, (g) => `<div style="font-size:13px;">${trEscH(g.nome_base)}${duv(g)} <span style="color:var(--tx-5);">· ${trEscH(g.dias_na_grade || '')}</span>${qtd(g)}</div>`)}
        ${completa.length ? col('O saldo pede (sem dia fixo)', 'var(--info)', completa, (g) => `<div style="font-size:13px;">${trEscH(g.nome_base)}${qtd(g)}</div>`) : ''}
      </div>
      ${semGrade.length ? `<div style="margin-top:10px; padding:8px 10px; border:1px solid var(--amber-2); border-radius:8px;">
        <div style="color:var(--amber-2); font-weight:700; font-size:12.5px;">Precisa e a grade ainda não diz o dia (${semGrade.length})</div>
        <div style="display:flex; flex-wrap:wrap; gap:2px 16px;">${semGrade.map((g) => `<span style="font-size:13px;">${trEscH(g.nome_base)} <span style="color:var(--tx-5);">· ${trEscH(nomePraca(g.praca_da_receita || 'sem praça'))}</span>${qtd(g)}</span>`).join('')}</div>
        <div class="caption-label" style="text-align:left; margin-top:4px;">A praça já é conhecida; falta o dia na grade dela.</div></div>` : ''}
      ${comDuvida.length ? `<div class="caption-label" style="text-align:left; margin-top:6px;"><span style="color:var(--amber-2); font-weight:700;">(?)</span> linha da grade com dúvida — passe o mouse para ver qual: ${comDuvida.map((g) => trEscH(g.nome_base)).join(', ')}.</div>` : ''}
    </div>`;
}
function plpMudancas() {
  return Object.entries(PLP.dig || {}).filter(([k, v]) => {
    const d = PLP.dia && PLP.dia.get(k);
    return d && String(v).trim() !== '' && String(v) !== (d.planejado == null ? '' : plpQtd(d.planejado));
  });
}
function plpPintarSalvar() {
  const b = document.getElementById('plpSalvarBtn');
  const n = plpMudancas().length;
  if (b) { b.disabled = !n; b.textContent = n ? `Salvar o plano (${n} ${n === 1 ? 'mudança' : 'mudanças'})` : 'Salvar o plano'; }
}
function plpBlocoPlano() {
  if (!PLP.dia) return `<div class="contexto" style="border-color:var(--amber-2);">Não consegui ler o plano de amanhã agora; a sugestão abaixo continua valendo.</div>`;
  const linhas = [...PLP.dia.values()];
  const dec = linhas.filter((d) => d.planejado != null);
  const fech = plpFechado();
  const amanha = plpAmanha();
  let h = `<div class="section-label">Plano de amanhã — ${plpDm(amanha)}</div>`;
  if (fech) {
    h += `<div class="contexto" style="border-color:var(--farol-ok);"><b>Plano de ${plpDm(fech.data_para || amanha)} fechado</b> com
      ${dec.length} ${dec.length === 1 ? 'receita' : 'receitas'}. Agora: separar e conferir cada lista; a ordem de produção nasce da lista conferida.
      <button class="preset-btn" onclick="plpReabrir(${fech.id_plano})" title="Volta o plano para edição. Se já existe lista separada ou ordem dele, desfaça antes.">Reabrir o plano</button>
      <span id="plpMsg" style="font-size:12.5px;"></span></div>`;
    const f = EST_FILA || {};
    const nL = (Number(f.listas_a_separar) || 0) + (Number(f.listas_a_conferir) || 0) + (Number(f.listas_a_virar_ordem) || 0);
    h += `<div class="contexto" style="text-align:left;">${nL ? `<b>${nL} ${nL === 1 ? 'lista' : 'listas'}</b> deste plano esperando na Separação.` : 'As listas deste plano já andaram — veja na Separação e nas Ordens.'}
      <button class="preset-btn active" onclick="mostrarModulo('separacao')">Abrir a Separação ›</button></div>`;
    return h;
  }
  h += plpQuadroGrade();
  h += `<div class="caption-label" style="text-align:left;">Decididas: <b>${dec.length} de ${linhas.length}</b> · digite na coluna Planejar p/ ${plpDm(amanha).slice(0, 5)} (grava sozinho; cinza = sugestão; 0 tira do plano).</div>
    <div style="display:flex; flex-wrap:wrap; gap:8px; margin:6px 0 12px;">
      <button class="preset-btn" onclick="plpUsarSugerido()" title="Põe e grava a sugestão no que é do dia, no que não tem dia na grade e no que é de outro dia mas acaba antes dele">Preencher os vazios com o sugerido</button>
      <button class="preset-btn active est-ciclo" onclick="plpFecharEGerar()" ${dec.length || plpMudancas().length ? '' : 'disabled title="Decida ao menos uma receita antes"'}>Fechar o plano e gerar as listas de separação</button>
      <span id="plpMsg" style="align-self:center; font-size:12.5px;"></span>
    </div>`;
  return h;
}
// 26/10/2026: menos cliques — a quantidade grava ao sair do campo; um botão fecha o plano e gera as listas
function plpIdK(k) { return 'plpSt_' + btoa(unescape(encodeURIComponent(k))).replace(/[^A-Za-z0-9]/g, ''); }
// 26/10/2026: UMA receita por chamada — a função lê a view do plano por receita (~2,4 s cada) e várias juntas passavam
// do teto de 8 s (o dono viu o "statement timeout" no Preencher e no Fechar). Em sequência, com o andamento na tela.
async function plpGravarItens(itens) {
  const msg = document.getElementById('plpMsg');
  let idp = null;
  for (let n = 0; n < itens.length; n++) {
    const i = itens[n];
    if (msg && itens.length > 1) { msg.style.color = 'var(--tx-4)'; msg.textContent = `Gravando ${n + 1} de ${itens.length}…`; }
    const r = await trRpc('est_plano_salvar', { p_unidade: PLP.unidade, p_data_para: plpAmanha(), p_itens: [i],
                                                p_quem: ((rmbSessao() || {}).email || '') });
    if (!r.ok) throw new Error(`${i.nome_base}: ${await trErroDe(r)}` + (n ? ` (as ${n} anteriores ficaram gravadas)` : ''));
    idp = await r.json();
    const d = PLP.dia.get(i.nome_base); if (d) { d.planejado = i.qtd; } delete PLP.dig[i.nome_base];
    [...PLP.dia.values()].forEach((x) => { if (idp) x.id_plano = idp; });
  }
  return idp;
}
async function plpSalvarUm(k) {
  const v = String(PLP.dig[k] == null ? '' : PLP.dig[k]).trim();
  const d = PLP.dia && PLP.dia.get(k);
  const st = document.getElementById(plpIdK(k));
  if (!d || v === '' || v === (d.planejado == null ? '' : plpQtd(d.planejado))) return;
  const qtd = Number(v.replace(',', '.'));
  if (!isFinite(qtd) || qtd < 0) { if (st) { st.style.color = 'var(--farol-fora)'; st.textContent = 'não é número'; } return; }
  if (st) { st.style.color = 'var(--tx-4)'; st.textContent = 'salvando…'; }
  try {
    await plpGravarItens([{ nome_base: k, qtd, un: d.un }]);
    if (st) { st.style.color = 'var(--farol-ok)'; st.textContent = '✓ salvo'; }
  } catch (e) { if (st) { st.style.color = 'var(--farol-fora)'; st.textContent = 'não salvou: ' + e.message; } }
}
async function plpFecharEGerar() {
  if (EST_OCUPADO) return;
  const msg = document.getElementById('plpMsg');
  const diz = (t, cor) => { if (msg) { msg.style.color = cor || 'var(--tx-4)'; msg.textContent = t; } };
  try {
    const pend = plpMudancas().map(([k, v]) => ({ nome_base: k, qtd: Number(String(v).replace(',', '.')), un: PLP.dia.get(k).un }));
    if (pend.some((i) => !isFinite(i.qtd) || i.qtd < 0)) { alert('Há quantidade que não é número. Corrija antes.'); return; }
    if (pend.length) { diz('Salvando…'); await plpGravarItens(pend); }
    const um = [...PLP.dia.values()].find((d) => d.id_plano);
    if (!um) { alert('Decida ao menos uma receita antes de fechar.'); return; }
    const dec = [...PLP.dia.values()].filter((d) => Number(d.planejado) > 0);
    if (!confirm(`Fechar o plano de ${plpDm(plpAmanha())} com ${dec.length} ${dec.length === 1 ? 'receita' : 'receitas'} e gerar as listas de separação (uma por família)?\n\nPara mudar depois, é preciso reabrir o plano.`)) return;
    diz('Fechando…');
    estTravar(true);
    let r = await trRpc('est_plano_fechar', { p_id: um.id_plano });
    if (!r.ok) throw new Error(await trErroDe(r));
    diz('Gerando as listas…');
    r = await trRpc('est_separacao_gerar', { p_id_plano: um.id_plano, p_quem: ((rmbSessao() || {}).email || '') });
    if (!r.ok) throw new Error(await trErroDe(r));
    estTravar(false);
    // 27/10/2026: próximo passo é separar — abre a Separação
    mostrarModulo('separacao');
    await plpCarregar();
  } catch (e) { estTravar(false); diz(e.message, 'var(--farol-fora)'); }
}
// as listas de separação do plano fechado (vw_est_separacao_folha): separar → conferir → gerar a ordem
function plpSepsHtml(fech) {
  if (PLP.seps === null) return `<div class="contexto" style="border-color:var(--amber-2);">Não consegui ler as listas de separação agora.</div>`;
  const porSep = new Map();
  (PLP.seps || []).forEach((l) => { if (!porSep.has(l.id)) porSep.set(l.id, []); porSep.get(l.id).push(l); });
  if (!porSep.size) return fech ? `<div class="contexto">Plano fechado, mas nenhuma lista de separação gerada.
      <button class="preset-btn active est-ciclo" onclick="plpGerarSeps(${fech.id_plano})">Gerar as listas de separação</button></div>`
    : `<div class="section-label">Listas em aberto</div><div class="contexto">Nenhuma lista esperando separação, conferência ou ordem. As listas nascem quando o plano é fechado, em Planejar.</div>`;
  const SIT = { ABERTA: ['a separar', 'var(--tx-3)'], SEPARADA: ['separada — falta conferir', 'var(--farol-perto)'],
                CONFERIDA: ['conferida — pode gerar a ordem', 'var(--farol-ok)'], VINCULADA: ['virou ordem de produção', 'var(--info)'] };
  const campo = 'background:var(--surface-2); border:1px solid var(--line); border-radius:8px; color:var(--tx-1); padding:4px 6px;';
  let h = `<div class="section-label">Listas em aberto</div>
    <div class="caption-label" style="text-align:left;">Uma lista por família de proteína (receita sem família, lista própria). Quem separa marca o que saiu de verdade;
      outra pessoa confere; da lista conferida nasce a ordem de produção.</div>`;
  [...porSep.entries()].forEach(([id, ls]) => {
    const c = ls[0];
    const [st, cor] = SIT[c.situacao] || [String(c.situacao || '').toLowerCase(), 'var(--tx-4)'];
    const aberta = c.situacao === 'ABERTA';
    const rows = ls.slice().sort((a, b) => (a.etapa === 'CORTE' ? 0 : 1) - (b.etapa === 'CORTE' ? 0 : 1) || String(a.nome_base).localeCompare(String(b.nome_base), 'pt-BR'));
    h += `<div class="contexto" style="text-align:left; margin:8px 0;">
      <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:center; justify-content:space-between;">
        <div><b style="font-size:16px;">${trEscH(c.numero)}</b>
          <span style="font-size:12px; border:1px solid var(--line-2); border-radius:10px; padding:1px 8px; color:var(--tx-2);">${c.e_individual ? 'individual' : 'família ' + trEscH(String(c.familia || '').toLowerCase())}</span>
          <span style="font-size:12px; color:var(--tx-4);">para ${plpDm(c.data_para).slice(0, 5)}</span>
          <span style="font-size:12px; color:${cor}; font-weight:700;">${st}</span>
          <div style="font-size:12px; color:var(--tx-3);">produzir: ${trEscH(c.o_que_produzir || '')}</div>
          <div style="font-size:12px; color:var(--tx-4);">${c.separado_por ? `separou ${trEscH(estNome(c.separado_por))}` : ''}${c.conferido_por ? ` · conferiu ${trEscH(estNome(c.conferido_por))}` : ''}</div></div>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <button class="preset-btn" onclick="plpSepImprimir(${id})">🖨️ Imprimir a folha</button>
          ${aberta ? `<button class="preset-btn active est-ciclo" onclick="plpSepSeparar(${id})">Marcar como separada</button>` : ''}
          ${c.situacao === 'SEPARADA' ? `<button class="preset-btn active est-ciclo" onclick="plpSepConferir(${id})" title="outra pessoa, não quem separou">Conferir</button>` : ''}
          ${c.situacao === 'CONFERIDA' ? `<button class="preset-btn active est-ciclo" onclick="plpSepOrdem(${id})">Gerar a ordem de produção</button>` : ''}
          ${c.situacao === 'VINCULADA' ? `<a href="javascript:void(0)" style="color:var(--brand); align-self:center;" onclick="mostrarModulo('ordens')">${c.numero_ordem ? trEscH(c.numero_ordem) + ' — ' : ''}abrir em Ordens ›</a>` : ''}
        </div></div>
      <div style="overflow-x:auto; margin-top:6px;"><table><thead><tr><th>Insumo</th><th>Previsto</th><th>Separado de verdade</th><th>Diferença</th><th>Observação</th><th>No estoque</th></tr></thead><tbody>
        ${rows.map((l, k) => `<tr><td>${l.etapa === 'CORTE' ? '<b style="color:var(--amber-2);">[corte]</b> ' : ''}${trEscH(l.nome_base)}
              <div style="font-size:11px; color:var(--tx-5);">${trEscH(l.vem_de || '')}</div></td>
            <td style="white-space:nowrap;">${fmt(Number(l.qtd_prevista))} ${trEscH(l.un || '')}</td>
            <td style="white-space:nowrap;">${aberta ? `<input type="number" step="0.001" min="0" inputmode="decimal" id="plpSq_${id}_${k}" value="${Number(l.qtd_separada != null ? l.qtd_separada : l.qtd_prevista)}" style="width:84px; ${campo}">` : (l.qtd_separada == null ? '—' : fmt(Number(l.qtd_separada)))} ${trEscH(l.un || '')}</td>
            <td style="color:${Number(l.diferenca) ? 'var(--farol-perto)' : 'var(--tx-5)'};">${l.diferenca == null || !Number(l.diferenca) ? '—' : fmt(Number(l.diferenca))}</td>
            <td>${aberta ? `<input id="plpSo_${id}_${k}" value="${trEscH(l.observacao || '')}" placeholder="opcional" style="width:150px; ${campo}">` : trEscH(l.observacao || '')}</td>
            <td style="font-size:12px; color:${/NEGATIV|FALTA/.test(l.situacao_do_saldo || '') ? 'var(--farol-perto)' : 'var(--tx-4)'};">${l.saldo == null ? '' : fmt(Number(l.saldo))} ${trEscH(String(l.situacao_do_saldo || '').toLowerCase())}</td></tr>`).join('')}
      </tbody></table></div></div>`;
  });
  return h;
}
function plpSepLinhas(id) {
  return (PLP.seps || []).filter((l) => l.id === id).sort((a, b) => (a.etapa === 'CORTE' ? 0 : 1) - (b.etapa === 'CORTE' ? 0 : 1) || String(a.nome_base).localeCompare(String(b.nome_base), 'pt-BR'));
}
// 27/10/2026: um clique só — os botões do ciclo (plano, separação, ordem) se desligam até a resposta do banco
let EST_OCUPADO = false;
function estTravar(on) {
  if (on && EST_OCUPADO) return false;
  EST_OCUPADO = on;
  document.querySelectorAll('button.est-ciclo').forEach((b) => { b.disabled = on; b.style.opacity = on ? '.5' : ''; });
  return true;
}
async function plpSepAcao(fn, args, ok) {
  if (!estTravar(true)) return;
  let r;
  try { r = await trRpc(fn, args); } finally { estTravar(false); }
  if (!r.ok) { alert(await trErroDe(r)); return; }
  await estRecarregar();
  const m2 = document.getElementById('plpMsg'); if (m2 && ok) { m2.style.color = 'var(--farol-ok)'; m2.textContent = ok; }
}
async function plpGerarSeps(idPlano) { await plpSepAcao('est_separacao_gerar', { p_id_plano: idPlano, p_quem: ((rmbSessao() || {}).email || '') }, '✓ listas geradas'); }
async function plpSepSeparar(id) {
  const ls = plpSepLinhas(id);
  const itens = ls.map((l, k) => {
    const q = (document.getElementById(`plpSq_${id}_${k}`) || {}).value;
    const o = ((document.getElementById(`plpSo_${id}_${k}`) || {}).value || '').trim();
    return { nome_base: l.nome_base, qtd_separada: q === '' || q == null ? null : Number(String(q).replace(',', '.')), observacao: o || null };
  });
  if (itens.some((i) => i.qtd_separada == null || !isFinite(i.qtd_separada) || i.qtd_separada < 0)) { alert('Preencha o separado de verdade em todas as linhas (0 se não saiu nada).'); return; }
  if (!confirm(`Marcar a ${ls[0].numero} como separada?`)) return;
  await plpSepAcao('est_separacao_separar', { p_id: id, p_itens: itens, p_quem: ((rmbSessao() || {}).email || '') }, `✓ ${ls[0].numero} separada`);
}
async function plpSepConferir(id) {
  const c = plpSepLinhas(id)[0] || {};
  // 27/10/2026 (dono): mostrar os dois nomes — o texto da regra parecia recusa
  const eu = ((rmbSessao() || {}).email || '').toLowerCase();
  const nome = (e) => estNome(e) || '?';
  if (eu && String(c.separado_por || '').toLowerCase() === eu) {
    alert(`A ${c.numero} foi separada por você (${nome(eu)}).

Quem confere tem de ser outra pessoa: entre com o login dela para conferir.`);
    return;
  }
  if (!confirm(`Conferir a ${c.numero}?

Você está conferindo como ${nome(eu)}. Quem separou foi ${nome(c.separado_por)}.`)) return;
  await plpSepAcao('est_separacao_conferir', { p_id: id, p_quem: ((rmbSessao() || {}).email || '') }, `✓ ${c.numero} conferida`);
}
async function plpSepOrdem(id) {
  const c = plpSepLinhas(id)[0] || {};
  await plpSepAcao('est_ordem_gerar', { p_id_separacao: id, p_quem: ((rmbSessao() || {}).email || '') }, `✓ ordem gerada da ${c.numero} — abra em Apontar produção`);
}
function plpSepImprimir(id) {
  const ls = plpSepLinhas(id), c = ls[0] || {};
  const w = window.open('', '_blank');
  if (!w) { alert('O navegador bloqueou a janela de impressão — libere pop-ups para este site.'); return; }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${c.numero} — separação</title><style>
    body { font-family:Arial, sans-serif; color:#000; margin:18px 24px; }
    .cab { display:flex; justify-content:space-between; border-bottom:2px solid #000; padding-bottom:6px; }
    h1 { font-size:18px; margin:0; } .cod { font-size:26px; font-weight:bold; } .sub { font-size:11.5px; color:#45443f; margin:3px 0 0; }
    .assina { font-size:12px; margin:10px 0 0; } .assina span { display:inline-block; border-bottom:1px solid #000; width:190px; margin:0 18px 0 4px; }
    table { width:100%; border-collapse:collapse; margin-top:10px; } td, th { border-bottom:1px solid #bbb; padding:5px 6px; font-size:12.5px; text-align:left; }
    th { font-size:10px; text-transform:uppercase; color:#45443f; } .q { text-align:right; font-weight:bold; } .box { width:96px; border:1px solid #000 !important; height:26px; }
    @media print { body { margin:10px 14px; } }
  </style></head><body>
    <div class="cab"><div><h1>Separação — ${PLP.unidade}${c.familia ? ' · família ' + c.familia : c.e_individual ? ' · individual' : ''}</h1>
      <p class="sub">Produção de ${plpDm(c.data_para)} · ${ls.length} ${ls.length === 1 ? 'insumo' : 'insumos'} · impressa em ${new Date().toLocaleString('pt-BR')}</p>
      <p class="sub"><b>Produzir:</b> ${c.o_que_produzir || ''}</p>
      <p class="assina">Separou:<span></span>Conferiu:<span></span></p></div><div class="cod">${c.numero}</div></div>
    <table><thead><tr><th>#</th><th>Insumo</th><th class="q">Previsto</th><th>Separado de verdade</th></tr></thead><tbody>
    ${ls.map((l, k) => `<tr><td>${k + 1}</td><td>${l.etapa === 'CORTE' ? '<b>[corte]</b> ' : ''}${l.nome_base}</td><td class="q">${fmt(Number(l.qtd_prevista))} ${l.un || ''}</td><td class="box"></td></tr>`).join('')}
    </tbody></table></body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 300);
}
function plpUsarSugerido() {
  [...PLP.dia.values()].forEach((d) => {
    // 26/10/2026 (dono, opção A): de outro dia fica vazio, salvo se acaba antes do dia dela
    if (PLP.grade && plpFaixa(d.nome_base).f === 'OUTRO') return;
    if (d.planejado == null && PLP.dig[d.nome_base] === undefined && Number(d.sugerido) > 0)
      PLP.dig[d.nome_base] = plpQtd(Math.ceil(Number(d.sugerido) * 100) / 100);
  });
  // 26/10/2026: grava junto (sem botão Salvar)
  const pend = plpMudancas().map(([k, v]) => ({ nome_base: k, qtd: Number(String(v).replace(',', '.')), un: PLP.dia.get(k).un }));
  if (!pend.length) { plpRender(); return; }
  plpGravarItens(pend).then(() => plpRender()).catch((e) => { plpRender(); alert('Não salvou: ' + e.message); });
}
async function plpSalvar() {
  const itens = plpMudancas().map(([k, v]) => ({ nome_base: k, qtd: Number(String(v).replace(',', '.')), un: PLP.dia.get(k).un }));
  if (!itens.length) return;
  if (itens.some((i) => !isFinite(i.qtd) || i.qtd < 0)) { alert('Há quantidade que não é número. Corrija antes de salvar.'); return; }
  const msg = document.getElementById('plpMsg');
  if (msg) { msg.style.color = 'var(--tx-4)'; msg.textContent = 'Salvando…'; }
  const r = await trRpc('est_plano_salvar', { p_unidade: PLP.unidade, p_data_para: plpAmanha(), p_itens: itens,
                                              p_quem: ((rmbSessao() || {}).email || '') });
  if (!r.ok) { const e = await trErroDe(r); if (msg) { msg.style.color = 'var(--farol-fora)'; msg.textContent = e; } return; }
  PLP.dig = {};
  await plpCarregar();
  const m2 = document.getElementById('plpMsg');
  if (m2) { m2.style.color = 'var(--farol-ok)'; m2.textContent = `✓ ${itens.length} ${itens.length === 1 ? 'receita salva' : 'receitas salvas'} no plano de ${plpDm(plpAmanha())}`; }
}
async function plpFechar() {
  const um = [...PLP.dia.values()].find((d) => d.id_plano);
  if (!um) return;
  if (plpMudancas().length) { alert('Há mudança não salva. Salve o plano antes de fechar.'); return; }
  if (!confirm(`Fechar o plano de ${plpDm(plpAmanha())}?\n\nFechado, ele vira a base da ordem de produção. Para mudar depois, é preciso reabrir (e, se já houver ordem, cancelá-la antes).`)) return;
  const r = await trRpc('est_plano_fechar', { p_id: um.id_plano });
  const msg = document.getElementById('plpMsg');
  if (!r.ok) { const e = await trErroDe(r); if (msg) { msg.style.color = 'var(--farol-fora)'; msg.textContent = e; } return; }
  await plpCarregar();
}

async function plpGerarOrdem(id) {
  const r = await trRpc('est_ordem_gerar', { p_id_plano: id, p_quem: ((rmbSessao() || {}).email || '') });
  const msg = document.getElementById('plpMsg');
  if (!r.ok) { const e = await trErroDe(r); if (msg) { msg.style.color = 'var(--farol-fora)'; msg.textContent = e; } return; }
  await plpCarregar();
}
async function plpReabrir(id) {
  const motivo = (prompt('Por que reabrir o plano? (fica registrado)') || '').trim();
  if (!motivo) return;
  const r = await trRpc('est_plano_reabrir', { p_id: id, p_motivo: motivo });
  const msg = document.getElementById('plpMsg');
  if (!r.ok) { const e = await trErroDe(r); if (msg) { msg.style.color = 'var(--farol-fora)'; msg.textContent = e; } return; }
  await plpCarregar();
}

// A folha impressa segue o molde da folha de contagem: grupo por grupo, na ordem em que se
// anda pelo estoque, e uma caixa EM BRANCO para quem pesa escrever o que realmente saiu.
// Esse numero escrito e o que vai valer quando o dono decidir quem baixa o estoque — a
// separacao pesada ou a ficha teorica.
async function plpImprimir() {
  const sep = PLP && PLP.separacao;
  if (!sep || !sep.length) { alert('Nada a separar: nenhuma receita está faltando até a próxima quarta.'); return; }
  const porGrupo = {};
  sep.slice().sort((a, b) => (a.nome_base || a.nome_saipos || '').localeCompare(b.nome_base || b.nome_saipos || '', 'pt-BR'))
     .forEach((s) => { const g = s.grupo || 'OUTROS'; (porGrupo[g] = porGrupo[g] || []).push(s); });
  const ordem = (g) => { const k = CTG_GRUPO_ORDEM.indexOf(g); return k < 0 ? 50 : k; };
  const grupos = Object.keys(porGrupo).sort((a, b) => ordem(a) - ordem(b) || a.localeCompare(b));
  const p0 = (PLP.plano || [])[0] || {};
  const receitas = (PLP.plano || []).filter((p) => Number(p.falta) > 0);

  const w = window.open('', '_blank');
  if (!w) { alert('O navegador bloqueou a janela de impressão — libere pop-ups para este site.'); return; }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Separação ${plpDm(p0.proxima_quarta)} — ${PLP.unidade}</title><style>
    body { font-family:Arial, sans-serif; color:#000; margin:18px 24px; }
    .cab { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #000; padding-bottom:6px; }
    h1 { font-size:18px; margin:0; }
    .cod { font-size:26px; font-weight:bold; letter-spacing:1px; }
    .sub { font-size:11.5px; color:#45443f; margin:3px 0 0; }
    .assina { font-size:12px; margin:10px 0 0; }
    .assina span { display:inline-block; border-bottom:1px solid #000; width:190px; margin:0 18px 0 4px; }
    h2 { font-size:13px; text-transform:uppercase; background:#e8e6dc; border:1px solid #9c9b90;
         padding:4px 6px; margin:14px 0 4px; page-break-after:avoid; }
    table { width:100%; border-collapse:collapse; page-break-inside:auto; }
    td, th { border-bottom:1px solid #bbb; padding:5px 6px; font-size:12.5px; text-align:left; }
    tr { page-break-inside:avoid; }
    th { font-size:10px; text-transform:uppercase; color:#45443f; }
    .n { width:30px; color:#45443f; font-size:11px; }
    .q { width:92px; text-align:right; font-weight:bold; }
    .box { width:96px; border:1px solid #000 !important; height:26px; }
    .plano { font-size:11.5px; color:#45443f; margin:6px 0 0; }
    @media print { body { margin:10px 14px; } }
  </style></head><body>
    <div class="cab"><div>
      <h1>Ficha de separação — ${PLP.unidade}</h1>
      <p class="sub">Para a produção até a contagem de ${p0.proxima_quarta ? plpDm(p0.proxima_quarta) : 'quarta'} ·
        ${sep.length} ${sep.length === 1 ? 'item' : 'itens'} · impressa em ${new Date().toLocaleString('pt-BR')}</p>
      <p class="assina">Separou:<span></span>Conferiu:<span></span></p>
    </div><div class="cod">SEP</div></div>
    <p class="plano"><b>O plano:</b> ${receitas.map((r) => `${r.nome_base || r.nome_saipos} ${fmt(Number(r.falta))} ${r.un || ''}`).join(' · ') || '—'}</p>`);
  let n = 0;
  grupos.forEach((g) => {
    w.document.write(`<h2>${g}</h2><table><thead><tr><th class="n">#</th><th>Item</th>
      <th class="q">Pedido</th><th class="q">Tem</th><th>Separado de verdade</th></tr></thead><tbody>`);
    porGrupo[g].forEach((s) => {
      n += 1;
      w.document.write(`<tr><td class="n">${n}</td><td>${s.nome_base || s.nome_saipos}</td>
        <td class="q">${fmt(Number(s.qtd_a_separar))} ${s.un || ''}</td>
        <td class="q">${s.tem_no_estoque == null ? '—' : fmt(Number(s.tem_no_estoque)) + ' ' + (s.un_do_estoque || '')}</td>
        <td class="box"></td></tr>`);
    });
    w.document.write(`</tbody></table>`);
  });
  w.document.write(`</body></html>`);
  w.document.close();
  w.focus();
  w.print();
}

let PRD = null;   // { papel, unidade, data, receitas, lancamentos, busca, aberta, ingredientes }

function prdHoje() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}
function prdDiasAtras(n) {
  const d = new Date(prdHoje() + 'T12:00:00');
  d.setDate(d.getDate() - n);
  return new Intl.DateTimeFormat('en-CA').format(d);
}
function prdId(nome) {
  return 'prd_' + btoa(unescape(encodeURIComponent(nome))).replace(/[^A-Za-z0-9]/g, '');
}
function prdTxt(v) { return JSON.stringify(v == null ? '' : v).replace(/"/g, '&quot;'); }

async function prdFetch(caminho, opcoes) {
  // 21/10/2026: o login vencia no meio da contagem ("JWT expired" ao abrir a folha) — renova antes e, se o
  // banco ainda assim recusar por login vencido (401), renova e tenta de novo uma vez.
  await rmbGarantirTokenValido();
  const chama = () => fetch(`${SUPABASE_URL}/rest/v1/${caminho}`,
                        { headers: rmbHeaders((opcoes || {}).extra || {}), ...(opcoes || {}) });
  let r = await chama();
  if (await rmbRenovarSeExpirado(r)) r = await chama();
  if (!r.ok) throw new Error((await r.text()).slice(0, 200));
  return r;
}

// ------------------------------------------------------------------
// CONTROLE DE ESTOQUE (dono, 22/10/2026: as movimentações para conferência, item a item, como a Movimentação do
// Saipos). Lê o NOSSO motor já consolidado por nome da base (est_controle_extrato, refeito a cada carga do Saipos):
// vw_est_controle_item é o cabeçalho de cada item e vw_est_controle o extrato. A tela não soma nada: o saldo de cada
// linha (saldo_depois) e o de hoje (saldo_hoje) vêm do banco e fecham entre si. Linha antes da partida (a última
// contagem) vem sem saldo: é histórico, mostrada apagada, com um corte na partida.
// ------------------------------------------------------------------
let CTL = null;
const CTL_LOJAS = ['AGUA VERDE', 'AHU', 'SÃO BRAZ'];
const CTL_TIPOS = ['Contagem', 'Compra (nota fiscal)', 'Transferencia recebida (lista)', 'Producao: entrou a receita',
  'Producao: saiu o ingrediente', 'Transferencia enviada (lista)', 'Venda (baixa pela ficha)'];
async function entrarControle() {
  const alvo = document.getElementById('view-controle');
  if (!alvo) return;
  if (!rmbSessao()) { alvo.innerHTML = `<div class="contexto">Entre no painel para ver o controle de estoque.</div>`; return; }
  alvo.innerHTML = `<div class="contexto">Carregando…</div>`;
  try {
    if (!CTL) {
      const ru = await trRpc('tr_minha_unidade');
      CTL = { unidade: (ru.ok ? await ru.json() : null) || 'AGUA VERDE', busca: '', tipo: '', de: '', ate: '', item: null, extrato: null,
              ord: 'dinheiro', desc: true, curva: '', grupo: '', soNeg: false };
    }
    await ctlCarregar();
  } catch (e) {
    alvo.innerHTML = `<div class="contexto" style="border-color:var(--farol-fora);">Não consegui abrir a tela: ${trEscH(e.message)}</div>`;
  }
}
async function ctlCarregar() {
  await estNomesCarregar();
  const u = encodeURIComponent(CTL.unidade);
  const [itens, idade] = await Promise.all([
    consultarTudo(`vw_est_controle_item?select=*&unidade=eq.${u}&order=nome_base`),
    // 26/10/2026: a idade do retrato (conta movimento mais novo que ele, não só o relógio)
    consultarTudo('vw_est_controle_idade?select=*').catch(() => null),
  ]);
  CTL.itens = itens;
  CTL.idade = (idade || [])[0] || null;
  CTL.item = null; CTL.extrato = null;
  ctlRender();
}
// 26/10/2026: o retrato do controle e a idade dele (vw_est_controle_idade). "Atualizar agora" = est_refazer_extrato,
// a mesma função da carga das 05:40 e do fechamento da contagem.
function ctlIdadeHtml() {
  const i = CTL.idade;
  if (!i) return '';
  const velho = !/^EM DIA/.test(i.situacao || '');
  return `<div class="caption-label" style="text-align:left; ${velho ? 'color:var(--amber-2);' : ''}">${trEscH(i.recado || '')}${velho
    ? ` — ${Number(i.movimentos_mais_novos) || 0} ${Number(i.movimentos_mais_novos) === 1 ? 'movimento mais novo' : 'movimentos mais novos'} que este retrato.
       <button class="preset-btn" id="ctlAtualizar" onclick="ctlAtualizar()">Atualizar agora</button>` : ''}</div>`;
}
async function ctlAtualizar() {
  const b = document.getElementById('ctlAtualizar');
  if (b) { b.disabled = true; b.textContent = 'Atualizando… (uns 10 s)'; }
  try {
    const r = await ctgFetch('rpc/est_refazer_extrato', { method: 'POST', extra: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!r.ok) throw new Error(await trErroDe(r));
  } catch (e) { alert('Não consegui atualizar o retrato: ' + e.message); }
  await ctlCarregar();
}
async function ctlAbrir(nome) {
  CTL.item = nome; CTL.extrato = null; CTL.tipo = ''; CTL.de = ''; CTL.ate = '';
  ctlRender();
  const u = encodeURIComponent(CTL.unidade);
  // KARDEX (dono, 22/10/2026): implantação = contagem de 21/10 às 19:00; 1ª linha o saldo inicial, depois cada entrada e
  // saída com o saldo correndo; nada antes da implantação. A ordem e o saldo vêm prontos de vw_est_kardex.
  CTL.extrato = await consultarTudo(`vw_est_kardex?select=dia,ordem,tipo,movimento,documento,entrada,saida,un,saldo` +
    `&unidade=eq.${u}&nome_base=eq.${encodeURIComponent(nome)}&order=ordem,dia,tipo,documento`);
  ctlRender();
  const w = document.getElementById('ctlExtrato');
  if (w) w.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function ctlNum(v, un) {
  if (v == null || v === '') return '';
  const n = Number(v);
  const casas = (un === 'KG' || un === 'L' || un === 'LT') ? 3 : (Number.isInteger(n) ? 0 : 2);
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas });
}
function ctlDm(s) { return s ? String(s).slice(8, 10) + '/' + String(s).slice(5, 7) : '—'; }
const CTL_SEL = 'background:var(--surface-2); border:1px solid var(--line); border-radius:8px; color:var(--tx-1); padding:6px 8px; font:inherit;';
function ctlRender() {
  const alvo = document.getElementById('view-controle');
  if (!alvo || !CTL) return;
  const busca = (CTL.busca || '').trim().toUpperCase();
  // dono, 22/10/2026: "pode ter as colunas com ordenação, e filtros com Curva ABC, por grupo e itens negativos".
  // curva e grupo vêm do banco (colunas de vw_est_controle_item); sem a coluna, o filtro não aparece.
  const temCurva = (CTL.itens || []).some((i) => i.curva), temGrupo = (CTL.itens || []).some((i) => i.grupo);
  // O VALOR mora em outro módulo (dono, 22/10/2026: "um modulo chamado posição de estoque ... assim toda a análise de
  // valores de estoque fica separado do controle de unidades de estoque"). Aqui é só quantidade.
  // FORA DA BASE à parte (22/10/2026): item sem nome na nossa base vem com o nome do Saipos e fora_da_base = true.
  // Não some (o movimento existiu), mas não se mistura com a base: só aparece quando se pede para ver.
  const nFora = (CTL.itens || []).filter((i) => i.fora_da_base).length;
  const itens = (CTL.itens || []).filter((i) => (CTL.verFora ? i.fora_da_base : !i.fora_da_base) && (!busca || String(i.nome_base).toUpperCase().includes(busca))
      && (!CTL.curva || i.curva === CTL.curva) && (!CTL.grupo || (CTL.grupo === '__fora' ? !i.grupo : i.grupo === CTL.grupo)) && (!CTL.soNeg || Number(i.saldo_hoje) < 0))
    .sort((a, b) => {
      const va = a[CTL.ord], vb = b[CTL.ord];
      const num = ['qtd_partida', 'entrou', 'saiu', 'saldo_hoje', 'dinheiro'].includes(CTL.ord);
      const r = num ? Number(va || 0) - Number(vb || 0) : String(va || '').localeCompare(String(vb || ''), 'pt-BR');
      // dono, 22/10/2026: "o filtro das tabelas deve sempre ordenar do maior valor para o menor" — empate (mesma curva,
      // mesmo grupo) cai no valor, do maior para o menor (o mesmo dinheiro que forma a curva ABC)
      return (CTL.desc ? -r : r) || Number(b.dinheiro || 0) - Number(a.dinheiro || 0);
    });
  // grupo na ordem da folha de contagem; item sem grupo = fora da folha (saiu da base ou o dono tirou da contagem)
  const ordemG = {};
  (CTL.itens || []).forEach((i) => { if (i.grupo && ordemG[i.grupo] == null) ordemG[i.grupo] = Number(i.ordem_grupo); });
  const grupos = Object.keys(ordemG).sort((a, b) => ordemG[a] - ordemG[b] || a.localeCompare(b, 'pt-BR'));
  const temFora = temGrupo && (CTL.itens || []).some((i) => !i.grupo);
  const daBase = (CTL.itens || []).filter((i) => !i.fora_da_base);
  const comMov = daBase.filter((i) => Number(i.movimentos) > 0).length;
  const negativos = daBase.filter((i) => Number(i.saldo_hoje) < 0).length;

  let h = `<div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">Controle de estoque — ${trEscH(CTL.unidade)}</div>
    <div class="caption-label" style="text-align:left;">Cada item desde a implantação (contagem de 21/10, 19:00): o que entrou (nota, produção, lista recebida) e o que saiu (venda pela ficha, produção, lista enviada). Clique no item para ver o kardex, com o saldo linha a linha.</div>
    ${ctlIdadeHtml()}
    <div class="cards cards-3">
      <div class="card neutral"><div class="card-lbl">Itens no estoque</div><div class="card-val">${daBase.length}</div><div class="card-pct">nomes da base nesta loja</div></div>
      <div class="card neutral"><div class="card-lbl">Com movimento</div><div class="card-val">${comMov}</div><div class="card-pct">desde a implantação</div></div>
      <div class="card ${negativos ? 'highlight' : 'pos'}"><div class="card-lbl">Saldo negativo</div><div class="card-val">${negativos}</div><div class="card-pct">saiu mais do que tinha: conferir</div></div>
    </div>
    <div class="contexto" style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
      <label>Loja <select onchange="CTL.unidade=this.value; ctlCarregar();" style="${CTL_SEL}">${CTL_LOJAS.map((l) => `<option${l === CTL.unidade ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <input id="ctlBusca" placeholder="Procurar item…" value="${trEscH(CTL.busca || '')}" oninput="CTL.busca=this.value; ctlRender(); const c=document.getElementById('ctlBusca'); if (c) { c.focus(); c.setSelectionRange(c.value.length, c.value.length); }"
             style="flex:1 1 220px; ${CTL_SEL}">
      ${temCurva ? `<select onchange="CTL.curva=this.value; CTL.ord='dinheiro'; CTL.desc=true; ctlRender();" style="${CTL_SEL}"><option value="">curva: todas</option>${['A', 'B', 'C'].map((c) => `<option${c === CTL.curva ? ' selected' : ''}>${c}</option>`).join('')}</select>` : ''}
      ${temGrupo ? `<select onchange="CTL.grupo=this.value; CTL.ord='dinheiro'; CTL.desc=true; ctlRender();" style="${CTL_SEL}"><option value="">grupo: todos</option>${grupos.map((g) => `<option${g === CTL.grupo ? ' selected' : ''}>${trEscH(g)}</option>`).join('')}${temFora ? `<option value="__fora"${CTL.grupo === '__fora' ? ' selected' : ''}>fora da folha de contagem</option>` : ''}</select>` : ''}
      ${nFora ? `<label style="display:flex; gap:6px; align-items:center;" title="itens sem nome na nossa base: aparecem com o nome do Saipos"><input type="checkbox"${CTL.verFora ? ' checked' : ''} onchange="CTL.verFora=this.checked; CTL.ord='dinheiro'; CTL.desc=true; ctlRender();"> ver os ${nFora} fora da base</label>` : ''}
      <label style="display:flex; gap:6px; align-items:center;"><input type="checkbox"${CTL.soNeg ? ' checked' : ''} onchange="CTL.soNeg=this.checked; CTL.ord='dinheiro'; CTL.desc=true; ctlRender();"> só negativos</label>
      <span class="caption-label">${itens.length} de ${(CTL.itens || []).length}</span>
    </div>`;
  if (CTL.verFora) h += `<div class="contexto" style="text-align:left; border-color:var(--farol-perto);"><b style="color:var(--farol-perto);">Fora da base: o nome aqui é o do Saipos.</b> São itens que tiveram movimento e ainda não têm nome na nossa base. Cada um que entrar na base sai desta lista sozinho.</div>`;
  if (CTL.item) h += ctlHtmlExtrato();
  const th = (col, rot, dir) => `<th style="cursor:pointer;${dir ? ' text-align:right;' : ''}" onclick="ctlOrdenarPor('${col}')" title="ordenar">${rot}${CTL.ord === col ? (CTL.desc ? ' ▼' : ' ▲') : ''}</th>`;
  h += `<div id="tabelaControleItens"><table><thead><tr>${th('nome_base', 'Item')}${temCurva ? th('curva', 'Curva') : ''}${temGrupo ? th('grupo', 'Grupo') : ''}${th('partida_de', 'Saldo inicial em')}${th('qtd_partida', 'Contado', 1)}
      ${th('entrou', 'Entrou', 1)}${th('saiu', 'Saiu', 1)}${th('saldo_hoje', 'Saldo hoje', 1)}<th>Un</th></tr></thead><tbody>`;
  itens.forEach((i) => {
    const neg = Number(i.saldo_hoje) < 0;
    h += `<tr style="cursor:pointer;${i.nome_base === CTL.item ? ' background:var(--surface-2);' : ''}" onclick="ctlAbrir(${JSON.stringify(i.nome_base).replace(/"/g, '&quot;')})" title="ver o extrato">
      <td><b>${trEscH(i.nome_base)}</b>${Number(i.movimentos) ? '' : ' <span class="caption-label">sem movimento</span>'}</td>
      ${temCurva ? `<td>${trEscH(i.curva || '')}</td>` : ''}${temGrupo ? `<td style="color:var(--tx-4);">${i.grupo ? trEscH(i.grupo) : '<i>fora da folha</i>'}</td>` : ''}
      <td>${ctlDm(i.partida_de)}</td><td style="text-align:right;">${ctlNum(i.qtd_partida, i.un)}</td>
      <td style="text-align:right;">${ctlNum(i.entrou, i.un)}</td><td style="text-align:right;">${ctlNum(i.saiu, i.un)}</td>
      <td style="text-align:right;${neg ? ' color:var(--farol-fora);' : ''}"><b>${ctlNum(i.saldo_hoje, i.un)}</b></td><td style="color:var(--tx-4);">${trEscH(i.un || '')}</td></tr>`;
  });
  h += `</tbody></table></div>`;
  alvo.innerHTML = h;
}
function ctlOrdenarPor(col) {
  if (CTL.ord === col) CTL.desc = !CTL.desc;
  else { CTL.ord = col; CTL.desc = ['qtd_partida', 'entrou', 'saiu', 'saldo_hoje', 'dinheiro'].includes(col); }
  ctlRender();
}
function ctlHtmlExtrato() {
  const i = (CTL.itens || []).find((x) => x.nome_base === CTL.item) || {};
  let h = `<div id="ctlExtrato" class="section-label">${trEscH(CTL.item)} — kardex</div>`;
  if (!CTL.extrato) return h + `<div class="contexto">Carregando o kardex…</div>`;
  const L = CTL.extrato.filter((r) => Number(r.ordem) === 0 || ((!CTL.tipo || r.movimento === CTL.tipo) && (!CTL.de || r.dia >= CTL.de) && (!CTL.ate || r.dia <= CTL.ate)));
  const tipos = [...new Set(CTL.extrato.filter((r) => Number(r.ordem) !== 0).map((r) => r.movimento))];
  h += `<div class="contexto" style="text-align:left;">Saldo inicial na implantação (contagem de 21/10, 19:00) · entrou <b>${ctlNum(i.entrou || 0, i.un)}</b> ·
      saiu <b>${ctlNum(i.saiu || 0, i.un)}</b> · saldo hoje <b>${ctlNum(i.saldo_hoje, i.un)} ${trEscH(i.un || '')}</b>
      ${tipos.length ? `<div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:8px; align-items:center;">
        <select onchange="CTL.tipo=this.value; ctlRender();" style="${CTL_SEL}"><option value="">todos os movimentos</option>${tipos.map((t) => `<option${t === CTL.tipo ? ' selected' : ''}>${trEscH(t)}</option>`).join('')}</select>
        <label>de <input type="date" value="${CTL.de}" onchange="CTL.de=this.value; ctlRender();" style="${CTL_SEL}"></label>
        <label>até <input type="date" value="${CTL.ate}" onchange="CTL.ate=this.value; ctlRender();" style="${CTL_SEL}"></label>
        <button class="preset-btn" onclick="CTL.item=null; ctlRender();">fechar</button></div>` : `<div style="margin-top:6px;"><button class="preset-btn" onclick="CTL.item=null; ctlRender();">fechar</button></div>`}</div>
    <div id="tabelaControleExtrato"><table><thead><tr><th>Dia</th><th>Movimento</th><th>Documento</th>
      <th style="text-align:right;">Entrada</th><th style="text-align:right;">Saída</th><th style="text-align:right;">Saldo</th></tr></thead><tbody>`;
  L.forEach((r) => {
    const abre = Number(r.ordem) === 0;
    h += `<tr${abre ? ' style="background:var(--surface-2);"' : ''}>
      <td style="white-space:nowrap;">${ctlDm(r.dia)}</td><td>${abre ? '<b>' + trEscH(r.movimento) + '</b>' : trEscH(r.movimento)}</td><td style="color:var(--tx-4);">${trEscH(r.documento || '')}</td>
      <td style="text-align:right; color:var(--farol-ok);">${r.entrada != null ? '+' + ctlNum(r.entrada, r.un) : ''}</td>
      <td style="text-align:right; color:var(--farol-fora);">${r.saida != null ? '−' + ctlNum(r.saida, r.un) : ''}</td>
      <td style="text-align:right;"><b>${ctlNum(r.saldo, r.un)}</b></td></tr>`;
  });
  if (L.length === 1) h += `<tr><td colspan="6" class="caption-label">Nenhum movimento depois da implantação.</td></tr>`;
  return h + `</tbody></table></div>`;
}

// ------------------------------------------------------------------
// POSIÇÃO DE ESTOQUE (dono, 22/10/2026: "um modulo chamado posição de estoque, que traga o valor de cada item, um
// histórico com a foto de outros dias, filtros, assim toda a análise de valores de estoque fica separado do controle
// de unidades de estoque"). Lê a FOTO diária do banco (vw_est_posicao por item, vw_est_posicao_dia por dia), tirada
// por est_tirar_foto_posicao() no fim da carga do Saipos e ao fechar contagem. A tela não multiplica nada.
// O histórico começa em 21/10 (antes disso a quantidade não é fiel). Dia RECONSTRUIDO usa o custo de hoje: ali a
// variação de valor é só de quantidade; a de preço aparece nos dias DIA.
// ------------------------------------------------------------------
let POS = null;
async function entrarPosicao() {
  const alvo = document.getElementById('view-posicao');
  if (!alvo) return;
  if (!rmbSessao()) { alvo.innerHTML = `<div class="contexto">Entre no painel para ver a posição de estoque.</div>`; return; }
  alvo.innerHTML = `<div class="contexto">Carregando…</div>`;
  try {
    if (!POS) {
      const ru = await trRpc('tr_minha_unidade');
      POS = { unidade: (ru.ok ? await ru.json() : null) || 'AGUA VERDE', dia: null, busca: '', curva: '', grupo: '', semCusto: false,
              ord: 'valor', desc: true };
    }
    await posCarregarDias();
  } catch (e) {
    alvo.innerHTML = `<div class="contexto" style="border-color:var(--farol-fora);">Não consegui abrir a tela: ${trEscH(e.message)}</div>`;
  }
}
async function posCarregarDias() {
  POS.dias = await consultarTudo(`vw_est_posicao_dia?select=*&unidade=eq.${encodeURIComponent(POS.unidade)}&order=dia`);
  if (!POS.dia || !POS.dias.some((d) => d.dia === POS.dia)) POS.dia = POS.dias.length ? POS.dias[POS.dias.length - 1].dia : null;
  await posCarregarItens();
}
async function posCarregarItens() {
  POS.itens = POS.dia ? await consultarTudo(`vw_est_posicao?select=*&unidade=eq.${encodeURIComponent(POS.unidade)}&dia=eq.${POS.dia}`) : [];
  posRender();
}
function posOrdenarPor(col) {
  if (POS.ord === col) POS.desc = !POS.desc;
  else { POS.ord = col; POS.desc = ['saldo', 'custo_unitario', 'valor'].includes(col); }
  posRender();
}
function posRender() {
  const alvo = document.getElementById('view-posicao');
  if (!alvo || !POS) return;
  const dm = (s) => s ? String(s).slice(8, 10) + '/' + String(s).slice(5, 7) : '—';
  const sel = 'background:var(--surface-2); border:1px solid var(--line); border-radius:8px; color:var(--tx-1); padding:6px 8px; font:inherit;';
  const D = (POS.dias || []).find((d) => d.dia === POS.dia) || {};
  const k = (POS.dias || []).findIndex((d) => d.dia === POS.dia);
  const ant = k > 0 ? POS.dias[k - 1] : null;
  const varTxt = ant ? (() => { const v = Number(D.valor) - Number(ant.valor); return Math.abs(v) < 0.5 ? 'igual ao dia anterior' : `${v > 0 ? 'subiu' : 'caiu'} R$ ${fmt(Math.abs(v))} desde ${dm(ant.dia)}`; })() : 'primeiro dia do histórico';
  const busca = (POS.busca || '').trim().toUpperCase();
  const itens = (POS.itens || []).filter((i) => (!busca || String(i.nome_base).toUpperCase().includes(busca))
      && (!POS.curva || i.curva === POS.curva) && (!POS.grupo || (POS.grupo === '__fora' ? !i.grupo : i.grupo === POS.grupo))
      // "sem custo" que tira do total = sem valor E com mercadoria (Estoque, 22/10: sem custo com saldo zero não tira um centavo)
      && (!POS.semCusto || (i.valor == null && Number(i.saldo || 0) !== 0)))
    .sort((a, b) => {
      const num = ['saldo', 'custo_unitario', 'valor'].includes(POS.ord);
      const va = a[POS.ord], vb = b[POS.ord];
      const r = num ? (va == null ? -Infinity : Number(va)) - (vb == null ? -Infinity : Number(vb)) : String(va || '').localeCompare(String(vb || ''), 'pt-BR');
      return (POS.desc ? -r : r) || Number(b.valor || 0) - Number(a.valor || 0);   // empate: maior valor primeiro (dono, 22/10)
    });
  const grupos = [...new Set((POS.itens || []).map((i) => i.grupo).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const comValor = Number(D.itens || 0) - Number(D.itens_sem_valor || 0);
  const semCustoN = Number(D.itens_sem_custo_com_saldo != null ? D.itens_sem_custo_com_saldo : D.itens_sem_valor || 0);
  let h = `<div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">Posição de estoque — ${trEscH(POS.unidade)} · ${dm(POS.dia)}</div>
    <div class="caption-label" style="text-align:left;">Quanto dinheiro está parado em cada item: o saldo do sistema × o custo da nossa base, numa foto por dia. As quantidades, item a item, ficam no Controle de estoque.</div>
    <div class="cards cards-3">
      <div class="card neutral"><div class="card-lbl">Valor parado</div><div class="card-val">R$ ${fmt(Number(D.valor || 0))}</div><div class="card-pct">em ${comValor} itens · ${varTxt}</div></div>
      <div class="card neutral"><div class="card-lbl">Curva A</div><div class="card-val">R$ ${fmt(Number(D.valor_curva_a || 0))}</div><div class="card-pct">${D.valor ? Math.round(100 * Number(D.valor_curva_a) / Number(D.valor)) : 0}% do valor parado</div></div>
      <div class="card ${semCustoN ? 'highlight' : 'pos'}" style="cursor:pointer;" onclick="POS.semCusto=true; POS.ord='valor'; POS.desc=true; posRender();" title="ver a lista">
        <div class="card-lbl">Sem custo na base</div><div class="card-val">${semCustoN}</div>
        <div class="card-pct">itens com mercadoria e sem custo: ficam fora da conta, o valor é um piso · ver a lista</div></div>
    </div>`;
  // histórico: uma linha por dia
  h += `<div id="tabelaPosicaoDias"><table><thead><tr><th>Dia</th><th>Foto</th><th style="text-align:right;">Valor parado</th><th style="text-align:right;">Curva A</th><th style="text-align:right;">Sem custo, com mercadoria</th></tr></thead><tbody>`;
  (POS.dias || []).slice().reverse().forEach((d) => {
    h += `<tr style="cursor:pointer;${d.dia === POS.dia ? ' background:var(--surface-2);' : ''}" onclick="POS.dia='${d.dia}'; posCarregarItens();" title="ver a foto deste dia">
      <td><b>${dm(d.dia)}</b></td>
      <td style="color:var(--tx-4);" title="${d.origem === 'DIA' ? 'foto tirada no próprio dia' : 'remontado do extrato com o custo de hoje: a variação é só de quantidade'}">${d.origem === 'DIA' ? 'do dia' : 'remontada'}</td>
      <td style="text-align:right;">R$ ${fmt(Number(d.valor))}</td><td style="text-align:right;">R$ ${fmt(Number(d.valor_curva_a))}</td>
      <td style="text-align:right;">${Number(d.itens_sem_custo_com_saldo != null ? d.itens_sem_custo_com_saldo : d.itens_sem_valor)}</td></tr>`;
  });
  h += `</tbody></table></div>
    <div class="caption-label" style="text-align:left;">O histórico começa em 21/10, o primeiro dia com a contagem como ponto de partida. "remontada": dia refeito com o custo de hoje, então a diferença é só de quantidade.</div>`;
  h += `<div class="contexto" style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
      <label>Loja <select onchange="POS.unidade=this.value; POS.dia=null; posCarregarDias();" style="${sel}">${CTL_LOJAS.map((l) => `<option${l === POS.unidade ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <input id="posBusca" placeholder="Procurar item…" value="${trEscH(POS.busca || '')}" oninput="POS.busca=this.value; posRender(); const c=document.getElementById('posBusca'); if (c) { c.focus(); c.setSelectionRange(c.value.length, c.value.length); }" style="flex:1 1 200px; ${sel}">
      <select onchange="POS.curva=this.value; POS.ord='valor'; POS.desc=true; posRender();" style="${sel}"><option value="">curva: todas</option>${['A', 'B', 'C'].map((c) => `<option${c === POS.curva ? ' selected' : ''}>${c}</option>`).join('')}</select>
      <select onchange="POS.grupo=this.value; POS.ord='valor'; POS.desc=true; posRender();" style="${sel}"><option value="">grupo: todos</option>${grupos.map((g) => `<option${g === POS.grupo ? ' selected' : ''}>${trEscH(g)}</option>`).join('')}<option value="__fora"${POS.grupo === '__fora' ? ' selected' : ''}>fora da folha de contagem</option></select>
      <label style="display:flex; gap:6px; align-items:center;"><input type="checkbox"${POS.semCusto ? ' checked' : ''} onchange="POS.semCusto=this.checked; POS.ord='valor'; POS.desc=true; posRender();"> só sem custo</label>
      <span class="caption-label">${itens.length} de ${(POS.itens || []).length}</span>
    </div>`;
  const th = (col, rot, dir) => `<th style="cursor:pointer;${dir ? ' text-align:right;' : ''}" onclick="posOrdenarPor('${col}')" title="ordenar">${rot}${POS.ord === col ? (POS.desc ? ' ▼' : ' ▲') : ''}</th>`;
  h += `<div id="tabelaPosicaoItens"><table><thead><tr>${th('nome_base', 'Item')}${th('curva', 'Curva')}${th('grupo', 'Grupo')}${th('saldo', 'Saldo', 1)}<th>Un</th>${th('custo_unitario', 'Custo', 1)}${th('valor', 'Valor parado', 1)}</tr></thead><tbody>`;
  itens.forEach((i) => {
    const neg = Number(i.valor) < 0;
    const cor = i.valor == null ? '' : neg ? ' color:var(--farol-fora);' : i.custo_confiavel === false ? ' color:var(--farol-perto);' : '';
    h += `<tr><td><b>${trEscH(i.nome_base)}</b></td><td>${trEscH(i.curva || '')}</td><td style="color:var(--tx-4);">${i.grupo ? trEscH(i.grupo) : '<i>fora da folha</i>'}</td>
      <td style="text-align:right;${Number(i.saldo) < 0 ? ' color:var(--farol-fora);' : ''}">${ctlNum(i.saldo, i.un)}</td><td style="color:var(--tx-4);">${trEscH(i.un || '')}</td>
      <td style="text-align:right;">${i.custo_unitario == null ? '' : 'R$ ' + fmt(Number(i.custo_unitario))}</td>
      <td style="text-align:right;${cor}"${i.valor == null ? ' title="sem custo na nossa base — fora do total"' : i.custo_confiavel === false ? ' title="custo ainda não confiável em alguma etiqueta"' : ''}>${i.valor == null ? '<span style="color:var(--tx-5);">sem custo</span>' : '<b>R$ ' + fmt(Number(i.valor)) + '</b>'}</td></tr>`;
  });
  h += `</tbody></table></div>
    <div class="caption-label" style="text-align:left;">"sem custo": item sem custo na nossa base, fora do total. Em âmbar, custo ainda não confiável; em vermelho, saldo negativo (em geral produção não apontada).</div>`;
  alvo.innerHTML = h;
}

function prdAlvo() { return document.getElementById(EST_TELA === 'ordens' ? 'view-ordens' : 'view-producao'); }
async function entrarApontar() { EST_TELA = 'producao'; return entrarProducao(); }
async function entrarProducao() {
  if (EST_TELA !== 'ordens') EST_TELA = 'producao';
  const alvo = prdAlvo();
  if (!alvo) return;
  const sessao = rmbSessao();
  if (!sessao) { alvo.innerHTML = `<div class="contexto">Entre no painel para apontar produção.</div>`; return; }
  alvo.innerHTML = `<div class="contexto">Carregando…</div>`;
  try {
    if (!PRD || !PRD.papel) {
      const [rp, ru] = await Promise.all([trRpc('tr_meu_papel'), trRpc('tr_minha_unidade')]);
      const papel = rp.ok ? await rp.json() : null;
      if (!papel) {
        alvo.innerHTML = `<div class="contexto">Você está logado como <b>${sessao.email}</b>, mas este login ainda
          não tem papel na operação — sem isso o banco não aceita o apontamento. Quem cadastra é o Neto, em <b>tr_usuarios</b>.</div>`;
        return;
      }
      PRD = { papel, unidade: (ru.ok ? await ru.json() : null) || 'AGUA VERDE',
              data: prdHoje(), busca: '', aberta: null, ingredientes: {} };
    }
    await prdCarregar();
  } catch (e) {
    alvo.innerHTML = `<div class="contexto" style="border-color:var(--farol-fora);">Não consegui abrir a tela: ${e.message}</div>`;
  }
}

async function prdCarregar() {
  await estNomesCarregar();
  const u = encodeURIComponent(PRD.unidade);
  const [receitas, lancamentos, base, move, perdas, itensEst] = await Promise.all([
    consultarTudo(`vw_est_producao_receita?select=*&unidade=eq.${u}&order=receita.asc`),
    // 21/10/2026: o lote com perda, entrou no estoque, planejado, rendimento e a marca de corrigida (vw_est_producao_lote)
    consultarTudo(`vw_est_producao_lote?select=*&unidade=eq.${u}&data=eq.${PRD.data}&order=criado_em.desc`),
    // 22/10/2026 (dono): só RECEITA da base em uso; água, refri e brownie de revenda tinham "ficha" de si mesmos
    consultarTudo('ft_receita_base?select=nome_base,grupo_receita,nao_usa&order=nome_base'),
    // 24/10/2026 (Estoque): por receita, se apontar move o saldo e por quê; e se é receita de fato (a regra é do banco)
    consultarTudo(`vw_est_receita_move?select=nome_base,move,motivo,e_receita&unidade=eq.${u}&order=nome_base`).catch(() => null),
    // 24/10/2026: perda fora da produção (estragou, venceu, caiu, voltou do salão) registrada no dia
    consultarTudo(`vw_est_perda?select=*&unidade=eq.${u}&data=eq.${PRD.data}&order=criado_em.desc`).catch(() => null),
    PRD.itensEst ? Promise.resolve(PRD.itensEst)
      : consultarTudo(`vw_est_controle_item?select=nome_base,un,saldo_hoje,fora_da_base&unidade=eq.${u}&order=nome_base`).catch(() => null),
  ]);
  const grupoDe = new Map(base.filter((b) => !b.nao_usa && b.nome_base).map((b) => [b.nome_base, b.grupo_receita || 'SEM GRUPO']));
  const moveDe = move && move.length ? new Map(move.map((m) => [m.nome_base, m])) : null;
  PRD.receitas = receitas.filter((r) => grupoDe.has(r.nome_base) && !(moveDe && moveDe.get(r.nome_base) && moveDe.get(r.nome_base).e_receita === false))
    .map((r) => { const m = moveDe && moveDe.get(r.nome_base); return { ...r, grupo: grupoDe.get(r.nome_base), move: m ? m.move : null, move_motivo: m ? m.motivo : null }; });
  PRD.perdas = perdas;
  PRD.itensEst = itensEst;
  PRD.lancamentos = lancamentos;
  await Promise.all([prdOrdensCarregar(), estFilaCarregar(PRD.unidade),
    EST_TELA === 'ordens' ? estHistCarregar('ordem', 'vw_est_historico_ordem', PRD.unidade, 'criado_em.desc')
                          : estHistCarregar('apont', 'vw_est_historico_apontamento', PRD.unidade, 'criado_em.desc')]);
  prdRender();
}

function prdOrdensTela() {
  const alvo = prdAlvo();
  let h = `<h2>Ordens de produção</h2>` + estFilaHtml();
  h += prdOrdensHtml();
  h = estHistTopo(h, 'ordem', 'Histórico das ordens', 'Cada ordem: de que lista nasceu, o tempo de produção e quantas receitas foram apontadas.',
    ['Ordem', 'Para', 'Família', 'Da lista', 'Iniciou', 'Encerrou', 'Produção', 'Pausa', 'Apontadas', 'Situação'],
    (o) => `<tr><td><b>${trEscH(o.numero)}</b></td><td>${ffDdmm(o.data_para)}</td><td>${trEscH(String(o.familia || 'individual').toLowerCase())}</td>
      <td>${o.veio_da_separacao ? `<a href="javascript:void(0)" style="color:var(--brand);" onclick="mostrarModulo('separacao')">${trEscH(o.veio_da_separacao)}</a>` : '—'}</td>
      <td>${o.quem_iniciou ? trEscH(estNome(o.quem_iniciou)) : '—'} <span style="color:var(--tx-5); font-size:11px;">${estQuando(o.iniciada_em)}</span></td>
      <td>${o.quem_fechou ? trEscH(estNome(o.quem_fechou)) : '—'} <span style="color:var(--tx-5); font-size:11px;">${o.fechada_em ? estQuando(o.fechada_em) : ''}</span></td>
      <td style="font-variant-numeric:tabular-nums;">${prdHms(o.segundos_producao)}</td><td style="font-variant-numeric:tabular-nums;">${prdHms(o.segundos_pausada_total)}</td>
      <td>${Number(o.receitas_apontadas) || 0} de ${Number(o.receitas) || 0}</td>
      <td style="font-size:12px; color:${EST_LEIT_COR(o.leitura)};">${trEscH(o.leitura || '')}</td></tr>`);
  alvo.innerHTML = h;
}
function prdRender() {
  if (EST_TELA === 'ordens') return prdOrdensTela();
  const alvo = prdAlvo();
  const foco = document.activeElement && document.activeElement.id === 'prdBusca'
    ? document.activeElement.selectionStart : null;
  prdGuardarDigitado();
  const busca = (PRD.busca || '').trim().toLowerCase();
  const lista = PRD.receitas.filter((r) => (!PRD.grupo || r.grupo === PRD.grupo)
    && (!busca || r.receita.toLowerCase().includes(busca) || (r.nome_base || '').toLowerCase().includes(busca)));
  const parciais = PRD.receitas.filter((r) => Number(r.ingredientes_fora_do_estoque || 0) > 0);
  const hoje = prdHoje();
  const email = ((rmbSessao() || {}).email || '').toLowerCase();

  let h = `<h2>Apontar produção</h2>` + estFilaHtml() + `
    <div class="caption-label">O que a cozinha produziu entra no estoque; os ingredientes da ficha saem.</div>`;

  h += `<div class="cards cards-3">
      <div class="card ${PRD.lancamentos.length ? 'pos' : 'neutral'}"><div class="card-lbl">Apontado no dia</div>
        <div class="card-val">${PRD.lancamentos.length}</div>
        <div class="card-pct">${PRD.data === hoje ? 'hoje' : PRD.data.split('-').reverse().join('/')}</div></div>
      <div class="card neutral"><div class="card-lbl">Receitas da casa</div>
        <div class="card-val">${PRD.receitas.length}</div>
        <div class="card-pct">da base de receitas, em uso nesta loja</div></div>
      <div class="card ${parciais.length ? 'highlight' : 'pos'}"><div class="card-lbl">Baixam só em parte</div>
        <div class="card-val">${parciais.length}</div>
        <div class="card-pct">receita com ingrediente fora do estoque</div></div>
    </div>`;

  h += `<div class="contexto" style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
      <b>${PRD.unidade}</b>
      <label style="display:flex; gap:6px; align-items:center;">Dia
        <input type="date" value="${PRD.data}" min="${prdDiasAtras(7)}" max="${prdHoje()}"
               onchange="PRD.data=this.value; prdCarregar();"
               style="background:var(--surface-2); border:1px solid var(--line); border-radius:8px; color:var(--tx-1); padding:6px 8px;"></label>
      <input id="prdBusca" placeholder="Procurar receita…" value="${(PRD.busca || '').replace(/"/g, '&quot;')}"
             oninput="PRD.busca=this.value; prdRender();"
             style="flex:1 1 200px; background:var(--surface-2); border:1px solid var(--line); border-radius:8px; color:var(--tx-1); padding:6px 10px;">
    </div>`;

  // 27/10/2026 (dono): as ordens moram na tela Ordens; aqui só o aviso de que há ordem viva
  const vivas = ((PRD.ordens && PRD.ordens.rel) || []).filter((o) => PRD_ORD_VIVA.includes(o.situacao));
  if (vivas.length) h += `<div class="contexto" style="text-align:left;">${vivas.length} ${vivas.length === 1 ? 'ordem aberta' : 'ordens abertas'}
      (${vivas.map((o) => trEscH(o.numero)).join(', ')}): o que nasceu de ordem se aponta na própria ordem.
      <button class="preset-btn active" onclick="mostrarModulo('ordens')">Abrir Ordens ›</button></div>`;

  if (PRD.lancamentos.length) {
    // 21/10/2026: produziu, perdeu, entrou no estoque e o rendimento contra o planejado; corrigir = linha nova que
    // substitui esta (a original fica riscada, fora do saldo). Uma correcao por linha; correcao nao se corrige.
    const nomeR = (rec) => (PRD.receitas.find((x) => x.receita === rec) || {}).nome_base || rec;
    h += `<div class="section-label">Já apontado neste dia</div>
      <div id="tabelaPrdLotes" style="overflow-x:auto;"><table><thead><tr><th>Receita</th><th>Produziu</th><th>Perdeu</th><th>Entrou no estoque</th>
        <th>Planejado</th><th>Rendimento</th><th>Quem</th><th></th></tr></thead><tbody>`;
    PRD.lancamentos.forEach((l) => {
      const meu = (l.quem || '').toLowerCase() === email;
      const horas = (Date.now() - new Date(l.criado_em).getTime()) / 3600000;
      const risca = l.fora_da_conta ? ' style="opacity:.5; text-decoration:line-through;"' : '';
      const rend = l.rendimento_pct == null ? '—' : `${String(Math.round(Number(l.rendimento_pct) * 10) / 10).replace('.', ',')}%`;
      const corRend = l.situacao_rendimento && /ABAIXO|ACIMA/.test(l.situacao_rendimento) ? 'var(--farol-perto)' : 'var(--tx-2)';
      const podeCorrigir = !l.fora_da_conta && !l.corrige_id && !l.corrigida_por;
      h += `<tr${risca}><td>${nomeR(l.receita)}${l.corrige_id ? ` <span style="color:var(--tx-5); font-size:11px;">correção da linha ${l.corrige_id}</span>` : ''}${l.fora_da_conta ? ` <span style="color:var(--tx-5); font-size:11px;">corrigida</span>` : ''}${l.observacao ? ` <span style="color:var(--tx-5);">· ${l.observacao}</span>` : ''}</td>
        <td>${fmt(Number(l.produziu))} ${l.un || ''}</td>
        <td>${Number(l.perdeu) ? `${fmt(Number(l.perdeu))} <span style="color:var(--tx-5); font-size:11px;">${(l.perda_motivo || '').toLowerCase()}</span>` : '—'}</td>
        <td>${fmt(Number(l.entrou_no_estoque))}</td>
        <td>${l.planejado == null ? '—' : fmt(Number(l.planejado))}</td>
        <td style="color:${corRend};" title="${l.situacao_rendimento || ''}">${rend}</td>
        <td style="color:var(--tx-5);">${estNome(l.quem)}</td>
        <td style="white-space:nowrap;">${podeCorrigir ? `<button class="preset-btn" onclick="prdCorrigirAbrir(${l.id})">corrigir</button>` : ''}
          ${meu && horas < 12 && !l.corrige_id && !l.corrigida_por ? `<button class="preset-btn" onclick="prdDesfazer(${l.id})">desfazer</button>` : ''}</td></tr>`;
      if (PRD.corrigindo === l.id) {
        h += `<tr><td colspan="8" style="background:var(--surface-2);"><div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
          <b>Corrigir:</b> produziu <input type="number" step="0.001" min="0" inputmode="decimal" id="prdC_q" value="${Number(l.produziu)}" style="width:100px; background:var(--surface-2); border:1px solid var(--line); border-radius:8px; color:var(--tx-1); padding:6px 8px;">
          perdeu <input type="number" step="0.001" min="0" inputmode="decimal" id="prdC_p" value="${Number(l.perdeu) || ''}" style="width:90px; background:var(--surface-2); border:1px solid var(--line); border-radius:8px; color:var(--tx-1); padding:6px 8px;">
          ${prdMotivoSelect('prdC_m', l.perda_motivo)}
          <input id="prdC_o" placeholder="por que corrigir (obrigatório)" style="flex:1 1 180px; background:var(--surface-2); border:1px solid var(--line); border-radius:8px; color:var(--tx-1); padding:6px 8px;">
          <button class="preset-btn" onclick="prdCorrigirGravar(${l.id})">gravar correção</button>
          <button class="preset-btn" onclick="PRD.corrigindo=null; prdRender();">cancelar</button></div>
          <div class="caption-label" style="text-align:left; margin-top:4px;">A linha original fica guardada e sai do saldo; a correção entra no lugar dela. Cada linha só se corrige uma vez.</div></td></tr>`;
      }
    });
    h += `</tbody></table></div>`;
  }

  // 22/10/2026 (dono): por grupo da base (PRODUCAO, PRATOS, LANCHES), filtro pelo mesmo grupo e toda coluna ordenável
  const GRP = [['PRODUCAO', 'Produção'], ['PRATOS', 'Pratos'], ['LANCHES', 'Lanches']];
  const nomeGrp = (g) => (GRP.find((x) => x[0] === g) || [g, g])[1];
  const nGrp = (g) => PRD.receitas.filter((r) => r.grupo === g).length;
  const gruposTodos = [...new Set(PRD.receitas.map((r) => r.grupo))]
    .sort((a, b) => (GRP.findIndex((x) => x[0] === a) + 99) % 99 - (GRP.findIndex((x) => x[0] === b) + 99) % 99 || a.localeCompare(b));
  const ord = PRD.ordem || { col: 'receita', asc: true };
  const valOrd = (r) => ({ receita: r.nome_base || r.receita, un: r.un || '', rende: Number(r.rendimento) || 0,
    ingredientes: Number(r.ingredientes) || 0, custo: Number(r.custo_un) || 0,
    ultima: r.ultima_producao || '' })[ord.col];
  const cmp = (a, b) => {
    const x = valOrd(a), y = valOrd(b);
    const c = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'pt-BR');
    return (ord.asc ? c : -c) || (a.nome_base || a.receita).localeCompare(b.nome_base || b.receita, 'pt-BR');
  };
  const th = (col, rot) => `<th style="cursor:pointer; white-space:nowrap; user-select:none;" onclick="prdOrdenar('${col}')"
      title="clique para ordenar por ${rot.toLowerCase()}">${rot} <span style="color:${ord.col === col ? 'var(--info)' : 'var(--tx-5)'}; font-size:11px;">${
      ord.col === col ? (ord.asc ? '▲' : '▼') : '⇅'}</span></th>`;
  const qtd = (v) => { const n = Number(v); return Number.isInteger(n) ? String(n) : fmt(n); };
  const campo = 'background:var(--surface-2); border:1px solid var(--line); border-radius:8px; color:var(--tx-1); padding:5px 8px;';
  h += `<div class="section-label">O que a cozinha produziu — sem precisar de ordem</div>
    <div class="caption-label">Para o que foi feito fora do plano. O que nasceu de uma ordem, registre na própria ordem, acima.
      Digite quanto saiu pronto; toque na receita para ver o que sai do estoque; clique no título da coluna para ordenar.</div>
    <div style="text-align:center; margin:8px 0 10px;">
      <button class="preset-btn ${PRD.grupo ? '' : 'active'}" onclick="PRD.grupo=null; prdRender();">todas ${PRD.receitas.length}</button>
      ${gruposTodos.map((g) => `<button class="preset-btn ${PRD.grupo === g ? 'active' : ''}" onclick="PRD.grupo='${g}'; prdRender();">${nomeGrp(g)} ${nGrp(g)}</button>`).join(' ')}
    </div>
    <div id="tabelaPrdGrade" style="overflow-x:auto;"><table><thead><tr>${th('receita', 'Receita')}${th('rende', 'Rende')}
      ${th('ingredientes', 'Ingred.')}${th('custo', 'Custo/un')}${th('ultima', 'Última vez')}
      <th style="white-space:nowrap;" title="o que veio do plano (ou o lote da ficha); troque se o plano do dia for outro">Planejado</th>
      <th style="white-space:nowrap;">Produziu</th><th style="white-space:nowrap;" title="só se houve perda: quanto e o motivo">Perdeu</th><th></th></tr></thead><tbody>`;
  (PRD.grupo ? [PRD.grupo] : gruposTodos).forEach((g) => {
    const doGrupo = lista.filter((r) => r.grupo === g).sort(cmp);
    if (!doGrupo.length) return;
    h += `<tr class="sub"><td colspan="9" style="font-weight:800; letter-spacing:.5px;">${nomeGrp(g).toUpperCase()}
        <span style="color:var(--tx-4); font-weight:400;">· ${doGrupo.length} ${doGrupo.length === 1 ? 'receita' : 'receitas'}</span></td></tr>`;
  doGrupo.forEach((r) => {
    const id = prdId(r.receita);
    const dias = r.ultima_producao
      ? Math.round((new Date(hoje + 'T12:00:00') - new Date(r.ultima_producao + 'T12:00:00')) / 86400000) : null;
    h += `<tr><td style="min-width:180px;"><a href="#" onclick="prdVer(${prdTxt(r.receita)}); return false;" style="color:var(--tx-1); text-decoration:none; font-weight:600; font-size:13px;"
          title="ver o que sai do estoque">${r.nome_base || r.receita}</a>
        ${Number(r.ingredientes_fora_do_estoque || 0) > 0
          ? `<div style="color:var(--farol-perto); font-size:11px;" title="Ao apontar, esses ingredientes não saem do estoque: não têm linha de estoque (falta o de/para). Toque na receita para ver quais.">${
              r.ingredientes_fora_do_estoque} ${Number(r.ingredientes_fora_do_estoque) === 1 ? 'ingrediente' : 'ingredientes'} sem estoque</div>` : ''}
        ${r.move === false ? `<div style="color:var(--farol-perto); font-size:11px;" title="Apontar esta receita fica registrado, mas não mexe no saldo: nem entra a receita nem saem os ingredientes.">não mexe no saldo · ${trEscH(r.move_motivo || '')}</div>` : ''}</td>
      <td style="white-space:nowrap;">${r.rendimento ? qtd(r.rendimento) : '—'} <span style="color:var(--tx-4); font-size:11px;">${r.un || ''}</span></td>
      <td>${r.ingredientes == null ? '—' : r.ingredientes}</td>
      <td style="white-space:nowrap;">${r.custo_un == null ? '—' : 'R$ ' + fmt(Number(r.custo_un))}</td>
      <td style="color:var(--tx-5); font-size:12px; line-height:1.2;${dias === null ? ' opacity:.6;' : ' white-space:nowrap;'}">${dias === null ? 'nunca apontada' : dias === 0 ? 'hoje' : dias === 1 ? 'ontem' : `há ${dias} dias`}</td>
      <td><input type="number" step="0.001" min="0" inputmode="decimal" id="${id}_pl" value="${r.rendimento ? Math.round(Number(r.rendimento) * 100) / 100 : ''}"
           title="o que veio do plano (ou o lote da ficha); troque se o plano do dia for outro"
           style="width:74px; background:transparent; border:1px dashed var(--line); border-radius:8px; color:var(--tx-4); padding:5px 8px;"></td>
      <td><input type="number" step="0.001" min="0" inputmode="decimal" id="${id}"
           onkeydown="if(event.key==='Enter'){prdApontar(${prdTxt(r.receita)}, ${prdTxt(r.un)});}"
           style="width:76px; background:var(--surface-2); border:1px solid var(--info); border-radius:8px; color:var(--tx-1); padding:5px 8px; font-weight:700;"></td>
      <td style="white-space:nowrap;"><input type="number" step="0.001" min="0" inputmode="decimal" id="${id}_p" placeholder="0"
           style="width:48px; ${campo}"> ${prdMotivoSelect(id + '_m', null).replace('padding:6px 8px;', 'padding:5px 2px; width:86px; color:var(--tx-4);')}</td>
      <td><button class="preset-btn" onclick="prdApontar(${prdTxt(r.receita)}, ${prdTxt(r.un)})">Apontar</button></td></tr>`;
    if (PRD.aberta === r.receita) {
      const ing = PRD.ingredientes[r.receita];
      h += `<tr><td colspan="9" style="background:var(--surface-2);">`;
      if (!ing) h += `<span style="color:var(--tx-5);">carregando a ficha…</span>`;
      else if (!ing.length) h += `<span style="color:var(--tx-5);">esta receita não tem ingrediente na ficha — nada sai do estoque.</span>`;
      else {
        h += `<div class="caption-label">Por 1 ${r.un || 'unidade'} produzido sai:</div>`;
        h += ing.map((i) => `<div>${i.no_estoque ? '' : '<span style="color:var(--farol-perto);">fora do estoque · </span>'}${i.materia_prima_nome_base || i.materia_prima}
             <b>${fmt(i.qtd_por_unidade)}</b> ${(i.un || '').toLowerCase()}</div>`).join('');
      }
      h += `</td></tr>`;
    }
  });
  });
  h += `</tbody></table></div>`;
  if (!lista.length) h += `<div class="contexto">Nenhuma receita com esse nome${PRD.grupo ? ' neste grupo' : ''}.</div>`;

  h += prdPerdaHtml();
  // 27/10/2026 (dono): o histórico dos apontamentos; correção aparece riscada, nunca some
  h = estHistTopo(h, 'apont', 'Histórico dos apontamentos', 'Tudo o que foi apontado, de que ordem veio (ou produção livre) e quanto saiu do planejado.',
    ['Quando', 'Receita', 'Saiu', 'Perdeu', 'Do planejado', 'Quem', 'Ordem', 'Leitura'],
    (a) => `<tr style="${a.foi_corrigido ? 'text-decoration:line-through; opacity:.55;' : ''}">
      <td style="white-space:nowrap;">${estQuando(a.criado_em)}</td><td>${trEscH(a.nome_base || '')}${a.e_correcao ? ' <span style="color:var(--info); font-size:11px;">correção</span>' : ''}</td>
      <td style="white-space:nowrap;">${fmt(Number(a.qtd))} ${trEscH(a.un || '')}</td>
      <td>${Number(a.perda) ? `${fmt(Number(a.perda))} <span style="color:var(--tx-5); font-size:11px;">${trEscH(String(a.perda_motivo || '').toLowerCase())}</span>` : '—'}</td>
      <td>${a.porcento_do_planejado == null ? '—' : Math.round(Number(a.porcento_do_planejado)) + '%'}</td>
      <td>${trEscH(estNome(a.quem))}</td><td>${a.ordem ? trEscH(a.ordem) : '<span style="color:var(--tx-5);">livre</span>'}</td>
      <td style="font-size:12px; color:${EST_LEIT_COR(a.leitura)};">${trEscH(a.leitura || '')}</td></tr>`);
  alvo.innerHTML = h;
  prdDevolverDigitado();
  if (foco !== null) {
    const b = document.getElementById('prdBusca');
    if (b) { b.focus(); try { b.setSelectionRange(foco, foco); } catch (e) {} }
  }
}

function prdOrdenar(col) {
  const o = PRD.ordem || { col: 'receita', asc: true };
  // número e data começam do maior; texto começa do A
  PRD.ordem = o.col === col ? { col, asc: !o.asc } : { col, asc: col === 'receita' || col === 'un' };
  prdRender();
}
// filtrar e ordenar redesenham a grade: o que já foi digitado (produziu, perdeu, motivo, planejado trocado) volta no lugar
function prdGuardarDigitado() {
  const alvo = prdAlvo();
  if (!alvo) return;
  PRD.digitado = PRD.digitado || {};
  alvo.querySelectorAll('tbody input[id], tbody select[id]').forEach((c) => {
    if (c.id.startsWith('prdC_')) return;
    if (c.value !== c.defaultValue || c.tagName === 'SELECT') PRD.digitado[c.id] = c.value; else delete PRD.digitado[c.id];
  });
}
function prdDevolverDigitado() {
  Object.entries(PRD.digitado || {}).forEach(([id, v]) => { const c = document.getElementById(id); if (c) c.value = v; });
}

// ---- ORDENS DE PRODUÇÃO NO TOPO DO APONTAR (etapas 2 e 3 do ciclo; dono aprovou o desenho em 22/10/2026) ----
// Mostra as ordens do dia escolhido e as que ainda estão vivas (ABERTA, EM_PRODUCAO, PAUSADA) de qualquer dia: ordem
// esquecida aberta é exatamente o que o aviso de turno quer pegar. O relógio separa os três tempos de propósito.
const PRD_ORD_VIVA = ['ABERTA', 'EM_PRODUCAO', 'PAUSADA'];
async function prdOrdensCarregar() {
  const u = encodeURIComponent(PRD.unidade);
  try {
    const rel = await consultarTudo(`vw_est_ordem_relogio?select=*&unidade=eq.${u}`
      + `&or=(data_para.eq.${PRD.data},situacao.in.(${PRD_ORD_VIVA.join(',')}))&order=data_para,numero`);
    const t0 = Date.now(); rel.forEach((o) => { o._t0 = t0; });
    const ids = rel.map((o) => o.id);
    const [itens, contas] = ids.length ? await Promise.all([
      consultarTudo(`vw_est_ordem_item?select=*&id_ordem=in.(${ids.join(',')})&order=nome_base`),
      consultarTudo(`vw_est_ordem?select=id,ingredientes,ingredientes_faltando,observacao&id=in.(${ids.join(',')})`),
    ]) : [[], []];
    // 26/10/2026: a família de cada ordem (uma por família de proteína; sem família = individual)
    const fam = ids.length ? await consultarTudo(`vw_est_ordem_familia?select=id,familia,e_individual,itens_finais,itens_com_fator,precisa_cortar&id=in.(${ids.join(',')})`).catch(() => []) : [];
    // o motivo de cada item final que o apontamento não confere (a ação é diferente para cada motivo)
    if (!PRD.semFator) PRD.semFator = await consultarTudo("vw_est_item_final_sem_fator?select=familia,item_final,situacao&situacao=neq.TEM FATOR&order=familia,item_final").catch(() => []);
    PRD.ordens = { rel, itens, contas: new Map(contas.map((c) => [c.id, c])), fam: new Map(fam.map((f) => [f.id, f])), sep: (PRD.ordens && PRD.ordens.sep) || {} };
  } catch (e) { PRD.ordens = { erro: e.message, rel: [], itens: [], contas: new Map(), sep: {} }; }
}
// 27/10/2026 (dono): relógio correndo em hh:mm:ss. O banco manda os segundos e se está correndo; a tela conta sozinha.
function prdHms(s) {
  if (s == null || !isFinite(s)) return '—';
  s = Math.max(0, Math.floor(s));
  return [Math.floor(s / 3600), Math.floor(s % 3600 / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
}
function prdRelSpan(seg, horas, correndo, t0) {
  const s = seg != null ? Number(seg) : (horas != null ? Math.round(Number(horas) * 3600) : null);
  return `<span class="prdRel" data-s="${s == null ? '' : s}" data-c="${correndo ? 1 : 0}" data-t0="${t0}">${prdHms(s)}</span>`;
}
function prdRelTique() {
  document.querySelectorAll('.prdRel').forEach((el) => {
    if (el.dataset.c !== '1' || el.dataset.s === '') return;
    el.textContent = prdHms(Number(el.dataset.s) + (Date.now() - Number(el.dataset.t0)) / 1000);
  });
}
if (!window.__prdRelTimer) window.__prdRelTimer = setInterval(prdRelTique, 1000);
function prdHoras(h) {
  if (h == null) return '—';
  const n = Number(h), hh = Math.floor(n), mm = Math.round((n - hh) * 60);
  return `${hh} h${mm ? ' ' + String(mm).padStart(2, '0') + ' min' : ''}`;
}
function prdOrdensHtml() {
  const O = PRD.ordens;
  if (!O) return '';
  if (O.erro) return `<div class="contexto" style="border-color:var(--amber-2);">Não consegui ler as ordens de produção agora: ${trEscH(O.erro)}</div>`;
  if (!O.rel.length) return `<div class="section-label">Ordens de produção</div>
    <div class="caption-label">Nenhuma ordem para este dia. A ordem nasce do plano fechado, em Planejar produção.</div>`;
  const dm = (s) => String(s || '').slice(8, 10) + '/' + String(s || '').slice(5, 7);
  // 27/10/2026 (dono): "Encerrar" — "fechar" confundia com fechar a tela. O passo no banco continua FECHAR.
  const BOT = { ABERTA: [['INICIAR', 'Iniciar']], EM_PRODUCAO: [['PAUSAR', 'Pausar'], ['FECHAR', 'Encerrar']],
                PAUSADA: [['RETOMAR', 'Retomar'], ['FECHAR', 'Encerrar']] };
  let h = `<div class="section-label">Ordens de produção</div>
    <div class="caption-label">O relógio grande conta só o tempo de produção (horas:minutos:segundos); a pausa e o tempo desde que abriu aparecem embaixo, separados.</div>
    <div id="prdOrdMsg" style="font-size:12.5px; margin:4px 0;"></div>`;
  O.rel.forEach((o) => {
    const c = O.contas.get(o.id) || {};
    const turno = /MAIS DE UM TURNO/.test(o.leitura || '');
    const leit = String(o.leitura || '').replace('ABERTA HA MAIS DE UM TURNO: fechar', 'aberta há mais de um turno: feche a ordem')
      .replace('AINDA NAO COMECOU', 'ainda não começou').replace('EM PRODUCAO', 'em produção')
      .replace('PAUSADA', 'pausada').replace('FECHADA', 'fechada').replace('CANCELADA', 'cancelada');
    const its = O.itens.filter((i) => i.id_ordem === o.id);
    const aberta = PRD.ordAberta === o.id;
    // 27/10/2026: a ordem em produção (ou pausada) aponta dela mesma — o apontamento nasce ligado à ordem
    const viva = o.situacao === 'EM_PRODUCAO' || o.situacao === 'PAUSADA';
    const campoO = 'background:var(--surface-2); border:1px solid var(--line); border-radius:8px; color:var(--tx-1); padding:5px 8px;';
    h += `<div class="contexto" style="text-align:left; margin:8px 0; ${turno ? 'border-color:var(--farol-fora);' : ''}">
      <div style="display:flex; flex-wrap:wrap; gap:14px; align-items:center; justify-content:space-between;">
        <div><b style="font-size:16px;">${trEscH(o.numero)}</b> ${prdOrdemFamiliaTag(o.id)} <span style="color:var(--tx-4);">· para ${dm(o.data_para)} · ${o.receitas} ${Number(o.receitas) === 1 ? 'receita' : 'receitas'}</span>${prdOrdemFamiliaNota(o.id)}
          <div style="font-size:12px; color:${turno ? 'var(--farol-fora)' : 'var(--tx-4)'}; ${turno ? 'font-weight:700;' : ''}">${leit}${o.quem_iniciou ? ` · iniciou ${trEscH(estNome(o.quem_iniciou))}` : ''}</div></div>
        <div style="text-align:right;">
          <div style="font-size:26px; font-weight:800; line-height:1; font-variant-numeric:tabular-nums; ${o.correndo ? 'color:var(--farol-ok);' : ''}" title="tempo de produção: desde que iniciou, menos as pausas">${prdRelSpan(o.segundos_producao, o.horas_de_producao, o.correndo, o._t0)}</div>
          <div style="font-size:11.5px; color:var(--tx-4); font-variant-numeric:tabular-nums;">produção${o.correndo ? ' (correndo)' : ''} · pausada <span style="${o.pausa_correndo ? 'color:var(--farol-perto); font-weight:700;' : ''}">${prdRelSpan(o.segundos_pausada_total, o.horas_pausada, o.pausa_correndo, o._t0)}</span> · desde que abriu ${prdRelSpan(o.segundos_desde_que_abriu, o.horas_desde_que_abriu, o.correndo || o.pausa_correndo, o._t0)}</div></div>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          ${(BOT[o.situacao] || []).map(([p, r]) => `<button class="preset-btn est-ciclo${p === 'FECHAR' ? '' : ' active'}" onclick="prdOrdemAndar(${o.id}, '${p}')">${r}</button>`).join('')}
          ${o.situacao === 'ABERTA' ? `<button class="preset-btn" onclick="prdOrdemCancelar(${o.id})" title="tira a ordem da separação; o motivo fica registrado">Cancelar</button>` : ''}
        </div></div>
      <div id="tabelaPrdOrd${o.id}" style="overflow-x:auto; margin-top:8px;"><table><thead><tr><th>Receita</th><th>A ordem manda</th><th>Já apontado</th><th>Falta apontar</th><th>Perda</th><th>Situação</th>${viva ? '<th title="quanto saiu pronto agora">Saiu agora</th><th title="só se houve perda: quanto e o motivo">Perdeu</th>' : ''}</tr></thead><tbody>
        ${its.map((i, k) => `<tr><td>${trEscH(i.nome_base)}${i.familia && i.familia !== 'NENHUMA' ? ` <span style="color:var(--tx-5); font-size:11px;">família ${trEscH(i.familia)}</span>` : ''}</td>
          <td>${fmt(Number(i.qtd))} ${trEscH(i.un || '')}</td><td>${fmt(Number(i.ja_apontado || 0))}</td>
          <td style="font-weight:700;">${fmt(Number(i.falta_apontar || 0))}</td><td>${Number(i.perda_apontada) ? fmt(Number(i.perda_apontada)) : '—'}</td>
          <td style="font-size:12px; color:${i.leitura === 'APONTADO' ? 'var(--farol-ok)' : i.leitura === 'APONTADO EM PARTE' ? 'var(--farol-perto)' : 'var(--tx-4)'};">${String(i.leitura || '').toLowerCase().replace('nao', 'não')}</td>
          ${viva ? `<td style="white-space:nowrap;"><input id="prdOq_${o.id}_${k}" type="number" step="0.001" min="0" inputmode="decimal" placeholder="${Number(i.falta_apontar) > 0 ? fmt(Number(i.falta_apontar)) : ''}" style="width:84px; ${campoO}"> <span style="color:var(--tx-4); font-size:11px;">${trEscH(i.un || '')}</span></td>
          <td style="white-space:nowrap;"><input id="prdOp_${o.id}_${k}" type="number" step="0.001" min="0" inputmode="decimal" placeholder="0" style="width:64px; ${campoO}"> ${prdMotivoSelect(`prdOm_${o.id}_${k}`, null)}</td>` : ''}</tr>`).join('')
          || `<tr><td colspan="${viva ? 8 : 6}">—</td></tr>`}
      </tbody></table></div>
      ${viva && its.length ? `<div style="margin-top:6px; display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
        <button class="preset-btn active est-ciclo" onclick="prdOrdemRegistrar(${o.id})">Registrar o que saiu</button>
        <span class="caption-label" style="text-align:left;">Anote quanto saiu de cada receita. Pode registrar aos poucos; o <b>Encerrar</b> grava o que estiver preenchido e fecha a ordem.</span></div>` : ''}
      <div style="margin-top:6px; display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
        <button class="preset-btn" onclick="prdOrdemSep(${o.id})">${aberta ? 'Esconder a separação' : 'Ver a separação'}</button>
        <span style="font-size:12px; color:${Number(c.ingredientes_faltando) ? 'var(--farol-perto)' : 'var(--tx-4)'};">${c.ingredientes == null ? '' : `${c.ingredientes} ${Number(c.ingredientes) === 1 ? 'ingrediente' : 'ingredientes'}${Number(c.ingredientes_faltando) ? `, ${c.ingredientes_faltando} sem o suficiente no estoque` : ', todos com saldo'}`}</span></div>
      ${aberta ? prdOrdemSepHtml(o) : ''}
    </div>`;
  });
  return h;
}
const PRD_SEP_ORDEM = { 'SALDO NEGATIVO: conferir o registro': 0, 'SEM SALDO NO ESTOQUE': 1, 'ZERADO': 2, 'TEM MENOS DO QUE PRECISA': 3, 'TEM': 4 };
function prdSepCor(s) {
  return /NEGATIVO/.test(s) ? 'var(--amber-2)' : s === 'TEM' ? 'var(--farol-ok)' : 'var(--farol-perto)';
}
function prdSepTexto(s) {
  return ({ 'SALDO NEGATIVO: conferir o registro': 'saldo negativo: o registro está devendo, confira',
            'SEM SALDO NO ESTOQUE': 'sem saldo no estoque', 'ZERADO': 'zerado',
            'TEM MENOS DO QUE PRECISA': 'tem menos do que precisa', 'TEM': 'tem' })[s] || String(s || '').toLowerCase();
}
function prdOrdemSepHtml(o) {
  const sep = PRD.ordens.sep[o.id];
  if (!sep) return `<div class="caption-label" style="text-align:left;">carregando a separação…</div>`;
  if (sep.erro) return `<div class="caption-label" style="text-align:left; color:var(--farol-fora);">${trEscH(sep.erro)}</div>`;
  const l = sep.slice().sort((a, b) => (a.etapa === 'CORTE' ? 0 : 1) - (b.etapa === 'CORTE' ? 0 : 1) || (PRD_SEP_ORDEM[a.situacao] ?? 9) - (PRD_SEP_ORDEM[b.situacao] ?? 9) || a.nome_base.localeCompare(b.nome_base, 'pt-BR'));
  const custo = l.reduce((s, x) => s + (Number(x.custo) || 0), 0);
  const temCorte = l.some((x) => x.etapa === 'CORTE');
  const sub = (txt) => `<tr class="sub"><td colspan="7" style="font-weight:800; letter-spacing:.5px;">${txt}</td></tr>`;
  return `<div class="caption-label" style="text-align:left; margin-top:8px;">Uma linha por ingrediente, somando todas as receitas da família${temCorte ? '; o que passa pelo corte vem primeiro' : ''}.
      ${l.length} ${l.length === 1 ? 'item' : 'itens'} · R$ ${fmt(custo)}.
      <button class="preset-btn" onclick="prdOrdemImprimir(${o.id})">🖨️ Imprimir a separação</button></div>
    <div id="tabelaPrdSep${o.id}" style="overflow-x:auto;"><table><thead><tr><th>Ingrediente</th><th>Precisa</th><th>Tem no estoque</th><th>Falta</th><th>Custo</th><th>Situação</th><th>Para as receitas</th></tr></thead><tbody>
      ${l.map((s, k) => `${temCorte && (k === 0 || (l[k - 1].etapa === 'CORTE') !== (s.etapa === 'CORTE')) ? sub(s.etapa === 'CORTE' ? 'ANTES: O CORTE DA PROTEÍNA' : 'O RESTO DA FAMÍLIA') : ''}<tr><td>${trEscH(s.nome_base)}</td><td style="font-weight:700;">${fmt(Number(s.qtd_precisa))} ${trEscH(s.un || '')}</td>
        <td style="${Number(s.saldo) < 0 ? 'color:var(--amber-2);' : ''}">${fmt(Number(s.saldo))}</td><td>${Number(s.falta) ? fmt(Number(s.falta)) : '—'}</td>
        <td>R$ ${fmt(Number(s.custo) || 0)}</td><td style="font-size:12px; color:${prdSepCor(s.situacao)}; white-space:normal;">${prdSepTexto(s.situacao)}</td>
        <td style="font-size:11.5px; color:var(--tx-4); white-space:normal;">${trEscH(s.vem_de || '')}</td></tr>`).join('')}
    </tbody></table></div>`;
}
// 26/10/2026: a família da ordem (vw_est_ordem_familia) — etiqueta no título e o aviso do que o apontamento não confere
function prdOrdemFamiliaTag(id) {
  const f = PRD.ordens && PRD.ordens.fam && PRD.ordens.fam.get(id);
  if (!f) return '';
  return `<span style="font-size:12px; border:1px solid var(--line-2); border-radius:10px; padding:1px 8px; color:var(--tx-2);">${f.e_individual ? 'individual' : 'família ' + trEscH(String(f.familia || '').toLowerCase())}</span>`;
}
function prdOrdemFamiliaNota(id) {
  const f = PRD.ordens && PRD.ordens.fam && PRD.ordens.fam.get(id);
  if (!f) return '';
  const partes = [];
  if (f.precisa_cortar) partes.push(`antes: cortar ${trEscH(String(f.precisa_cortar).toLowerCase())}`);
  const MOT = (s) => /SEM RECEITA AMARRADA/.test(s) ? 'espera decisão do dono (corte porcionado)'
    : /NAO TEM UNIDADE/.test(s) ? 'sem linha de estoque' : /SEM FATOR/.test(s) ? 'falta medir quantas peças saem' : String(s || '').toLowerCase();
  const sem = (PRD.semFator || []).filter((x) => x.familia === f.familia);
  const lista = sem.length ? `<div style="font-size:12px; color:var(--tx-4);">O apontamento não confere: ${sem.map((x) => `${trEscH(x.item_final)} <span style="color:var(--tx-5);">(${MOT(x.situacao)})</span>`).join(' · ')}</div>` : '';
  return (partes.length ? `<div style="font-size:12px; color:var(--tx-3);">${partes.join(' · ')}</div>` : '') + lista;
}
async function prdOrdemSep(id) {
  PRD.ordAberta = PRD.ordAberta === id ? null : id;
  prdRender();
  if (PRD.ordAberta && !PRD.ordens.sep[id]) {
    try { PRD.ordens.sep[id] = await consultarTudo(`vw_est_ordem_separacao?select=*&id_ordem=eq.${id}`); }
    catch (e) { PRD.ordens.sep[id] = { erro: 'Não consegui ler a separação: ' + e.message }; }
    prdRender();
  }
}
function prdOrdemAvisa(t, cor) {
  const m = document.getElementById('prdOrdMsg');
  if (m) { m.textContent = t; m.style.color = cor; }
}
async function prdOrdemAndar(id, passo) {
  const o = (PRD.ordens.rel || []).find((x) => x.id === id) || {};
  let motivo = null;
  if (passo === 'PAUSAR') {
    motivo = prompt(`Por que pausar a ${o.numero || 'ordem'}? (fica registrado)`);
    if (motivo === null) return;
    motivo = motivo.trim() || null;
  }
  // 27/10/2026 (dono): o Encerrar leva ao apontamento final — grava o que estiver preenchido e só então encerra
  if (passo === 'FECHAR') {
    const its = (PRD.ordens.itens || []).filter((i) => i.id_ordem === id);
    const preenchidos = its.filter((i, k) => ((document.getElementById(`prdOq_${id}_${k}`) || {}).value || '') !== '').length;
    const jaTem = its.some((i) => Number(i.ja_apontado) > 0);
    if (!preenchidos && !jaTem) {
      prdOrdemAvisa(`Antes de encerrar a ${o.numero || 'ordem'}, anote em "Saiu agora" quanto saiu de cada receita (ou cancele a ordem, se nada foi produzido).`, 'var(--farol-perto)');
      const c0 = document.getElementById(`prdOq_${id}_0`); if (c0) { c0.scrollIntoView({ block: 'center' }); c0.focus(); }
      return;
    }
    const faltam = its.filter((i, k) => Number(i.falta_apontar) > 0 && ((document.getElementById(`prdOq_${id}_${k}`) || {}).value || '') === '').map((i) => i.nome_base);
    if (!confirm(`Encerrar a ${o.numero || 'ordem'}?${preenchidos ? `\n\nVou registrar o que saiu de ${preenchidos} ${preenchidos === 1 ? 'receita' : 'receitas'} e parar o relógio.` : ' O relógio para aqui.'}${faltam.length ? `\n\nFica sem registro: ${faltam.join(', ')}.` : ''}`)) return;
  }
  if (!estTravar(true)) return;
  let r;
  try {
    if (passo === 'FECHAR') {
      const n = await prdOrdemGravarCampos(id);
      if (n == null) return;
    }
    r = await trRpc('est_ordem_andar', { p_id: id, p_passo: passo, p_quem: ((rmbSessao() || {}).email || ''), p_motivo: motivo });
  } catch (e) { return prdOrdemAvisa('Não consegui registrar: ' + e.message, 'var(--farol-fora)'); }
  finally { estTravar(false); }
  if (!r.ok) return prdOrdemAvisa(await trErroDe(r), 'var(--farol-fora)');
  await prdOrdensCarregar();
  prdRender();
}
// 27/10/2026: lê os campos da ordem e grava cada receita preenchida em est_producao com id_ordem. Devolve quantas gravou,
// ou null se algum campo estava errado (o aviso já foi dado).
async function prdOrdemGravarCampos(id) {
  const its = (PRD.ordens.itens || []).filter((i) => i.id_ordem === id);
  const num = (k) => { const v = (document.getElementById(k) || {}).value; return v === '' || v == null ? null : Number(String(v).replace(',', '.')); };
  const linhas = [];
  for (let k = 0; k < its.length; k++) {
    const i = its[k];
    const qtd = num(`prdOq_${id}_${k}`), perda = num(`prdOp_${id}_${k}`);
    const motivo = (document.getElementById(`prdOm_${id}_${k}`) || {}).value || null;
    if (qtd == null && !(perda > 0)) continue;
    if (!(qtd > 0)) { alert(`${i.nome_base}: digite quanto saiu pronto (maior que zero).`); return null; }
    if (perda != null && (perda < 0 || perda > qtd)) { alert(`${i.nome_base}: a perda vai de zero até o que foi produzido.`); return null; }
    if (perda > 0 && !motivo) { alert(`${i.nome_base}: escolha o motivo da perda.`); return null; }
    const r = (PRD.receitas || []).find((x) => x.nome_base === i.nome_base);
    if (!r) { alert(`${i.nome_base}: não achei a receita desta loja para registrar.`); return null; }
    linhas.push({ p_unidade: PRD.unidade, p_data: PRD.data, p_receita: r.receita, p_qtd: qtd, p_un: i.un || r.un || null,
                  p_quem: (rmbSessao() || {}).email || null, p_perda: perda > 0 ? perda : null, p_perda_motivo: perda > 0 ? motivo : null,
                  p_planejado: Number(i.qtd) || null, p_id_ordem: id });
  }
  // pela função est_apontar (o vínculo com a ordem, a trava de clique duplo e a mensagem em português moram nela)
  let n = 0;
  for (const l of linhas) {
    const r = await trRpc('est_apontar', l);
    if (!r.ok) throw new Error(`${(its.find((i) => (PRD.receitas || []).some((x) => x.receita === l.p_receita && x.nome_base === i.nome_base)) || {}).nome_base || l.p_receita}: ${await trErroDe(r)}` + (n ? ` (${n} já ficaram registradas)` : ''));
    n++;
  }
  return n;
}
async function prdOrdemRegistrar(id) {
  if (!estTravar(true)) return;
  let n;
  try { n = await prdOrdemGravarCampos(id); }
  catch (e) { estTravar(false); return prdOrdemAvisa('Não consegui registrar: ' + e.message, 'var(--farol-fora)'); }
  estTravar(false);
  if (n == null) return;
  if (!n) return prdOrdemAvisa('Nada preenchido: anote quanto saiu de cada receita na tabela da ordem.', 'var(--farol-perto)');
  await prdCarregar();
  prdOrdemAvisa(`✓ ${n} ${n === 1 ? 'receita registrada' : 'receitas registradas'} na ordem.`, 'var(--farol-ok)');
}
async function prdOrdemCancelar(id) {
  const o = (PRD.ordens.rel || []).find((x) => x.id === id) || {};
  const motivo = (prompt(`Cancelar a ${o.numero || 'ordem'}? Ela sai da separação e o motivo fica registrado.\n\nMotivo:`) || '').trim();
  if (!motivo) return;
  const r = await trRpc('est_ordem_cancelar', { p_id: id, p_motivo: motivo });
  if (!r.ok) return prdOrdemAvisa(await trErroDe(r), 'var(--farol-fora)');
  await prdOrdensCarregar();
  prdRender();
}
// a folha para levar à câmara: o número da OP no cabeçalho, uma linha por ingrediente, caixa em branco para o que foi pesado
function prdOrdemImprimir(id) {
  const o = (PRD.ordens.rel || []).find((x) => x.id === id) || {};
  const sep = (PRD.ordens.sep[id] || []).slice().sort((a, b) => (a.etapa === 'CORTE' ? 0 : 1) - (b.etapa === 'CORTE' ? 0 : 1) || (PRD_SEP_ORDEM[a.situacao] ?? 9) - (PRD_SEP_ORDEM[b.situacao] ?? 9) || a.nome_base.localeCompare(b.nome_base, 'pt-BR'));
  const famO = (PRD.ordens.fam && PRD.ordens.fam.get(id)) || {};
  const its = (PRD.ordens.itens || []).filter((i) => i.id_ordem === id);
  const w = window.open('', '_blank');
  if (!w) { alert('O navegador bloqueou a janela de impressão — libere pop-ups para este site.'); return; }
  const dm = (s) => String(s || '').slice(8, 10) + '/' + String(s || '').slice(5, 7);
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${o.numero} — separação</title><style>
    body { font-family:Arial, sans-serif; color:#000; margin:18px 24px; }
    .cab { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #000; padding-bottom:6px; }
    h1 { font-size:18px; margin:0; } .cod { font-size:26px; font-weight:bold; letter-spacing:1px; }
    .sub { font-size:11.5px; color:#45443f; margin:3px 0 0; } .assina { font-size:12px; margin:10px 0 0; }
    .assina span { display:inline-block; border-bottom:1px solid #000; width:190px; margin:0 18px 0 4px; }
    table { width:100%; border-collapse:collapse; margin-top:10px; } td, th { border-bottom:1px solid #bbb; padding:5px 6px; font-size:12.5px; text-align:left; }
    th { font-size:10px; text-transform:uppercase; color:#45443f; } .q { width:92px; text-align:right; font-weight:bold; }
    .box { width:96px; border:1px solid #000 !important; height:26px; } .neg { font-weight:bold; }
    @media print { body { margin:10px 14px; } }
  </style></head><body>
    <div class="cab"><div><h1>Separação da ordem — ${PRD.unidade}${famO.familia ? ' · família ' + famO.familia : famO.e_individual ? ' · individual' : ''}</h1>
      <p class="sub">Produção de ${dm(o.data_para)} · ${sep.length} ${sep.length === 1 ? 'item' : 'itens'} · impressa em ${new Date().toLocaleString('pt-BR')}</p>
      <p class="sub"><b>A ordem:</b> ${its.map((i) => `${i.nome_base} ${fmt(Number(i.qtd))} ${i.un || ''}`).join(' · ')}</p>
      <p class="assina">Separou:<span></span>Conferiu:<span></span></p></div><div class="cod">${o.numero}</div></div>
    <table><thead><tr><th>#</th><th>Ingrediente</th><th class="q">Precisa</th><th class="q">Tem</th><th>Situação</th><th>Separado de verdade</th></tr></thead><tbody>
    ${sep.map((s, k) => `<tr><td>${k + 1}</td><td>${s.etapa === 'CORTE' ? '<b>[corte]</b> ' : ''}${s.nome_base}</td><td class="q">${fmt(Number(s.qtd_precisa))} ${s.un || ''}</td>
      <td class="q">${fmt(Number(s.saldo))}</td><td class="${/NEGATIVO/.test(s.situacao) ? 'neg' : ''}">${prdSepTexto(s.situacao)}</td><td class="box"></td></tr>`).join('')}
    </tbody></table></body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 300);
}

async function prdVer(receita) {
  PRD.aberta = PRD.aberta === receita ? null : receita;
  prdRender();
  if (PRD.aberta && !PRD.ingredientes[receita]) {
    PRD.ingredientes[receita] = await consultarTudo(
      `vw_est_producao_ingrediente?select=*&receita=eq.${encodeURIComponent(receita)}&order=custo_un.desc`);
    prdRender();
  }
}

async function prdApontar(receita, un) {
  const campo = document.getElementById(prdId(receita));
  const qtd = Number((campo.value || '').replace(',', '.'));
  if (!campo.value || !isFinite(qtd) || qtd <= 0) { alert('Digite quanto saiu pronto, em número maior que zero.'); campo.focus(); return; }
  const r = PRD.receitas.find((x) => x.receita === receita) || {};
  if (r.rendimento && qtd > Number(r.rendimento) * 10
      && !confirm(`${fmt(qtd)} ${un || ''} é ${Math.round(qtd / Number(r.rendimento))} vezes o lote da ficha (${fmt(r.rendimento)}). Confirma?`)) return;
  // 21/10/2026: perda (opcional, com motivo, ate o produzido) e o planejado do lote
  const val = (sufixo) => { const el = document.getElementById(prdId(receita) + sufixo); return el && el.value !== '' ? Number(String(el.value).replace(',', '.')) : null; };
  const perda = val('_p'), planejado = val('_pl');
  const motivo = (document.getElementById(prdId(receita) + '_m') || {}).value || null;
  if (perda != null && (!isFinite(perda) || perda < 0 || perda > qtd)) { alert('A perda vai de zero até o que foi produzido.'); return; }
  if (perda > 0 && !motivo) { alert('Escolha o motivo da perda.'); return; }
  if (planejado != null && !(planejado > 0)) { alert('O planejado tem de ser maior que zero (ou deixe em branco).'); return; }
  const s = rmbSessao();
  try {
    await prdFetch('est_producao', {
      method: 'POST', extra: { Prefer: 'return=minimal' },
      body: JSON.stringify({ unidade: PRD.unidade, data: PRD.data, receita, qtd, un: un || null, quem: s.email,
                             perda: perda > 0 ? perda : null, perda_motivo: perda > 0 ? motivo : null, planejado }),
    });
    campo.value = '';
    await prdCarregar();
  } catch (e) { alert('Não consegui gravar o apontamento: ' + e.message); }
}

const PRD_MOTIVOS = [['QUEIMOU', 'queimou'], ['SOBROU', 'sobrou'], ['CAIU', 'caiu'], ['DEVOLUCAO', 'devolução'],
                     ['VALIDADE', 'validade'], ['ERRO DE RECEITA', 'erro de receita'], ['OUTRO', 'outro']];   // a lista do banco
function prdMotivoSelect(id, atual) {
  return `<select id="${id}" style="background:var(--surface-2); border:1px solid var(--line); border-radius:8px; color:var(--tx-1); padding:6px 8px;"><option value="">motivo</option>${PRD_MOTIVOS.map(([v, r]) =>
    `<option value="${v}"${v === atual ? ' selected' : ''}>${r}</option>`).join('')}</select>`;
}
function prdCorrigirAbrir(id) { PRD.corrigindo = PRD.corrigindo === id ? null : id; prdRender(); }
async function prdCorrigirGravar(id) {
  const l = (PRD.lancamentos || []).find((x) => x.id === id);
  if (!l) return;
  const num = (k) => { const v = (document.getElementById(k) || {}).value; return v === '' || v == null ? null : Number(String(v).replace(',', '.')); };
  const qtd = num('prdC_q'), perda = num('prdC_p');
  const motivo = (document.getElementById('prdC_m') || {}).value || null;
  const porque = ((document.getElementById('prdC_o') || {}).value || '').trim();
  if (!(qtd > 0)) { alert('Produziu tem de ser maior que zero.'); return; }
  if (perda != null && (perda < 0 || perda > qtd)) { alert('A perda vai de zero até o que foi produzido.'); return; }
  if (perda > 0 && !motivo) { alert('Escolha o motivo da perda.'); return; }
  if (!porque) { alert('Escreva por que está corrigindo.'); return; }
  if (!confirm(`Corrigir a linha ${id}: produziu ${fmt(qtd)}${perda > 0 ? `, perdeu ${fmt(perda)}` : ''}?\nA linha original sai do saldo e fica guardada.`)) return;
  try {
    await prdFetch('est_producao', { method: 'POST', extra: { Prefer: 'return=minimal' },
      body: JSON.stringify({ unidade: PRD.unidade, data: l.data, receita: l.receita, qtd, un: l.un || null,
        quem: (rmbSessao() || {}).email, perda: perda > 0 ? perda : null, perda_motivo: perda > 0 ? motivo : null,
        planejado: l.planejado == null ? null : Number(l.planejado), corrige_id: id, observacao: 'correção: ' + porque }) });
    PRD.corrigindo = null;
    await prdCarregar();
  } catch (e) { alert('Não consegui gravar a correção: ' + e.message); }
}

// ---- PERDA FORA DA PRODUÇÃO (24/10/2026; dono, 08/10: o desperdício vem do apontamento da cozinha) ----
// O que estragou, venceu, caiu ou voltou do salão sem ser de um lote. Só pela função est_perder: ela confere o motivo
// (a lista fechada, a mesma da perda de lote) e põe a praça de quem registra. Corrigir é linha nova (p_corrige_id).
function prdPerdaHtml() {
  const campo = 'background:var(--surface-2); border:1px solid var(--line); border-radius:8px; color:var(--tx-1); padding:6px 8px;';
  const hoje = prdHoje();
  let h = `<div class="section-label">Perda fora da produção</div>
    <div class="caption-label">O que estragou, venceu, caiu ou voltou do salão e não é de um lote (perda de lote vai na coluna Perdeu, acima).
      Sai do estoque pelo custo de hoje.</div>`;
  if (PRD.perdas === null) return h + `<div class="contexto">A perda ainda não está disponível no banco.</div>`;
  const itens = PRD.itensEst || [];
  h += `<datalist id="prdPerdaItens">${itens.filter((i) => !i.fora_da_base).map((i) => `<option value="${trEscH(i.nome_base)}">`).join('')}</datalist>
    <div class="contexto" style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; text-align:left;">
      <input id="prdPerdaItem" list="prdPerdaItens" placeholder="item (nome da base)" oninput="prdPerdaUn()" style="flex:1 1 220px; ${campo}">
      <input id="prdPerdaQtd" type="number" step="0.001" min="0" inputmode="decimal" placeholder="quanto" style="width:90px; ${campo}">
      <span id="prdPerdaUn" style="color:var(--tx-4); min-width:24px;"></span>
      ${prdMotivoSelect('prdPerdaMotivo', null)}
      <input id="prdPerdaObs" placeholder="observação (opcional)" style="flex:1 1 160px; ${campo}">
      <button class="preset-btn" onclick="prdPerdaGravar()">Registrar perda</button>
      ${PRD.data !== hoje ? `<span style="color:var(--tx-5); font-size:12px;">registra em hoje (${hoje.split('-').reverse().join('/')})</span>` : ''}
    </div>`;
  const ps = PRD.perdas || [];
  if (!ps.length) return h + `<div class="caption-label">Nenhuma perda fora da produção ${PRD.data === hoje ? 'hoje' : 'neste dia'}.</div>`;
  const tot = ps.filter((p) => !p.foi_corrigida).reduce((s, p) => s + Number(p.custo || 0), 0);
  h += `<div id="tabelaPrdPerda" style="overflow-x:auto;"><table><thead><tr><th>Item</th><th>Quanto</th><th>Motivo</th><th>Custo</th>
      <th>Estoque</th><th>Quem</th><th></th></tr></thead><tbody>`;
  ps.forEach((p) => {
    const risca = p.foi_corrigida ? ' style="opacity:.5; text-decoration:line-through;"' : '';
    const baixou = /^BAIXOU/.test(p.leitura || '');
    const pode = !p.foi_corrigida && !p.corrige_id;
    h += `<tr${risca}><td>${trEscH(p.nome_base || p.item)}${p.corrige_id ? ` <span style="color:var(--tx-5); font-size:11px;">correção da linha ${p.corrige_id}</span>` : ''}${p.observacao ? ` <span style="color:var(--tx-5);">· ${trEscH(p.observacao)}</span>` : ''}</td>
      <td style="white-space:nowrap;">${fmt(Number(p.qtd))} ${trEscH(p.un || '')}</td>
      <td>${trEscH(((PRD_MOTIVOS.find(([v]) => v === p.motivo) || [p.motivo, p.motivo])[1]) || '')}</td>
      <td style="white-space:nowrap;">${p.custo == null ? '—' : 'R$ ' + fmt(Number(p.custo))}</td>
      <td style="color:${p.foi_corrigida ? 'var(--tx-5)' : baixou ? 'var(--tx-2)' : 'var(--farol-perto)'}; font-size:12px;">${trEscH((p.leitura || '').toLowerCase())}</td>
      <td style="color:var(--tx-5);">${trEscH(estNome(p.quem))}</td>
      <td>${pode ? `<button class="preset-btn" onclick="PRD.perdaCorrigindo=PRD.perdaCorrigindo===${Number(p.id)}?null:${Number(p.id)}; prdRender();">corrigir</button>` : ''}</td></tr>`;
    if (PRD.perdaCorrigindo === p.id) {
      h += `<tr><td colspan="7" style="background:var(--surface-2);"><div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
        <b>Corrigir:</b> quanto <input type="number" step="0.001" min="0" inputmode="decimal" id="prdPC_q" value="${Number(p.qtd)}" style="width:100px; ${campo}">
        ${prdMotivoSelect('prdPC_m', p.motivo)}
        <input id="prdPC_o" placeholder="por que corrigir (obrigatório)" style="flex:1 1 180px; ${campo}">
        <button class="preset-btn" onclick="prdPerdaCorrigir(${Number(p.id)})">gravar correção</button>
        <button class="preset-btn" onclick="PRD.perdaCorrigindo=null; prdRender();">cancelar</button></div>
        <div class="caption-label" style="text-align:left; margin-top:4px;">A linha original fica guardada e sai da conta; a correção entra no lugar dela. Cada perda só se corrige uma vez.</div></td></tr>`;
    }
  });
  h += `<tr class="liq"><td colspan="3"><b>Total do dia</b></td><td><b>R$ ${fmt(tot)}</b></td><td colspan="3"></td></tr></tbody></table></div>`;
  return h;
}
function prdPerdaUn() {
  const nome = ((document.getElementById('prdPerdaItem') || {}).value || '').trim();
  const it = (PRD.itensEst || []).find((i) => i.nome_base === nome);
  const el = document.getElementById('prdPerdaUn');
  if (el) el.textContent = it ? (it.un || '') : '';
}
async function prdPerdaGravar() {
  const v = (id) => ((document.getElementById(id) || {}).value || '').trim();
  const item = v('prdPerdaItem'), motivo = v('prdPerdaMotivo'), obs = v('prdPerdaObs');
  const qtd = Number(v('prdPerdaQtd').replace(',', '.'));
  const it = (PRD.itensEst || []).find((i) => i.nome_base === item);
  if (!it) { alert('Escolha o item na lista (o nome da base).'); return; }
  if (!(qtd > 0)) { alert('Digite quanto se perdeu, em número maior que zero.'); return; }
  if (!motivo) { alert('Escolha o motivo da perda.'); return; }
  if (!confirm(`Registrar a perda de ${fmt(qtd)} ${it.un || ''} de ${item} (${motivo.toLowerCase()})?`)) return;
  const r = await trRpc('est_perder', { p_unidade: PRD.unidade, p_item: item, p_qtd: qtd, p_motivo: motivo, p_un: it.un || null,
    p_quem: (rmbSessao() || {}).email || null, p_observacao: obs || null });
  if (!r.ok) { alert('Não consegui registrar a perda: ' + await trErroDe(r)); return; }
  await prdCarregar();
}
async function prdPerdaCorrigir(id) {
  const p = (PRD.perdas || []).find((x) => x.id === id);
  if (!p) return;
  const qtd = Number(((document.getElementById('prdPC_q') || {}).value || '').replace(',', '.'));
  const motivo = (document.getElementById('prdPC_m') || {}).value || '';
  const porque = ((document.getElementById('prdPC_o') || {}).value || '').trim();
  if (!(qtd > 0)) { alert('Quanto tem de ser maior que zero.'); return; }
  if (!motivo) { alert('Escolha o motivo da perda.'); return; }
  if (!porque) { alert('Escreva por que está corrigindo.'); return; }
  if (!confirm(`Corrigir a perda ${id}: ${fmt(qtd)} ${p.un || ''} de ${p.item}?\nA linha original sai da conta e fica guardada.`)) return;
  const r = await trRpc('est_perder', { p_unidade: p.unidade, p_item: p.item, p_qtd: qtd, p_motivo: motivo, p_un: p.un || null,
    p_quem: (rmbSessao() || {}).email || null, p_observacao: 'correção: ' + porque, p_corrige_id: id });
  if (!r.ok) { alert('Não consegui gravar a correção: ' + await trErroDe(r)); return; }
  PRD.perdaCorrigindo = null;
  await prdCarregar();
}

async function prdDesfazer(id) {
  if (!confirm('Desfazer este apontamento?')) return;
  try {
    await prdFetch(`est_producao?id=eq.${id}`, { method: 'DELETE', extra: { Prefer: 'return=minimal' } });
    await prdCarregar();
  } catch (e) { alert('Não consegui desfazer: ' + e.message); }
}

