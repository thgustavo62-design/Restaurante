-- Fase 2.9 [NOVO] — Exportação pro contador.
--
-- Agrega no banco o que o contador precisa de um mês: vendas por forma de
-- pagamento, contas pagas/recebidas (com data de pagamento) e fechamentos
-- de caixa. O client só transforma em CSV e baixa — nenhum cálculo novo
-- no navegador.

create or replace function restaurante.relatorio_exportacao_contador(p_mes date)
returns jsonb
language plpgsql
stable
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_desde date := date_trunc('month', p_mes)::date;
  v_ate date := (date_trunc('month', p_mes) + interval '1 month' - interval '1 day')::date;
  v_vendas jsonb;
  v_contas jsonb;
  v_fechamentos jsonb;
begin
  if not restaurante.tem_permissao('admin.financeiro.ver') then
    raise exception 'Sem permissão para exportar dados financeiros';
  end if;

  select coalesce(jsonb_agg(row_to_json(v)), '[]'::jsonb) into v_vendas
  from (
    select cm.forma_pagamento as forma, sum(cm.valor_centavos)::int as total, count(*) as quantidade
    from restaurante.caixa_movimentos cm
    join restaurante.caixa_sessoes cs on cs.id = cm.sessao_id
    where cs.empresa_id = v_empresa_id and cm.tipo = 'VENDA'
      and cm.created_at::date between v_desde and v_ate
    group by cm.forma_pagamento
    order by cm.forma_pagamento
  ) v;

  select coalesce(jsonb_agg(row_to_json(c) order by c.vencimento), '[]'::jsonb) into v_contas
  from (
    select tipo, descricao, categoria, valor_centavos, vencimento, pago_em
    from restaurante.contas
    where empresa_id = v_empresa_id
      and (vencimento between v_desde and v_ate or (pago_em is not null and pago_em::date between v_desde and v_ate))
  ) c;

  select coalesce(jsonb_agg(row_to_json(f) order by f.fechamento_em), '[]'::jsonb) into v_fechamentos
  from (
    select terminal, abertura_em, fechamento_em, saldo_inicial_centavos,
      saldo_calculado_centavos, saldo_informado_centavos, diferenca_centavos
    from restaurante.caixa_sessoes
    where empresa_id = v_empresa_id and status = 'FECHADA'
      and fechamento_em::date between v_desde and v_ate
  ) f;

  return jsonb_build_object(
    'mes', to_char(v_desde, 'YYYY-MM'),
    'vendas_por_forma', v_vendas,
    'contas', v_contas,
    'fechamentos_caixa', v_fechamentos
  );
end;
$$;

revoke all on function restaurante.relatorio_exportacao_contador(date) from public;
grant execute on function restaurante.relatorio_exportacao_contador(date) to authenticated;
