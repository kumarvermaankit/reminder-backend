export const MENU_ROW = {
  viewList: 'menu_view_list',
  allLists: 'menu_all_lists',
  createList: 'menu_create_list',
  editList: 'menu_edit_list',
  createReminder: 'menu_create_reminder',
  showReminders: 'menu_show_reminders',
  createNote: 'menu_create_note',
  showNotes: 'menu_show_notes',
  help: 'menu_help',
  currentIpo: 'menu_current_ipo',
  upcomingIpo: 'menu_upcoming_ipo',
  openList: (listId: string) => `list_open:${listId}`,
  editListOpen: (listId: string) => `edit_list_open:${listId}`,
  editRename: 'edit_rename',
  editAddItems: 'edit_add_items',
  editRemoveItem: 'edit_remove_item',
  editAttachReminder: 'edit_attach_reminder',
  editFinish: 'edit_finish',
  editPickItem: (itemId: string) => `edit_pick_item:${itemId}`,
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
      title: '📈 IPOs',
      rows: [
        { id: MENU_ROW.currentIpo, title: 'Current IPOs', description: 'Open IPOs accepting applications' },
        { id: MENU_ROW.upcomingIpo, title: 'Upcoming IPOs', description: 'IPOs coming soon' },
      ],
    },
    {
      title: '📋 Lists',
      rows: [
        { id: MENU_ROW.createList, title: 'Create list', description: 'New list + add items' },
        { id: MENU_ROW.viewList, title: "Today's list", description: 'View daily to-do' },
        { id: MENU_ROW.allLists, title: 'All lists', description: 'Browse your lists' },
        { id: MENU_ROW.editList, title: 'Edit a list', description: 'Rename, add/remove items, attach reminders' },
        { id: MENU_ROW.help, title: 'Help', description: 'Tips & commands' },
      ],
    },
  ];
}

export function getEditListSections() {
  return [
    {
      title: '✏️ Edit list',
      rows: [
        { id: MENU_ROW.editRename, title: '✏️ Rename list', description: 'Change the list name' },
        { id: MENU_ROW.editAddItems, title: '➕ Add items', description: 'Add more items to the list' },
        { id: MENU_ROW.editRemoveItem, title: '❌ Remove item', description: 'Mark an item as done and remove it' },
        { id: MENU_ROW.editAttachReminder, title: '🔔 Attach reminder', description: 'Set a reminder on an existing item' },
        { id: MENU_ROW.editFinish, title: '✅ Done editing', description: 'Finish editing and go back' },
      ],
    },
  ];
}
