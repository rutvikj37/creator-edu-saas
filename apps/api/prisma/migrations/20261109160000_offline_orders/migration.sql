-- AlterTable
ALTER TABLE `Order` ADD COLUMN `externalReference` VARCHAR(191) NULL,
    ADD COLUMN `paymentMode` VARCHAR(20) NULL,
    ADD COLUMN `recordedById` CHAR(25) NULL;

