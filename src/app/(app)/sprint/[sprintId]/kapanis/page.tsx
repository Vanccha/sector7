import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { requirePageActor } from "@/lib/auth/session";
import { AppError } from "@/lib/contracts/errors";
import { getSprintEndView } from "@/server/sprint-end";
import { SprintEndBoard } from "./SprintEndBoard";

export const metadata = { title: "Sprint kapanışı" };
export const dynamic = "force-dynamic";

export default async function SprintClosePage({ params }: { params: Promise<{ sprintId: string }> }) {
  const { sprintId } = await params;
  const actor = await requirePageActor();
  if (!/^[0-9a-f-]{36}$/i.test(sprintId)) notFound();
  if (!actor.isMainAdmin && actor.managedAreaIds.length === 0) redirect("/");

  let view;
  try {
    view = await getSprintEndView(db, actor, { sprintId });
  } catch (e) {
    if (e instanceof AppError) {
      if (e.code === "NOT_FOUND") notFound();
      return (
        <div className="page page--narrow">
          <h1 className="h-wide" style={{ margin: 0, fontSize: 24 }}>
            Sprint kapanışı
          </h1>
          <p className="notice" role="status">
            {e.message}
          </p>
          <Link href={actor.isMainAdmin ? "/yonetim/sprintler" : "/alan"} className="btn-line" style={{ alignSelf: "flex-start" }}>
            Geri dön
          </Link>
        </div>
      );
    }
    throw e;
  }

  return <SprintEndBoard view={view} isMainAdmin={actor.isMainAdmin} />;
}
