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
  originalError?: {
    status?: number;
    message: string;
    responseData?: unknown;
    type?: string;
  };
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

export interface TVCGamersCustomerData {
  [key: string]: string;
}

export interface TVCGamersOrderParam {
  alias: string;
  key: string;
  value: string;
}

export interface TVCGamersOrderDetail {
  variation_key: string;
  variation_name: string;
  price: number;
  customer_data: TVCGamersCustomerData;
  voucher_code: string;
  order_param: TVCGamersOrderParam[];
}

export interface TVCGamersHistoryStatus {
  status_name: string;
  timestamp: string;
}

export interface TVCGamersOrderStatusData {
  code: string;
  status: number;
  date: string;
  grand_total: number;
  delivery_duration: number;
  ref_id: string;
  detail: TVCGamersOrderDetail;
  history_status: TVCGamersHistoryStatus[];
}

export interface TVCGamersOrderStatusResponse {
  code: number;
  status: string;
  data: TVCGamersOrderStatusData;
}
