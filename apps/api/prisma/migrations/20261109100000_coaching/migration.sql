-- AlterTable
ALTER TABLE `OrderItem` ADD COLUMN `coachingProgramId` CHAR(25) NULL;

-- CreateTable
CREATE TABLE `CoachingProgram` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `title` VARCHAR(100) NOT NULL,
    `slug` VARCHAR(120) NOT NULL,
    `description` JSON NULL,
    `coverFileId` CHAR(25) NULL,
    `faqs` JSON NOT NULL,
    `planName` VARCHAR(100) NULL,
    `priceAmount` DECIMAL(19, 4) NOT NULL,
    `compareAtAmount` DECIMAL(19, 4) NULL,
    `currency` CHAR(3) NOT NULL,
    `status` ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `publishedAt` DATETIME(3) NULL,
    `createdById` CHAR(25) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CoachingProgram_tenantId_status_idx`(`tenantId`, `status`),
    UNIQUE INDEX `CoachingProgram_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `CoachingProgram_tenantId_slug_key`(`tenantId`, `slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CoachingCoach` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `programId` CHAR(25) NOT NULL,
    `userId` CHAR(25) NOT NULL,
    `weight` INTEGER NOT NULL DEFAULT 1,

    INDEX `CoachingCoach_tenantId_userId_idx`(`tenantId`, `userId`),
    UNIQUE INDEX `CoachingCoach_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `CoachingCoach_programId_userId_key`(`programId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CoachingSession` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `programId` CHAR(25) NOT NULL,
    `position` INTEGER NOT NULL,
    `title` VARCHAR(100) NOT NULL,
    `durationMin` INTEGER NOT NULL,
    `agenda` JSON NOT NULL,
    `notes` VARCHAR(1000) NULL,
    `attachmentIds` JSON NOT NULL,

    INDEX `CoachingSession_tenantId_programId_position_idx`(`tenantId`, `programId`, `position`),
    UNIQUE INDEX `CoachingSession_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CoachProfile` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `userId` CHAR(25) NOT NULL,
    `timezone` VARCHAR(64) NOT NULL,
    `meetingUrl` VARCHAR(500) NULL,
    `minNoticeHours` INTEGER NOT NULL DEFAULT 12,
    `bufferMin` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CoachProfile_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `CoachProfile_tenantId_userId_key`(`tenantId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CoachAvailability` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `userId` CHAR(25) NOT NULL,
    `weekday` INTEGER NOT NULL,
    `startMinute` INTEGER NOT NULL,
    `endMinute` INTEGER NOT NULL,

    INDEX `CoachAvailability_tenantId_userId_idx`(`tenantId`, `userId`),
    UNIQUE INDEX `CoachAvailability_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CoachingAccess` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `programId` CHAR(25) NOT NULL,
    `userId` CHAR(25) NOT NULL,
    `source` VARCHAR(16) NOT NULL,
    `orderId` CHAR(25) NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CoachingAccess_tenantId_userId_idx`(`tenantId`, `userId`),
    UNIQUE INDEX `CoachingAccess_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `CoachingAccess_tenantId_programId_userId_key`(`tenantId`, `programId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CoachingBooking` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `programId` CHAR(25) NOT NULL,
    `sessionId` CHAR(25) NOT NULL,
    `accessId` CHAR(25) NOT NULL,
    `userId` CHAR(25) NOT NULL,
    `coachId` CHAR(25) NOT NULL,
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NOT NULL,
    `status` ENUM('BOOKED', 'CANCELLED', 'COMPLETED') NOT NULL DEFAULT 'BOOKED',
    `meetingUrl` VARCHAR(500) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `cancelledBy` VARCHAR(16) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CoachingBooking_tenantId_coachId_startsAt_idx`(`tenantId`, `coachId`, `startsAt`),
    INDEX `CoachingBooking_tenantId_programId_status_idx`(`tenantId`, `programId`, `status`),
    INDEX `CoachingBooking_tenantId_userId_idx`(`tenantId`, `userId`),
    INDEX `CoachingBooking_accessId_sessionId_idx`(`accessId`, `sessionId`),
    UNIQUE INDEX `CoachingBooking_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

