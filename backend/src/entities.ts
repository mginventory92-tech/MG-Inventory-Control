import {
  Entity, PrimaryGeneratedColumn, PrimaryColumn, Column, CreateDateColumn,
  ManyToOne, OneToMany, JoinColumn, Index,
} from 'typeorm';

export const numeric = {
  to: (v?: number | null) => v,
  from: (v: string | null) => (v === null || v === undefined ? v : parseFloat(v)),
};

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() name: string;
  @Index({ unique: true }) @Column() username: string;
  @Column({ name: 'password_hash' }) passwordHash: string;
  @Column('text', { array: true, default: '{}' }) permissions: string[];
  @Column({ name: 'is_active', default: true }) isActive: boolean;
  @Column({ name: 'must_change_password', default: false }) mustChangePassword: boolean;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}

@Entity('warehouses')
export class Warehouse {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index({ unique: true }) @Column() name: string;
  @Column({ nullable: true }) location: string;
  @Column({ name: 'is_active', default: true }) isActive: boolean;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}

@Entity('items')
export class Item {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index({ unique: true }) @Column() code: string;
  @Column() name: string;
  @Index({ unique: true }) @Column({ type: 'varchar', nullable: true }) barcode: string | null;
  @Column({ type: 'varchar', nullable: true }) category: string | null;
  @Column({ default: 'قطعة' }) unit: string;
  @Column({ name: 'min_qty', type: 'numeric', precision: 18, scale: 3, default: 0, transformer: numeric })
  minQty: number;
  @Column({ type: 'text', nullable: true }) notes: string | null;
  @Column({ name: 'is_active', default: true }) isActive: boolean;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}

@Entity('parties')
export class Party {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar' }) type: 'supplier' | 'customer';
  @Column() name: string;
  @Column({ type: 'varchar', nullable: true }) phone: string | null;
  @Column({ type: 'text', nullable: true }) notes: string | null;
  @Column({ name: 'is_active', default: true }) isActive: boolean;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}

@Entity('stock_documents')
export class StockDocument {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index({ unique: true }) @Column() number: string;
  @Column({ type: 'varchar' }) type: 'in' | 'out' | 'transfer';
  @Column({ type: 'date' }) date: string;
  @Column({ name: 'from_warehouse_id', type: 'uuid', nullable: true }) fromWarehouseId: string | null;
  @Column({ name: 'to_warehouse_id', type: 'uuid', nullable: true }) toWarehouseId: string | null;
  @ManyToOne(() => Warehouse, { nullable: true, eager: true })
  @JoinColumn({ name: 'from_warehouse_id' }) fromWarehouse: Warehouse | null;
  @ManyToOne(() => Warehouse, { nullable: true, eager: true })
  @JoinColumn({ name: 'to_warehouse_id' }) toWarehouse: Warehouse | null;
  @Column({ name: 'party_id', type: 'uuid', nullable: true }) partyId: string | null;
  @ManyToOne(() => Party, { nullable: true, eager: true })
  @JoinColumn({ name: 'party_id' }) party: Party | null;
  @Column({ type: 'varchar', nullable: true }) reference: string | null;
  @Column({ type: 'text', nullable: true }) notes: string | null;
  @Column({ name: 'created_by', type: 'uuid', nullable: true }) createdById: string | null;
  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by' }) createdBy: User | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @OneToMany(() => StockDocumentLine, (l) => l.document, { cascade: ['insert'] })
  lines: StockDocumentLine[];
}

@Entity('stock_document_lines')
export class StockDocumentLine {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'document_id', type: 'uuid' }) documentId: string;
  @ManyToOne(() => StockDocument, (d) => d.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'document_id' }) document: StockDocument;
  @Column({ name: 'item_id', type: 'uuid' }) itemId: string;
  @ManyToOne(() => Item, { eager: true })
  @JoinColumn({ name: 'item_id' }) item: Item;
  @Column({ type: 'numeric', precision: 18, scale: 3, transformer: numeric }) qty: number;
}

@Entity('stock_balances')
export class StockBalance {
  @PrimaryColumn({ name: 'item_id', type: 'uuid' }) itemId: string;
  @PrimaryColumn({ name: 'warehouse_id', type: 'uuid' }) warehouseId: string;
  @Column({ type: 'numeric', precision: 18, scale: 3, default: 0, transformer: numeric }) qty: number;
}

@Entity('doc_counters')
export class DocCounter {
  @PrimaryColumn() key: string;
  @Column({ type: 'int', default: 0 }) last: number;
}

export const ALL_ENTITIES = [
  User, Warehouse, Item, Party, StockDocument, StockDocumentLine, StockBalance, DocCounter,
];
