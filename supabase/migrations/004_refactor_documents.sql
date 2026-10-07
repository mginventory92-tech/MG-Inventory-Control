-- 004: توحيد فلتر قايمة الإذون (كان مكتوب مرتين) وإزالة الجدول المؤقت _lines والمتغيرات غير المستخدمة.
-- السلوك ما اتغيّرش. آمن يتشغّل أكتر من مرة (create or replace).

create or replace function private.docs_filtered(q jsonb) returns setof public.stock_documents
language sql stable as $$
  select x.* from public.stock_documents x left join public.parties p on p.id = x.party_id
   where (coalesce(q->>'type','') not in ('in','out','transfer') or x.type = q->>'type')
     and (nullif(q->>'from','') is null or x.date >= (q->>'from')::date)
     and (nullif(q->>'to','') is null or x.date <= (q->>'to')::date)
     and (nullif(q->>'warehouseId','') is null
          or x.from_warehouse_id = (q->>'warehouseId')::uuid or x.to_warehouse_id = (q->>'warehouseId')::uuid)
     and (private.blank(q->>'q') is null
          or x.number ilike '%'||private.blank(q->>'q')||'%'
          or x.reference ilike '%'||private.blank(q->>'q')||'%'
          or p.name ilike '%'||private.blank(q->>'q')||'%')
$$;

create or replace function private.r_documents(me public.profiles, m text, parts text[], q jsonb, b jsonb) returns jsonb
language plpgsql as $$
declare
  t text; fromw uuid; tow uuid; partyid uuid; docid uuid; num text; d public.stock_documents; l record; it public.items; wh public.warehouses;
  total int; arr jsonb; lim int; off int; avail numeric; agg jsonb;
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
    -- تحقق مبكر من القيم (قيمة غلط = 400 حتى لو مفيش إذون)
    perform nullif(q->>'warehouseId','')::uuid, nullif(q->>'from','')::date, nullif(q->>'to','')::date;
    lim := least(coalesce(nullif(q->>'limit','')::int,50),200); off := coalesce(nullif(q->>'offset','')::int,0);
    select count(*) into total from private.docs_filtered(q);
    select coalesce(jsonb_agg(private.doc_json(z) order by z.date desc, z.created_at desc),'[]'::jsonb) into arr
      from (select * from private.docs_filtered(q) order by date desc, created_at desc limit lim offset off) z;
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

    -- تجميع الأصناف المتكررة في إذن واحد (من غير جدول مؤقت)
    select jsonb_agg(jsonb_build_object('item_id', g.item_id, 'qty', g.qty)) into agg from (
      select (e->>'itemId')::uuid as item_id, round(sum((e->>'qty')::numeric),3) as qty
        from jsonb_array_elements(b->'lines') e group by 1) g;
    for l in select (e->>'item_id')::uuid as item_id, (e->>'qty')::numeric as qty from jsonb_array_elements(agg) e order by 1 loop
      select * into it from public.items where id = l.item_id;
      if not found then perform private.fail(400,'أحد الأصناف غير موجود'); end if;
      if not it.is_active then perform private.fail(400,'الصنف "'||it.name||'" معطّل'); end if;
    end loop;

    num := (pre->>t) || '-' || lpad(private.next_no('doc_'||t)::text,5,'0');
    insert into public.stock_documents(number,type,date,from_warehouse_id,to_warehouse_id,party_id,reference,notes,created_by)
    values (num,t,coalesce(nullif(b->>'date','')::date,current_date),fromw,tow,partyid,private.blank(b->>'reference'),private.blank(b->>'notes'),me.id)
    returning id into docid;
    insert into public.stock_document_lines(document_id,item_id,qty)
      select docid, (e->>'item_id')::uuid, (e->>'qty')::numeric from jsonb_array_elements(agg) e;

    for l in select (e->>'item_id')::uuid as item_id, (e->>'qty')::numeric as qty from jsonb_array_elements(agg) e order by 1 loop
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
