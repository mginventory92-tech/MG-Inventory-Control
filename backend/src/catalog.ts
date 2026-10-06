import {
  BadRequestException, Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, ILike, Repository } from 'typeorm';
import { IsBoolean, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { RequirePermissions } from './auth';
import { Item, Party, StockBalance, StockDocument, StockDocumentLine, Warehouse } from './entities';

const blankToNull = (v?: string | null) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());

/* ---------- Items ---------- */
class ItemDto {
  @IsOptional() @IsString() code?: string;
  @IsString() @IsNotEmpty({ message: 'اسم الصنف مطلوب' }) name: string;
  @IsOptional() @IsString() barcode?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsNumber() @Min(0) minQty?: number;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class UpdateItemDto {
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() barcode?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsNumber() @Min(0) minQty?: number;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@Controller('items')
export class ItemsController {
  constructor(
    @InjectRepository(Item) private items: Repository<Item>,
    @InjectRepository(StockDocumentLine) private lines: Repository<StockDocumentLine>,
    @InjectDataSource() private ds: DataSource,
  ) {}

  private async nextCode() {
    const rows = await this.ds.query(
      `INSERT INTO doc_counters(key, last) VALUES ('item', 1)
       ON CONFLICT (key) DO UPDATE SET last = doc_counters.last + 1 RETURNING last`,
    );
    return 'ITM-' + String(rows[0].last).padStart(4, '0');
  }

  private async assertUnique(code: string | undefined, barcode: string | null | undefined, selfId?: string) {
    if (code) {
      const c = await this.items.findOneBy({ code });
      if (c && c.id !== selfId) throw new ConflictException('كود الصنف مستخدم من قبل');
    }
    if (barcode) {
      const b = await this.items.findOneBy({ barcode });
      if (b && b.id !== selfId) throw new ConflictException(`الباركود مستخدم للصنف: ${b.name}`);
    }
  }

  @Get()
  list(@Query('q') q?: string, @Query('all') all?: string) {
    const where = (extra: object) => ({ ...extra, ...(all === 'true' ? {} : { isActive: true }) });
    if (!q || !q.trim()) return this.items.find({ where: where({}), order: { name: 'ASC' } });
    const t = `%${q.trim()}%`;
    return this.items.find({
      where: [where({ name: ILike(t) }), where({ code: ILike(t) }), where({ barcode: ILike(t) }), where({ category: ILike(t) })],
      order: { name: 'ASC' },
    });
  }

  /** Exact lookup used by barcode scanners (matches barcode first, then item code). */
  @Get('lookup/:code')
  async lookup(@Param('code') code: string) {
    const item = (await this.items.findOneBy({ barcode: code, isActive: true })) ||
      (await this.items.findOneBy({ code, isActive: true }));
    if (!item) throw new NotFoundException('لا يوجد صنف بهذا الباركود أو الكود');
    return item;
  }

  @Get(':id')
  async one(@Param('id') id: string) {
    const item = await this.items.findOneBy({ id });
    if (!item) throw new NotFoundException('الصنف غير موجود');
    return item;
  }

  @Post() @RequirePermissions('items')
  async create(@Body() dto: ItemDto) {
    const barcode = blankToNull(dto.barcode);
    const code = blankToNull(dto.code) ?? (await this.nextCode());
    await this.assertUnique(code, barcode);
    return this.items.save(
      this.items.create({
        code, name: dto.name.trim(), barcode, category: blankToNull(dto.category),
        unit: blankToNull(dto.unit) ?? 'قطعة', minQty: dto.minQty ?? 0, notes: blankToNull(dto.notes),
        isActive: dto.isActive ?? true,
      }),
    );
  }

  @Patch(':id') @RequirePermissions('items')
  async update(@Param('id') id: string, @Body() dto: UpdateItemDto) {
    const item = await this.items.findOneBy({ id });
    if (!item) throw new NotFoundException('الصنف غير موجود');
    const barcode = dto.barcode !== undefined ? blankToNull(dto.barcode) : undefined;
    const code = dto.code !== undefined ? blankToNull(dto.code) ?? undefined : undefined;
    await this.assertUnique(code, barcode, id);
    if (code) item.code = code;
    if (dto.name !== undefined) item.name = dto.name.trim();
    if (barcode !== undefined) item.barcode = barcode;
    if (dto.category !== undefined) item.category = blankToNull(dto.category);
    if (dto.unit !== undefined) item.unit = blankToNull(dto.unit) ?? 'قطعة';
    if (dto.minQty !== undefined) item.minQty = dto.minQty;
    if (dto.notes !== undefined) item.notes = blankToNull(dto.notes);
    if (dto.isActive !== undefined) item.isActive = dto.isActive;
    return this.items.save(item);
  }

  @Delete(':id') @RequirePermissions('items')
  async remove(@Param('id') id: string) {
    if (await this.lines.existsBy({ itemId: id })) {
      throw new ConflictException('الصنف له حركات مسجلة ولا يمكن حذفه، يمكنك تعطيله بدل الحذف');
    }
    const r = await this.items.delete(id);
    if (!r.affected) throw new NotFoundException('الصنف غير موجود');
    return { ok: true };
  }
}

/* ---------- Warehouses ---------- */
class WarehouseDto {
  @IsString() @IsNotEmpty({ message: 'اسم المخزن مطلوب' }) name: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class UpdateWarehouseDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@Controller('warehouses')
export class WarehousesController {
  constructor(
    @InjectRepository(Warehouse) private whs: Repository<Warehouse>,
    @InjectRepository(StockDocument) private docs: Repository<StockDocument>,
    @InjectRepository(StockBalance) private balances: Repository<StockBalance>,
  ) {}

  @Get()
  list(@Query('all') all?: string) {
    return this.whs.find({ where: all === 'true' ? {} : { isActive: true }, order: { name: 'ASC' } });
  }

  @Post() @RequirePermissions('warehouses')
  async create(@Body() dto: WarehouseDto) {
    const name = dto.name.trim();
    if (await this.whs.existsBy({ name })) throw new ConflictException('اسم المخزن موجود بالفعل');
    return this.whs.save(this.whs.create({ name, location: blankToNull(dto.location) as string, isActive: dto.isActive ?? true }));
  }

  @Patch(':id') @RequirePermissions('warehouses')
  async update(@Param('id') id: string, @Body() dto: UpdateWarehouseDto) {
    const wh = await this.whs.findOneBy({ id });
    if (!wh) throw new NotFoundException('المخزن غير موجود');
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      const dup = await this.whs.findOneBy({ name });
      if (dup && dup.id !== id) throw new ConflictException('اسم المخزن موجود بالفعل');
      wh.name = name;
    }
    if (dto.location !== undefined) wh.location = blankToNull(dto.location) as string;
    if (dto.isActive === false) {
      const stock = await this.balances
        .createQueryBuilder('b').where('b.warehouseId = :id AND b.qty > 0', { id }).getCount();
      if (stock > 0) throw new BadRequestException('لا يمكن تعطيل مخزن به أرصدة، انقل الأصناف منه أولاً');
    }
    if (dto.isActive !== undefined) wh.isActive = dto.isActive;
    return this.whs.save(wh);
  }

  @Delete(':id') @RequirePermissions('warehouses')
  async remove(@Param('id') id: string) {
    const used = await this.docs
      .createQueryBuilder('d').where('d.fromWarehouseId = :id OR d.toWarehouseId = :id', { id }).getCount();
    if (used > 0) throw new ConflictException('المخزن له حركات مسجلة ولا يمكن حذفه، يمكنك تعطيله بدل الحذف');
    await this.balances.delete({ warehouseId: id });
    const r = await this.whs.delete(id);
    if (!r.affected) throw new NotFoundException('المخزن غير موجود');
    return { ok: true };
  }
}

/* ---------- Suppliers & customers ---------- */
class PartyDto {
  @IsIn(['supplier', 'customer']) type: 'supplier' | 'customer';
  @IsString() @IsNotEmpty({ message: 'الاسم مطلوب' }) name: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class UpdatePartyDto {
  @IsOptional() @IsIn(['supplier', 'customer']) type?: 'supplier' | 'customer';
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@Controller('parties')
export class PartiesController {
  constructor(
    @InjectRepository(Party) private parties: Repository<Party>,
    @InjectRepository(StockDocument) private docs: Repository<StockDocument>,
  ) {}

  @Get()
  list(@Query('type') type?: string, @Query('all') all?: string) {
    const where: any = {};
    if (type === 'supplier' || type === 'customer') where.type = type;
    if (all !== 'true') where.isActive = true;
    return this.parties.find({ where, order: { name: 'ASC' } });
  }

  @Post() @RequirePermissions('parties')
  create(@Body() dto: PartyDto) {
    return this.parties.save(
      this.parties.create({
        type: dto.type, name: dto.name.trim(), phone: blankToNull(dto.phone), notes: blankToNull(dto.notes),
        isActive: dto.isActive ?? true,
      }),
    );
  }

  @Patch(':id') @RequirePermissions('parties')
  async update(@Param('id') id: string, @Body() dto: UpdatePartyDto) {
    const p = await this.parties.findOneBy({ id });
    if (!p) throw new NotFoundException('غير موجود');
    if (dto.type !== undefined) p.type = dto.type;
    if (dto.name !== undefined) p.name = dto.name.trim();
    if (dto.phone !== undefined) p.phone = blankToNull(dto.phone);
    if (dto.notes !== undefined) p.notes = blankToNull(dto.notes);
    if (dto.isActive !== undefined) p.isActive = dto.isActive;
    return this.parties.save(p);
  }

  @Delete(':id') @RequirePermissions('parties')
  async remove(@Param('id') id: string) {
    if (await this.docs.existsBy({ partyId: id })) {
      throw new ConflictException('له حركات مسجلة ولا يمكن حذفه، يمكنك تعطيله بدل الحذف');
    }
    const r = await this.parties.delete(id);
    if (!r.affected) throw new NotFoundException('غير موجود');
    return { ok: true };
  }
}
