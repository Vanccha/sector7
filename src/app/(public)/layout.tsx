import { Brand } from "@/components/shell/Brand";
import styles from "./public.module.css";

/** Oturumsuz sayfaların kabuğu: tek sütun, ortalanmış. */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.shell}>
      <header className={styles.brand}>
        <Brand />
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
