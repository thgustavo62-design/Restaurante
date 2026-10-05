-- PRIORIDADE 1 — Central do Dono ("entender o restaurante em 30 segundos")
--
-- Tela nova, primeira depois do login pra ADMIN/GERENTE (GERENTE não vê
-- o resultado/lucro do mês — só o dado operacional). Uma RPC só,
-- agregando tudo no banco (nunca baixa comandas/itens pro navegador pra
-- somar, como o resto do app já fazia pro Dashboard antigo): faturamento
-- de hoje comparado com a mesma janela de horário da semana passada,
-- projeção de fechamento do dia pelo ritmo das últimas 4 semanas, lucro
-- estimado do mês, semáforos (CMV/perdas/diferença de caixa — custo de
-- equipe fica em 0/indisponível até a Prioridade 5 existir de verdade),
-- até 5 alertas por gravidade e a foto do salão agora.
--
-- "Hoje operacional" e "mês" usam dia_operacional (mesma régua que
-- relatorio_dre/relatorio_gestao já usam — 0045/0052/0064), calculados
-- aqui a partir de empresas.timezone + virada_dia_operacional_hora, nunca
-- a partir de now() puro (UTC) nem de um "hoje" mandado pelo cliente, pra
-- não depender do relógio/fuso do navegador de quem está olhando.
--
-- "Perdas" ainda não tem registro estruturado com motivo (isso é a
-- Prioridade 3) — por ora aproxima pelo valor das saídas manuais de
-- estoque (tipo SAIDA) a custo médio do insumo; quando a tabela de
-- perdas de verdade existir, troque a subconsulta v_perdas_mes por ela.
-- "Validade vencendo" e "insumo que ficou mais caro" (blocos de atenção
-- do roteiro original) não entraram: não existe hoje nem controle de
-- validade/lote nem histórico de preço de insumo (Prioridade 4) — vai
-- cada um quando a tela dele existir.

insert into restaurante.papeis_permissoes (papel, permissao) values
  ('ADMIN', 'admin.central_dono.ver'), ('GERENTE', 'admin.central_dono.ver')
on conflict (papel, permissao) do nothing;

create or replace function restaurante.central_do_dono()
returns jsonb
language plpgsql
stable
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_papel text := restaurante.jwt_papel();
  v_tz text;
  v_virada int;
  v_atraso_cfg jsonb;
  v_meta_cmv_pct numeric;
  v_meta_perdas_pct numeric;
  v_meta_custo_equipe_pct numeric;
  v_meta_diferenca_caixa_mes int;
  v_limite_diferenca_caixa int;

  v_agora_local timestamp;
  v_dia_operacional date;
  v_inicio_hoje timestamptz;
  v_elapsed interval;
  v_mes_inicio date;
  v_mes_fim date;

  v_faturamento_hoje int;
  v_vendas_hoje int;
  v_ticket_hoje int;
  v_faturamento_sem_passada int;
  v_vendas_sem_passada int;
  v_ticket_sem_passada int;

  v_k int;
  v_inicio_k timestamptz;
  v_parcial_k int;
  v_total_dia_k int;
  v_soma_ritmo numeric := 0;
  v_amostras int := 0;
  v_projecao int;

  v_faturamento_mes int;
  v_cmv_mes int;
  v_perdas_mes int;
  v_despesas_mes int;
  v_resultado_mes int;
  v_contas_pendentes_mes int;
  v_falta_contas int;

  v_diferenca_caixa_mes int;

  v_atencao jsonb := '[]'::jsonb;
  v_tmp_qtd int;
  v_tmp_valor int;
  v_cancelamentos_hoje int;
  v_cancelamentos_media numeric;

  v_mesas_total int;
  v_mesas_ocupadas int;
  v_pedidos_atrasados int;
  v_caixas_abertos int;
begin
  if not restaurante.tem_permissao('admin.central_dono.ver') then
    raise exception 'Sem permissão para ver a Central do Dono';
  end if;

  select e.timezone, e.virada_dia_operacional_hora, e.config->'atrasoPorSetor',
      coalesce((e.config->'metasCentralDono'->>'cmvPct')::numeric, 35),
      coalesce((e.config->'metasCentralDono'->>'perdasPctFaturamento')::numeric, 3),
      coalesce((e.config->'metasCentralDono'->>'custoEquipePct')::numeric, 30),
      coalesce((e.config->'metasCentralDono'->>'diferencaCaixaCentavosMes')::int, 5000),
      coalesce((e.config->>'limiteDiferencaCentavos')::int, 500)
    into v_tz, v_virada, v_atraso_cfg, v_meta_cmv_pct, v_meta_perdas_pct, v_meta_custo_equipe_pct,
      v_meta_diferenca_caixa_mes, v_limite_diferenca_caixa
    from restaurante.empresas e where e.id = v_empresa_id;
  v_tz := coalesce(v_tz, 'America/Sao_Paulo');
  v_virada := coalesce(v_virada, 5);

  v_agora_local := now() at time zone v_tz;
  v_dia_operacional := (v_agora_local - ((v_virada)::text || ' hours')::interval)::date;
  v_inicio_hoje := (v_dia_operacional::timestamp + ((v_virada)::text || ' hours')::interval) at time zone v_tz;
  v_elapsed := now() - v_inicio_hoje;
  v_mes_inicio := date_trunc('month', v_dia_operacional)::date;
  v_mes_fim := (date_trunc('month', v_dia_operacional) + interval '1 month' - interval '1 day')::date;

  -- ---------- bloco 1: hoje até agora vs mesma janela da semana passada ----------
  select coalesce(sum(total_centavos),0)::int, count(*) into v_faturamento_hoje, v_vendas_hoje
    from restaurante.comandas
    where empresa_id = v_empresa_id and status = 'PAGA'
      and fechamento >= v_inicio_hoje and fechamento <= now();
  v_ticket_hoje := case when v_vendas_hoje>0 then round(v_faturamento_hoje::numeric/v_vendas_hoje)::int else 0 end;

  select coalesce(sum(total_centavos),0)::int, count(*) into v_faturamento_sem_passada, v_vendas_sem_passada
    from restaurante.comandas
    where empresa_id = v_empresa_id and status = 'PAGA'
      and fechamento >= v_inicio_hoje - interval '7 days'
      and fechamento <= v_inicio_hoje - interval '7 days' + v_elapsed;
  v_ticket_sem_passada := case when v_vendas_sem_passada>0 then round(v_faturamento_sem_passada::numeric/v_vendas_sem_passada)::int else 0 end;

  -- ritmo médio das últimas 4 semanas, mesmo dia da semana: quanto o dia
  -- INTEIRO costuma faturar frente ao que já tinha faturado até este
  -- mesmo ponto (mesma quantidade de tempo desde a virada) — projeta o
  -- fechamento de hoje sem fórmula nova a cada avaliação.
  for v_k in 1..4 loop
    v_inicio_k := v_inicio_hoje - ((v_k*7)::text || ' days')::interval;
    select coalesce(sum(total_centavos),0)::int into v_parcial_k
      from restaurante.comandas
      where empresa_id = v_empresa_id and status = 'PAGA'
        and fechamento >= v_inicio_k and fechamento <= v_inicio_k + v_elapsed;
    select coalesce(sum(total_centavos),0)::int into v_total_dia_k
      from restaurante.comandas
      where empresa_id = v_empresa_id and status = 'PAGA'
        and fechamento >= v_inicio_k and fechamento < v_inicio_k + interval '1 day';
    if v_parcial_k > 0 then
      v_soma_ritmo := v_soma_ritmo + (v_total_dia_k::numeric / v_parcial_k);
      v_amostras := v_amostras + 1;
    end if;
  end loop;
  v_projecao := round(v_faturamento_hoje * (case when v_amostras>0 then v_soma_ritmo/v_amostras else 1 end))::int;

  -- ---------- bloco 2: sobrou no mês (lucro estimado) ----------
  select coalesce(sum(total_centavos),0)::int into v_faturamento_mes
    from restaurante.comandas
    where empresa_id = v_empresa_id and status = 'PAGA' and dia_operacional between v_mes_inicio and v_mes_fim;

  select coalesce(sum(ci.quantidade * coalesce((
      select sum((ft.quantidade / restaurante.rendimento_atual(ft.insumo_id)) * i.custo_medio_centavos)
      from restaurante.ficha_tecnica ft join restaurante.insumos i on i.id = ft.insumo_id
      where ft.produto_id = ci.produto_id
    ), 0)), 0)::int into v_cmv_mes
    from restaurante.comanda_itens ci
    join restaurante.comandas c on c.id = ci.comanda_id
    where c.empresa_id = v_empresa_id and c.status = 'PAGA' and c.dia_operacional between v_mes_inicio and v_mes_fim
      and ci.status <> 'CANCELADO';

  select coalesce(sum(em.quantidade * i.custo_medio_centavos),0)::int into v_perdas_mes
    from restaurante.estoque_movimentos em
    join restaurante.insumos i on i.id = em.insumo_id
    where em.empresa_id = v_empresa_id and em.tipo = 'SAIDA'
      and em.created_at >= (v_mes_inicio::timestamp at time zone v_tz)
      and em.created_at < ((v_mes_fim + 1)::timestamp at time zone v_tz);

  select coalesce(sum(valor_centavos),0)::int into v_despesas_mes
    from restaurante.contas
    where empresa_id = v_empresa_id and tipo = 'PAGAR' and vencimento between v_mes_inicio and v_mes_fim;

  -- custo de equipe ainda não existe (Prioridade 5) — entra como 0 até lá.
  v_resultado_mes := v_faturamento_mes - v_cmv_mes - v_perdas_mes - v_despesas_mes;

  select coalesce(sum(valor_centavos),0)::int into v_contas_pendentes_mes
    from restaurante.contas
    where empresa_id = v_empresa_id and tipo = 'PAGAR' and pago_em is null and vencimento between v_mes_inicio and v_mes_fim;
  v_falta_contas := greatest(0, v_contas_pendentes_mes - v_resultado_mes);

  -- ---------- bloco 3: semáforos ----------
  select coalesce(sum(abs(diferenca_centavos)),0)::int into v_diferenca_caixa_mes
    from restaurante.caixa_sessoes
    where empresa_id = v_empresa_id and status = 'FECHADA' and fechamento_em is not null
      and (fechamento_em at time zone v_tz)::date between v_mes_inicio and v_mes_fim;

  -- ---------- bloco 4: precisa da sua atenção (no máx. 5, por gravidade) ----------
  select count(*) into v_tmp_qtd from restaurante.insumos where empresa_id = v_empresa_id and estoque_atual < 0;
  if v_tmp_qtd > 0 then
    v_atencao := v_atencao || jsonb_build_object('tipo','ESTOQUE_NEGATIVO','gravidade',90,'view','estoque','qtd',v_tmp_qtd);
  end if;

  select count(*), coalesce(sum(valor_centavos),0)::int into v_tmp_qtd, v_tmp_valor
    from restaurante.contas
    where empresa_id = v_empresa_id and tipo = 'PAGAR' and pago_em is null and vencimento <= v_dia_operacional;
  if v_tmp_qtd > 0 then
    v_atencao := v_atencao || jsonb_build_object('tipo','CONTAS_VENCENDO','gravidade',85,'view','financeiro','qtd',v_tmp_qtd,'valor_centavos',v_tmp_valor);
  end if;

  select cs.diferenca_centavos into v_tmp_valor
    from restaurante.caixa_sessoes cs
    where cs.empresa_id = v_empresa_id and cs.status = 'FECHADA' and cs.fechamento_em >= v_inicio_hoje
    order by cs.fechamento_em desc limit 1;
  if v_tmp_valor is not null and abs(v_tmp_valor) > v_limite_diferenca_caixa then
    v_atencao := v_atencao || jsonb_build_object('tipo','DIFERENCA_CAIXA','gravidade',80,'view','caixa','valor_centavos',v_tmp_valor);
  end if;

  select count(*) into v_tmp_qtd from restaurante.sync_conflitos where empresa_id = v_empresa_id and status = 'PENDENTE';
  if v_tmp_qtd > 0 then
    v_atencao := v_atencao || jsonb_build_object('tipo','CONFLITOS_OFFLINE','gravidade',75,'view','configuracoes','qtd',v_tmp_qtd);
  end if;

  select count(*) into v_cancelamentos_hoje
    from restaurante.comanda_itens ci join restaurante.comandas c on c.id = ci.comanda_id
    where c.empresa_id = v_empresa_id and c.dia_operacional = v_dia_operacional and ci.status = 'CANCELADO';
  select coalesce(avg(coalesce(x.cnt,0)),0) into v_cancelamentos_media
    from generate_series((v_dia_operacional - 7)::timestamp, (v_dia_operacional - 1)::timestamp, interval '1 day') as d(dia)
    left join (
      select c.dia_operacional as dia, count(*) as cnt
      from restaurante.comanda_itens ci join restaurante.comandas c on c.id = ci.comanda_id
      where c.empresa_id = v_empresa_id and ci.status = 'CANCELADO'
      group by c.dia_operacional
    ) x on x.dia = d.dia::date;
  if v_cancelamentos_hoje >= 3 and v_cancelamentos_hoje > (v_cancelamentos_media * 2) then
    v_atencao := v_atencao || jsonb_build_object('tipo','CANCELAMENTOS_ACIMA_DO_NORMAL','gravidade',70,'view','auditoria','qtd',v_cancelamentos_hoje,'media',round(v_cancelamentos_media,1));
  end if;

  -- ---------- bloco 5: agora no salão ----------
  select count(*) into v_mesas_total from restaurante.mesas where empresa_id = v_empresa_id;
  select count(distinct mesa_id) into v_mesas_ocupadas
    from restaurante.comandas
    where empresa_id = v_empresa_id and status in ('ABERTA','FECHANDO') and mesa_id is not null;
  select count(*) into v_caixas_abertos from restaurante.caixa_sessoes where empresa_id = v_empresa_id and status = 'ABERTA';
  select count(*) into v_pedidos_atrasados
    from restaurante.comanda_itens ci
    join restaurante.comandas c on c.id = ci.comanda_id
    join restaurante.produtos p on p.id = ci.produto_id
    where c.empresa_id = v_empresa_id and c.status in ('ABERTA','FECHANDO')
      and ci.status in ('PENDENTE','PREPARANDO')
      and now() - ci.enviado_em > (coalesce(v_atraso_cfg->>p.setor_producao,'10') || ' minutes')::interval;

  return jsonb_build_object(
    'dia_operacional', v_dia_operacional,
    'hoje', jsonb_build_object(
      'faturamento_centavos', v_faturamento_hoje, 'vendas', v_vendas_hoje, 'ticket_medio_centavos', v_ticket_hoje,
      'faturamento_semana_passada_centavos', v_faturamento_sem_passada, 'vendas_semana_passada', v_vendas_sem_passada,
      'ticket_medio_semana_passada_centavos', v_ticket_sem_passada,
      'variacao_faturamento_pct', case when v_faturamento_sem_passada>0 then round((v_faturamento_hoje - v_faturamento_sem_passada)::numeric/v_faturamento_sem_passada*100,1) else null end,
      'variacao_vendas_pct', case when v_vendas_sem_passada>0 then round((v_vendas_hoje - v_vendas_sem_passada)::numeric/v_vendas_sem_passada*100,1) else null end,
      'variacao_ticket_pct', case when v_ticket_sem_passada>0 then round((v_ticket_hoje - v_ticket_sem_passada)::numeric/v_ticket_sem_passada*100,1) else null end,
      'projecao_fechamento_centavos', v_projecao
    ),
    'mes', jsonb_build_object(
      'faturamento_centavos', v_faturamento_mes, 'cmv_centavos', v_cmv_mes, 'perdas_centavos', v_perdas_mes,
      'despesas_centavos', v_despesas_mes, 'custo_equipe_centavos', 0, 'custo_equipe_disponivel', false,
      'pode_ver_resultado', (v_papel = 'ADMIN'),
      'resultado_centavos', case when v_papel='ADMIN' then v_resultado_mes else null end,
      'contas_a_pagar_pendentes_centavos', v_contas_pendentes_mes,
      'falta_para_cobrir_contas_centavos', case when v_papel='ADMIN' then v_falta_contas else null end
    ),
    'semaforos', jsonb_build_object(
      'cmv_pct', case when v_faturamento_mes>0 then round(v_cmv_mes::numeric/v_faturamento_mes*100,1) else null end,
      'perdas_pct_faturamento', case when v_faturamento_mes>0 then round(v_perdas_mes::numeric/v_faturamento_mes*100,1) else null end,
      'custo_equipe_pct', null, 'custo_equipe_disponivel', false,
      'diferenca_caixa_centavos_mes', v_diferenca_caixa_mes,
      'metas', jsonb_build_object('cmv_pct',v_meta_cmv_pct,'perdas_pct_faturamento',v_meta_perdas_pct,'custo_equipe_pct',v_meta_custo_equipe_pct,'diferenca_caixa_centavos_mes',v_meta_diferenca_caixa_mes)
    ),
    'atencao', v_atencao,
    'salao', jsonb_build_object(
      'mesas_total', v_mesas_total, 'mesas_ocupadas', v_mesas_ocupadas,
      'pedidos_atrasados_cozinha', v_pedidos_atrasados, 'caixas_abertos', v_caixas_abertos
    )
  );
end;
$$;

revoke all on function restaurante.central_do_dono() from public;
grant execute on function restaurante.central_do_dono() to authenticated;
