/** Sayfa yüklenirken sakin iskelet. */
export default function Loading() {
  return (
    <div className="skeleton-stack" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Yükleniyor</span>
      <span className="skeleton" style={{ width: "40%", height: 28 }} />
      <span className="skeleton skeleton--card" />
      <span className="skeleton skeleton--card" />
    </div>
  );
}
