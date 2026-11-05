-- AlterTable
ALTER TABLE `LiveClass` ADD COLUMN `currency` CHAR(3) NULL,
    ADD COLUMN `priceAmount` DECIMAL(19, 4) NULL;

-- AlterTable
ALTER TABLE `OrderItem` ADD COLUMN `liveClassId` CHAR(25) NULL;

-- AlterTable
ALTER TABLE `WebinarRegistration` ADD COLUMN `cancelledAt` DATETIME(3) NULL,
    ADD COLUMN `orderId` CHAR(25) NULL;

