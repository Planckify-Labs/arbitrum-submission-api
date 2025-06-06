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
      
      ## Pagination
      All GET endpoints that return multiple items (e.g. /products, /transactions, /purchases) use cursor-based pagination:
      - \`take\`: Controls how many items to return in one response (default: 10)
      - \`cursor\`: Pass the ID of the last item you received to get the next page of results
      
      Example: 
      1. First request: \`GET /products?take=10\`
      2. Next page: \`GET /products?take=10&cursor=last_item_id\`
      
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
    .addTag(
      "bookings",
      "Booking management endpoints for pre-transaction order reservations",
    )
    .addTag("users", "User management endpoints")
    .addTag("vendors", "Vendor management endpoints")
    .addTag("transactions", "Transaction management endpoints")
    .addTag("purchases", "Purchase management endpoints")
    .addTag("api-logs", "API logs management endpoints")
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
