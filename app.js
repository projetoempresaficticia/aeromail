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
      : 'A caixa de entrada está vazia.'}</p>`;
    return;
  }

  const naEntrada = estado.caixa === 'entrada';
  elLista.innerHTML = estado.linhas.map((m) => {
    // Na entrada interessa quem escreveu; nos enviados, a quem se escreveu.
    const ced = naEntrada ? m.de : m.para;
    const nome = (naEntrada ? m.de_nome : m.para_nome) || ced;
    const porLer = naEntrada && !m.lido;
    const nAnexos = (m.anexos || []).length;
    return `
      <button type="button" class="am-item" data-id="${esc(m.id)}"
              data-por-ler="${porLer}"
              ${m.id === estado.abertaId ? 'aria-current="true"' : ''}>
        ${avatar(ced, nome)}
        <span style="flex:1;min-width:0">
          <span class="am-fila" style="justify-content:space-between;gap:8px">
            <span class="am-de">${esc(nome)}</span>
            <span class="am-hora">${esc(horaCurta(m.criada_em))}</span>
          </span>
          <span class="am-assunto" style="display:block">
            ${m.de_orgao && naEntrada
              ? '<span class="am-selo am-selo-orgao" style="margin-right:6px">Órgão</span>' : ''}
            ${esc(m.assunto)}
          </span>
          <span class="am-excerto" style="display:block">
            ${nAnexos ? `<span class="am-icone am-icone-16 i-anexo"
                 aria-label="${nAnexos} anexo(s)"></span> ` : ''}
            ${esc(m.excerto || '')}
          </span>
        </span>
      </button>`;
  }).join('');

  elLista.querySelectorAll('.am-item').forEach((b) => {
    b.addEventListener('click', () => abrir(b.dataset.id));
  });
}

function marcarConta(porLer) {
  elConta.textContent = porLer > 0 ? String(porLer) : '';
}

async function carregar(manterAberta) {
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
  marcarConta(r.dados.por_ler);
  if (!manterAberta) {
    estado.abertaId = null;
    limparLeitura();
  }
  desenharLista();
}

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

  const recebida = m.para === estado.eu;
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
      <button type="button" class="am-botao" id="btn-responder">
        <span class="am-icone i-responder" aria-hidden="true"></span>Responder
      </button>
      ${recebida ? `
        <button type="button" class="am-botao am-botao-linha" id="btn-por-ler">
          <span class="am-icone i-envelope" aria-hidden="true"></span>Marcar por ler
        </button>` : ''}
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

  document.getElementById('btn-responder')
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

  // Abrir é ler. Marca-se depois de mostrar, para o ecrã não esperar pela rede.
  if (recebida && !m.lido) await marcarLido(m.id, true);
  desenharLista();
}

// A citação entra no editor já como HTML — e passa pela mesma limpeza que
// tudo o resto. Citar uma mensagem hostil não pode ser a maneira de a
// executar na página de quem responde.
function citar(m, quem) {
  const dentro = m.formato === 'html'
    ? limparHtml(m.corpo)
    : '<p>' + esc(m.corpo).replace(/\n/g, '<br>') + '</p>';
  return '<p><br></p><blockquote><p>' + esc(quem) + ' escreveu a '
    + esc(formatarDataHora(m.criada_em)) + ':</p>' + dentro + '</blockquote>';
}

async function marcarLido(id, lido) {
  const r = await api('correio_marcar_lido', { p_id: id, p_lido: lido });
  if (!r.ok) return;
  const m = estado.linhas.find((x) => x.id === id);
  if (m) m.lido = lido;
  marcarConta(r.dados.por_ler);
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
let anexos = [];        // { nome, tamanho, tipo, caminho, estado }
let enviadaComSucesso = false;

// ── o editor ───────────────────────────────────────────────────────
// `execCommand` está marcado como obsoleto e não tem substituto: a API que
// o havia de substituir nunca chegou a existir em todos os browsers. Sem
// passo de compilação, é isto ou um editor de biblioteca — e para negrito,
// listas e ligações, o que o browser traz chega bem.
try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) { /* browser antigo */ }

function marcarVazio() {
  editor.dataset.vazio = String(editor.textContent.trim() === '');
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
  document.getElementById('ajuda-anexos').hidden = anexos.length === 0;
  elAnexos.innerHTML = anexos.map((a, i) => `
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
    if (anexos.length >= MAX_ANEXOS) {
      mostrarMsg(msgNova, `No máximo ${MAX_ANEXOS} anexos por mensagem.`, 'aviso');
      break;
    }
    const item = {
      nome: nomeSeguro(f.name), tamanho: f.size, tipo: tipoDe(f),
      caminho: null, estado: 'a-enviar', erro: null,
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

    // A pasta é um uuid para dois ficheiros com o mesmo nome não se
    // pisarem — e o `upsert` fica desligado por isso mesmo.
    const pasta = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2);
    const caminho = estado.eu + '/' + pasta + '/' + item.nome;

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

function abrirNova(opcoes) {
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
  if (editor.textContent.trim() === '') {
    mostrarMsg(msgNova, 'A mensagem está vazia.', 'erro');
    editor.focus();
    return;
  }

  btn.disabled = true;
  mostrarMsg(msgNova, 'A enviar…');

  const r = await api('correio_enviar', {
    p_para_cedula: campoPara.value.trim(),
    p_assunto: campoAssunto.value,
    // Limpo aqui e recusado outra vez no servidor. Não é desconfiança do
    // editor: é que o servidor não pode acreditar em nada que venha daqui.
    p_corpo: limparHtml(editor.innerHTML),
    p_resposta_a: respostaA,
    p_formato: 'html',
    p_anexos: anexos.map((a) => a.caminho),
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
  document.getElementById('titulo-caixa').textContent =
    caixa === 'enviados' ? 'Enviados' : 'Entrada';
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
