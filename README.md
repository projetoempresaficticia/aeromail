# AeroMail — Prepara Portugal

O **correio interno** do ecossistema: comunicação formal entre as pessoas do
projeto, por cédula. Não é o email das empresas — nada sai para a internet.

Ainda só tem a **biblioteca de design**: `biblioteca.html`.

- Paleta auditada contra a WCAG 2.1. O kit está quase todo certo: a turquesa
  `#0F766E` serve para escrever *e* para preencher, o que é raro. Só o
  vermelho `#DC4C4C` falha (4,05:1) e foi escurecido para `#C0392B`.
- **159 ícones** descarregados do Figma: as duas famílias de interface do
  ficheiro (*User Interface* e *Arrows & Directions*). O resto do ficheiro
  são logótipos de marcas. Ficam com o nome de origem; a tradução para
  português vive nas classes `.i-*` do CSS, que é para isso que a máscara
  serve de indireção.

## SQL

- `0001_correio.sql` — políticas de RLS (a tabela tinha RLS ligada e zero
  políticas, ou seja negava tudo) e as três RPC: enviar, caixa, marcar lido.
  O remetente sai sempre de `auth.uid()`, nunca de um parâmetro.
- `0002_notifica_submissao.sql` — os órgãos passam a avisar **quem submeteu
  e quem assinou**, por gatilho no protocolo. Nenhum órgão sabe que o
  correio existe.

Antes chamava-se `pp-correio`.
