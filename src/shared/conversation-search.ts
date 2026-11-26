export function matchesConversationText(query: string, ...fields: (string | undefined)[]) {
  const normalized = query.toLowerCase();
  return !normalized || fields.some((field) => field?.toLowerCase().includes(normalized));
}
