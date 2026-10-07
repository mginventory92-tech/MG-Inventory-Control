-- إنشاء أول مدير للنظام (يتشغّل مرة واحدة بعد 001 و002 و003 من SQL Editor في Supabase).
-- غيّر CHANGE_ME_PASSWORD لكلمة مرور قوية قبل التشغيل، ومتحفظش الملف بعد ما تكتب فيه الباسورد الحقيقي.
-- المدير هيتطلب منه تغيير الباسورد عند أول دخول.
do $$
declare uid uuid := gen_random_uuid(); em text := 'admin@mginv.example.com';
begin
  if exists (select 1 from public.profiles where username = 'admin') then return; end if;
  insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token)
  values ('00000000-0000-0000-0000-000000000000',uid,'authenticated','authenticated',em,extensions.crypt('CHANGE_ME_PASSWORD',extensions.gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','');
  insert into auth.identities (id,user_id,provider_id,identity_data,provider,last_sign_in_at,created_at,updated_at)
  values (gen_random_uuid(),uid,uid::text,jsonb_build_object('sub',uid::text,'email',em,'email_verified',true),'email',now(),now(),now());
  insert into public.profiles (id,name,username,permissions,must_change_password)
  values (uid,'المدير','admin',array['items','warehouses','in','out','transfer','parties','reports','stocktake','users'],true);
  insert into public.warehouses (name) values ('المخزن الرئيسي') on conflict (name) do nothing;
end $$;
