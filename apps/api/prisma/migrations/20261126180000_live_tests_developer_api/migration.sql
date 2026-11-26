-- AlterTable
ALTER TABLE `Quiz` ADD COLUMN `liveJoinMinutes` INTEGER NULL,
    ADD COLUMN `liveStartsAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `ApiKey` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `prefix` VARCHAR(16) NOT NULL,
    `keyHash` CHAR(64) NOT NULL,
    `scopes` JSON NOT NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `createdById` CHAR(25) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ApiKey_keyHash_key`(`keyHash`),
    INDEX `ApiKey_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    UNIQUE INDEX `ApiKey_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WebhookEndpoint` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `url` VARCHAR(500) NOT NULL,
    `description` VARCHAR(200) NULL,
    `events` JSON NOT NULL,
    `secretEnc` TEXT NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdById` CHAR(25) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `WebhookEndpoint_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    UNIQUE INDEX `WebhookEndpoint_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WebhookDelivery` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `endpointId` CHAR(25) NOT NULL,
    `event` VARCHAR(40) NOT NULL,
    `payload` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `responseStatus` INTEGER NULL,
    `responseBody` VARCHAR(1000) NULL,
    `error` VARCHAR(500) NULL,
    `durationMs` INTEGER NULL,
    `deliveredAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `WebhookDelivery_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    INDEX `WebhookDelivery_tenantId_endpointId_createdAt_idx`(`tenantId`, `endpointId`, `createdAt`),
    UNIQUE INDEX `WebhookDelivery_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `WebhookDelivery` ADD CONSTRAINT `WebhookDelivery_tenantId_endpointId_fkey` FOREIGN KEY (`tenantId`, `endpointId`) REFERENCES `WebhookEndpoint`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

