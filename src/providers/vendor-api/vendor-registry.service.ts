import { Injectable } from "@nestjs/common";
import { BaseVendorService } from "./base/base-vendor.service";
import { VCGamersService } from "./implementations/vcgamers/vcgamers.service";

export class UnsupportedVendorError extends Error {
  constructor(vendorName: string) {
    super(`Unsupported vendor: ${vendorName}`);
    this.name = "UnsupportedVendorError";
  }
}

/**
 * `Vendor.name` → adapter. Order workers and the fulfilment leg resolve
 * the adapter from the order's `productPrice.vendor` and never name a
 * vendor themselves. Adding a PPOB provider = one adapter class + one
 * line here.
 */
@Injectable()
export class VendorRegistry {
  private readonly byName: ReadonlyMap<string, BaseVendorService>;

  constructor(vcGamers: VCGamersService) {
    const adapters: BaseVendorService[] = [vcGamers];
    this.byName = new Map(adapters.map((a) => [a.vendorName, a]));
  }

  get(vendorName: string | null | undefined): BaseVendorService {
    const adapter = vendorName ? this.byName.get(vendorName) : undefined;
    if (!adapter) throw new UnsupportedVendorError(vendorName ?? "(none)");
    return adapter;
  }

  has(vendorName: string | null | undefined): boolean {
    return !!vendorName && this.byName.has(vendorName);
  }
}
