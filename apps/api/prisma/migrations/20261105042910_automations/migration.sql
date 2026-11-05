-- CreateTable
CREATE TABLE `Automation` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `trigger` VARCHAR(40) NOT NULL,
    `filter` JSON NULL,
    `steps` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `createdById` CHAR(25) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Automation_tenantId_trigger_status_idx`(`tenantId`, `trigger`, `status`),
    UNIQUE INDEX `Automation_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AutomationRun` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `automationId` CHAR(25) NOT NULL,
    `dedupeKey` VARCHAR(160) NOT NULL,
    `userId` CHAR(25) NULL,
    `email` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NULL,
    `context` JSON NOT NULL,
    `stepIndex` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'RUNNING',
    `nextAt` DATETIME(3) NULL,
    `log` JSON NOT NULL,
    `error` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AutomationRun_tenantId_automationId_createdAt_idx`(`tenantId`, `automationId`, `createdAt`),
    UNIQUE INDEX `AutomationRun_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `AutomationRun_tenantId_automationId_dedupeKey_key`(`tenantId`, `automationId`, `dedupeKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AutomationRun` ADD CONSTRAINT `AutomationRun_tenantId_automationId_fkey` FOREIGN KEY (`tenantId`, `automationId`) REFERENCES `Automation`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
