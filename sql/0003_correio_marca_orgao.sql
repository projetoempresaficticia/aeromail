-- AeroMail: distinguir uma carta do Estado de uma mensagem de um colega.
--
-- A caixa precisa de marcar visualmente o que vem de um órgão. A tentação
-- era fixar as quatro cédulas no JavaScript (EP-2026-00004 a 00007) — mas
-- isso é uma cópia da verdade no sítio errado: no dia em que nascer o
-- quinto órgão, a lista no browser fica calada e errada.
--
-- Quem é órgão está escrito em `orgao_tipos.iban_orgao`. É de lá que a
-- resposta sai, e por isso o quinto órgão marca-se sozinho.
--
-- Só muda a leitura: mesma assinatura, mesmos privilégios, mais um campo.
--
-- Aplicada ao Supabase do projeto (moxxbehwylcjaqjacmyh) em 2026-09-06.

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


-- ── quem se pode escrever ───────────────────────────────────────────
-- Escrever a alguém exige saber a cédula de cor, e ninguém sabe. Esta
-- devolve as pessoas ativas para o campo de destinatário — sem emails,
-- sem nada além do que já é público no ecossistema: nome, cédula, empresa.
create or replace function public.correio_contactos(p_procura text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_eu     text := public.fn_minha_cedula();
  v_linhas jsonb;
begin
  if v_eu is null then
    return jsonb_build_object('ok', false, 'erro', 'Sem ficha na Carteirinha.');
  end if;

  select jsonb_agg(x order by x->>'nome')
    into v_linhas
    from (
      select jsonb_build_object(
               'cedula', p.cedula,
               'nome', p.nome,
               'empresa', e.nome) as x
        from public.pessoas p
        left join public.empresas e on e.id = p.empresa_id
       where p.estado = 'ativa'
         and p.cedula <> v_eu
         and (coalesce(p_procura, '') = ''
              or p.nome ilike '%' || p_procura || '%'
              or p.cedula ilike '%' || p_procura || '%')
       limit 200
    ) t;

  return jsonb_build_object('ok', true, 'dados',
    jsonb_build_object('linhas', coalesce(v_linhas, '[]'::jsonb)));
exception when others then
  return jsonb_build_object('ok', false, 'erro', 'Não foi possível ler os contactos.');
end;
$$;

revoke execute on function public.correio_contactos(text) from public, anon;
grant execute on function public.correio_contactos(text) to authenticated;
