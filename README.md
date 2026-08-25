# Sistema de Gestão para Restaurante/Bar

PWA de atendimento, caixa e administração para food service (React + TS +
Vite + Supabase). Ver a especificação completa que originou este repositório
no histórico de conversa / prompt mestre.

## Estado atual — Fase 0, entregáveis "COMECE AQUI"

Antes de gerar código de aplicação, foram produzidos os três entregáveis
pedidos:

1. **Diagrama ER completo** → [`docs/ER.md`](docs/ER.md)
2. **Rotas + matriz de permissão por papel** → [`docs/rotas-permissoes.md`](docs/rotas-permissoes.md)
3. **Migrations da Fase 0** → [`supabase/migrations/`](supabase/migrations/)
   - `0001_extensions_tipos.sql` — extensões, enum `papel_usuario`, helper `set_updated_at()`
   - `0002_nucleo_tabelas.sql` — `empresas`, `usuarios`, `papeis_permissoes`, `auditoria` + trigger de auditoria genérica
   - `0003_funcoes_auth.sql` — `jwt_empresa_id()`, `jwt_papel()`, `tem_permissao()`, `custom_access_token_hook()`
   - `0004_rls_policies.sql` — RLS por `empresa_id` + permissão em todas as tabelas do núcleo
   - `0005_seed_papeis_permissoes.sql` — catálogo RBAC (5 papéis × 23 permissões)

Nenhum código de aplicação (React, Zustand, Dexie etc.) foi criado ainda —
conforme instrução do prompt mestre, o projeto **para aqui e aguarda
validação** antes de seguir para a Fase 0 restante (setup do front-end,
auth, layout base) e Fase 1 (cardápio + mesas + comanda).

## Pré-requisito ainda pendente nesta máquina

Não encontrei **Node.js/npm** instalado neste ambiente (`node`, `npx` e os
caminhos usuais de instalação não existem em `PATH` nem em
`Program Files`/`AppData`). Os artefatos desta fase são só SQL e Markdown —
não precisam de Node para existir —, mas a partir da próxima fase (scaffold
Vite/React) será necessário instalar o Node.js (LTS) antes de continuar.

## Status do Supabase

As 5 migrations da Fase 0 já foram aplicadas no projeto Supabase real
(`empresas`, `usuarios`, `papeis_permissoes`, `auditoria`, RLS e o seed de
60 permissões do RBAC). Credenciais em `.env` (não versionado — copie de
`.env.example`).

Pendente, feito só pelo painel (não por SQL): **Authentication → Hooks →
Custom Access Token**, apontando para `public.custom_access_token_hook` —
é isso que injeta `empresa_id` e `papel` no JWT usados pelas policies de
RLS.

Para reaplicar/atualizar migrations futuras:

```powershell
# via psql direto (connection string em .env, senha via Project Settings → Database)
psql "postgresql://postgres.<ref>:<senha>@aws-0-us-west-2.pooler.supabase.com:5432/postgres" -f supabase/migrations/000X_arquivo.sql

# ou, quando a Supabase CLI estiver instalada e o projeto vinculado:
supabase db push
```

## Próximos passos (após validação)

- Completar Fase 0: scaffold Vite + TS + Tailwind + shadcn/ui, tela de
  login, guard de rota por permissão, layout base.
- Criar a primeira `empresa` e o primeiro `usuario` (`ADMIN`) via seed
  controlado (não incluso aqui — depende de um `auth.users` real).
- Fase 1: cardápio, mesas, comandas, lançamento de itens.
