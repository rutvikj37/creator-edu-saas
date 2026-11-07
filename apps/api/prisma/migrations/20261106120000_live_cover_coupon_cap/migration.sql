-- AlterTable
ALTER TABLE `Coupon` ADD COLUMN `maxDiscountAmount` DECIMAL(19, 4) NULL,
    ADD COLUMN `showAtCheckout` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `LiveClass` ADD COLUMN `coverFileId` CHAR(25) NULL;
