-- AeroMail: pastas.
--
-- A PASTA É DE QUEM ARRUMA, NÃO DA MENSAGEM. É a mesma regra do apagar: a
-- linha tem dois donos, e cada um arruma o seu lado. Se eu arquivar uma
-- mensagem em "Clientes", quem está do outro lado não a vê mudar de sítio.
-- Daí `pasta_de` e `pasta_para`, ao lado de `estado_de` e `estado_para`.
--
-- UMA PASTA É UM REFINAMENTO DA CAIXA, não um quarto estado. `estado`
-- continua a decidir se a mensagem está viva, no lixo ou fora; `pasta`
-- decide em que prateleira da caixa está. Uma mensagem arquivada sai da
-- Entrada — é isso que arrumar quer dizer, e é o que distingue uma pasta
-- de uma etiqueta.
--
-- Guardar a pasta ao mandar para o lixo (em vez de a limpar) é o que faz
-- com que repor devolva a mensagem à prateleira de onde saiu, e não à
-- Entrada.
--
-- PASTAS SÃO PLANAS. Sem pastas dentro de pastas: quem precisa disso são
-- dez pessoas em mil, e o preço é uma árvore para desenhar, mover e
-- apagar em cascata.
--
-- APAGAR UMA PASTA NUNCA APAGA MENSAGENS. As que lá estavam voltam à
-- Entrada, e a função diz quantas foram. Uma pasta é um móvel; deitar
-- fora o móvel não é deitar fora o que estava dentro.
--
-- Aplicada ao Supabase do projeto (moxxbehwylcjaqjacmyh) em 2026-09-06.

create table if not exists public.correio_pastas (
  id        uuid primary key default gen_random_uuid(),
  cedula    text not null,
  nome      text not null,
  criada_em timestamptz not null default now()
);

-- Duas pastas com o mesmo nome eram duas gavetas iguais: ninguém sabia em
-- qual tinha guardado. Sem distinguir maiúsculas, porque "Clientes" e
-- "clientes" são a mesma gaveta na cabeça de quem arruma.
create unique index if not exists correio_pastas_unica
  on public.correio_pastas (cedula, lower(nome));

alter table public.correio_pastas enable row level security;

drop policy if exists "vejo as minhas pastas" on public.correio_pastas;
create policy "vejo as minhas pastas"
  on public.correio_pastas for select
  using (cedula = public.fn_minha_cedula() or public.fn_e_professor());

-- `on delete set null` é a rede por baixo da rede: mesmo que a pasta
-- desaparecesse por outro caminho, a mensagem volta à Entrada em vez de
-- ficar a apontar para o nada.
alter table public.correio
  add column if not exists pasta_de uuid
    references public.correio_pastas(id) on delete set null;
alter table public.correio
  add column if not exists pasta_para uuid
    references public.correio_pastas(id) on delete set null;

create index if not exists correio_pasta_de on public.correio(pasta_de);
create index if not exists correio_pasta_para on public.correio(pasta_para);


-- ── criar e renomear ────────────────────────────────────────────────
-- Uma função para as duas: criar é renomear uma pasta que ainda não
-- existe. A validação do nome é a mesma, e escrita uma vez.
create or replace function public.correio_pasta_guardar(
  p_id uuid,
  p_nome text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_eu   text := public.fn_minha_cedula();
  v_nome text := btrim(coalesce(p_nome, ''));
  v_id   uuid;
begin
  if v_eu is null then
    return jsonb_build_object('ok', false, 'erro', 'Sem ficha na Carteirinha.');
  end if;
  if v_nome = '' then
    return jsonb_build_object('ok', false, 'erro', 'A pasta precisa de um nome.');
  end if;
  if length(v_nome) > 40 then
    return jsonb_build_object('ok', false, 'erro', 'Nome demasiado longo (máximo 40).');
  end if;

  -- Perguntar antes em vez de deixar rebentar o índice: assim a resposta
  -- diz o que se passa, em vez de "não foi possível".
  if exists (
    select 1 from public.correio_pastas
     where cedula = v_eu and lower(nome) = lower(v_nome)
       and (p_id is null or id <> p_id))
  then
    return jsonb_build_object('ok', false, 'erro', 'Já tem uma pasta com esse nome.');
  end if;

  if p_id is null then
    if (select count(*) from public.correio_pastas where cedula = v_eu) >= 50 then
      return jsonb_build_object('ok', false, 'erro', 'Já tem pastas a mais (máximo 50).');
    end if;
    insert into public.correio_pastas(cedula, nome)
    values (v_eu, v_nome)
    returning id into v_id;
  else
    update public.correio_pastas set nome = v_nome
     where id = p_id and cedula = v_eu
    returning id into v_id;
    if v_id is null then
      return jsonb_build_object('ok', false, 'erro', 'Pasta não encontrada.');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'dados',
    jsonb_build_object('id', v_id, 'nome', v_nome));
exception when others then
  return jsonb_build_object('ok', false, 'erro', 'Não foi possível guardar a pasta.');
end;
$$;

revoke execute on function public.correio_pasta_guardar(uuid, text) from public, anon;
grant execute on function public.correio_pasta_guardar(uuid, text) to authenticated;


-- ── apagar a pasta, nunca o que está lá dentro ──────────────────────
create or replace function public.correio_pasta_apagar(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_eu     text := public.fn_minha_cedula();
  v_nome   text;
  v_voltam int := 0;
  v_n      int;
begin
  if v_eu is null then
    return jsonb_build_object('ok', false, 'erro', 'Sem ficha na Carteirinha.');
  end if;

  select nome into v_nome from public.correio_pastas
   where id = p_id and cedula = v_eu;
  if v_nome is null then
    return jsonb_build_object('ok', false, 'erro', 'Pasta não encontrada.');
  end if;

  update public.correio set pasta_para = null
   where pasta_para = p_id and para_cedula = v_eu;
  get diagnostics v_n = row_count;
  v_voltam := v_voltam + v_n;

  update public.correio set pasta_de = null
   where pasta_de = p_id and de_cedula = v_eu;
  get diagnostics v_n = row_count;
  v_voltam := v_voltam + v_n;

  delete from public.correio_pastas where id = p_id and cedula = v_eu;

  return jsonb_build_object('ok', true, 'dados',
    jsonb_build_object('nome', v_nome, 'voltaram', v_voltam));
exception when others then
  return jsonb_build_object('ok', false, 'erro', 'Não foi possível apagar a pasta.');
end;
$$;

revoke execute on function public.correio_pasta_apagar(uuid) from public, anon;
grant execute on function public.correio_pasta_apagar(uuid) to authenticated;


-- ── mover mensagens ─────────────────────────────────────────────────
-- Lista, como o `correio_arrumar`: arrumar a caixa é uma coisa que se faz
-- a dez mensagens de uma vez, não a uma.
create or replace function public.correio_mover(
  p_ids uuid[],
  p_pasta uuid          -- null devolve à Entrada / aos Enviados
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_eu      text := public.fn_minha_cedula();
  v_mexidas int := 0;
  v_n       int;
begin
  if v_eu is null then
    return jsonb_build_object('ok', false, 'erro', 'Sem ficha na Carteirinha.');
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    return jsonb_build_object('ok', false, 'erro', 'Não indicou nenhuma mensagem.');
  end if;
  if array_length(p_ids, 1) > 500 then
    return jsonb_build_object('ok', false, 'erro', 'Mensagens a mais de uma vez.');
  end if;
  if p_pasta is not null and not exists (
       select 1 from public.correio_pastas where id = p_pasta and cedula = v_eu) then
    return jsonb_build_object('ok', false, 'erro', 'Essa pasta não é sua.');
  end if;

  -- Só o que está na caixa. O que está no lixo primeiro repõe-se, e só
  -- depois se arruma: mover de dentro do caixote não quer dizer nada.
  update public.correio set pasta_para = p_pasta
   where id = any (p_ids) and para_cedula = v_eu and estado_para = 'caixa';
  get diagnostics v_n = row_count;
  v_mexidas := v_mexidas + v_n;

  update public.correio set pasta_de = p_pasta
   where id = any (p_ids) and de_cedula = v_eu and estado_de = 'caixa';
  get diagnostics v_n = row_count;
  v_mexidas := v_mexidas + v_n;

  return jsonb_build_object('ok', true, 'dados',
    jsonb_build_object('mexidas', v_mexidas));
exception when others then
  return jsonb_build_object('ok', false, 'erro', 'Não foi possível mover as mensagens.');
end;
$$;

revoke execute on function public.correio_mover(uuid[], uuid) from public, anon;
grant execute on function public.correio_mover(uuid[], uuid) to authenticated;


-- ── a caixa conhece as pastas ───────────────────────────────────────
-- A assinatura muda: passa a receber a pasta a abrir. `create or replace`
-- não substitui em assinatura diferente, e as duas versões ao lado uma da
-- outra tornavam ambígua qualquer chamada com três argumentos nomeados.
-- Por isso a antiga cai primeiro.
drop function if exists public.correio_caixa(text, text, boolean);

create or replace function public.correio_caixa(
  p_caixa text,
  p_procura text,
  p_so_por_ler boolean,
  p_pasta uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_eu      text := public.fn_minha_cedula();
  v_caixa   text := coalesce(p_caixa, 'entrada');
  v_linhas  jsonb;
  v_pastas  jsonb;
  v_por_ler int;
  v_no_lixo int;
begin
  if v_eu is null then
    return jsonb_build_object('ok', false, 'erro', 'Sem ficha na Carteirinha.');
  end if;
  if v_caixa not in ('entrada', 'enviados', 'lixo', 'pasta') then
    return jsonb_build_object('ok', false, 'erro', 'Caixa desconhecida.');
  end if;
  if v_caixa = 'pasta' and (p_pasta is null or not exists (
       select 1 from public.correio_pastas where id = p_pasta and cedula = v_eu)) then
    return jsonb_build_object('ok', false, 'erro', 'Essa pasta não é sua.');
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
           'recebida', c.para_cedula = v_eu,
           -- a pasta do MEU lado, para a janela de mover já vir certa
           'pasta', case when c.para_cedula = v_eu then c.pasta_para else c.pasta_de end,
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
   where (case v_caixa
            when 'enviados' then c.de_cedula = v_eu and c.estado_de = 'caixa'
                             and c.pasta_de is null
            when 'lixo'     then (c.para_cedula = v_eu and c.estado_para = 'lixo')
                              or (c.de_cedula = v_eu and c.estado_de = 'lixo')
            when 'pasta'    then (c.para_cedula = v_eu and c.estado_para = 'caixa'
                                  and c.pasta_para = p_pasta)
                              or (c.de_cedula = v_eu and c.estado_de = 'caixa'
                                  and c.pasta_de = p_pasta)
            else c.para_cedula = v_eu and c.estado_para = 'caixa'
                 and c.pasta_para is null
          end)
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

  -- ── a lateral, num pedido só ──────────────────────────────────────
  -- As pastas vêm com a caixa e não numa chamada à parte: são desenhadas
  -- ao mesmo tempo, e duas chamadas davam um momento em que a lista já
  -- mudou e a lateral ainda não.
  select jsonb_agg(jsonb_build_object(
           'id', f.id,
           'nome', f.nome,
           'total', (select count(*) from public.correio c
                      where (c.para_cedula = v_eu and c.pasta_para = f.id
                             and c.estado_para = 'caixa')
                         or (c.de_cedula = v_eu and c.pasta_de = f.id
                             and c.estado_de = 'caixa')),
           'por_ler', (select count(*) from public.correio c
                        where c.para_cedula = v_eu and c.pasta_para = f.id
                          and c.estado_para = 'caixa' and c.lido = false))
         order by lower(f.nome))
    into v_pastas
    from public.correio_pastas f
   where f.cedula = v_eu;

  -- Por ler é o que está na Entrada. O que está arrumado numa pasta já foi
  -- visto por quem o arrumou; o número da Entrada é para o que ainda não.
  select count(*) into v_por_ler
    from public.correio
   where para_cedula = v_eu and lido = false and estado_para = 'caixa'
     and pasta_para is null;

  select count(*) into v_no_lixo
    from public.correio c
   where (c.para_cedula = v_eu and c.estado_para = 'lixo')
      or (c.de_cedula = v_eu and c.estado_de = 'lixo');

  return jsonb_build_object('ok', true, 'dados', jsonb_build_object(
    'caixa', v_caixa,
    'pasta', p_pasta,
    'eu', v_eu,
    'por_ler', v_por_ler,
    'no_lixo', v_no_lixo,
    'pastas', coalesce(v_pastas, '[]'::jsonb),
    'linhas', coalesce(v_linhas, '[]'::jsonb)));
exception when others then
  return jsonb_build_object('ok', false, 'erro', 'Não foi possível abrir a caixa.');
end;
$$;

revoke execute on function public.correio_caixa(text, text, boolean, uuid) from public, anon;
grant execute on function public.correio_caixa(text, text, boolean, uuid) to authenticated;


-- ── marcar lido conta o mesmo que a Entrada ─────────────────────────
create or replace function public.correio_marcar_lido(p_id uuid, p_lido boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_eu text := public.fn_minha_cedula();
  v_n  int;
begin
  if v_eu is null then
    return jsonb_build_object('ok', false, 'erro', 'Sem ficha na Carteirinha.');
  end if;
  update public.correio set lido = coalesce(p_lido, true)
   where id = p_id and para_cedula = v_eu;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'erro', 'Mensagem não encontrada na sua caixa.');
  end if;

  select count(*) into v_n
    from public.correio
   where para_cedula = v_eu and lido = false and estado_para = 'caixa'
     and pasta_para is null;
  return jsonb_build_object('ok', true, 'dados', jsonb_build_object('por_ler', v_n));
exception when others then
  return jsonb_build_object('ok', false, 'erro', 'Não foi possível marcar a mensagem.');
end;
$$;

revoke execute on function public.correio_marcar_lido(uuid, boolean) from public, anon;
grant execute on function public.correio_marcar_lido(uuid, boolean) to authenticated;


-- ── e o arrumar também ──────────────────────────────────────────────
create or replace function public.correio_arrumar(
  p_ids uuid[],
  p_destino text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_eu        text := public.fn_minha_cedula();
  r           record;
  v_meu       text;
  v_mexidas   int := 0;
  v_mortas    uuid[] := '{}';
  v_ficheiros text[] := '{}';
  v_por_ler   int;
begin
  if v_eu is null then
    return jsonb_build_object('ok', false, 'erro', 'Sem ficha na Carteirinha.');
  end if;
  if p_destino is null or p_destino not in ('caixa', 'lixo', 'fora') then
    return jsonb_build_object('ok', false, 'erro', 'Destino desconhecido.');
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    return jsonb_build_object('ok', false, 'erro', 'Não indicou nenhuma mensagem.');
  end if;
  if array_length(p_ids, 1) > 500 then
    return jsonb_build_object('ok', false, 'erro', 'Mensagens a mais de uma vez.');
  end if;

  for r in
    select c.id, c.de_cedula, c.para_cedula, c.estado_de, c.estado_para
      from public.correio c
     where c.id = any (p_ids)
       and (c.de_cedula = v_eu or c.para_cedula = v_eu)
  loop
    v_meu := case when r.para_cedula = v_eu then r.estado_para else r.estado_de end;

    if not (
         (v_meu = 'caixa' and p_destino = 'lixo')
      or (v_meu = 'lixo'  and p_destino = 'caixa')
      or (v_meu = 'lixo'  and p_destino = 'fora')
    ) then
      continue;
    end if;

    -- A pasta NÃO se limpa ao deitar fora: é o que faz com que repor
    -- devolva a mensagem à prateleira de onde saiu, e não à Entrada.
    if r.para_cedula = v_eu then
      update public.correio set estado_para = p_destino where id = r.id;
    else
      update public.correio set estado_de = p_destino where id = r.id;
    end if;
    v_mexidas := v_mexidas + 1;
  end loop;

  if p_destino = 'fora' then
    select coalesce(array_agg(c.id), '{}')
      into v_mortas
      from public.correio c
     where c.id = any (p_ids)
       and (c.de_cedula = v_eu or c.para_cedula = v_eu)
       and (c.estado_de = 'fora'
            or not exists (select 1 from public.pessoas p where p.cedula = c.de_cedula))
       and (c.estado_para = 'fora'
            or not exists (select 1 from public.pessoas p where p.cedula = c.para_cedula));

    if array_length(v_mortas, 1) is not null then
      select coalesce(array_agg(a.caminho), '{}')
        into v_ficheiros
        from public.correio_anexos a
       where a.mensagem_id = any (v_mortas);

      delete from public.correio where id = any (v_mortas);
    end if;
  end if;

  select count(*) into v_por_ler
    from public.correio
   where para_cedula = v_eu and lido = false and estado_para = 'caixa'
     and pasta_para is null;

  return jsonb_build_object('ok', true, 'dados', jsonb_build_object(
    'mexidas', v_mexidas,
    'destruidas', coalesce(array_length(v_mortas, 1), 0),
    'ficheiros', to_jsonb(v_ficheiros),
    'por_ler', v_por_ler));
exception when others then
  return jsonb_build_object('ok', false, 'erro', 'Não foi possível arrumar as mensagens.');
end;
$$;

revoke execute on function public.correio_arrumar(uuid[], text) from public, anon;
grant execute on function public.correio_arrumar(uuid[], text) to authenticated;
