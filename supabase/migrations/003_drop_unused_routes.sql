-- 003: حذف مساري API غير مستخدمين (stock/low و users/permissions).
-- مطبّقة على Supabase باسم cleanup_r_stock_drop_low و cleanup_api_drop_permissions_route.
-- قاعدة: ملفات الـ migrations ما بتتعدّلش بعد تطبيقها، أي تغيير جديد = ملف جديد برقم أعلى.

create or replace function private.r_stock(me public.profiles, m text, parts text[], q jsonb, b jsonb) returns jsonb
language plpgsql as $$
declare w uuid; rows jsonb; whs jsonb;
begin
  if m <> 'GET' then perform private.fail(404,'غير موجود'); end if;
  if parts[2] = 'balances' then
    w := nullif(q->>'warehouseId','')::uuid;
    select coalesce(jsonb_agg(r),'[]'::jsonb) into rows from private.stock_rows(private.blank(q->>'q'), w) r
     where (w is null or (r->'perWarehouse') ? w::text or (r->>'qty')::numeric <> 0 or (r->>'low')::boolean)
       and ((q->>'lowOnly') is distinct from 'true' or (r->>'low')::boolean);
    select coalesce(jsonb_agg(private.wh_json(x) order by x.name),'[]'::jsonb) into whs from public.warehouses x where x.is_active;
    return jsonb_build_object('warehouses',whs,'rows',rows);
  elsif parts[2] = 'available' then
    if private.blank(q->>'warehouseId') is null then perform private.fail(400,'warehouseId مطلوب'); end if;
    select coalesce(jsonb_object_agg(item_id,qty),'{}'::jsonb) into rows from public.stock_balances where warehouse_id = (q->>'warehouseId')::uuid;
    return rows;
  end if;
  perform private.fail(404,'غير موجود'); return null;
end $$;

create or replace function public.api(p_method text, p_path text, p_query jsonb default '{}'::jsonb, p_body jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, private, pg_temp as $$
declare me public.profiles; parts text[]; r text; q jsonb := coalesce(p_query,'{}'::jsonb); b jsonb := coalesce(p_body,'{}'::jsonb); arr jsonb;
begin
  select * into me from public.profiles where id = auth.uid() and is_active;
  if not found then perform private.fail(401,'يجب تسجيل الدخول'); end if;
  parts := string_to_array(trim(both '/' from split_part(p_path,'?',1)),'/');
  r := parts[1];
  if r = 'auth' then
    if parts[2] = 'me' then return private.user_json(me);
    elsif parts[2] = 'password-changed' then
      update public.profiles set must_change_password = false where id = me.id;
      return '{"ok":true}'::jsonb;
    end if;
  elsif r = 'items' then return private.r_items(me,p_method,parts,q,b);
  elsif r = 'warehouses' then return private.r_warehouses(me,p_method,parts,q,b);
  elsif r = 'parties' then return private.r_parties(me,p_method,parts,q,b);
  elsif r = 'stock' then return private.r_stock(me,p_method,parts,q,b);
  elsif r = 'documents' then return private.r_documents(me,p_method,parts,q,b);
  elsif r = 'reports' then return private.r_reports(me,p_method,parts,q,b);
  elsif r = 'dashboard' then return private.r_dashboard(me);
  elsif r = 'users' and p_method = 'GET' then
    perform private.need(me,'users');
    select coalesce(jsonb_agg(private.user_json(u) order by u.created_at),'[]'::jsonb) into arr from public.profiles u;
    return arr;
  end if;
  perform private.fail(404,'غير موجود'); return null;
exception
  when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then
    perform private.fail(400,'بيانات غير صالحة');
    return null;
  when unique_violation then
    perform private.fail(409,'القيمة مستخدمة من قبل');
    return null;
end $$;

revoke all on function public.api(text,text,jsonb,jsonb) from public, anon;
grant execute on function public.api(text,text,jsonb,jsonb) to authenticated;
