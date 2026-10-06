import {
  BadRequestException, Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, Patch, Post,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { IsArray, IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import { CurrentUser, PERMISSIONS, RequirePermissions, publicUser } from './auth';
import { StockDocument, User } from './entities';

class CreateUserDto {
  @IsString() @IsNotEmpty() name: string;
  @IsString() @IsNotEmpty() username: string;
  @IsString() @MinLength(6, { message: 'كلمة المرور لازم تكون 6 حروف على الأقل' }) password: string;
  @IsArray() @IsIn(PERMISSIONS as unknown as string[], { each: true }) permissions: string[];
}
class UpdateUserDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() @MinLength(6, { message: 'كلمة المرور لازم تكون 6 حروف على الأقل' }) password?: string;
  @IsOptional() @IsArray() @IsIn(PERMISSIONS as unknown as string[], { each: true }) permissions?: string[];
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@Controller('users')
@RequirePermissions('users')
export class UsersController {
  constructor(
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(StockDocument) private docs: Repository<StockDocument>,
  ) {}

  @Get('permissions')
  permissions() {
    return PERMISSIONS;
  }

  @Get()
  async list() {
    return (await this.users.find({ order: { createdAt: 'ASC' } })).map(publicUser);
  }

  @Post()
  async create(@Body() dto: CreateUserDto) {
    const username = dto.username.trim().toLowerCase();
    if (await this.users.existsBy({ username })) throw new ConflictException('اسم المستخدم موجود بالفعل');
    const user = await this.users.save(
      this.users.create({
        name: dto.name.trim(), username, permissions: [...new Set(dto.permissions)],
        passwordHash: await bcrypt.hash(dto.password, 10), mustChangePassword: false,
      }),
    );
    return publicUser(user);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() me: User) {
    const user = await this.users.findOneBy({ id });
    if (!user) throw new NotFoundException('المستخدم غير موجود');
    if (user.id === me.id) {
      if (dto.isActive === false) throw new BadRequestException('لا يمكنك تعطيل حسابك بنفسك');
      if (dto.permissions && !dto.permissions.includes('users')) {
        throw new BadRequestException('لا يمكنك إزالة صلاحية إدارة المستخدمين من حسابك');
      }
    }
    if (dto.name !== undefined) user.name = dto.name.trim();
    if (dto.permissions) user.permissions = [...new Set(dto.permissions)];
    if (dto.isActive !== undefined) user.isActive = dto.isActive;
    if (dto.password) {
      user.passwordHash = await bcrypt.hash(dto.password, 10);
      user.mustChangePassword = false;
    }
    return publicUser(await this.users.save(user));
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() me: User) {
    if (id === me.id) throw new BadRequestException('لا يمكنك حذف حسابك بنفسك');
    const user = await this.users.findOneBy({ id });
    if (!user) throw new NotFoundException('المستخدم غير موجود');
    if (await this.docs.existsBy({ createdById: id })) {
      throw new ConflictException('المستخدم له حركات مسجلة، عطّل الحساب بدل الحذف');
    }
    await this.users.delete(id);
    return { ok: true };
  }
}
