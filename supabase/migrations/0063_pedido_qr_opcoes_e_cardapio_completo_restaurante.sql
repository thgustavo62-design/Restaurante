-- Fase 5 (continuação) — pedido pelo QR com cardápio COMPLETO.
--
-- Até aqui, todo produto com grupo de opção OBRIGATÓRIO (ex: "Ponto da
-- carne") ficava banido do pedido pelo QR — criar_pedido_qr rejeitava de
-- cara, e o front mostrava "peça direto com o garçom". Isso deixava boa
-- parte do cardápio de fora do autoatendimento. Agora criar_pedido_qr
-- aceita opcoes_selecionadas por item e valida grupo a grupo (mesmo
-- mínimo/máximo/obrigatoriedade que trg_comanda_itens_calcula_preco,
-- 0051/0056, já valida pra qualquer lançamento) — só rejeita se as
-- opções escolhidas não cobrirem o que o grupo exige, igual qualquer
-- lançamento de garçom já exigia. Preço e nome de cada opção são sempre
-- relidos do banco, nunca confiados no que o celular do cliente mandou.
--
-- confirmar_pedido_qr passa a levar opcoes_selecionadas pro
-- comanda_itens de verdade — a MESMA trigger revalida e recalcula o
-- preço final na hora de confirmar (dupla checagem: uma vez na criação
-- do pedido QR, outra na confirmação, nunca confiando no que ficou
-- gravado entre as duas).

create or replace function restaurante.criar_pedido_qr(
  p_slug text, p_mesa_numero int, p_itens jsonb, p_observacao text default null
)
returns uuid
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid;
  v_mesa_id uuid;
  v_elem jsonb;
  v_produto restaurante.produtos%rowtype;
  v_itens_final jsonb := '[]'::jsonb;
  v_qtd numeric;
  v_pedido_id uuid;
  v_ids uuid[];
  v_grupo restaurante.grupos_opcoes%rowtype;
  v_qtd_grupo int;
  v_adicional int;
  v_opcoes_final jsonb;
  v_opcao_id uuid;
  v_opcao_row record;
begin
  select id into v_empresa_id from restaurante.empresas where slug = p_slug;
  if v_empresa_id is null then
    raise exception 'Restaurante não encontrado';
  end if;

  select id into v_mesa_id from restaurante.mesas where empresa_id = v_empresa_id and numero = p_mesa_numero;
  if v_mesa_id is null then
    raise exception 'Mesa não encontrada';
  end if;

  if jsonb_array_length(p_itens) = 0 then
    raise exception 'Pedido vazio';
  end if;

  for v_elem in select * from jsonb_array_elements(p_itens)
  loop
    select * into v_produto from restaurante.produtos
      where id = (v_elem->>'produto_id')::uuid and empresa_id = v_empresa_id;
    if not found or not v_produto.ativo or v_produto.esgotado then
      raise exception 'Produto indisponível no cardápio';
    end if;
    v_qtd := (v_elem->>'quantidade')::numeric;
    if not (v_qtd > 0) then
      raise exception 'Quantidade inválida';
    end if;

    select coalesce(array_agg((elem->>'opcao_id')::uuid), '{}') into v_ids
      from jsonb_array_elements(coalesce(v_elem->'opcoes_selecionadas', '[]'::jsonb)) elem;

    for v_grupo in select * from restaurante.grupos_opcoes where produto_id = v_produto.id
    loop
      select count(*) into v_qtd_grupo
        from restaurante.opcoes o
        where o.grupo_id = v_grupo.id and o.id = any(v_ids);
      if v_grupo.obrigatorio and v_qtd_grupo < v_grupo.minimo then
        raise exception 'Escolha pelo menos % opção(ões) em "%" para "%"', v_grupo.minimo, v_grupo.nome, v_produto.nome;
      end if;
      if v_qtd_grupo > v_grupo.maximo then
        raise exception 'No máximo % opção(ões) em "%" para "%"', v_grupo.maximo, v_grupo.nome, v_produto.nome;
      end if;
    end loop;

    v_adicional := 0;
    v_opcoes_final := '[]'::jsonb;
    if array_length(v_ids, 1) is not null then
      for v_opcao_id in select unnest(v_ids)
      loop
        select o.id, o.nome, o.preco_adicional_centavos, o.ativo, g.produto_id as prod_id
          into v_opcao_row
          from restaurante.opcoes o
          join restaurante.grupos_opcoes g on g.id = o.grupo_id
          where o.id = v_opcao_id;
        if not found or v_opcao_row.prod_id <> v_produto.id or not v_opcao_row.ativo then
          raise exception 'Opção inválida para "%"', v_produto.nome;
        end if;
        v_adicional := v_adicional + v_opcao_row.preco_adicional_centavos;
        v_opcoes_final := v_opcoes_final || jsonb_build_object(
          'opcao_id', v_opcao_row.id, 'nome', v_opcao_row.nome,
          'preco_adicional_centavos', v_opcao_row.preco_adicional_centavos
        );
      end loop;
    end if;

    v_itens_final := v_itens_final || jsonb_build_object(
      'produto_id', v_produto.id, 'nome', v_produto.nome,
      'quantidade', v_qtd, 'preco_unit_centavos', v_produto.preco_centavos + v_adicional,
      'opcoes_selecionadas', v_opcoes_final
    );
  end loop;

  insert into restaurante.pedidos_qr (empresa_id, mesa_id, itens, observacao)
  values (v_empresa_id, v_mesa_id, v_itens_final, nullif(trim(coalesce(p_observacao,'')),''))
  returning id into v_pedido_id;

  return v_pedido_id;
exception
  when unique_violation then
    raise exception 'Essa mesa já tem um pedido aguardando confirmação do garçom';
end;
$$;

revoke all on function restaurante.criar_pedido_qr(text, int, jsonb, text) from public;
grant execute on function restaurante.criar_pedido_qr(text, int, jsonb, text) to anon, authenticated;

create or replace function restaurante.confirmar_pedido_qr(p_pedido_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_usuario_id uuid := auth.uid();
  v_pedido restaurante.pedidos_qr%rowtype;
  v_comanda restaurante.comandas%rowtype;
  v_elem jsonb;
  v_produto restaurante.produtos%rowtype;
  v_novo_item restaurante.comanda_itens%rowtype;
  v_itens_criados jsonb := '[]'::jsonb;
begin
  if not restaurante.tem_permissao('atendimento.comanda.item.lancar') then
    raise exception 'Sem permissão para lançar item';
  end if;

  select * into v_pedido from restaurante.pedidos_qr
    where id = p_pedido_id and empresa_id = v_empresa_id for update;
  if not found then
    raise exception 'Pedido não encontrado';
  end if;
  if v_pedido.status <> 'PENDENTE' then
    raise exception 'Pedido já foi %', v_pedido.status;
  end if;

  select * into v_comanda from restaurante.comandas
    where mesa_id = v_pedido.mesa_id and empresa_id = v_empresa_id and status in ('ABERTA','FECHANDO')
    order by abertura desc limit 1 for update;
  if not found then
    insert into restaurante.comandas (empresa_id, codigo, mesa_id, tipo, status, usuario_abertura, taxa_servico_ativa, desconto_centavos)
    values (v_empresa_id, 'C'||to_char(now(),'YYYYMMDDHH24MISS'), v_pedido.mesa_id, 'MESA', 'ABERTA', v_usuario_id, true, 0)
    returning * into v_comanda;
  end if;

  for v_elem in select * from jsonb_array_elements(v_pedido.itens)
  loop
    select * into v_produto from restaurante.produtos where id = (v_elem->>'produto_id')::uuid;
    if found and v_produto.ativo and not v_produto.esgotado then
      insert into restaurante.comanda_itens
        (comanda_id, produto_id, nome, observacao, quantidade, preco_unit_centavos, status, usuario_id, setor_producao, opcoes_selecionadas)
      values (
        v_comanda.id, v_produto.id, v_produto.nome, v_pedido.observacao,
        (v_elem->>'quantidade')::numeric, v_produto.preco_centavos, 'PENDENTE', v_usuario_id, v_produto.setor_producao,
        coalesce(v_elem->'opcoes_selecionadas', '[]'::jsonb)
      )
      returning * into v_novo_item;
      v_itens_criados := v_itens_criados || to_jsonb(v_novo_item);
    end if;
  end loop;

  update restaurante.pedidos_qr
    set status = 'CONFIRMADO', confirmado_por = v_usuario_id, comanda_id = v_comanda.id
    where id = p_pedido_id;

  return jsonb_build_object('comanda', to_jsonb(v_comanda), 'itens', v_itens_criados);
end;
$$;

revoke all on function restaurante.confirmar_pedido_qr(uuid) from public;
grant execute on function restaurante.confirmar_pedido_qr(uuid) to authenticated;
