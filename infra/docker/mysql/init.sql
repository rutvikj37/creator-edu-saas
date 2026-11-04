-- Runs once when the MySQL volume is first created.
CREATE DATABASE IF NOT EXISTS creator_edu_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE IF NOT EXISTS creator_edu_shadow CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
GRANT ALL PRIVILEGES ON creator_edu.* TO 'ce_app'@'%';
GRANT ALL PRIVILEGES ON creator_edu_test.* TO 'ce_app'@'%';
GRANT ALL PRIVILEGES ON creator_edu_shadow.* TO 'ce_app'@'%';
FLUSH PRIVILEGES;
