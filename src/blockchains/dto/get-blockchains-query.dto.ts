import { ApiProperty } from "@nestjs/swagger";
import { IsOptional, IsString, Length, Matches } from "class-validator";
import { Transform } from "class-transformer";
import { CursorPaginationDto } from "../../dto/common/pagination.dto";

/**
 * Query params for `GET /blockchains`. Extends the existing cursor-pagination
 * shape so old callers (no `country`) keep working. Spec §6.7 — country gating
 * lives server-side so mobile doesn't hardcode which chains are eligible per
 * jurisdiction.
 */
export class GetBlockchainsQueryDto extends CursorPaginationDto {
  @ApiProperty({
    description:
      "ISO 3166-1 alpha-2 country code of the payer (e.g. `ID` for Indonesia). When provided, the response is narrowed to chains the payer's jurisdiction can actually settle on. Omit for the full list.",
    example: "ID",
    required: false,
  })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  @Matches(/^[A-Za-z]{2}$/, {
    message: "country must be a 2-letter ISO 3166-1 alpha-2 code",
  })
  @Transform(({ value }) =>
    typeof value === "string" ? value.toUpperCase() : value,
  )
  country?: string;
}
