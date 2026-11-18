"use client";
import { createAuthClient } from "better-auth/react";
import { usernameClient } from "better-auth/client/plugins";

/** Tarayıcı tarafı oturum istemcisi (giriş/çıkış). Yetki kararları her zaman sunucuda verilir. */
export const authClient = createAuthClient({
  plugins: [usernameClient()],
});
