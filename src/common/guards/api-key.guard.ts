import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

const API_KEY_HEADER = 'x-api-key';
const AUTH_HEADER = 'authorization';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private jwtService: JwtService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const headers = request.headers as Record<string, string | undefined>;
    const bearerToken = this.getBearerToken(headers[AUTH_HEADER]);
    const apiKeyFromHeader = headers[API_KEY_HEADER] ?? headers['X-Api-Key'];
    const keyOrToken = bearerToken ?? apiKeyFromHeader;

    if (!keyOrToken) {
      throw new UnauthorizedException(
        'Chave de API ou token JWT ausente. Envie X-API-Key ou Authorization: Bearer <token>.',
      );
    }

    const trimmed = keyOrToken.trim();

    try {
      const payload = this.jwtService.verify(trimmed);
      request.user = payload;
      return true;
    } catch {
      // Não é um JWT válido; tratar como API Key
    }

    const apiKey = process.env.API_KEY;
    if (!apiKey || apiKey.trim() === '') {
      throw new UnauthorizedException(
        'API_KEY não configurada no servidor. Para login de usuários do dashboard, use POST /api/auth/login.',
      );
    }

    if (trimmed !== apiKey.trim()) {
      throw new UnauthorizedException('Chave de API ou token inválido.');
    }

    return true;
  }

  private getBearerToken(authHeader: string | undefined): string | undefined {
    if (!authHeader || typeof authHeader !== 'string') return undefined;
    const [scheme, token] = authHeader.split(/\s+/);
    if (scheme?.toLowerCase() !== 'bearer' || !token) return undefined;
    return token;
  }
}
