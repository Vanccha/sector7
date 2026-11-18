import "server-only";
import { cache } from "react";
import { db } from "@/db";
import { getActiveSprintView, type SprintView } from "./current-sprint";

/**
 * Aktif sprint görünümü, istek başına bir kez (kök layout, generateViewport ve uygulama kabuğu paylaşır).
 * Veritabanına ulaşılamazsa null (tema mavi kalır).
 */
export const getRequestSprint = cache(async (): Promise<SprintView | null> => getActiveSprintView(db).catch(() => null));
