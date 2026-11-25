-- Bunny MediaCage Basic DRM protection flag on VideoAsset.
ALTER TABLE `VideoAsset` MODIFY `protection` ENUM('SIGNED', 'TOKEN', 'MEDIACAGE_BASIC') NOT NULL DEFAULT 'SIGNED';
