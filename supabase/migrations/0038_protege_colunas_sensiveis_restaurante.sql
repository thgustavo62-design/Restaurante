-- As policies de UPDATE em comandas/comanda_itens liberam a escrita se o
-- papel tiver QUALQUER UMA de várias permissões (abrir OU fechar OU
-- desconto.aplicar OU ...), sem olhar qual coluna está mudando. Isso
-- significa que hoje um GARCOM (que só tem abrir/fechar) consegue gravar
-- desconto_centavos direto via supabase-js no console do navegador, e uma
-- COZINHA (que só tem cozinha.item.atualizar_status) consegue marcar
-- qualquer item como CANCELADO, ou até reescrever preço/quantidade —
-- ignorando por completo o fluxo de PIN de supervisor, que só existe no
-- client. docs/rotas-permissoes.md (linha 74-76) afirma que "a policy de
-- RLS é quem efetivamente bloqueia a escrita" — não bloqueava.
--
-- Trigger em vez de policy porque só um trigger compara OLD e NEW ao mesmo
-- tempo (RLS não tem acesso às duas versões da linha numa única expressão).

create or replace function restaurante.trg_comandas_protege_colunas()
returns trigger
language plpgsql
set search_path = restaurante, pg_temp
as $$
begin
  if new.desconto_centavos is distinct from old.desconto_centavos
     and not restaurante.tem_permissao('atendimento.comanda.desconto.aplicar') then
    raise exception 'Sem permissão para alterar o desconto da comanda';
  end if;

  if (new.mesa_id is distinct from old.mesa_id or new.tipo is distinct from old.tipo)
     and not restaurante.tem_permissao('atendimento.comanda.transferir') then
    raise exception 'Sem permissão para transferir a comanda';
  end if;

  if new.empresa_id is distinct from old.empresa_id
     or new.codigo is distinct from old.codigo
     or new.usuario_abertura is distinct from old.usuario_abertura
     or new.abertura is distinct from old.abertura then
    raise exception 'Campo somente leitura da comanda não pode ser alterado';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_comandas_protege_colunas on restaurante.comandas;
create trigger trg_comandas_protege_colunas
  before update on restaurante.comandas
  for each row execute function restaurante.trg_comandas_protege_colunas();

create or replace function restaurante.trg_comanda_itens_protege_colunas()
returns trigger
language plpgsql
set search_path = restaurante, pg_temp
as $$
begin
  if new.status = 'CANCELADO' and old.status <> 'CANCELADO' then
    if not restaurante.tem_permissao('atendimento.comanda.item.cancelar') then
      raise exception 'Sem permissão para cancelar item';
    end if;
    if coalesce(trim(new.motivo_cancelamento), '') = '' then
      raise exception 'Motivo do cancelamento é obrigatório';
    end if;
  end if;

  if new.comanda_id is distinct from old.comanda_id
     and not restaurante.tem_permissao('atendimento.comanda.transferir') then
    raise exception 'Sem permissão para transferir item entre comandas';
  end if;

  if new.produto_id is distinct from old.produto_id
     or new.nome is distinct from old.nome
     or new.preco_unit_centavos is distinct from old.preco_unit_centavos
     or new.quantidade is distinct from old.quantidade then
    raise exception 'Item lançado não pode ter produto, nome, preço ou quantidade alterados';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_comanda_itens_protege_colunas on restaurante.comanda_itens;
create trigger trg_comanda_itens_protege_colunas
  before update on restaurante.comanda_itens
  for each row execute function restaurante.trg_comanda_itens_protege_colunas();
