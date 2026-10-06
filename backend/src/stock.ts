import {
  BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Query,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested,
} from 'class-validator';
import { CurrentUser, RequirePermissions } from './auth';
import { Item, Party, StockBalance, StockDocument, StockDocumentLine, User, Warehouse } from './entities';

class LineDto {
  @IsUUID() itemId: string;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001, { message: 'الكمية لازم تكون أكبر من صفر' }) qty: number;
}
class CreateDocumentDto {
  @IsIn(['in', 'out', 'transfer']) type: 'in' | 'out' | 'transfer';
  @IsOptional() @IsDateString() date?: string;
  @IsOptional() @IsUUID() fromWarehouseId?: string;
  @IsOptional() @IsUUID() toWarehouseId?: string;
  @IsOptional() @IsUUID() partyId?: string;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() notes?: string;
  @IsArray() @ArrayMinSize(1, { message: 'أضف صنف واحد على الأقل' }) @ValidateNested({ each: true }) @Type(() => LineDto)
  lines: LineDto[];
}

const PREFIX = { in: 'IN', out: 'OUT', transfer: 'TR' } as const;
const TYPE_AR = { in: 'إذن إضافة', out: 'إذن صرف', transfer: 'تحويل' } as const;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const today = () => new Date().toISOString().slice(0, 10);

@Controller('documents')
export class DocumentsController {
  constructor(
    @InjectDataSource() private ds: DataSource,
    @InjectRepository(StockDocument) private docs: Repository<StockDocument>,
  ) {}

  @Post()
  async create(@Body() dto: CreateDocumentDto, @CurrentUser() user: User) {
    if (!user.permissions.includes(dto.type)) {
      throw new ForbiddenException(`ليس لديك صلاحية ${TYPE_AR[dto.type]}`);
    }
    if (dto.type === 'in' && !dto.toWarehouseId) throw new BadRequestException('اختر المخزن المستلم');
    if (dto.type === 'out' && !dto.fromWarehouseId) throw new BadRequestException('اختر المخزن المصروف منه');
    if (dto.type === 'transfer') {
      if (!dto.fromWarehouseId || !dto.toWarehouseId) throw new BadRequestException('اختر المخزن المحوَّل منه وإليه');
      if (dto.fromWarehouseId === dto.toWarehouseId) throw new BadRequestException('لا يمكن التحويل لنفس المخزن');
    }
    const fromId = dto.type === 'in' ? null : dto.fromWarehouseId!;
    const toId = dto.type === 'out' ? null : dto.toWarehouseId!;

    // merge duplicate lines; sort by item id so concurrent documents lock rows in the same order
    const merged = new Map<string, number>();
    for (const l of dto.lines) merged.set(l.itemId, round3((merged.get(l.itemId) ?? 0) + l.qty));
    const lines = [...merged.entries()].map(([itemId, qty]) => ({ itemId, qty })).sort((a, b) => a.itemId.localeCompare(b.itemId));

    const id = await this.ds.transaction(async (em) => {
      for (const wid of [fromId, toId]) {
        if (!wid) continue;
        const wh = await em.findOneBy(Warehouse, { id: wid });
        if (!wh || !wh.isActive) throw new BadRequestException('المخزن غير موجود أو معطّل');
      }
      if (dto.partyId && !(await em.existsBy(Party, { id: dto.partyId }))) throw new BadRequestException('الطرف غير موجود');

      const items = await em.findBy(Item, { id: In(lines.map((l) => l.itemId)) });
      const byId = new Map(items.map((i) => [i.id, i]));
      for (const l of lines) {
        const it = byId.get(l.itemId);
        if (!it) throw new BadRequestException('أحد الأصناف غير موجود');
        if (!it.isActive) throw new BadRequestException(`الصنف "${it.name}" معطّل`);
      }

      const seq = await em.query(
        `INSERT INTO doc_counters(key, last) VALUES ($1, 1)
         ON CONFLICT (key) DO UPDATE SET last = doc_counters.last + 1 RETURNING last`,
        ['doc_' + dto.type],
      );
      const number = `${PREFIX[dto.type]}-${String(seq[0].last).padStart(5, '0')}`;

      const doc = await em.save(
        em.create(StockDocument, {
          number, type: dto.type, date: dto.date ?? today(), fromWarehouseId: fromId, toWarehouseId: toId,
          partyId: dto.partyId ?? null, reference: dto.reference?.trim() || null, notes: dto.notes?.trim() || null,
          createdById: user.id,
        }),
      );
      await em.insert(StockDocumentLine, lines.map((l) => ({ documentId: doc.id, itemId: l.itemId, qty: l.qty })));

      for (const l of lines) {
        if (fromId) await this.decrease(em, l.itemId, fromId, l.qty, byId.get(l.itemId)!.name);
        if (toId) await this.increase(em, l.itemId, toId, l.qty);
      }
      return doc.id;
    });
    return this.getOne(id);
  }

  private async increase(em: EntityManager, itemId: string, warehouseId: string, qty: number) {
    await em.query(
      `INSERT INTO stock_balances(item_id, warehouse_id, qty) VALUES ($1, $2, $3)
       ON CONFLICT (item_id, warehouse_id) DO UPDATE SET qty = stock_balances.qty + EXCLUDED.qty`,
      [itemId, warehouseId, qty],
    );
  }

  /** Atomic check-and-decrease: the row lock taken by UPDATE makes overdrafts impossible even under concurrency. */
  private async decrease(em: EntityManager, itemId: string, warehouseId: string, qty: number, name: string) {
    const res = await em.query(
      `UPDATE stock_balances SET qty = qty - $3 WHERE item_id = $1 AND warehouse_id = $2 AND qty >= $3 RETURNING qty`,
      [itemId, warehouseId, qty],
    );
    // the pg driver returns [rows, affectedCount] for UPDATE ... RETURNING
    const updated: unknown[] = Array.isArray(res[0]) ? res[0] : res;
    if (!updated.length) {
      const cur = await em.query(`SELECT qty FROM stock_balances WHERE item_id = $1 AND warehouse_id = $2`, [itemId, warehouseId]);
      const available = cur.length ? parseFloat(cur[0].qty) : 0;
      throw new BadRequestException(`الرصيد غير كافي للصنف "${name}": المتاح ${available} والمطلوب ${qty}`);
    }
  }

  @Get() @RequirePermissions('reports', 'in', 'out', 'transfer')
  async list(
    @Query('type') type?: string, @Query('from') from?: string, @Query('to') to?: string,
    @Query('warehouseId') warehouseId?: string, @Query('q') q?: string,
    @Query('limit') limit = '50', @Query('offset') offset = '0',
  ) {
    const qb = this.docs.createQueryBuilder('d')
      .leftJoinAndSelect('d.fromWarehouse', 'fw').leftJoinAndSelect('d.toWarehouse', 'tw')
      .leftJoinAndSelect('d.party', 'p').leftJoinAndSelect('d.createdBy', 'u')
      .orderBy('d.date', 'DESC').addOrderBy('d.createdAt', 'DESC');
    if (type && ['in', 'out', 'transfer'].includes(type)) qb.andWhere('d.type = :type', { type });
    if (from) qb.andWhere('d.date >= :from', { from });
    if (to) qb.andWhere('d.date <= :to', { to });
    if (warehouseId) qb.andWhere('(d.fromWarehouseId = :w OR d.toWarehouseId = :w)', { w: warehouseId });
    if (q) qb.andWhere('(d.number ILIKE :q OR d.reference ILIKE :q OR p.name ILIKE :q)', { q: `%${q}%` });
    const [rows, total] = await qb.take(Math.min(+limit || 50, 200)).skip(+offset || 0).getManyAndCount();
    return { total, rows: rows.map(this.shape) };
  }

  @Get(':id') @RequirePermissions('reports', 'in', 'out', 'transfer')
  getOne(@Param('id') id: string) {
    return this.docs
      .createQueryBuilder('d')
      .leftJoinAndSelect('d.fromWarehouse', 'fw').leftJoinAndSelect('d.toWarehouse', 'tw')
      .leftJoinAndSelect('d.party', 'p').leftJoinAndSelect('d.createdBy', 'u')
      .leftJoinAndSelect('d.lines', 'l').leftJoinAndSelect('l.item', 'i')
      .where('d.id = :id', { id }).getOne()
      .then((d) => {
        if (!d) throw new NotFoundException('الإذن غير موجود');
        return this.shape(d);
      });
  }

  private shape = (d: StockDocument) => ({
    ...d, createdBy: d.createdBy ? { id: d.createdBy.id, name: d.createdBy.name } : null,
  });
}

@Controller('stock')
export class StockController {
  constructor(
    @InjectRepository(Item) private items: Repository<Item>,
    @InjectRepository(Warehouse) private whs: Repository<Warehouse>,
    @InjectRepository(StockBalance) private balances: Repository<StockBalance>,
  ) {}

  /** One row per item with its quantity in every warehouse and the total. */
  private async table(opts: { q?: string; warehouseId?: string }) {
    const iq = this.items.createQueryBuilder('i').where('i.isActive = true').orderBy('i.name', 'ASC');
    if (opts.q?.trim()) {
      iq.andWhere('(i.name ILIKE :q OR i.code ILIKE :q OR i.barcode ILIKE :q OR i.category ILIKE :q)', { q: `%${opts.q.trim()}%` });
    }
    const [items, warehouses, balances] = await Promise.all([
      iq.getMany(), this.whs.find({ where: { isActive: true }, order: { name: 'ASC' } }), this.balances.find(),
    ]);
    const map = new Map<string, Record<string, number>>();
    for (const b of balances) {
      const m = map.get(b.itemId) ?? {};
      m[b.warehouseId] = b.qty;
      map.set(b.itemId, m);
    }
    const rows = items.map((item) => {
      const per = map.get(item.id) ?? {};
      const total = round3(Object.values(per).reduce((s, v) => s + v, 0));
      const qty = opts.warehouseId ? per[opts.warehouseId] ?? 0 : total;
      return { item, perWarehouse: per, total, qty, low: item.minQty > 0 && qty <= item.minQty };
    });
    return { warehouses, rows };
  }

  @Get('balances')
  async balancesTable(@Query('q') q?: string, @Query('warehouseId') warehouseId?: string, @Query('lowOnly') lowOnly?: string) {
    const t = await this.table({ q, warehouseId });
    let rows = t.rows;
    if (warehouseId) rows = rows.filter((r) => r.perWarehouse[warehouseId] !== undefined || r.qty !== 0 || r.low);
    if (lowOnly === 'true') rows = rows.filter((r) => r.low);
    return { warehouses: t.warehouses, rows };
  }

  @Get('low')
  async low() {
    const t = await this.table({});
    return t.rows.filter((r) => r.low);
  }

  /** Current quantity of given items in one warehouse (used by the document forms). */
  @Get('available')
  async available(@Query('warehouseId') warehouseId: string) {
    if (!warehouseId) throw new BadRequestException('warehouseId مطلوب');
    const rows = await this.balances.find({ where: { warehouseId } });
    return Object.fromEntries(rows.map((r) => [r.itemId, r.qty]));
  }
}

@Controller('reports')
@RequirePermissions('reports')
export class ReportsController {
  constructor(@InjectDataSource() private ds: DataSource) {}

  /** Item movement ledger: one row per document line. */
  @Get('movements')
  async movements(
    @Query('itemId') itemId?: string, @Query('warehouseId') warehouseId?: string, @Query('type') type?: string,
    @Query('partyId') partyId?: string, @Query('from') from?: string, @Query('to') to?: string,
    @Query('limit') limit = '200', @Query('offset') offset = '0',
  ) {
    const where: string[] = []; const params: any[] = [];
    const p = (v: any) => { params.push(v); return '$' + params.length; };
    if (itemId) where.push(`l.item_id = ${p(itemId)}`);
    if (type && ['in', 'out', 'transfer'].includes(type)) where.push(`d.type = ${p(type)}`);
    if (partyId) where.push(`d.party_id = ${p(partyId)}`);
    if (from) where.push(`d.date >= ${p(from)}`);
    if (to) where.push(`d.date <= ${p(to)}`);
    if (warehouseId) { const w = p(warehouseId); where.push(`(d.from_warehouse_id = ${w} OR d.to_warehouse_id = ${w})`); }
    const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const lim = Math.min(+limit || 200, 1000);
    const off = +offset || 0;
    const rows = await this.ds.query(
      `SELECT d.id AS "documentId", d.number, d.type, d.date, d.reference, d.created_at AS "createdAt",
              i.id AS "itemId", i.code AS "itemCode", i.name AS "itemName", i.unit, l.qty::float AS qty,
              fw.name AS "fromWarehouse", tw.name AS "toWarehouse", pa.name AS "partyName", u.name AS "userName"
       FROM stock_document_lines l
       JOIN stock_documents d ON d.id = l.document_id
       JOIN items i ON i.id = l.item_id
       LEFT JOIN warehouses fw ON fw.id = d.from_warehouse_id
       LEFT JOIN warehouses tw ON tw.id = d.to_warehouse_id
       LEFT JOIN parties pa ON pa.id = d.party_id
       LEFT JOIN users u ON u.id = d.created_by
       ${clause}
       ORDER BY d.date DESC, d.created_at DESC, i.name
       LIMIT ${lim} OFFSET ${off}`,
      params,
    );
    const totals = await this.ds.query(
      `SELECT d.type, COALESCE(SUM(l.qty),0)::float AS qty, COUNT(DISTINCT d.id)::int AS docs
       FROM stock_document_lines l JOIN stock_documents d ON d.id = l.document_id ${clause} GROUP BY d.type`,
      params,
    );
    return { rows, totals };
  }
}

@Controller('dashboard')
export class DashboardController {
  constructor(@InjectDataSource() private ds: DataSource, private stock: StockController) {}

  @Get()
  async summary() {
    const [counts] = await this.ds.query(`
      SELECT (SELECT COUNT(*) FROM items WHERE is_active)::int AS items,
             (SELECT COUNT(*) FROM warehouses WHERE is_active)::int AS warehouses,
             (SELECT COUNT(*) FROM parties WHERE is_active AND type = 'supplier')::int AS suppliers,
             (SELECT COUNT(*) FROM parties WHERE is_active AND type = 'customer')::int AS customers,
             (SELECT COUNT(*) FROM stock_documents WHERE date = CURRENT_DATE)::int AS "docsToday"`);
    const low = await this.stock.low();
    const recent = await this.ds.query(`
      SELECT d.id, d.number, d.type, d.date, fw.name AS "fromWarehouse", tw.name AS "toWarehouse", pa.name AS "partyName",
             (SELECT COUNT(*) FROM stock_document_lines l WHERE l.document_id = d.id)::int AS "lineCount"
      FROM stock_documents d
      LEFT JOIN warehouses fw ON fw.id = d.from_warehouse_id
      LEFT JOIN warehouses tw ON tw.id = d.to_warehouse_id
      LEFT JOIN parties pa ON pa.id = d.party_id
      ORDER BY d.created_at DESC LIMIT 8`);
    return { counts, lowCount: low.length, low: low.slice(0, 10), recent };
  }
}
