-- ============================================================
-- Migración: Mejoras minería — marcas extendidas y subcontratistas
-- Ejecutar en Supabase SQL Editor (una sola vez)
-- ============================================================

-- 1. Marcas de asistencia extendidas en attendance_logs
-- ============================================================
alter table attendance_logs
  add column if not exists mark_type text;  -- P | A | D | LM | PSG | V | PP | MJ | ATR

alter table attendance_logs
  add column if not exists method_extended text; -- permite 'import' además de qr/manual

-- 2. Campos de subcontratistas en contracts
-- ============================================================
alter table contracts
  add column if not exists is_subcontractor boolean not null default false;

alter table contracts
  add column if not exists parent_contract_id uuid references contracts(id) on delete set null;

alter table contracts
  add column if not exists subcontractor_company text;

alter table contracts
  add column if not exists subcontractor_rut text;

-- Índice para consultas de subcontratos por contrato padre
create index if not exists idx_contracts_parent_id
  on contracts (parent_contract_id)
  where parent_contract_id is not null;

-- Índice para búsquedas de marcas
create index if not exists idx_attendance_logs_mark_type
  on attendance_logs (mark_type)
  where mark_type is not null;
