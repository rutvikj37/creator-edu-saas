-- AlterTable
ALTER TABLE `MembershipPlan` ADD COLUMN `compareAtAmount` DECIMAL(19, 4) NULL,
    ADD COLUMN `coverFileId` CHAR(25) NULL,
    ADD COLUMN `faqs` JSON NULL,
    ADD COLUMN `planName` VARCHAR(100) NULL;

