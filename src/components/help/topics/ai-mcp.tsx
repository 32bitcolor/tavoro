import { Lead, H2, H3, P, UL, LI, Steps, Callout, DefList, Def, UI, Screenshot } from "@/components/help/prose";

export default function AiMcp() {
  return (
    <>
      <Lead>
        Tavoro is an <strong>MCP server</strong>. MCP (Model Context Protocol) is how AI assistants such as Claude, ChatGPT and Cursor connect to the tools
        you use. Once connected, you can ask your assistant to look things up and do the work in your workspace: &ldquo;What&rsquo;s waiting on
        me?&rdquo;, &ldquo;Turn Dana&rsquo;s review comments into cards&rdquo;, &ldquo;Draft three screens on phishing for the Module 1
        storyboard.&rdquo;
      </Lead>

      <H2>Connect Claude.ai or Claude Desktop</H2>
      <Screenshot name="ai-settings" alt="Settings, AI & MCP: the server URL with a copy button, and connection steps for Claude, ChatGPT and Claude Code" caption="Settings → AI & MCP: the server URL and how to connect each assistant." />
      <Steps>
        <>
          In Tavoro, open <UI>Settings → AI &amp; MCP</UI> and copy the server URL. It ends in <code>/api/mcp</code>.
        </>
        <>
          In Claude, open <UI>Settings → Connectors</UI>, choose <UI>Add custom connector</UI>, and paste the URL.
        </>
        <>
          Click <UI>Connect</UI>. You&rsquo;re sent to Tavoro to sign in. Pick the <strong>workspace</strong> Claude may use and the{" "}
          <strong>access</strong> (read and change, or read only), then <UI>Allow</UI>.
        </>
      </Steps>

      <H2>Connect ChatGPT</H2>
      <Steps>
        <>
          In ChatGPT, open <UI>Settings → Apps → Advanced settings</UI> and turn on <strong>Developer mode</strong> (your plan and
          workspace admin decide whether it&rsquo;s available).
        </>
        <>
          Choose <UI>Create app</UI>, paste the Tavoro URL, and set authentication to <strong>OAuth</strong>.
        </>
        <>
          ChatGPT sends you to Tavoro to sign in. Pick the workspace and access, then <UI>Allow</UI>.
        </>
      </Steps>
      <P>
        In a chat, pick the Tavoro app from the tools menu. Deep research can also read from Tavoro: it uses the <code>search</code> and{" "}
        <code>fetch</code> tools, which return whole cards, projects, storyboards and review rounds as documents.
      </P>

      <H2>Connect Claude Code or another tool</H2>
      <P>
        In Claude Code, add the server and sign in through the browser with <code>/mcp</code>:
      </P>
      <pre className="my-3 overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs">claude mcp add --transport http tavoro https://your-tavoro/api/mcp</pre>
      <P>
        Tools that can&rsquo;t sign in through a browser use a <strong>personal token</strong> instead: <UI>Settings → AI &amp; MCP → New
        token</UI>, then send it as <code>Authorization: Bearer tav_…</code>. The token is shown once; store it like a password.
      </P>
      <DefList>
        <Def term="Cursor">
          <code>.cursor/mcp.json</code>: <code>{`{"mcpServers": {"tavoro": {"url": "https://your-tavoro/api/mcp"}}}`}</code>. Cursor signs in
          on first use.
        </Def>
        <Def term="VS Code (Copilot)">
          <code>.vscode/mcp.json</code>: <code>{`{"servers": {"tavoro": {"type": "http", "url": "https://your-tavoro/api/mcp"}}}`}</code>.
        </Def>
        <Def term="Codex">
          <code>~/.codex/config.toml</code>: a <code>[mcp_servers.tavoro]</code> table with <code>url = &quot;https://your-tavoro/api/mcp&quot;</code>,
          then <code>codex mcp login tavoro</code>. Or set <code>bearer_token_env_var</code> to a variable holding a personal token.
        </Def>
        <Def term="Gemini CLI">
          <code>~/.gemini/settings.json</code>: <code>{`{"mcpServers": {"tavoro": {"httpUrl": "https://your-tavoro/api/mcp"}}}`}</code>, then{" "}
          <code>/mcp auth tavoro</code>.
        </Def>
      </DefList>

      <H2>What an assistant can do</H2>
      <DefList>
        <Def term="Find and read">
          Search; your workspace&rsquo;s members, labels, statuses and sprints; My Work; boards and cards (by key such as SEC-12); projects
          with phases, deliverables, milestones and objectives; storyboards screen by screen; whiteboards; review rounds with every comment; all feedback on
          a deliverable; intake requests; sprints.
        </Def>
        <Def term="Plan and track">
          Create boards, columns and cards; update cards (description, due date, column, assignees, SMEs, labels, sprint); comment; add and tick
          subtasks; create projects, phases, deliverables, milestones, objectives and assessment items; log time; create and run sprints;
          triage intake (admins).
        </Def>
        <Def term="Design">
          Create storyboards, add and edit screens (on-screen text, narration, visuals, interaction, developer notes) and link them to
          objectives. Read whiteboards and draw on them: labelled shapes, sticky notes, frames and arrows, or a whole flowchart laid out
          automatically (a learner journey, a branching scenario, a course map).
        </Def>
        <Def term="Content">
          List the content inventory by what needs attention, add or update items, mark them reviewed, and track a
          finished deliverable.
        </Def>
        <Def term="Templates">
          List project and storyboard templates, start a project or storyboard from one, and save a project or storyboard as a
          new template.
        </Def>
        <Def term="Review">
          Start review rounds, comment on a screen or a PDF page, resolve or won&rsquo;t-fix threads, record your own decision, and send
          comments to a board as cards.
        </Def>
      </DefList>
      <P>
        Text goes in and out as Markdown. Connected assistants also get ready-made <strong>prompts</strong>: a project status report,
        summarizing review feedback, drafting storyboard screens, triaging intake, and planning a sprint.
      </P>

      <H2>Access and safety</H2>
      <UL>
        <LI>
          An assistant acts <strong>as you</strong>, in <strong>one workspace</strong>, and sees only what you can see. Everything it does
          appears under your name, and the usual emails go out (to assignees, reviewers and so on).
        </LI>
        <LI>
          A read-only connection doesn&rsquo;t even see the tools that change things. Deleting is marked as destructive, so assistants ask
          before doing it.
        </LI>
        <LI>
          <UI>Settings → AI &amp; MCP</UI> lists your connections with when each was last used. Disconnect or revoke one and it stops at once.
          Admins can see and disconnect everyone&rsquo;s.
        </LI>
        <LI>Connected apps renew their access every hour, and stop after 30 days without use. Personal tokens expire when you chose.</LI>
        <LI>If your identity provider deactivates you (see Single sign-on), every token and connection you made stops working at once.</LI>
      </UL>

      <Callout tone="tip">
        Start a conversation with something like &ldquo;Use Tavoro: what&rsquo;s waiting on me this week?&rdquo; The assistant learns
        your workspace from there.
      </Callout>

      <H3>Not included</H3>
      <P>
        Uploading files (attachments, PDFs for review, images on whiteboards), workspace settings, members and backups stay in the app.
      </P>
    </>
  );
}
