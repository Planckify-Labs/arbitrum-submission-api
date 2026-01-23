-- CreateTable
CREATE TABLE "AddressBook" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "ensName" TEXT,
    "notes" TEXT,
    "isEvm" BOOLEAN NOT NULL DEFAULT true,
    "chainName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AddressBook_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AddressBook_userId_idx" ON "AddressBook"("userId");

-- CreateIndex
CREATE INDEX "AddressBook_userId_label_idx" ON "AddressBook"("userId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "AddressBook_userId_address_key" ON "AddressBook"("userId", "address");

-- AddForeignKey
ALTER TABLE "AddressBook" ADD CONSTRAINT "AddressBook_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
