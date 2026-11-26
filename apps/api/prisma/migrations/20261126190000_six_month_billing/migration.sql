-- Add 6-month billing interval for platform plan prices (and shared BillingInterval columns).
ALTER TABLE `PlanPrice` MODIFY `interval` ENUM('MONTH', 'SIX_MONTH', 'YEAR') NOT NULL;
ALTER TABLE `BillingInvoice` MODIFY `interval` ENUM('MONTH', 'SIX_MONTH', 'YEAR') NULL;
ALTER TABLE `MembershipPlan` MODIFY `interval` ENUM('MONTH', 'SIX_MONTH', 'YEAR') NOT NULL;
