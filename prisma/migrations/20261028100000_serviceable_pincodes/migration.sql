-- CreateTable
CREATE TABLE "serviceable_pincodes" (
    "id" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "zoneId" TEXT,
    "areaName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "serviceable_pincodes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "serviceable_pincodes_pincode_key" ON "serviceable_pincodes"("pincode");

-- CreateIndex
CREATE INDEX "serviceable_pincodes_cityId_idx" ON "serviceable_pincodes"("cityId");

-- CreateIndex
CREATE INDEX "serviceable_pincodes_zoneId_idx" ON "serviceable_pincodes"("zoneId");

-- AddForeignKey
ALTER TABLE "serviceable_pincodes" ADD CONSTRAINT "serviceable_pincodes_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "serviceable_pincodes" ADD CONSTRAINT "serviceable_pincodes_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

