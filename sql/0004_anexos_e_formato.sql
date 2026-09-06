-- AeroMail: anexos e texto com formatação.
--
-- DUAS COISAS PERIGOSAS DE UMA VEZ, e é bom dizer porquê antes do código.
--
-- 1. FICHEIROS. O caminho é `<cédula de quem envia>/<uuid>/<nome>`. Quem
--    envia escreve na sua própria pasta e mais nenhuma; quem recebe lê o
--    que lhe foi anexado e mais nada. A pasta uuid existe para dois
--    ficheiros com o mesmo nome não se pisarem.
--
--    O browser manda só o CAMINHO. O nome, o tamanho e o tipo saem do
--    `storage.objects` — se viessem do cliente, qualquer um declarava um
--    anexo de 2 KB que afinal pesa 40 MB, e a lista mentia ao destinatário.
--    De caminho, o cliente também não pode mentir: a função confirma que o
--    ficheiro existe mesmo e que está na pasta dele.
--
-- 2. HTML. Guardar o que outra pessoa escreveu e desenhá-lo no ecrã é a
--    porta clássica do XSS. A defesa a sério é a limpeza por lista branca
--    no browser, ao desenhar (`limparHtml` no am.js) — mas guardar lixo e
--    limpá-lo depois é confiar demais numa peça só. Por isso esta função
--    RECUSA à entrada tudo o que não seja das onze etiquetas permitidas,
--    e recusa atributos de evento, `javascript:` e `style=`.
--
--    Mensagens antigas e as dos órgãos ficam em `formato = 'texto'`: são
--    texto simples e assim continuam a ser desenhadas com escape total.
--
-- Aplicada ao Supabase do projeto (moxxbehwylcjaqjacmyh) em 2026-09-06.

-- ── o formato do corpo ──────────────────────────────────────────────
alter table public.correio
  add column if not exists formato text not null default 'texto';

alter table public.correio drop constraint if exists correio_formato_valido;
alter table public.correio add constraint correio_formato_valido
  check (formato in ('texto', 'html'));


-- ── os anexos ───────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('correio', 'correio', false, 5242880, array[
  'application/pdf',
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'text/plain', 'text/csv', 'text/xml', 'application/xml',
  'application/zip',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.correio_anexos (
  id          uuid primary key default gen_random_uuid(),
  mensagem_id uuid not null references public.correio(id) on delete cascade,
  caminho     text not null unique,
  nome        text not null,
  tamanho     bigint not null,
  tipo        text,
  criado_em   timestamptz not null default now()
);

create index if not exists correio_anexos_mensagem on public.correio_anexos(mensagem_id);

alter table public.correio_anexos enable row level security;

-- Um anexo vê-se se a mensagem dele se vir. A regra de quem vê o quê já
-- está escrita uma vez, na tabela `correio`; repeti-la aqui era arranjar
-- maneira de as duas divergirem.
drop policy if exists "vejo os anexos das mensagens que vejo" on public.correio_anexos;
create policy "vejo os anexos das mensagens que vejo"
  on public.correio_anexos for select
  using (exists (
    select 1 from public.correio c
     where c.id = mensagem_id
       and (public.fn_e_professor()
            or c.de_cedula = public.fn_minha_cedula()
            or c.para_cedula = public.fn_minha_cedula())));


-- ── quem chega ao ficheiro ──────────────────────────────────────────
-- A policy de Storage corre como quem chama; este helper é security
-- definer e faz a ponte, como o fn_fisco_visivel da AT.
create or replace function public.fn_anexo_correio_visivel(p_caminho text)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_eu text;
begin
  if auth.uid() is null then
    return false;
  end if;
  if public.fn_e_professor() then
    return true;
  end if;
  v_eu := public.fn_minha_cedula();
  if v_eu is null then
    return false;
  end if;

  -- quem enviou vê sempre o que pôs na sua pasta, mesmo antes de enviar
  if split_part(p_caminho, '/', 1) = v_eu then
    return true;
  end if;

  -- quem recebeu vê o que lhe foi anexado, e só isso
  return exists (
    select 1
      from public.correio_anexos a
      join public.correio c on c.id = a.mensagem_id
     where a.caminho = p_caminho
       and c.para_cedula = v_eu);
end;
$$;

revoke execute on function public.fn_anexo_correio_visivel(text) from public, anon;
grant execute on function public.fn_anexo_correio_visivel(text) to authenticated;

drop policy if exists "anexo: escrevo na minha pasta" on storage.objects;
create policy "anexo: escrevo na minha pasta"
  on storage.objects for insert
  with check (
    bucket_id = 'correio'
    and (storage.foldername(name))[1] = public.fn_minha_cedula()
  );

drop policy if exists "anexo: leio o que me diz respeito" on storage.objects;
create policy "anexo: leio o que me diz respeito"
  on storage.objects for select
  using (
    bucket_id = 'correio'
    and public.fn_anexo_correio_visivel(name)
  );

-- Só se apaga o que ainda não foi enviado. Depois de a mensagem sair, o
-- anexo é do destinatário tanto como de quem o mandou: deixá-lo
-- desaparecer por baixo dele seria reescrever o passado.
drop policy if exists "anexo: apago o que ainda nao enviei" on storage.objects;
create policy "anexo: apago o que ainda nao enviei"
  on storage.objects for delete
  using (
    bucket_id = 'correio'
    and (storage.foldername(name))[1] = public.fn_minha_cedula()
    and not exists (select 1 from public.correio_anexos a where a.caminho = name)
  );


-- ── enviar ──────────────────────────────────────────────────────────
-- A assinatura muda. `create or replace` só substitui em igualdade exata
-- de assinatura, por isso a versão de quatro argumentos SOBREVIVERIA ao
-- lado desta — e uma chamada com quatro argumentos nomeados ficaria
-- ambígua. Já apanhámos sobrecargas mortas neste projeto: esta cai agora.
drop function if exists public.correio_enviar(text, text, text, uuid);

create or replace function public.correio_enviar(
  p_para_cedula text,
  p_assunto text,
  p_corpo text,
  p_resposta_a uuid,
  p_formato text default 'texto',
  p_anexos jsonb default '[]'::jsonb   -- lista de caminhos, e mais nada
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_de      text := public.fn_minha_cedula();
  v_para    record;
  v_id      uuid := gen_random_uuid();
  v_formato text := coalesce(p_formato, 'texto');
  v_caminho text;
  v_obj     record;
  v_n       int := 0;
begin
  if v_de is null then
    return jsonb_build_object('ok', false, 'erro', 'Sem ficha na Carteirinha.');
  end if;
  if coalesce(p_assunto, '') = '' then
    return jsonb_build_object('ok', false, 'erro', 'A mensagem precisa de assunto.');
  end if;
  if coalesce(p_corpo, '') = '' then
    return jsonb_build_object('ok', false, 'erro', 'A mensagem está vazia.');
  end if;
  if length(p_assunto) > 200 then
    return jsonb_build_object('ok', false, 'erro', 'Assunto demasiado longo (máximo 200).');
  end if;
  if length(p_corpo) > 40000 then
    return jsonb_build_object('ok', false, 'erro', 'Mensagem demasiado longa.');
  end if;
  if v_formato not in ('texto', 'html') then
    return jsonb_build_object('ok', false, 'erro', 'Formato desconhecido.');
  end if;

  -- ── a lista branca de etiquetas ───────────────────────────────────
  if v_formato = 'html' then
    if exists (
      select 1 from regexp_matches(p_corpo, '</?\s*([a-zA-Z0-9-]+)', 'g') m
       where lower(m[1]) not in
         ('b','strong','i','em','u','s','a','br','p','ul','ol','li','blockquote'))
    then
      return jsonb_build_object('ok', false, 'erro',
        'A mensagem tem formatação que não é permitida.');
    end if;
    -- Dentro de uma etiqueta, e só aí. Solto no texto, `\son[a-z]+\s*=`
    -- apanhava "o valor online = 30" e "diz-me onde = o encontro", e a
    -- mensagem honesta era recusada sem que ninguém percebesse porquê.
    if p_corpo ~* '<[^>]*\son[a-z]+\s*='
       or p_corpo ~* '<[^>]*\sstyle\s*='
       or p_corpo ~* '<[^>]*(href|src)\s*=\s*["'']?\s*(javascript|data|vbscript):'
    then
      return jsonb_build_object('ok', false, 'erro',
        'A mensagem tem formatação que não é permitida.');
    end if;
  end if;

  select cedula, nome into v_para from public.pessoas
   where cedula = upper(btrim(p_para_cedula)) and estado = 'ativa';
  if v_para.cedula is null then
    return jsonb_build_object('ok', false, 'erro',
      'Não há ninguém ativo com essa cédula.');
  end if;
  if v_para.cedula = v_de then
    return jsonb_build_object('ok', false, 'erro', 'Não pode escrever para si próprio.');
  end if;

  if p_resposta_a is not null and not exists (
       select 1 from public.correio
        where id = p_resposta_a and para_cedula = v_de) then
    return jsonb_build_object('ok', false, 'erro',
      'Só pode responder a uma mensagem que recebeu.');
  end if;

  if jsonb_typeof(coalesce(p_anexos, '[]'::jsonb)) <> 'array' then
    return jsonb_build_object('ok', false, 'erro', 'Lista de anexos inválida.');
  end if;
  if jsonb_array_length(coalesce(p_anexos, '[]'::jsonb)) > 5 then
    return jsonb_build_object('ok', false, 'erro', 'No máximo 5 anexos por mensagem.');
  end if;

  insert into public.correio(id, de_cedula, para_cedula, assunto, corpo, resposta_a, formato)
  values (v_id, v_de, v_para.cedula, btrim(p_assunto), p_corpo, p_resposta_a, v_formato);

  -- ── os anexos ─────────────────────────────────────────────────────
  for v_caminho in
    select jsonb_array_elements_text(coalesce(p_anexos, '[]'::jsonb))
  loop
    if split_part(v_caminho, '/', 1) <> v_de then
      raise exception 'anexo fora da pasta';
    end if;

    select name, metadata into v_obj
      from storage.objects
     where bucket_id = 'correio' and name = v_caminho;
    if v_obj.name is null then
      raise exception 'anexo inexistente';
    end if;

    insert into public.correio_anexos(mensagem_id, caminho, nome, tamanho, tipo)
    values (
      v_id,
      v_caminho,
      -- o nome é o último pedaço do caminho: é assim que o browser o grava
      regexp_replace(v_caminho, '^.*/', ''),
      coalesce((v_obj.metadata->>'size')::bigint, 0),
      v_obj.metadata->>'mimetype');
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('ok', true, 'dados', jsonb_build_object(
    'id', v_id, 'para', v_para.cedula, 'nome', v_para.nome, 'anexos', v_n));
exception when others then
  -- Sem sqlerrm: o erro cru do Postgres não vai ao browser (R1 da pp-base).
  -- O `insert` e os anexos estão na mesma transação: se um anexo falhar, a
  -- mensagem não fica enviada sem ele.
  return jsonb_build_object('ok', false, 'erro',
    'Não foi possível enviar a mensagem. Confirme os anexos.');
end;
$$;

revoke execute on function public.correio_enviar(text, text, text, uuid, text, jsonb)
  from public, anon;
grant execute on function public.correio_enviar(text, text, text, uuid, text, jsonb)
  to authenticated;


-- ── o texto por baixo da formatação ─────────────────────────────────
-- Serve a lista (excerto de 160) e a procura (o corpo todo). É a MESMA
-- função nos dois sítios, com um limite por omissão: duas funções quase
-- iguais acabariam a devolver textos diferentes para a mesma mensagem, e
-- a procura encontrava o que a lista não mostrava.
create or replace function public.fn_correio_excerto(
  p_corpo text,
  p_formato text,
  p_limite int default 160
)
returns text
language sql
immutable
set search_path = public
as $$
  select left(btrim(regexp_replace(
    case when coalesce(p_formato, 'texto') = 'html'
         then replace(replace(replace(replace(
                regexp_replace(coalesce(p_corpo, ''), '<[^>]*>', ' ', 'g'),
                '&nbsp;', ' '), '&lt;', '<'), '&gt;', '>'), '&amp;', '&')
         else coalesce(p_corpo, '')
    end, '\s+', ' ', 'g')), greatest(p_limite, 1));
$$;

revoke execute on function public.fn_correio_excerto(text, text, int)
  from public, anon, authenticated;


-- ── a caixa, agora com anexos, formato e excerto ────────────────────
-- O excerto passa a vir daqui. Feito no browser, obrigava cada linha da
-- lista a carregar o corpo inteiro só para deitar fora as etiquetas — e
-- uma lista de mensagens formatadas mostrava "<p>Bom dia" a quem a lesse.
create or replace function public.correio_caixa(
  p_caixa text,
  p_procura text,
  p_so_por_ler boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_eu     text := public.fn_minha_cedula();
  v_linhas jsonb;
  v_por_ler int;
begin
  if v_eu is null then
    return jsonb_build_object('ok', false, 'erro', 'Sem ficha na Carteirinha.');
  end if;
  if coalesce(p_caixa, 'entrada') not in ('entrada', 'enviados') then
    return jsonb_build_object('ok', false, 'erro', 'Caixa desconhecida.');
  end if;

  select jsonb_agg(jsonb_build_object(
           'id', c.id,
           'de', c.de_cedula,
           'de_nome', public.fn_nome_de(c.de_cedula),
           'de_orgao', exists (
             select 1 from public.orgao_tipos ot
               join public.contas ct on ct.iban = ot.iban_orgao
              where ct.cedula = c.de_cedula),
           'para', c.para_cedula,
           'para_nome', public.fn_nome_de(c.para_cedula),
           'assunto', c.assunto,
           'corpo', c.corpo,
           'formato', c.formato,
           'excerto', public.fn_correio_excerto(c.corpo, c.formato),
           'lido', c.lido,
           'resposta_a', c.resposta_a,
           'criada_em', c.criada_em,
           'anexos', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', a.id, 'caminho', a.caminho, 'nome', a.nome,
                      'tamanho', a.tamanho, 'tipo', a.tipo)
                    order by a.nome)
               from public.correio_anexos a
              where a.mensagem_id = c.id), '[]'::jsonb))
         order by c.criada_em desc)
    into v_linhas
    from public.correio c
   where (case when coalesce(p_caixa,'entrada') = 'enviados'
               then c.de_cedula else c.para_cedula end) = v_eu
     and (not coalesce(p_so_por_ler, false) or c.lido = false)
     and (coalesce(p_procura, '') = ''
          or c.assunto ilike '%' || p_procura || '%'
          -- procurar no texto visível, não nas etiquetas: senão "li"
          -- encontrava todas as mensagens com listas
          or public.fn_correio_excerto(c.corpo, c.formato, 40000)
               ilike '%' || p_procura || '%'
          or public.fn_nome_de(c.de_cedula) ilike '%' || p_procura || '%'
          or exists (select 1 from public.correio_anexos a
                      where a.mensagem_id = c.id
                        and a.nome ilike '%' || p_procura || '%'));

  select count(*) into v_por_ler
    from public.correio where para_cedula = v_eu and lido = false;

  return jsonb_build_object('ok', true, 'dados', jsonb_build_object(
    'caixa', coalesce(p_caixa, 'entrada'),
    'eu', v_eu,
    'por_ler', v_por_ler,
    'linhas', coalesce(v_linhas, '[]'::jsonb)));
exception when others then
  return jsonb_build_object('ok', false, 'erro', 'Não foi possível abrir a caixa.');
end;
$$;

revoke execute on function public.correio_caixa(text, text, boolean) from public, anon;
grant execute on function public.correio_caixa(text, text, boolean) to authenticated;
