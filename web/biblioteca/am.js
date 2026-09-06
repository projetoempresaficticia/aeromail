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
