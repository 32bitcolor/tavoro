import Link from "next/link";
import { redirect } from "next/navigation";
import { BookCheck } from "lucide-react";

import { prisma } from "@/lib/db";
import { getActiveMembership } from "@/lib/dal";
import { listBank } from "@/lib/bank-list";
import { BANK_KIND_LABEL, type BankKind } from "@/lib/bank";
import { ASSESSMENT_ITEM_TYPE_LABEL, BLOOM_LABEL, type AssessmentItemType, type BloomLevel } from "@/lib/methodology";
import { PageContainer, PageHeader } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/empty-state";
import { LabelPill } from "@/components/shared/work-item";
import { BankFilters } from "@/components/bank/bank-filters";
import { NewBankItemButton } from "@/components/bank/new-bank-item";

export const metadata = { title: "Question bank · Tavoro" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function BankPage({ searchParams }: { searchParams: Promise<SP> }) {
  const membership = await getActiveMembership();
  if (!membership) redirect("/login");
  const sp = await searchParams;
  const filters = {
    q: one(sp.q),
    kind: one(sp.kind),
    type: one(sp.type),
    bloom: one(sp.bloom),
    labelId: one(sp.label),
    archived: one(sp.archived),
    unused: one(sp.unused),
  };
  const filtered = Object.values(filters).some(Boolean);

  const [items, total, labels] = await Promise.all([
    listBank(membership.workspaceId, filters),
    prisma.bankItem.count({ where: { workspaceId: membership.workspaceId } }),
    prisma.label.findMany({ where: { workspaceId: membership.workspaceId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <PageContainer size="wide">
      <PageHeader
        title="Question bank"
        description="Question stems and scenario patterns to reuse. Copy one into a project's assessment items; the bank remembers where each is used."
        actions={<NewBankItemButton />}
      />

      {(total > 0 || filtered) && (
        <div className="mt-6">
          <BankFilters labels={labels} />
        </div>
      )}

      {items.length === 0 ? (
        filtered ? (
          <EmptyState className="mt-6" icon={BookCheck} title="Nothing matches" description="Try a different filter, or clear them to see the whole bank." />
        ) : (
          <EmptyState
            className="mt-8"
            icon={BookCheck}
            title="The bank is empty"
            description="Add the questions and scenarios your team keeps rewriting. You can also save any assessment item on a project to the bank."
            action={<NewBankItemButton />}
          />
        )
      ) : (
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
          {items.map((it) => (
            <li key={it.id} className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
              <div className="min-w-0 flex-1">
                <Link href={`/bank/${it.id}`} className="line-clamp-2 font-medium outline-none hover:underline focus-visible:underline">
                  {it.prompt}
                </Link>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span>{BANK_KIND_LABEL[it.kind as BankKind] ?? it.kind}</span>
                  <span>· {ASSESSMENT_ITEM_TYPE_LABEL[it.itemType as AssessmentItemType] ?? it.itemType}</span>
                  {it.bloomLevel && <span>· {BLOOM_LABEL[it.bloomLevel as BloomLevel] ?? it.bloomLevel}</span>}
                  {it.labels.map((l) => (
                    <LabelPill key={l.id} label={l} />
                  ))}
                </div>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground sm:pt-0.5">
                {it.copies ? `Used ${it.copies} time${it.copies === 1 ? "" : "s"}` : "Not used yet"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}
