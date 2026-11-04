-- CreateTable
CREATE TABLE `Academy` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `tagline` VARCHAR(160) NULL,
    `description` TEXT NULL,
    `categorySlug` VARCHAR(120) NULL,
    `logoFileId` CHAR(25) NULL,
    `faviconFileId` CHAR(25) NULL,
    `supportEmail` VARCHAR(191) NULL,
    `socialLinks` JSON NULL,
    `primaryColor` VARCHAR(7) NOT NULL DEFAULT '#4f46e5',
    `accentColor` VARCHAR(7) NOT NULL DEFAULT '#0d9488',
    `fontHeading` VARCHAR(64) NOT NULL DEFAULT 'Inter',
    `fontBody` VARCHAR(64) NOT NULL DEFAULT 'Inter',
    `publishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Academy_tenantId_key`(`tenantId`),
    UNIQUE INDEX `Academy_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TenantBusinessProfile` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `legalName` VARCHAR(200) NULL,
    `addressLine1` VARCHAR(200) NULL,
    `addressLine2` VARCHAR(200) NULL,
    `city` VARCHAR(100) NULL,
    `state` VARCHAR(100) NULL,
    `postalCode` VARCHAR(20) NULL,
    `country` CHAR(2) NULL,
    `gstRegistered` BOOLEAN NOT NULL DEFAULT false,
    `gstin` VARCHAR(15) NULL,
    `pan` VARCHAR(10) NULL,
    `invoicePrefix` VARCHAR(12) NOT NULL DEFAULT 'INV',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TenantBusinessProfile_tenantId_key`(`tenantId`),
    UNIQUE INDEX `TenantBusinessProfile_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FileAsset` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `ownerUserId` CHAR(25) NOT NULL,
    `purpose` ENUM('LOGO', 'FAVICON', 'IMAGE', 'COURSE_THUMBNAIL', 'COURSE_BANNER', 'LESSON_FILE', 'VIDEO_SOURCE', 'SUBMISSION', 'CERTIFICATE', 'INVOICE', 'OTHER') NOT NULL,
    `driver` VARCHAR(16) NOT NULL,
    `bucket` VARCHAR(100) NOT NULL,
    `key` VARCHAR(512) NOT NULL,
    `fileName` VARCHAR(255) NOT NULL,
    `mimeType` VARCHAR(127) NOT NULL,
    `sizeBytes` BIGINT NOT NULL,
    `isPublic` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('UPLOADING', 'READY', 'REJECTED', 'DELETED') NOT NULL DEFAULT 'UPLOADING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `FileAsset_tenantId_purpose_createdAt_idx`(`tenantId`, `purpose`, `createdAt`),
    UNIQUE INDEX `FileAsset_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `FileAsset_driver_bucket_key_key`(`driver`, `bucket`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Course` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `slug` VARCHAR(220) NOT NULL,
    `shortDescription` VARCHAR(500) NULL,
    `description` JSON NULL,
    `thumbnailFileId` CHAR(25) NULL,
    `bannerFileId` CHAR(25) NULL,
    `categorySlug` VARCHAR(120) NULL,
    `tags` JSON NULL,
    `language` VARCHAR(10) NOT NULL DEFAULT 'en',
    `level` ENUM('BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'ALL_LEVELS') NOT NULL DEFAULT 'ALL_LEVELS',
    `objectives` JSON NULL,
    `prerequisites` JSON NULL,
    `durationMinutes` INTEGER NULL,
    `priceAmount` DECIMAL(19, 4) NULL,
    `compareAtAmount` DECIMAL(19, 4) NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'INR',
    `isFree` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('DRAFT', 'SCHEDULED', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `visibility` ENUM('PUBLIC', 'UNLISTED', 'PRIVATE') NOT NULL DEFAULT 'PUBLIC',
    `publishAt` DATETIME(3) NULL,
    `publishedAt` DATETIME(3) NULL,
    `accessType` ENUM('LIFETIME', 'FIXED_DAYS', 'FIXED_DATE') NOT NULL DEFAULT 'LIFETIME',
    `accessDays` INTEGER NULL,
    `accessUntil` DATETIME(3) NULL,
    `dripType` ENUM('NONE', 'DAYS_AFTER_ENROLL', 'DATE') NOT NULL DEFAULT 'NONE',
    `completionPercent` INTEGER NOT NULL DEFAULT 100,
    `certificateEnabled` BOOLEAN NOT NULL DEFAULT false,
    `seoTitle` VARCHAR(70) NULL,
    `seoDescription` VARCHAR(170) NULL,
    `createdById` CHAR(25) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `Course_tenantId_status_createdAt_idx`(`tenantId`, `status`, `createdAt`),
    UNIQUE INDEX `Course_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `Course_tenantId_slug_key`(`tenantId`, `slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CourseInstructor` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `courseId` CHAR(25) NOT NULL,
    `userId` CHAR(25) NOT NULL,
    `isPrimary` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CourseInstructor_tenantId_courseId_userId_key`(`tenantId`, `courseId`, `userId`),
    UNIQUE INDEX `CourseInstructor_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CourseSection` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `courseId` CHAR(25) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `position` INTEGER NOT NULL,
    `dripOffsetDays` INTEGER NULL,
    `unlockAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CourseSection_tenantId_courseId_position_idx`(`tenantId`, `courseId`, `position`),
    UNIQUE INDEX `CourseSection_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CourseLesson` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `courseId` CHAR(25) NOT NULL,
    `sectionId` CHAR(25) NOT NULL,
    `parentLessonId` CHAR(25) NULL,
    `title` VARCHAR(200) NOT NULL,
    `type` ENUM('VIDEO', 'AUDIO', 'PDF', 'DOCUMENT', 'TEXT', 'IMAGE', 'LINK', 'QUIZ', 'ASSIGNMENT', 'LIVE', 'DOWNLOAD') NOT NULL,
    `position` INTEGER NOT NULL,
    `content` JSON NULL,
    `fileAssetId` CHAR(25) NULL,
    `externalUrl` VARCHAR(1000) NULL,
    `durationSeconds` INTEGER NULL,
    `isFreePreview` BOOLEAN NOT NULL DEFAULT false,
    `isPublished` BOOLEAN NOT NULL DEFAULT true,
    `isRequired` BOOLEAN NOT NULL DEFAULT true,
    `dripOffsetDays` INTEGER NULL,
    `unlockAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CourseLesson_tenantId_sectionId_position_idx`(`tenantId`, `sectionId`, `position`),
    INDEX `CourseLesson_tenantId_courseId_idx`(`tenantId`, `courseId`),
    UNIQUE INDEX `CourseLesson_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StaffInvitation` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `roleId` CHAR(25) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `invitedById` CHAR(25) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `acceptedAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `StaffInvitation_tokenHash_key`(`tokenHash`),
    INDEX `StaffInvitation_tenantId_email_idx`(`tenantId`, `email`),
    UNIQUE INDEX `StaffInvitation_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Academy` ADD CONSTRAINT `Academy_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TenantBusinessProfile` ADD CONSTRAINT `TenantBusinessProfile_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FileAsset` ADD CONSTRAINT `FileAsset_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Course` ADD CONSTRAINT `Course_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CourseInstructor` ADD CONSTRAINT `CourseInstructor_tenantId_courseId_fkey` FOREIGN KEY (`tenantId`, `courseId`) REFERENCES `Course`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CourseSection` ADD CONSTRAINT `CourseSection_tenantId_courseId_fkey` FOREIGN KEY (`tenantId`, `courseId`) REFERENCES `Course`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CourseLesson` ADD CONSTRAINT `CourseLesson_tenantId_courseId_fkey` FOREIGN KEY (`tenantId`, `courseId`) REFERENCES `Course`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CourseLesson` ADD CONSTRAINT `CourseLesson_tenantId_sectionId_fkey` FOREIGN KEY (`tenantId`, `sectionId`) REFERENCES `CourseSection`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CourseLesson` ADD CONSTRAINT `CourseLesson_tenantId_parentLessonId_fkey` FOREIGN KEY (`tenantId`, `parentLessonId`) REFERENCES `CourseLesson`(`tenantId`, `id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `CourseLesson` ADD CONSTRAINT `CourseLesson_tenantId_fileAssetId_fkey` FOREIGN KEY (`tenantId`, `fileAssetId`) REFERENCES `FileAsset`(`tenantId`, `id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `StaffInvitation` ADD CONSTRAINT `StaffInvitation_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
