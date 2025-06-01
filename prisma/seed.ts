import { PrismaClient } from "../generated/prisma";

const prisma = new PrismaClient();

async function main() {
  await prisma.products.deleteMany({});
  await prisma.category.deleteMany({});
  await prisma.vendors.deleteMany({});

  const vendors = await Promise.all([
    prisma.vendors.create({
      data: { name: "vcGamer" },
    }),
  ]);

  const categories = await Promise.all([
    prisma.category.create({
      data: { name: "Gaming Top Up" },
    }),
    prisma.category.create({
      data: { name: "Voucher" },
    }),
    prisma.category.create({
      data: { name: "Streaming" },
    }),
    prisma.category.create({
      data: { name: "Pulsa & Data Package" },
    }),
    prisma.category.create({
      data: { name: "E-Wallet" },
    }),
    prisma.category.create({
      data: { name: "PLN" },
    }),
  ]);

  const categoryMap = {
    "Gaming Top Up": categories[0].id,
    Voucher: categories[1].id,
    Streaming: categories[2].id,
    "Pulsa & Data Package": categories[3].id,
    "E-Wallet": categories[4].id,
    PLN: categories[5].id,
  };

  const productData = [
    {
      name: "Voucher Google Play US",
      code: "VOGOP",
      vendorId: vendors[0].id,
      categoryId: categoryMap["Voucher"],
    },
    {
      name: "Voucher Garena Shells",
      code: "VOGS",
      vendorId: vendors[0].id,
      categoryId: categoryMap["Gaming Top Up"],
    },
    {
      name: "BLEACH Mobile 3D",
      code: "VOXGC",
      vendorId: vendors[0].id,
      categoryId: categoryMap["Gaming Top Up"],
    },
    {
      name: "Voucher WeTV VIP",
      code: "WETV",
      vendorId: vendors[0].id,
      categoryId: categoryMap["Streaming"],
    },
    {
      name: "XL",
      code: "XL",
      vendorId: vendors[0].id,
      categoryId: categoryMap["Pulsa & Data Package"],
    },
    {
      name: "Vision Plus",
      code: "VSPL",
      vendorId: vendors[0].id,
      categoryId: categoryMap["Streaming"],
    },
    {
      name: "Dana",
      code: "DANA",
      vendorId: vendors[0].id,
      categoryId: categoryMap["E-Wallet"],
    },
    {
      name: "PLN Prepaid",
      code: "PLN",
      vendorId: vendors[0].id,
      categoryId: categoryMap["PLN"],
    },
  ];

  for (const product of productData) {
    await prisma.products.create({
      data: product,
    });
  }

  console.log("Seed data created successfully");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
