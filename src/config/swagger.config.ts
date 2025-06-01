import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { INestApplication } from "@nestjs/common";

export function setupSwagger(app: INestApplication) {
  const options = new DocumentBuilder()
    .setTitle("TakumiPay API")
    .setDescription(`
      Welcome to the TakumiPay API documentation.
      
      This API provides endpoints for managing products and other resources in the TakumiPay system.
      
      ## Authentication
      Most endpoints require Bearer token authentication.
      
      ## Rate Limiting
      API calls are subject to rate limiting.
      
      ## Support
      For support, please contact our team.
    `)
    .setVersion("1.0")
    .setContact(
      "TakumiPay Team",
      "https://takumipay.com",
      "support@takumipay.com",
    )
    .setLicense("Proprietary", "https://takumipay.com/license")
    .addBearerAuth()
    .addTag("app", "Application information endpoints")
    .addTag("products", "Product management endpoints")
    .addTag("tokens", "Token management endpoints")
    .addTag("regions", "Region management endpoints")
    .addTag("blockchains", "Blockchain management endpoints")
    .addTag("smart-contracts", "Smart contract management endpoints")
    .addServer("http://localhost:3000", "Local development")
    .addServer("https://api.takumipay.com", "Production")
    .build();

  const document = SwaggerModule.createDocument(app, options);

  SwaggerModule.setup("docs", app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: "none",
      filter: true,
      showRequestDuration: true,
    },
    customSiteTitle: "TakumiPay API Documentation",
  });
}
