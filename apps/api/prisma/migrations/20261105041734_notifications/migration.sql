-- CreateTable
CREATE TABLE `Notification` (
    `id` CHAR(25) NOT NULL,
    `userId` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NULL,
    `category` VARCHAR(32) NOT NULL,
    `title` VARCHAR(160) NOT NULL,
    `body` VARCHAR(500) NOT NULL,
    `link` VARCHAR(300) NULL,
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Notification_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `Notification_userId_readAt_idx`(`userId`, `readAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NotificationPreference` (
    `id` CHAR(25) NOT NULL,
    `userId` CHAR(25) NOT NULL,
    `category` VARCHAR(32) NOT NULL,
    `email` BOOLEAN NOT NULL DEFAULT true,
    `sms` BOOLEAN NOT NULL DEFAULT false,
    `whatsapp` BOOLEAN NOT NULL DEFAULT false,
    `push` BOOLEAN NOT NULL DEFAULT true,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `NotificationPreference_userId_category_key`(`userId`, `category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PushSubscription` (
    `id` CHAR(25) NOT NULL,
    `userId` CHAR(25) NOT NULL,
    `endpoint` VARCHAR(700) NOT NULL,
    `endpointHash` CHAR(64) NOT NULL,
    `p256dh` VARCHAR(200) NOT NULL,
    `auth` VARCHAR(100) NOT NULL,
    `userAgent` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastUsedAt` DATETIME(3) NULL,

    UNIQUE INDEX `PushSubscription_endpointHash_key`(`endpointHash`),
    INDEX `PushSubscription_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
