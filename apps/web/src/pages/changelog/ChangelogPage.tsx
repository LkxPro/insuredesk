import { useEffect } from "react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  type ChangelogRelease,
  changelogReleases,
  markChangelogSeen,
  type VisibleChangelogEntry,
} from "@/lib/changelog";

const CATEGORY_BADGE_VARIANT: Record<
  VisibleChangelogEntry["category"],
  "default" | "secondary" | "outline"
> = {
  新增: "default",
  改进: "secondary",
  修复: "outline",
};

export function ChangelogPage({ releases = changelogReleases }: { releases?: ChangelogRelease[] }) {
  const latest = releases[0]?.version ?? null;
  useEffect(() => {
    if (latest !== null) markChangelogSeen(latest);
  }, [latest]);

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold tracking-tight">更新日志</h1>
      {releases.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>暂无更新记录</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        releases.map((release) => (
          <section
            key={release.version}
            aria-label={release.version}
            className="flex flex-col gap-4"
          >
            <div className="flex items-baseline gap-3 border-b pb-2">
              <h2 className="text-lg font-semibold">{release.version}</h2>
              <time className="text-sm text-muted-foreground">{release.date}</time>
            </div>
            <ul className="flex flex-col gap-4">
              {release.entries.map((entry) => (
                <li key={`${entry.category}-${entry.user}`} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={CATEGORY_BADGE_VARIANT[entry.category]}>{entry.category}</Badge>
                    <span className="text-sm font-medium">{entry.user}</span>
                    {entry.page && (
                      <Link
                        to={entry.page}
                        className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                      >
                        {entry.page}
                      </Link>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{entry.full}</p>
                  {entry.screenshot && release.screenshots[entry.screenshot] && (
                    <img
                      src={release.screenshots[entry.screenshot]}
                      alt={entry.user}
                      className="max-w-xl rounded-md border"
                    />
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
