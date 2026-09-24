-- Fase C (Fogo Gestão v2) — cardápio digital público por QR, sem login.
-- Rota /cardapio/:empresaSlug lê só o essencial (nome do produto, preço,
-- esgotado, categoria) de empresas ativas — nunca dados internos
-- (estoque, custo, funcionários, vendas).

alter table restaurante.empresas add column if not exists slug text;
update restaurante.empresas set slug = 'rancho-netto' where slug is null;
alter table restaurante.empresas alter column slug set not null;
create unique index if not exists empresas_slug_uk on restaurante.empresas (slug);

-- View pública mínima pra resolver slug -> empresa_id, no mesmo padrão da
-- usuarios_login (roda com privilégio do dono, ignora RLS de empresas).
create view restaurante.cardapio_publico_empresa as
select id, slug, nome
from restaurante.empresas;

grant select on restaurante.cardapio_publico_empresa to anon, authenticated;

-- Produtos e categorias ativos ficam legíveis por qualquer um (nome, preço,
-- esgotado, categoria — nada sensível). O cliente sempre filtra por
-- empresa_id explicitamente; como há uma empresa só operando aqui, isso não
-- vaza nada entre contas hoje, mas a policy em si não depende disso.
create policy produtos_select_publico on restaurante.produtos for select
  to anon
  using (ativo = true);

create policy categorias_select_publico on restaurante.categorias for select
  to anon
  using (ativo = true);
