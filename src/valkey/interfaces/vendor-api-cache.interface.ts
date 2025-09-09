export interface VendorAPICache {
  id: string;
  vendorId: string;
  baseUrl: string;
  apiKey: string;
  apiSecret: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface VendorAPICacheKey {
  vendorId: string;
}
