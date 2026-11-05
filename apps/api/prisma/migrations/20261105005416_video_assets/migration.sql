-- AlterTable
ALTER TABLE `CourseLesson` ADD COLUMN `videoAssetId` CHAR(25) NULL;

-- CreateTable
CREATE TABLE `VideoAsset` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `sourceFileId` CHAR(25) NOT NULL,
    `provider` ENUM('STORAGE') NOT NULL,
    `providerAssetId` VARCHAR(191) NULL,
    `playbackId` VARCHAR(191) NULL,
    `status` ENUM('UPLOADED', 'PROCESSING', 'READY', 'FAILED') NOT NULL DEFAULT 'UPLOADED',
    `protection` ENUM('SIGNED') NOT NULL DEFAULT 'SIGNED',
    `durationSeconds` INTEGER NULL,
    `errorMessage` VARCHAR(500) NULL,
    `createdById` CHAR(25) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `VideoAsset_tenantId_status_createdAt_idx`(`tenantId`, `status`, `createdAt`),
    INDEX `VideoAsset_provider_providerAssetId_idx`(`provider`, `providerAssetId`),
    UNIQUE INDEX `VideoAsset_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VideoPlaybackSession` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `videoAssetId` CHAR(25) NOT NULL,
    `lessonId` CHAR(25) NOT NULL,
    `userId` CHAR(25) NOT NULL,
    `enrollmentId` CHAR(25) NOT NULL,
    `ipHash` CHAR(64) NULL,
    `userAgent` VARCHAR(512) NULL,
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `revokeReason` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `VideoPlaybackSession_tenantId_userId_lastSeenAt_idx`(`tenantId`, `userId`, `lastSeenAt`),
    UNIQUE INDEX `VideoPlaybackSession_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `VideoPlaybackSession` ADD CONSTRAINT `VideoPlaybackSession_tenantId_videoAssetId_fkey` FOREIGN KEY (`tenantId`, `videoAssetId`) REFERENCES `VideoAsset`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
