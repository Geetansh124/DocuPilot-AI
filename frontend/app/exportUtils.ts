export type ExportMessage = {
  role: "user" | "assistant";
  content: string;
  tools_used?: string[];
};

export function exportChatAsMarkdown(title: string, messages: ExportMessage[]) {
  const dateStr = new Date().toLocaleString();
  let md = `# ${title || "DocuPilot AI Conversation"}\n*Exported on ${dateStr}*\n\n---\n\n`;

  for (const m of messages) {
    const roleName = m.role === "user" ? "👤 **User**" : "🤖 **DocuPilot AI**";
    md += `### ${roleName}\n\n`;
    if (m.tools_used && m.tools_used.length > 0) {
      md += `*Tools used: ${m.tools_used.join(", ")}*\n\n`;
    }
    md += `${m.content}\n\n---\n\n`;
  }

  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(title || "chat").toLowerCase().replace(/[^a-z0-9]/g, "_")}_export.md`;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportChatAsJSON(title: string, messages: ExportMessage[]) {
  const exportData = {
    title: title || "DocuPilot AI Conversation",
    exported_at: new Date().toISOString(),
    message_count: messages.length,
    messages,
  };
  const jsonStr = JSON.stringify(exportData, null, 2);
  const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(title || "chat").toLowerCase().replace(/[^a-z0-9]/g, "_")}_export.json`;
  a.click();
  URL.revokeObjectURL(url);
}
