-- CreateEnum
CREATE TYPE "JobOfferStatus" AS ENUM ('OFFERED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "openToAllAt" TIMESTAMP(3),
ADD COLUMN     "dispatchWave" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "h3Cell" TEXT;

-- AlterTable
ALTER TABLE "professionals" ADD COLUMN     "h3Cell" TEXT,
ADD COLUMN     "isOnline" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastLatitude" DECIMAL(9,6),
ADD COLUMN     "lastLongitude" DECIMAL(9,6),
ADD COLUMN     "lastSeenAt" TIMESTAMP(3),
ADD COLUMN     "onlineSince" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "job_offers" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "wave" INTEGER NOT NULL,
    "distanceKm" DECIMAL(6,2),
    "status" "JobOfferStatus" NOT NULL DEFAULT 'OFFERED',
    "offeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "job_offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_offers_professionalId_status_idx" ON "job_offers"("professionalId", "status");

-- CreateIndex
CREATE INDEX "job_offers_status_expiresAt_idx" ON "job_offers"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "job_offers_bookingId_professionalId_key" ON "job_offers"("bookingId", "professionalId");

-- CreateIndex
CREATE INDEX "professionals_isOnline_h3Cell_idx" ON "professionals"("isOnline", "h3Cell");

-- AddForeignKey
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "professionals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

