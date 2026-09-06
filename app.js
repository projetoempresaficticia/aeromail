// AeroMail — a caixa de correio.
//
// UMA página para as duas caixas, porque no servidor também é uma função só
// (`correio_caixa`). Duas páginas quase iguais divergem à primeira correção
// — e havia ainda o painel de leitura, que teria de existir nas duas.
//
// É a primeira app do ecossistema com Realtime: uma mensagem que chega
// aparece sem ninguém carregar em nada. O canal filtra por destinatário no
// servidor e a RLS confirma-o outra vez — o filtro é conveniência, a
// política é que é a proteção.

const areaEntrada = document.getElementById('area-entrada');
const areaApp = document.getElementById('area-app');
const elLista = document.getElementById('lista');
const elLeitura = document.getElementById('leitura');
const elConta = document.getElementById('conta-por-ler');
const elContaLixo = document.getElementById('conta-lixo');
const msgGeral = document.getElementById('msg-geral');

const estado = {
  eu: null,
  caixa: 'entrada',
  procura: '',
  soPorLer: false,
  linhas: [],
  abertaId: null,
  canal: null,
};

// ── lista ──────────────────────────────────────────────────────────
function desenharLista() {
  if (!estado.linhas.length) {
    elLista.innerHTML = `<p class="am-vazio">${
      estado.procura ? 'Nada corresponde a essa procura.'
      : estado.soPorLer ? 'Não há nada por ler.'
      : estado.caixa === 'enviados' ? 'Ainda não enviou nenhuma mensagem.'
      : estado.caixa === 'lixo' ? 'O lixo está vazio.'
      : 'A caixa de entrada está vazia.'}</p>`;
    return;
  }

  const noLixo = estado.caixa === 'lixo';
  elLista.innerHTML = estado.linhas.map((m) => {
    // Quem recebeu quer ver quem escreveu; quem enviou, a quem escreveu. No
    // lixo cabem mensagens dos dois lados, por isso a resposta vem do
    // servidor (`recebida`) e não da caixa que está aberta.
    const ced = m.recebida ? m.de : m.para;
    const nome = (m.recebida ? m.de_nome : m.para_nome) || ced;
    const porLer = m.recebida && !m.lido && !noLixo;
    const nAnexos = (m.anexos || []).filter((a) => !a.inline).length;
    return `
      <div class="am-item" data-id="${esc(m.id)}" data-por-ler="${porLer}"
           ${m.id === estado.abertaId ? 'aria-current="true"' : ''}>
        <button type="button" class="am-item-abrir" data-abrir="${esc(m.id)}">
        ${avatar(ced, nome)}
        <span style="flex:1;min-width:0">
          <span class="am-fila" style="justify-content:space-between;gap:8px">
            <span class="am-de">${esc(nome)}</span>
            <span class="am-hora">${esc(horaCurta(m.criada_em))}</span>
          </span>
          <span class="am-assunto" style="display:block">
            ${m.de_orgao && m.recebida
              ? '<span class="am-selo am-selo-orgao" style="margin-right:6px">Órgão</span>' : ''}
            ${esc(m.assunto)}
          </span>
          <span class="am-excerto" style="display:block">
            ${nAnexos ? `<span class="am-icone am-icone-16 i-anexo"
                 aria-label="${nAnexos} anexo(s)"></span> ` : ''}
            ${esc(m.excerto || '')}
          </span>
        </span>
        </button>
        <button type="button" class="am-item-accao" data-arrumar="${esc(m.id)}"
                data-destino="${noLixo ? 'caixa' : 'lixo'}"
                data-repor="${noLixo}"
                title="${noLixo ? 'Repor na caixa' : 'Apagar'}"
                aria-label="${noLixo ? 'Repor' : 'Apagar'} — ${esc(m.assunto)}">
          <span class="am-icone am-icone-16 ${noLixo ? 'i-voltar' : 'i-lixo'}"
                aria-hidden="true"></span>
        </button>
      </div>`;
  }).join('');

  elLista.querySelectorAll('[data-abrir]').forEach((b) => {
    b.addEventListener('click', () => abrir(b.dataset.abrir));
  });
  elLista.querySelectorAll('[data-arrumar]').forEach((b) => {
    b.addEventListener('click', () => arrumar([b.dataset.arrumar], b.dataset.destino));
  });
}

function marcarConta(porLer, noLixo) {
  elConta.textContent = porLer > 0 ? String(porLer) : '';
  if (noLixo !== undefined) {
    elContaLixo.textContent = noLixo > 0 ? String(noLixo) : '';
  }
}

async function carregar(manterAberta) {
  mostrarMsg(msgGeral, '');
  const r = await api('correio_caixa', {
    p_caixa: estado.caixa,
    p_procura: estado.procura || null,
    p_so_por_ler: estado.soPorLer,
  });
  if (!r.ok) {
    elLista.innerHTML = `<p class="am-vazio">${esc(r.erro)}</p>`;
    return;
  }
  estado.eu = r.dados.eu;
  estado.linhas = r.dados.linhas;
  marcarConta(r.dados.por_ler, r.dados.no_lixo);
  if (!manterAberta) {
    estado.abertaId = null;
    limparLeitura();
  }
  desenharLista();
}

// ── arrumar: apagar, repor, apagar de vez ──────────────────────────
// Três acções, uma função — no servidor também. Apagar não destrói: põe no
// lixo, de onde se pode voltar. Só do lixo é que se destrói, e mesmo aí a
// linha só desaparece quando o outro lado também já não a quer: a cópia de
// quem recebeu não é minha para apagar.
// Uma pergunta de sim ou não, com a janela do app. Devolve a resposta
// como promessa para quem chama poder esperar por ela.
function perguntar(texto, aviso) {
  return new Promise((resolve) => {
    const janela = document.getElementById('janela-confirmar');
    document.getElementById('texto-confirmar').textContent = texto;
    document.getElementById('aviso-confirmar').textContent =
      aviso || 'Isto não tem volta.';

    const btn = document.getElementById('btn-confirmar');
    let respondido = false;

    function fechar() {
      janela.removeEventListener('close', aoFechar);
      btn.removeEventListener('click', aoSim);
    }
    function aoSim() {
      respondido = true;
      fechar();
      janela.close();
      resolve(true);
    }
    function aoFechar() {
      // Fechar pelo Escape, pelo Cancelar ou pelo fundo é sempre "não".
      fechar();
      if (!respondido) resolve(false);
    }

    btn.addEventListener('click', aoSim);
    janela.addEventListener('close', aoFechar);
    janela.showModal();
  });
}

async function arrumar(ids, destino) {
  if (!ids || !ids.length) return;

  if (destino === 'fora') {
    const varias = ids.length > 1;
    const sim = await perguntar(
      varias
        ? `Apagar de vez ${ids.length} mensagens do lixo?`
        : 'Apagar esta mensagem de vez?',
      'Sai da sua caixa para sempre. A cópia de quem está do outro lado só '
      + 'desaparece quando essa pessoa também a apagar — não é sua para apagar.');
    if (!sim) return;
  }

  const r = await api('correio_arrumar', { p_ids: ids, p_destino: destino });
  if (!r.ok) {
    mostrarMsg(msgGeral, r.erro, 'erro');
    return;
  }

  // Quando a linha morre mesmo, os ficheiros dela ficariam no Storage sem
  // nada a apontar-lhes. A base devolve os caminhos e é aqui que se
  // apagam — a policy só deixa quem os lá pôs.
  const ficheiros = r.dados.ficheiros || [];
  if (ficheiros.length) await sb.storage.from('correio').remove(ficheiros);

  if (ids.indexOf(estado.abertaId) >= 0) {
    estado.abertaId = null;
    limparLeitura();
  }
  await carregar(true);
}

document.getElementById('btn-esvaziar').addEventListener('click', async () => {
  // Esvaziar é esvaziar tudo, não só o que a procura está a mostrar. Se
  // usasse a lista do ecrã, o botão fazia menos do que o nome promete.
  const r = await api('correio_caixa',
    { p_caixa: 'lixo', p_procura: null, p_so_por_ler: false });
  if (!r.ok) {
    mostrarMsg(msgGeral, r.erro, 'erro');
    return;
  }
  const ids = r.dados.linhas.map((m) => m.id);
  if (!ids.length) return;
  await arrumar(ids, 'fora');
});

// ── leitura ────────────────────────────────────────────────────────
function limparLeitura() {
  document.body.dataset.lendo = 'false';
  elLeitura.innerHTML = `<p class="am-vazio">Escolha uma mensagem para a ler.</p>`;
}

function desenharAnexosDaMensagem(anexos) {
  if (!anexos || !anexos.length) return '';
  return `
    <div class="am-anexos" style="margin-top:20px">
      ${anexos.map((a) => `
        <button type="button" class="am-anexo" data-caminho="${esc(a.caminho)}"
                data-nome="${esc(a.nome)}" title="Descarregar ${esc(a.nome)}">
          <span class="am-icone am-icone-16 ${iconeDoTipo(a.tipo)}" aria-hidden="true"></span>
          <span class="nome">${esc(a.nome)}</span>
          <span class="peso">${esc(formatarTamanho(a.tamanho))}</span>
          <span class="am-icone am-icone-16 i-descarregar" aria-hidden="true"></span>
        </button>`).join('')}
    </div>`;
}

// O ficheiro está num bucket privado. O endereço assinado dura um minuto —
// o suficiente para descarregar, pouco para andar a circular por aí.
async function descarregarAnexo(caminho, nome, botao) {
  const antes = botao.style.opacity;
  botao.style.opacity = '.5';
  const { data, error } = await sb.storage
    .from('correio').createSignedUrl(caminho, 60, { download: nome });
  botao.style.opacity = antes;
  if (error || !data) {
    botao.dataset.estado = 'erro';
    return;
  }
  window.open(data.signedUrl, '_blank', 'noopener');
}

async function abrir(id) {
  const m = estado.linhas.find((x) => x.id === id);
  if (!m) return;
  estado.abertaId = id;
  document.body.dataset.lendo = 'true';

  const recebida = m.recebida;
  const noLixo = estado.caixa === 'lixo';
  const ced = recebida ? m.de : m.para;
  const nome = (recebida ? m.de_nome : m.para_nome) || ced;

  elLeitura.innerHTML = `
    <div class="am-coluna-topo">
      <button type="button" class="am-botao am-botao-fantasma am-voltar" id="btn-voltar"
              style="margin-bottom:8px">
        <span class="am-icone i-voltar" aria-hidden="true"></span>Voltar à lista
      </button>
      <h2 style="margin-bottom:12px">${esc(m.assunto)}</h2>
      <div class="am-fila">
        ${avatar(ced, nome)}
        <span style="flex:1;min-width:0">
          <span style="display:block;font-weight:600">${esc(nome)}</span>
          <span class="am-suave mono" style="font-size:12px">${esc(ced)}</span>
        </span>
        <span class="am-hora">${esc(formatarDataHora(m.criada_em))}</span>
      </div>
      <p class="am-suave" style="font-size:12.5px;margin-top:10px">
        ${recebida ? 'Recebida por si' : 'Enviada por si'}
        ${m.de_orgao ? ' · <span class="am-selo am-selo-orgao">Aviso automático de um órgão</span>' : ''}
      </p>
    </div>

    <div class="am-rolavel" style="padding:24px">
      ${corpoDesenhado(m.corpo, m.formato)}
      ${desenharAnexosDaMensagem(m.anexos)}
    </div>

    <div class="am-janela-pe" style="justify-content:flex-start">
      ${noLixo ? `
        <button type="button" class="am-botao" data-arrumar-um="caixa">
          <span class="am-icone i-voltar" aria-hidden="true"></span>Repor na caixa
        </button>
        <button type="button" class="am-botao am-botao-linha" data-arrumar-um="fora">
          <span class="am-icone i-lixo" aria-hidden="true"></span>Apagar de vez
        </button>` : `
        <button type="button" class="am-botao" id="btn-responder">
          <span class="am-icone i-responder" aria-hidden="true"></span>Responder
        </button>
        ${recebida ? `
          <button type="button" class="am-botao am-botao-linha" id="btn-por-ler">
            <span class="am-icone i-envelope" aria-hidden="true"></span>Marcar por ler
          </button>` : ''}
        <button type="button" class="am-botao am-botao-linha" data-arrumar-um="lixo">
          <span class="am-icone i-lixo" aria-hidden="true"></span>Apagar
        </button>`}
    </div>`;

  const voltar = document.getElementById('btn-voltar');
  if (voltar) voltar.addEventListener('click', () => {
    estado.abertaId = null;
    limparLeitura();
    desenharLista();
  });

  elLeitura.querySelectorAll('.am-anexo').forEach((b) => {
    b.addEventListener('click', () => descarregarAnexo(b.dataset.caminho, b.dataset.nome, b));
  });

  const btnResponder = document.getElementById('btn-responder');
  if (btnResponder) btnResponder
    .addEventListener('click', () => abrirNova({
      para: ced,
      assunto: /^re:/i.test(m.assunto) ? m.assunto : 'Re: ' + m.assunto,
      // Só se responde ao que se recebeu — é o que a RPC exige, e faz
      // sentido: uma mensagem que eu enviei não é um fio que me responda.
      respostaA: recebida ? m.id : null,
      citado: citar(m, nome),
    }));

  const btnPorLer = document.getElementById('btn-por-ler');
  if (btnPorLer) btnPorLer.addEventListener('click', () => marcarLido(m.id, false));

  elLeitura.querySelectorAll('[data-arrumar-um]').forEach((b) => {
    b.addEventListener('click', () => arrumar([m.id], b.dataset.arrumarUm));
  });

  // Abrir é ler. Marca-se depois de mostrar, para o ecrã não esperar pela rede.
  // No lixo não: passar os olhos pelo que se deitou fora não é ler.
  if (recebida && !m.lido && !noLixo) await marcarLido(m.id, true);
  desenharLista();
}

// A citação entra no editor já como HTML — e passa pela mesma limpeza que
// tudo o resto. Citar uma mensagem hostil não pode ser a maneira de a
// executar na página de quem responde.
// Uma imagem citada aponta para um anexo da mensagem ORIGINAL, que está
// na pasta de quem a escreveu. Arrastá-la para a resposta era pedir para
// enviar um ficheiro que não é meu — e o servidor recusa, com razão.
// Fica a marca de que ali havia uma imagem.
function semImagens(html) {
  const doc = document.implementation.createHTMLDocument('');
  doc.body.innerHTML = html;
  doc.body.querySelectorAll('img').forEach((im) => {
    const marca = doc.createElement('i');
    marca.textContent = '[imagem]';
    im.replaceWith(marca);
  });
  return doc.body.innerHTML;
}

function citar(m, quem) {
  const dentro = m.formato === 'html'
    ? semImagens(limparHtml(m.corpo))
    : '<p>' + esc(m.corpo).replace(/\n/g, '<br>') + '</p>';
  return '<p><br></p><blockquote><p>' + esc(quem) + ' escreveu a '
    + esc(formatarDataHora(m.criada_em)) + ':</p>' + dentro + '</blockquote>';
}

async function marcarLido(id, lido) {
  const r = await api('correio_marcar_lido', { p_id: id, p_lido: lido });
  if (!r.ok) return;
  const m = estado.linhas.find((x) => x.id === id);
  if (m) m.lido = lido;
  marcarConta(r.dados.por_ler);   // o lixo não muda ao marcar lido
  // Com "só por ler" ligado, marcar como lida tira-a da lista: a lista
  // deixaria de corresponder ao filtro que está no ecrã.
  if (estado.soPorLer) carregar(true);
  else desenharLista();
}

// ══ ESCREVER ═══════════════════════════════════════════════════════
const janelaNova = document.getElementById('janela-nova');
const campoPara = document.getElementById('para');
const campoAssunto = document.getElementById('assunto');
const editor = document.getElementById('corpo');
const msgNova = document.getElementById('msg-nova');
const elAnexos = document.getElementById('anexos');
const campoFicheiros = document.getElementById('ficheiros');
const linhaLigacao = document.getElementById('linha-ligacao');
const campoUrl = document.getElementById('url-ligacao');

let respostaA = null;
let contactosCarregados = false;
let anexos = [];        // { nome, tamanho, tipo, caminho, estado, inline }
let enviadaComSucesso = false;
let assinaturaMestre = null;   // o caminho do molde, não o da cópia

// ── o editor ───────────────────────────────────────────────────────
// `execCommand` está marcado como obsoleto e não tem substituto: a API que
// o havia de substituir nunca chegou a existir em todos os browsers. Sem
// passo de compilação, é isto ou um editor de biblioteca — e para negrito,
// listas e ligações, o que o browser traz chega bem.
try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) { /* browser antigo */ }

function marcarVazio() {
  // Uma imagem não tem textContent. Sem esta segunda condição, a dica
  // ficava escrita por cima da assinatura acabada de inserir.
  const vazio = editor.textContent.trim() === '' && !editor.querySelector('img');
  editor.dataset.vazio = String(vazio);
}

function actualizarBarra() {
  document.querySelectorAll('.am-ferramentas button[data-cmd]').forEach((b) => {
    const c = b.dataset.cmd;
    if (c.includes(':') || !b.hasAttribute('aria-pressed')) return;
    try { b.setAttribute('aria-pressed', String(document.queryCommandState(c))); }
    catch (e) { /* comando que este browser não conhece */ }
  });
}

// Sem isto, carregar num botão tira o foco do editor e leva a seleção com
// ele — e o negrito ia aplicar-se a coisa nenhuma.
document.querySelectorAll('.am-ferramentas button, .am-ligacao button')
  .forEach((b) => b.addEventListener('mousedown', (ev) => ev.preventDefault()));

document.querySelectorAll('.am-ferramentas button[data-cmd]').forEach((b) => {
  b.addEventListener('click', () => {
    editor.focus();
    const c = b.dataset.cmd;
    if (c.startsWith('formatBlock:')) document.execCommand('formatBlock', false, c.split(':')[1]);
    else document.execCommand(c, false, null);
    actualizarBarra();
    marcarVazio();
  });
});

editor.addEventListener('input', () => { marcarVazio(); actualizarBarra(); });
document.addEventListener('selectionchange', () => {
  if (document.activeElement === editor) actualizarBarra();
});

// Colar de um documento traz uma montanha de marcação (o Word traz folhas
// de estilo inteiras). Limpa-se à entrada: assim o que está no editor é
// mesmo o que vai ser enviado.
editor.addEventListener('paste', (ev) => {
  ev.preventDefault();
  const dt = ev.clipboardData;
  if (!dt) return;
  const html = dt.getData('text/html');
  const limpo = html
    ? limparHtml(html)
    : esc(dt.getData('text/plain')).replace(/\n/g, '<br>');
  document.execCommand('insertHTML', false, limpo);
  marcarVazio();
});

// ── ligações ───────────────────────────────────────────────────────
let intervaloGuardado = null;

document.getElementById('btn-ligacao').addEventListener('click', () => {
  const sel = window.getSelection();
  intervaloGuardado = (sel && sel.rangeCount) ? sel.getRangeAt(0).cloneRange() : null;
  linhaLigacao.hidden = false;
  campoUrl.value = '';
  campoUrl.focus();
});

document.getElementById('btn-cancelar-ligacao').addEventListener('click', () => {
  linhaLigacao.hidden = true;
  editor.focus();
});

document.getElementById('btn-aplicar-ligacao').addEventListener('click', () => {
  let url = campoUrl.value.trim();
  if (!url) return;
  // Quem escreve "prepara.pt" quer um site, não um endereço partido.
  if (!/^(https?:|mailto:)/i.test(url)) url = 'https://' + url;

  editor.focus();
  if (intervaloGuardado) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(intervaloGuardado);
  }
  // Sem nada selecionado, o createLink não tem a que se agarrar — e
  // escrever o texto primeiro também não serve, porque a seleção fica
  // depois dele. Insere-se a ligação já feita.
  if (window.getSelection().isCollapsed) {
    document.execCommand('insertHTML', false,
      '<a href="' + esc(url) + '">' + esc(url) + '</a>&nbsp;');
  } else {
    document.execCommand('createLink', false, url);
  }
  linhaLigacao.hidden = true;
  marcarVazio();
});

campoUrl.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') {
    ev.preventDefault();
    document.getElementById('btn-aplicar-ligacao').click();
  }
});

// ── anexos ─────────────────────────────────────────────────────────
const MAX_ANEXO = 5 * 1024 * 1024;
const MAX_ANEXOS = 5;

// A pasta é um uuid para dois ficheiros com o mesmo nome não se
// pisarem — e o `upsert` fica desligado por isso mesmo.
function novaPasta() {
  return (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// Alguns sistemas entregam o ficheiro sem tipo. O bucket só aceita uma
// lista de tipos, por isso um ficheiro sem tipo era recusado sem razão —
// deduz-se pela extensão, que é o que o resto do mundo também faz.
const TIPOS = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', gif: 'image/gif', txt: 'text/plain', csv: 'text/csv',
  xml: 'application/xml', zip: 'application/zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function tipoDe(ficheiro) {
  const ext = (ficheiro.name.split('.').pop() || '').toLowerCase();
  // O Windows dá "application/x-zip-compressed", que o bucket não conhece.
  if (ext === 'zip') return 'application/zip';
  return TIPOS[ext] || ficheiro.type || '';
}

function desenharAnexosDoEditor() {
  // Uma imagem do corpo já se vê no corpo; mostrá-la também como ficha
  // era dizer duas vezes a mesma coisa. O índice guardado é o da lista
  // toda, para o botão de tirar continuar a apontar ao sítio certo.
  const soltos = anexos.map((a, i) => ({ a, i })).filter((x) => !x.a.inline);
  document.getElementById('ajuda-anexos').hidden = soltos.length === 0;
  elAnexos.innerHTML = soltos.map(({ a, i }) => `
    <span class="am-anexo" data-estado="${a.estado}">
      <span class="am-icone am-icone-16 ${iconeDoTipo(a.tipo)}" aria-hidden="true"></span>
      <span class="nome">${esc(a.nome)}</span>
      <span class="peso">${a.estado === 'a-enviar' ? 'a enviar…'
        : a.estado === 'erro' ? esc(a.erro || 'falhou')
        : esc(formatarTamanho(a.tamanho))}</span>
      <button type="button" class="tirar" data-i="${i}"
              aria-label="Tirar ${esc(a.nome)}">
        <span class="am-icone am-icone-16 i-fechar" aria-hidden="true"></span>
      </button>
    </span>`).join('');

  elAnexos.querySelectorAll('.tirar').forEach((b) => {
    b.addEventListener('click', () => tirarAnexo(Number(b.dataset.i)));
  });
}

async function tirarAnexo(i) {
  const a = anexos[i];
  if (!a) return;
  // Ainda não foi enviado a ninguém: a policy deixa apagá-lo, e deve-se
  // mesmo — senão ficava lixo no Storage a ocupar espaço para sempre.
  if (a.caminho) await sb.storage.from('correio').remove([a.caminho]);
  anexos.splice(i, 1);
  desenharAnexosDoEditor();
}

async function limparAnexosNaoEnviados() {
  const caminhos = anexos.filter((a) => a.caminho).map((a) => a.caminho);
  anexos = [];
  desenharAnexosDoEditor();
  if (caminhos.length) await sb.storage.from('correio').remove(caminhos);
}

document.getElementById('btn-anexar').addEventListener('click', () => campoFicheiros.click());

campoFicheiros.addEventListener('change', async () => {
  await juntarFicheiros(Array.from(campoFicheiros.files || []));
  campoFicheiros.value = '';   // deixa reescolher o mesmo ficheiro
});

// Arrastar para cima do editor é como toda a gente espera anexar.
['dragover', 'drop'].forEach((ev) => {
  editor.addEventListener(ev, (e) => {
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault();
    if (ev === 'drop') juntarFicheiros(Array.from(e.dataTransfer.files));
  });
});

async function juntarFicheiros(ficheiros) {
  for (const f of ficheiros) {
    if (anexos.filter((a) => !a.inline).length >= MAX_ANEXOS) {
      mostrarMsg(msgNova, `No máximo ${MAX_ANEXOS} anexos por mensagem.`, 'aviso');
      break;
    }
    const item = {
      nome: nomeSeguro(f.name), tamanho: f.size, tipo: tipoDe(f),
      caminho: null, estado: 'a-enviar', erro: null, inline: false,
    };

    if (f.size > MAX_ANEXO) {
      item.estado = 'erro';
      item.erro = 'maior que 5 MB';
      anexos.push(item);
      desenharAnexosDoEditor();
      continue;
    }

    anexos.push(item);
    desenharAnexosDoEditor();

    const caminho = estado.eu + '/' + novaPasta() + '/' + item.nome;

    const { error } = await sb.storage.from('correio')
      .upload(caminho, f, { contentType: item.tipo || 'application/octet-stream' });

    if (error) {
      item.estado = 'erro';
      item.erro = 'tipo não aceite';
    } else {
      item.caminho = caminho;
      item.estado = 'pronto';
    }
    desenharAnexosDoEditor();
  }
}

// ── imagens dentro do corpo ────────────────────────────────────────
// Uma imagem do corpo é um anexo como os outros — só que, em vez de
// aparecer na lista lá em baixo, é desenhada no meio do texto. O corpo
// guarda `data-anexo="<caminho>"` e nunca um endereço; ver o sql/0005.
const campoImagens = document.getElementById('imagens');

document.getElementById('btn-imagem').addEventListener('click', () => campoImagens.click());

campoImagens.addEventListener('change', async () => {
  const f = (campoImagens.files || [])[0];
  campoImagens.value = '';
  if (!f) return;

  if (!/^image\//.test(f.type)) {
    mostrarMsg(msgNova, 'Isso não é uma imagem.', 'erro');
    return;
  }
  if (f.size > MAX_ANEXO) {
    mostrarMsg(msgNova, 'A imagem tem mais de 5 MB.', 'erro');
    return;
  }

  mostrarMsg(msgNova, 'A carregar a imagem…');
  const nome = nomeSeguro(f.name);
  const caminho = estado.eu + '/' + novaPasta() + '/' + nome;
  const { error } = await sb.storage.from('correio')
    .upload(caminho, f, { contentType: f.type });
  if (error) {
    mostrarMsg(msgNova, 'Não foi possível carregar a imagem.', 'erro');
    return;
  }

  anexos.push({ nome, tamanho: f.size, tipo: f.type, caminho,
                estado: 'pronto', erro: null, inline: true });
  editor.focus();
  document.execCommand('insertHTML', false,
    '<img data-anexo="' + esc(caminho) + '" alt="' + esc(nome) + '">');
  await resolverImagens(editor, anexos);
  mostrarMsg(msgNova, '');
  marcarVazio();
});

// Ao enviar, deitar fora as imagens que foram carregadas e depois apagadas
// do texto. Sem isto ficavam no Storage para sempre, sem nada a mostrá-las.
async function podarInline(corpoHtml) {
  const doc = document.implementation.createHTMLDocument('');
  doc.body.innerHTML = corpoHtml;
  const usadas = new Set(Array.from(doc.body.querySelectorAll('img[data-anexo]'))
    .map((im) => im.getAttribute('data-anexo')));

  const sobras = anexos.filter((a) => a.inline && a.caminho && !usadas.has(a.caminho));
  if (!sobras.length) return;
  anexos = anexos.filter((a) => !(a.inline && a.caminho && !usadas.has(a.caminho)));
  await sb.storage.from('correio').remove(sobras.map((a) => a.caminho));
}

// ── a minha assinatura ─────────────────────────────────────────────
// O molde vive em `<cédula>/assinatura/<uuid>.png` e é só meu. O que
// viaja dentro de cada mensagem é uma CÓPIA: assim a mensagem guarda a
// assinatura com que foi enviada, e trocá-la hoje não reescreve o que se
// mandou no mês passado. São uns kilobytes por mensagem.
const msgAssinatura = document.getElementById('msg-assinatura');

async function carregarAssinatura() {
  const { data } = await sb.from('correio_assinaturas').select('caminho').maybeSingle();
  assinaturaMestre = data ? data.caminho : null;
}

async function mostrarAssinatura() {
  const caixa = document.getElementById('assinatura-mostra');
  const btnTirar = document.getElementById('btn-tirar-assinatura');

  if (!assinaturaMestre) {
    caixa.innerHTML = '<p>Ainda não tem assinatura.</p>';
    btnTirar.hidden = true;
    return;
  }
  btnTirar.hidden = false;
  const { data } = await sb.storage.from('correio').createSignedUrl(assinaturaMestre, 600);
  caixa.innerHTML = data && data.signedUrl
    ? '<img src="' + esc(data.signedUrl) + '" alt="A sua assinatura" />'
    : '<p>Não foi possível mostrar a imagem.</p>';
}

document.getElementById('btn-minha-assinatura').addEventListener('click', async () => {
  mostrarMsg(msgAssinatura, '');
  abrirJanela('janela-assinatura');
  await mostrarAssinatura();
});

document.getElementById('btn-escolher-assinatura')
  .addEventListener('click', () => document.getElementById('ficheiro-assinatura').click());

document.getElementById('ficheiro-assinatura').addEventListener('change', async (ev) => {
  const f = (ev.target.files || [])[0];
  ev.target.value = '';
  if (!f) return;

  mostrarMsg(msgAssinatura, 'A preparar a imagem…');
  let imagem;
  try {
    imagem = await reduzirImagem(f, 600, 200);
  } catch (e) {
    mostrarMsg(msgAssinatura, 'Esse ficheiro não é uma imagem.', 'erro');
    return;
  }

  const caminho = estado.eu + '/assinatura/' + novaPasta() + '.png';
  const { error } = await sb.storage.from('correio')
    .upload(caminho, imagem, { contentType: 'image/png' });
  if (error) {
    mostrarMsg(msgAssinatura, 'Não foi possível carregar a imagem.', 'erro');
    return;
  }

  const r = await api('correio_assinatura_guardar', { p_caminho: caminho });
  if (!r.ok) {
    // Não deixar no Storage uma imagem que a base recusou.
    await sb.storage.from('correio').remove([caminho]);
    mostrarMsg(msgAssinatura, r.erro, 'erro');
    return;
  }
  if (r.dados.anterior) await sb.storage.from('correio').remove([r.dados.anterior]);

  assinaturaMestre = caminho;
  await mostrarAssinatura();
  mostrarMsg(msgAssinatura, 'Assinatura guardada. Passa a ir nas suas mensagens.', 'ok');
});

document.getElementById('btn-tirar-assinatura').addEventListener('click', async () => {
  const r = await api('correio_assinatura_apagar', {});
  if (!r.ok) {
    mostrarMsg(msgAssinatura, r.erro, 'erro');
    return;
  }
  // As cópias já enviadas ficam: o que se apaga é o molde, não o passado.
  if (r.dados.anterior) await sb.storage.from('correio').remove([r.dados.anterior]);
  assinaturaMestre = null;
  await mostrarAssinatura();
  mostrarMsg(msgAssinatura, 'Assinatura removida.', 'ok');
});

async function copiarAssinaturaParaMensagem() {
  if (!assinaturaMestre) return null;
  const destino = estado.eu + '/' + novaPasta() + '/assinatura.png';
  const { error } = await sb.storage.from('correio').copy(assinaturaMestre, destino);
  if (error) return null;
  anexos.push({ nome: 'assinatura.png', tamanho: 0, tipo: 'image/png',
                caminho: destino, estado: 'pronto', erro: null, inline: true });
  return destino;
}

function htmlDaAssinatura(caminho) {
  return '<p><br></p><p><img data-anexo="' + esc(caminho)
    + '" data-papel="assinatura" alt="Assinatura"></p>';
}

async function porAssinaturaNoEditor(antesDaCitacao) {
  if (!assinaturaMestre) return;
  if (editor.querySelector('img[data-papel="assinatura"]')) return;
  const caminho = await copiarAssinaturaParaMensagem();
  if (!caminho) return;

  const citacao = antesDaCitacao ? editor.querySelector('blockquote') : null;
  if (citacao) citacao.insertAdjacentHTML('beforebegin', htmlDaAssinatura(caminho));
  else editor.insertAdjacentHTML('beforeend', htmlDaAssinatura(caminho));

  await resolverImagens(editor, anexos);
  marcarVazio();
}

// Pôr a assinatura à mão, para quem a apagou e se arrependeu.
document.getElementById('btn-assinar').addEventListener('click', async () => {
  if (!assinaturaMestre) {
    mostrarMsg(msgNova, 'Ainda não definiu a sua assinatura — veja na barra lateral.', 'aviso');
    return;
  }
  if (editor.querySelector('img[data-papel="assinatura"]')) {
    mostrarMsg(msgNova, 'A assinatura já está na mensagem.', 'aviso');
    return;
  }
  await porAssinaturaNoEditor(false);
});

// ── abrir e enviar ─────────────────────────────────────────────────
async function carregarContactos() {
  if (contactosCarregados) return;
  const r = await api('correio_contactos', { p_procura: null });
  if (!r.ok) return;
  document.getElementById('contactos').innerHTML = r.dados.linhas.map((c) =>
    `<option value="${esc(c.cedula)}">${esc(c.nome)}${
      c.empresa ? ' — ' + esc(c.empresa) : ''}</option>`).join('');
  contactosCarregados = true;
}

async function abrirNova(opcoes) {
  const o = opcoes || {};
  respostaA = o.respostaA || null;
  enviadaComSucesso = false;
  anexos = [];
  desenharAnexosDoEditor();

  campoPara.value = o.para || '';
  campoAssunto.value = o.assunto || '';
  editor.innerHTML = o.citado || '';
  linhaLigacao.hidden = true;
  marcarVazio();
  mostrarMsg(msgNova, '');
  document.getElementById('titulo-nova').textContent =
    respostaA ? 'Responder' : 'Nova mensagem';

  carregarContactos();
  abrirJanela('janela-nova');
  await porAssinaturaNoEditor(!!o.citado);

  if (o.para) {
    // Numa resposta, o cursor vai para cima da citação: é aí que se escreve.
    editor.focus();
    const sel = window.getSelection();
    const r = document.createRange();
    r.setStart(editor, 0);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  } else {
    campoPara.focus();
  }
}

document.getElementById('btn-nova').addEventListener('click', () => abrirNova());

// Fechar sem enviar deixaria os ficheiros já carregados no Storage sem
// mensagem nenhuma a apontar para eles.
janelaNova.addEventListener('close', () => {
  if (!enviadaComSucesso) limparAnexosNaoEnviados();
});

document.getElementById('form-nova').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const btn = document.getElementById('btn-enviar');

  if (anexos.some((a) => a.estado === 'a-enviar')) {
    mostrarMsg(msgNova, 'Espere que os anexos acabem de subir.', 'aviso');
    return;
  }
  const maus = anexos.filter((a) => a.estado === 'erro');
  if (maus.length) {
    mostrarMsg(msgNova, 'Tire os anexos que falharam antes de enviar.', 'erro');
    return;
  }
  // Uma mensagem só com a assinatura continua a ser uma mensagem vazia:
  // a assinatura foi posta pela app, não é nada que a pessoa quisesse
  // dizer. Já uma imagem que ela inseriu conta como conteúdo.
  const temTexto = editor.textContent.trim() !== '';
  const temImagem = !!editor.querySelector('img:not([data-papel="assinatura"])');
  if (!temTexto && !temImagem) {
    mostrarMsg(msgNova, 'A mensagem está vazia.', 'erro');
    editor.focus();
    return;
  }

  btn.disabled = true;
  mostrarMsg(msgNova, 'A enviar…');

  // Limpo aqui e recusado outra vez no servidor. Não é desconfiança do
  // editor: é que o servidor não pode acreditar em nada que venha daqui.
  const corpo = limparHtml(editor.innerHTML);
  await podarInline(corpo);

  const r = await api('correio_enviar', {
    p_para_cedula: campoPara.value.trim(),
    p_assunto: campoAssunto.value,
    p_corpo: corpo,
    p_resposta_a: respostaA,
    p_formato: 'html',
    p_anexos: anexos.map((a) => ({ caminho: a.caminho, inline: !!a.inline })),
  });
  btn.disabled = false;

  if (!r.ok) {
    mostrarMsg(msgNova, r.erro, 'erro');
    return;
  }
  enviadaComSucesso = true;
  janelaNova.close();
  // Mostrar o que saiu: quem envia quer ver a mensagem na caixa de saída,
  // não uma frase a dizer que correu bem.
  trocarCaixa('enviados');
});

// ── caixas, procura, filtro ────────────────────────────────────────
function trocarCaixa(caixa) {
  estado.caixa = caixa;
  document.querySelectorAll('.am-nav[data-caixa]').forEach((b) => {
    b.setAttribute('aria-current', String(b.dataset.caixa === caixa));
  });
  const titulos = { enviados: 'Enviados', lixo: 'Lixo', entrada: 'Entrada' };
  document.getElementById('titulo-caixa').textContent = titulos[caixa] || 'Entrada';
  // "Só por ler" não quer dizer nada nos enviados nem no lixo.
  document.getElementById('rotulo-por-ler').hidden = caixa !== 'entrada';
  document.getElementById('btn-esvaziar').hidden = caixa !== 'lixo';
  carregar(false);
}

document.querySelectorAll('.am-nav[data-caixa]').forEach((b) => {
  b.addEventListener('click', () => trocarCaixa(b.dataset.caixa));
});

let temporizador = null;
document.getElementById('procura').addEventListener('input', (ev) => {
  clearTimeout(temporizador);
  temporizador = setTimeout(() => {
    estado.procura = ev.target.value.trim();
    carregar(false);
  }, 250);
});

document.getElementById('so-por-ler').addEventListener('change', (ev) => {
  estado.soPorLer = ev.target.checked;
  carregar(false);
});

// ── o que chega enquanto se está a olhar ───────────────────────────
async function ligarRealtime(minhaCedula) {
  if (estado.canal) sb.removeChannel(estado.canal);

  // O Realtime só aplica a RLS se lhe passarmos o token da sessão. Sem
  // isto o canal ligava-se como anónimo e a política — que pergunta quem
  // sou — não deixava passar nada: nunca chegava aviso nenhum.
  const { data } = await sb.auth.getSession();
  if (data.session) sb.realtime.setAuth(data.session.access_token);

  estado.canal = sb.channel('correio-' + minhaCedula)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'correio',
      filter: 'para_cedula=eq.' + minhaCedula,
    }, () => {
      // Recarrega-se a caixa em vez de enfiar a linha do payload na lista:
      // a linha crua não traz os nomes, nem os anexos, nem a marca de
      // órgão, que a RPC calcula.
      if (estado.caixa === 'entrada') carregar(true);
      else marcarNovaNaEntrada();
    })
    .subscribe();
}

// Chegou correio enquanto se estava nos enviados: contar, sem mudar o ecrã
// debaixo das mãos de quem está a ler outra coisa.
async function marcarNovaNaEntrada() {
  const r = await api('correio_caixa', { p_caixa: 'entrada', p_procura: null, p_so_por_ler: true });
  if (r.ok) marcarConta(r.dados.por_ler);
}

// ── arranque ───────────────────────────────────────────────────────
async function entrar() {
  const ctx = await quemSou();
  areaEntrada.hidden = true;
  areaApp.hidden = false;

  if (!ctx) {
    elLista.innerHTML = '<p class="am-vazio">Não tem ficha na Carteirinha.</p>';
    document.getElementById('nome-quem').textContent = 'Sem ficha';
    limparLeitura();
    return;
  }
  document.getElementById('nome-quem').textContent = ctx.pessoa.nome;
  document.getElementById('cedula-quem').textContent = ctx.pessoa.cedula;
  estado.eu = ctx.pessoa.cedula;

  limparLeitura();
  await carregarAssinatura();
  await carregar(false);
  await ligarRealtime(ctx.pessoa.cedula);
}

document.getElementById('btn-sair').addEventListener('click', async () => {
  if (estado.canal) sb.removeChannel(estado.canal);
  await sb.auth.signOut();
  window.location.reload();
});

(async function arrancar() {
  ligarVerSenha();
  ligarFormularioLogin(entrar);
  marcarVazio();
  const { data } = await sb.auth.getSession();
  if (data.session) await entrar();
  else areaEntrada.hidden = false;
})();
