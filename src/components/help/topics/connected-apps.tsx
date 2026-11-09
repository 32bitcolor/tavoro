import { Lead, H2, P, UL, LI, Steps, Callout, UI } from "@/components/help/prose";

export default function ConnectedApps() {
  return (
    <>
      <Lead>
        Connect CourseForge, the course-authoring app, so your team signs in to it with their Tavoro account. Once it&rsquo;s
        connected, <UI>CourseForge</UI> appears under <UI>Apps</UI> in the sidebar and opens it already signed in.
      </Lead>

      <Callout tone="note">Connecting is admin-only, in <UI>Settings → Connected apps</UI>. Linking courses to cards is for everyone.</Callout>

      <H2>Connect CourseForge</H2>
      <Steps>
        <>
          In Tavoro, open <UI>Settings → Connected apps</UI>, enter CourseForge&rsquo;s web address (like
          https://courseforge.example.com) and click <UI>Connect</UI>.
        </>
        <>Copy the connection key Tavoro shows. It&rsquo;s shown only once.</>
        <>
          In CourseForge, as an owner, open <UI>Admin → Settings → Sign in with Tavoro</UI>, paste the key and click{" "}
          <UI>Save</UI>. CourseForge checks the key with Tavoro before saving it.
        </>
      </Steps>
      <P>From then on, the CourseForge sign-in page has a <UI>Sign in with Tavoro</UI> button.</P>

      <H2>Link a card to its course</H2>
      <P>
        Open a card and find <UI>Course</UI>. <UI>Link a course</UI> lists the CourseForge courses you can edit;{" "}
        <UI>New course in CourseForge</UI> starts a blank one named after the card. The card then shows the course&rsquo;s
        state (Draft, In review, Live in LMS), its lessons, open review comments and anything CourseForge&rsquo;s check
        flags, and the board shows a course badge on the card. The status refreshes when you open the card and every
        few minutes. In CourseForge, the course&rsquo;s editor shows a <UI>Tavoro</UI> link back to the card.
      </P>
      <Callout tone="tip">
        The first time, open CourseForge once from <UI>Apps</UI> in the sidebar, so it knows who you are there.
      </Callout>

      <H2>Who can sign in</H2>
      <UL>
        <LI>Members of this workspace. Anyone else signed in to Tavoro is told they don&rsquo;t have access.</LI>
        <LI>
          If the workspace requires single sign-on, people need to have signed in to Tavoro with SSO. A password session
          isn&rsquo;t enough.
        </LI>
        <LI>
          The first time someone signs in, CourseForge links their existing account with the same email, or creates one
          (an owner there can turn that off).
        </LI>
      </UL>

      <H2>Roles</H2>
      <P>
        Roles follow Tavoro: workspace admins here are owners in CourseForge, and everyone else is an Editor (or Viewer,
        if a CourseForge owner chooses). They update at each sign-in and every few minutes, so making someone an admin
        here makes them an owner there. A CourseForge owner can turn this off to manage roles there instead.
      </P>

      <H2>Suspending and removing people</H2>
      <P>
        CourseForge checks Tavoro&rsquo;s member list every five minutes. Anyone you suspend or remove here, by hand or
        through SCIM, is suspended there and signed out, and reactivated there when you reactivate them here. CourseForge
        owners are never suspended this way, so someone can always get in.
      </P>

      <H2>Disconnecting</H2>
      <P>
        <UI>New key</UI> replaces the key (paste the new one into CourseForge straight away); cards stay linked.{" "}
        <UI>Disconnect</UI> stops the key working at once and removes every card&rsquo;s course link. People keep their
        CourseForge accounts and work, but can&rsquo;t sign in with Tavoro until you connect again and paste the new key. Backups don&rsquo;t include connected apps, so
        a restored copy of the workspace needs connecting again too.
      </P>
    </>
  );
}
