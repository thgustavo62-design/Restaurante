-- Fase 2.8 — Bar: couvert por pessoa e happy hour.
--
-- Couvert: comandas.pessoas guarda quantas pessoas estão na mesa; o
-- couvert em si continua sendo um produto comum do cardápio (ex: "Couvert
-- Artístico") lançado como item normal — só adicionei o número de pessoas
-- pra UI sugerir a quantidade certa com um clique, sem criar um segundo
-- jeito de cobrar paralelo ao de produto normal.
--
-- Happy hour: produtos.preco_happy_hour_centavos é o preço alternativo
-- nesse horário; o preço efetivo é calculado no MESMO trigger que já
-- calcula o preço final do item (0051) — nunca confiado ao client.
--
-- Suposição (não pedido explicitamente no roteiro): "doses por garrafa" e
-- "comanda individual por cartão/pulseira numerada" (também no item 2.8)
-- já são cobertos pelo que existe — ficha_tecnica (quantidade fracionária
-- por dose, ex: 1/15 de uma garrafa) e o tipo de comanda FICHA (número
-- autoatribuído já existe desde a Fase A do v2) fazem exatamente isso.
-- Criar um mecanismo novo pra cada um duplicaria o que já funciona; não
-- fiz isso sozinho sem confirmar que realmente precisa de algo diferente.

alter table restaurante.comandas add column if not exists pessoas int;
alter table restaurante.produtos add column if not exists preco_happy_hour_centavos int check (preco_happy_hour_centavos is null or preco_happy_hour_centavos >= 0);

create or replace function restaurante.trg_comanda_itens_calcula_preco()
returns trigger
language plpgsql
set search_path = restaurante, pg_temp
as $$
declare
  v_produto restaurante.produtos%rowtype;
  v_empresa restaurante.empresas%rowtype;
  v_grupo restaurante.grupos_opcoes%rowtype;
  v_qtd_grupo int;
  v_adicional int := 0;
  v_opcoes_final jsonb := '[]'::jsonb;
  v_ids uuid[];
  v_opcao_id uuid;
  v_opcao_row record;
  v_preco_base int;
  v_hora_ini text;
  v_hora_fim text;
  v_hora_agora text;
  v_em_happy_hour boolean := false;
begin
  select * into v_produto from restaurante.produtos where id = new.produto_id;
  if not found then
    raise exception 'Produto não encontrado';
  end if;

  v_preco_base := v_produto.preco_centavos;

  -- happy hour: janela configurada em empresas.config, preço alternativo
  -- só entra se o produto tiver um cadastrado e o horário atual cair
  -- dentro da janela (janela que vira o dia, tipo 17:00-19:00, compara
  -- direto; não trata janela que cruza meia-noite, incomum pra happy hour).
  if v_produto.preco_happy_hour_centavos is not null then
    select * into v_empresa from restaurante.empresas where id = v_produto.empresa_id;
    v_hora_ini := v_empresa.config->>'happyHoraInicio';
    v_hora_fim := v_empresa.config->>'happyHoraFim';
    if v_hora_ini is not null and v_hora_fim is not null and v_hora_ini <> '' and v_hora_fim <> '' then
      v_hora_agora := to_char(now(), 'HH24:MI');
      v_em_happy_hour := v_hora_agora >= v_hora_ini and v_hora_agora < v_hora_fim;
      if v_em_happy_hour then
        v_preco_base := v_produto.preco_happy_hour_centavos;
      end if;
    end if;
  end if;

  select coalesce(array_agg((elem->>'opcao_id')::uuid), '{}') into v_ids
    from jsonb_array_elements(coalesce(new.opcoes_selecionadas, '[]'::jsonb)) elem;

  for v_grupo in select * from restaurante.grupos_opcoes where produto_id = new.produto_id
  loop
    select count(*) into v_qtd_grupo
      from restaurante.opcoes o
      where o.grupo_id = v_grupo.id and o.id = any(v_ids);
    if v_grupo.obrigatorio and v_qtd_grupo < v_grupo.minimo then
      raise exception 'Escolha pelo menos % opção(ões) em "%"', v_grupo.minimo, v_grupo.nome;
    end if;
    if v_qtd_grupo > v_grupo.maximo then
      raise exception 'No máximo % opção(ões) em "%"', v_grupo.maximo, v_grupo.nome;
    end if;
  end loop;

  if array_length(v_ids, 1) is not null then
    for v_opcao_id in select unnest(v_ids)
    loop
      select o.id, o.nome, o.preco_adicional_centavos, o.ativo, g.produto_id as prod_id
        into v_opcao_row
        from restaurante.opcoes o
        join restaurante.grupos_opcoes g on g.id = o.grupo_id
        where o.id = v_opcao_id;
      if not found or v_opcao_row.prod_id <> new.produto_id or not v_opcao_row.ativo then
        raise exception 'Opção inválida para este produto';
      end if;
      v_adicional := v_adicional + v_opcao_row.preco_adicional_centavos;
      v_opcoes_final := v_opcoes_final || jsonb_build_object(
        'opcao_id', v_opcao_row.id, 'nome', v_opcao_row.nome,
        'preco_adicional_centavos', v_opcao_row.preco_adicional_centavos
      );
    end loop;
  end if;

  new.opcoes_selecionadas := v_opcoes_final;
  new.preco_unit_centavos := v_preco_base + v_adicional;
  return new;
end;
$$;
