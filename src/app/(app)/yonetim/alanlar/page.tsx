import { db } from "@/db";
import { requirePageMainAdmin } from "@/lib/auth/session";
import { listAreas, listUserOptions } from "@/server/areas";
import { githubSyncEnabled } from "@/server/github/app";
import { AreaManager } from "./AreaManager";

export const metadata = { title: "Alanlar" };

export default async function AreasPage() {
  const actor = await requirePageMainAdmin();
  const [areas, users] = await Promise.all([listAreas(db, actor), listUserOptions(db, actor)]);
  return <AreaManager areas={areas} users={users} github={{ org: process.env.GITHUB_ORG ?? "", syncEnabled: githubSyncEnabled() }} />;
}
