-- CreateTable
CREATE TABLE `Enrollment` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `userId` CHAR(25) NOT NULL,
    `courseId` CHAR(25) NOT NULL,
    `source` ENUM('FREE', 'PURCHASE', 'MANUAL', 'MEMBERSHIP', 'BUNDLE', 'BATCH', 'IMPORT') NOT NULL,
    `status` ENUM('ACTIVE', 'EXPIRED', 'REVOKED', 'COMPLETED') NOT NULL DEFAULT 'ACTIVE',
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `progressPercent` INTEGER NOT NULL DEFAULT 0,
    `lastLessonId` CHAR(25) NULL,
    `lastAccessedAt` DATETIME(3) NULL,
    `grantedById` CHAR(25) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Enrollment_tenantId_courseId_status_idx`(`tenantId`, `courseId`, `status`),
    INDEX `Enrollment_tenantId_userId_idx`(`tenantId`, `userId`),
    UNIQUE INDEX `Enrollment_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `Enrollment_tenantId_userId_courseId_key`(`tenantId`, `userId`, `courseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LessonProgress` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `enrollmentId` CHAR(25) NOT NULL,
    `lessonId` CHAR(25) NOT NULL,
    `positionSeconds` INTEGER NOT NULL DEFAULT 0,
    `completedAt` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `LessonProgress_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `LessonProgress_tenantId_enrollmentId_lessonId_key`(`tenantId`, `enrollmentId`, `lessonId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LessonNote` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `userId` CHAR(25) NOT NULL,
    `courseId` CHAR(25) NOT NULL,
    `lessonId` CHAR(25) NOT NULL,
    `body` TEXT NOT NULL,
    `positionSeconds` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LessonNote_tenantId_userId_courseId_idx`(`tenantId`, `userId`, `courseId`),
    UNIQUE INDEX `LessonNote_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CourseBookmark` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `userId` CHAR(25) NOT NULL,
    `courseId` CHAR(25) NOT NULL,
    `lessonId` CHAR(25) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CourseBookmark_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `CourseBookmark_tenantId_userId_lessonId_key`(`tenantId`, `userId`, `lessonId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LessonComment` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `courseId` CHAR(25) NOT NULL,
    `lessonId` CHAR(25) NOT NULL,
    `authorId` CHAR(25) NOT NULL,
    `authorRealm` ENUM('PLATFORM', 'TENANT') NOT NULL,
    `parentId` CHAR(25) NULL,
    `body` TEXT NOT NULL,
    `isInstructor` BOOLEAN NOT NULL DEFAULT false,
    `isResolved` BOOLEAN NOT NULL DEFAULT false,
    `hiddenAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LessonComment_tenantId_lessonId_createdAt_idx`(`tenantId`, `lessonId`, `createdAt`),
    INDEX `LessonComment_tenantId_courseId_createdAt_idx`(`tenantId`, `courseId`, `createdAt`),
    UNIQUE INDEX `LessonComment_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Quiz` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `courseId` CHAR(25) NOT NULL,
    `lessonId` CHAR(25) NOT NULL,
    `instructions` TEXT NULL,
    `timeLimitSeconds` INTEGER NULL,
    `passPercent` INTEGER NOT NULL DEFAULT 60,
    `negativeMarkRatio` DECIMAL(4, 2) NOT NULL DEFAULT 0,
    `maxAttempts` INTEGER NULL,
    `shuffleQuestions` BOOLEAN NOT NULL DEFAULT false,
    `shuffleOptions` BOOLEAN NOT NULL DEFAULT false,
    `randomPickCount` INTEGER NULL,
    `showResults` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Quiz_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `Quiz_tenantId_lessonId_key`(`tenantId`, `lessonId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `QuizQuestion` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `quizId` CHAR(25) NOT NULL,
    `type` ENUM('MCQ_SINGLE', 'MCQ_MULTI', 'TRUE_FALSE', 'FILL_BLANK', 'SHORT', 'LONG', 'MATCHING', 'FILE_UPLOAD') NOT NULL,
    `prompt` TEXT NOT NULL,
    `explanation` TEXT NULL,
    `points` DECIMAL(6, 2) NOT NULL DEFAULT 1,
    `position` INTEGER NOT NULL,
    `meta` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `QuizQuestion_tenantId_quizId_position_idx`(`tenantId`, `quizId`, `position`),
    UNIQUE INDEX `QuizQuestion_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `QuizOption` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `questionId` CHAR(25) NOT NULL,
    `label` VARCHAR(1000) NOT NULL,
    `isCorrect` BOOLEAN NOT NULL DEFAULT false,
    `matchKey` VARCHAR(1000) NULL,
    `position` INTEGER NOT NULL,

    UNIQUE INDEX `QuizOption_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `QuizAttempt` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `quizId` CHAR(25) NOT NULL,
    `userId` CHAR(25) NOT NULL,
    `enrollmentId` CHAR(25) NOT NULL,
    `attemptNo` INTEGER NOT NULL,
    `status` ENUM('IN_PROGRESS', 'SUBMITTED', 'GRADED') NOT NULL DEFAULT 'IN_PROGRESS',
    `questionOrder` JSON NOT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NULL,
    `submittedAt` DATETIME(3) NULL,
    `score` DECIMAL(8, 2) NULL,
    `maxScore` DECIMAL(8, 2) NULL,
    `percent` DECIMAL(5, 2) NULL,
    `passed` BOOLEAN NULL,

    INDEX `QuizAttempt_tenantId_status_idx`(`tenantId`, `status`),
    UNIQUE INDEX `QuizAttempt_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `QuizAttempt_tenantId_quizId_userId_attemptNo_key`(`tenantId`, `quizId`, `userId`, `attemptNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `QuizAnswer` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `attemptId` CHAR(25) NOT NULL,
    `questionId` CHAR(25) NOT NULL,
    `response` JSON NULL,
    `fileAssetId` CHAR(25) NULL,
    `isCorrect` BOOLEAN NULL,
    `pointsAwarded` DECIMAL(6, 2) NULL,
    `feedback` TEXT NULL,
    `gradedById` CHAR(25) NULL,

    UNIQUE INDEX `QuizAnswer_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `QuizAnswer_tenantId_attemptId_questionId_key`(`tenantId`, `attemptId`, `questionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Assignment` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `courseId` CHAR(25) NOT NULL,
    `lessonId` CHAR(25) NOT NULL,
    `instructions` JSON NULL,
    `dueAt` DATETIME(3) NULL,
    `maxPoints` INTEGER NOT NULL DEFAULT 100,
    `allowLate` BOOLEAN NOT NULL DEFAULT true,
    `allowFiles` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Assignment_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `Assignment_tenantId_lessonId_key`(`tenantId`, `lessonId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssignmentSubmission` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `assignmentId` CHAR(25) NOT NULL,
    `userId` CHAR(25) NOT NULL,
    `text` TEXT NULL,
    `fileAssetIds` JSON NULL,
    `status` ENUM('SUBMITTED', 'RETURNED', 'GRADED') NOT NULL DEFAULT 'SUBMITTED',
    `isLate` BOOLEAN NOT NULL DEFAULT false,
    `points` INTEGER NULL,
    `feedback` TEXT NULL,
    `gradedById` CHAR(25) NULL,
    `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `gradedAt` DATETIME(3) NULL,

    INDEX `AssignmentSubmission_tenantId_status_idx`(`tenantId`, `status`),
    UNIQUE INDEX `AssignmentSubmission_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `AssignmentSubmission_tenantId_assignmentId_userId_key`(`tenantId`, `assignmentId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CertificateTemplate` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `title` VARCHAR(120) NOT NULL DEFAULT 'Certificate of Completion',
    `bodyText` VARCHAR(300) NOT NULL DEFAULT 'has successfully completed',
    `signatoryName` VARCHAR(120) NULL,
    `signatoryRole` VARCHAR(120) NULL,
    `accentColor` VARCHAR(7) NOT NULL DEFAULT '#4f46e5',
    `showQr` BOOLEAN NOT NULL DEFAULT true,
    `updatedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CertificateTemplate_tenantId_key`(`tenantId`),
    UNIQUE INDEX `CertificateTemplate_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Certificate` (
    `id` CHAR(25) NOT NULL,
    `tenantId` CHAR(25) NOT NULL,
    `number` VARCHAR(32) NOT NULL,
    `enrollmentId` CHAR(25) NOT NULL,
    `userId` CHAR(25) NOT NULL,
    `courseId` CHAR(25) NOT NULL,
    `recipientName` VARCHAR(120) NOT NULL,
    `courseTitle` VARCHAR(200) NOT NULL,
    `academyName` VARCHAR(120) NOT NULL,
    `issuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `status` ENUM('ISSUED', 'REVOKED') NOT NULL DEFAULT 'ISSUED',
    `revokedAt` DATETIME(3) NULL,
    `revokedReason` VARCHAR(255) NULL,

    UNIQUE INDEX `Certificate_number_key`(`number`),
    INDEX `Certificate_tenantId_userId_idx`(`tenantId`, `userId`),
    UNIQUE INDEX `Certificate_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `Certificate_tenantId_enrollmentId_key`(`tenantId`, `enrollmentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CertificateVerification` (
    `id` CHAR(25) NOT NULL,
    `certificateId` CHAR(25) NOT NULL,
    `ipHash` CHAR(64) NULL,
    `userAgent` VARCHAR(512) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CertificateVerification_certificateId_createdAt_idx`(`certificateId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Enrollment` ADD CONSTRAINT `Enrollment_tenantId_courseId_fkey` FOREIGN KEY (`tenantId`, `courseId`) REFERENCES `Course`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LessonProgress` ADD CONSTRAINT `LessonProgress_tenantId_enrollmentId_fkey` FOREIGN KEY (`tenantId`, `enrollmentId`) REFERENCES `Enrollment`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LessonComment` ADD CONSTRAINT `LessonComment_tenantId_parentId_fkey` FOREIGN KEY (`tenantId`, `parentId`) REFERENCES `LessonComment`(`tenantId`, `id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `QuizQuestion` ADD CONSTRAINT `QuizQuestion_tenantId_quizId_fkey` FOREIGN KEY (`tenantId`, `quizId`) REFERENCES `Quiz`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QuizOption` ADD CONSTRAINT `QuizOption_tenantId_questionId_fkey` FOREIGN KEY (`tenantId`, `questionId`) REFERENCES `QuizQuestion`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QuizAttempt` ADD CONSTRAINT `QuizAttempt_tenantId_quizId_fkey` FOREIGN KEY (`tenantId`, `quizId`) REFERENCES `Quiz`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QuizAnswer` ADD CONSTRAINT `QuizAnswer_tenantId_attemptId_fkey` FOREIGN KEY (`tenantId`, `attemptId`) REFERENCES `QuizAttempt`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssignmentSubmission` ADD CONSTRAINT `AssignmentSubmission_tenantId_assignmentId_fkey` FOREIGN KEY (`tenantId`, `assignmentId`) REFERENCES `Assignment`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Certificate` ADD CONSTRAINT `Certificate_tenantId_enrollmentId_fkey` FOREIGN KEY (`tenantId`, `enrollmentId`) REFERENCES `Enrollment`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CertificateVerification` ADD CONSTRAINT `CertificateVerification_certificateId_fkey` FOREIGN KEY (`certificateId`) REFERENCES `Certificate`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
