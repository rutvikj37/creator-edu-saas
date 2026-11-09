-- CreateTable
CREATE TABLE `ReportExport` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `fileName` VARCHAR(200) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `content` MEDIUMTEXT NOT NULL,
    `createdById` CHAR(25) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ReportExport_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    UNIQUE INDEX `ReportExport_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

