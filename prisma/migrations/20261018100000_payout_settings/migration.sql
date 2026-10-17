-- CreateEnum
CREATE TYPE "PayoutMethod" AS ENUM ('BANK_TRANSFER', 'UPI', 'CASH');

-- CreateEnum
CREATE TYPE "PayoutFrequency" AS ENUM ('AFTER_HOLD', 'WEEKLY', 'BIWEEKLY', 'MONTHLY');

-- AlterTable
ALTER TABLE "professionals" ADD COLUMN     "commissionPercent" DECIMAL(5,2),
ADD COLUMN     "payoutHoldDays" INTEGER,
ADD COLUMN     "payoutMethod" "PayoutMethod";

-- AlterTable
ALTER TABLE "vendor_payouts" ADD COLUMN     "method" "PayoutMethod" NOT NULL DEFAULT 'BANK_TRANSFER';

-- CreateTable
CREATE TABLE "payout_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "holdDays" INTEGER NOT NULL DEFAULT 2,
    "commissionPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "payoutMethod" "PayoutMethod" NOT NULL DEFAULT 'BANK_TRANSFER',
    "frequency" "PayoutFrequency" NOT NULL DEFAULT 'AFTER_HOLD',
    "firstPayoutDate" DATE,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payout_settings_pkey" PRIMARY KEY ("id")
);

