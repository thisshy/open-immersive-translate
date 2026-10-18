# Translation sidebar (local build 0.0.5)

Click the toolbar icon to open the sidebar directly. Paste text into the source box and click **翻译文字**, or press **Ctrl+Enter** (Command+Enter on macOS). Opening the sidebar and reading a page selection never submit a model request.

- **A− / A+** changes source and result text between 14 and 24 px (default 16). Settings also offer system, Microsoft YaHei and SimSun fonts, plus system/light/dark appearance. These preferences persist in extension configuration.
- Source and result always have separate labels and backgrounds. Copy is beside the result; history stays collapsed until opened.
- Explain, polish and summarize use the same result area. Conversation, PDF, subtitle files, shortcuts and configuration import/export remain accessible through **更多工具**.
- Text translation uses `sidePanel.service` and `sidePanel.targetLanguage`, falling back to the main configuration. The page tab displays and edits the separate main service/language used for webpage translation (site rules may override it).
- Current text and result are restored after closing/reopening the sidebar during the browser session through `storage.session`. Completed translation history remains in local storage. Chat transcripts remain in memory.
- **停止** aborts the active request and keeps partial output. Started streaming requests are never silently retried as another complete request. Only a model error offers a model retry; clipboard or settings errors do not resubmit text.

The manifest intentionally has no action popup. The background worker reapplies `openPanelOnActionClick: true` on startup. Reload the unpacked extension once after updating its installed files.

Relevant checks: `npm run typecheck`, the shared configuration and assistant tests, `tests/ui/sidepanel.test.tsx`, `tests/background/chatgpt-oauth-service.test.ts`, and `npm run build`.
