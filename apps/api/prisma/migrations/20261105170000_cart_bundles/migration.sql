-- AlterTable
ALTER TABLE `OrderItem` ADD COLUMN `bundleId` CHAR(25) NULL,
    ADD COLUMN `grantCourseIds` JSON NULL;

-- CreateTable
CREATE TABLE `Bundle` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `slug` VARCHAR(120) NOT NULL,
    `description` VARCHAR(2000) NULL,
    `priceAmount` DECIMAL(19, 4) NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `courseIds` JSON NOT NULL,
    `coverFileId` CHAR(25) NULL,
    `status` ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `publishedAt` DATETIME(3) NULL,
    `createdById` CHAR(25) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Bundle_tenantId_status_idx`(`tenantId`, `status`),
    UNIQUE INDEX `Bundle_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `Bundle_tenantId_slug_key`(`tenantId`, `slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CartItem` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `userId` CHAR(25) NOT NULL,
    `courseId` CHAR(25) NULL,
    `bundleId` CHAR(25) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CartItem_tenantId_userId_createdAt_idx`(`tenantId`, `userId`, `createdAt`),
    UNIQUE INDEX `CartItem_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `CartItem_tenantId_userId_courseId_key`(`tenantId`, `userId`, `courseId`),
    UNIQUE INDEX `CartItem_tenantId_userId_bundleId_key`(`tenantId`, `userId`, `bundleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `OrderItem_tenantId_bundleId_idx` ON `OrderItem`(`tenantId`, `bundleId`);

