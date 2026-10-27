// Telas que JÁ SAÍRAM do docs/dashboard.html para uma página própria (14/10/2026).
//
// A casca (docs/sistema.html) abre toda tela do menu dentro do painel antigo, a não ser
// que ela esteja aqui: aí abre a página nova numa moldura própria, sem carregar o painel.
// Cada bloco que for separado (ordem no mapa de contexto/project_painel_em_modulos.md)
// entra com uma linha, por exemplo:
//     listas: 'listas/index.html',
// O endereço é relativo a docs/. A tela continua no menu do painel com o mesmo nome:
// quem decide se ela sai do menu é o dono, item a item.
window.CASCA_PAGINAS = {
  // 24/10/2026 (bloco 1): as Listas abrem na página delas, sem a carga de vendas do painel
  listas: 'listas/index.html#pedidos',
  listasfin: 'listas/index.html#financeiro',
  // 24/10/2026 (bloco 2): Produção e estoque
  contagem: 'estoque/index.html#contagem',
  plprod: 'estoque/index.html#plprod',
  // 27/10/2026 (dono): o ciclo em quatro telas
  separacao: 'estoque/index.html#separacao',
  ordens: 'estoque/index.html#ordens',
  producao: 'estoque/index.html#producao',
  controle: 'estoque/index.html#controle',
  posicao: 'estoque/index.html#posicao',
  // 26/10/2026 (bloco 3): Fechamento de Caixas
  caixa: 'caixa/index.html#caixa',
  // 26/10/2026 (bloco 4): Pessoas
  cargos: 'pessoas/index.html#cargos',
  forafolha: 'pessoas/index.html#forafolha',
  rh: 'pessoas/index.html#rh',
  flash: 'pessoas/index.html#flash',
  reembolsos: 'pessoas/index.html#reembolsos',
  // 26/10/2026 (bloco 5): Custo e cardápio (Desempenho do cardápio e Promoções seguem no painel antigo)
  fichas: 'cardapio/index.html#fichas',
  engcard: 'cardapio/index.html#engcard',
  rateio: 'cardapio/index.html#rateio',
};
