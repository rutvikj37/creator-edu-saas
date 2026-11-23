-- AlterTable
ALTER TABLE `MembershipPlan` ADD COLUMN `buttonText` VARCHAR(40) NULL,
    ADD COLUMN `lifetime` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `taxExclusive` BOOLEAN NULL;

