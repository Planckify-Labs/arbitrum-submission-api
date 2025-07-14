export interface TVCGamerAPIConfig {
  baseUrl: string;
  apiKey: string;
  apiSecret?: string;
  vendorId: string;
}

export interface TVCgamerResponse<T> {
  success: boolean;
  statusCode: number;
  message: string;
  data?: T;
  error?: string;
}

export interface TVCGamerProduct {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  code: string;
  isActive: boolean;
}

export interface TVCGamerProductVariant {
  key: string;
  variation_name: string;
  brand_name: string;
  price: number;
  is_active: boolean;
  sla: number;
  is_new: boolean;
}

export interface TVCGamerProductVariantResponse {
  code: number;
  status: string;
  data: TVCGamerProductVariant[];
}

export interface TVCGamerOrderRequest {
  brand_key: string;
  variation_key: string;
  price: number;
  data: Array<{ key: string; value: string }>;
  ref_id: string;
  timestamp: string;
}

export interface TVCGamerOrderResponse {
  code: number;
  rc_code: string;
  status: string;
  data: {
    selling_total: number;
    transaction_status: string;
    trx_code: string;
  };
}
