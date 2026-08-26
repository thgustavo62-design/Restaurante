-- FIADO/CREDITO/VOUCHER agora geram uma linha em public.contas (RECEBER)
-- automaticamente ao confirmar o pagamento. Mas quem confirma pagamento
-- normalmente tem só caixa.pagamento.registrar (papel CAIXA), não
-- admin.financeiro.ver — a policy de insert original exigia só esta
-- última, bloqueando silenciosamente a criação do recebível via RLS.

drop policy if exists contas_insert on public.contas;
create policy contas_insert on public.contas for insert
  with check (
    empresa_id = public.jwt_empresa_id()
    and (public.tem_permissao('admin.financeiro.ver') or public.tem_permissao('caixa.pagamento.registrar'))
  );
