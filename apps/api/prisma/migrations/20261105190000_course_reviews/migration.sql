-- CreateTable
CREATE TABLE `CourseReview` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `courseId` CHAR(25) NOT NULL,
    `userId` CHAR(25) NOT NULL,
    `rating` TINYINT NOT NULL,
    `title` VARCHAR(120) NULL,
    `body` VARCHAR(2000) NULL,
    `status` ENUM('PUBLISHED', 'HIDDEN') NOT NULL DEFAULT 'PUBLISHED',
    `hiddenReason` VARCHAR(200) NULL,
    `reply` VARCHAR(2000) NULL,
    `repliedAt` DATETIME(3) NULL,
    `repliedById` CHAR(25) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CourseReview_tenantId_courseId_status_createdAt_idx`(`tenantId`, `courseId`, `status`, `createdAt`),
    INDEX `CourseReview_tenantId_status_createdAt_idx`(`tenantId`, `status`, `createdAt`),
    UNIQUE INDEX `CourseReview_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `CourseReview_tenantId_courseId_userId_key`(`tenantId`, `courseId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

