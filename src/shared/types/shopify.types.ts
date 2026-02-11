/**
 * Payloads de webhooks do Shopify (orders/* e customers/*).
 */

export interface ShopifyAddress {
  first_name?: string;
  last_name?: string;
  phone?: string;
  company?: string;
  address1?: string;
  city?: string;
  zip?: string;
  province?: string;
  country?: string;
  country_code?: string;
}

export interface ShopifyLineItem {
  id: number;
  title: string;
  name?: string;
  quantity: number;
  price?: string;
  product_id?: number;
  variant_id?: number;
}

export interface ShopifyCustomerRef {
  id: number;
  email?: string;
  first_name?: string;
  last_name?: string;
  phone?: string | null;
  default_address?: ShopifyAddress;
}

export interface ShopifyNoteAttribute {
  name: string;
  value: string;
}

export interface ShopifyOrderPayload {
  id: number;
  admin_graphql_api_id?: string;
  email?: string;
  contact_email?: string;
  phone?: string | null;
  created_at: string;
  updated_at?: string;
  financial_status?: string;
  fulfillment_status?: string | null;
  note?: string | null;
  note_attributes?: ShopifyNoteAttribute[];
  billing_address?: ShopifyAddress;
  shipping_address?: ShopifyAddress;
  customer?: ShopifyCustomerRef;
  line_items?: ShopifyLineItem[];
}

export interface ShopifyCustomerAddress {
  first_name?: string;
  last_name?: string;
  phone?: string;
  address1?: string;
  city?: string;
  zip?: string;
  province?: string;
  country?: string;
  country_code?: string;
}

export interface ShopifyCustomerPayload {
  id: number;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  default_address?: ShopifyCustomerAddress | null;
  note_attributes?: ShopifyNoteAttribute[];
}
