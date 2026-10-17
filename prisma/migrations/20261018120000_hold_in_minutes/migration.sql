-- The payout hold period is now kept in minutes, so it can be set in days, hours and minutes.
ALTER TABLE "payout_settings" ADD COLUMN "holdMinutes" INTEGER NOT NULL DEFAULT 2880;
UPDATE "payout_settings" SET "holdMinutes" = "holdDays" * 1440;
ALTER TABLE "payout_settings" DROP COLUMN "holdDays";

ALTER TABLE "professionals" ADD COLUMN "payoutHoldMinutes" INTEGER;
UPDATE "professionals" SET "payoutHoldMinutes" = "payoutHoldDays" * 1440 WHERE "payoutHoldDays" IS NOT NULL;
ALTER TABLE "professionals" DROP COLUMN "payoutHoldDays";
