import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { ShopifyHmacGuard } from '../common/guards/shopify-hmac.guard';
import { WebhooksService } from './webhooks.service';
import type {
  ShopifyOrderPayload,
  ShopifyCustomerPayload,
} from '../shared/types/shopify.types';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Public()
  @UseGuards(ShopifyHmacGuard)
  @Post('shopify/order.created')
  async handleOrderCreated(@Body() payload: ShopifyOrderPayload) {
    await this.webhooksService.handleOrderCreated(payload);
    return { success: true };
  }

  @Public()
  @UseGuards(ShopifyHmacGuard)
  @Post('shopify/order.cancelled')
  async handleOrderCancelled(@Body() payload: { id: number }) {
    await this.webhooksService.handleOrderCancelled(payload);
    return { success: true };
  }

  @Public()
  @UseGuards(ShopifyHmacGuard)
  @Post('shopify/order.updated')
  async handleOrderUpdated(@Body() payload: ShopifyOrderPayload) {
    await this.webhooksService.handleOrderUpdated(payload);
    return { success: true };
  }

  @Public()
  @UseGuards(ShopifyHmacGuard)
  @Post('shopify/customer.updated')
  async handleCustomerUpdated(@Body() payload: ShopifyCustomerPayload) {
    await this.webhooksService.handleCustomerUpdated(payload);
    return { success: true };
  }
}
