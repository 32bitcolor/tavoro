<!-- Generated from src/components/help by `npm run help:export`. Edit the app's help, not this file. -->

# Connected apps

> Connect CourseForge, the course-authoring app, so your team signs in to it with their Tavoro account. Once it’s connected, **CourseForge** appears under **Apps** in the sidebar and opens it already signed in.

> **Note.** Connecting is admin-only, in **Settings → Connected apps**. Linking courses to cards is for everyone.

## Connect CourseForge

1. In Tavoro, open **Settings → Connected apps**, enter CourseForge’s web address (like https://courseforge.example.com) and click **Connect**.
2. Copy the connection key Tavoro shows. It’s shown only once.
3. In CourseForge, as an owner, open **Admin → Settings → Sign in with Tavoro**, paste the key and click **Save**. CourseForge checks the key with Tavoro before saving it.

From then on, the CourseForge sign-in page has a **Sign in with Tavoro** button.

## Link a card to its course

Open a card and find **Course**. **Link a course** lists the CourseForge courses you can edit; **New course in CourseForge** starts a blank one named after the card. The card then shows the course’s state (Draft, In review, Live in LMS), its lessons, open review comments and anything CourseForge’s check flags, and the board shows a course badge on the card. The status refreshes when you open the card and every few minutes. In CourseForge, the course’s editor shows a **Tavoro** link back to the card.

> **Tip.** The first time, open CourseForge once from **Apps** in the sidebar, so it knows who you are there.

## Who can sign in

- Members of this workspace. Anyone else signed in to Tavoro is told they don’t have access.
- If the workspace requires single sign-on, people need to have signed in to Tavoro with SSO. A password session isn’t enough.
- The first time someone signs in, CourseForge links their existing account with the same email, or creates one (an owner there can turn that off).

## Roles

Roles follow Tavoro: workspace admins here are owners in CourseForge, and everyone else is an Editor (or Viewer, if a CourseForge owner chooses). They update at each sign-in and every few minutes, so making someone an admin here makes them an owner there. A CourseForge owner can turn this off to manage roles there instead.

## Suspending and removing people

CourseForge checks Tavoro’s member list every five minutes. Anyone you suspend or remove here, by hand or through SCIM, is suspended there and signed out, and reactivated there when you reactivate them here. CourseForge owners are never suspended this way, so someone can always get in.

## Disconnecting

**New key** replaces the key (paste the new one into CourseForge straight away); cards stay linked. **Disconnect** stops the key working at once and removes every card’s course link. People keep their CourseForge accounts and work, but can’t sign in with Tavoro until you connect again and paste the new key. Backups don’t include connected apps, so a restored copy of the workspace needs connecting again too.

---

← [Automation rules](automation.md) · [All guides](README.md) · [Import from Jira](jira-import.md) →
