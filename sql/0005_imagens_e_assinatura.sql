-- AeroMail: imagens no corpo da mensagem, e a assinatura de cada pessoa.
--
-- O CORPO NUNCA LEVA O ENDEREÇO DA IMAGEM. É a decisão que manda em tudo o
-- resto, e vale a pena dizer porquê: se o corpo pudesse trazer
-- `<img src="https://...">`, quem escreve punha lá um endereço de um
-- servidor seu e ficava a saber a que horas cada pessoa abriu a mensagem, e
-- de que IP. É o pixel de rastreio, e num sistema onde se aprende a
-- trabalhar a sério não tem lugar.
--
-- Em vez disso o corpo leva `<img data-anexo="<caminho>">` — uma referência
-- a um anexo DA PRÓPRIA MENSAGEM. O `src` é preenchido pela app, ao
-- desenhar, com um endereço assinado de curta duração. Uma imagem cujo
-- endereço é sempre a app a decidir não pode apontar para lado nenhum.
--
-- Daí as três regras novas, verificadas aqui:
--   1. `<img>` com `src=` é recusada;
--   2. `<img>` sem `data-anexo` é recusada;
--   3. cada `data-anexo` tem de estar entre os anexos desta mensagem —
--      não se referencia o ficheiro de outra pessoa nem de outra mensagem.
--
-- A ASSINATURA é uma imagem guardada uma vez e copiada para dentro de cada
-- mensagem que a usa. Copiar em vez de apontar para a mesma: assim a
-- mensagem guarda a assinatura com que foi enviada, e trocar de assinatura
-- hoje não reescreve o que se mandou no mês passado. São uns kilobytes.
--
-- ISTO NÃO É UMA ASSINATURA DIGITAL. É uma imagem num email, como o nome
-- escrito no fim de uma carta. Quem assina documentos é o Subsight, com
-- hash e slots — e é o Cartório que lhes dá fé pública. A app diz isto por
-- escrito a quem carrega a imagem, para ninguém confundir as duas coisas.
--
-- Aplicada ao Supabase do projeto (moxxbehwylcjaqjacmyh) em 2026-09-06.

-- ── um anexo pode ser mostrado dentro do corpo ──────────────────────
alter table public.correio_anexos
  add column if not exists inline boolean not null default false;


-- ── a assinatura guardada de cada pessoa ────────────────────────────
create table if not exists public.correio_assinaturas (
  cedula          text primary key,
  caminho         text not null,
  actualizada_em  timestamptz not null default now()
);

alter table public.correio_assinaturas enable row level security;

-- Só a própria. A assinatura que os outros veem é a cópia que viaja dentro
-- da mensagem, não esta — esta é o molde.
drop policy if exists "vejo a minha assinatura" on public.correio_assinaturas;
create policy "vejo a minha assinatura"
  on public.correio_assinaturas for select
  using (cedula = public.fn_minha_cedula() or public.fn_e_professor());


create or replace function public.correio_assinatura_guardar(p_caminho text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_eu  text := public.fn_minha_cedula();
  v_obj record;
  v_velho text;
begin
  if v_eu is null then
    return jsonb_build_object('ok', false, 'erro', 'Sem ficha na Carteirinha.');
  end if;
  if split_part(coalesce(p_caminho, ''), '/', 1) <> v_eu then
    return jsonb_build_object('ok', false, 'erro', 'Essa imagem não é sua.');
  end if;

  select name, metadata into v_obj
    from storage.objects
   where bucket_id = 'correio' and name = p_caminho;
  if v_obj.name is null then
    return jsonb_build_object('ok', false, 'erro', 'A imagem não chegou a ser carregada.');
  end if;
  if coalesce(v_obj.metadata->>'mimetype', '') not like 'image/%' then
    return jsonb_build_object('ok', false, 'erro', 'A assinatura tem de ser uma imagem.');
  end if;
  -- 300 KB chega e sobra para uma assinatura; a app já reduz antes de subir.
  if coalesce((v_obj.metadata->>'size')::bigint, 0) > 307200 then
    return jsonb_build_object('ok', false, 'erro', 'Imagem demasiado grande para assinatura.');
  end if;

  select caminho into v_velho from public.correio_assinaturas where cedula = v_eu;

  insert into public.correio_assinaturas(cedula, caminho, actualizada_em)
  values (v_eu, p_caminho, now())
  on conflict (cedula) do update
    set caminho = excluded.caminho, actualizada_em = now();

  return jsonb_build_object('ok', true, 'dados', jsonb_build_object(
    'caminho', p_caminho,
    -- a app apaga o molde antigo; a policy deixa, porque um molde nunca
    -- está em correio_anexos (o que viaja nas mensagens são cópias)
    'anterior', v_velho));
exception when others then
  return jsonb_build_object('ok', false, 'erro', 'Não foi possível guardar a assinatura.');
end;
$$;

revoke execute on function public.correio_assinatura_guardar(text) from public, anon;
grant execute on function public.correio_assinatura_guardar(text) to authenticated;


create or replace function public.correio_assinatura_apagar()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_eu text := public.fn_minha_cedula();
  v_velho text;
begin
  if v_eu is null then
    return jsonb_build_object('ok', false, 'erro', 'Sem ficha na Carteirinha.');
  end if;
  select caminho into v_velho from public.correio_assinaturas where cedula = v_eu;
  delete from public.correio_assinaturas where cedula = v_eu;
  return jsonb_build_object('ok', true, 'dados', jsonb_build_object('anterior', v_velho));
exception when others then
  return jsonb_build_object('ok', false, 'erro', 'Não foi possível apagar a assinatura.');
end;
$$;

revoke execute on function public.correio_assinatura_apagar() from public, anon;
grant execute on function public.correio_assinatura_apagar() to authenticated;


-- ── enviar, agora com imagens no corpo ──────────────────────────────
-- A assinatura não muda: `p_anexos` já era jsonb. Passa a aceitar, além do
-- caminho em texto, um objeto {caminho, inline} — assim não nasce uma
-- sobrecarga nova ao lado desta, que é como aparecem as funções mortas.
create or replace function public.correio_enviar(
  p_para_cedula text,
  p_assunto text,
  p_corpo text,
  p_resposta_a uuid,
  p_formato text default 'texto',
  p_anexos jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_de       text := public.fn_minha_cedula();
  v_para     record;
  v_id       uuid := gen_random_uuid();
  v_formato  text := coalesce(p_formato, 'texto');
  v_item     jsonb;
  v_caminho  text;
  v_inline   boolean;
  v_caminhos text[] := '{}';
  v_inlines  boolean[] := '{}';
  v_ref      text;
  v_obj      record;
  v_i        int;
  v_n        int := 0;
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

  -- ── os anexos, primeiro, porque o corpo é conferido contra eles ────
  if jsonb_typeof(coalesce(p_anexos, '[]'::jsonb)) <> 'array' then
    return jsonb_build_object('ok', false, 'erro', 'Lista de anexos inválida.');
  end if;
  if jsonb_array_length(coalesce(p_anexos, '[]'::jsonb)) > 10 then
    return jsonb_build_object('ok', false, 'erro', 'Anexos a mais nesta mensagem.');
  end if;

  for v_item in select jsonb_array_elements(coalesce(p_anexos, '[]'::jsonb))
  loop
    if jsonb_typeof(v_item) = 'string' then
      v_caminho := v_item #>> '{}';
      v_inline := false;
    elsif jsonb_typeof(v_item) = 'object' then
      v_caminho := v_item->>'caminho';
      v_inline := coalesce((v_item->>'inline')::boolean, false);
    else
      return jsonb_build_object('ok', false, 'erro', 'Lista de anexos inválida.');
    end if;

    if coalesce(v_caminho, '') = '' or split_part(v_caminho, '/', 1) <> v_de then
      return jsonb_build_object('ok', false, 'erro', 'Anexo fora da sua pasta.');
    end if;
    v_caminhos := v_caminhos || v_caminho;
    v_inlines := v_inlines || v_inline;
  end loop;

  -- ── o que o corpo pode conter ─────────────────────────────────────
  if v_formato = 'html' then
    if exists (
      select 1 from regexp_matches(p_corpo, '</?\s*([a-zA-Z0-9-]+)', 'g') m
       where lower(m[1]) not in
         ('b','strong','i','em','u','s','a','br','p','ul','ol','li','blockquote','img'))
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

    -- 1. nenhuma imagem traz endereço
    if p_corpo ~* '<img[^>]*\ssrc\s*=' then
      return jsonb_build_object('ok', false, 'erro',
        'As imagens do corpo não podem trazer um endereço.');
    end if;
    -- 2. toda a imagem tem de apontar para um anexo
    if p_corpo ~* '<img(?![^>]*\sdata-anexo=)' then
      return jsonb_build_object('ok', false, 'erro',
        'Há uma imagem no corpo que não corresponde a nenhum anexo.');
    end if;
    -- 3. e esse anexo tem de ser desta mensagem
    for v_ref in
      select m[1] from regexp_matches(p_corpo, 'data-anexo="([^"]*)"', 'g') m
    loop
      if not (v_ref = any (v_caminhos)) then
        return jsonb_build_object('ok', false, 'erro',
          'Há uma imagem no corpo que não corresponde a nenhum anexo.');
      end if;
    end loop;
  elsif p_corpo ~* '<img' then
    return jsonb_build_object('ok', false, 'erro', 'Formato desconhecido.');
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

  insert into public.correio(id, de_cedula, para_cedula, assunto, corpo, resposta_a, formato)
  values (v_id, v_de, v_para.cedula, btrim(p_assunto), p_corpo, p_resposta_a, v_formato);

  -- O nome, o tamanho e o tipo saem do storage.objects, nunca do cliente.
  for v_i in 1 .. coalesce(array_length(v_caminhos, 1), 0)
  loop
    select name, metadata into v_obj
      from storage.objects
     where bucket_id = 'correio' and name = v_caminhos[v_i];
    if v_obj.name is null then
      raise exception 'anexo inexistente';
    end if;
    if v_inlines[v_i] and coalesce(v_obj.metadata->>'mimetype', '') not like 'image/%' then
      raise exception 'inline que não é imagem';
    end if;

    insert into public.correio_anexos(mensagem_id, caminho, nome, tamanho, tipo, inline)
    values (
      v_id,
      v_caminhos[v_i],
      regexp_replace(v_caminhos[v_i], '^.*/', ''),
      coalesce((v_obj.metadata->>'size')::bigint, 0),
      v_obj.metadata->>'mimetype',
      v_inlines[v_i]);
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('ok', true, 'dados', jsonb_build_object(
    'id', v_id, 'para', v_para.cedula, 'nome', v_para.nome, 'anexos', v_n));
exception when others then
  -- Sem sqlerrm: o erro cru do Postgres não vai ao browser (R1 da pp-base).
  return jsonb_build_object('ok', false, 'erro',
    'Não foi possível enviar a mensagem. Confirme os anexos.');
end;
$$;

revoke execute on function public.correio_enviar(text, text, text, uuid, text, jsonb)
  from public, anon;
grant execute on function public.correio_enviar(text, text, text, uuid, text, jsonb)
  to authenticated;


-- ── a caixa passa a dizer quais anexos são do corpo ─────────────────
-- Sem isto a lista de anexos no fim da mensagem mostrava outra vez a
-- assinatura que já está desenhada dentro do texto.
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
                      'tamanho', a.tamanho, 'tipo', a.tipo, 'inline', a.inline)
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
          or public.fn_correio_excerto(c.corpo, c.formato, 40000)
               ilike '%' || p_procura || '%'
          or public.fn_nome_de(c.de_cedula) ilike '%' || p_procura || '%'
          or exists (select 1 from public.correio_anexos a
                      where a.mensagem_id = c.id
                        and a.inline = false
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
