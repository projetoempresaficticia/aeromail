-- AeroMail: os órgãos passam a avisar quem tem de saber.
--
-- Até aqui a AT, a Segurança Social, o Cartório e o Diário aprovavam e
-- emitiam protocolo sem dizer nada a ninguém — quem entregava tinha de ir
-- lá ver.
--
-- QUEM É NOTIFICADO. Decisão do Germano: quem submeteu **e quem assinou**.
-- Um contrato de trabalho tem duas assinaturas; o trabalhador tem tanto
-- direito a saber que a admissão foi aprovada como a empresa que a
-- submeteu. O mesmo para a carta de desligamento e para o Modelo 22
-- certificado por contabilista.
--
-- POR GATILHO, e não dentro de cada órgão: assim os quatro notificam sem
-- que nenhum deles saiba que o correio existe, e um quinto órgão futuro
-- notifica sem se lembrar de nada.
--
-- Aplicada ao Supabase do projeto (moxxbehwylcjaqjacmyh) em 2026-09-06.

create or replace function public.fn_correio_notifica_protocolo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r_tipo   record;
  v_orgao  text;
  v_para   text;
  v_assunto text;
  v_corpo  text;
begin
  -- Só quando o protocolo aparece, e uma única vez.
  if new.protocolo is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.protocolo is not distinct from new.protocolo then
    return new;
  end if;

  select * into r_tipo from public.orgao_tipos where tipo = new.tipo;
  v_orgao := public.fn_orgao_cedula(r_tipo.orgao);
  if v_orgao is null then
    return new;
  end if;

  v_assunto := coalesce(r_tipo.descricao, new.tipo) || ' — ' || new.protocolo;
  v_corpo :=
    'A entrega foi aprovada e recebeu o protocolo ' || new.protocolo || '.' || E'\n\n'
    || 'Documento: ' || coalesce(r_tipo.descricao, new.tipo) || E'\n'
    || 'Empresa: ' || public.fn_nome_de(new.empresa_cedula)
    || ' (' || new.empresa_cedula || ')' || E'\n'
    || 'Entregue em: ' || to_char(new.criada_em, 'DD/MM/YYYY HH24:MI') || E'\n\n'
    || 'Qualquer pessoa pode confirmar este protocolo na consulta pública do '
    || 'órgão, sem precisar de conta.';

  -- quem submeteu, e quem assinou o documento que a sustentou
  for v_para in
    select distinct c from (
      select new.submetido_por as c
      union
      select ds.preenchido_por
        from public.documento_slots ds
       where ds.documento_id = new.assinatura_doc_id
    ) x
    where c is not null
      and exists (select 1 from public.pessoas p where p.cedula = x.c)
  loop
    insert into public.correio(de_cedula, para_cedula, assunto, corpo)
    values (v_orgao, v_para, v_assunto, v_corpo);
  end loop;

  return new;
exception when others then
  -- Falhar a notificação nunca pode fazer falhar a aprovação: o protocolo
  -- é o facto, o aviso é a cortesia.
  return new;
end;
$$;

drop trigger if exists trg_correio_notifica on public.submissoes;
create trigger trg_correio_notifica
  after insert or update on public.submissoes
  for each row execute function public.fn_correio_notifica_protocolo();
