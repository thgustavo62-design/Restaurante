-- PRIORIDADE 9 — Marketing automático (Marketing → sub-aba "Campanhas")
--
-- [PROPOR antes de implementar — aprovado] escopo escolhido: "o banco
-- identifica sozinho, um humano clica" — nenhum envio sai da Vision Food
-- sem um clique de verdade (mesma régua do wa.me de Reservas, 0073; não
-- existe aqui, nem em lugar nenhum do app, integração paga de envio
-- automático tipo WhatsApp Business API/Twilio/SendGrid — ficou fora do
-- escopo aprovado).
--
-- campanhas_hoje() agrega duas listas num call só (aniversariantes de
-- hoje e reservas confirmadas de hoje) na "data de calendário" da
-- empresa (timezone, não dia_operacional — aniversário é data de
-- calendário, não "dia de venda"). Só entra na lista quem dá pra
-- realmente contatar: telefone null (sem LGPD) ou reserva sem telefone
-- não aparecem — diferente de relatorio_clientes_inativos (0064), que
-- mantém a linha sem telefone pro dono ainda saber "quem" parou de vir.
--
-- Clientes inativos (já existente, 0062/0064) ganha o mesmo botão wa.me
-- só no front — nenhuma mudança de RPC necessária lá.

create or replace function restaurante.campanhas_hoje()
returns jsonb
language plpgsql
stable
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_tz text;
  v_hoje date;
  v_aniversariantes jsonb;
  v_reservas jsonb;
begin
  if not restaurante.tem_permissao('admin.marketing.editar') then
    raise exception 'Sem permissão para ver campanhas de marketing';
  end if;

  select timezone into v_tz from restaurante.empresas where id = v_empresa_id;
  v_tz := coalesce(v_tz, 'America/Sao_Paulo');
  v_hoje := (now() at time zone v_tz)::date;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'nome', c.nome, 'telefone', c.telefone, 'pontos_fidelidade', c.pontos_fidelidade
    ) order by c.nome), '[]'::jsonb) into v_aniversariantes
  from restaurante.clientes c
  where c.empresa_id = v_empresa_id
    and c.consentimento_lgpd
    and c.telefone is not null
    and c.aniversario is not null
    and to_char(c.aniversario, 'MM-DD') = to_char(v_hoje, 'MM-DD');

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'nome', r.nome, 'telefone', r.telefone, 'pessoas', r.pessoas, 'data_hora', r.data_hora
    ) order by r.data_hora), '[]'::jsonb) into v_reservas
  from restaurante.reservas r
  where r.empresa_id = v_empresa_id
    and r.status = 'CONFIRMADA'
    and r.telefone is not null
    and (r.data_hora at time zone v_tz)::date = v_hoje;

  return jsonb_build_object('aniversariantes', v_aniversariantes, 'reservas_confirmadas', v_reservas);
end;
$$;

revoke all on function restaurante.campanhas_hoje() from public;
grant execute on function restaurante.campanhas_hoje() to authenticated;
