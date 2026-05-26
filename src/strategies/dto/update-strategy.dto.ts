import { PartialType } from "@nestjs/swagger";
import { CreateStrategyDto } from "./create-strategy.dto";

export class UpdateStrategyDto extends PartialType(CreateStrategyDto) {}
