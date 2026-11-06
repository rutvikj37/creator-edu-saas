-- AlterTable
ALTER TABLE `Order` ADD COLUMN `attribution` JSON NULL;

-- CreateTable
CREATE TABLE `AnalyticsEvent` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `type` VARCHAR(24) NOT NULL,
    `path` VARCHAR(255) NOT NULL,
    `itemType` VARCHAR(16) NULL,
    `itemId` CHAR(25) NULL,
    `visitorId` VARCHAR(40) NOT NULL,
    `userId` CHAR(25) NULL,
    `utmSource` VARCHAR(100) NULL,
    `utmMedium` VARCHAR(100) NULL,
    `utmCampaign` VARCHAR(150) NULL,
    `referrerHost` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AnalyticsEvent_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    INDEX `AnalyticsEvent_tenantId_type_createdAt_idx`(`tenantId`, `type`, `createdAt`),
    INDEX `AnalyticsEvent_tenantId_itemId_createdAt_idx`(`tenantId`, `itemId`, `createdAt`),
    UNIQUE INDEX `AnalyticsEvent_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

