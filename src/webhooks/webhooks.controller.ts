import { Controller, Post, Body } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { WebhooksService } from './webhooks.service';
import type {
  ShopifyOrderPayload,
  ShopifyCustomerPayload,
} from '../shared/types/shopify.types';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Public()
  // @UseGuards(ShopifyHmacGuard) // TODO: Implementar validação HMAC quando chave estiver configurada no Shopify
  @Post('shopify/order.created')
  async handleOrderCreated(@Body() payload: ShopifyOrderPayload) {
    console.log(`[Shopify] 📦 order.created recebido - Order ID: ${payload.id}, Email: ${payload.email}`);
    try {
      await this.webhooksService.handleOrderCreated(payload);
      console.log(`[Shopify] ✅ order.created processado com sucesso - Order ID: ${payload.id}`);
      return { success: true };
    } catch (error) {
      console.error(`[Shopify] ❌ Erro ao processar order.created - Order ID: ${payload.id}`, error);
      throw error;
    }
  }

  @Public()
  // @UseGuards(ShopifyHmacGuard) // TODO: Implementar validação HMAC quando chave estiver configurada no Shopify
  @Post('shopify/order.approved')
  async handleOrderApproved(@Body() payload: ShopifyOrderPayload) {
    console.log(`[Shopify] ✨ order.approved recebido - Order ID: ${payload.id}, Email: ${payload.email}`);
    try {
      await this.webhooksService.handleOrderApproved(payload);
      console.log(`[Shopify] ✅ order.approved processado com sucesso - Order ID: ${payload.id}`);
      return { success: true };
    } catch (error) {
      console.error(`[Shopify] ❌ Erro ao processar order.approved - Order ID: ${payload.id}`, error);
      throw error;
    }
  }

  @Public()
  // @UseGuards(ShopifyHmacGuard) // TODO: Implementar validação HMAC quando chave estiver configurada no Shopify
  @Post('shopify/order.cancelled')
  async handleOrderCancelled(@Body() payload: { id: number }) {
    console.log(`[Shopify] 🚫 order.cancelled recebido - Order ID: ${payload.id}`);
    try {
      await this.webhooksService.handleOrderCancelled(payload);
      console.log(`[Shopify] ✅ order.cancelled processado com sucesso - Order ID: ${payload.id}`);
      return { success: true };
    } catch (error) {
      console.error(`[Shopify] ❌ Erro ao processar order.cancelled - Order ID: ${payload.id}`, error);
      throw error;
    }
  }

  @Public()
  // @UseGuards(ShopifyHmacGuard) // TODO: Implementar validação HMAC quando chave estiver configurada no Shopify
  @Post('shopify/order.updated')
  async handleOrderUpdated(@Body() payload: ShopifyOrderPayload) {
    console.log(`[Shopify] 📝 order.updated recebido - Order ID: ${payload.id}, Email: ${payload.email}`);
    try {
      await this.webhooksService.handleOrderUpdated(payload);
      console.log(`[Shopify] ✅ order.updated processado com sucesso - Order ID: ${payload.id}`);
      return { success: true };
    } catch (error) {
      console.error(`[Shopify] ❌ Erro ao processar order.updated - Order ID: ${payload.id}`, error);
      throw error;
    }
  }

  @Public()
  // @UseGuards(ShopifyHmacGuard) // TODO: Implementar validação HMAC quando chave estiver configurada no Shopify
  @Post('shopify/customer.updated')
  async handleCustomerUpdated(@Body() payload: ShopifyCustomerPayload) {
    console.log(`[Shopify] 👤 customer.updated recebido - Customer ID: ${payload.id}, Email: ${payload.email}`);
    try {
      await this.webhooksService.handleCustomerUpdated(payload);
      console.log(`[Shopify] ✅ customer.updated processado com sucesso - Customer ID: ${payload.id}`);
      return { success: true };
    } catch (error) {
      console.error(`[Shopify] ❌ Erro ao processar customer.updated - Customer ID: ${payload.id}`, error);
      throw error;
    }
  }
}
