-- Fase 0 — Extensões e tipos base

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

do $$
begin
  create type public.papel_usuario as enum ('ADMIN', 'GERENTE', 'CAIXA', 'GARCOM', 'COZINHA');
exception
  when duplicate_object then null;
end
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
