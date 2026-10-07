-- 006: الأسعار والتكلفة.
-- سعر الوحدة بيتسجّل على سطر إذن الإضافة (اختياري). متوسط التكلفة المرجّح لكل صنف في items.avg_cost.
-- إذن الصرف بيحفظ التكلفة وقت الصرف، وقيمة المخزون = الرصيد × متوسط التكلفة الحالي.
alter table public.items add column avg_cost numeric(14,4) not null default 0 check (avg_cost >= 0);
alter table public.stock_document_lines add column unit_price numeric(14,4) check (unit_price is null or unit_price >= 0);

create or replace function private.item_json(i public.items) returns jsonb language sql stable as $$
  select jsonb_build_object('id',i.id,'code',i.code,'name',i.name,'barcode',i.barcode,'category',i.category,'unit',i.unit,
    'minQty',i.min_qty,'notes',i.notes,'isActive',i.is_active,'createdAt',i.created_at,'avgCost',i.avg_cost) $$;

create or replace function private.doc_json(d public.stock_documents) returns jsonb language sql stable as $$
  select jsonb_build_object('id',d.id,'number',d.number,'type',d.type,'date',d.date,'reference',d.reference,'notes',d.notes,
    'fromWarehouseId',d.from_warehouse_id,'toWarehouseId',d.to_warehouse_id,'partyId',d.party_id,
    'projectId',d.project_id,'recipient',d.recipient,'issueReason',d.issue_reason,
    'fromWarehouse',(select private.wh_json(w) from public.warehouses w where w.id = d.from_warehouse_id),
    'toWarehouse',(select private.wh_json(w) from public.warehouses w where w.id = d.to_warehouse_id),
    'party',(select private.party_json(p) from public.parties p where p.id = d.party_id),
    'project',(select private.project_json(p) from public.projects p where p.id = d.project_id),
    'createdBy',(select jsonb_build_object('id',u.id,'name',u.name) from public.profiles u where u.id = d.created_by),
    'createdAt',d.created_at,
    'lines',(select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'itemId',l.item_id,'qty',l.qty,'unitPrice',l.unit_price,'value',case when l.unit_price is null then null else round(l.qty*l.unit_price,2) end,'item',private.item_json(i)) order by i.name),'[]'::jsonb)
             from public.stock_document_lines l join public.items i on i.id = l.item_id where l.document_id = d.id)) $$;

create or replace function private.r_documents(me public.profiles, m text, parts text[], q jsonb, b jsonb) returns jsonb
language plpgsql as $$
declare
  t text; fromw uuid; tow uuid; partyid uuid; projid uuid; docid uuid; num text; d public.stock_documents; l record; it public.items; wh public.warehouses;
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
    projid := case when t = 'out' then nullif(b->>'projectId','')::uuid end;
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
    for l in select e from jsonb_array_elements(b->'lines') e loop
      if nullif(l.e->>'unitPrice','') is not null and (t <> 'in' or (l.e->>'unitPrice')::numeric < 0 or round((l.e->>'unitPrice')::numeric,4) <> (l.e->>'unitPrice')::numeric) then
        perform private.fail(400,'سعر الوحدة لازم يكون صفر أو أكتر، وبيتسجل في إذن الإضافة بس');
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
    if projid is not null and not exists (select 1 from public.projects where id = projid and is_active) then
      perform private.fail(400,'المشروع غير موجود أو معطّل');
    end if;

    select jsonb_agg(jsonb_build_object('item_id', g.item_id, 'qty', g.qty, 'price', g.price)) into agg from (
      select (e->>'itemId')::uuid as item_id, round(sum((e->>'qty')::numeric),3) as qty,
             case when t = 'in' and bool_or(nullif(e->>'unitPrice','') is not null)
                  then round(sum((e->>'qty')::numeric * nullif(e->>'unitPrice','')::numeric)
                             / sum((e->>'qty')::numeric) filter (where nullif(e->>'unitPrice','') is not null),4) end as price
        from jsonb_array_elements(b->'lines') e group by 1) g;
    for l in select (e->>'item_id')::uuid as item_id, (e->>'qty')::numeric as qty from jsonb_array_elements(agg) e order by 1 loop
      select * into it from public.items where id = l.item_id;
      if not found then perform private.fail(400,'أحد الأصناف غير موجود'); end if;
      if not it.is_active then perform private.fail(400,'الصنف "'||it.name||'" معطّل'); end if;
    end loop;

    num := (pre->>t) || '-' || lpad(private.next_no('doc_'||t)::text,5,'0');
    insert into public.stock_documents(number,type,date,from_warehouse_id,to_warehouse_id,party_id,project_id,recipient,issue_reason,reference,notes,created_by)
    values (num,t,coalesce(nullif(b->>'date','')::date,current_date),fromw,tow,partyid,projid,
            case when t = 'out' then private.blank(b->>'recipient') end, case when t = 'out' then private.blank(b->>'issueReason') end,
            private.blank(b->>'reference'),private.blank(b->>'notes'),me.id)
    returning id into docid;
    -- متوسط التكلفة المرجّح: بيتحسب قبل ما الرصيد يتحدّث، والصنف بيتقفل لحد آخر الإذن
    for l in select (e->>'item_id')::uuid as item_id, (e->>'qty')::numeric as qty, nullif(e->>'price','')::numeric as price
               from jsonb_array_elements(agg) e order by 1 loop
      select * into it from public.items where id = l.item_id for update;
      if t = 'in' then
        if l.price is not null then
          select coalesce(sum(qty),0) into avail from public.stock_balances where item_id = l.item_id and qty > 0;
          update public.items set avg_cost = round((avail * it.avg_cost + l.qty * l.price) / (avail + l.qty), 4) where id = l.item_id;
        end if;
        insert into public.stock_document_lines(document_id,item_id,qty,unit_price) values (docid,l.item_id,l.qty,l.price);
      elsif t = 'out' then
        insert into public.stock_document_lines(document_id,item_id,qty,unit_price) values (docid,l.item_id,l.qty,it.avg_cost);
      else
        insert into public.stock_document_lines(document_id,item_id,qty) values (docid,l.item_id,l.qty);
      end if;
    end loop;

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

/* ---------- التقارير ---------- */
-- كل تقرير بيرجّع { rows, total, summary }. لا بنجمع كميات وحدات مختلفة: الإجماليات دايمًا byUnit.
create or replace function private.r_reports(me public.profiles, m text, parts text[], q jsonb, b jsonb) returns jsonb
language plpgsql as $$
declare
  rep text := parts[2];
  fr date := nullif(q->>'from','')::date;  tt date := nullif(q->>'to','')::date;
  frx date := coalesce(nullif(q->>'from','')::date,'-infinity'); ttx date := coalesce(nullif(q->>'to','')::date,'infinity');
  w uuid := nullif(q->>'warehouseId','')::uuid; wf uuid := nullif(q->>'fromWarehouseId','')::uuid; wt uuid := nullif(q->>'toWarehouseId','')::uuid;
  it uuid := nullif(q->>'itemId','')::uuid; pj uuid := nullif(q->>'projectId','')::uuid; pa uuid := nullif(q->>'partyId','')::uuid;
  uid uuid := nullif(q->>'userId','')::uuid;
  cat text := private.blank(q->>'category'); un text := private.blank(q->>'unit'); st text := private.blank(q->>'status');
  rcp text := private.blank(q->>'recipient'); txt text := private.blank(q->>'q'); kd text := private.blank(q->>'kind');
  lim int := least(coalesce(nullif(q->>'limit','')::int,2000),5000);
  res jsonb; itm public.items;
begin
  perform private.need(me,'reports');
  if m <> 'GET' then perform private.fail(404,'غير موجود'); end if;

  if rep = 'meta' then
    return jsonb_build_object(
      'warehouses',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name) order by x.name),'[]') from public.warehouses x),
      'categories',(select coalesce(jsonb_agg(c order by c),'[]') from (select distinct category c from public.items where category is not null) x),
      'units',(select coalesce(jsonb_agg(c order by c),'[]') from (select distinct unit c from public.items) x),
      'projects',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'code',x.code) order by x.name),'[]') from public.projects x),
      'suppliers',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name) order by x.name),'[]') from public.parties x where x.type = 'supplier'),
      'users',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name) order by x.name),'[]') from public.profiles x));

  elsif rep = 'balances' then
    with l as (select * from private.ledger()),
    a as (
      select l.item_id, l.warehouse_id,
        coalesce(sum(delta) filter (where l.date < frx),0) as opening,
        coalesce(sum(delta) filter (where l.kind = 'in' and l.date between frx and ttx),0) as in_q,
        coalesce(-sum(delta) filter (where l.kind = 'out' and l.date between frx and ttx),0) as out_q,
        coalesce(sum(delta) filter (where l.kind = 'transfer_in' and l.date between frx and ttx),0) as t_in,
        coalesce(-sum(delta) filter (where l.kind = 'transfer_out' and l.date between frx and ttx),0) as t_out,
        coalesce(sum(delta) filter (where l.kind = 'adjust' and l.date between frx and ttx),0) as adj,
        coalesce(sum(delta) filter (where l.date <= ttx),0) as closing
      from l group by 1,2),
    r as (
      select i.id as item_id, i.code, i.name as iname, i.category, i.unit, i.min_qty, i.avg_cost, wh.id as wid, wh.name as wname,
             a.opening, a.in_q, a.out_q, a.t_in, a.t_out, a.adj, a.closing,
             case when a.closing <= 0 then 'out' when i.min_qty > 0 and a.closing <= i.min_qty then 'low' else 'ok' end as status
        from a join public.items i on i.id = a.item_id join public.warehouses wh on wh.id = a.warehouse_id
       where (a.opening <> 0 or a.in_q <> 0 or a.out_q <> 0 or a.t_in <> 0 or a.t_out <> 0 or a.adj <> 0 or a.closing <> 0)
         and (w is null or a.warehouse_id = w) and (it is null or i.id = it) and (cat is null or i.category = cat) and (un is null or i.unit = un)
         and (txt is null or i.name ilike '%'||txt||'%' or i.code ilike '%'||txt||'%'))
    select jsonb_build_object(
      'rows',(select coalesce(jsonb_agg(jsonb_build_object('itemId',x.item_id,'code',x.code,'name',x.iname,'category',x.category,'unit',x.unit,
          'warehouseId',x.wid,'warehouse',x.wname,'opening',x.opening,'inQty',x.in_q,'outQty',x.out_q,'transferIn',x.t_in,'transferOut',x.t_out,
          'adjust',x.adj,'closing',x.closing,'minQty',x.min_qty,'status',x.status,'unitCost',x.avg_cost,'value',round(x.closing*x.avg_cost,2)) order by x.iname, x.wname),'[]')
        from (select * from r where st is null or status = st order by iname, wname limit lim) x),
      'total',(select count(*) from r where st is null or status = st),
      'summary',jsonb_build_object(
        'items',(select count(distinct item_id) from r where st is null or status = st),
        'value',(select coalesce(round(sum(closing*avg_cost),2),0) from r where st is null or status = st),
        'low',(select count(*) from r where status = 'low' and (st is null or st = 'low')),
        'out',(select count(*) from r where status = 'out' and (st is null or st = 'out')),
        'byUnit',(select coalesce(jsonb_agg(jsonb_build_object('unit',u.unit,'qty',u.s) order by u.unit),'[]')
                    from (select unit, sum(closing) s from r where st is null or status = st group by unit) u))) into res;
    return res;

  elsif rep = 'item-ledger' then
    if it is null then perform private.fail(400,'اختر الصنف'); end if;
    select * into itm from public.items where id = it;
    if not found then perform private.fail(404,'الصنف غير موجود'); end if;
    with l as (select x.* from private.ledger() x where x.item_id = it and (w is null or x.warehouse_id = w)),
    run as (select l.*, sum(l.delta) over (order by l.date, l.created_at, l.ord, l.number rows between unbounded preceding and current row) as bal from l),
    r as (
      select run.*, wh.name as wname, ow.name as owname, pj2.name as pname, pa2.name as paname, u.name as uname
        from run join public.warehouses wh on wh.id = run.warehouse_id
        left join public.warehouses ow on ow.id = run.other_wh left join public.projects pj2 on pj2.id = run.project_id
        left join public.parties pa2 on pa2.id = run.party_id left join public.profiles u on u.id = run.user_id
       where run.date between frx and ttx
         and (kd is null or run.kind = kd or (kd = 'transfer' and run.kind in ('transfer_in','transfer_out')))
         and (pj is null or run.project_id = pj) and (uid is null or run.user_id = uid))
    select jsonb_build_object(
      'item',private.item_json(itm),
      'opening',(select coalesce(sum(delta),0) from l where l.date < frx),
      'closing',(select coalesce(sum(delta),0) from l where l.date <= ttx),
      'rows',(select coalesce(jsonb_agg(jsonb_build_object('date',x.date,'createdAt',x.created_at,'docId',x.doc_id,'number',x.number,'kind',x.kind,
          'source',x.source,'warehouse',x.wname,'otherWarehouse',x.owname,
          'inQty',case when x.delta > 0 then x.delta end,'outQty',case when x.delta < 0 then -x.delta end,'balance',x.bal,
          'project',x.pname,'party',x.paname,'user',x.uname,'reference',x.reference,'notes',x.notes)
          order by x.date, x.created_at, x.ord, x.number),'[]') from (select * from r order by date, created_at, ord, number limit lim) x),
      'total',(select count(*) from r),
      'summary',jsonb_build_object('in',(select coalesce(sum(delta) filter (where delta > 0),0) from r),
                                   'out',(select coalesce(-sum(delta) filter (where delta < 0),0) from r))) into res;
    return res;

  elsif rep in ('issues','receipts') then
    with r as (
      select d.id as doc_id, d.number, d.date, d.created_at, wh.name as wname, i.id as item_id, i.code, i.name as iname, i.category, i.unit, l.qty, l.unit_price,
             d.recipient, pa2.name as paname, pj2.name as pname, d.project_id, d.issue_reason, u.name as uname, d.reference, d.notes
        from public.stock_documents d
        join public.stock_document_lines l on l.document_id = d.id join public.items i on i.id = l.item_id
        join public.warehouses wh on wh.id = case when rep = 'issues' then d.from_warehouse_id else d.to_warehouse_id end
        left join public.parties pa2 on pa2.id = d.party_id left join public.projects pj2 on pj2.id = d.project_id
        left join public.profiles u on u.id = d.created_by
       where d.type = case when rep = 'issues' then 'out' else 'in' end
         and d.date between frx and ttx and (w is null or wh.id = w) and (pj is null or d.project_id = pj) and (pa is null or d.party_id = pa)
         and (it is null or i.id = it) and (cat is null or i.category = cat) and (uid is null or d.created_by = uid)
         and (rcp is null or d.recipient ilike '%'||rcp||'%')
         and (txt is null or d.number ilike '%'||txt||'%' or d.reference ilike '%'||txt||'%' or i.name ilike '%'||txt||'%'))
    select jsonb_build_object(
      'rows',(select coalesce(jsonb_agg(jsonb_build_object('docId',x.doc_id,'number',x.number,'date',x.date,'createdAt',x.created_at,'warehouse',x.wname,
          'itemId',x.item_id,'code',x.code,'name',x.iname,'category',x.category,'unit',x.unit,'qty',x.qty,'unitPrice',x.unit_price,'value',case when x.unit_price is null then null else round(x.qty*x.unit_price,2) end,'recipient',x.recipient,'party',x.paname,
          'project',x.pname,'projectId',x.project_id,'reason',x.issue_reason,'user',x.uname,'reference',x.reference,'notes',x.notes)
          order by x.date desc, x.created_at desc, x.iname),'[]')
        from (select * from r order by date desc, created_at desc, iname limit lim) x),
      'total',(select count(*) from r),
      'summary',jsonb_build_object('docs',(select count(distinct doc_id) from r),'items',(select count(distinct item_id) from r),
        'value',(select coalesce(round(sum(qty*unit_price),2),0) from r),
        'byUnit',(select coalesce(jsonb_agg(jsonb_build_object('unit',u.unit,'qty',u.s) order by u.unit),'[]')
                    from (select unit, sum(qty) s from r group by unit) u))) into res;
    return res;

  elsif rep = 'transfers' then
    with r as (
      select d.id as doc_id, d.number, d.date, d.created_at, fw.name as fname, tw.name as tname, i.id as item_id, i.code, i.name as iname, i.category,
             i.unit, l.qty, u.name as uname, d.notes, d.reference
        from public.stock_documents d
        join public.stock_document_lines l on l.document_id = d.id join public.items i on i.id = l.item_id
        join public.warehouses fw on fw.id = d.from_warehouse_id join public.warehouses tw on tw.id = d.to_warehouse_id
        left join public.profiles u on u.id = d.created_by
       where d.type = 'transfer' and d.date between frx and ttx
         and (wf is null or d.from_warehouse_id = wf) and (wt is null or d.to_warehouse_id = wt) and (w is null or d.from_warehouse_id = w or d.to_warehouse_id = w)
         and (it is null or i.id = it) and (cat is null or i.category = cat) and (uid is null or d.created_by = uid)
         and (txt is null or d.number ilike '%'||txt||'%' or i.name ilike '%'||txt||'%'))
    select jsonb_build_object(
      'rows',(select coalesce(jsonb_agg(jsonb_build_object('docId',x.doc_id,'number',x.number,'date',x.date,'createdAt',x.created_at,'fromWarehouse',x.fname,
          'toWarehouse',x.tname,'itemId',x.item_id,'code',x.code,'name',x.iname,'category',x.category,'unit',x.unit,'qty',x.qty,'user',x.uname,
          'status','received','receivedDate',x.date,'notes',x.notes)
          order by x.date desc, x.created_at desc, x.iname),'[]')
        from (select * from r order by date desc, created_at desc, iname limit lim) x),
      'total',(select count(*) from r),
      'summary',jsonb_build_object('docs',(select count(distinct doc_id) from r),'items',(select count(distinct item_id) from r),
        'byUnit',(select coalesce(jsonb_agg(jsonb_build_object('unit',u.unit,'qty',u.s) order by u.unit),'[]')
                    from (select unit, sum(qty) s from r group by unit) u))) into res;
    return res;

  elsif rep = 'project-usage' then
    with r as (
      select d.id as doc_id, d.date, d.project_id, pj2.name as pname, i.id as item_id, i.code, i.name as iname, i.category, i.unit, wh.name as wname, l.qty, l.qty * coalesce(l.unit_price,0) as val
        from public.stock_documents d
        join public.stock_document_lines l on l.document_id = d.id join public.items i on i.id = l.item_id
        join public.warehouses wh on wh.id = d.from_warehouse_id join public.projects pj2 on pj2.id = d.project_id
       where d.type = 'out' and d.date between frx and ttx and (pj is null or d.project_id = pj) and (w is null or wh.id = w)
         and (it is null or i.id = it) and (cat is null or i.category = cat)),
    g as (
      select project_id, pname, item_id, code, iname, category, unit, wname, sum(qty) as qty, sum(val) as val, count(distinct doc_id) as times, max(date) as last_date
        from r group by 1,2,3,4,5,6,7,8)
    select jsonb_build_object(
      'rows',(select coalesce(jsonb_agg(jsonb_build_object('projectId',x.project_id,'project',x.pname,'itemId',x.item_id,'code',x.code,'name',x.iname,
          'category',x.category,'unit',x.unit,'warehouse',x.wname,'qty',x.qty,'value',round(x.val,2),'times',x.times,'lastDate',x.last_date)
          order by x.pname, x.iname, x.wname),'[]') from (select * from g order by pname, iname, wname limit lim) x),
      'total',(select count(*) from g),
      'summary',jsonb_build_object(
        'docs',(select count(distinct doc_id) from r),'items',(select count(distinct item_id) from r),'projects',(select count(distinct project_id) from r),
        'value',(select coalesce(round(sum(val),2),0) from r),
        'unassignedDocs',(select count(*) from public.stock_documents d where d.type = 'out' and d.project_id is null and d.date between frx and ttx
                           and (w is null or d.from_warehouse_id = w)),
        'top',(select coalesce(jsonb_agg(jsonb_build_object('name',t.iname,'unit',t.unit,'qty',t.qty,'times',t.times)),'[]')
                 from (select iname, unit, sum(qty) qty, sum(times) times from g group by item_id, iname, unit order by sum(times) desc, sum(qty) desc limit 5) t))) into res;
    return res;

  elsif rep = 'stocktakes' then
    with r as (
      select c.id as cid, c.number, c.date, c.created_at, wh.name as wname, i.id as item_id, i.code, i.name as iname, i.category, i.unit,
             cl.system_qty, cl.counted_qty, cl.counted_qty - cl.system_qty as diff, cl.reason, u.name as uname,
             case when cl.counted_qty < cl.system_qty then 'shortage' when cl.counted_qty > cl.system_qty then 'surplus' else 'match' end as dtype
        from public.stock_counts c join public.stock_count_lines cl on cl.count_id = c.id join public.items i on i.id = cl.item_id
        join public.warehouses wh on wh.id = c.warehouse_id left join public.profiles u on u.id = c.created_by
       where c.date between frx and ttx and (w is null or c.warehouse_id = w) and (it is null or i.id = it) and (cat is null or i.category = cat)
         and (uid is null or c.created_by = uid) and (txt is null or c.number ilike '%'||txt||'%' or i.name ilike '%'||txt||'%'))
    select jsonb_build_object(
      'rows',(select coalesce(jsonb_agg(jsonb_build_object('countId',x.cid,'number',x.number,'date',x.date,'createdAt',x.created_at,'warehouse',x.wname,
          'itemId',x.item_id,'code',x.code,'name',x.iname,'category',x.category,'unit',x.unit,'systemQty',x.system_qty,'countedQty',x.counted_qty,
          'diff',x.diff,'diffType',x.dtype,'reason',x.reason,'status','settled','user',x.uname)
          order by x.date desc, x.created_at desc, x.iname),'[]')
        from (select * from r where st is null or dtype = st order by date desc, created_at desc, iname limit lim) x),
      'total',(select count(*) from r where st is null or dtype = st),
      'summary',jsonb_build_object('counts',(select count(distinct cid) from r),
        'shortage',(select count(*) from r where dtype = 'shortage'),'surplus',(select count(*) from r where dtype = 'surplus'),
        'match',(select count(*) from r where dtype = 'match'),
        'byUnit',(select coalesce(jsonb_agg(jsonb_build_object('unit',u.unit,'qty',u.s) order by u.unit),'[]')
                    from (select unit, sum(diff) s from r where st is null or dtype = st group by unit) u))) into res;
    return res;

  elsif rep = 'low-stock' then
    with l as (select * from private.ledger()),
    a as (
      select l.item_id, l.warehouse_id, sum(delta) as bal,
             max(l.date) filter (where l.kind in ('in','transfer_in')) as last_in,
             max(l.date) filter (where l.kind in ('out','transfer_out')) as last_out,
             max(l.date) as last_move
        from l group by 1,2),
    p as (
      select a.item_id, a.warehouse_id, a.bal, a.last_in, a.last_out, a.last_move from a
      union all
      select i.id, null::uuid, 0, null::date, null::date, null::date from public.items i
       where i.is_active and i.min_qty > 0 and not exists (select 1 from a where a.item_id = i.id)),
    r as (
      select i.id as item_id, i.code, i.name as iname, i.category, i.unit, i.min_qty, wh.id as wid, wh.name as wname, p.bal, p.bal - i.min_qty as gap,
             p.last_in, p.last_out, p.last_move,
             case when p.bal <= 0 then 'out' else 'low' end as status
        from p join public.items i on i.id = p.item_id left join public.warehouses wh on wh.id = p.warehouse_id
       where i.is_active and i.min_qty > 0 and p.bal <= i.min_qty
         and (w is null or p.warehouse_id = w) and (cat is null or i.category = cat) and (it is null or i.id = it)
         and (txt is null or i.name ilike '%'||txt||'%' or i.code ilike '%'||txt||'%'))
    select jsonb_build_object(
      'rows',(select coalesce(jsonb_agg(jsonb_build_object('itemId',x.item_id,'code',x.code,'name',x.iname,'category',x.category,'unit',x.unit,
          'warehouseId',x.wid,'warehouse',x.wname,'balance',x.bal,'minQty',x.min_qty,'gap',x.gap,'lastIn',x.last_in,'lastOut',x.last_out,
          'lastMove',x.last_move,'status',x.status) order by (x.status = 'out') desc, x.gap, x.iname),'[]')
        from (select * from r where st is null or status = st order by (status = 'out') desc, gap, iname limit lim) x),
      'total',(select count(*) from r where st is null or status = st),
      'summary',jsonb_build_object('out',(select count(*) from r where status = 'out'),'low',(select count(*) from r where status = 'low'))) into res;
    return res;
  end if;
  perform private.fail(404,'غير موجود'); return null;
end $$;
