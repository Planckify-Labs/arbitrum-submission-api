// Outbound-network defaults (IPv4-first + happy-eyeballs off). MUST stay
// above every other import: it is side-effecting and has to run before any
// module-level DNS lookup. The full rationale and the measurements live in
// the module itself.
import "./config/egress-network";

import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import * as compression from "compression";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { getAppConfig } from "./config/app.config";
import { setupSwagger } from "./config/swagger.config";

async function bootstrap() {
  // `rawBody`: the WalletConnect push endpoint verifies the relay's
  // Ed25519 signature over the exact request bytes (see
  // walletconnect-push/relay-signature.service.ts).
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const configService = app.get(ConfigService);
  const appConfig = getAppConfig(configService);

  // Gzip compression — reduces response payload by ~70% for JSON
  app.use(compression());

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );

  app.enableCors({
    origin: appConfig.corsOrigins,
    credentials: appConfig.corsCredentials,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-API-Key"],
    exposedHeaders: ["X-Total-Count", "X-Rate-Limit-Remaining"],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  setupSwagger(app);

  await app.listen(appConfig.port);

  console.log(`Application is running on: http://localhost:${appConfig.port}`);
  console.log(`Swagger documentation: http://localhost:${appConfig.port}/docs`);
  console.log(`Environment: ${appConfig.nodeEnv}`);
  console.log(`CORS Origins: ${appConfig.corsOrigins.join(", ")}`);
}
bootstrap();
