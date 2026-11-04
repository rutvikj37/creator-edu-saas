-- AlterTable
ALTER TABLE `Tenant` ADD COLUMN `deletionScheduledAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `SubscriptionPlan` (
    `id` CHAR(25) NOT NULL,
    `code` VARCHAR(64) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `description` VARCHAR(500) NULL,
    `status` ENUM('DRAFT', 'ACTIVE', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `isPublic` BOOLEAN NOT NULL DEFAULT true,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `trialDays` INTEGER NOT NULL DEFAULT 0,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SubscriptionPlan_code_key`(`code`),
    INDEX `SubscriptionPlan_status_sortOrder_idx`(`status`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlanPrice` (
    `id` CHAR(25) NOT NULL,
    `planId` CHAR(25) NOT NULL,
    `interval` ENUM('MONTH', 'YEAR') NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `amount` DECIMAL(19, 4) NOT NULL,
    `providerPriceIds` JSON NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PlanPrice_planId_interval_currency_key`(`planId`, `interval`, `currency`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlanFeature` (
    `id` CHAR(25) NOT NULL,
    `planId` CHAR(25) NOT NULL,
    `featureKey` VARCHAR(64) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `limitValue` BIGINT NULL,

    UNIQUE INDEX `PlanFeature_planId_featureKey_key`(`planId`, `featureKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Subscription` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `planId` CHAR(25) NOT NULL,
    `planPriceId` CHAR(25) NULL,
    `status` ENUM('TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE', 'CANCELED', 'EXPIRED') NOT NULL,
    `currentKey` VARCHAR(16) NULL,
    `currentPeriodStart` DATETIME(3) NOT NULL,
    `currentPeriodEnd` DATETIME(3) NULL,
    `trialEndsAt` DATETIME(3) NULL,
    `cancelAtPeriodEnd` BOOLEAN NOT NULL DEFAULT false,
    `canceledAt` DATETIME(3) NULL,
    `graceEndsAt` DATETIME(3) NULL,
    `provider` VARCHAR(32) NULL,
    `providerSubscriptionId` VARCHAR(191) NULL,
    `featureSnapshot` JSON NOT NULL,
    `source` VARCHAR(32) NOT NULL DEFAULT 'system',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Subscription_status_currentPeriodEnd_idx`(`status`, `currentPeriodEnd`),
    UNIQUE INDEX `Subscription_tenantId_currentKey_key`(`tenantId`, `currentKey`),
    UNIQUE INDEX `Subscription_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TenantLimitOverride` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `featureKey` VARCHAR(64) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `limitValue` BIGINT NULL,
    `reason` VARCHAR(255) NULL,
    `setById` CHAR(25) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TenantLimitOverride_tenantId_featureKey_key`(`tenantId`, `featureKey`),
    UNIQUE INDEX `TenantLimitOverride_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UsageRecord` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `metric` VARCHAR(64) NOT NULL,
    `periodStart` DATETIME(3) NOT NULL,
    `quantity` BIGINT NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `UsageRecord_tenantId_metric_periodStart_key`(`tenantId`, `metric`, `periodStart`),
    UNIQUE INDEX `UsageRecord_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CourseCategory` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NULL,
    `scopeKey` VARCHAR(25) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `slug` VARCHAR(120) NOT NULL,
    `parentId` CHAR(25) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CourseCategory_scopeKey_slug_key`(`scopeKey`, `slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Announcement` (
    `id` CHAR(25) NOT NULL,
    `audience` ENUM('CREATORS', 'STUDENTS', 'ALL') NOT NULL,
    `title` VARCHAR(160) NOT NULL,
    `body` TEXT NOT NULL,
    `tone` VARCHAR(16) NOT NULL DEFAULT 'info',
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NULL,
    `createdBy` CHAR(25) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Announcement_audience_startsAt_idx`(`audience`, `startsAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SupportTicket` (
    `id` CHAR(25) NOT NULL,
    `number` INTEGER NOT NULL AUTO_INCREMENT,
    `tenantId` CHAR(25) NULL,
    `requesterId` CHAR(25) NOT NULL,
    `assigneeId` CHAR(25) NULL,
    `category` VARCHAR(32) NOT NULL,
    `priority` ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT') NOT NULL DEFAULT 'MEDIUM',
    `status` ENUM('OPEN', 'PENDING', 'ON_HOLD', 'RESOLVED', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `subject` VARCHAR(200) NOT NULL,
    `firstResponseAt` DATETIME(3) NULL,
    `resolvedAt` DATETIME(3) NULL,
    `lastActivityAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SupportTicket_number_key`(`number`),
    INDEX `SupportTicket_status_priority_lastActivityAt_idx`(`status`, `priority`, `lastActivityAt`),
    INDEX `SupportTicket_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    INDEX `SupportTicket_assigneeId_status_idx`(`assigneeId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SupportMessage` (
    `id` CHAR(25) NOT NULL,
    `ticketId` CHAR(25) NOT NULL,
    `authorId` CHAR(25) NOT NULL,
    `body` TEXT NOT NULL,
    `isInternalNote` BOOLEAN NOT NULL DEFAULT false,
    `isStaff` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SupportMessage_ticketId_createdAt_idx`(`ticketId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PlanPrice` ADD CONSTRAINT `PlanPrice_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `SubscriptionPlan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PlanFeature` ADD CONSTRAINT `PlanFeature_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `SubscriptionPlan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Subscription` ADD CONSTRAINT `Subscription_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Subscription` ADD CONSTRAINT `Subscription_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `SubscriptionPlan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Subscription` ADD CONSTRAINT `Subscription_planPriceId_fkey` FOREIGN KEY (`planPriceId`) REFERENCES `PlanPrice`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TenantLimitOverride` ADD CONSTRAINT `TenantLimitOverride_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UsageRecord` ADD CONSTRAINT `UsageRecord_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CourseCategory` ADD CONSTRAINT `CourseCategory_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `CourseCategory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupportMessage` ADD CONSTRAINT `SupportMessage_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `SupportTicket`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
