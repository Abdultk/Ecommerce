import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

export type Db = typeof prisma;
/** Either the root client or an interactive-transaction client. */
export type DbClient = Omit<
  Db,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;
