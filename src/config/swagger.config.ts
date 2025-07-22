import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { INestApplication } from "@nestjs/common";

export function setupSwagger(app: INestApplication) {
  const options = new DocumentBuilder()
    .setTitle("TakumiPay API")
    .setDescription(`
      Welcome to the TakumiPay API documentation.
      
      This API provides endpoints for managing products, variants, prices and other resources in the TakumiPay system.
      
      ## Product Structure
      - Products: Base items (e.g., "Mobile Legends")
      - Product Variants: Specific versions of products (e.g., "60 Diamonds", "120 Diamonds")
      - Product Prices: Vendor-specific pricing for variants
      
      ## Authentication
      Authentication is handled using Sign-In with Ethereum (SIWE).
      1. Get a nonce from \`GET /auth/nonce/{walletAddress}\`
      2. Sign the message with your Ethereum wallet
      3. Verify the signature with \`POST /auth/verify\`
      4. Use the returned JWT token in the Authorization header
      
      **Note: All routes require authentication except:**
      - Authentication routes (/auth/nonce, /auth/verify, /auth/refresh)
      - Purchase routes (/purchases/*)
      
      ## Pagination
      All GET endpoints that return multiple items use cursor-based pagination:
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
    .addBearerAuth({
      type: "http",
      scheme: "bearer",
      bearerFormat: "JWT",
      name: "Authorization",
      description: "Enter JWT token",
      in: "header",
    })
    .addTag("app", "Application information endpoints")
    .addTag(
      "auth",
      "Authentication endpoints using Sign-In with Ethereum (SIWE)",
    )
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
    .addTag("purchases", "Purchase management endpoints (public access)")
    .addTag("api-logs", "API logs management endpoints")
    .addServer("http://localhost:4000", "Local development")
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
