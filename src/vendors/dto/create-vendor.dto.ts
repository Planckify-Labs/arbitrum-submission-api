import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";

export class CreateVendorDto {
  @ApiProperty({ example: "Vendor Name" })
  @IsNotEmpty()
  @IsString()
  name: string;
}
