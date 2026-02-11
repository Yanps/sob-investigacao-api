import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marca a rota (ou controller) como pública: não exige API Key.
 * Use nos webhooks Shopify para que apenas o HMAC seja validado.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
