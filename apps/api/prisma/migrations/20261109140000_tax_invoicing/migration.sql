-- AlterTable
ALTER TABLE `TenantBusinessProfile` ADD COLUMN `exportsUnderLut` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `gstInputCredit` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `invoiceNote` VARCHAR(2000) NULL,
    ADD COLUMN `invoiceStartNumber` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `invoicesEnabled` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `taxDetails` VARCHAR(2000) NULL;

