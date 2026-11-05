-- CreateTable
CREATE TABLE `Batch` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` VARCHAR(500) NULL,
    `courseId` CHAR(25) NULL,
    `startsAt` DATETIME(3) NULL,
    `endsAt` DATETIME(3) NULL,
    `capacity` INTEGER NULL,
    `createdById` CHAR(25) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `archivedAt` DATETIME(3) NULL,

    INDEX `Batch_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    UNIQUE INDEX `Batch_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BatchMember` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `batchId` CHAR(25) NOT NULL,
    `userId` CHAR(25) NOT NULL,
    `addedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `BatchMember_tenantId_userId_idx`(`tenantId`, `userId`),
    UNIQUE INDEX `BatchMember_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `BatchMember_tenantId_batchId_userId_key`(`tenantId`, `batchId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LiveClass` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `kind` ENUM('CLASS', 'WEBINAR') NOT NULL DEFAULT 'CLASS',
    `title` VARCHAR(200) NOT NULL,
    `description` VARCHAR(2000) NULL,
    `provider` ENUM('LIVEKIT', 'EXTERNAL') NOT NULL,
    `externalUrl` VARCHAR(500) NULL,
    `audience` ENUM('COURSE', 'BATCH', 'ALL_STUDENTS', 'REGISTRANTS') NOT NULL,
    `courseId` CHAR(25) NULL,
    `batchId` CHAR(25) NULL,
    `hostUserId` CHAR(25) NOT NULL,
    `durationMinutes` INTEGER NOT NULL,
    `timezone` VARCHAR(64) NOT NULL,
    `recurrence` JSON NULL,
    `capacity` INTEGER NULL,
    `waitingRoom` BOOLEAN NOT NULL DEFAULT false,
    `recordSessions` BOOLEAN NOT NULL DEFAULT false,
    `slug` VARCHAR(120) NULL,
    `status` ENUM('ACTIVE', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE',
    `createdById` CHAR(25) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LiveClass_tenantId_status_createdAt_idx`(`tenantId`, `status`, `createdAt`),
    UNIQUE INDEX `LiveClass_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `LiveClass_tenantId_slug_key`(`tenantId`, `slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LiveSession` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `liveClassId` CHAR(25) NOT NULL,
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NOT NULL,
    `status` ENUM('SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED') NOT NULL DEFAULT 'SCHEDULED',
    `roomName` VARCHAR(64) NOT NULL,
    `startedAt` DATETIME(3) NULL,
    `endedAt` DATETIME(3) NULL,
    `recordingStatus` ENUM('NONE', 'RECORDING', 'PROCESSING', 'READY', 'FAILED') NOT NULL DEFAULT 'NONE',
    `egressId` VARCHAR(100) NULL,
    `videoAssetId` CHAR(25) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `LiveSession_roomName_key`(`roomName`),
    INDEX `LiveSession_status_startsAt_idx`(`status`, `startsAt`),
    INDEX `LiveSession_tenantId_startsAt_idx`(`tenantId`, `startsAt`),
    UNIQUE INDEX `LiveSession_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `LiveSession_tenantId_liveClassId_startsAt_key`(`tenantId`, `liveClassId`, `startsAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LiveAttendance` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `sessionId` CHAR(25) NOT NULL,
    `identity` VARCHAR(64) NOT NULL,
    `userId` CHAR(25) NULL,
    `registrationId` CHAR(25) NULL,
    `displayName` VARCHAR(120) NOT NULL,
    `role` VARCHAR(16) NOT NULL,
    `source` VARCHAR(16) NOT NULL,
    `joinedAt` DATETIME(3) NOT NULL,
    `leftAt` DATETIME(3) NULL,

    INDEX `LiveAttendance_tenantId_sessionId_identity_idx`(`tenantId`, `sessionId`, `identity`),
    UNIQUE INDEX `LiveAttendance_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LiveAdmission` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `sessionId` CHAR(25) NOT NULL,
    `identity` VARCHAR(64) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `status` ENUM('WAITING', 'ADMITTED', 'DENIED') NOT NULL DEFAULT 'WAITING',
    `decidedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `LiveAdmission_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `LiveAdmission_tenantId_sessionId_identity_key`(`tenantId`, `sessionId`, `identity`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LivePoll` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `sessionId` CHAR(25) NOT NULL,
    `question` VARCHAR(300) NOT NULL,
    `options` JSON NOT NULL,
    `status` ENUM('OPEN', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `closedAt` DATETIME(3) NULL,

    INDEX `LivePoll_tenantId_sessionId_idx`(`tenantId`, `sessionId`),
    UNIQUE INDEX `LivePoll_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LivePollVote` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `pollId` CHAR(25) NOT NULL,
    `identity` VARCHAR(64) NOT NULL,
    `optionIndex` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `LivePollVote_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `LivePollVote_tenantId_pollId_identity_key`(`tenantId`, `pollId`, `identity`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LiveQuestion` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `sessionId` CHAR(25) NOT NULL,
    `identity` VARCHAR(64) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `text` VARCHAR(500) NOT NULL,
    `upvotes` JSON NOT NULL,
    `answeredAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LiveQuestion_tenantId_sessionId_idx`(`tenantId`, `sessionId`),
    UNIQUE INDEX `LiveQuestion_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WebinarRegistration` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `liveClassId` CHAR(25) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `userId` CHAR(25) NULL,
    `ticketCode` VARCHAR(32) NOT NULL,
    `consent` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `WebinarRegistration_ticketCode_key`(`ticketCode`),
    UNIQUE INDEX `WebinarRegistration_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `WebinarRegistration_tenantId_liveClassId_email_key`(`tenantId`, `liveClassId`, `email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `BatchMember` ADD CONSTRAINT `BatchMember_tenantId_batchId_fkey` FOREIGN KEY (`tenantId`, `batchId`) REFERENCES `Batch`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LiveSession` ADD CONSTRAINT `LiveSession_tenantId_liveClassId_fkey` FOREIGN KEY (`tenantId`, `liveClassId`) REFERENCES `LiveClass`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LiveAttendance` ADD CONSTRAINT `LiveAttendance_tenantId_sessionId_fkey` FOREIGN KEY (`tenantId`, `sessionId`) REFERENCES `LiveSession`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LivePollVote` ADD CONSTRAINT `LivePollVote_tenantId_pollId_fkey` FOREIGN KEY (`tenantId`, `pollId`) REFERENCES `LivePoll`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
