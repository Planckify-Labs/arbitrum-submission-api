export interface TVendorApiError {
  status?: number;
  message: string;
  responseData?: unknown;
}

export interface TVendorRequestError extends Error {
  status?: number;
  responseData?: unknown;
}

export interface TVendorErrorResponse {
  status?: number;
  message: string;
  responseData?: unknown;
}
