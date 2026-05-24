/*
  Warnings:

  - You are about to drop the column `cwd` on the `Session` table. All the data in the column will be lost.
  - You are about to drop the `Message` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_sessionId_fkey";

-- AlterTable
ALTER TABLE "Session" DROP COLUMN "cwd",
ADD COLUMN     "messages" JSONB NOT NULL DEFAULT '[]';

-- DropTable
DROP TABLE "Message";

-- DropEnum
DROP TYPE "MessageStatus";

-- DropEnum
DROP TYPE "Mode";

-- DropEnum
DROP TYPE "Role";
