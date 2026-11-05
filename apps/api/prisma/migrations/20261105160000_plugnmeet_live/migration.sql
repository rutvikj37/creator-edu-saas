-- AlterTable
ALTER TABLE `LiveClass` MODIFY `provider` ENUM('LIVEKIT', 'EXTERNAL', 'PLUGNMEET') NOT NULL;

-- CreateTable
CREATE TABLE `LiveRecording` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `sessionId` CHAR(25) NOT NULL,
    `providerRecordingId` VARCHAR(191) NOT NULL,
    `sizeBytes` BIGINT NULL,
    `recordedAt` DATETIME(3) NULL,
    `status` ENUM('IMPORTING', 'READY', 'FAILED') NOT NULL DEFAULT 'IMPORTING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `videoAssetId` CHAR(25) NULL,
    `error` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LiveRecording_tenantId_sessionId_idx`(`tenantId`, `sessionId`),
    INDEX `LiveRecording_status_updatedAt_idx`(`status`, `updatedAt`),
    UNIQUE INDEX `LiveRecording_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `LiveRecording_providerRecordingId_key`(`providerRecordingId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `LiveRecording` ADD CONSTRAINT `LiveRecording_tenantId_sessionId_fkey` FOREIGN KEY (`tenantId`, `sessionId`) REFERENCES `LiveSession`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

