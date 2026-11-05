-- CreateTable
CREATE TABLE `SiteSettings` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `template` VARCHAR(40) NOT NULL DEFAULT 'classic',
    `header` JSON NOT NULL,
    `footer` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SiteSettings_tenantId_key`(`tenantId`),
    UNIQUE INDEX `SiteSettings_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SitePage` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `slug` VARCHAR(80) NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `isHome` BOOLEAN NOT NULL DEFAULT false,
    `draftBlocks` JSON NOT NULL,
    `publishedBlocks` JSON NULL,
    `publishedTitle` VARCHAR(120) NULL,
    `publishedAt` DATETIME(3) NULL,
    `draftUpdatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `seoTitle` VARCHAR(70) NULL,
    `seoDescription` VARCHAR(170) NULL,
    `ogImageFileId` CHAR(25) NULL,
    `showInNav` BOOLEAN NOT NULL DEFAULT true,
    `navOrder` INTEGER NOT NULL DEFAULT 0,
    `createdById` CHAR(25) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SitePage_tenantId_navOrder_idx`(`tenantId`, `navOrder`),
    UNIQUE INDEX `SitePage_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `SitePage_tenantId_slug_key`(`tenantId`, `slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SitePageVersion` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `pageId` CHAR(25) NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `blocks` JSON NOT NULL,
    `note` VARCHAR(120) NULL,
    `createdById` CHAR(25) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SitePageVersion_tenantId_pageId_createdAt_idx`(`tenantId`, `pageId`, `createdAt`),
    UNIQUE INDEX `SitePageVersion_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BlogPost` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `slug` VARCHAR(160) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `excerpt` VARCHAR(300) NULL,
    `content` JSON NOT NULL,
    `coverFileId` CHAR(25) NULL,
    `tags` JSON NULL,
    `status` ENUM('DRAFT', 'PUBLISHED') NOT NULL DEFAULT 'DRAFT',
    `publishedAt` DATETIME(3) NULL,
    `authorId` CHAR(25) NOT NULL,
    `seoTitle` VARCHAR(70) NULL,
    `seoDescription` VARCHAR(170) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `BlogPost_tenantId_status_publishedAt_idx`(`tenantId`, `status`, `publishedAt`),
    UNIQUE INDEX `BlogPost_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `BlogPost_tenantId_slug_key`(`tenantId`, `slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SitePageVersion` ADD CONSTRAINT `SitePageVersion_tenantId_pageId_fkey` FOREIGN KEY (`tenantId`, `pageId`) REFERENCES `SitePage`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
