BEGIN;

ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "provinceCode" TEXT;
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "provinceName" TEXT;
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "cityCode" TEXT;
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "cityName" TEXT;
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "districtCode" TEXT;
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "districtName" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "tickets_provinceCode_idx" ON "tickets"("provinceCode");
CREATE INDEX IF NOT EXISTS "tickets_cityCode_idx" ON "tickets"("cityCode");
CREATE INDEX IF NOT EXISTS "tickets_districtCode_idx" ON "tickets"("districtCode");

COMMIT;
