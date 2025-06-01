import { PartialType } from "@nestjs/swagger";
import { CreateSmartContractDto } from "./create-smart-contract.dto";

export class UpdateSmartContractDto extends PartialType(
  CreateSmartContractDto,
) {}
