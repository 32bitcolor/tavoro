import {
  LayoutDashboard,
  ListChecks,
  Inbox,
  Columns3,
  FolderKanban,
  Film,
  Shapes,
  Timer,
  type LucideIcon,
} from "lucide-react";

// ── Single source of truth for the app's modules ────────────────────────────
// The sidebar nav, header breadcrumbs, and dashboard grid all read from this
// one list. Add a module here (and its route) and it shows up everywhere —
// no more keeping three arrays in sync by hand.

export type ModuleDef = {
  key: string;
  name: string;
  /** Present = live and navigable. Absent = upcoming ("Soon"). */
  href?: string;
  icon: LucideIcon;
  /** One-line description for the dashboard cards. */
  tagline: string;
};

export const MODULES: ModuleDef[] = [
  {
    key: "dashboard",
    name: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    tagline: "Your workspace at a glance",
  },
  {
    key: "my-work",
    name: "My Work",
    href: "/my-work",
    icon: ListChecks,
    tagline: "Reviews, action items & what's due",
  },
  {
    key: "intake",
    name: "Intake",
    href: "/intake",
    icon: Inbox,
    tagline: "Stakeholder requests, triaged and scored",
  },
  {
    key: "boards",
    name: "Boards",
    href: "/boards",
    icon: Columns3,
    tagline: "Kanban for your production pipeline",
  },
  {
    key: "projects",
    name: "Projects",
    href: "/projects",
    icon: FolderKanban,
    tagline: "ADDIE/SAM projects, phases & deliverables",
  },
  {
    key: "sprints",
    name: "Sprints",
    href: "/sprints",
    icon: Timer,
    tagline: "Plan sprints and run the team sprint board",
  },
  {
    key: "storyboards",
    name: "Storyboards",
    href: "/storyboards",
    icon: Film,
    tagline: "Screen-by-screen course design",
  },
  {
    key: "whiteboards",
    name: "Whiteboards",
    href: "/whiteboards",
    icon: Shapes,
    tagline: "Sketch workflows, wireframes & ideas together",
  },
  // Future pillar: an "Integrations" capability (publish/sync to an LMS, pull
  // completion & assessment data back for impact reporting). Reintroduced as a
  // real feature once the core ID workflows land — not a hardcoded LearnUpon stub.
];

/** Modules shown in the sidebar's Workspace group (dashboard lives in the header). */
export const NAV_MODULES = MODULES.filter((m) => m.key !== "dashboard");

/** First path segment → display name, for breadcrumbs. */
export const SECTION_LABELS: Record<string, string> = {
  ...Object.fromEntries(MODULES.filter((m) => m.href).map((m) => [m.href!.replace(/^\//, ""), m.name])),
  help: "Help",
  reviews: "Reviews",
  team: "Team",
  reports: "Reports",
  settings: "Settings",
};
