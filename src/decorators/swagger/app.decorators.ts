import { applyDecorators } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";

export function ApiGetHello() {
  return applyDecorators(
    ApiOperation({ summary: "Get hello message" }),
    ApiResponse({
      status: 200,
      description: "Returns a greeting message",
      schema: {
        type: "string",
        example: "Hello World!",
      },
    }),
  );
}
