export interface TBookingWithRelations {
  id: string;
  walletAddress: string;
  productVariantId: string;
  customerInfo: Record<string, unknown> | Array<{ key: string; value: string }>;
  payment: {
    tokenAddress: string;
    blockchainNetworkId: string;
    amount: string;
  };
  exchangeRate: { rate: number } | null;
  productVariant: {
    id: string;
    variantCode: string;
    product: {
      id: string;
      code: string;
      name: string;
    };
  };
  productPrice?: {
    sellPrice?: number;
    priceFromVendor?: number;
    vendorId?: string;
    vendor?: {
      id: string;
      name: string;
    };
  };
  blockchain: {
    chainId: number;
    name: string;
  };
  smartContract: {
    address: string;
    name: string;
  };
}
