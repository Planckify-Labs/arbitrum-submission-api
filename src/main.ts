import { setDefaultResultOrder } from "node:dns";
import { setDefaultAutoSelectFamily } from "node:net";
// Prefer IPv4 records on DNS lookup. Some hosts (Cloudflare-fronted APIs like
// DeFiLlama / api.llama.fi) advertise AAAA records that the deploy host may
// not be able to reach if its egress lacks IPv6 routing — Node's default
// (`verbatim`, since v17) then surfaces the IPv6 address first and `fetch`
// fails with the generic `TypeError: fetch failed` (cause: ENETUNREACH).
// Setting this before any module-level DNS lookup keeps outbound HTTP working
// on IPv4-only egress without disabling IPv6 entirely (Node still falls back
// to AAAA when no A record exists). Equivalent to running with
// NODE_OPTIONS=--dns-result-order=ipv4first.
setDefaultResultOrder("ipv4first");

// …and turn OFF happy-eyeballs, because `ipv4first` alone does NOT fix this on
// Node 20+.
//
// `setDefaultResultOrder` only changes the ORDER lookups come back in. Node 20
// made `autoSelectFamily` default-true, so `fetch` still RACES an IPv4 and an
// IPv6 connect regardless of that order. When the host's IPv6 egress is
// blackholed — packets are dropped rather than refused — the IPv6 attempt hangs
// instead of erroring, and the race can lose the whole request even though IPv4
// was reachable the entire time. The result is an intermittent
// `ETIMEDOUT` / `TypeError: fetch failed`, which is far worse than a consistent
// one because it looks like the remote API being flaky.
//
// Measured on this stack, 2026-08-21, against api.llama.fi (Cloudflare, real
// AAAA records):
//   node                                     → ETIMEDOUT after 578ms
//   node --no-network-family-autoselection   → HTTP 200 after 1370ms
// Same for yields.llama.fi, api.morpho.org and ydaemon.yearn.fi — i.e. every
// DeFi discovery endpoint. Each failure is swallowed as "no candidate", so the
// pool degrades to Manual and nothing anywhere says why: the scoring worker
// resolved 48 EVM deposit targets while the dry run, run with this flag,
// resolved 217 against identical chain state.
setDefaultAutoSelectFamily(false);

import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { setupSwagger } from "./config/swagger.config";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import helmet from "helmet";
import * as compression from "compression";
import { getAppConfig } from "./config/app.config";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
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
