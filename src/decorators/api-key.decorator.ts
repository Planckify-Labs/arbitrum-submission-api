import { SetMetadata } from "@nestjs/common";

export const IS_API_KEY_REQUIRED = "isApiKeyRequired";
export const ApiKey = () => SetMetadata(IS_API_KEY_REQUIRED, true);
