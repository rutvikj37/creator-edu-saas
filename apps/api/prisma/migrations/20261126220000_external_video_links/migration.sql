-- AlterTable
ALTER TABLE `VideoAsset` ADD COLUMN `externalUrl` VARCHAR(1000) NULL;

-- AlterTable
ALTER TABLE `VideoAsset` MODIFY `provider` ENUM('STORAGE', 'BUNNY', 'YOUTUBE', 'GOOGLE_DRIVE') NOT NULL;

-- AlterTable
ALTER TABLE `VideoProcessingEvent` MODIFY `provider` ENUM('STORAGE', 'BUNNY', 'YOUTUBE', 'GOOGLE_DRIVE') NOT NULL;

-- DropIndex
DROP INDEX `VideoAsset_provider_providerAssetId_key` ON `VideoAsset`;

-- CreateIndex
CREATE UNIQUE INDEX `VideoAsset_tenantId_provider_providerAssetId_key` ON `VideoAsset`(`tenantId`, `provider`, `providerAssetId`);

-- CreateIndex
CREATE INDEX `VideoAsset_provider_providerAssetId_idx` ON `VideoAsset`(`provider`, `providerAssetId`);
