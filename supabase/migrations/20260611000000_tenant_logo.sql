-- Add logo_url to tenants table
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- Create public bucket for tenant logos
INSERT INTO storage.buckets (id, name, public)
VALUES ('tenant-logos', 'tenant-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Authenticated users can upload/update/delete in their own folder
CREATE POLICY "tenant_logos_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'tenant-logos');

CREATE POLICY "tenant_logos_update"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'tenant-logos');

CREATE POLICY "tenant_logos_delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'tenant-logos');

-- Public read for logos
CREATE POLICY "tenant_logos_select"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'tenant-logos');
