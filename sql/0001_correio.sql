-- AeroMail: o correio interno.
--
-- A tabela `correio` e o Realtime já existiam na base desde a fundação;
-- faltavam as políticas — a tabela tinha RLS ligada e ZERO políticas, ou
-- seja, negava tudo a toda a gente — e as ações.
--
-- O remetente sai SEMPRE de `auth.uid()` resolvido, nunca de um parâmetro:
-- senão qualquer pessoa escrevia em nome de outra, e um correio onde isso é
-- possível não serve para nada.
--
-- Aplicada ao Supabase do projeto (moxxbehwylcjaqjacmyh) em 2026-09-06.

-- ── quem vê o quê ────────────────────────────────────────────────────
-- Só quem enviou e quem recebeu. O professor vê tudo, como em todo o
-- ecossistema. Escrita nenhuma por política: tudo passa pelas RPC.
drop policy if exists "vejo o que enviei e o que recebi" on public.correio;
create policy "vejo o que enviei e o que recebi"
  on public.correio for select
  using (
    public.fn_e_professor()
    or de_cedula = public.fn_minha_cedula()
    or para_cedula = public.fn_minha_cedula()
  );


create or replace function public.correio_enviar(
  p_para_cedula text,
  p_assunto text,
  p_corpo text,
  p_resposta_a uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_de   text := public.fn_minha_cedula();
  v_para record;
  v_id   uuid := gen_random_uuid();
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
  if length(p_corpo) > 20000 then
    return jsonb_build_object('ok', false, 'erro', 'Mensagem demasiado longa.');
  end if;

  -- O destinatário tem de existir. Deixar enviar para o vazio e falhar
  -- depois é pior do que recusar já.
  select cedula, nome into v_para from public.pessoas
   where cedula = upper(btrim(p_para_cedula)) and estado = 'ativa';
  if v_para.cedula is null then
    return jsonb_build_object('ok', false, 'erro',
      'Não há ninguém ativo com essa cédula.');
  end if;
  if v_para.cedula = v_de then
    return jsonb_build_object('ok', false, 'erro', 'Não pode escrever para si próprio.');
  end if;

  -- Só se responde ao que se recebeu.
  if p_resposta_a is not null and not exists (
       select 1 from public.correio
        where id = p_resposta_a and para_cedula = v_de) then
    return jsonb_build_object('ok', false, 'erro',
      'Só pode responder a uma mensagem que recebeu.');
  end if;

  insert into public.correio(id, de_cedula, para_cedula, assunto, corpo, resposta_a)
  values (v_id, v_de, v_para.cedula, btrim(p_assunto), p_corpo, p_resposta_a);

  return jsonb_build_object('ok', true, 'dados', jsonb_build_object(
    'id', v_id, 'para', v_para.cedula, 'nome', v_para.nome));
exception when others then
  -- Sem sqlerrm: o erro cru do Postgres não vai ao browser (R1 da pp-base).
  return jsonb_build_object('ok', false, 'erro', 'Não foi possível enviar a mensagem.');
end;
$$;

revoke execute on function public.correio_enviar(text, text, text, uuid) from public, anon;
grant execute on function public.correio_enviar(text, text, text, uuid) to authenticated;


-- Uma função para as duas caixas: a diferença entre "entrada" e "enviados"
-- é qual dos dois lados sou eu. Duas funções quase iguais divergiam.
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
           'para', c.para_cedula,
           'para_nome', public.fn_nome_de(c.para_cedula),
           'assunto', c.assunto,
           'corpo', c.corpo,
           'lido', c.lido,
           'resposta_a', c.resposta_a,
           'criada_em', c.criada_em)
         order by c.criada_em desc)
    into v_linhas
    from public.correio c
   where (case when coalesce(p_caixa,'entrada') = 'enviados'
               then c.de_cedula else c.para_cedula end) = v_eu
     and (not coalesce(p_so_por_ler, false) or c.lido = false)
     and (coalesce(p_procura, '') = ''
          or c.assunto ilike '%' || p_procura || '%'
          or c.corpo ilike '%' || p_procura || '%'
          or public.fn_nome_de(c.de_cedula) ilike '%' || p_procura || '%');

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
    from public.correio where para_cedula = v_eu and lido = false;
  return jsonb_build_object('ok', true, 'dados', jsonb_build_object('por_ler', v_n));
exception when others then
  return jsonb_build_object('ok', false, 'erro', 'Não foi possível marcar a mensagem.');
end;
$$;

revoke execute on function public.correio_marcar_lido(uuid, boolean) from public, anon;
grant execute on function public.correio_marcar_lido(uuid, boolean) to authenticated;
