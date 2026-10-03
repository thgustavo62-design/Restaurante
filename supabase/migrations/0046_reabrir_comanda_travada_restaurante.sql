-- Fase 0.6 — comanda presa em FECHANDO.
--
-- Se o navegador fecha/trava durante o pagamento, a comanda fica em
-- FECHANDO pra sempre (só volta pra ABERTA se alguém cancelar o modal no
-- mesmo aparelho/sessão onde ficou aberto). updated_at (igual já existe em
-- produtos/insumos) permite saber há quanto tempo está travada; a RPC usa
-- a permissão atendimento.comanda.reabrir, que já existia no catálogo
-- desde a Fase 0 original mas nunca tinha sido usada em lugar nenhum.
--
-- Decisão: reabertura é sempre manual (botão), nunca automática no
-- carregamento — um revert automático correria o risco de colidir com um
-- pagamento genuinamente em andamento em outro aparelho.

alter table restaurante.comandas add column if not exists updated_at timestamptz not null default now();
-- backfill: reconstitui a partir do que já existia (idempotente — se
-- reaplicado, só recalcula o mesmo valor, não quebra nada)
update restaurante.comandas set updated_at = coalesce(fechamento, abertura, created_at);

drop trigger if exists trg_comandas_updated_at on restaurante.comandas;
create trigger trg_comandas_updated_at
  before update on restaurante.comandas
  for each row execute function restaurante.set_updated_at();

create or replace function restaurante.reabrir_comanda(p_comanda_id uuid)
returns restaurante.comandas
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_usuario_id uuid := auth.uid();
  v_comanda restaurante.comandas%rowtype;
begin
  if v_usuario_id is null or v_empresa_id is null then
    raise exception 'Não autenticado';
  end if;
  if not restaurante.tem_permissao('atendimento.comanda.reabrir') then
    raise exception 'Sem permissão para reabrir comanda';
  end if;

  select * into v_comanda from restaurante.comandas
    where id = p_comanda_id and empresa_id = v_empresa_id and status = 'FECHANDO'
    for update;
  if not found then
    raise exception 'Comanda não encontrada ou não está travada em fechamento';
  end if;

  update restaurante.comandas set status = 'ABERTA' where id = p_comanda_id
    returning * into v_comanda;

  insert into restaurante.auditoria (empresa_id, usuario_id, entidade, entidade_id, acao, motivo)
  values (v_empresa_id, v_usuario_id, 'comanda', p_comanda_id, 'COMANDA_REABERTA_TRAVADA', v_comanda.codigo);

  return v_comanda;
end;
$$;

revoke all on function restaurante.reabrir_comanda(uuid) from public;
grant execute on function restaurante.reabrir_comanda(uuid) to authenticated;
