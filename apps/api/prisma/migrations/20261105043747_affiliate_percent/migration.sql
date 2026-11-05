/*
  Warnings:

  - Added the required column `percent` to the `AffiliateConversion` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `AffiliateConversion` ADD COLUMN `percent` DECIMAL(5, 2) NOT NULL;
