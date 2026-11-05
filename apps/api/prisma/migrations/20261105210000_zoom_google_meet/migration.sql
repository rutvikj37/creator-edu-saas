-- AlterTable
ALTER TABLE `LiveClass` MODIFY `provider` ENUM('LIVEKIT', 'EXTERNAL', 'PLUGNMEET', 'ZOOM', 'GOOGLE_MEET') NOT NULL;

-- AlterTable
ALTER TABLE `LiveSession` ADD COLUMN `providerJoinUrl` VARCHAR(1000) NULL,
    ADD COLUMN `providerMeetingId` VARCHAR(191) NULL,
    ADD COLUMN `providerPassword` VARCHAR(64) NULL,
    ADD COLUMN `providerSyncError` VARCHAR(300) NULL;

-- CreateTable
CREATE TABLE `LiveIntegration` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `provider` ENUM('ZOOM', 'GOOGLE_MEET') NOT NULL,
    `status` ENUM('CONNECTED', 'ERROR', 'REVOKED') NOT NULL DEFAULT 'CONNECTED',
    `accountEmail` VARCHAR(191) NULL,
    `externalUserId` VARCHAR(191) NULL,
    `externalAccountId` VARCHAR(191) NULL,
    `accessTokenEnc` TEXT NULL,
    `refreshTokenEnc` TEXT NOT NULL,
    `tokenExpiresAt` DATETIME(3) NULL,
    `scopes` VARCHAR(1000) NULL,
    `lastError` VARCHAR(500) NULL,
    `connectedById` CHAR(25) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LiveIntegration_provider_externalUserId_idx`(`provider`, `externalUserId`),
    UNIQUE INDEX `LiveIntegration_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `LiveIntegration_tenantId_provider_key`(`tenantId`, `provider`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LiveSessionRegistrant` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `sessionId` CHAR(25) NOT NULL,
    `identity` VARCHAR(64) NOT NULL,
    `registrantId` VARCHAR(191) NOT NULL,
    `joinUrl` VARCHAR(1000) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LiveSessionRegistrant_registrantId_idx`(`registrantId`),
    UNIQUE INDEX `LiveSessionRegistrant_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `LiveSessionRegistrant_tenantId_sessionId_identity_key`(`tenantId`, `sessionId`, `identity`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `LiveSession_providerMeetingId_idx` ON `LiveSession`(`providerMeetingId`);

