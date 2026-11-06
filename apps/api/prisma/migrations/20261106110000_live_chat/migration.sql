-- CreateTable
CREATE TABLE `ChatConversation` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `kind` ENUM('ACADEMY', 'PLATFORM') NOT NULL,
    `customerUserId` CHAR(25) NULL,
    `threadKey` VARCHAR(40) NOT NULL,
    `status` ENUM('OPEN', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `lastMessageAt` DATETIME(3) NULL,
    `lastMessagePreview` VARCHAR(200) NULL,
    `customerUnread` INTEGER NOT NULL DEFAULT 0,
    `agentUnread` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ChatConversation_kind_status_lastMessageAt_idx`(`kind`, `status`, `lastMessageAt`),
    INDEX `ChatConversation_tenantId_kind_lastMessageAt_idx`(`tenantId`, `kind`, `lastMessageAt`),
    UNIQUE INDEX `ChatConversation_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `ChatConversation_tenantId_threadKey_key`(`tenantId`, `threadKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ChatMessage` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `conversationId` CHAR(25) NOT NULL,
    `senderId` CHAR(25) NOT NULL,
    `side` VARCHAR(10) NOT NULL,
    `body` VARCHAR(2000) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ChatMessage_tenantId_conversationId_createdAt_idx`(`tenantId`, `conversationId`, `createdAt`),
    UNIQUE INDEX `ChatMessage_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ChatMessage` ADD CONSTRAINT `ChatMessage_tenantId_conversationId_fkey` FOREIGN KEY (`tenantId`, `conversationId`) REFERENCES `ChatConversation`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

