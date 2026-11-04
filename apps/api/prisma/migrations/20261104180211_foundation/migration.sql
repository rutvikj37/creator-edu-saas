-- CreateTable
CREATE TABLE `PlatformSetting` (
    `id` CHAR(25) NOT NULL,
    `group` VARCHAR(64) NOT NULL,
    `key` VARCHAR(128) NOT NULL,
    `value` JSON NOT NULL,
    `isSecret` BOOLEAN NOT NULL DEFAULT false,
    `updatedBy` CHAR(25) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PlatformSetting_key_key`(`key`),
    INDEX `PlatformSetting_group_idx`(`group`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NULL,
    `actorUserId` CHAR(25) NULL,
    `actorRealm` VARCHAR(16) NULL,
    `action` VARCHAR(128) NOT NULL,
    `targetType` VARCHAR(64) NULL,
    `targetId` VARCHAR(64) NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `ip` VARCHAR(45) NULL,
    `userAgent` VARCHAR(512) NULL,
    `requestId` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    INDEX `AuditLog_action_createdAt_idx`(`action`, `createdAt`),
    INDEX `AuditLog_actorUserId_createdAt_idx`(`actorUserId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IdempotencyKey` (
    `id` CHAR(25) NOT NULL,
    `scope` VARCHAR(128) NOT NULL,
    `key` VARCHAR(128) NOT NULL,
    `requestHash` CHAR(64) NOT NULL,
    `statusCode` INTEGER NULL,
    `responseBody` JSON NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `IdempotencyKey_expiresAt_idx`(`expiresAt`),
    UNIQUE INDEX `IdempotencyKey_scope_key_key`(`scope`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
