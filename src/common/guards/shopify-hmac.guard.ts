import {
  CanActivate,
  ExecutionContext,
  Injectable,
  BadRequestException,
} from '@nestjs/common';
import { createHmac } from 'crypto';
import { Request } from 'express';

@Injectable()
export class ShopifyHmacGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const hmacHeader = request.get('X-Shopify-Hmac-SHA256');

    if (!hmacHeader) {
      throw new BadRequestException(
        'Header X-Shopify-Hmac-SHA256 ausente. Verifique a configuração do webhook no Shopify.',
      );
    }

    const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
    if (!secret) {
      throw new Error(
        'SHOPIFY_WEBHOOK_SECRET não configurada. Configure a variável de ambiente.',
      );
    }

    const body = request.rawBody || request.body;
    if (!body) {
      throw new BadRequestException('Corpo da requisição vazio.');
    }

    const computed = this.computeHmac(body, secret);
    const isValid = this.constantTimeCompare(computed, hmacHeader);

    if (!isValid) {
      throw new BadRequestException(
        'HMAC inválido. O webhook não vem do Shopify ou o secret está incorreto.',
      );
    }

    return true;
  }

  private computeHmac(body: string | Buffer, secret: string): string {
    const bodyString = typeof body === 'string' ? body : body.toString('utf-8');
    return createHmac('sha256', secret).update(bodyString, 'utf-8').digest('base64');
  }

  private constantTimeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }
}
