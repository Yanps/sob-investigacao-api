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
    const path = request.path;
    const hmacHeader = request.get('X-Shopify-Hmac-SHA256');

    console.log(`[Shopify Webhook] 🔍 Validando HMAC para: ${path}`);

    if (!hmacHeader) {
      console.error(`[Shopify Webhook] ❌ Header X-Shopify-Hmac-SHA256 ausente`);
      throw new BadRequestException(
        'Header X-Shopify-Hmac-SHA256 ausente. Verifique a configuração do webhook no Shopify.',
      );
    }

    const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
    if (!secret) {
      console.error(`[Shopify Webhook] ❌ SHOPIFY_WEBHOOK_SECRET não configurada`);
      throw new Error(
        'SHOPIFY_WEBHOOK_SECRET não configurada. Configure a variável de ambiente.',
      );
    }

    const body = (request as any).rawBody || request.body;
    if (!body) {
      console.error(`[Shopify Webhook] ❌ Corpo da requisição vazio`);
      throw new BadRequestException('Corpo da requisição vazio.');
    }

    const computed = this.computeHmac(body, secret);
    const isValid = this.constantTimeCompare(computed, hmacHeader);

    console.log(`[Shopify Webhook] 🔐 HMAC esperado: ${hmacHeader.substring(0, 20)}...`);
    console.log(`[Shopify Webhook] 🔐 HMAC computado: ${computed.substring(0, 20)}...`);

    if (!isValid) {
      console.error(`[Shopify Webhook] ❌ HMAC inválido para ${path}`);
      throw new BadRequestException(
        'HMAC inválido. O webhook não vem do Shopify ou o secret está incorreto.',
      );
    }

    console.log(`[Shopify Webhook] ✅ HMAC validado com sucesso`);
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
