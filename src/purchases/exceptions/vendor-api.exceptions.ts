import {
  HttpException,
  HttpStatus,
  BadGatewayException,
  ServiceUnavailableException,
  UnauthorizedException,
  BadRequestException,
} from "@nestjs/common";

interface VendorErrorDetails {
  status?: number;
  message: string;
  responseData?: unknown;
  type?: string;
}

export class VendorApiException extends HttpException {
  constructor(
    message: string,
    status: HttpStatus,
    public readonly vendorError?: VendorErrorDetails,
  ) {
    super(message, status);
  }
}

export class VendorServiceUnavailableException extends ServiceUnavailableException {
  constructor(message = "Vendor service temporarily unavailable") {
    super(message);
  }
}

export class VendorBadGatewayException extends BadGatewayException {
  constructor(message = "Invalid vendor response") {
    super(message);
  }
}

export class VendorUnauthorizedException extends UnauthorizedException {
  constructor(message = "Vendor authentication failed") {
    super(message);
  }
}

export class VendorRateLimitException extends HttpException {
  constructor(message = "Vendor rate limit exceeded") {
    super(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}

export class VendorOrderNotTrackableException extends BadRequestException {
  constructor(
    message = "Order cannot be tracked - missing vendor reference ID",
  ) {
    super(message);
  }
}

export function mapVendorErrorToException(
  statusCode: number,
  message: string,
  originalError?: VendorErrorDetails,
): HttpException {
  switch (statusCode) {
    case 401:
      return new VendorUnauthorizedException(message);
    case 429:
      return new VendorRateLimitException(message);
    case 502:
      return new VendorBadGatewayException(message);
    case 503:
      return new VendorServiceUnavailableException(message);
    default:
      return new VendorApiException(message, statusCode, originalError);
  }
}
