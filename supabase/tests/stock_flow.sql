-- اختبار يدوي لحركة المخزون على قاعدة البيانات الحقيقية.
-- بيتشغّل من SQL Editor بحساب admin موجود، وبيخلص بـ ROLLBACK فمفيش أي بيانات بتتحفظ.
-- النتيجة المتوقعة: إضافة OK، صرف 40 ERR 400 (رصيد غير كافي)، صرف 20 OK، تحويل OK،
-- تحويل لنفس المخزن ERR 400، كمية صفر ERR 400، حذف صنف عليه حركات ERR 409،
-- تعطيل مخزن فيه رصيد ERR 400، باركود مكرر ERR 409، والرصيد النهائي: مخزن1=2 ومخزن2=5 والإجمالي 7.
begin;
select set_config('request.jwt.claims', json_build_object('sub',(select id from public.profiles where username='admin'),'role','authenticated')::text, true);
create temp table res(n serial, step text, out text);
create function pg_temp.t(m text, p text, q jsonb, b jsonb) returns text language plpgsql as $$
declare r jsonb; h text; msg text;
begin
  r := public.api(m,p,q,b);
  return 'OK ' || coalesce(r->>'number', left(r::text,80));
exception when others then
  get stacked diagnostics h = pg_exception_hint, msg = message_text;
  return 'ERR ' || coalesce(h,'?') || ': ' || msg;
end $$;
do $$
declare wh1 text; wh2 text; it text;
begin
  wh1 := public.api('GET','/warehouses')->0->>'id';
  wh2 := public.api('POST','/warehouses','{}',jsonb_build_object('name','تجربة-2'))->>'id';
  it  := public.api('POST','/items','{}',jsonb_build_object('name','صنف اختبار','barcode','T1','minQty',10))->>'id';
  insert into res(step,out) values
   ('إضافة 25', pg_temp.t('POST','/documents','{}',jsonb_build_object('type','in','toWarehouseId',wh1,'lines',jsonb_build_array(jsonb_build_object('itemId',it,'qty',25))))),
   ('صرف 40 (أكتر من الرصيد)', pg_temp.t('POST','/documents','{}',jsonb_build_object('type','out','fromWarehouseId',wh1,'lines',jsonb_build_array(jsonb_build_object('itemId',it,'qty',40))))),
   ('صرف 20', pg_temp.t('POST','/documents','{}',jsonb_build_object('type','out','fromWarehouseId',wh1,'lines',jsonb_build_array(jsonb_build_object('itemId',it,'qty',20))))),
   ('تحويل 3 لمخزن تاني', pg_temp.t('POST','/documents','{}',jsonb_build_object('type','transfer','fromWarehouseId',wh1,'toWarehouseId',wh2,'lines',jsonb_build_array(jsonb_build_object('itemId',it,'qty',3))))),
   ('تحويل لنفس المخزن', pg_temp.t('POST','/documents','{}',jsonb_build_object('type','transfer','fromWarehouseId',wh1,'toWarehouseId',wh1,'lines',jsonb_build_array(jsonb_build_object('itemId',it,'qty',1))))),
   ('كمية صفر', pg_temp.t('POST','/documents','{}',jsonb_build_object('type','in','toWarehouseId',wh1,'lines',jsonb_build_array(jsonb_build_object('itemId',it,'qty',0))))),
   ('نفس الصنف مرتين في إذن واحد (1+1)', pg_temp.t('POST','/documents','{}',jsonb_build_object('type','in','toWarehouseId',wh2,'lines',jsonb_build_array(jsonb_build_object('itemId',it,'qty',1),jsonb_build_object('itemId',it,'qty',1))))),
   ('حذف صنف عليه حركات', pg_temp.t('DELETE','/items/'||it,'{}','{}')),
   ('تعطيل مخزن فيه رصيد', pg_temp.t('PATCH','/warehouses/'||wh1,'{}','{"isActive":false}')),
   ('باركود مكرر', pg_temp.t('POST','/items','{}','{"name":"تاني","barcode":"T1"}')),
   ('الرصيد النهائي', (select r::text from jsonb_array_elements(public.api('GET','/stock/balances','{"q":"اختبار"}','{}')->'rows') r limit 1));
end $$;
select step, out from res order by n;
rollback;
