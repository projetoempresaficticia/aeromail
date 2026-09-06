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
          <span class="am-excerto" style="display:block">${esc(m.corpo)}</span>
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
      <p style="white-space:pre-wrap">${esc(m.corpo)}</p>
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

  document.getElementById('btn-responder')
    .addEventListener('click', () => abrirNova({
      para: ced,
      nome,
      // Só se responde ao que se recebeu — é o que a RPC exige, e faz
      // sentido: uma mensagem que eu enviei não é um fio que me responda.
      assunto: /^re:/i.test(m.assunto) ? m.assunto : 'Re: ' + m.assunto,
      respostaA: recebida ? m.id : null,
      citado: m.corpo,
      quem: nome,
      quando: m.criada_em,
    }));

  const btnPorLer = document.getElementById('btn-por-ler');
  if (btnPorLer) btnPorLer.addEventListener('click', () => marcarLido(m.id, false));

  // Abrir é ler. Marca-se depois de mostrar, para o ecrã não esperar pela rede.
  if (recebida && !m.lido) await marcarLido(m.id, true);
  desenharLista();
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

// ── nova mensagem ──────────────────────────────────────────────────
const janelaNova = document.getElementById('janela-nova');
const campoPara = document.getElementById('para');
const campoAssunto = document.getElementById('assunto');
const campoCorpo = document.getElementById('corpo');
const msgNova = document.getElementById('msg-nova');
let respostaA = null;
let contactosCarregados = false;

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
  campoPara.value = o.para || '';
  campoAssunto.value = o.assunto || '';
  campoCorpo.value = o.citado
    ? '\n\n— — —\n' + o.quem + ' escreveu a ' + formatarDataHora(o.quando) + ':\n'
      + o.citado.split('\n').map((l) => '> ' + l).join('\n')
    : '';
  mostrarMsg(msgNova, '');
  document.getElementById('titulo-nova').textContent =
    respostaA ? 'Responder' : 'Nova mensagem';
  carregarContactos();
  abrirJanela('janela-nova');
  (o.para ? campoCorpo : campoPara).focus();
  if (o.para) campoCorpo.setSelectionRange(0, 0);
}

document.getElementById('btn-nova').addEventListener('click', () => abrirNova());

document.getElementById('form-nova').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const btn = document.getElementById('btn-enviar');
  btn.disabled = true;
  mostrarMsg(msgNova, 'A enviar…');

  const r = await api('correio_enviar', {
    p_para_cedula: campoPara.value.trim(),
    p_assunto: campoAssunto.value,
    p_corpo: campoCorpo.value,
    p_resposta_a: respostaA,
  });
  btn.disabled = false;

  if (!r.ok) {
    mostrarMsg(msgNova, r.erro, 'erro');
    return;
  }
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
      // a linha crua não traz os nomes nem a marca de órgão, que a RPC
      // calcula. Manter a mensagem aberta aberta.
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
  const { data } = await sb.auth.getSession();
  if (data.session) await entrar();
  else areaEntrada.hidden = false;
})();
