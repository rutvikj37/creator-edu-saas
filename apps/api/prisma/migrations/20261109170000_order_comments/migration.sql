-- CreateTable
CREATE TABLE `OrderComment` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `orderId` CHAR(25) NOT NULL,
    `authorId` CHAR(25) NOT NULL,
    `body` VARCHAR(2000) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `OrderComment_tenantId_orderId_createdAt_idx`(`tenantId`, `orderId`, `createdAt`),
    UNIQUE INDEX `OrderComment_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

