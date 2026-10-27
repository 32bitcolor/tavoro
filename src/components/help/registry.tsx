import {
  Rocket,
  Route,
  Target,
  Columns3,
  FolderKanban,
  Timer,
  Film,
  Shapes,
  Inbox,
  ListChecks,
  Bell,
  Users,
  Palette,
  Bot,
  KeyRound,
  ChartColumn,
  type LucideIcon,
} from "lucide-react";

import GettingStarted from "@/components/help/topics/getting-started";
import AddieSam from "@/components/help/topics/addie-sam";
import ObjectivesAlignment from "@/components/help/topics/objectives-alignment";
import Boards from "@/components/help/topics/boards";
import Projects from "@/components/help/topics/projects";
import Sprints from "@/components/help/topics/sprints";
import Storyboards from "@/components/help/topics/storyboards";
import Whiteboards from "@/components/help/topics/whiteboards";
import Intake from "@/components/help/topics/intake";
import MyWork from "@/components/help/topics/my-work";
import Notifications from "@/components/help/topics/notifications";
import MembersAccess from "@/components/help/topics/members-access";
import AccountThemes from "@/components/help/topics/account-themes";
import AiMcp from "@/components/help/topics/ai-mcp";
import Sso from "@/components/help/topics/sso";
import Reports from "@/components/help/topics/reports";

export type HelpGroup = "Start here" | "Methodology" | "Modules";

export type HelpTopic = {
  slug: string;
  title: string;
  summary: string;
  icon: LucideIcon;
  group: HelpGroup;
  Body: React.FC;
};

// Ordered — drives the index, the section sidebar, and prev/next navigation.
export const HELP_TOPICS: HelpTopic[] = [
  {
    slug: "getting-started",
    title: "Getting started",
    summary: "Workspaces, the app shell, and a good first run.",
    icon: Rocket,
    group: "Start here",
    Body: GettingStarted,
  },
  {
    slug: "addie-sam",
    title: "ADDIE & SAM explained",
    summary: "The two methodologies behind every project — and when to use each.",
    icon: Route,
    group: "Methodology",
    Body: AddieSam,
  },
  {
    slug: "objectives-alignment",
    title: "Objectives & alignment",
    summary: "Write measurable objectives and align content and assessment to them.",
    icon: Target,
    group: "Methodology",
    Body: ObjectivesAlignment,
  },
  {
    slug: "boards",
    title: "Boards (Kanban)",
    summary: "Columns, cards, and the card drawer for your production pipeline.",
    icon: Columns3,
    group: "Modules",
    Body: Boards,
  },
  {
    slug: "projects",
    title: "Projects",
    summary: "Methodology, phases, deliverables, reviews, milestones & time.",
    icon: FolderKanban,
    group: "Modules",
    Body: Projects,
  },
  {
    slug: "sprints",
    title: "Sprints",
    summary: "Time-boxed iterations and the team sprint board.",
    icon: Timer,
    group: "Modules",
    Body: Sprints,
  },
  {
    slug: "storyboards",
    title: "Storyboards",
    summary: "Screen-by-screen course design with rich per-screen fields.",
    icon: Film,
    group: "Modules",
    Body: Storyboards,
  },
  {
    slug: "whiteboards",
    title: "Whiteboards",
    summary: "Collaborative Excalidraw canvases for workflows and wireframes.",
    icon: Shapes,
    group: "Modules",
    Body: Whiteboards,
  },
  {
    slug: "intake",
    title: "Intake",
    summary: "Capture, triage, score, and convert stakeholder requests.",
    icon: Inbox,
    group: "Modules",
    Body: Intake,
  },
  {
    slug: "my-work",
    title: "My Work & reviews",
    summary: "Your personal hub and the SME review lifecycle.",
    icon: ListChecks,
    group: "Modules",
    Body: MyWork,
  },
  {
    slug: "notifications",
    title: "Notifications & email",
    summary: "What sends an email, @-mentions, and admin controls.",
    icon: Bell,
    group: "Modules",
    Body: Notifications,
  },
  {
    slug: "ai-mcp",
    title: "AI assistants (MCP)",
    summary: "Connect Claude, ChatGPT, and other AI assistants to your workspace over MCP.",
    icon: Bot,
    group: "Modules",
    Body: AiMcp,
  },
  {
    slug: "sso",
    title: "Single sign-on & provisioning",
    summary: "Sign in through your identity provider, provision members with SCIM, and set roles from groups.",
    icon: KeyRound,
    group: "Modules",
    Body: Sso,
  },
  {
    slug: "reports",
    title: "Reports",
    summary: "Admins & managers: intake, delivery and time numbers for the team.",
    icon: ChartColumn,
    group: "Modules",
    Body: Reports,
  },
  {
    slug: "members-access",
    title: "Members, groups & access",
    summary: "Admin: manage members, groups, and group-based access.",
    icon: Users,
    group: "Modules",
    Body: MembersAccess,
  },
  {
    slug: "account-themes",
    title: "Account & themes",
    summary: "Change your password and pick from 17 built-in themes.",
    icon: Palette,
    group: "Modules",
    Body: AccountThemes,
  },
];

export const HELP_GROUPS: HelpGroup[] = ["Start here", "Methodology", "Modules"];

export function getTopic(slug: string): HelpTopic | undefined {
  return HELP_TOPICS.find((t) => t.slug === slug);
}

export function topicIndex(slug: string): number {
  return HELP_TOPICS.findIndex((t) => t.slug === slug);
}
