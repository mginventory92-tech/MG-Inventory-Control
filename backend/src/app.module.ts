import { Injectable, Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { AuthController, AuthGuard, PERMISSIONS } from './auth';
import { ItemsController, PartiesController, WarehousesController } from './catalog';
import { ALL_ENTITIES, User, Warehouse } from './entities';
import { DashboardController, DocumentsController, ReportsController, StockController } from './stock';
import { UsersController } from './users';

const jwtSecret = process.env.JWT_SECRET || 'dev-only-secret-change-me';
if (!process.env.JWT_SECRET) new Logger('Config').warn('JWT_SECRET غير معرّف: بيستخدم قيمة تجريبية. غيّره قبل التشغيل الفعلي.');

@Injectable()
class SeedService implements OnApplicationBootstrap {
  private log = new Logger('Seed');
  constructor(
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(Warehouse) private whs: Repository<Warehouse>,
  ) {}

  async onApplicationBootstrap() {
    if ((await this.users.count()) === 0) {
      const username = (process.env.ADMIN_USERNAME || 'admin').toLowerCase();
      const password = process.env.ADMIN_PASSWORD || 'admin123';
      await this.users.save(
        this.users.create({
          name: 'مدير النظام', username, passwordHash: await bcrypt.hash(password, 10),
          permissions: [...PERMISSIONS], mustChangePassword: !process.env.ADMIN_PASSWORD,
        }),
      );
      this.log.warn(`تم إنشاء المستخدم الأول: ${username}${process.env.ADMIN_PASSWORD ? '' : ' / admin123 (غيّر كلمة المرور فوراً)'}`);
    }
    if ((await this.whs.count()) === 0) await this.whs.save(this.whs.create({ name: 'المخزن الرئيسي' }));
  }
}

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/inventory',
      entities: ALL_ENTITIES,
      synchronize: process.env.DB_SYNC !== 'false',
      extra: process.env.DB_POOL_MAX ? { max: +process.env.DB_POOL_MAX } : undefined,
    }),
    TypeOrmModule.forFeature(ALL_ENTITIES),
    JwtModule.register({ global: true, secret: jwtSecret, signOptions: { expiresIn: '12h' } }),
  ],
  controllers: [
    AuthController, UsersController, ItemsController, WarehousesController, PartiesController,
    DocumentsController, StockController, ReportsController, DashboardController,
  ],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }, SeedService, StockController],
})
export class AppModule {}
