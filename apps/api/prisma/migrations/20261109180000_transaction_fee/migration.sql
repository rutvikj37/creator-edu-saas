-- AlterTable
ALTER TABLE `CoachingProgram` ADD COLUMN `passTransactionFee` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `MembershipPlan` ADD COLUMN `passTransactionFee` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `Order` ADD COLUMN `transactionFeeAmount` DECIMAL(19, 4) NOT NULL DEFAULT 0;

