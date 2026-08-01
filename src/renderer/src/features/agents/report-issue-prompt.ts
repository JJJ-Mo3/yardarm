/**
 * /report-issue prompt — mirrors the mastracode TUI's report-issue command
 * (dist/tui-*.js, handleReportIssueCommand): a guided agent flow that gathers
 * context, dedupes against open issues with `gh`, then drafts + files an
 * issue on mastra-ai/mastra with the mastracode label. Re-check the TUI
 * source for drift when bumping the bundled runtime.
 */

const MASTRA_REPO = 'mastra-ai/mastra'
const MASTRA_LABEL = 'mastracode'

export function buildReportIssuePrompt(extraContext: string): string {
  return (
    `The user wants to report a GitHub issue on ${MASTRA_REPO}. Help them through this process.\n\n` +
    (extraContext ? `The user provided this initial context: "${extraContext}"\n\n` : '') +
    `## Step 1: Understand the problem

Ask the user to describe the issue in their own words. Ask follow-up questions to gather:
- What happened / what's wrong
- What they expected to happen
- Steps to reproduce (if applicable)

Also gather environment info by running:
\`\`\`
mastracode --version 2>/dev/null || echo "unknown"
node --version
uname -s
\`\`\`

Use the conversation history for additional context about what the user was working on when they hit this issue.

## Step 2: Check for duplicates

Once you understand the problem, search for similar existing issues:
\`\`\`
gh issue list --repo ${MASTRA_REPO} --label ${MASTRA_LABEL} --state open --limit 50 --json number,title,body
\`\`\`

Also search more broadly:
\`\`\`
gh search issues --repo ${MASTRA_REPO} --state open "<relevant keywords>" --limit 20 --json number,title,body,labels
\`\`\`

If you find similar issue(s):
- Present them with their number, title, and a brief summary
- Ask the user whether they'd like to add a comment on an existing issue instead of opening a new one
- If they choose to comment, draft the comment, show it to the user for approval, then run:
\`\`\`
gh issue comment <number> --repo ${MASTRA_REPO} --body "<comment>"
\`\`\`
Then stop here.

## Step 3: Draft the issue

Based on what you've gathered, write a clear, well-structured issue with:
- A concise, descriptive title
- A body covering: description, expected behavior, steps to reproduce, and environment info

**Show the full title and body to the user and ask for their approval before creating it.** Let them suggest edits.

## Step 4: Create the issue

Only after the user approves, create the issue:
\`\`\`
gh issue create --repo ${MASTRA_REPO} --label ${MASTRA_LABEL} --title "<title>" --body "<body>"
\`\`\`

Report the created issue URL back to the user.`
  )
}
