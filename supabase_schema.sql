-- ============================================================
-- MESIN ISUZU INDONESIA — SUPPLIER DATABASE
-- Supabase SQL Schema (v2 — Complete Backend)
-- Jalankan di: Supabase Dashboard > SQL Editor
-- Urutan eksekusi: jalankan sekali dari atas ke bawah
-- ============================================================


-- ============================================================
-- 1. TABEL: public.users
--    Linked ke auth.users (UUID). Menyimpan username & role.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.users (
  id         UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username   TEXT        NOT NULL UNIQUE,
  role       TEXT        NOT NULL DEFAULT 'Viewer'
                         CHECK (role IN ('Admin', 'Editor', 'Viewer')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================
-- 2. HELPER FUNCTIONS (Security Definer — bypass RLS recursion)
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_user_role(user_id UUID)
RETURNS TEXT AS $$
DECLARE
  user_role TEXT;
BEGIN
  SELECT role INTO user_role FROM public.users WHERE id = user_id;
  RETURN user_role;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_admin(user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN public.get_user_role(user_id) = 'Admin';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_editor_or_admin(user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN public.get_user_role(user_id) IN ('Admin', 'Editor');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- 3. TABEL: public.categories
-- ============================================================
CREATE TABLE IF NOT EXISTS public.categories (
  id         SERIAL      PRIMARY KEY,
  name       TEXT        NOT NULL UNIQUE,
  bg_color   TEXT        NOT NULL DEFAULT '#f3e8ff',
  text_color TEXT        NOT NULL DEFAULT '#5b21b6',
  is_active  BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================
-- 4. TABEL: public.suppliers
--    categories & products disimpan sebagai JSONB array.
--    created_by & updated_by untuk pelacakan user audit.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.suppliers (
  id             SERIAL      PRIMARY KEY,
  company_name   TEXT        NOT NULL,
  contact_person TEXT        NOT NULL,
  phone          TEXT        NOT NULL,
  email          TEXT,
  website        TEXT,
  address        TEXT,
  location       TEXT,
  categories     JSONB       NOT NULL DEFAULT '[]',
  products       JSONB       NOT NULL DEFAULT '[]',
  status         TEXT        NOT NULL DEFAULT 'Active'
                             CHECK (status IN ('Active', 'Inactive')),
  notes          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  created_by     UUID        REFERENCES public.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  updated_by     UUID        REFERENCES public.users(id) ON DELETE SET NULL
);

-- Auto-update updated_at and updated_by on row change
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  NEW.updated_by = auth.uid();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS suppliers_updated_at ON public.suppliers;
CREATE TRIGGER suppliers_updated_at
  BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- 5. TABEL: public.supplier_logs (Audit / Change Log)
--    Merekam setiap INSERT, UPDATE, DELETE pada suppliers.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.supplier_logs (
  id          BIGSERIAL   PRIMARY KEY,
  supplier_id INT,
  action      TEXT        NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  changed_by  UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  changed_at  TIMESTAMPTZ DEFAULT NOW(),
  old_data    JSONB,
  new_data    JSONB
);

-- Trigger function: log semua perubahan pada suppliers
CREATE OR REPLACE FUNCTION public.log_supplier_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.supplier_logs (supplier_id, action, changed_by, new_data)
    VALUES (NEW.id, 'INSERT', auth.uid(), row_to_json(NEW)::JSONB);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.supplier_logs (supplier_id, action, changed_by, old_data, new_data)
    VALUES (NEW.id, 'UPDATE', auth.uid(), row_to_json(OLD)::JSONB, row_to_json(NEW)::JSONB);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.supplier_logs (supplier_id, action, changed_by, old_data)
    VALUES (OLD.id, 'DELETE', auth.uid(), row_to_json(OLD)::JSONB);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS suppliers_audit_log ON public.suppliers;
CREATE TRIGGER suppliers_audit_log
  AFTER INSERT OR UPDATE OR DELETE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.log_supplier_change();


-- ============================================================
-- 6. PERFORMANCE INDEXES
-- ============================================================

-- Suppliers: B-Tree indexes untuk kolom yang sering di-query/sort
CREATE INDEX IF NOT EXISTS idx_suppliers_company_name  ON public.suppliers (company_name);
CREATE INDEX IF NOT EXISTS idx_suppliers_status         ON public.suppliers (status);
CREATE INDEX IF NOT EXISTS idx_suppliers_created_by     ON public.suppliers (created_by);
CREATE INDEX IF NOT EXISTS idx_suppliers_updated_by     ON public.suppliers (updated_by);
CREATE INDEX IF NOT EXISTS idx_suppliers_created_at     ON public.suppliers (created_at DESC);

-- Suppliers: GIN index untuk JSONB array categories (mendukung @> operator)
CREATE INDEX IF NOT EXISTS idx_suppliers_categories_gin ON public.suppliers USING GIN (categories);
-- Suppliers: GIN index untuk JSONB array products (mendukung pencarian nama produk)
CREATE INDEX IF NOT EXISTS idx_suppliers_products_gin   ON public.suppliers USING GIN (products);

-- Suppliers: Full-text search index (company_name + contact_person + notes)
CREATE INDEX IF NOT EXISTS idx_suppliers_fts ON public.suppliers
  USING GIN (
    to_tsvector('simple',
      COALESCE(company_name, '') || ' ' ||
      COALESCE(contact_person, '') || ' ' ||
      COALESCE(email, '') || ' ' ||
      COALESCE(notes, '')
    )
  );

-- Audit log: index untuk filter by supplier_id & action
CREATE INDEX IF NOT EXISTS idx_supplier_logs_supplier_id ON public.supplier_logs (supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_logs_changed_by  ON public.supplier_logs (changed_by);
CREATE INDEX IF NOT EXISTS idx_supplier_logs_changed_at  ON public.supplier_logs (changed_at DESC);


-- ============================================================
-- 7. ROW LEVEL SECURITY (RLS)
-- ============================================================

ALTER TABLE public.users          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_logs  ENABLE ROW LEVEL SECURITY;

-- ── public.users policies ──────────────────────────────────

-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "users_select_own"      ON public.users;
DROP POLICY IF EXISTS "users_select_admin"    ON public.users;
DROP POLICY IF EXISTS "users_all_admin"       ON public.users;
DROP POLICY IF EXISTS "users_insert_own"      ON public.users;
DROP POLICY IF EXISTS "users_insert_trigger"  ON public.users;
DROP POLICY IF EXISTS "users_update_admin"    ON public.users;
DROP POLICY IF EXISTS "users_delete_admin"    ON public.users;

-- Setiap user yang login bisa baca profil sendiri
CREATE POLICY "users_select_own" ON public.users
  FOR SELECT USING (auth.uid() = id);

-- Admin bisa baca semua user
CREATE POLICY "users_select_admin" ON public.users
  FOR SELECT USING (public.is_admin(auth.uid()));

-- Semua user terautentikasi bisa baca profil user lain
-- (diperlukan untuk embedded SELECT creator/updater pada tabel suppliers)
CREATE POLICY "users_select_authenticated" ON public.users
  FOR SELECT USING (auth.role() = 'authenticated');

-- Admin bisa insert user baru (juga digunakan oleh trigger handle_new_user via SECURITY DEFINER)
CREATE POLICY "users_insert_trigger" ON public.users
  FOR INSERT WITH CHECK (public.is_admin(auth.uid()));

-- Admin bisa update role & username user lain
CREATE POLICY "users_update_admin" ON public.users
  FOR UPDATE USING (public.is_admin(auth.uid()));

-- Admin bisa delete user
CREATE POLICY "users_delete_admin" ON public.users
  FOR DELETE USING (public.is_admin(auth.uid()));


-- ── public.categories policies ─────────────────────────────

DROP POLICY IF EXISTS "categories_select_authenticated" ON public.categories;
DROP POLICY IF EXISTS "categories_write_admin"          ON public.categories;
DROP POLICY IF EXISTS "categories_update_admin"         ON public.categories;
DROP POLICY IF EXISTS "categories_delete_admin"         ON public.categories;

CREATE POLICY "categories_select_authenticated" ON public.categories
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "categories_write_admin" ON public.categories
  FOR INSERT WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "categories_update_admin" ON public.categories
  FOR UPDATE USING (public.is_admin(auth.uid()));

CREATE POLICY "categories_delete_admin" ON public.categories
  FOR DELETE USING (public.is_admin(auth.uid()));


-- ── public.suppliers policies ──────────────────────────────

DROP POLICY IF EXISTS "suppliers_select_authenticated" ON public.suppliers;
DROP POLICY IF EXISTS "suppliers_insert_editor"        ON public.suppliers;
DROP POLICY IF EXISTS "suppliers_update_editor"        ON public.suppliers;
DROP POLICY IF EXISTS "suppliers_delete_admin"         ON public.suppliers;

CREATE POLICY "suppliers_select_authenticated" ON public.suppliers
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "suppliers_insert_editor" ON public.suppliers
  FOR INSERT WITH CHECK (public.is_editor_or_admin(auth.uid()));

CREATE POLICY "suppliers_update_editor" ON public.suppliers
  FOR UPDATE USING (public.is_editor_or_admin(auth.uid()));

CREATE POLICY "suppliers_delete_admin" ON public.suppliers
  FOR DELETE USING (public.is_admin(auth.uid()));


-- ── public.supplier_logs policies ─────────────────────────

DROP POLICY IF EXISTS "logs_select_admin"  ON public.supplier_logs;
DROP POLICY IF EXISTS "logs_insert_system" ON public.supplier_logs;

-- Hanya Admin yang bisa lihat audit log
CREATE POLICY "logs_select_admin" ON public.supplier_logs
  FOR SELECT USING (public.is_admin(auth.uid()));

-- Log di-insert oleh trigger (SECURITY DEFINER), tidak perlu policy INSERT untuk user
-- Namun kita tambahkan policy agar trigger bisa insert
CREATE POLICY "logs_insert_system" ON public.supplier_logs
  FOR INSERT WITH CHECK (true);


-- ============================================================
-- 8. RPC FUNCTIONS
-- ============================================================

-- ── 8.1 get_dashboard_stats() ──────────────────────────────
-- Mengembalikan statistik dashboard dalam satu call.
CREATE OR REPLACE FUNCTION public.get_dashboard_stats()
RETURNS JSON AS $$
DECLARE
  total_suppliers   INT;
  active_suppliers  INT;
  inactive_suppliers INT;
  total_categories  INT;
  total_products    BIGINT;
BEGIN
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'Active'),
    COUNT(*) FILTER (WHERE status = 'Inactive')
  INTO total_suppliers, active_suppliers, inactive_suppliers
  FROM public.suppliers;

  SELECT COUNT(*) INTO total_categories FROM public.categories;

  SELECT COALESCE(SUM(jsonb_array_length(products)), 0)
  INTO total_products
  FROM public.suppliers;

  RETURN json_build_object(
    'total_suppliers',    total_suppliers,
    'active_suppliers',   active_suppliers,
    'inactive_suppliers', inactive_suppliers,
    'total_categories',   total_categories,
    'total_products',     total_products
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute ke authenticated users
GRANT EXECUTE ON FUNCTION public.get_dashboard_stats() TO authenticated;


-- ── 8.2 update_user_role() ─────────────────────────────────
-- Hanya Admin yang bisa memanggil ini.
-- Admin tidak bisa mengubah role dirinya sendiri.
CREATE OR REPLACE FUNCTION public.update_user_role(
  target_user_id UUID,
  new_role TEXT
)
RETURNS JSON AS $$
DECLARE
  caller_role TEXT;
BEGIN
  -- Ambil role pemanggil
  SELECT role INTO caller_role FROM public.users WHERE id = auth.uid();

  -- Validasi: hanya Admin yang boleh
  IF caller_role != 'Admin' THEN
    RETURN json_build_object('success', false, 'error', 'Only admins can change user roles.');
  END IF;

  -- Validasi: Admin tidak bisa ubah role dirinya sendiri
  IF target_user_id = auth.uid() THEN
    RETURN json_build_object('success', false, 'error', 'You cannot change your own role.');
  END IF;

  -- Validasi: nilai role harus valid
  IF new_role NOT IN ('Admin', 'Editor', 'Viewer') THEN
    RETURN json_build_object('success', false, 'error', 'Invalid role. Must be Admin, Editor, or Viewer.');
  END IF;

  -- Lakukan update
  UPDATE public.users SET role = new_role WHERE id = target_user_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'User not found.');
  END IF;

  RETURN json_build_object('success', true, 'message', 'Role updated successfully.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.update_user_role(UUID, TEXT) TO authenticated;


-- ── 8.3 search_suppliers() ─────────────────────────────────
-- Full-text search menggunakan tsvector.
-- Mengembalikan daftar suppliers yang cocok, diurutkan by relevance.
CREATE OR REPLACE FUNCTION public.search_suppliers(query TEXT)
RETURNS SETOF public.suppliers AS $$
BEGIN
  IF query IS NULL OR trim(query) = '' THEN
    RETURN QUERY SELECT * FROM public.suppliers ORDER BY company_name;
    RETURN;
  END IF;

  RETURN QUERY
    SELECT s.*
    FROM public.suppliers s
    WHERE to_tsvector('simple',
        COALESCE(s.company_name, '') || ' ' ||
        COALESCE(s.contact_person, '') || ' ' ||
        COALESCE(s.email, '') || ' ' ||
        COALESCE(s.notes, '')
      ) @@ plainto_tsquery('simple', query)
    ORDER BY
      ts_rank(
        to_tsvector('simple',
          COALESCE(s.company_name, '') || ' ' ||
          COALESCE(s.contact_person, '') || ' ' ||
          COALESCE(s.email, '') || ' ' ||
          COALESCE(s.notes, '')
        ),
        plainto_tsquery('simple', query)
      ) DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.search_suppliers(TEXT) TO authenticated;


-- ── 8.4 get_supplier_logs() ────────────────────────────────
-- Mengambil audit log untuk supplier tertentu (hanya Admin).
CREATE OR REPLACE FUNCTION public.get_supplier_logs(p_supplier_id INT)
RETURNS TABLE (
  log_id      BIGINT,
  action      TEXT,
  changed_by  UUID,
  changed_at  TIMESTAMPTZ,
  username    TEXT,
  old_data    JSONB,
  new_data    JSONB
) AS $$
BEGIN
  -- Validasi: hanya Admin
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: only admins can view audit logs.';
  END IF;

  RETURN QUERY
    SELECT
      l.id          AS log_id,
      l.action,
      l.changed_by,
      l.changed_at,
      u.username,
      l.old_data,
      l.new_data
    FROM public.supplier_logs l
    LEFT JOIN public.users u ON u.id = l.changed_by
    WHERE l.supplier_id = p_supplier_id
    ORDER BY l.changed_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_supplier_logs(INT) TO authenticated;


-- ── 8.5 get_users_with_email() ─────────────────────────────
-- Mengambil daftar user beserta email dari auth.users (hanya Admin).
-- Catatan: auth.users tidak bisa di-join langsung dari client, 
-- tapi bisa dari SECURITY DEFINER function.
CREATE OR REPLACE FUNCTION public.get_users_with_email()
RETURNS TABLE (
  id         UUID,
  username   TEXT,
  role       TEXT,
  email      TEXT,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  -- Validasi: hanya Admin
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: only admins can view user emails.';
  END IF;

  RETURN QUERY
    SELECT
      u.id,
      u.username,
      u.role,
      a.email::TEXT,
      u.created_at
    FROM public.users u
    JOIN auth.users a ON a.id = u.id
    ORDER BY u.username;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_users_with_email() TO authenticated;

-- ── 8.6 admin_delete_user() ─────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_delete_user(target_user_id UUID)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: only admins can delete users.';
  END IF;
  DELETE FROM auth.users WHERE id = target_user_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_user(UUID) TO authenticated;

-- ── 8.7 admin_create_user() ─────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_create_user(
  user_email TEXT,
  user_password TEXT,
  user_username TEXT,
  user_role TEXT
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'extensions', 'public', 'auth'
AS $$
DECLARE
  new_id UUID;
  encrypted_pw TEXT;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: only admins can create users.';
  END IF;

  -- Validasi duplikasi
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = LOWER(user_email)) THEN
    RAISE EXCEPTION 'Email already registered.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.users WHERE username = user_username) THEN
    RAISE EXCEPTION 'Username already taken.';
  END IF;

  new_id := gen_random_uuid();
  encrypted_pw := crypt(user_password, gen_salt('bf', 10));

  -- Lowercase email untuk konsistensi dengan pencarian GoTrue
  user_email := LOWER(user_email);

  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, confirmation_sent_at, email_change_confirm_status, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, is_sso_user, is_anonymous)
  VALUES (
    new_id, user_email, encrypted_pw, NOW(), NULL, 0,
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('username', user_username, 'app_role', user_role),
    NOW(), NOW(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    false, false
  );

  INSERT INTO public.users (id, username, role) VALUES (new_id, user_username, user_role)
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

  -- Buat identity record (id terpisah dari user_id)
  BEGIN
    INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    VALUES (
      gen_random_uuid(),
      user_email,
      new_id,
      jsonb_build_object('email', user_email, 'sub', new_id::TEXT),
      'email',
      NOW(),
      NOW(),
      NOW()
    )
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
  END;

  RETURN jsonb_build_object('success', true, 'user_id', new_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_user(TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ── 8.8 confirm_user_email() ─────────────────────────────
-- Confirm email untuk user yang dibuat via signUp (bypass email confirmation).
CREATE OR REPLACE FUNCTION public.confirm_user_email(target_email TEXT)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: only admins can confirm users.';
  END IF;

  UPDATE auth.users
  SET email_confirmed_at = NOW(),
      raw_app_meta_data = '{"provider":"email","providers":["email"]}'
  WHERE email = target_email AND email_confirmed_at IS NULL;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_user_email(TEXT) TO authenticated;


-- ── 8.9 get_login_email() ─────────────────────────────────
-- Return email untuk username yang diberikan.
-- Digunakan untuk username-based login.
CREATE OR REPLACE FUNCTION public.get_login_email(p_username TEXT)
RETURNS TEXT
LANGUAGE sql SECURITY DEFINER
SET search_path = 'public', 'auth'
AS $$
  SELECT au.email
  FROM auth.users au
  JOIN public.users pu ON pu.id = au.id
  WHERE LOWER(pu.username) = LOWER(p_username);
$$;

GRANT EXECUTE ON FUNCTION public.get_login_email(TEXT) TO anon, authenticated;


-- ── 8.10 check_user_duplicate() ─────────────────────────────
-- Cek apakah email atau username sudah terdaftar.
-- Dipanggil sebelum signUp untuk validasi duplikasi.
CREATE OR REPLACE FUNCTION public.check_user_duplicate(
  p_email TEXT,
  p_username TEXT
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public', 'auth'
AS $$
DECLARE
  email_exists BOOLEAN;
  username_exists BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM auth.users WHERE email = LOWER(p_email)) INTO email_exists;
  SELECT EXISTS (SELECT 1 FROM public.users WHERE username = p_username) INTO username_exists;

  RETURN jsonb_build_object('email_exists', email_exists, 'username_exists', username_exists);
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_user_duplicate(TEXT, TEXT) TO authenticated;


-- ── 8.11 ensure_user_profile() ─────────────────────────────
-- Upsert row di public.users. Dipakai saat user login tapi
-- profile-nya belum ada (misal user dibuat via Supabase dashboard).
-- User pertama otomatis jadi Admin.
CREATE OR REPLACE FUNCTION public.ensure_user_profile(
  p_user_id UUID,
  p_username TEXT,
  p_role TEXT DEFAULT 'Viewer'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  rec RECORD;
  user_count INT;
  final_role TEXT;
BEGIN
  IF auth.uid() != p_user_id AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: you can only update your own profile.';
  END IF;

  SELECT COUNT(*) INTO user_count FROM public.users;
  IF user_count = 0 THEN
    final_role := 'Admin';
  ELSE
    final_role := p_role;
  END IF;

  INSERT INTO public.users (id, username, role)
  VALUES (p_user_id, p_username, final_role)
  ON CONFLICT (id) DO UPDATE SET
    username = EXCLUDED.username,
    role = COALESCE(NULLIF(public.users.role, 'Viewer'), EXCLUDED.role)
  RETURNING id, username, role INTO rec;

  RETURN jsonb_build_object('id', rec.id, 'username', rec.username, 'role', rec.role);
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_user_profile(UUID, TEXT, TEXT) TO authenticated;


-- ============================================================
-- 9. STORAGE BUCKET & POLICIES
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public Access"        ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Upload" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Update" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Delete" ON storage.objects;

-- Siapa saja bisa melihat gambar produk (public bucket)
CREATE POLICY "Public Access" ON storage.objects
  FOR SELECT USING (bucket_id = 'product-images');

-- Hanya Admin dan Editor yang bisa upload
CREATE POLICY "Authenticated Upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'product-images'
    AND auth.role() = 'authenticated'
    AND public.is_editor_or_admin(auth.uid())
  );

-- Hanya Admin dan Editor yang bisa update
CREATE POLICY "Authenticated Update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'product-images'
    AND auth.role() = 'authenticated'
    AND public.is_editor_or_admin(auth.uid())
  ) WITH CHECK (
    bucket_id = 'product-images'
    AND auth.role() = 'authenticated'
    AND public.is_editor_or_admin(auth.uid())
  );

-- Hanya Admin dan Editor yang bisa menghapus
CREATE POLICY "Authenticated Delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'product-images'
    AND auth.role() = 'authenticated'
    AND public.is_editor_or_admin(auth.uid())
  );


-- ============================================================
-- 10. AUTOMATED USER PROFILE CREATION TRIGGER
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  new_username  TEXT;
  user_count    INT;
  assigned_role TEXT;
BEGIN
  new_username := COALESCE(
    NEW.raw_user_meta_data->>'username',
    NEW.raw_user_meta_data->>'display_name'
  );

  -- Jika tidak ada, gunakan prefix email
  IF new_username IS NULL OR new_username = '' THEN
    new_username := SPLIT_PART(NEW.email, '@', 1);
  END IF;

  -- Pastikan username unik (tambahkan angka acak jika sudah terpakai)
  WHILE EXISTS (SELECT 1 FROM public.users WHERE username = new_username) LOOP
    new_username := new_username || FLOOR(RANDOM() * 100)::TEXT;
  END LOOP;

  -- Cek jumlah user aktif. User pertama otomatis jadi Admin.
  SELECT COUNT(*) INTO user_count FROM public.users;
  IF user_count = 0 THEN
    assigned_role := 'Admin';
  ELSE
    -- Gunakan role dari metadata jika disediakan
    assigned_role := NEW.raw_user_meta_data->>'app_role';
    IF assigned_role IS NULL OR assigned_role NOT IN ('Admin', 'Editor', 'Viewer') THEN
      assigned_role := 'Viewer';
    END IF;
  END IF;

  INSERT INTO public.users (id, username, role)
  VALUES (NEW.id, new_username, assigned_role)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ============================================================
-- 11. SUPABASE REALTIME
--     Enable realtime untuk suppliers & categories
--     agar perubahan dari user lain terefleksi otomatis.
-- ============================================================
BEGIN;
  -- Tambahkan ke publication supabase_realtime jika belum ada
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'suppliers'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.suppliers;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'categories'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.categories;
    END IF;
  END $$;
COMMIT;


-- ============================================================
-- 12. SEED DATA: Categories awal
-- ============================================================
INSERT INTO public.categories (name, bg_color, text_color) VALUES
  ('Raw Materials',             '#dbeafe', '#1e40af'),
  ('Packaging',                 '#fce7f3', '#9d174d'),
  ('Electronics',               '#e0e7ff', '#3730a3'),
  ('Rental & Services',         '#d1fae5', '#065f46'),
  ('Logistics',                 '#fef3c7', '#92400e'),
  ('General Part',              '#f3e8ff', '#5b21b6'),
  ('Stationery',                '#ffedd5', '#9a3412'),
  ('Spare Part Mesin',          '#e0e7ff', '#3730a3'),
  ('Chemical & Oil',            '#fce7f3', '#9d174d'),
  ('Cutting Tool & Accecories', '#dbeafe', '#1e40af')
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- 13. MIGRASI: Tambahkan identity & app_meta_data untuk user
--     existing yang dibuat sebelum fix admin_create_user.
--     Jalankan ONCE setelah update function admin_create_user.
-- ============================================================
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT u.id, u.email
    FROM auth.users u
    WHERE u.raw_app_meta_data IS NULL
       OR u.raw_app_meta_data = '{}'::jsonb
  LOOP
    -- Update raw_app_meta_data jika kosong
    UPDATE auth.users
    SET raw_app_meta_data = '{"provider":"email","providers":["email"]}'
    WHERE id = rec.id
      AND (raw_app_meta_data IS NULL OR raw_app_meta_data = '{}'::jsonb);

    -- Hapus identity lama (jika id = email) lalu buat baru dengan id = UUID
    BEGIN
      DELETE FROM auth.identities WHERE user_id = rec.id AND id = rec.email;
    EXCEPTION WHEN OTHERS THEN
    END;

    BEGIN
      INSERT INTO auth.identities (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      VALUES (
        rec.id::TEXT, rec.id,
        jsonb_build_object('email', rec.email, 'sub', rec.id::TEXT),
        'email', NOW(), NOW(), NOW()
      )
      ON CONFLICT (provider, id) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
    END;
  END LOOP;
END;
$$;
