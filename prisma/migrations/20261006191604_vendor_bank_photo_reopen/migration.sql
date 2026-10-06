-- CreateEnum
CREATE TYPE "BankAccountType" AS ENUM ('SAVINGS', 'CURRENT');

-- AlterEnum
ALTER TYPE "KycDocumentType" ADD VALUE 'BANK_ACCOUNT';

-- AlterEnum
ALTER TYPE "VendorOnboardingAction" ADD VALUE 'REOPENED';

-- AlterTable
ALTER TABLE "professional_documents" ADD COLUMN     "accountType" "BankAccountType",
ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "branchName" TEXT,
ADD COLUMN     "ifsc" TEXT,
ADD COLUMN     "upiId" TEXT;

-- AlterTable
ALTER TABLE "professionals" ADD COLUMN     "profilePhotoKey" TEXT,
ADD COLUMN     "profilePhotoMime" TEXT;
