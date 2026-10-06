-- CreateEnum
CREATE TYPE "VendorOnboardingStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'PENDING_APPROVAL', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "KycDocumentType" AS ENUM ('AADHAAR', 'PAN');

-- CreateEnum
CREATE TYPE "KycDocumentStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "VendorOnboardingAction" AS ENUM ('SUBMITTED', 'RESUBMITTED', 'DOCUMENT_VERIFIED', 'DOCUMENT_REJECTED', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'SUPER_ADMIN';

-- AlterTable
ALTER TABLE "professionals" ADD COLUMN     "addressLine1" TEXT,
ADD COLUMN     "addressLine2" TEXT,
ADD COLUMN     "alternatePhone" TEXT,
ADD COLUMN     "dateOfBirth" DATE,
ADD COLUMN     "emergencyContactName" TEXT,
ADD COLUMN     "emergencyContactPhone" TEXT,
ADD COLUMN     "experienceYears" INTEGER,
ADD COLUMN     "gender" "Gender",
ADD COLUMN     "landmark" TEXT,
ADD COLUMN     "onboardingStatus" "VendorOnboardingStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "pincode" TEXT,
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "professional_documents" (
    "id" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "type" "KycDocumentType" NOT NULL,
    "numberEncrypted" TEXT NOT NULL,
    "numberHash" TEXT NOT NULL,
    "numberLast4" TEXT NOT NULL,
    "nameOnDocument" TEXT,
    "frontFileKey" TEXT NOT NULL,
    "frontFileMime" TEXT NOT NULL,
    "backFileKey" TEXT,
    "backFileMime" TEXT,
    "status" "KycDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "verificationSource" TEXT,
    "verificationRef" TEXT,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "professional_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_onboarding_events" (
    "id" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" "VendorOnboardingAction" NOT NULL,
    "documentType" "KycDocumentType",
    "fromStatus" "VendorOnboardingStatus",
    "toStatus" "VendorOnboardingStatus",
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_onboarding_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "professional_documents_professionalId_type_key" ON "professional_documents"("professionalId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "professional_documents_type_numberHash_key" ON "professional_documents"("type", "numberHash");

-- CreateIndex
CREATE INDEX "vendor_onboarding_events_professionalId_createdAt_idx" ON "vendor_onboarding_events"("professionalId", "createdAt");

-- CreateIndex
CREATE INDEX "professionals_onboardingStatus_idx" ON "professionals"("onboardingStatus");

-- AddForeignKey
ALTER TABLE "professionals" ADD CONSTRAINT "professionals_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professional_documents" ADD CONSTRAINT "professional_documents_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "professionals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professional_documents" ADD CONSTRAINT "professional_documents_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_onboarding_events" ADD CONSTRAINT "vendor_onboarding_events_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "professionals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_onboarding_events" ADD CONSTRAINT "vendor_onboarding_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: professionals that existed before the onboarding flow keep the
-- verification outcome they already had.
UPDATE "professionals"
SET "onboardingStatus" = CASE "kycStatus"
  WHEN 'VERIFIED' THEN 'APPROVED'::"VendorOnboardingStatus"
  WHEN 'REJECTED' THEN 'REJECTED'::"VendorOnboardingStatus"
  WHEN 'IN_REVIEW' THEN 'SUBMITTED'::"VendorOnboardingStatus"
  ELSE 'DRAFT'::"VendorOnboardingStatus"
END;
