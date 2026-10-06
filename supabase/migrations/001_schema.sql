-- MG Inventory Control: schema. All tables are locked (RLS on, no policies, no grants);
-- the app talks to the database ONLY through public.api(...) (see 002_api.sql).
create schema if not exists private;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  username text not null unique,
  permissions text[] not null default '{}',
  is_active boolean not null default true,
  must_change_password boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  name text not null unique, location text,
  is_active boolean not null default true, created_at timestamptz not null default now()
);
create table public.items (
  id uuid primary key default gen_random_uuid(),
  code text not null unique, name text not null, barcode text unique, category text,
  unit text not null default 'قطعة',
  min_qty numeric(18,3) not null default 0 check (min_qty >= 0),
  notes text, is_active boolean not null default true, created_at timestamptz not null default now()
);
create table public.parties (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('supplier','customer')),
  name text not null, phone text, notes text,
  is_active boolean not null default true, created_at timestamptz not null default now()
);
create table public.stock_documents (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  type text not null check (type in ('in','out','transfer')),
  date date not null default current_date,
  from_warehouse_id uuid references public.warehouses(id),
  to_warehouse_id uuid references public.warehouses(id),
  party_id uuid references public.parties(id),
  reference text, notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create table public.stock_document_lines (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.stock_documents(id) on delete cascade,
  item_id uuid not null references public.items(id),
  qty numeric(18,3) not null check (qty > 0)
);
create table public.stock_balances (
  item_id uuid not null references public.items(id),
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  qty numeric(18,3) not null default 0 check (qty >= 0),
  primary key (item_id, warehouse_id)
);
create table public.doc_counters (key text primary key, last int not null default 0);

create index on public.stock_documents (date desc, created_at desc);
create index on public.stock_documents (from_warehouse_id);
create index on public.stock_documents (to_warehouse_id);
create index on public.stock_documents (party_id);
create index on public.stock_documents (created_by);
create index on public.stock_document_lines (document_id);
create index on public.stock_document_lines (item_id);
create index on public.stock_balances (warehouse_id);

alter table public.profiles enable row level security;
alter table public.warehouses enable row level security;
alter table public.items enable row level security;
alter table public.parties enable row level security;
alter table public.stock_documents enable row level security;
alter table public.stock_document_lines enable row level security;
alter table public.stock_balances enable row level security;
alter table public.doc_counters enable row level security;
revoke all on all tables in schema public from anon, authenticated;
