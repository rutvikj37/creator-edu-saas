-- AlterTable
ALTER TABLE `OrderItem` ADD COLUMN `membershipPlanId` CHAR(25) NULL,
    MODIFY `courseId` CHAR(25) NULL;

-- CreateTable
CREATE TABLE `MembershipPlan` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` VARCHAR(1000) NULL,
    `priceAmount` DECIMAL(19, 4) NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `interval` ENUM('MONTH', 'YEAR') NOT NULL,
    `courseIds` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `createdById` CHAR(25) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MembershipPlan_tenantId_status_idx`(`tenantId`, `status`),
    UNIQUE INDEX `MembershipPlan_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Membership` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `userId` CHAR(25) NOT NULL,
    `planId` CHAR(25) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `startedAt` DATETIME(3) NOT NULL,
    `currentPeriodEnd` DATETIME(3) NOT NULL,
    `lastOrderId` CHAR(25) NULL,
    `reminderSentFor` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Membership_status_currentPeriodEnd_idx`(`status`, `currentPeriodEnd`),
    UNIQUE INDEX `Membership_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `Membership_tenantId_userId_planId_key`(`tenantId`, `userId`, `planId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Membership` ADD CONSTRAINT `Membership_tenantId_planId_fkey` FOREIGN KEY (`tenantId`, `planId`) REFERENCES `MembershipPlan`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;
