-- ============================================================
-- MIGRATION: Username-based Login + Fix Admin Login
-- Jalankan seluruh file ini di Supabase SQL Editor.
-- Semua pakai CREATE OR REPLACE — aman dijalankan ulang.
-- ============================================================

-- 1. admin_create_user: tambah validasi duplikasi + rename role→app_role
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
    NOW(), NOW(), COALESCE((SELECT id FROM auth.instances LIMIT 1), '00000000-0000-0000-0000-000000000000'::uuid), 'authenticated', 'authenticated',
    false, false
  );

  INSERT INTO public.users (id, username, role) VALUES (new_id, user_username, user_role)
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

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

  RETURN jsonb_build_object('success', true, 'user_id', new_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_user(TEXT, TEXT, TEXT, TEXT) TO authenticated;


-- 2. get_login_email: lookup email dari username (untuk login)
--    Case-insensitive + search_path untuk akses auth.users
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


-- 3. check_user_duplicate: cek duplikasi email & username sebelum signUp
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


-- 4. ensure_user_profile: auto-create row di public.users saat user login
--    (misal user dibuat via Supabase dashboard sehingga belum punya profile)
--    User pertama otomatis jadi Admin.
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


-- 5. handle_new_user trigger: baca 'app_role' dari metadata (bukan 'role')
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

  IF new_username IS NULL OR new_username = '' THEN
    new_username := SPLIT_PART(NEW.email, '@', 1);
  END IF;

  WHILE EXISTS (SELECT 1 FROM public.users WHERE username = new_username) LOOP
    new_username := new_username || FLOOR(RANDOM() * 100)::TEXT;
  END LOOP;

  SELECT COUNT(*) INTO user_count FROM public.users;
  IF user_count = 0 THEN
    assigned_role := 'Admin';
  ELSE
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
