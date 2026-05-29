-- ============================================================
-- Migración: Contratos y Turnos para Minería
-- Ejecutar en Supabase SQL Editor (una sola vez)
-- ============================================================

-- 1. Turnos de trabajo (shift_schedules)
-- ============================================================
create table if not exists shift_schedules (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references tenants(id) on delete cascade,
  name                   text not null,
  shift_type             text not null default '7x7',
  days_on                int  not null default 7,
  days_off               int  not null default 7,
  work_start             time not null default '08:00',
  work_end               time not null default '20:00',
  is_night_shift         boolean not null default false,
  lunch_start            time,
  lunch_end              time,
  rotation_reference_date date not null default current_date,
  created_at             timestamptz default now()
);

alter table shift_schedules enable row level security;

create policy "shift_select" on shift_schedules for select
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()));
create policy "shift_insert" on shift_schedules for insert
  with check (tenant_id = (select tenant_id from profiles where id = auth.uid()));
create policy "shift_update" on shift_schedules for update
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()));
create policy "shift_delete" on shift_schedules for delete
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()));


-- 2. Contratos (contracts)
-- ============================================================
create table if not exists contracts (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  name         text not null,
  code         text,
  client_name  text,
  location     text,
  status       text not null default 'active',  -- active | suspended | closed
  start_date   date not null,
  end_date     date,
  description  text,
  created_by   uuid references profiles(id) on delete set null,
  created_at   timestamptz default now()
);

alter table contracts enable row level security;

create policy "contract_select" on contracts for select
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()));
create policy "contract_insert" on contracts for insert
  with check (tenant_id = (select tenant_id from profiles where id = auth.uid()));
create policy "contract_update" on contracts for update
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()));
create policy "contract_delete" on contracts for delete
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()));


-- 3. Asignación trabajador-contrato (contract_workers)
-- ============================================================
create table if not exists contract_workers (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  contract_id        uuid not null references contracts(id) on delete cascade,
  user_id            uuid not null references profiles(id) on delete cascade,
  shift_schedule_id  uuid references shift_schedules(id) on delete set null,
  role_in_contract   text,
  start_date         date,
  end_date           date,   -- null = activo en el contrato
  created_at         timestamptz default now(),
  unique (contract_id, user_id)
);

alter table contract_workers enable row level security;

create policy "cw_select" on contract_workers for select
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()));
create policy "cw_insert" on contract_workers for insert
  with check (tenant_id = (select tenant_id from profiles where id = auth.uid()));
create policy "cw_update" on contract_workers for update
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()));
create policy "cw_delete" on contract_workers for delete
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()));


-- 4. Añadir contract_id a attendance_logs (retrocompatible)
-- ============================================================
alter table attendance_logs
  add column if not exists contract_id uuid references contracts(id) on delete set null;

-- Índice para consultas por contrato
create index if not exists idx_attendance_logs_contract_id
  on attendance_logs (contract_id)
  where contract_id is not null;

-- Índices de rendimiento
create index if not exists idx_contract_workers_contract_id on contract_workers (contract_id);
create index if not exists idx_contract_workers_user_id     on contract_workers (user_id);
create index if not exists idx_shift_schedules_tenant_id    on shift_schedules (tenant_id);
create index if not exists idx_contracts_tenant_id          on contracts (tenant_id, status);
