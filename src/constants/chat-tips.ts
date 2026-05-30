/** Short examples footer appended to assistant replies (WhatsApp). */
export function getChatTipsFooter(): string {
  return [
    '',
    '─────────────',
    '💡 *Examples you can try*',
    '',
    '🔔 *Reminders* (just say it):',
    '• "remind me to drink water at 9am"',
    '• "remind me tomorrow at 10:30 to eat oats"',
  '',
    '📝 *Notes*:',
    '• "remember my pan number is ABCD1234"',
    '• "what is my pan number?"',
    '',
    '🔐 *Passwords*:',
    '• "save my gmail password as mySecret123"',
    '• "get my gmail password"',
    '',
    '📋 *Lists — natural chat*:',
    '• "start a groceries list"',
    '• "add milk, eggs, bread to groceries"',
    '• "show my groceries list"',
    '',
    '📋 *Lists — button flow*:',
    '• Type *menu* → tap *Create list* → name → add items with ➕ / ✅',
    '',
    '⌨️ *menu* = slide-up picker · */* = quick commands',
  ].join('\n');
}

const WHATSAPP_TEXT_MAX = 4096;

/** Append tips unless already present (avoids double footers). */
export function appendChatTips(message: string): string {
  if (!message?.trim()) return message;
  if (message.includes('Examples you can try') || message.includes('💡 *Examples')) {
    return message;
  }
  const footer = getChatTipsFooter();
  if (message.length + footer.length > WHATSAPP_TEXT_MAX) {
    return message;
  }
  return message + footer;
}
