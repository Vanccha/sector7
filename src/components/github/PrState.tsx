import type { TicketGithubView } from "@/lib/contracts/github";

export type PullRequestView = TicketGithubView["pullRequests"][number];

export function prStateLabel(pr: Pick<PullRequestView, "state" | "merged">): string {
  return pr.merged ? "Birleşti" : pr.state === "open" ? "Açık" : "Kapalı";
}

/** PR durum çipi: birleşti / açık / kapalı. */
export function PrState({ pr }: { pr: Pick<PullRequestView, "state" | "merged"> }) {
  const cls = pr.merged ? "badge badge--ok" : pr.state === "open" ? "badge" : "badge badge--hot";
  return <span className={cls}>{prStateLabel(pr)}</span>;
}
