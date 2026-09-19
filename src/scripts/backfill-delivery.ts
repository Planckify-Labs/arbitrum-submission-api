/**
 * Re-parse every stored `deliveryRaw` into `delivery` with the current
 * parser tiers. Run after adding a code parser or a product template so
 * old orders get the structured view too. Idempotent; never touches
 * status columns.
 *
 *   pnpm backfill:delivery              # all rows with deliveryRaw
 *   pnpm backfill:delivery -- PLN       # one product code
 */
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";
import { DeliveryParserService } from "../delivery/delivery-parser.service";
import {
  isVoucherTemplate,
  resolveDeliveryType,
} from "../delivery/delivery.types";
import { Prisma } from "@generated/prisma";

const BATCH = 200;

async function main() {
  const onlyCode = process.argv[2];
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });
  const prisma = app.get(PrismaService);
  const parser = app.get(DeliveryParserService);

  const productWhere = onlyCode ? { product: { code: onlyCode } } : {};
  let purchases = 0;
  let redemptions = 0;

  for (let cursor: string | undefined; ; ) {
    const rows = await prisma.purchase.findMany({
      where: { deliveryRaw: { not: null }, productVariant: productWhere },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      include: {
        bookingOrder: { select: { customerInfo: true } },
        productVariant: {
          select: {
            product: {
              select: {
                code: true,
                isVoucher: true,
                deliveryType: true,
                voucherTemplate: true,
              },
            },
          },
        },
      },
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      const product = row.productVariant.product;
      const delivery = parser.parse({
        productCode: product.code,
        deliveryType: resolveDeliveryType(product),
        raw: row.deliveryRaw,
        template: isVoucherTemplate(product.voucherTemplate)
          ? product.voucherTemplate
          : null,
        customerInfo: row.bookingOrder.customerInfo,
      });
      await prisma.purchase.update({
        where: { id: row.id },
        data: { delivery: delivery as unknown as Prisma.InputJsonValue },
      });
      purchases++;
    }
    cursor = rows[rows.length - 1].id;
  }

  for (let cursor: string | undefined; ; ) {
    const rows = await prisma.pointRedemption.findMany({
      where: { deliveryRaw: { not: null }, productVariant: productWhere },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      include: {
        productVariant: {
          select: {
            product: {
              select: {
                code: true,
                isVoucher: true,
                deliveryType: true,
                voucherTemplate: true,
              },
            },
          },
        },
      },
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      const product = row.productVariant.product;
      const delivery = parser.parse({
        productCode: product.code,
        deliveryType: resolveDeliveryType(product),
        raw: row.deliveryRaw,
        template: isVoucherTemplate(product.voucherTemplate)
          ? product.voucherTemplate
          : null,
        customerInfo: row.customerInfo,
      });
      await prisma.pointRedemption.update({
        where: { id: row.id },
        data: { delivery: delivery as unknown as Prisma.InputJsonValue },
      });
      redemptions++;
    }
    cursor = rows[rows.length - 1].id;
  }

  console.log(
    `Re-parsed ${purchases} purchases and ${redemptions} redemptions${onlyCode ? ` for ${onlyCode}` : ""}.`,
  );
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
