# Content lifecycle & reusable asset library — design

**Status:** design proposed, nothing built.
**Owner:** @32bitcolor
**Pillar:** 4 of 5 in [the vision](../README.md#the-vision). Pillars 1–3 are live; this and
LMS integration remain.

## Why

The README states the pain in one line: *"know what's going stale, what depends on what, and
stop rebuilding the same templates, scenarios, and assets."* That's **two different problems**
sharing a roadmap bullet, and they deserve to be separated before anything is built:

- **Content lifecycle** — IDStudio currently knows nothing about a course after it ships. A
  `Deliverable` tops out at `status = "complete"`. There is no publish date, no review date, no
  owner-of-record, no expiry. So the annual compliance refresh, the policy change that
  invalidates six screens, and the video with a departed narrator are all invisible.
- **Reuse** — every new project rebuilds the same storyboard skeleton, the same scenario
  patterns, the same question stems, and re-hunts the same assets in Drive.

Lifecycle is the **more differentiated half**. A shared Drive folder half-solves an asset
library; nothing on the market tells an ID team *"this course expires in 60 days and these
screens depend on the policy you just changed."* It also builds directly on the alignment spine
already shipped (`LearningObjective` → `ScreenObjective` → `AssessmentItem`), which is what makes
dependency analysis tractable at all.

## The boundary — read this first

This repo has twice built something and then removed it as off-strategy: the **course-authoring
module** (removed in `ab20824`, rationale: *"IDStudio sits above authoring tools, it doesn't
replace them"*) and a standalone **exam builder**. "Templates, scenarios, and question banks"
is exactly the phrasing that leads back into that trap a third time.

**So the boundary is a locked decision, not a matter of taste:** the library stores
**structure, metadata, and references** — a storyboard skeleton, a scenario pattern, a tagged
question stem, a pointer to a file. It never becomes the place you *build* the finished content.
If a proposed feature starts to look like an editor for deliverable content, it's out of scope
by definition.

## Core architectural decision

**Published content is a workspace-level record, not a project-level one.**

The instinct is to add `reviewDate`/`expiryDate` to `Deliverable` and be done. That's wrong for
a structural reason: `Deliverable.projectId` is required and cascades
(`onDelete: Cascade` from `Project`). Published content **outlives the project that produced
it** — delete the 2024 project and its compliance course would silently disappear from the
inventory, which is precisely the failure the inventory exists to prevent.

So: a new workspace-scoped `ContentItem`, with an **optional** link back to the originating
deliverable and project (`onDelete: SetNull`). The project is provenance, not ownership.

The same reasoning applies to assets. `Attachment.cardId` is **required** and cascades from
`Card`. Making it nullable and bolting on optional FKs would weaken an invariant every existing
row currently relies on, for the sake of a different concept. A library asset is not "an
attachment that happens to have no card" — it's workspace-level content with its own lifecycle.
New model, reusing the existing storage layer (`lib/storage.ts`) rather than a second storage
path. One small change is required: `buildObjectKey(workspaceId, cardId, fileName)` hard-codes a
`workspace/{id}/card/{id}/…` prefix, so it needs a sibling that emits an
`workspace/{id}/asset/{id}/…` key — a generalised `buildObjectKey(workspaceId, scope, id, name)`
rather than a second bespoke key builder. Note also `MAX_UPLOAD_BYTES` is 25 MB, which is sized
for card attachments and should be revisited for video assets.

### Locked decisions

1. **`ContentItem` is workspace-scoped**, linked to `Deliverable`/`Project` via nullable
   SetNull FKs. Deleting a project must never delete inventory.
2. **Assets get their own model**, not a generalised `Attachment`. Same S3 helpers, no change
   to the card-attachment invariant.
3. **Bank items are copied into a project, not referenced.** An assessment item in a shipped
   project must not mutate because someone edited the bank entry two years later. The copy
   keeps a `sourceBankItemId` so "where is this used?" still answers — provenance without
   coupling. (Rejected: live references, which make every bank edit a silent retroactive change
   to shipped content.)
4. **Templates reuse the existing models behind a flag**, not parallel model trees. A storyboard
   template is a `Storyboard` with `isTemplate = true` and no deliverable; instantiating it is a
   deep copy. Same for a project skeleton (phases + deliverables + milestones). Cheaper than a
   `StoryboardTemplate`/`TemplateScreen` mirror that then has to be kept in sync with the real
   models forever.
5. **Tagging reuses `Label`** — now workspace-level as of 2026-08-12 — rather than inventing a
   parallel "tag" vocabulary. One vocabulary the whole workspace shares was the entire point of
   that migration; a second one would undo it. Cost is a join table per taggable entity
   (`ContentItemLabel`, `AssetLabel`, `BankItemLabel`), matching the existing `CardLabel`
   pattern.
6. **Expiry reminders ride the existing daily worker scan** (`lib/reminders.ts`), not a new
   scheduler, and register as a new notification key (`lifecycle`) in `lib/notifications.ts` so
   admins can toggle them like every other type.
7. **Dependency/impact analysis is deferred to the last phase** and starts as a single edge
   table — not a graph engine. Most of the value is in the inventory; dependencies are the
   expensive, speculative part and must not gate the rest.

### The reminder-window wrinkle

`runDueReminders` uses a **"due tomorrow"** window precisely so each item is reminded exactly
once. That rule doesn't transfer: nobody wants one day's notice that a course expires. Lifecycle
reminders need **lead time** (e.g. 60 / 30 / 7 days out), which means a one-day window no longer
guarantees exactly-once. So `ContentItem` carries `lastRemindedAt` + `lastRemindedStage`, and the
scan skips an item whose current stage has already fired. Same daily job, different rule —
worth writing down because copying the card/milestone logic verbatim would either spam or
silently skip.

## Data-model diff

Four new models (three of them substantive, one deferred to the last phase), three label
junctions, and one flag on two existing models. Grounded in the current schema.

### New

```prisma
// A piece of content that exists in the world — usually published, always tracked
// independently of the project that produced it (projects get deleted; the annual
// compliance refresh still has to surface).
model ContentItem {
  id            String    @id @default(cuid())
  workspaceId   String
  title         String
  description   String?
  contentType   String    @default("course") // course / job_aid / video / assessment / document / other
  status        String    @default("published") // draft / published / needs_review / retired
  ownerId       String?   // person of record after launch — NOT the project's PM
  publishedAt   DateTime?
  reviewDate    DateTime? // next scheduled review
  expiryDate    DateTime? // hard "must not be in use after"
  externalUrl   String?   // where it actually lives (LMS course, Rise share link, Drive doc)
  lastRemindedAt    DateTime?
  lastRemindedStage String?  // "60" | "30" | "7" — see the reminder-window note above
  // Provenance, not ownership: SetNull so deleting a project never deletes inventory.
  deliverableId String?
  projectId     String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  workspace   Workspace    @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  owner       User?        @relation(fields: [ownerId], references: [id], onDelete: SetNull)
  deliverable Deliverable? @relation(fields: [deliverableId], references: [id], onDelete: SetNull)
  project     Project?     @relation(fields: [projectId], references: [id], onDelete: SetNull)
  labels      ContentItemLabel[]
  dependsOn   ContentDependency[] @relation("DependencySource")
  dependedOnBy ContentDependency[] @relation("DependencyTarget")

  @@index([workspaceId, status])
  @@index([workspaceId, reviewDate])
  @@index([workspaceId, expiryDate])
}

// A reusable file in the library — workspace-level, unlike Attachment (card-bound).
model Asset {
  id           String   @id @default(cuid())
  workspaceId  String
  name         String
  description  String?
  assetType    String   @default("other") // image / video / audio / document / template_file / other
  // Either an uploaded object OR a link to where it really lives. Not both.
  storageKey   String?  @unique
  externalUrl  String?
  mimeType     String?
  sizeBytes    Int?
  uploadedById String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  workspace  Workspace   @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  uploadedBy User?       @relation(fields: [uploadedById], references: [id], onDelete: SetNull)
  labels     AssetLabel[]

  @@index([workspaceId, assetType])
}

// Reusable source text: question stems and scenario patterns. Copied into projects,
// never referenced live (locked decision 3).
model BankItem {
  id          String   @id @default(cuid())
  workspaceId String
  kind        String   @default("question") // question / scenario
  prompt      String
  itemType    String   @default("multiple_choice") // mirrors AssessmentItem.itemType when kind = question
  bloomLevel  String?  // optional, matches LearningObjective's vocabulary
  notes       String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  workspace Workspace        @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  copies    AssessmentItem[] // provenance: every item copied out of this entry
  labels    BankItemLabel[]

  @@index([workspaceId, kind])
}

// Deliberately minimal, and deliberately last (locked decision 7). A source can be
// another tracked item or a free-text external thing ("HR policy 4.2") — most real
// dependencies aren't in the system.
model ContentDependency {
  id             String  @id @default(cuid())
  sourceId       String  // the ContentItem that depends
  targetId       String? // on another ContentItem…
  externalSource String? // …or on something outside IDStudio
  note           String?

  source ContentItem  @relation("DependencySource", fields: [sourceId], references: [id], onDelete: Cascade)
  target ContentItem? @relation("DependencyTarget", fields: [targetId], references: [id], onDelete: Cascade)

  @@index([sourceId])
  @@index([targetId])
}
```

### Changed (additions marked `+`)

```prisma
model Storyboard {
+ isTemplate Boolean @default(false)  // a template has no deliverable; instantiating deep-copies it
}

model Project {
+ isTemplate Boolean @default(false)  // skeleton: phases + deliverables + milestones, no real work
+ contentItems ContentItem[]
}

model AssessmentItem {
+ sourceBankItemId String?   // provenance when copied out of the bank
+ sourceBankItem   BankItem? @relation(fields: [sourceBankItemId], references: [id], onDelete: SetNull)
}

model Workspace {
+ contentItems ContentItem[]
+ assets       Asset[]
+ bankItems    BankItem[]
}
```

Plus `ContentItemLabel` / `AssetLabel` / `BankItemLabel` junctions, each modelled on the
existing `CardLabel` (`@@id([entityId, labelId])`, index on `labelId`).

## Migration

Unusually low-risk: **everything here is additive.** No existing column changes type, moves
scope, or gets dropped, so there's no equivalent of the label-merge problem. The two `isTemplate`
flags default `false`, which is the correct value for every existing row.

The one judgement call is **backfill**: should existing `Deliverable`s with
`status = "complete"` be auto-created as `ContentItem`s? **No.** "Complete" means the project
finished the work, not that something shipped and needs lifecycle tracking — and a wrong
inventory is worse than an empty one, because it trains people to ignore it. Ship a
**"Track this deliverable"** action instead and let the inventory fill deliberately.

## Phased plan

Each phase is independently shippable. Stop-anywhere: after Phase 1 you already have the
differentiated half.

| Phase | Deliverable | Risk | Value |
|---|---|---|---|
| **0 — Inventory** | `ContentItem` + workspace-level Content module (list, filter, owner, type, status) + "Track this deliverable" from a project. No dates yet. | Low | A single source of truth for what exists. |
| **1 — Lifecycle** | `reviewDate` / `expiryDate` + the staged reminder rule in `lib/reminders.ts` + a `lifecycle` notification key + "needs review" surfacing in My Work / dashboard. | Low–Med | **The differentiated half** — staleness stops being invisible. |
| **2 — Assets** | `Asset` + upload-or-link, label-tagged, searchable; attach assets to content items. | Low–Med | Kills the Drive scavenger hunt. |
| **3 — Templates** | `isTemplate` on Storyboard and Project + deep-copy instantiate. | Med (copy correctness) | Stops rebuilding the same skeleton. |
| **4 — Bank** | `BankItem` + copy-into-project producing `AssessmentItem` with provenance; "where is this used". | Med | Completes the README's "question banks" promise. |
| **5 — Impact** | `ContentDependency` + "what breaks if this changes" view, seeded from the alignment spine. | Med–High | The eventual payoff; speculative until 0–2 are in real use. |

## Open items / deferred

- **Search.** Phases 0/2/4 each add a searchable surface. There's an existing global search
  (`/api/search`) — these should extend it rather than grow three bespoke search boxes.
- **Access control.** Every list query must go through the group-aware helpers in `lib/authz.ts`
  (`*VisibilityWhere`), same rule as everything else. Open question: is the library
  **default-open** like boards/projects, or is workspace-wide visibility the point of a shared
  library? Recommendation: default-open, no per-item groups until someone asks.
- **Backup coverage.** `lib/workspace-backup.ts` needs a spec entry per new model, in FK order,
  and `BACKUP_FORMAT` bumped. Assets mean real bytes in the media bundle — worth checking the
  size ceiling before Phase 2 ships, since backups are downloaded as a single `.zip`.
- **Does `ContentItem` eventually merge with LMS integration (pillar 5)?** Likely: `externalUrl`
  is a placeholder for what becomes a real LMS course reference, and completion data would hang
  off this record. Worth not over-fitting `ContentItem` to manual entry.
- **Retired content.** `status = "retired"` is in the enum but no workflow uses it. Decide
  whether retiring is archival (hidden, kept) or a soft delete before Phase 1.
