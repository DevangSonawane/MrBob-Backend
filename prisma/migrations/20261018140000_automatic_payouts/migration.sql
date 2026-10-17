-- CreateEnum
CREATE TYPE "PayoutMode" AS ENUM ('MANUAL', 'AUTOMATIC');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PROCESSING', 'PAID', 'FAILED');

-- AlterTable
ALTER TABLE "payout_settings" ADD COLUMN     "automaticPayouts" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastAutomaticRunOn" DATE;

-- AlterTable
ALTER TABLE "professionals" ADD COLUMN     "razorpayBankFundAccountId" TEXT,
ADD COLUMN     "razorpayContactId" TEXT,
ADD COLUMN     "razorpayUpiFundAccountId" TEXT;

-- AlterTable
ALTER TABLE "vendor_payouts" ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "mode" "PayoutMode" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "processedAt" TIMESTAMP(3),
ADD COLUMN     "providerPayoutId" TEXT,
ADD COLUMN     "status" "PayoutStatus" NOT NULL DEFAULT 'PAID';

