import {
  Body, CanActivate, Controller, ExecutionContext, ForbiddenException, Get, Injectable, Patch, Post,
  SetMetadata, UnauthorizedException, createParamDecorator, BadRequestException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { User } from './entities';

export const PERMISSIONS = ['items', 'warehouses', 'in', 'out', 'transfer', 'parties', 'reports', 'users'] as const;

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** User needs at least ONE of the listed permissions. */
export const RequirePermissions = (...p: string[]) => SetMetadata('perms', p);
export const CurrentUser = createParamDecorator((_d, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().user as User);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private jwt: JwtService,
    @InjectRepository(User) private users: Repository<User>,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string = req.headers['authorization'] || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException('يجب تسجيل الدخول');

    let payload: { sub: string };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('انتهت الجلسة، سجّل الدخول من جديد');
    }
    // Always reload the user so permission changes / deactivation take effect immediately.
    const user = await this.users.findOneBy({ id: payload.sub });
    if (!user || !user.isActive) throw new UnauthorizedException('الحساب غير مفعّل');
    req.user = user;

    const needed = this.reflector.getAllAndOverride<string[]>('perms', targets);
    if (needed && needed.length && !needed.some((p) => user.permissions.includes(p))) {
      throw new ForbiddenException('ليس لديك صلاحية لتنفيذ هذا الإجراء');
    }
    return true;
  }
}

class LoginDto {
  @IsString() @IsNotEmpty() username: string;
  @IsString() @IsNotEmpty() password: string;
}
class ChangePasswordDto {
  @IsString() @IsNotEmpty() currentPassword: string;
  @IsString() @MinLength(6, { message: 'كلمة المرور لازم تكون 6 حروف على الأقل' }) newPassword: string;
}

export const publicUser = (u: User) => ({
  id: u.id, name: u.name, username: u.username, permissions: u.permissions,
  isActive: u.isActive, mustChangePassword: u.mustChangePassword, createdAt: u.createdAt,
});

@Controller('auth')
export class AuthController {
  constructor(private jwt: JwtService, @InjectRepository(User) private users: Repository<User>) {}

  @Public() @Post('login')
  async login(@Body() dto: LoginDto) {
    const user = await this.users.findOneBy({ username: dto.username.trim().toLowerCase() });
    const ok = user && user.isActive && (await bcrypt.compare(dto.password, user.passwordHash));
    if (!user || !ok) throw new UnauthorizedException('اسم المستخدم أو كلمة المرور غير صحيحة');
    const token = await this.jwt.signAsync({ sub: user.id });
    return { token, user: publicUser(user) };
  }

  @Get('me')
  me(@CurrentUser() user: User) {
    return publicUser(user);
  }

  @Patch('password')
  async changePassword(@CurrentUser() user: User, @Body() dto: ChangePasswordDto) {
    if (!(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      throw new BadRequestException('كلمة المرور الحالية غير صحيحة');
    }
    user.passwordHash = await bcrypt.hash(dto.newPassword, 10);
    user.mustChangePassword = false;
    await this.users.save(user);
    return { ok: true };
  }
}
