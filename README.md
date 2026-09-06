# AeroMail — Prepara Portugal

O **correio interno** do ecossistema: comunicação formal entre as pessoas do
projeto, por cédula. Não é o email das empresas — nada sai para a internet.

Ainda só tem a **biblioteca de design**: `biblioteca.html`.

- Paleta auditada contra a WCAG 2.1. O kit está quase todo certo: a turquesa
  `#0F766E` serve para escrever *e* para preencher, o que é raro. Só o
  vermelho `#DC4C4C` falha (4,05:1) e foi escurecido para `#C0392B`.
- Ícones por máscara, para seguirem a cor do texto em qualquer fundo.
  **Faltam doze** — envelope, enviar, anexo, lixo, estrela e outros que um
  correio precisa e o conjunto dos órgãos do Estado não tinha.

A tabela `correio` e o Realtime já existem na base; faltam as políticas de
RLS (hoje nega tudo) e as quatro RPC.

Antes chamava-se `pp-correio`.
