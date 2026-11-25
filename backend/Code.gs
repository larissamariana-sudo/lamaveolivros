/** LAMAVEO – backend (Google Apps Script) ligado à planilha. Veja o passo a passo no chat. */
const TAXA = 0.12;   // taxa única (já inclui pagamento, hospedagem, custos). Autor recebe 88%
const DIAS_REPASSE = 10;
const EDITORA = 'editora@lamaveo.com.br';
const COLS = {
  Livros:['id','titulo','autor','autor_email','categoria','formato','preco','estoque','ativo','status','capa_url','arquivo_id','descricao','isbn','aceite_em'],
  Pedidos:['id','data','nome','email','endereco','cep','itens','total','status','mp_id','rastreio','frete','servico'],
  Repasses:['id','pedido','data','libera_em','autor_email','livro','bruto','taxa_12pct','liquido_88pct','pago']
};
const prop = k => PropertiesService.getScriptProperties().getProperty(k);
const aba = n => SpreadsheetApp.getActive().getSheetByName(n);
const out = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
const add = (n, o) => aba(n).appendRow(COLS[n].map(k => o[k] === undefined ? '' : o[k]));
const rows = n => { const v = aba(n).getDataRange().getValues(), h = v.shift();
  return v.map((r, i) => { const o = {_l: i + 2}; h.forEach((k, j) => o[k] = r[j]); return o; }); };
const col = (n, k) => COLS[n].indexOf(k) + 1;

function setup() { // rode UMA vez
  const ss = SpreadsheetApp.getActive();
  for (const n in COLS) { const s = aba(n) || ss.insertSheet(n);
    s.getRange(1, 1, 1, COLS[n].length).setValues([COLS[n]]).setFontWeight('bold'); s.setFrozenRows(1); }
  PropertiesService.getScriptProperties().setProperty('PASTA', DriveApp.createFolder('Lamaveo – arquivos').getId());
}

function doGet(e) {
  const a = e.parameter.action;
  if (a === 'livros') return out(rows('Livros').filter(l => l.ativo === true && l.status === 'aprovado')
    .map(l => ({id: l.id, titulo: l.titulo, autor: l.autor, categoria: l.categoria, formato: l.formato,
      preco: l.preco, estoque: l.formato === 'fisico' ? l.estoque : null, img: l.capa_url})));
  if (a === 'rastreio') { const p = rows('Pedidos').find(p => p.id === e.parameter.id &&
      String(p.email).toLowerCase() === String(e.parameter.email).toLowerCase());
    return out(p ? {status: p.status, rastreio: p.rastreio} : {erro: 'Pedido não encontrado'}); }
  return out({ok: 1});
}

function doPost(e) {
  try {
    const d = e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    if (d.action === 'submeter') return out(submeter(d));
    if (d.action === 'checkout') return out(checkout(d));
    if (d.action === 'frete') return out(frete(d));
    if (String(d.action).indexOf('admin_') === 0) return out(admin(d));
    if (d.type === 'payment' || e.parameter.topic === 'payment')
      return out(webhook((d.data && d.data.id) || e.parameter.id || e.parameter['data.id']));
    return out({erro: 'Ação inválida'});
  } catch (err) { return out({erro: String(err)}); }
}

// Autor envia ebook/epub: vai para o Drive e fica "pendente" até você aprovar na planilha
function submeter(d) {
  if (!d.aceite) return {erro: 'É preciso aceitar os termos de autoria.'};
  const isbn = String(d.isbn || '').replace(/[^0-9Xx]/g, '');
  if (isbn.length !== 10 && isbn.length !== 13) return {erro: 'Informe um ISBN válido (10 ou 13 dígitos).'};
  const pasta = DriveApp.getFolderById(prop('PASTA'));
  const f = pasta.createFile(Utilities.newBlob(Utilities.base64Decode(d.arquivo), d.arquivo_tipo || 'application/epub+zip', d.arquivo_nome));
  let capa = '';
  if (d.capa) { const c = pasta.createFile(Utilities.newBlob(Utilities.base64Decode(d.capa), 'image/jpeg', d.capa_nome));
    c.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    capa = 'https://drive.google.com/thumbnail?id=' + c.getId() + '&sz=w600'; }
  add('Livros', {id: 'A' + Date.now(), titulo: d.titulo, autor: d.autor, autor_email: d.email, categoria: d.categoria,
    formato: 'ebook', preco: Number(String(d.preco).replace(',', '.')), ativo: false, status: 'pendente',
    capa_url: capa, arquivo_id: f.getId(), descricao: d.descricao, isbn, aceite_em: new Date() + ' | ' + d.email});
  MailApp.sendEmail(EDITORA, 'Novo ebook para análise: ' + d.titulo, 'Autor: ' + d.autor + ' <' + d.email +
    '>\nNa aba Livros: status = aprovado e ativo = TRUE para publicar.');
  MailApp.sendEmail(d.email, 'Recebemos seu ebook – Lamaveo', 'Olá, ' + d.autor + '! Recebemos "' + d.titulo +
    '". Após a aprovação, você recebe 88% do preço de cada venda (taxa única de 12%, já com todos os custos), liberado ' + DIAS_REPASSE + ' dias após cada pagamento confirmado. Avisaremos por e-mail.');
  return {ok: 1};
}

// Cria o pedido (preço e estoque conferidos AQUI, nunca confiando no navegador) e o link de pagamento
function checkout(d) {
  const livros = rows('Livros'), itens = []; let total = 0;
  for (const id in d.itens) {
    const l = livros.find(x => x.id === id && x.ativo === true && x.status === 'aprovado'), q = Math.max(1, parseInt(d.itens[id]) || 1);
    if (!l) return {erro: 'Livro indisponível'};
    if (l.formato === 'fisico' && Number(l.estoque) < q) return {erro: 'Sem estoque: ' + l.titulo};
    if (l.formato === 'fisico' && !d.endereco) return {erro: 'Informe o endereço de entrega.'};
    itens.push({id, q, t: l.titulo, p: Number(l.preco), f: l.formato}); total += l.preco * q;
  }
  if (!itens.length) return {erro: 'Carrinho vazio'};
  let fr = 0, srv = '';
  if (itens.some(i => i.f === 'fisico')) {
    const o = frete({itens: d.itens, cep: d.cep}).opcoes.find(x => x.id === String(d.servico));
    if (!o) return {erro: 'Calcule e escolha uma opção de frete.'};
    fr = o.preco; srv = o.nome + ' (' + o.prazo + ' dias úteis)'; total += fr;
  }
  const id = 'P' + Date.now();
  add('Pedidos', {id, data: new Date(), nome: d.nome, email: d.email, endereco: d.endereco, cep: d.cep,
    itens: JSON.stringify(itens), total, status: 'aguardando', frete: fr, servico: srv});
  const r = UrlFetchApp.fetch('https://api.mercadopago.com/checkout/preferences', {method: 'post', contentType: 'application/json',
    headers: {Authorization: 'Bearer ' + prop('MP_TOKEN')},
    payload: JSON.stringify({items: itens.map(i => ({title: i.t, quantity: i.q, unit_price: i.p, currency_id: 'BRL'}))
        .concat(fr ? [{title: 'Frete – ' + srv, quantity: 1, unit_price: fr, currency_id: 'BRL'}] : []),
      payment_methods: {installments: 3},
      payer: {email: d.email, name: d.nome}, external_reference: id, notification_url: ScriptApp.getService().getUrl(),
      back_urls: {success: prop('SITE') + '?pago=1'}, auto_return: 'approved'})});
  return {url: JSON.parse(r.getContentText()).init_point};
}

// O Mercado Pago avisa aqui. Confirmamos o pagamento direto na API deles (não confiamos no aviso).
function webhook(pid) {
  const p = JSON.parse(UrlFetchApp.fetch('https://api.mercadopago.com/v1/payments/' + pid,
    {headers: {Authorization: 'Bearer ' + prop('MP_TOKEN')}}).getContentText());
  if (p.status !== 'approved') return {ok: 1};
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const ped = rows('Pedidos').find(x => x.id === p.external_reference);
    if (!ped || ped.status === 'pago') return {ok: 1};
    aba('Pedidos').getRange(ped._l, col('Pedidos', 'status')).setValue('pago');
    aba('Pedidos').getRange(ped._l, col('Pedidos', 'mp_id')).setValue(pid);
    const livros = rows('Livros'), links = []; let fisico = false;
    JSON.parse(ped.itens).forEach(i => {
      const l = livros.find(x => x.id === i.id);
      if (l.formato === 'fisico') { fisico = true;
        aba('Livros').getRange(l._l, col('Livros', 'estoque')).setValue(Number(l.estoque) - i.q);       // baixa de estoque
      } else {
        const f = DriveApp.getFileById(l.arquivo_id); f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        links.push(l.titulo + ': ' + f.getUrl());
        if (l.autor_email && l.autor_email !== EDITORA) { const b = Number(l.preco) * i.q;                 // 95% / 5%
          add('Repasses', {id: ped.id + '-' + l.id, pedido: ped.id, data: new Date(), libera_em: new Date(Date.now() + DIAS_REPASSE * 86400000),
            autor_email: l.autor_email, livro: l.titulo, bruto: b, taxa_12pct: +(b * TAXA).toFixed(2),
            liquido_88pct: +(b * (1 - TAXA)).toFixed(2), pago: false}); }
      }
    });
    if (links.length) MailApp.sendEmail(ped.email, 'Seus ebooks – Lamaveo', 'Obrigado pela compra!\n\n' + links.join('\n'));
    MailApp.sendEmail(EDITORA, 'Pedido pago ' + ped.id, ped.nome + ' <' + ped.email + '>\n' + ped.endereco + ' ' + ped.cep + '\n' + ped.itens + (fisico ? '\n>>> PREPARAR ENVIO' : ''));
  } finally { lock.releaseLock(); }
  return {ok: 1};
}

// Frete: cotação pela API do Melhor Envio (precisa de ME_TOKEN e CEP_ORIGEM nas Propriedades do script)
function frete(d) {
  let q = 0; const L = rows('Livros');
  for (const id in d.itens) { const l = L.find(x => x.id === id); if (l && l.formato === 'fisico') q += parseInt(d.itens[id]) || 1; }
  if (!q) return {opcoes: []};
  const r = UrlFetchApp.fetch('https://melhorenvio.com.br/api/v2/me/shipment/calculate', {method: 'post', contentType: 'application/json',
    muteHttpExceptions: true, headers: {Authorization: 'Bearer ' + prop('ME_TOKEN'), Accept: 'application/json', 'User-Agent': 'Lamaveo (' + EDITORA + ')'},
    payload: JSON.stringify({from: {postal_code: prop('CEP_ORIGEM')}, to: {postal_code: String(d.cep).replace(/\D/g, '')},
      products: [{id: 'livro', width: 16, height: 3, length: 23, weight: 0.4, quantity: q, insurance_value: 50}]})}); // ajuste medidas/peso do seu livro
  let j = []; try { j = JSON.parse(r.getContentText()); } catch (e) {}
  return {opcoes: (Array.isArray(j) ? j : []).filter(o => !o.error).map(o => ({id: String(o.id), nome: o.company.name + ' ' + o.name,
    preco: Number(o.custom_price || o.price), prazo: o.custom_delivery_time || o.delivery_time}))};
}

// Painel da editora (exige a propriedade ADMIN_KEY)
function admin(d) {
  if (!prop('ADMIN_KEY') || d.chave !== prop('ADMIN_KEY')) return {erro: 'Acesso negado'};
  if (d.action === 'admin_dados') return {livros: rows('Livros'), pedidos: rows('Pedidos'), repasses: rows('Repasses')};
  if (!COLS[d.aba] && d.action !== 'admin_novo') return {erro: 'Aba inválida'};
  if (d.action === 'admin_novo') { add('Livros', Object.assign({id: 'L' + Date.now(), ativo: true, status: 'aprovado'}, d.campos)); return {ok: 1}; }
  const r = rows(d.aba).find(x => x.id === d.id); if (!r) return {erro: 'Registro não encontrado'};
  for (const k in d.campos) if (COLS[d.aba].indexOf(k) >= 0) aba(d.aba).getRange(r._l, col(d.aba, k)).setValue(d.campos[k]);
  if (d.aba === 'Pedidos' && d.campos.rastreio && d.campos.rastreio !== r.rastreio)
    MailApp.sendEmail(r.email, 'Seu pedido foi enviado – Lamaveo', 'Pedido ' + r.id + '\nCódigo de rastreio: ' + d.campos.rastreio +
      '\nAcompanhe em www.lamaveo.com.br (Acompanhe seu pedido) ou em rastreamento.correios.com.br');
  return {ok: 1};
}
