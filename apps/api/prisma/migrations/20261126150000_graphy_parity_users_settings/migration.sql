-- AlterTable
ALTER TABLE `VideoAsset` ADD COLUMN `tags` JSON NULL;

-- CreateTable
CREATE TABLE `CustomField` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `label` VARCHAR(80) NOT NULL,
    `type` VARCHAR(16) NOT NULL,
    `options` JSON NULL,
    `required` BOOLEAN NOT NULL DEFAULT false,
    `editable` BOOLEAN NOT NULL DEFAULT true,
    `showInSignup` BOOLEAN NOT NULL DEFAULT true,
    `askBeforeCourse` BOOLEAN NOT NULL DEFAULT false,
    `position` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CustomField_tenantId_position_idx`(`tenantId`, `position`),
    UNIQUE INDEX `CustomField_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CustomFieldValue` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `fieldId` CHAR(25) NOT NULL,
    `userId` CHAR(25) NOT NULL,
    `value` VARCHAR(500) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CustomFieldValue_tenantId_userId_idx`(`tenantId`, `userId`),
    UNIQUE INDEX `CustomFieldValue_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `CustomFieldValue_tenantId_fieldId_userId_key`(`tenantId`, `fieldId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CustomFieldValue` ADD CONSTRAINT `CustomFieldValue_tenantId_fieldId_fkey` FOREIGN KEY (`tenantId`, `fieldId`) REFERENCES `CustomField`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

