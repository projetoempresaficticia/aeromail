// AeroMail — utilitários da biblioteca deste app.
// O cliente Supabase (`sb`) e o `api()` vêm do comum.js da pp-base.

// Escapar o que vem da base antes de o pôr em innerHTML. Aqui isto conta
// mais do que nos outros apps: o corpo de uma mensagem é texto que outra
// pessoa escreveu de propósito.
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function mostrarMsg(el, texto, tipo) {
  if (!el) return;
  el.textContent = texto || '';
  el.className = 'am-msg' + (tipo ? ' am-msg-' + tipo : '');
}

function formatarDataHora(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-PT', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// Na lista não cabe a data toda. Hoje mostra-se a hora — é o que distingue
// duas mensagens de hoje; noutro dia mostra-se o dia, que é o que distingue
// duas de dias diferentes. Cada caso mostra o campo que decide.
function horaCurta(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const agora = new Date();
  const mesmoDia = d.toDateString() === agora.toDateString();
  if (mesmoDia) {
    return d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  }
  const mesmoAno = d.getFullYear() === agora.getFullYear();
  return d.toLocaleDateString('pt-PT', mesmoAno
    ? { day: '2-digit', month: 'short' }
    : { day: '2-digit', month: '2-digit', year: '2-digit' });
}

// ── avatar ─────────────────────────────────────────────────────────
// A cédula é única e nunca muda, por isso serve de semente: a mesma pessoa
// tem sempre a mesma cor, em qualquer ecrã e em qualquer sessão. Não é
// decoração — é o que deixa reconhecer um remetente antes de ler o nome.
//
// Todas as cores da lista têm contraste suficiente com o branco por cima
// (>= 4,5:1). Uma cor clara aqui obrigaria a texto escuro nalgumas e claro
// noutras, e a inicial deixaria de se ler numa delas.
const AM_CORES = [
  '#0F766E', '#1D4ED8', '#A21CAF', '#B45309',
  '#BE123C', '#4338CA', '#15803D', '#0E7490',
];

function corDaCedula(cedula) {
  const s = String(cedula || '');
  let n = 0;
  for (let i = 0; i < s.length; i += 1) n = (n * 31 + s.charCodeAt(i)) % 100000;
  return AM_CORES[n % AM_CORES.length];
}

function iniciaisDe(nome) {
  const partes = String(nome || '?').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

function avatar(cedula, nome) {
  return `<span class="am-avatar" aria-hidden="true"
    style="background:${corDaCedula(cedula)}">${esc(iniciaisDe(nome))}</span>`;
}

// ── quem sou ───────────────────────────────────────────────────────
async function quemSou() {
  const { data } = await sb.auth.getSession();
  if (!data.session) return null;
  const { data: pessoa } = await sb
    .from('pessoas').select('cedula, nome, papel, empresa_id')
    .eq('id', data.session.user.id).single();
  if (!pessoa) return null;
  let empresa = null;
  if (pessoa.empresa_id) {
    const { data: e } = await sb
      .from('empresas').select('cedula, nome').eq('id', pessoa.empresa_id).single();
    empresa = e || null;
  }
  return { pessoa, empresa };
}

// ── versão do site nos links internos ──────────────────────────────
// O GitHub Pages guarda o HTML dez minutos e não deixa mudar isso. Um link
// para o endereço nu vai buscar a cópia velha dessa página, que por sua vez
// nomeia o JS e o CSS velhos — e a correção parece não pegar.
function versaoDoSite() {
  const m = document.querySelector('meta[name="am-versao"]');
  return (m && m.content) ? m.content : '';
}

function comVersao(href) {
  const v = versaoDoSite();
  if (!v || /^https?:/.test(href)) return href;
  return href + (href.includes('?') ? '&' : '?') + 'v=' + encodeURIComponent(v);
}

function versionarLinks() {
  document.querySelectorAll('a[href$=".html"]').forEach((a) => {
    const h = a.getAttribute('href');
    if (!h || /^https?:/.test(h) || h.includes('v=')) return;
    a.setAttribute('href', comVersao(h));
  });
}
document.addEventListener('DOMContentLoaded', versionarLinks);

// ── entrada ────────────────────────────────────────────────────────
function ligarVerSenha() {
  const btn = document.getElementById('btn-ver-senha');
  const campo = document.getElementById('senha');
  if (!btn || !campo) return;
  btn.addEventListener('click', () => {
    const aMostrar = campo.type === 'password';
    campo.type = aMostrar ? 'text' : 'password';
    btn.textContent = aMostrar ? 'Esconder' : 'Mostrar';
    btn.setAttribute('aria-pressed', String(aMostrar));
    campo.focus();
  });
}

function ligarFormularioLogin(aoEntrar) {
  const form = document.getElementById('form-login');
  if (!form) return;
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const msg = document.getElementById('msg-login');
    const btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    mostrarMsg(msg, 'A entrar…');
    const { error } = await sb.auth.signInWithPassword({
      email: document.getElementById('email').value,
      password: document.getElementById('senha').value,
    });
    if (btn) btn.disabled = false;
    if (error) {
      mostrarMsg(msg, 'Email ou senha errados.', 'erro');
      return;
    }
    mostrarMsg(msg, '');
    await aoEntrar();
  });
}

// ── janelas ────────────────────────────────────────────────────────
// <dialog> nativo: já traz a armadilha de foco, o Escape e o fundo inerte.
// Escrever isto à mão dá sempre pior.
function abrirJanela(id) {
  const d = document.getElementById(id);
  if (d && !d.open) d.showModal();
  return d;
}

function ligarFechos() {
  document.querySelectorAll('[data-fechar]').forEach((b) => {
    b.addEventListener('click', () => {
      const d = document.getElementById(b.dataset.fechar);
      if (d) d.close();
    });
  });
}
document.addEventListener('DOMContentLoaded', ligarFechos);

// ── limpar HTML por lista branca ───────────────────────────────────
// Desenhar no ecrã o HTML que outra pessoa escreveu é a porta clássica do
// XSS. A limpeza faz-se num documento à parte, e não com innerHTML num
// <div> da página: esse documento é INERTE — nada corre lá dentro, nem
// sequer o `onerror` de uma <img> partida, que é o truque com que este tipo
// de filtro costuma ser furado enquanto se escreve.
//
// Lista branca, nunca lista negra: o que não está aqui não passa. A função
// correio_enviar recusa o mesmo conjunto do lado do servidor — são duas
// peças a dizer o mesmo, de propósito.
const AM_ETIQUETAS = {
  B: 1, STRONG: 1, I: 1, EM: 1, U: 1, S: 1, A: 1, BR: 1,
  P: 1, UL: 1, OL: 1, LI: 1, BLOCKQUOTE: 1,
};

function limparNo(pai) {
  Array.from(pai.childNodes).forEach((no) => {
    if (no.nodeType === 3) return;                       // texto fica
    if (no.nodeType !== 1) { no.remove(); return; }      // comentários fora

    // Em maiúsculas de propósito. Uma <svg> ou <math> traz filhos de outro
    // espaço de nomes, onde o tagName mantém a caixa original: lá dentro um
    // <script> chama-se mesmo 'script', e comparar com 'SCRIPT' deixava-o
    // cair no ramo de desembrulhar — o código dele ficava no ecrã como
    // texto. Foi assim que o teste em jsdom o apanhou.
    const etiqueta = String(no.tagName || '').toUpperCase();

    limparNo(no);                                        // os filhos primeiro

    if (etiqueta === 'SCRIPT' || etiqueta === 'STYLE') {
      no.remove();                                       // aqui o mal é o conteúdo
      return;
    }
    if (!AM_ETIQUETAS[etiqueta]) {
      // Desembrulhar, não apagar: um <div> a mais nao devia comer o texto
      // que estava lá dentro.
      while (no.firstChild) pai.insertBefore(no.firstChild, no);
      no.remove();
      return;
    }

    // De atributos só sobrevive o href de uma <a>. Nada de style, nada de
    // on*, nada de class: uma classe nossa numa mensagem de fora podia
    // fazer-se passar por um aviso do sistema.
    Array.from(no.attributes).forEach((at) => {
      if (etiqueta === 'A' && at.name.toLowerCase() === 'href') return;
      no.removeAttribute(at.name);
    });

    if (etiqueta === 'A') {
      const h = (no.getAttribute('href') || '').trim();
      if (!/^(https?:|mailto:)/i.test(h)) {
        no.removeAttribute('href');                      // javascript:, data:, tudo
      } else {
        no.setAttribute('target', '_blank');
        no.setAttribute('rel', 'noopener noreferrer nofollow');
      }
    }
  });
}

function limparHtml(html) {
  // `createHTMLDocument` e não `new DOMParser()`: o documento sai igualmente
  // inerte, mas já vem com o <body> montado, sem depender de o analisador
  // decidir bem onde meter um fragmento solto. A pôr à prova em jsdom, essa
  // decisão mostrou não ser a mesma em toda a parte.
  const doc = document.implementation.createHTMLDocument('');
  doc.body.innerHTML = String(html == null ? '' : html);
  limparNo(doc.body);
  return doc.body.innerHTML;
}

// O corpo de uma mensagem, pronto a desenhar. Texto simples leva escape
// total; HTML leva a lista branca. A decisão é do campo `formato`, que o
// servidor guarda — nunca de adivinhar pelo conteúdo.
function corpoDesenhado(corpo, formato) {
  if (formato === 'html') {
    return '<div class="am-corpo">' + limparHtml(corpo) + '</div>';
  }
  return '<div class="am-corpo am-corpo-texto">' + esc(corpo) + '</div>';
}

// ── ficheiros ──────────────────────────────────────────────────────
function formatarTamanho(bytes) {
  const n = Number(bytes || 0);
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1048576).toFixed(1).replace('.', ',') + ' MB';
}

// O nome do ficheiro vira parte do caminho no Storage, e o caminho é de
// onde a base tira o nome a mostrar. Tirar acentos e espaços aqui evita
// caminhos que o Storage recusa — e o nome continua a ler-se.
function nomeSeguro(nome) {
  const n = String(nome || 'ficheiro')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-').replace(/^[-.]+/, '');
  return (n || 'ficheiro').slice(-80);
}

function iconeDoTipo(tipo) {
  const t = String(tipo || '');
  if (t.startsWith('image/')) return 'i-imagem';
  if (t === 'application/pdf') return 'i-documento';
  return 'i-anexo';
}
