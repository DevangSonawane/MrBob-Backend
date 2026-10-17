-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "sequence" SERIAL NOT NULL,
    "bookingId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoices_sequence_key" ON "invoices"("sequence");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_bookingId_key" ON "invoices"("bookingId");

-- CreateIndex
CREATE INDEX "invoices_issuedAt_idx" ON "invoices"("issuedAt");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Invoices for bookings already completed, numbered in the order they were completed.
INSERT INTO "invoices" ("id", "bookingId", "amount", "issuedAt")
SELECT gen_random_uuid(), "id", COALESCE("price", 0), COALESCE("completedAt", "updatedAt")
FROM "bookings"
WHERE "status" = 'COMPLETED'
ORDER BY COALESCE("completedAt", "updatedAt");
