-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('ONLINE', 'PAY_AFTER_SERVICE');

-- CreateEnum
CREATE TYPE "BookingActor" AS ENUM ('CUSTOMER', 'PROFESSIONAL', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "BookingEventType" AS ENUM ('CREATED', 'PAYMENT_RECEIVED', 'STATUS_CHANGED', 'ASSIGNED', 'RESCHEDULED', 'CANCELLED', 'PAYMENT_COLLECTED', 'REFUNDED');

-- AlterEnum
ALTER TYPE "BookingStatus" ADD VALUE 'AWAITING_PAYMENT';

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'REFUND_PENDING';

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "addressId" TEXT,
ADD COLUMN     "assignedAt" TIMESTAMP(3),
ADD COLUMN     "cancellationReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledBy" "BookingActor",
ADD COLUMN     "cityId" TEXT,
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "contactName" TEXT,
ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "latitude" DECIMAL(9,6),
ADD COLUMN     "longitude" DECIMAL(9,6),
ADD COLUMN     "paymentMode" "PaymentMode" NOT NULL DEFAULT 'PAY_AFTER_SERVICE',
ADD COLUMN     "pincode" TEXT,
ADD COLUMN     "sequence" SERIAL NOT NULL,
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "zoneId" TEXT;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "gatewayPaymentId" TEXT,
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "refundReference" TEXT,
ADD COLUMN     "refundedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "booking_events" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "type" "BookingEventType" NOT NULL,
    "actorId" TEXT,
    "actorRole" "BookingActor" NOT NULL,
    "fromStatus" "BookingStatus",
    "toStatus" "BookingStatus",
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "booking_events_bookingId_createdAt_idx" ON "booking_events"("bookingId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_sequence_key" ON "bookings"("sequence");

-- CreateIndex
CREATE INDEX "bookings_scheduledAt_idx" ON "bookings"("scheduledAt");

-- CreateIndex
CREATE INDEX "bookings_cityId_idx" ON "bookings"("cityId");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

