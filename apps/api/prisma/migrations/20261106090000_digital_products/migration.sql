-- AlterTable
ALTER TABLE `CartItem` ADD COLUMN `digitalProductId` CHAR(25) NULL;

-- AlterTable
ALTER TABLE `FileAsset` MODIFY `purpose` ENUM('LOGO', 'FAVICON', 'IMAGE', 'COURSE_THUMBNAIL', 'COURSE_BANNER', 'LESSON_FILE', 'PRODUCT_FILE', 'VIDEO_SOURCE', 'SUBMISSION', 'CERTIFICATE', 'INVOICE', 'OTHER') NOT NULL;

-- AlterTable
ALTER TABLE `OrderItem` ADD COLUMN `digitalProductId` CHAR(25) NULL;

-- CreateTable
CREATE TABLE `DigitalProduct` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `slug` VARCHAR(120) NOT NULL,
    `description` VARCHAR(5000) NULL,
    `priceAmount` DECIMAL(19, 4) NOT NULL,
    `compareAtAmount` DECIMAL(19, 4) NULL,
    `currency` CHAR(3) NOT NULL,
    `coverFileId` CHAR(25) NULL,
    `status` ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `downloadLimit` INTEGER NULL,
    `publishedAt` DATETIME(3) NULL,
    `createdById` CHAR(25) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DigitalProduct_tenantId_status_idx`(`tenantId`, `status`),
    UNIQUE INDEX `DigitalProduct_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `DigitalProduct_tenantId_slug_key`(`tenantId`, `slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DigitalProductFile` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `productId` CHAR(25) NOT NULL,
    `fileAssetId` CHAR(25) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `position` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DigitalProductFile_tenantId_productId_position_idx`(`tenantId`, `productId`, `position`),
    UNIQUE INDEX `DigitalProductFile_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DigitalProductAccess` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `productId` CHAR(25) NOT NULL,
    `userId` CHAR(25) NOT NULL,
    `source` VARCHAR(16) NOT NULL,
    `orderId` CHAR(25) NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DigitalProductAccess_tenantId_userId_idx`(`tenantId`, `userId`),
    UNIQUE INDEX `DigitalProductAccess_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `DigitalProductAccess_tenantId_productId_userId_key`(`tenantId`, `productId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DigitalProductDownload` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `productId` CHAR(25) NOT NULL,
    `fileId` CHAR(25) NOT NULL,
    `userId` CHAR(25) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DigitalProductDownload_tenantId_fileId_userId_idx`(`tenantId`, `fileId`, `userId`),
    INDEX `DigitalProductDownload_tenantId_productId_createdAt_idx`(`tenantId`, `productId`, `createdAt`),
    UNIQUE INDEX `DigitalProductDownload_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `CartItem_tenantId_userId_digitalProductId_key` ON `CartItem`(`tenantId`, `userId`, `digitalProductId`);

-- AddForeignKey
ALTER TABLE `DigitalProductFile` ADD CONSTRAINT `DigitalProductFile_tenantId_productId_fkey` FOREIGN KEY (`tenantId`, `productId`) REFERENCES `DigitalProduct`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

