-- CreateEnum
CREATE TYPE "WalletEntryType" AS ENUM ('EARNING', 'PAYOUT');

-- CreateEnum
CREATE TYPE "WalletEntryStatus" AS ENUM ('PENDING', 'PAID', 'SETTLED_IN_CASH');

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "completionOtp" TEXT,
ADD COLUMN     "completionOtpAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "completionOtpVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "startOtp" TEXT,
ADD COLUMN     "startOtpAttempts" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "booking_images" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_entries" (
    "id" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "type" "WalletEntryType" NOT NULL,
    "status" "WalletEntryStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(10,2) NOT NULL,
    "grossAmount" DECIMAL(10,2),
    "commission" DECIMAL(10,2),
    "bookingId" TEXT,
    "availableAt" TIMESTAMP(3),
    "payoutId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_payouts" (
    "id" TEXT NOT NULL,
    "sequence" SERIAL NOT NULL,
    "professionalId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "reference" TEXT NOT NULL,
    "note" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "booking_images_bookingId_createdAt_idx" ON "booking_images"("bookingId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_entries_bookingId_key" ON "wallet_entries"("bookingId");

-- CreateIndex
CREATE INDEX "wallet_entries_professionalId_createdAt_idx" ON "wallet_entries"("professionalId", "createdAt");

-- CreateIndex
CREATE INDEX "wallet_entries_professionalId_type_status_idx" ON "wallet_entries"("professionalId", "type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_payouts_sequence_key" ON "vendor_payouts"("sequence");

-- CreateIndex
CREATE INDEX "vendor_payouts_professionalId_createdAt_idx" ON "vendor_payouts"("professionalId", "createdAt");

-- AddForeignKey
ALTER TABLE "booking_images" ADD CONSTRAINT "booking_images_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "professionals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "vendor_payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_payouts" ADD CONSTRAINT "vendor_payouts_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "professionals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

