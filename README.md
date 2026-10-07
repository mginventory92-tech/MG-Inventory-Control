# نظام المخازن (MG Material Control)

أصناف ومخازن متعددة، إذن إضافة وصرف وتحويل، أرصدة، تنبيه حد أدنى، موردين وعملاء، مستخدمين وصلاحيات، تقارير وحركة أصناف، بحث وباركود.

## المكونات
```
web/        الواجهة: React + Vite (عربي RTL) — منشورة على GitHub Pages
supabase/   قاعدة البيانات والـ API ودالة إدارة المستخدمين
mobile/     تطبيق Flutter (لسه متوصّل بالباك إند القديم، مش شغال مع Supabase)
```

## كيف يشتغل
- **قاعدة البيانات:** Supabase. الجداول في `supabase/migrations/001_schema.sql` وكلها مقفولة، والتطبيق بيكلّم دالة واحدة بس `public.api` (في `002_api.sql`).
- **إدارة المستخدمين:** دالة السيرفر `supabase/functions/users` (إنشاء/تعديل/حذف). اسم المستخدم بيتحول داخلياً لإيميل `اسم@mginv.example.com`، فلازم يكون حروف إنجليزية صغيرة وأرقام.
- **الاتصال:** `web/.env` فيه عنوان المشروع والمفتاح العام (publishable)، وده مصمم يكون علني.

## النشر
أي push على `main` بيشغّل `.github/workflows/ci.yml`: فحص الأنواع + الاختبارات + البناء، وبعدين بينشر تلقائيًا على فرع `gh-pages`. (Settings > Pages > Deploy from a branch > `gh-pages`.)

## تشغيل الواجهة محلياً
```bash
cd web
npm ci
npm run dev        # http://localhost:5173 (بيوصل لـ Supabase مباشرة)
npm test           # اختبارات العميل والعقد (من غير اتصال)؛ اختبار الواجهة الحي بيتخطّى إلا لو VITE_RUN_E2E=1 و VITE_TEST_PASSWORD
```

## المعمارية
تفاصيل القرارات والقواعد في [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## تغيير صلاحيات المستخدمين
قايمة الصلاحيات الـ 8 موجودة في مكانين: `PERMS` في `web/src/api.ts` و`PERMISSIONS` في `supabase/functions/users/index.ts`. لو اختلفوا، اختبار `contract.test.ts` بيفشل في CI.
