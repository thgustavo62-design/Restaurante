-- Fase A4 — Transferir e juntar.
--
-- 'atendimento.comanda.transferir' já existia na semente de RBAC (0021,
-- espelhando a 0005 original) mas nunca foi usada em nenhuma policy —
-- transferir mudava comandas.tipo/mesa_id/ficha_numero (coberto por
-- 'abrir'/'fechar', que o GARCOM já tem) mas juntar precisa mover linhas de
-- comanda_itens pra outra comanda, e isso exigia
-- 'cozinha.item.atualizar_status' ou 'atendimento.comanda.item.cancelar' —
-- nenhuma das duas é do GARCOM. Sem este fix, um garçom não consegue
-- juntar duas mesas.

drop policy if exists comanda_itens_update on restaurante.comanda_itens;
create policy comanda_itens_update on restaurante.comanda_itens for update
  using (
    (restaurante.tem_permissao('cozinha.item.atualizar_status')
      or restaurante.tem_permissao('atendimento.comanda.item.cancelar')
      or restaurante.tem_permissao('atendimento.comanda.transferir'))
    and exists (select 1 from restaurante.comandas c where c.id = comanda_id and c.empresa_id = restaurante.jwt_empresa_id())
  );

drop policy if exists comandas_update on restaurante.comandas;
create policy comandas_update on restaurante.comandas for update
  using (
    empresa_id = restaurante.jwt_empresa_id()
    and (restaurante.tem_permissao('atendimento.comanda.fechar') or restaurante.tem_permissao('atendimento.comanda.abrir')
         or restaurante.tem_permissao('atendimento.comanda.desconto.aplicar') or restaurante.tem_permissao('atendimento.comanda.reabrir')
         or restaurante.tem_permissao('atendimento.comanda.transferir'))
  );
