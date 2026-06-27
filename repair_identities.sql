-- ============================================================
-- REPAIR: Fix missing identities for existing Editor/Viewer users
-- Jalankan di Supabase Dashboard > SQL Editor
-- ============================================================

-- 1. Buat identity yang hilang untuk user existing
DO $$
DECLARE
    user_rec RECORD;
    count_fixed INT := 0;
BEGIN
    RAISE NOTICE '=== Checking for users without identities ===';

    FOR user_rec IN
        SELECT au.id, au.email
        FROM auth.users au
        JOIN public.users pu ON pu.id = au.id
        LEFT JOIN auth.identities ai ON ai.user_id = au.id AND ai.provider = 'email'
        WHERE ai.id IS NULL
    LOOP
        RAISE NOTICE 'Fixing identity for: % (%)', user_rec.email, user_rec.id;

        INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
        VALUES (
            gen_random_uuid(),
            user_rec.email,
            user_rec.id,
            jsonb_build_object('email', user_rec.email, 'sub', user_rec.id::text),
            'email',
            NOW(),
            NOW(),
            NOW()
        );

        count_fixed := count_fixed + 1;
    END LOOP;

    RAISE NOTICE '=== Done. Fixed % user(s). ===', count_fixed;
END;
$$;


-- 2. Update admin_create_user RPC (fix untuk user baru ke depannya)
--    Perubahan: gunakan instance_id asli + hilangkan silent exception handler
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

  IF EXISTS (SELECT 1 FROM auth.users WHERE email = LOWER(user_email)) THEN
    RAISE EXCEPTION 'Email already registered.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.users WHERE username = user_username) THEN
    RAISE EXCEPTION 'Username already taken.';
  END IF;

  new_id := gen_random_uuid();
  encrypted_pw := crypt(user_password, gen_salt('bf', 10));
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


-- ============================================================
-- 3. DIAGNOSTIC: Cek user Editor/Viewer yg sudah ada
--    Jalankan & paste hasilnya
-- ============================================================
SELECT pu.username, pu.role, 
  ai.id IS NOT NULL as has_identity,
  ai.identity_data,
  au.instance_id,
  LEFT(au.encrypted_password, 20) as pw_hash_prefix
FROM public.users pu
JOIN auth.users au ON au.id = pu.id
LEFT JOIN auth.identities ai ON ai.user_id = au.id AND ai.provider = 'email'
WHERE pu.role IN ('Editor', 'Viewer');


-- ============================================================
-- 4. FIX: Perbaiki instance_id yang salah
--    Jalankan setelah lihat hasil diagnostic di atas
-- ============================================================
UPDATE auth.users
SET instance_id = '00000000-0000-0000-0000-000000000000';


-- ============================================================
-- 5. CHECK: Jalankan satu per satu, paste hasilnya
-- ============================================================
-- Query A: project instance ID
SELECT id FROM auth.instances LIMIT 1;

-- Query B: admin user
SELECT email, instance_id, email_confirmed_at FROM auth.users WHERE email LIKE '%admin%' LIMIT 1;

-- Query C: editor user  
SELECT email, instance_id, email_confirmed_at FROM auth.users WHERE email LIKE '%editor%' LIMIT 1;

-- Query D: viewer user
SELECT email, instance_id, email_confirmed_at FROM auth.users WHERE email LIKE '%viewer%' LIMIT 1;


-- ============================================================
-- 6. COMPARE: Bandingkan auth.users admin vs editor
--    Jalankan dua query ini satu per satu
-- ============================================================
SELECT email, confirmation_sent_at, email_change_confirm_status,
  raw_app_meta_data, raw_user_meta_data, aud, role, is_sso_user, is_anonymous
FROM auth.users WHERE email LIKE '%admin%' LIMIT 1;

SELECT email, confirmation_sent_at, email_change_confirm_status,
  raw_app_meta_data, raw_user_meta_data, aud, role, is_sso_user, is_anonymous
FROM auth.users WHERE email LIKE '%editor%' LIMIT 1;


-- ============================================================
-- 7. CHECK PASSWORD: Bandingkan panjang hash admin vs editor
-- ============================================================
SELECT email, length(encrypted_password) as pw_len
FROM auth.users
WHERE email LIKE '%admin%' OR email LIKE '%editor%';
