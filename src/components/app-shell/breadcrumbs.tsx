"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Fragment,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { SECTION_LABELS } from "@/lib/modules";
import { SETTINGS_TABS } from "@/components/settings/settings-nav";

// Detail pages register their entity's live name so the trailing crumb can show
// it (the URL only carries an opaque id). Cleared automatically on unmount.
// A page may also register a `trail` that replaces the section crumb — e.g. a
// project's board reads "Projects / <project> / <board>", not "Boards / <board>".
export type Crumb = { label: string; href: string };
const PageTitleContext = createContext<{
  title: string | null;
  trail: Crumb[] | null;
  setTitle: (title: string | null) => void;
  setTrail: (trail: Crumb[] | null) => void;
}>({ title: null, trail: null, setTitle: () => {}, setTrail: () => {} });

export function PageTitleProvider({ children }: { children: React.ReactNode }) {
  const [title, setTitle] = useState<string | null>(null);
  const [trail, setTrail] = useState<Crumb[] | null>(null);
  const value = useMemo(() => ({ title, trail, setTitle, setTrail }), [title, trail]);
  return (
    <PageTitleContext.Provider value={value}>
      {children}
    </PageTitleContext.Provider>
  );
}

/** Call from a detail view to drive the trailing breadcrumb crumb. */
export function useSetPageTitle(title: string, trail?: Crumb[] | null) {
  const { setTitle, setTrail } = useContext(PageTitleContext);
  // Keyed on the serialized trail so callers can pass a fresh array literal.
  const trailKey = trail ? JSON.stringify(trail) : "";
  useEffect(() => {
    setTitle(title);
    return () => setTitle(null);
  }, [title, setTitle]);
  useEffect(() => {
    setTrail(trailKey ? (JSON.parse(trailKey) as Crumb[]) : null);
    return () => setTrail(null);
  }, [trailKey, setTrail]);
}

const SECTIONS_WITHOUT_INDEX = new Set(["reviews"]);

export function Breadcrumbs() {
  const pathname = usePathname();
  const { title, trail } = useContext(PageTitleContext);

  const segments = pathname.split("/").filter(Boolean);
  const section = segments[0];
  const sectionLabel = section ? SECTION_LABELS[section] : undefined;

  // Unknown top-level route — render nothing rather than a guess.
  if (!sectionLabel) return null;

  // Settings pages are named by their tab, not by a page title.
  if (section === "settings") {
    const tab = SETTINGS_TABS.find((t) => t.href === `/settings/${segments[1]}`);
    return (
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            {tab ? (
              <BreadcrumbLink asChild>
                <Link href="/settings">{sectionLabel}</Link>
              </BreadcrumbLink>
            ) : (
              <BreadcrumbPage>{sectionLabel}</BreadcrumbPage>
            )}
          </BreadcrumbItem>
          {tab && (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {segments.length > 2 ? (
                  <BreadcrumbLink asChild>
                    <Link href={tab.href}>{tab.label}</Link>
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage>{tab.label}</BreadcrumbPage>
                )}
              </BreadcrumbItem>
            </>
          )}
        </BreadcrumbList>
      </Breadcrumb>
    );
  }

  const isDetail = segments.length > 1;
  // Sections that only have detail pages (/reviews/<id>) — never link to their bare
  // path, even for the one render before the page sets its own trail.
  const hasIndex = !SECTIONS_WITHOUT_INDEX.has(section);

  if (isDetail && trail?.length) {
    return (
      <Breadcrumb>
        <BreadcrumbList>
          {trail.map((c) => (
            <Fragment key={c.href}>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link href={c.href} className="max-w-[30vw] truncate sm:max-w-xs">{c.label}</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
            </Fragment>
          ))}
          <BreadcrumbItem>
            <BreadcrumbPage className="max-w-[40vw] truncate sm:max-w-xs">
              {title ?? <span className="text-muted-foreground">…</span>}
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    );
  }

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          {isDetail && hasIndex ? (
            <BreadcrumbLink asChild>
              <Link href={`/${section}`}>{sectionLabel}</Link>
            </BreadcrumbLink>
          ) : (
            <BreadcrumbPage>{sectionLabel}</BreadcrumbPage>
          )}
        </BreadcrumbItem>
        {isDetail && (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage className="max-w-[40vw] truncate sm:max-w-xs">
                {title ?? <span className="text-muted-foreground">…</span>}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

/** For server pages below a section (e.g. /content/sources): names the page in the
 *  breadcrumb, since a server component can't call useSetPageTitle itself. */
export function PageTitle({ title, trail }: { title: string; trail?: Crumb[] | null }) {
  useSetPageTitle(title, trail);
  return null;
}
