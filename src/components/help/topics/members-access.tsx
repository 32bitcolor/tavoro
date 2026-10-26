import Link from "next/link";
import { Lead, H2, H3, P, UL, LI, Steps, Callout, DefList, Def, UI, Screenshot } from "@/components/help/prose";

export default function MembersAccess() {
  return (
    <>
      <Lead>
        This is where admins run the workspace: add and remove people, hand out or revoke admin
        rights, reset passwords, and decide who can see which boards, projects, storyboards, and
        whiteboards. Everything here lives under <UI>Settings</UI> and is gated to administrators.
        To have your identity provider manage members instead, see{" "}
        <Link href="/help/sso" className="font-medium text-accent underline underline-offset-2">
          Single sign-on &amp; provisioning
        </Link>
        .
      </Lead>

      <Callout tone="note">
        Admin-only. The <UI>Members</UI>, <UI>Groups</UI>, and <UI>Single sign-on</UI> settings appear
        only for workspace admins — members are redirected to their own <UI>Account</UI> page. Every workspace keeps at
        least one admin at all times.
      </Callout>

      <H2>Managing members</H2>
      <Screenshot name="members" alt="Settings, Members: the Add a member form and the list of members with their roles and SSO badges" caption="Settings → Members." />
      <P>
        Open <UI>Settings → Members</UI> to see everyone in the workspace, their email, and their
        role. Tavoro uses admin-provisioned accounts — there&rsquo;s no open sign-up into an
        existing workspace — so you create each person&rsquo;s login and share their first password
        out-of-band.
      </P>

      <H3>Add a member</H3>
      <Steps>
        <>
          In the <UI>Add a member</UI> card, fill in <UI>Name</UI>, <UI>Email</UI>, and an{" "}
          <UI>Initial password</UI>. The password field shows plainly so you can copy it — it&rsquo;s
          the credential you&rsquo;ll hand off.
        </>
        <>
          Choose a <UI>Role</UI> — <UI>Member</UI>, <UI>Manager</UI>, or <UI>Admin</UI> — then click{" "}
          <UI>Add member</UI>.
        </>
        <>
          Share the email and initial password with the new person through a secure channel. They can
          change it themselves later from <UI>Settings → Account</UI>.
        </>
      </Steps>
      <P>
        If the email already belongs to a user in another workspace, adding them here simply grants
        them access to this workspace rather than creating a second account.
      </P>

      <H3>Reset a password</H3>
      <P>
        People lock themselves out. On any member&rsquo;s row, click <UI>Reset password</UI>, type a
        new one into the <UI>New password (min 8 chars)</UI> field, and click <UI>Set password</UI>.
        The member can then sign in with it and set their own from Account. Admin resets don&rsquo;t
        require the member&rsquo;s current password — that&rsquo;s the point of a reset. A reset
        also signs the member out everywhere and disconnects their AI assistants.
      </P>
      <P>
        You can&rsquo;t reset the password of someone who also belongs to another workspace: that
        would hand you their access there too. They change it themselves from Account.
      </P>

      <H3>Change a role</H3>
      <P>
        Use the role dropdown on a member&rsquo;s row to switch them between the three roles. There are
        exactly three, from most to least privileged:
      </P>
      <DefList>
        <Def term="Admin">
          Full control: manage members, groups, and workspace settings (intake, sharing, notifications,
          backup, updates), plus see and edit every board, project, storyboard, and whiteboard. Restricting a
          resource never locks out an admin.
        </Def>
        <Def term="Manager">
          An oversight role: the same &ldquo;see everything&rdquo; visibility as an admin across boards,
          projects, storyboards, and whiteboards &mdash; but <em>no</em> access to member, group, or
          workspace-settings management. Ideal for a team lead who needs the full picture without the
          admin keys.
        </Def>
        <Def term="Member">
          The default. Works within what they&rsquo;ve been granted &mdash; open resources and any
          restricted ones shared with a group they belong to.
        </Def>
      </DefList>

      <H3>Remove a member</H3>
      <P>
        Click the trash icon on a member&rsquo;s row and confirm. This removes them from the
        workspace; if they don&rsquo;t belong to any other workspace, their account is deleted
        outright.
      </P>

      <Callout tone="warning">
        Two guardrails you can&rsquo;t override: you can&rsquo;t remove yourself, and you can&rsquo;t
        demote or remove the <strong>last remaining admin</strong> (suspended admins don&rsquo;t count).
        Promote someone else to admin first if you need to step back.
      </Callout>

      <H2>Members from your identity provider</H2>
      <P>
        If your workspace uses{" "}
        <Link href="/help/sso" className="font-medium text-accent underline underline-offset-2">
          single sign-on and provisioning
        </Link>
        , your identity provider can add members for you, and the member list shows it:
      </P>
      <UL>
        <LI>
          <UI>SSO</UI> marks a member linked to the identity provider. They sign in with their work
          account; you don&rsquo;t need to give them a password.
        </LI>
        <LI>
          <UI>Suspended</UI> marks a member the identity provider deactivated. They can&rsquo;t sign in and
          their API tokens stop working, but their work stays. <UI>Restore access</UI> lets them back in
          (the identity provider may suspend them again if it still has them deactivated).
        </LI>
        <LI>
          With roles from groups on, a member&rsquo;s row says <em>Role comes from identity-provider
          groups</em>. You can still change it here, but the next update from the identity provider sets
          it back. Change the group instead.
        </LI>
      </UL>

      <H2>Organizing members into groups</H2>
      <P>
        Groups are named sets of people — &ldquo;Leadership,&rdquo; &ldquo;Compliance Team,&rdquo;
        &ldquo;Contractors&rdquo; — and they&rsquo;re the unit you share resources with. Open{" "}
        <UI>Settings → Groups</UI> to manage them.
      </P>
      <Steps>
        <>
          In <UI>Create a group</UI>, give it a <UI>Name</UI> and an optional{" "}
          <UI>Description</UI>, then click <UI>Create group</UI>.
        </>
        <>
          Click into the group to open it. Under <UI>Members</UI>, use the{" "}
          <UI>Add a member…</UI> picker and <UI>Add</UI> to bring people in; the <UI>×</UI> on a row
          removes them.
        </>
        <>
          Rename the group or edit its description inline at the top — changes save when you click
          away. <UI>Delete group</UI> removes the group and all of its resource-sharing (people and
          resources themselves are untouched).
        </>
      </Steps>

      <H2>Group-based access control</H2>
      <Screenshot name="group" alt="A group's page: its members and the Shared resources checkboxes for boards, storyboards, projects and whiteboards" caption="A group, with the resources shared with it." />
      <P>
        By default Tavoro is open: every board, project, storyboard, and whiteboard is visible to
        all members. Groups let you tighten that on a per-resource basis when something should only
        be seen by certain people.
      </P>
      <P>
        You grant access from the group. Inside a group, the <UI>Shared resources</UI> section lists
        every board, storyboard, project, and whiteboard in the workspace, in four columns. Tick a
        checkbox to give <em>this</em> group access to that resource.
      </P>

      <H3>How the default-open rule works</H3>
      <DefList>
        <Def term="No group ticked">
          The resource has no group grants, so it stays open to all members — the default.
        </Def>
        <Def term="Any group ticked">
          The moment one group is granted access, the resource becomes restricted: only members of a
          group it&rsquo;s shared with can see it.
        </Def>
        <Def term="Admins">
          Always retain access to everything, whether or not they&rsquo;re in the group. Restricting a
          resource never locks out an admin.
        </Def>
      </DefList>
      <P>
        So to lock down a sensitive project, add the right people to a group and tick that project in
        the group&rsquo;s <UI>Shared resources</UI>. To reopen it to the whole workspace, un-tick it
        everywhere — with zero grants, it&rsquo;s public to members again.
      </P>

      <Callout tone="tip">
        Restriction is enforced, not merely hidden. A user without access can&rsquo;t reach the
        resource through lists, the dashboard, <em>or</em> a direct link — the access check runs on
        every request, so pasted URLs don&rsquo;t leak anything.
      </Callout>

      <Callout tone="note">
        Groups decide who <em>in the workspace</em> sees a board. A public board link is separate: it
        shows the board, minus private cards, to anyone with the link, even if the board is restricted to
        a group. Admins see every shared board, and can turn links off, in <UI>Settings → Sharing</UI>.
      </Callout>
    </>
  );
}
