-- AlterTable
ALTER TABLE `LedgerEntry` MODIFY `type` ENUM('SALE', 'TAX', 'GATEWAY_FEE', 'PLATFORM_COMMISSION', 'REFUND', 'TAX_REVERSAL', 'COMMISSION_REVERSAL', 'AFFILIATE_COMMISSION', 'AFFILIATE_REVERSAL') NOT NULL;

-- AlterTable
ALTER TABLE `Order` ADD COLUMN `affiliateId` CHAR(25) NULL;

-- CreateTable
CREATE TABLE `AffiliateProgram` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `defaultPercent` DECIMAL(5, 2) NOT NULL DEFAULT 20,
    `cookieDays` INTEGER NOT NULL DEFAULT 30,
    `holdDays` INTEGER NOT NULL DEFAULT 7,
    `autoApprove` BOOLEAN NOT NULL DEFAULT false,
    `terms` VARCHAR(2000) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AffiliateProgram_tenantId_key`(`tenantId`),
    UNIQUE INDEX `AffiliateProgram_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Affiliate` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `userId` CHAR(25) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `commissionPercent` DECIMAL(5, 2) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `payoutDetails` VARCHAR(500) NULL,
    `approvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Affiliate_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `Affiliate_tenantId_code_key`(`tenantId`, `code`),
    UNIQUE INDEX `Affiliate_tenantId_userId_key`(`tenantId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AffiliateClick` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `affiliateId` CHAR(25) NOT NULL,
    `path` VARCHAR(300) NOT NULL,
    `ipHash` CHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AffiliateClick_tenantId_affiliateId_createdAt_idx`(`tenantId`, `affiliateId`, `createdAt`),
    UNIQUE INDEX `AffiliateClick_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AffiliateConversion` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `affiliateId` CHAR(25) NOT NULL,
    `orderId` CHAR(25) NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `saleAmount` DECIMAL(19, 4) NOT NULL,
    `commission` DECIMAL(19, 4) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `approvableAt` DATETIME(3) NOT NULL,
    `approvedAt` DATETIME(3) NULL,
    `paidAt` DATETIME(3) NULL,
    `payoutRef` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AffiliateConversion_tenantId_affiliateId_status_idx`(`tenantId`, `affiliateId`, `status`),
    INDEX `AffiliateConversion_status_approvableAt_idx`(`status`, `approvableAt`),
    UNIQUE INDEX `AffiliateConversion_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `AffiliateConversion_tenantId_orderId_key`(`tenantId`, `orderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AffiliateConversion` ADD CONSTRAINT `AffiliateConversion_tenantId_affiliateId_fkey` FOREIGN KEY (`tenantId`, `affiliateId`) REFERENCES `Affiliate`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
