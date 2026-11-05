-- CreateTable
CREATE TABLE `Community` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` VARCHAR(1000) NULL,
    `access` VARCHAR(16) NOT NULL,
    `courseId` CHAR(25) NULL,
    `membershipPlanId` CHAR(25) NULL,
    `staffOnlyPosts` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `createdById` CHAR(25) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Community_tenantId_status_idx`(`tenantId`, `status`),
    UNIQUE INDEX `Community_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CommunityPost` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `communityId` CHAR(25) NOT NULL,
    `authorId` CHAR(25) NOT NULL,
    `authorRole` VARCHAR(16) NOT NULL,
    `title` VARCHAR(200) NULL,
    `body` TEXT NOT NULL,
    `pinned` BOOLEAN NOT NULL DEFAULT false,
    `locked` BOOLEAN NOT NULL DEFAULT false,
    `hiddenAt` DATETIME(3) NULL,
    `likes` JSON NOT NULL,
    `commentCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CommunityPost_tenantId_communityId_pinned_createdAt_idx`(`tenantId`, `communityId`, `pinned`, `createdAt`),
    UNIQUE INDEX `CommunityPost_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CommunityComment` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `postId` CHAR(25) NOT NULL,
    `authorId` CHAR(25) NOT NULL,
    `authorRole` VARCHAR(16) NOT NULL,
    `body` VARCHAR(2000) NOT NULL,
    `hiddenAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CommunityComment_tenantId_postId_createdAt_idx`(`tenantId`, `postId`, `createdAt`),
    UNIQUE INDEX `CommunityComment_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CommunityReport` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `postId` CHAR(25) NULL,
    `commentId` CHAR(25) NULL,
    `reporterId` CHAR(25) NOT NULL,
    `reason` VARCHAR(300) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolvedAt` DATETIME(3) NULL,

    INDEX `CommunityReport_tenantId_status_idx`(`tenantId`, `status`),
    UNIQUE INDEX `CommunityReport_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CommunityPost` ADD CONSTRAINT `CommunityPost_tenantId_communityId_fkey` FOREIGN KEY (`tenantId`, `communityId`) REFERENCES `Community`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CommunityComment` ADD CONSTRAINT `CommunityComment_tenantId_postId_fkey` FOREIGN KEY (`tenantId`, `postId`) REFERENCES `CommunityPost`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
