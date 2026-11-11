import { liveLine, STANDARD_LABEL } from "@/lib/learning";
import type { LiveSummary } from "@/lib/courseforge";

// The "in the LMS" facts for a course: packages, version, and learners' results.
export function LiveResults({ live }: { live: LiveSummary }) {
  return (
    <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
      <p>
        {live.packages === 1
          ? "1 live package"
          : `${live.packages} live packages`}{" "}
        · {live.standards.map((s) => STANDARD_LABEL[s] ?? s).join(", ")} ·
        version {live.version}
      </p>
      <p>{liveLine(live)}</p>
      <p suppressHydrationWarning>
        {live.lastLaunchAt
          ? `Last launched ${new Date(live.lastLaunchAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}.`
          : "Not launched yet."}
        {live.results && (
          <span>
            {" "}
            Results come from learners&rsquo; browsers, without names.
          </span>
        )}
      </p>
    </div>
  );
}
