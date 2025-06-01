import { OmitType } from "@nestjs/swagger";
import { CreateRegionTokenDto } from "./create-region-token.dto";

export class UpdateRegionTokenDto extends OmitType(CreateRegionTokenDto, [
  "tokenId",
] as const) {}
