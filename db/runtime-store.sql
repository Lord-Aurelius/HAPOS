create schema if not exists app;

create table if not exists app.runtime_state (
  id integer primary key check (id = 1),
  state jsonb not null,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
