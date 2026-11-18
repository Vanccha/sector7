import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/session";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Giriş" };

export default async function LoginPage() {
  if (await getActor()) redirect("/");
  return <LoginForm />;
}
