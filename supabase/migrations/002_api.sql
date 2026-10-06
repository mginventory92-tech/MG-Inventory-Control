-- public.api(method, path, query, body): single entry point mirroring the old REST routes.
create or replace function private.fail(code int, msg text) returns void language plpgsql as $$
begin raise exception '%', msg using errcode = 'P0001', hint = code::text; end $$;

create or replace function private.need(me public.profiles, variadic ps text[]) returns void language plpgsql as $$
begin
  if not (me.permissions && ps) then perform private.fail(403, 'ليس لديك صلاحية لتنفيذ هذا الإجراء'); end if;
end $$;

create or replace function private.to_uuid(t text) returns uuid language plpgsql as $$
begin return t::uuid; exception when others then perform private.fail(404, 'غير موجود'); return null; end $$;

create or replace function private.blank(t text) returns text language sql immutable as $$ select nullif(btrim(coalesce(t,'')),'') $$;

create or replace function private.next_no(k text) returns int language sql as $$
  insert into public.doc_counters(key,last) values (k,1)
  on conflict (key) do update set last = doc_counters.last + 1 returning last $$;

create or replace function private.item_json(i public.items) returns jsonb language sql stable as $$
  select jsonb_build_object('id',i.id,'code',i.code,'name',i.name,'barcode',i.barcode,'category',i.category,'unit',i.unit,
    'minQty',i.min_qty,'notes',i.notes,'isActive',i.is_active,'createdAt',i.created_at) $$;
create or replace function private.wh_json(w public.warehouses) returns jsonb language sql stable as $$
  select jsonb_build_object('id',w.id,'name',w.name,'location',w.location,'isActive',w.is_active,'createdAt',w.created_at) $$;
create or replace function private.party_json(p public.parties) returns jsonb language sql stable as $$
  select jsonb_build_object('id',p.id,'type',p.type,'name',p.name,'phone',p.phone,'notes',p.notes,'isActive',p.is_active,'createdAt',p.created_at) $$;
create or replace function private.user_json(u public.profiles) returns jsonb language sql stable as $$
  select jsonb_build_object('id',u.id,'name',u.name,'username',u.username,'permissions',to_jsonb(u.permissions),
    'isActive',u.is_active,'mustChangePassword',u.must_change_password,'createdAt',u.created_at) $$;
create or replace function private.doc_json(d public.stock_documents) returns jsonb language sql stable as $$
  select jsonb_build_object('id',d.id,'number',d.number,'type',d.type,'date',d.date,'reference',d.reference,'notes',d.notes,
    'fromWarehouseId',d.from_warehouse_id,'toWarehouseId',d.to_warehouse_id,'partyId',d.party_id,
    'fromWarehouse',(select private.wh_json(w) from public.warehouses w where w.id = d.from_warehouse_id),
    'toWarehouse',(select private.wh_json(w) from public.warehouses w where w.id = d.to_warehouse_id),
    'party',(select private.party_json(p) from public.parties p where p.id = d.party_id),
    'createdBy',(select jsonb_build_object('id',u.id,'name',u.name) from public.profiles u where u.id = d.created_by),
    'createdAt',d.created_at,
    'lines',(select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'itemId',l.item_id,'qty',l.qty,'item',private.item_json(i)) order by i.name),'[]'::jsonb)
             from public.stock_document_lines l join public.items i on i.id = l.item_id where l.document_id = d.id)) $$;

/* ---------- items ---------- */
create or replace function private.r_items(me public.profiles, m text, parts text[], q jsonb, b jsonb) returns jsonb
language plpgsql as $$
declare v public.items; t text; arr jsonb; dup public.items; v_code text; v_bar text; v_name text;
begin
  if m = 'GET' and parts[2] is null then
    t := private.blank(q->>'q');
    select coalesce(jsonb_agg(private.item_json(i) order by i.name),'[]'::jsonb) into arr from public.items i
     where ((q->>'all') = 'true' or i.is_active)
       and (t is null or i.name ilike '%'||t||'%' or i.code ilike '%'||t||'%' or i.barcode ilike '%'||t||'%' or i.category ilike '%'||t||'%');
    return arr;
  elsif m = 'GET' and parts[2] = 'lookup' then
    select * into v from public.items where barcode = parts[3] and is_active;
    if not found then select * into v from public.items where code = parts[3] and is_active; end if;
    if not found then perform private.fail(404,'لا يوجد صنف بهذا الباركود أو الكود'); end if;
    return private.item_json(v);
  elsif m = 'GET' then
    select * into v from public.items where id = private.to_uuid(parts[2]);
    if not found then perform private.fail(404,'الصنف غير موجود'); end if;
    return private.item_json(v);
  elsif m = 'POST' then
    perform private.need(me,'items');
    v_name := private.blank(b->>'name');
    if v_name is null then perform private.fail(400,'اسم الصنف مطلوب'); end if;
    if coalesce((b->>'minQty')::numeric,0) < 0 then perform private.fail(400,'الحد الأدنى لا يمكن أن يكون سالبًا'); end if;
    v_bar := private.blank(b->>'barcode');
    v_code := private.blank(b->>'code');
    if v_code is null then v_code := 'ITM-' || lpad(private.next_no('item')::text,4,'0'); end if;
    if exists (select 1 from public.items where code = v_code) then perform private.fail(409,'كود الصنف مستخدم من قبل'); end if;
    if v_bar is not null then
      select * into dup from public.items where barcode = v_bar;
      if found then perform private.fail(409,'الباركود مستخدم للصنف: '||dup.name); end if;
    end if;
    insert into public.items(code,name,barcode,category,unit,min_qty,notes,is_active)
    values (v_code,v_name,v_bar,private.blank(b->>'category'),coalesce(private.blank(b->>'unit'),'قطعة'),
            coalesce((b->>'minQty')::numeric,0),private.blank(b->>'notes'),coalesce((b->>'isActive')::boolean,true))
    returning * into v;
    return private.item_json(v);
  elsif m = 'PATCH' then
    perform private.need(me,'items');
    select * into v from public.items where id = private.to_uuid(parts[2]) for update;
    if not found then perform private.fail(404,'الصنف غير موجود'); end if;
    if b ? 'code' and private.blank(b->>'code') is not null then
      v_code := private.blank(b->>'code');
      if exists (select 1 from public.items where code = v_code and id <> v.id) then perform private.fail(409,'كود الصنف مستخدم من قبل'); end if;
      v.code := v_code;
    end if;
    if b ? 'barcode' then
      v_bar := private.blank(b->>'barcode');
      if v_bar is not null then
        select * into dup from public.items where barcode = v_bar and id <> v.id;
        if found then perform private.fail(409,'الباركود مستخدم للصنف: '||dup.name); end if;
      end if;
      v.barcode := v_bar;
    end if;
    if b ? 'name' then
      v_name := private.blank(b->>'name');
      if v_name is null then perform private.fail(400,'اسم الصنف مطلوب'); end if;
      v.name := v_name;
    end if;
    if b ? 'category' then v.category := private.blank(b->>'category'); end if;
    if b ? 'unit' then v.unit := coalesce(private.blank(b->>'unit'),'قطعة'); end if;
    if b ? 'minQty' then
      if (b->>'minQty')::numeric < 0 then perform private.fail(400,'الحد الأدنى لا يمكن أن يكون سالبًا'); end if;
      v.min_qty := (b->>'minQty')::numeric;
    end if;
    if b ? 'notes' then v.notes := private.blank(b->>'notes'); end if;
    if b ? 'isActive' then v.is_active := (b->>'isActive')::boolean; end if;
    update public.items set code=v.code,name=v.name,barcode=v.barcode,category=v.category,unit=v.unit,
      min_qty=v.min_qty,notes=v.notes,is_active=v.is_active where id = v.id;
    return private.item_json(v);
  elsif m = 'DELETE' then
    perform private.need(me,'items');
    if exists (select 1 from public.stock_document_lines where item_id = private.to_uuid(parts[2])) then
      perform private.fail(409,'الصنف له حركات مسجلة ولا يمكن حذفه، يمكنك تعطيله بدل الحذف');
    end if;
    delete from public.items where id = private.to_uuid(parts[2]);
    if not found then perform private.fail(404,'الصنف غير موجود'); end if;
    return '{"ok":true}'::jsonb;
  end if;
  perform private.fail(404,'غير موجود'); return null;
end $$;

/* ---------- warehouses ---------- */
create or replace function private.r_warehouses(me public.profiles, m text, parts text[], q jsonb, b jsonb) returns jsonb
language plpgsql as $$
declare v public.warehouses; n text; arr jsonb;
begin
  if m = 'GET' then
    select coalesce(jsonb_agg(private.wh_json(w) order by w.name),'[]'::jsonb) into arr from public.warehouses w
     where (q->>'all') = 'true' or w.is_active;
    return arr;
  elsif m = 'POST' then
    perform private.need(me,'warehouses');
    n := private.blank(b->>'name');
    if n is null then perform private.fail(400,'اسم المخزن مطلوب'); end if;
    if exists (select 1 from public.warehouses where name = n) then perform private.fail(409,'اسم المخزن موجود بالفعل'); end if;
    insert into public.warehouses(name,location,is_active) values (n,private.blank(b->>'location'),coalesce((b->>'isActive')::boolean,true)) returning * into v;
    return private.wh_json(v);
  elsif m = 'PATCH' then
    perform private.need(me,'warehouses');
    select * into v from public.warehouses where id = private.to_uuid(parts[2]) for update;
    if not found then perform private.fail(404,'المخزن غير موجود'); end if;
    if b ? 'name' then
      n := private.blank(b->>'name');
      if n is null then perform private.fail(400,'اسم المخزن مطلوب'); end if;
      if exists (select 1 from public.warehouses where name = n and id <> v.id) then perform private.fail(409,'اسم المخزن موجود بالفعل'); end if;
      v.name := n;
    end if;
    if b ? 'location' then v.location := private.blank(b->>'location'); end if;
    if b ? 'isActive' then
      if (b->>'isActive')::boolean = false and exists (select 1 from public.stock_balances where warehouse_id = v.id and qty > 0) then
        perform private.fail(400,'لا يمكن تعطيل مخزن به أرصدة، انقل الأصناف منه أولاً');
      end if;
      v.is_active := (b->>'isActive')::boolean;
    end if;
    update public.warehouses set name=v.name,location=v.location,is_active=v.is_active where id = v.id;
    return private.wh_json(v);
  elsif m = 'DELETE' then
    perform private.need(me,'warehouses');
    if exists (select 1 from public.stock_documents where from_warehouse_id = private.to_uuid(parts[2]) or to_warehouse_id = private.to_uuid(parts[2])) then
      perform private.fail(409,'المخزن له حركات مسجلة ولا يمكن حذفه، يمكنك تعطيله بدل الحذف');
    end if;
    delete from public.warehouses where id = private.to_uuid(parts[2]);
    if not found then perform private.fail(404,'المخزن غير موجود'); end if;
    return '{"ok":true}'::jsonb;
  end if;
  perform private.fail(404,'غير موجود'); return null;
end $$;

/* ---------- parties ---------- */
create or replace function private.r_parties(me public.profiles, m text, parts text[], q jsonb, b jsonb) returns jsonb
language plpgsql as $$
declare v public.parties; n text; arr jsonb; ty text;
begin
  if m = 'GET' then
    ty := q->>'type';
    select coalesce(jsonb_agg(private.party_json(p) order by p.name),'[]'::jsonb) into arr from public.parties p
     where (ty not in ('supplier','customer') or ty is null or p.type = ty) and ((q->>'all') = 'true' or p.is_active);
    return arr;
  elsif m = 'POST' then
    perform private.need(me,'parties');
    n := private.blank(b->>'name');
    if n is null then perform private.fail(400,'الاسم مطلوب'); end if;
    if coalesce(b->>'type','') not in ('supplier','customer') then perform private.fail(400,'نوع الطرف غير صحيح'); end if;
    insert into public.parties(type,name,phone,notes,is_active)
    values (b->>'type',n,private.blank(b->>'phone'),private.blank(b->>'notes'),coalesce((b->>'isActive')::boolean,true)) returning * into v;
    return private.party_json(v);
  elsif m = 'PATCH' then
    perform private.need(me,'parties');
    select * into v from public.parties where id = private.to_uuid(parts[2]) for update;
    if not found then perform private.fail(404,'غير موجود'); end if;
    if b ? 'type' then
      if b->>'type' not in ('supplier','customer') then perform private.fail(400,'نوع الطرف غير صحيح'); end if;
      v.type := b->>'type';
    end if;
    if b ? 'name' then
      n := private.blank(b->>'name');
      if n is null then perform private.fail(400,'الاسم مطلوب'); end if;
      v.name := n;
    end if;
    if b ? 'phone' then v.phone := private.blank(b->>'phone'); end if;
    if b ? 'notes' then v.notes := private.blank(b->>'notes'); end if;
    if b ? 'isActive' then v.is_active := (b->>'isActive')::boolean; end if;
    update public.parties set type=v.type,name=v.name,phone=v.phone,notes=v.notes,is_active=v.is_active where id = v.id;
    return private.party_json(v);
  elsif m = 'DELETE' then
    perform private.need(me,'parties');
    if exists (select 1 from public.stock_documents where party_id = private.to_uuid(parts[2])) then
      perform private.fail(409,'له حركات مسجلة ولا يمكن حذفه، يمكنك تعطيله بدل الحذف');
    end if;
    delete from public.parties where id = private.to_uuid(parts[2]);
    if not found then perform private.fail(404,'غير موجود'); end if;
    return '{"ok":true}'::jsonb;
  end if;
  perform private.fail(404,'غير موجود'); return null;
end $$;

/* ---------- stock table ---------- */
create or replace function private.stock_rows(p_q text, p_wid uuid) returns setof jsonb language sql stable as $$
  select jsonb_build_object('item',private.item_json(i),'perWarehouse',coalesce(p.m,'{}'::jsonb),'total',coalesce(p.total,0),
         'qty',x.qty,'low',(i.min_qty > 0 and x.qty <= i.min_qty))
  from public.items i
  left join lateral (select jsonb_object_agg(b.warehouse_id,b.qty) m, sum(b.qty) total from public.stock_balances b where b.item_id = i.id) p on true
  cross join lateral (select case when p_wid is null then coalesce(p.total,0) else coalesce((p.m->>p_wid::text)::numeric,0) end as qty) x
  where i.is_active and (p_q is null or i.name ilike '%'||p_q||'%' or i.code ilike '%'||p_q||'%' or i.barcode ilike '%'||p_q||'%' or i.category ilike '%'||p_q||'%')
  order by i.name $$;

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

/* ---------- documents ---------- */
create or replace function private.r_documents(me public.profiles, m text, parts text[], q jsonb, b jsonb) returns jsonb
language plpgsql as $$
declare
  t text; fromw uuid; tow uuid; partyid uuid; docid uuid; num text; d public.stock_documents; l record; it public.items; wh public.warehouses;
  ty text; total int; arr jsonb; lim int; off int; w uuid; s text; got numeric; avail numeric;
  ar jsonb := '{"in":"إذن إضافة","out":"إذن صرف","transfer":"تحويل"}';
  pre jsonb := '{"in":"IN","out":"OUT","transfer":"TR"}';
begin
  if m = 'GET' then
    perform private.need(me,'reports','in','out','transfer');
    if parts[2] is not null then
      select * into d from public.stock_documents where id = private.to_uuid(parts[2]);
      if not found then perform private.fail(404,'الإذن غير موجود'); end if;
      return private.doc_json(d);
    end if;
    ty := q->>'type'; w := nullif(q->>'warehouseId','')::uuid; s := private.blank(q->>'q');
    lim := least(coalesce(nullif(q->>'limit','')::int,50),200); off := coalesce(nullif(q->>'offset','')::int,0);
    select count(*) into total from public.stock_documents x left join public.parties p on p.id = x.party_id
     where (ty not in ('in','out','transfer') or ty is null or x.type = ty)
       and (nullif(q->>'from','') is null or x.date >= (q->>'from')::date)
       and (nullif(q->>'to','') is null or x.date <= (q->>'to')::date)
       and (w is null or x.from_warehouse_id = w or x.to_warehouse_id = w)
       and (s is null or x.number ilike '%'||s||'%' or x.reference ilike '%'||s||'%' or p.name ilike '%'||s||'%');
    select coalesce(jsonb_agg(private.doc_json(z) order by z.date desc, z.created_at desc),'[]'::jsonb) into arr from (
      select x.* from public.stock_documents x left join public.parties p on p.id = x.party_id
       where (ty not in ('in','out','transfer') or ty is null or x.type = ty)
         and (nullif(q->>'from','') is null or x.date >= (q->>'from')::date)
         and (nullif(q->>'to','') is null or x.date <= (q->>'to')::date)
         and (w is null or x.from_warehouse_id = w or x.to_warehouse_id = w)
         and (s is null or x.number ilike '%'||s||'%' or x.reference ilike '%'||s||'%' or p.name ilike '%'||s||'%')
       order by x.date desc, x.created_at desc limit lim offset off) z;
    return jsonb_build_object('total',total,'rows',arr);
  elsif m = 'POST' then
    t := b->>'type';
    if t is null or t not in ('in','out','transfer') then perform private.fail(400,'نوع الإذن غير صحيح'); end if;
    if not (t = any(me.permissions)) then perform private.fail(403,'ليس لديك صلاحية '||(ar->>t)); end if;
    fromw := nullif(b->>'fromWarehouseId','')::uuid; tow := nullif(b->>'toWarehouseId','')::uuid; partyid := nullif(b->>'partyId','')::uuid;
    if t = 'in' and tow is null then perform private.fail(400,'اختر المخزن المستلم'); end if;
    if t = 'out' and fromw is null then perform private.fail(400,'اختر المخزن المصروف منه'); end if;
    if t = 'transfer' then
      if fromw is null or tow is null then perform private.fail(400,'اختر المخزن المحوَّل منه وإليه'); end if;
      if fromw = tow then perform private.fail(400,'لا يمكن التحويل لنفس المخزن'); end if;
    end if;
    if t = 'in' then fromw := null; elsif t = 'out' then tow := null; end if;
    if jsonb_typeof(b->'lines') is distinct from 'array' or jsonb_array_length(b->'lines') = 0 then
      perform private.fail(400,'أضف صنف واحد على الأقل');
    end if;
    for l in select e from jsonb_array_elements(b->'lines') e loop
      if (l.e->>'qty')::numeric < 0.001 or round((l.e->>'qty')::numeric,3) <> (l.e->>'qty')::numeric then
        perform private.fail(400,'الكمية لازم تكون أكبر من صفر (حتى 3 أرقام عشرية)');
      end if;
    end loop;
    for wh in select * from public.warehouses where id in (fromw,tow) loop
      if not wh.is_active then perform private.fail(400,'المخزن غير موجود أو معطّل'); end if;
    end loop;
    if (fromw is not null and not exists (select 1 from public.warehouses where id = fromw))
       or (tow is not null and not exists (select 1 from public.warehouses where id = tow)) then
      perform private.fail(400,'المخزن غير موجود أو معطّل');
    end if;
    if partyid is not null and not exists (select 1 from public.parties where id = partyid) then perform private.fail(400,'الطرف غير موجود'); end if;

    create temp table if not exists _lines(item_id uuid, qty numeric) on commit drop;
    delete from _lines;
    insert into _lines select (e->>'itemId')::uuid, round(sum((e->>'qty')::numeric),3)
      from jsonb_array_elements(b->'lines') e group by 1;
    for l in select ln.item_id, ln.qty from _lines ln order by ln.item_id loop
      select * into it from public.items where id = l.item_id;
      if not found then perform private.fail(400,'أحد الأصناف غير موجود'); end if;
      if not it.is_active then perform private.fail(400,'الصنف "'||it.name||'" معطّل'); end if;
    end loop;

    num := (pre->>t) || '-' || lpad(private.next_no('doc_'||t)::text,5,'0');
    insert into public.stock_documents(number,type,date,from_warehouse_id,to_warehouse_id,party_id,reference,notes,created_by)
    values (num,t,coalesce(nullif(b->>'date','')::date,current_date),fromw,tow,partyid,private.blank(b->>'reference'),private.blank(b->>'notes'),me.id)
    returning id into docid;
    insert into public.stock_document_lines(document_id,item_id,qty) select docid,item_id,qty from _lines;

    for l in select ln.item_id, ln.qty from _lines ln order by ln.item_id loop
      if fromw is not null then
        update public.stock_balances set qty = qty - l.qty where item_id = l.item_id and warehouse_id = fromw and qty >= l.qty;
        if not found then
          select coalesce((select qty from public.stock_balances where item_id = l.item_id and warehouse_id = fromw),0) into avail;
          select * into it from public.items where id = l.item_id;
          perform private.fail(400,'الرصيد غير كافي للصنف "'||it.name||'": المتاح '||trim_scale(avail)||' والمطلوب '||trim_scale(l.qty));
        end if;
      end if;
      if tow is not null then
        insert into public.stock_balances(item_id,warehouse_id,qty) values (l.item_id,tow,l.qty)
        on conflict (item_id,warehouse_id) do update set qty = stock_balances.qty + excluded.qty;
      end if;
    end loop;
    select * into d from public.stock_documents where id = docid;
    return private.doc_json(d);
  end if;
  perform private.fail(404,'غير موجود'); return null;
end $$;

/* ---------- reports / dashboard / users / auth ---------- */
create or replace function private.r_reports(me public.profiles, m text, parts text[], q jsonb, b jsonb) returns jsonb
language plpgsql as $$
declare ty text := q->>'type'; it uuid := nullif(q->>'itemId','')::uuid; w uuid := nullif(q->>'warehouseId','')::uuid;
        pa uuid := nullif(q->>'partyId','')::uuid; fr date := nullif(q->>'from','')::date; tt date := nullif(q->>'to','')::date;
        lim int := least(coalesce(nullif(q->>'limit','')::int,200),1000); off int := coalesce(nullif(q->>'offset','')::int,0);
        rows jsonb; totals jsonb;
begin
  perform private.need(me,'reports');
  if parts[2] <> 'movements' then perform private.fail(404,'غير موجود'); end if;
  select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into rows from (
    select d.id as "documentId", d.number, d.type, d.date, d.reference, d.created_at as "createdAt",
           i.id as "itemId", i.code as "itemCode", i.name as "itemName", i.unit, l.qty,
           fw.name as "fromWarehouse", tw.name as "toWarehouse", pa2.name as "partyName", u.name as "userName"
    from public.stock_document_lines l
    join public.stock_documents d on d.id = l.document_id join public.items i on i.id = l.item_id
    left join public.warehouses fw on fw.id = d.from_warehouse_id left join public.warehouses tw on tw.id = d.to_warehouse_id
    left join public.parties pa2 on pa2.id = d.party_id left join public.profiles u on u.id = d.created_by
    where (it is null or l.item_id = it) and (ty not in ('in','out','transfer') or ty is null or d.type = ty)
      and (pa is null or d.party_id = pa) and (fr is null or d.date >= fr) and (tt is null or d.date <= tt)
      and (w is null or d.from_warehouse_id = w or d.to_warehouse_id = w)
    order by d.date desc, d.created_at desc, i.name limit lim offset off) t;
  select coalesce(jsonb_agg(jsonb_build_object('type',x.type,'qty',x.qty,'docs',x.docs)),'[]'::jsonb) into totals from (
    select d.type, coalesce(sum(l.qty),0) qty, count(distinct d.id) docs
    from public.stock_document_lines l join public.stock_documents d on d.id = l.document_id
    where (it is null or l.item_id = it) and (ty not in ('in','out','transfer') or ty is null or d.type = ty)
      and (pa is null or d.party_id = pa) and (fr is null or d.date >= fr) and (tt is null or d.date <= tt)
      and (w is null or d.from_warehouse_id = w or d.to_warehouse_id = w)
    group by d.type) x;
  return jsonb_build_object('rows',rows,'totals',totals);
end $$;

create or replace function private.r_dashboard(me public.profiles) returns jsonb language plpgsql as $$
declare counts jsonb; low jsonb; recent jsonb; lc int;
begin
  select jsonb_build_object(
    'items',(select count(*) from public.items where is_active),
    'warehouses',(select count(*) from public.warehouses where is_active),
    'suppliers',(select count(*) from public.parties where is_active and type='supplier'),
    'customers',(select count(*) from public.parties where is_active and type='customer'),
    'docsToday',(select count(*) from public.stock_documents where date = current_date)) into counts;
  select count(*) into lc from private.stock_rows(null,null) r where (r->>'low')::boolean;
  select coalesce(jsonb_agg(r),'[]'::jsonb) into low from (select r from private.stock_rows(null,null) r where (r->>'low')::boolean limit 10) s;
  select coalesce(jsonb_agg(to_jsonb(t) order by t."createdAt" desc),'[]'::jsonb) into recent from (
    select d.id, d.number, d.type, d.date, d.created_at as "createdAt", fw.name as "fromWarehouse", tw.name as "toWarehouse", pa.name as "partyName",
           (select count(*) from public.stock_document_lines l where l.document_id = d.id) as "lineCount"
    from public.stock_documents d left join public.warehouses fw on fw.id = d.from_warehouse_id
    left join public.warehouses tw on tw.id = d.to_warehouse_id left join public.parties pa on pa.id = d.party_id
    order by d.created_at desc limit 8) t;
  return jsonb_build_object('counts',counts,'lowCount',lc,'low',low,'recent',recent);
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
