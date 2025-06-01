import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { INestApplication } from "@nestjs/common";

export function setupSwagger(app: INestApplication) {
  const options = new DocumentBuilder()
    .setTitle("TakumiPay API")
    .setDescription("The TakumiPay API documentation")
    .setVersion("1.0")
    .addBearerAuth()
    .addTag("app", "Application information endpoints")
    .build();

  const document = SwaggerModule.createDocument(app, options);
  SwaggerModule.setup("docs", app, document);
}
