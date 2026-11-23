-- AlterTable
ALTER TABLE `CoachProfile` ADD COLUMN `bio` VARCHAR(400) NULL,
    ADD COLUMN `displayName` VARCHAR(100) NULL,
    ADD COLUMN `googleEmail` VARCHAR(191) NULL,
    ADD COLUMN `googleError` VARCHAR(500) NULL,
    ADD COLUMN `googleRefreshTokenEnc` TEXT NULL,
    ADD COLUMN `photoFileId` CHAR(25) NULL;

-- AlterTable
ALTER TABLE `CoachingBooking` ADD COLUMN `googleEventId` VARCHAR(255) NULL;

