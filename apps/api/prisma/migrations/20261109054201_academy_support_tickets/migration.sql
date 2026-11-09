-- AlterTable
ALTER TABLE `SupportTicket` ADD COLUMN `scope` ENUM('PLATFORM', 'ACADEMY') NOT NULL DEFAULT 'PLATFORM';

-- CreateIndex
CREATE INDEX `SupportTicket_scope_tenantId_status_lastActivityAt_idx` ON `SupportTicket`(`scope`, `tenantId`, `status`, `lastActivityAt`);

-- CreateIndex
CREATE INDEX `SupportTicket_scope_tenantId_requesterId_idx` ON `SupportTicket`(`scope`, `tenantId`, `requesterId`);
