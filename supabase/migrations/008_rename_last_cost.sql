-- 008: تسمية العمود بشكل صحيح: items.avg_cost → items.last_cost (آخر سعر شراء).
alter table public.items rename column avg_cost to last_cost;
comment on column public.items.last_cost is 'آخر سعر شراء للصنف';

-- إعادة تعريف الدوال اللي بتشير للعمود بالاسم الجديد
do $mig$
declare f text; def text;
begin
  foreach f in array array['private.item_json(public.items)',
                           'private.r_documents(public.profiles,text,text[],jsonb,jsonb)',
                           'private.r_reports(public.profiles,text,text[],jsonb,jsonb)'] loop
    def := pg_get_functiondef(f::regprocedure);
    def := replace(replace(def,'avg_cost','last_cost'),'avgCost','lastCost');
    execute def;
  end loop;
end $mig$;
