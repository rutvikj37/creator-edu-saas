-- DropIndex
DROP INDEX `VideoAsset_provider_providerAssetId_idx` ON `VideoAsset`;

-- AlterTable
ALTER TABLE `VideoAsset` ADD COLUMN `availableResolutions` VARCHAR(255) NULL,
    ADD COLUMN `courseId` CHAR(25) NULL,
    ADD COLUMN `encodeProgress` INTEGER NULL,
    ADD COLUMN `height` INTEGER NULL,
    ADD COLUMN `lastSyncedAt` DATETIME(3) NULL,
    ADD COLUMN `lessonId` CHAR(25) NULL,
    ADD COLUMN `mimeType` VARCHAR(127) NULL,
    ADD COLUMN `originalFilename` VARCHAR(255) NULL,
    ADD COLUMN `originalHash` VARCHAR(128) NULL,
    ADD COLUMN `originalSize` BIGINT NULL,
    ADD COLUMN `processingRound` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `processingStartedAt` DATETIME(3) NULL,
    ADD COLUMN `providerStatus` INTEGER NULL,
    ADD COLUMN `readyAt` DATETIME(3) NULL,
    ADD COLUMN `storageSize` BIGINT NULL,
    ADD COLUMN `thumbnailUrl` VARCHAR(1024) NULL,
    ADD COLUMN `width` INTEGER NULL,
    MODIFY `sourceFileId` CHAR(25) NULL,
    MODIFY `provider` ENUM('STORAGE', 'BUNNY') NOT NULL,
    MODIFY `status` ENUM('CREATED', 'UPLOAD_AUTHORIZED', 'UPLOADING', 'UPLOADED', 'PROCESSING', 'READY', 'FAILED', 'DELETING', 'DELETED') NOT NULL DEFAULT 'UPLOADED',
    MODIFY `protection` ENUM('SIGNED', 'TOKEN') NOT NULL DEFAULT 'SIGNED';

-- AlterTable
ALTER TABLE `VideoPlaybackSession` ADD COLUMN `sessionTokenHash` CHAR(64) NULL;

-- CreateTable
CREATE TABLE `VideoStatusHistory` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `videoAssetId` CHAR(25) NOT NULL,
    `fromStatus` ENUM('CREATED', 'UPLOAD_AUTHORIZED', 'UPLOADING', 'UPLOADED', 'PROCESSING', 'READY', 'FAILED', 'DELETING', 'DELETED') NULL,
    `toStatus` ENUM('CREATED', 'UPLOAD_AUTHORIZED', 'UPLOADING', 'UPLOADED', 'PROCESSING', 'READY', 'FAILED', 'DELETING', 'DELETED') NOT NULL,
    `source` VARCHAR(16) NOT NULL,
    `reason` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `VideoStatusHistory_tenantId_videoAssetId_createdAt_idx`(`tenantId`, `videoAssetId`, `createdAt`),
    UNIQUE INDEX `VideoStatusHistory_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VideoUploadSession` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `videoAssetId` CHAR(25) NOT NULL,
    `uploadStatus` ENUM('AUTHORIZED', 'UPLOADING', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED') NOT NULL DEFAULT 'AUTHORIZED',
    `attempt` INTEGER NOT NULL DEFAULT 1,
    `authorizationExpiresAt` DATETIME(3) NOT NULL,
    `uploadStartedAt` DATETIME(3) NULL,
    `uploadCompletedAt` DATETIME(3) NULL,
    `errorMessage` VARCHAR(500) NULL,
    `createdById` CHAR(25) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `VideoUploadSession_tenantId_videoAssetId_createdAt_idx`(`tenantId`, `videoAssetId`, `createdAt`),
    INDEX `VideoUploadSession_uploadStatus_authorizationExpiresAt_idx`(`uploadStatus`, `authorizationExpiresAt`),
    UNIQUE INDEX `VideoUploadSession_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VideoProcessingEvent` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `videoAssetId` CHAR(25) NOT NULL,
    `provider` ENUM('STORAGE', 'BUNNY') NOT NULL,
    `providerEventId` VARCHAR(191) NOT NULL,
    `eventType` VARCHAR(64) NOT NULL,
    `eventPayload` JSON NOT NULL,
    `result` VARCHAR(255) NULL,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processedAt` DATETIME(3) NULL,

    INDEX `VideoProcessingEvent_tenantId_videoAssetId_receivedAt_idx`(`tenantId`, `videoAssetId`, `receivedAt`),
    UNIQUE INDEX `VideoProcessingEvent_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `VideoProcessingEvent_provider_providerEventId_key`(`provider`, `providerEventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VideoBackup` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `videoAssetId` CHAR(25) NOT NULL,
    `provider` ENUM('GOOGLE_DRIVE') NOT NULL,
    `status` ENUM('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'RETRYING') NOT NULL DEFAULT 'PENDING',
    `driveFileId` VARCHAR(191) NULL,
    `metadataFileId` VARCHAR(191) NULL,
    `backupFilename` VARCHAR(255) NOT NULL,
    `backupSize` BIGINT NULL,
    `originalSize` BIGINT NULL,
    `checksum` VARCHAR(64) NULL,
    `encryptedMd5` VARCHAR(32) NULL,
    `encryption` JSON NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `errorMessage` VARCHAR(500) NULL,
    `restoreStatus` ENUM('NONE', 'IN_PROGRESS', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'NONE',
    `restoredAt` DATETIME(3) NULL,
    `restoreError` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `VideoBackup_status_updatedAt_idx`(`status`, `updatedAt`),
    UNIQUE INDEX `VideoBackup_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `VideoBackup_tenantId_videoAssetId_key`(`tenantId`, `videoAssetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DocumentBackup` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `fileAssetId` CHAR(25) NOT NULL,
    `courseId` CHAR(25) NULL,
    `provider` ENUM('GOOGLE_DRIVE') NOT NULL,
    `status` ENUM('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'RETRYING') NOT NULL DEFAULT 'PENDING',
    `driveFileId` VARCHAR(191) NULL,
    `backupFilename` VARCHAR(255) NOT NULL,
    `backupSize` BIGINT NULL,
    `originalSize` BIGINT NULL,
    `checksum` VARCHAR(64) NULL,
    `encryptedMd5` VARCHAR(32) NULL,
    `encryption` JSON NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `errorMessage` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DocumentBackup_status_updatedAt_idx`(`status`, `updatedAt`),
    UNIQUE INDEX `DocumentBackup_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `DocumentBackup_tenantId_fileAssetId_key`(`tenantId`, `fileAssetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VideoUsageRecord` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `videoAssetId` CHAR(25) NOT NULL,
    `billingPeriod` CHAR(7) NOT NULL,
    `storageBytes` BIGINT NOT NULL DEFAULT 0,
    `deliveryBytes` BIGINT NOT NULL DEFAULT 0,
    `watchSeconds` BIGINT NOT NULL DEFAULT 0,
    `views` INTEGER NOT NULL DEFAULT 0,
    `deliverySource` VARCHAR(32) NOT NULL DEFAULT 'NONE',
    `recordedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `VideoUsageRecord_tenantId_billingPeriod_idx`(`tenantId`, `billingPeriod`),
    UNIQUE INDEX `VideoUsageRecord_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `VideoUsageRecord_videoAssetId_billingPeriod_key`(`videoAssetId`, `billingPeriod`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `VideoAsset_status_updatedAt_idx` ON `VideoAsset`(`status`, `updatedAt`);

-- CreateIndex
CREATE INDEX `VideoAsset_tenantId_courseId_idx` ON `VideoAsset`(`tenantId`, `courseId`);

-- CreateIndex
CREATE UNIQUE INDEX `VideoAsset_provider_providerAssetId_key` ON `VideoAsset`(`provider`, `providerAssetId`);

-- AddForeignKey
ALTER TABLE `VideoStatusHistory` ADD CONSTRAINT `VideoStatusHistory_tenantId_videoAssetId_fkey` FOREIGN KEY (`tenantId`, `videoAssetId`) REFERENCES `VideoAsset`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VideoUploadSession` ADD CONSTRAINT `VideoUploadSession_tenantId_videoAssetId_fkey` FOREIGN KEY (`tenantId`, `videoAssetId`) REFERENCES `VideoAsset`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VideoProcessingEvent` ADD CONSTRAINT `VideoProcessingEvent_tenantId_videoAssetId_fkey` FOREIGN KEY (`tenantId`, `videoAssetId`) REFERENCES `VideoAsset`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VideoBackup` ADD CONSTRAINT `VideoBackup_tenantId_videoAssetId_fkey` FOREIGN KEY (`tenantId`, `videoAssetId`) REFERENCES `VideoAsset`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VideoUsageRecord` ADD CONSTRAINT `VideoUsageRecord_tenantId_videoAssetId_fkey` FOREIGN KEY (`tenantId`, `videoAssetId`) REFERENCES `VideoAsset`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

