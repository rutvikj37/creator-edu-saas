-- CreateTable
CREATE TABLE `BillingInvoice` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `number` VARCHAR(40) NULL,
    `kind` ENUM('PLAN', 'RENEWAL', 'COMMISSION') NOT NULL,
    `status` ENUM('OPEN', 'PAID', 'VOID') NOT NULL DEFAULT 'OPEN',
    `subscriptionId` CHAR(25) NULL,
    `planId` CHAR(25) NULL,
    `planPriceId` CHAR(25) NULL,
    `interval` ENUM('MONTH', 'YEAR') NULL,
    `periodStart` DATETIME(3) NULL,
    `periodEnd` DATETIME(3) NULL,
    `currency` CHAR(3) NOT NULL,
    `subtotalAmount` DECIMAL(19, 4) NOT NULL,
    `creditAmount` DECIMAL(19, 4) NOT NULL DEFAULT 0,
    `taxAmount` DECIMAL(19, 4) NOT NULL DEFAULT 0,
    `totalAmount` DECIMAL(19, 4) NOT NULL,
    `taxRate` DECIMAL(5, 2) NULL,
    `commissionFrom` DATETIME(3) NULL,
    `commissionTo` DATETIME(3) NULL,
    `lines` JSON NOT NULL,
    `dueAt` DATETIME(3) NOT NULL,
    `paidAt` DATETIME(3) NULL,
    `paidVia` VARCHAR(20) NULL,
    `reference` VARCHAR(191) NULL,
    `voidedAt` DATETIME(3) NULL,
    `voidReason` VARCHAR(300) NULL,
    `reminderStage` INTEGER NOT NULL DEFAULT 0,
    `createdById` CHAR(25) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `BillingInvoice_number_key`(`number`),
    INDEX `BillingInvoice_tenantId_status_createdAt_idx`(`tenantId`, `status`, `createdAt`),
    INDEX `BillingInvoice_status_dueAt_idx`(`status`, `dueAt`),
    INDEX `BillingInvoice_kind_tenantId_commissionTo_idx`(`kind`, `tenantId`, `commissionTo`),
    UNIQUE INDEX `BillingInvoice_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BillingPayment` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `invoiceId` CHAR(25) NOT NULL,
    `providerOrderId` VARCHAR(191) NOT NULL,
    `providerPaymentId` VARCHAR(191) NULL,
    `status` ENUM('CREATED', 'CAPTURED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED') NOT NULL DEFAULT 'CREATED',
    `amount` DECIMAL(19, 4) NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `method` VARCHAR(40) NULL,
    `failureReason` VARCHAR(500) NULL,
    `raw` JSON NULL,
    `capturedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `BillingPayment_providerOrderId_key`(`providerOrderId`),
    INDEX `BillingPayment_status_createdAt_idx`(`status`, `createdAt`),
    UNIQUE INDEX `BillingPayment_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `BillingPayment` ADD CONSTRAINT `BillingPayment_tenantId_invoiceId_fkey` FOREIGN KEY (`tenantId`, `invoiceId`) REFERENCES `BillingInvoice`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
