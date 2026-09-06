-- AeroMail: apagar mensagens.
--
-- UMA LINHA, DOIS DONOS. Uma mensagem é uma linha só na tabela, mas
-- pertence a duas pessoas: a quem a escreveu e a quem a recebeu. Apagar
-- não pode ser `delete from correio` — se fosse, quem enviou apagava a
-- mensagem da caixa de quem recebeu, e reescrevia o passado alheio.
--
-- Por isso cada lado tem o seu estado: `estado_de` e `estado_para`. Eu
-- mexo no meu; o do outro não é meu para mexer.
--
-- A MÁQUINA DE ESTADOS, declarada e fechada (regra da pp-base):
--
--     caixa ──apagar──> lixo ──apagar de vez──> fora
--       ^                 |
--       └─────repor───────┘
--
-- Não há caixa → fora. Apagar de vez tem de passar pelo lixo: assim não há
-- um clique que destrói sem rede.
--
-- QUANDO É QUE A LINHA MORRE MESMO. Quando nenhum dos dois lados a quer.
-- Se ambos estiverem em `fora`, a linha e os anexos desaparecem — aí sim,
-- `delete`. Um lado que não tem conta (um órgão, que nunca entra na app e
-- não tem caixa) conta como já tendo largado a mensagem, senão um aviso da
-- Segurança Social ficava eterno por não haver ninguém do outro lado para
-- o apagar.
--
-- O PROFESSOR continua a ver tudo o que existir. O que ele deixa de ver é
-- o que já não existe — e isso é o mesmo para toda a gente.
--
-- Aplicada ao Supabase do projeto (moxxbehwylcjaqjacmyh) em 2026-09-06.

alter table public.correio
  add column if not exists estado_de   text not null default 'caixa';
alter table public.correio
  add column if not exists estado_para text not null default 'caixa';

alter table public.correio drop constraint if exists correio_estado_de_valido;
alter table public.correio add constraint correio_estado_de_valido
  check (estado_de in ('caixa', 'lixo', 'fora'));

alter table public.correio drop constraint if exists correio_estado_para_valido;
alter table public.correio add constraint correio_estado_para_valido
  check (estado_para in ('caixa', 'lixo', 'fora'));


-- ── arrumar ─────────────────────────────────────────────────────────
-- Uma função para as três acções, porque as três são a mesma coisa: mudar
-- o meu lado de estado. Separá-las dava três funções com a mesma
-- validação copiada, e a terceira cópia é sempre a que fica para trás.
--
-- Recebe uma lista: esvaziar o lixo são cinquenta mensagens, e cinquenta
-- chamadas seguidas eram cinquenta oportunidades de ficar a meio.
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
    -- De que lado estou nesta mensagem? Escrever para si próprio está
    -- vedado no envio, por isso nunca sou os dois ao mesmo tempo.
    v_meu := case when r.para_cedula = v_eu then r.estado_para else r.estado_de end;

    -- A máquina de estados, escrita uma vez e obedecida sempre.
    if not (
         (v_meu = 'caixa' and p_destino = 'lixo')
      or (v_meu = 'lixo'  and p_destino = 'caixa')
      or (v_meu = 'lixo'  and p_destino = 'fora')
    ) then
      continue;   -- transição que não existe: não é erro, é um pedido velho
    end if;

    if r.para_cedula = v_eu then
      update public.correio set estado_para = p_destino where id = r.id;
    else
      update public.correio set estado_de = p_destino where id = r.id;
    end if;
    v_mexidas := v_mexidas + 1;
  end loop;

  -- ── o que já não é de ninguém ─────────────────────────────────────
  if p_destino = 'fora' then
    select coalesce(array_agg(c.id), '{}')
      into v_mortas
      from public.correio c
     where c.id = any (p_ids)
       -- só mexo no que é meu, mesmo quando a linha já não interessa a
       -- ninguém: a lista de ids vem do browser
       and (c.de_cedula = v_eu or c.para_cedula = v_eu)
       and (c.estado_de = 'fora'
            or not exists (select 1 from public.pessoas p where p.cedula = c.de_cedula))
       and (c.estado_para = 'fora'
            or not exists (select 1 from public.pessoas p where p.cedula = c.para_cedula));

    if array_length(v_mortas, 1) is not null then
      -- Os caminhos são apanhados ANTES do delete: o cascade leva os
      -- anexos e depois já não havia como saber que ficheiros limpar.
      select coalesce(array_agg(a.caminho), '{}')
        into v_ficheiros
        from public.correio_anexos a
       where a.mensagem_id = any (v_mortas);

      delete from public.correio where id = any (v_mortas);
    end if;
  end if;

  select count(*) into v_por_ler
    from public.correio
   where para_cedula = v_eu and lido = false and estado_para = 'caixa';

  return jsonb_build_object('ok', true, 'dados', jsonb_build_object(
    'mexidas', v_mexidas,
    'destruidas', coalesce(array_length(v_mortas, 1), 0),
    -- devolvidos para o browser apagar os ficheiros: quem os pôs no
    -- Storage é o único que a policy deixa tirá-los de lá
    'ficheiros', to_jsonb(v_ficheiros),
    'por_ler', v_por_ler));
exception when others then
  return jsonb_build_object('ok', false, 'erro', 'Não foi possível arrumar as mensagens.');
end;
$$;

revoke execute on function public.correio_arrumar(uuid[], text) from public, anon;
grant execute on function public.correio_arrumar(uuid[], text) to authenticated;


-- ── a caixa passa a conhecer o lixo ─────────────────────────────────
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
  v_caixa  text := coalesce(p_caixa, 'entrada');
  v_linhas jsonb;
  v_por_ler int;
  v_no_lixo int;
begin
  if v_eu is null then
    return jsonb_build_object('ok', false, 'erro', 'Sem ficha na Carteirinha.');
  end if;
  if v_caixa not in ('entrada', 'enviados', 'lixo') then
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
           -- no lixo entram mensagens dos dois lados: é preciso saber de
           -- que lado se está para desenhar o nome certo e o botão certo
           'recebida', c.para_cedula = v_eu,
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
            when 'lixo'     then (c.para_cedula = v_eu and c.estado_para = 'lixo')
                              or (c.de_cedula = v_eu and c.estado_de = 'lixo')
            else c.para_cedula = v_eu and c.estado_para = 'caixa'
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

  -- O que está no lixo não conta por ler: dava um número vermelho que
  -- ninguém consegue tirar de lá sem ir buscar o que já deitou fora.
  select count(*) into v_por_ler
    from public.correio
   where para_cedula = v_eu and lido = false and estado_para = 'caixa';

  select count(*) into v_no_lixo
    from public.correio c
   where (c.para_cedula = v_eu and c.estado_para = 'lixo')
      or (c.de_cedula = v_eu and c.estado_de = 'lixo');

  return jsonb_build_object('ok', true, 'dados', jsonb_build_object(
    'caixa', v_caixa,
    'eu', v_eu,
    'por_ler', v_por_ler,
    'no_lixo', v_no_lixo,
    'linhas', coalesce(v_linhas, '[]'::jsonb)));
exception when others then
  return jsonb_build_object('ok', false, 'erro', 'Não foi possível abrir a caixa.');
end;
$$;

revoke execute on function public.correio_caixa(text, text, boolean) from public, anon;
grant execute on function public.correio_caixa(text, text, boolean) to authenticated;


-- ── marcar lido não conta o lixo ────────────────────────────────────
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
  -- Só o destinatário marca. Quem enviou não decide se o outro leu.
  update public.correio set lido = coalesce(p_lido, true)
   where id = p_id and para_cedula = v_eu;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'erro', 'Mensagem não encontrada na sua caixa.');
  end if;

  select count(*) into v_n
    from public.correio
   where para_cedula = v_eu and lido = false and estado_para = 'caixa';
  return jsonb_build_object('ok', true, 'dados', jsonb_build_object('por_ler', v_n));
exception when others then
  return jsonb_build_object('ok', false, 'erro', 'Não foi possível marcar a mensagem.');
end;
$$;

revoke execute on function public.correio_marcar_lido(uuid, boolean) from public, anon;
grant execute on function public.correio_marcar_lido(uuid, boolean) to authenticated;
