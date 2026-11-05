-- CreateTable
CREATE TABLE `Lead` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NULL,
    `phone` VARCHAR(20) NULL,
    `source` VARCHAR(60) NOT NULL,
    `tags` JSON NOT NULL,
    `marketingConsent` BOOLEAN NOT NULL DEFAULT false,
    `consentAt` DATETIME(3) NULL,
    `consentSource` VARCHAR(60) NULL,
    `unsubscribedAt` DATETIME(3) NULL,
    `userId` CHAR(25) NULL,
    `notes` VARCHAR(1000) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Lead_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    UNIQUE INDEX `Lead_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `Lead_tenantId_email_key`(`tenantId`, `email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConsentEvent` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `leadId` CHAR(25) NOT NULL,
    `action` VARCHAR(16) NOT NULL,
    `source` VARCHAR(60) NOT NULL,
    `ipHash` CHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ConsentEvent_tenantId_leadId_idx`(`tenantId`, `leadId`),
    UNIQUE INDEX `ConsentEvent_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Campaign` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `subject` VARCHAR(200) NOT NULL,
    `previewText` VARCHAR(200) NULL,
    `content` JSON NOT NULL,
    `segment` JSON NOT NULL,
    `status` ENUM('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `scheduledAt` DATETIME(3) NULL,
    `sentAt` DATETIME(3) NULL,
    `stats` JSON NULL,
    `createdById` CHAR(25) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Campaign_tenantId_status_createdAt_idx`(`tenantId`, `status`, `createdAt`),
    INDEX `Campaign_status_scheduledAt_idx`(`status`, `scheduledAt`),
    UNIQUE INDEX `Campaign_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CampaignRecipient` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `campaignId` CHAR(25) NOT NULL,
    `leadId` CHAR(25) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CampaignRecipient_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `CampaignRecipient_tenantId_campaignId_leadId_key`(`tenantId`, `campaignId`, `leadId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CampaignRecipient` ADD CONSTRAINT `CampaignRecipient_tenantId_campaignId_fkey` FOREIGN KEY (`tenantId`, `campaignId`) REFERENCES `Campaign`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
