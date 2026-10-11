-- DropForeignKey
ALTER TABLE "addresses" DROP CONSTRAINT "addresses_cityId_fkey";

-- AlterTable
ALTER TABLE "addresses" ALTER COLUMN "cityId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
