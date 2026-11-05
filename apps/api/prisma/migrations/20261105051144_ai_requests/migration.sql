-- CreateTable
CREATE TABLE `AiRequest` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `userId` CHAR(25) NOT NULL,
    `feature` ENUM('COURSE_OUTLINE', 'LESSON_DRAFT', 'QUIZ_QUESTIONS', 'TUTOR') NOT NULL,
    `status` ENUM('PENDING', 'SUCCEEDED', 'FAILED', 'REFUSED') NOT NULL DEFAULT 'PENDING',
    `model` VARCHAR(64) NULL,
    `courseId` CHAR(25) NULL,
    `reservedCredits` INTEGER NOT NULL,
    `creditsCharged` INTEGER NOT NULL DEFAULT 0,
    `inputTokens` INTEGER NOT NULL DEFAULT 0,
    `outputTokens` INTEGER NOT NULL DEFAULT 0,
    `latencyMs` INTEGER NULL,
    `error` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AiRequest_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    INDEX `AiRequest_tenantId_userId_feature_createdAt_idx`(`tenantId`, `userId`, `feature`, `createdAt`),
    UNIQUE INDEX `AiRequest_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
