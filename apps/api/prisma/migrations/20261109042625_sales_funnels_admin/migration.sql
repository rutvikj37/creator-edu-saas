-- AlterTable
ALTER TABLE `Order` ADD COLUMN `paymentLinkId` CHAR(25) NULL,
    ADD COLUMN `recoveredAt` DATETIME(3) NULL,
    ADD COLUMN `recoveredByOrderId` CHAR(25) NULL,
    ADD COLUMN `recoveryLastAt` DATETIME(3) NULL,
    ADD COLUMN `recoveryStage` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `OrderItem` ADD COLUMN `offerId` CHAR(25) NULL,
    ADD COLUMN `source` VARCHAR(16) NULL;

-- CreateTable
CREATE TABLE `EmailTemplateOverride` (
    `id` CHAR(25) NOT NULL,
    `key` VARCHAR(64) NOT NULL,
    `subject` VARCHAR(200) NOT NULL,
    `heading` VARCHAR(200) NOT NULL,
    `body` TEXT NOT NULL,
    `ctaLabel` VARCHAR(60) NULL,
    `updatedById` CHAR(25) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `EmailTemplateOverride_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SalesOffer` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `type` ENUM('BUMP', 'UPSELL') NOT NULL,
    `status` ENUM('ACTIVE', 'PAUSED', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
    `name` VARCHAR(120) NOT NULL,
    `headline` VARCHAR(160) NOT NULL,
    `description` VARCHAR(1000) NULL,
    `itemKind` VARCHAR(16) NOT NULL,
    `itemId` CHAR(25) NOT NULL,
    `priceAmount` DECIMAL(19, 4) NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `triggers` JSON NULL,
    `windowMinutes` INTEGER NOT NULL DEFAULT 30,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdById` CHAR(25) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SalesOffer_tenantId_type_status_idx`(`tenantId`, `type`, `status`),
    UNIQUE INDEX `SalesOffer_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SalesOfferResponse` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `offerId` CHAR(25) NOT NULL,
    `sourceOrderId` CHAR(25) NOT NULL,
    `userId` CHAR(25) NOT NULL,
    `decision` VARCHAR(16) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `SalesOfferResponse_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `SalesOfferResponse_tenantId_offerId_sourceOrderId_key`(`tenantId`, `offerId`, `sourceOrderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PaymentLink` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `code` VARCHAR(16) NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `itemKind` VARCHAR(16) NOT NULL,
    `itemId` CHAR(25) NOT NULL,
    `priceAmount` DECIMAL(19, 4) NULL,
    `currency` CHAR(3) NOT NULL,
    `couponCode` VARCHAR(40) NULL,
    `allowCoupons` BOOLEAN NOT NULL DEFAULT false,
    `maxUses` INTEGER NULL,
    `expiresAt` DATETIME(3) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `note` VARCHAR(500) NULL,
    `createdById` CHAR(25) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PaymentLink_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `PaymentLink_tenantId_code_key`(`tenantId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Order_tenantId_paymentLinkId_idx` ON `Order`(`tenantId`, `paymentLinkId`);

-- CreateIndex
CREATE INDEX `Order_status_createdAt_idx` ON `Order`(`status`, `createdAt`);

-- CreateIndex
CREATE INDEX `OrderItem_tenantId_offerId_idx` ON `OrderItem`(`tenantId`, `offerId`);

-- AddForeignKey
ALTER TABLE `SalesOfferResponse` ADD CONSTRAINT `SalesOfferResponse_tenantId_offerId_fkey` FOREIGN KEY (`tenantId`, `offerId`) REFERENCES `SalesOffer`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
