import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsOptional, IsString, Length, Matches } from "class-validator";

/**
 * Query params for `GET /v1/merchants/channels`.
 *
 * `country` defaults to `"ID"` when omitted (v1 ships Indonesia only);
 * the DTO validator runs *before* the default kicks in, so only a
 * present-but-bogus value is a 400 — a missing param is fine.
 *
 * Case is normalized to upper-case here (matches the stored `country`
 * column shape, `char(2)`). Unknown-but-well-formed codes (e.g. `PH`
 * pre-launch) succeed with an empty array, consistent with the
 * existing `/v1/blockchains?country=` contract. See spec §6.0, §6.1.
 */
export class ListChannelsQueryDto {
  @ApiPropertyOptional({
    description:
      "ISO 3166-1 alpha-2 country code. Defaults to `ID` when omitted — v1 ships Indonesia only; other well-formed codes (e.g. `PH`, `TH`, `MY`, `VN`) currently resolve to an empty array.",
    example: "ID",
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
