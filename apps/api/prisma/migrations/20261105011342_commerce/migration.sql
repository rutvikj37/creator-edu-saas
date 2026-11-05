-- AlterTable
ALTER TABLE `TenantBusinessProfile` ADD COLUMN `pricesIncludeTax` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `taxRate` DECIMAL(5, 2) NOT NULL DEFAULT 18;

-- CreateTable
CREATE TABLE `PaymentGatewayAccount` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `provider` ENUM('RAZORPAY') NOT NULL,
    `mode` ENUM('TEST', 'LIVE') NOT NULL DEFAULT 'TEST',
    `publicKey` VARCHAR(191) NOT NULL,
    `secretEnc` TEXT NOT NULL,
    `webhookSecretEnc` TEXT NULL,
    `status` ENUM('CONFIGURED', 'VERIFIED', 'ERROR') NOT NULL DEFAULT 'CONFIGURED',
    `lastVerifiedAt` DATETIME(3) NULL,
    `lastError` VARCHAR(500) NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdById` CHAR(25) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PaymentGatewayAccount_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `PaymentGatewayAccount_tenantId_provider_key`(`tenantId`, `provider`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Coupon` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `description` VARCHAR(200) NULL,
    `type` ENUM('PERCENT', 'FIXED') NOT NULL,
    `value` DECIMAL(19, 4) NOT NULL,
    `maxRedemptions` INTEGER NULL,
    `perUserLimit` INTEGER NOT NULL DEFAULT 1,
    `minOrderAmount` DECIMAL(19, 4) NULL,
    `startsAt` DATETIME(3) NULL,
    `endsAt` DATETIME(3) NULL,
    `courseIds` JSON NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `redemptionCount` INTEGER NOT NULL DEFAULT 0,
    `createdById` CHAR(25) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `Coupon_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `Coupon_tenantId_code_key`(`tenantId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CouponRedemption` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `couponId` CHAR(25) NOT NULL,
    `orderId` CHAR(25) NOT NULL,
    `userId` CHAR(25) NOT NULL,
    `amount` DECIMAL(19, 4) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CouponRedemption_tenantId_couponId_userId_idx`(`tenantId`, `couponId`, `userId`),
    UNIQUE INDEX `CouponRedemption_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `CouponRedemption_tenantId_orderId_key`(`tenantId`, `orderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Order` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `number` VARCHAR(32) NOT NULL,
    `userId` CHAR(25) NOT NULL,
    `status` ENUM('PENDING', 'PAYMENT_INITIATED', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED', 'PARTIALLY_REFUNDED') NOT NULL DEFAULT 'PENDING',
    `currency` CHAR(3) NOT NULL,
    `subtotalAmount` DECIMAL(19, 4) NOT NULL,
    `discountAmount` DECIMAL(19, 4) NOT NULL DEFAULT 0,
    `taxAmount` DECIMAL(19, 4) NOT NULL DEFAULT 0,
    `totalAmount` DECIMAL(19, 4) NOT NULL,
    `refundedAmount` DECIMAL(19, 4) NOT NULL DEFAULT 0,
    `taxRate` DECIMAL(5, 2) NULL,
    `taxInclusive` BOOLEAN NOT NULL DEFAULT true,
    `couponId` CHAR(25) NULL,
    `couponCode` VARCHAR(40) NULL,
    `provider` ENUM('RAZORPAY') NULL,
    `gatewayAccountId` CHAR(25) NULL,
    `billing` JSON NOT NULL,
    `idempotencyKey` VARCHAR(64) NULL,
    `paidAt` DATETIME(3) NULL,
    `failureReason` VARCHAR(500) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Order_tenantId_status_createdAt_idx`(`tenantId`, `status`, `createdAt`),
    INDEX `Order_tenantId_userId_createdAt_idx`(`tenantId`, `userId`, `createdAt`),
    INDEX `Order_status_updatedAt_idx`(`status`, `updatedAt`),
    UNIQUE INDEX `Order_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `Order_tenantId_number_key`(`tenantId`, `number`),
    UNIQUE INDEX `Order_tenantId_userId_idempotencyKey_key`(`tenantId`, `userId`, `idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrderItem` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `orderId` CHAR(25) NOT NULL,
    `courseId` CHAR(25) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `unitAmount` DECIMAL(19, 4) NOT NULL,
    `discountAmount` DECIMAL(19, 4) NOT NULL DEFAULT 0,
    `totalAmount` DECIMAL(19, 4) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `OrderItem_tenantId_courseId_idx`(`tenantId`, `courseId`),
    UNIQUE INDEX `OrderItem_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Payment` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `orderId` CHAR(25) NOT NULL,
    `provider` ENUM('RAZORPAY') NOT NULL,
    `gatewayAccountId` CHAR(25) NOT NULL,
    `providerOrderId` VARCHAR(191) NOT NULL,
    `providerPaymentId` VARCHAR(191) NULL,
    `status` ENUM('CREATED', 'CAPTURED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED') NOT NULL DEFAULT 'CREATED',
    `amount` DECIMAL(19, 4) NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `method` VARCHAR(40) NULL,
    `feeAmount` DECIMAL(19, 4) NULL,
    `failureReason` VARCHAR(500) NULL,
    `raw` JSON NULL,
    `capturedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Payment_provider_providerPaymentId_idx`(`provider`, `providerPaymentId`),
    INDEX `Payment_tenantId_status_createdAt_idx`(`tenantId`, `status`, `createdAt`),
    UNIQUE INDEX `Payment_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `Payment_provider_providerOrderId_key`(`provider`, `providerOrderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Refund` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `orderId` CHAR(25) NOT NULL,
    `paymentId` CHAR(25) NOT NULL,
    `amount` DECIMAL(19, 4) NOT NULL,
    `reason` VARCHAR(500) NULL,
    `status` ENUM('PENDING', 'PROCESSED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `providerRefundId` VARCHAR(191) NULL,
    `revokeAccess` BOOLEAN NOT NULL DEFAULT false,
    `failureReason` VARCHAR(500) NULL,
    `requestedById` CHAR(25) NOT NULL,
    `processedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Refund_providerRefundId_idx`(`providerRefundId`),
    INDEX `Refund_tenantId_status_createdAt_idx`(`tenantId`, `status`, `createdAt`),
    UNIQUE INDEX `Refund_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WebhookEvent` (
    `id` CHAR(25) NOT NULL,
    `provider` ENUM('RAZORPAY') NOT NULL,
    `gatewayAccountId` CHAR(25) NULL,
    `tenantId` CHAR(25) NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(100) NOT NULL,
    `payload` JSON NOT NULL,
    `status` ENUM('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED') NOT NULL DEFAULT 'RECEIVED',
    `error` VARCHAR(1000) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processedAt` DATETIME(3) NULL,

    INDEX `WebhookEvent_status_receivedAt_idx`(`status`, `receivedAt`),
    INDEX `WebhookEvent_tenantId_receivedAt_idx`(`tenantId`, `receivedAt`),
    UNIQUE INDEX `WebhookEvent_provider_eventId_key`(`provider`, `eventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LedgerEntry` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `orderId` CHAR(25) NULL,
    `refundId` CHAR(25) NULL,
    `type` ENUM('SALE', 'TAX', 'GATEWAY_FEE', 'PLATFORM_COMMISSION', 'REFUND', 'TAX_REVERSAL', 'COMMISSION_REVERSAL') NOT NULL,
    `amount` DECIMAL(19, 4) NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `description` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LedgerEntry_tenantId_type_createdAt_idx`(`tenantId`, `type`, `createdAt`),
    INDEX `LedgerEntry_type_createdAt_idx`(`type`, `createdAt`),
    INDEX `LedgerEntry_tenantId_orderId_idx`(`tenantId`, `orderId`),
    UNIQUE INDEX `LedgerEntry_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Invoice` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `orderId` CHAR(25) NOT NULL,
    `number` VARCHAR(40) NOT NULL,
    `seller` JSON NOT NULL,
    `buyer` JSON NOT NULL,
    `lines` JSON NOT NULL,
    `totals` JSON NOT NULL,
    `issuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Invoice_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `Invoice_tenantId_number_key`(`tenantId`, `number`),
    UNIQUE INDEX `Invoice_tenantId_orderId_key`(`tenantId`, `orderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TenantSequence` (
    `tenantId` CHAR(25) NOT NULL,
    `name` VARCHAR(40) NOT NULL,
    `value` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`tenantId`, `name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CouponRedemption` ADD CONSTRAINT `CouponRedemption_tenantId_couponId_fkey` FOREIGN KEY (`tenantId`, `couponId`) REFERENCES `Coupon`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderItem` ADD CONSTRAINT `OrderItem_tenantId_orderId_fkey` FOREIGN KEY (`tenantId`, `orderId`) REFERENCES `Order`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_tenantId_orderId_fkey` FOREIGN KEY (`tenantId`, `orderId`) REFERENCES `Order`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Refund` ADD CONSTRAINT `Refund_tenantId_orderId_fkey` FOREIGN KEY (`tenantId`, `orderId`) REFERENCES `Order`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Refund` ADD CONSTRAINT `Refund_tenantId_paymentId_fkey` FOREIGN KEY (`tenantId`, `paymentId`) REFERENCES `Payment`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
