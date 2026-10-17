-- DropIndex
DROP INDEX "reviews_bookingId_key";

-- AlterTable
ALTER TABLE "reviews" ADD COLUMN     "authorRole" "BookingActor" NOT NULL DEFAULT 'CUSTOMER',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "reviews_authorRole_createdAt_idx" ON "reviews"("authorRole", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_bookingId_authorRole_key" ON "reviews"("bookingId", "authorRole");

