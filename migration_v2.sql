-- ============================================================
-- MIGRATION: 2 Contacts + Last Transaction Date
-- Jalankan SELURUH file ini di Supabase SQL Editor (1x).
-- ============================================================

-- 1. Tambah kolom baru
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS contact_person_2 TEXT;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS phone_2 TEXT;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS email_2 TEXT;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS last_transaction_date DATE;

-- 2. Hapus constraint & kolom status
ALTER TABLE public.suppliers DROP CONSTRAINT IF EXISTS suppliers_status_check;
ALTER TABLE public.suppliers DROP COLUMN IF EXISTS status;

-- 3. Index baru
DROP INDEX IF EXISTS idx_suppliers_status;
CREATE INDEX IF NOT EXISTS idx_suppliers_last_txn_date ON public.suppliers (last_transaction_date DESC);

-- 4. Update FTS index (tambah contact_person_2 & email_2)
DROP INDEX IF EXISTS idx_suppliers_fts;
CREATE INDEX IF NOT EXISTS idx_suppliers_fts ON public.suppliers USING GIN (
  to_tsvector('simple',
    COALESCE(company_name, '') || ' ' ||
    COALESCE(contact_person, '') || ' ' ||
    COALESCE(contact_person_2, '') || ' ' ||
    COALESCE(email, '') || ' ' ||
    COALESCE(email_2, '') || ' ' ||
    COALESCE(notes, '')
  )
);

-- 5. Update search_suppliers function
CREATE OR REPLACE FUNCTION public.search_suppliers(query TEXT)
RETURNS SETOF public.suppliers AS $$
BEGIN
  IF query IS NULL OR trim(query) = '' THEN
    RETURN QUERY SELECT * FROM public.suppliers ORDER BY company_name;
    RETURN;
  END IF;
  RETURN QUERY
    SELECT s.*
    FROM public.suppliers s,
         to_tsquery('simple', regexp_replace(trim(query), '\s+', ' & ', 'g')) q
    WHERE to_tsvector('simple',
      COALESCE(s.company_name, '') || ' ' ||
      COALESCE(s.contact_person, '') || ' ' ||
      COALESCE(s.contact_person_2, '') || ' ' ||
      COALESCE(s.email, '') || ' ' ||
      COALESCE(s.email_2, '') || ' ' ||
      COALESCE(s.notes, '')
    ) @@ q
    ORDER BY ts_rank(to_tsvector('simple',
      COALESCE(s.company_name, '') || ' ' ||
      COALESCE(s.contact_person, '') || ' ' ||
      COALESCE(s.contact_person_2, '') || ' ' ||
      COALESCE(s.email, '') || ' ' ||
      COALESCE(s.email_2, '') || ' ' ||
      COALESCE(s.notes, '')
    ), q) DESC;
END;
$$ LANGUAGE plpgsql;

-- 6. Update get_dashboard_stats (active/inactive -> this_year)
CREATE OR REPLACE FUNCTION public.get_dashboard_stats()
RETURNS JSON AS $$
DECLARE
  total_suppliers   INT;
  this_year         INT;
  total_categories  INT;
  total_products    BIGINT;
BEGIN
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE EXTRACT(YEAR FROM last_transaction_date) = EXTRACT(YEAR FROM NOW()))
  INTO total_suppliers, this_year
  FROM public.suppliers;

  SELECT COUNT(*) INTO total_categories FROM public.categories;

  SELECT COALESCE(SUM(jsonb_array_length(products)), 0)
  INTO total_products FROM public.suppliers;

  RETURN json_build_object(
    'total_suppliers', total_suppliers,
    'this_year',       this_year,
    'total_categories', total_categories,
    'total_products',   total_products
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_dashboard_stats() TO authenticated;
