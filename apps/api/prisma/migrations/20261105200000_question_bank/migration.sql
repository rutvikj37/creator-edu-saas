-- AlterTable
ALTER TABLE `QuizQuestion` ADD COLUMN `bankQuestionId` CHAR(25) NULL;

-- CreateTable
CREATE TABLE `BankQuestion` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `type` ENUM('MCQ_SINGLE', 'MCQ_MULTI', 'TRUE_FALSE', 'FILL_BLANK', 'SHORT', 'LONG', 'MATCHING', 'FILE_UPLOAD') NOT NULL,
    `prompt` TEXT NOT NULL,
    `explanation` TEXT NULL,
    `points` DECIMAL(6, 2) NOT NULL DEFAULT 1,
    `options` JSON NULL,
    `meta` JSON NULL,
    `tags` JSON NOT NULL,
    `createdById` CHAR(25) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `BankQuestion_tenantId_deletedAt_createdAt_idx`(`tenantId`, `deletedAt`, `createdAt`),
    UNIQUE INDEX `BankQuestion_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

