const WHATSAPP_TEXT_MAX = 4096;

/** Short footer on most replies (3–4 lines). */
export function getChatTipsFooter(): string {
  return [
    '',
    '─────────────',
    '💬 Chat naturally — I understand plain English.',
  ].join('\n');
}

/** Full examples block for greeting & “didn’t understand” replies. */
export function getChatTipsFooterDetailed(): string {
  return [
    '',
    '─────────────',
    '💡 *Examples you can try*',
    '',
    '🔔 *Reminders:*',
    '• "remind me to drink water at 9am"',
    '• "remind me tomorrow at 10:30 to eat oats"',
    '',
    '📝 *Notes:*',
    '• "remember my pan number is ABCD1234"',
    '• "what is my pan number?"',
    '',
    '🔐 *Passwords:*',
    '• "save my gmail password as mySecret123"',
    '• "get my gmail password"',
    '',
    '📋 *Lists — chat:*',
    '• "start a groceries list"',
    '• "add milk, eggs, bread to groceries"',
    '• "show my groceries list"',
    '',
    '📋 *Lists — buttons:*',
    '• Type *menu* → *Create list* → name → add items with ➕ / ✅',
    '',
    '💬 Or say anything in your own words — no special commands required.',
    '⌨️ *menu* = slide-up picker · */* = quick commands',
  ].join('\n');
}

function appendFooter(message: string, footer: string, marker: string): string {
  if (!message?.trim()) return message;
  if (message.includes(marker)) return message;
  if (message.length + footer.length > WHATSAPP_TEXT_MAX) return message;
  return message + footer;
}

/** Compact tips on routine replies. */
export function appendChatTips(message: string): string {
  return appendFooter(message, getChatTipsFooter(), 'How to chat with Bot');
}

/** Detailed tips for greeting & unknown intent. */
export function appendChatTipsDetailed(message: string): string {
  return appendFooter(message, getChatTipsFooterDetailed(), 'Examples you can try');
}
