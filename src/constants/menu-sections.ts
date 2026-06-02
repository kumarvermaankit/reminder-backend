export const MENU_ROW = {
  viewList: 'menu_view_list',
  allLists: 'menu_all_lists',
  createList: 'menu_create_list',
  createReminder: 'menu_create_reminder',
  showReminders: 'menu_show_reminders',
  createNote: 'menu_create_note',
  showNotes: 'menu_show_notes',
  help: 'menu_help',
  openList: (listId: string) => `list_open:${listId}`,
} as const;

export function getMenuSections() {
  return [
    {
      title: '⏰ Reminders',
      rows: [
        { id: MENU_ROW.createReminder, title: 'Create reminder', description: 'Set a one-time or recurring reminder' },
        { id: MENU_ROW.showReminders, title: 'Show reminders', description: 'View your pending reminders' },
      ],
    },
    {
      title: '📝 Notes',
      rows: [
        { id: MENU_ROW.createNote, title: 'Save a note', description: 'Store info like email, PAN, address' },
        { id: MENU_ROW.showNotes, title: 'Show notes', description: 'Retrieve a saved note' },
      ],
    },
    {
      title: '📋 Lists',
      rows: [
        { id: MENU_ROW.createList, title: 'Create list', description: 'New list + add items' },
        { id: MENU_ROW.viewList, title: "Today's list", description: 'View daily to-do' },
        { id: MENU_ROW.allLists, title: 'All lists', description: 'Browse your lists' },
        { id: MENU_ROW.help, title: 'Help', description: 'Tips & commands' },
      ],
    },
  ];
}
