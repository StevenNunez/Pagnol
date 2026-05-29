-- ============================================================
-- Migración: Control de Calidad — Protocolos de Construcción
-- Ejecutar en Supabase SQL Editor (una sola vez)
-- ============================================================

-- 1. Plantillas de protocolo (protocol_templates)
-- ============================================================
create table if not exists protocol_templates (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  title         text not null,
  type          text not null,          -- 'inicio' | 'entrega'
  activity_type text not null default '',
  objective     text not null default '',
  normativa     jsonb not null default '[]',
  responsibilities jsonb not null default '[]',
  items         jsonb not null default '[]',
  created_by    uuid references profiles(id) on delete set null,
  created_at    timestamptz default now()
);

alter table protocol_templates enable row level security;

create policy "pt_select" on protocol_templates for select
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()));
create policy "pt_insert" on protocol_templates for insert
  with check (tenant_id = (select tenant_id from profiles where id = auth.uid()));
create policy "pt_update" on protocol_templates for update
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()));
create policy "pt_delete" on protocol_templates for delete
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()));

create index if not exists idx_protocol_templates_tenant_id on protocol_templates (tenant_id);


-- 2. Protocolos ejecutados (protocols)
-- ============================================================
create table if not exists protocols (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references tenants(id) on delete cascade,
  template_id              uuid references protocol_templates(id) on delete set null,
  work_item_id             uuid,   -- referencia opcional a work_items
  title                    text not null,
  type                     text not null,          -- 'inicio' | 'entrega'
  activity_type            text not null default '',
  obra                     text not null default '',
  objective                text not null default '',
  normativa                jsonb not null default '[]',
  responsibilities         jsonb not null default '[]',
  items                    jsonb not null default '[]',
  status                   text not null default 'borrador',
    -- 'borrador' | 'pendiente_revision' | 'aprobado' | 'rechazado'
  evidence_photos          jsonb not null default '[]',
  executor_signature       jsonb,   -- { userId, name, role, signature, date }
  supervisor_signature     jsonb,
  quality_manager_signature jsonb,
  rejection_reason         text,
  created_by               uuid references profiles(id) on delete set null,
  created_at               timestamptz default now(),
  completed_at             timestamptz,
  reviewed_at              timestamptz
);

alter table protocols enable row level security;

create policy "p_select" on protocols for select
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()));
create policy "p_insert" on protocols for insert
  with check (tenant_id = (select tenant_id from profiles where id = auth.uid()));
create policy "p_update" on protocols for update
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()));
create policy "p_delete" on protocols for delete
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()));

create index if not exists idx_protocols_tenant_id  on protocols (tenant_id);
create index if not exists idx_protocols_status     on protocols (tenant_id, status);
create index if not exists idx_protocols_template   on protocols (template_id) where template_id is not null;
