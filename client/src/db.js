import Dexie from 'dexie';

export const db = new Dexie('SecureChatDB');
db.version(1).stores({
    messages: '++id, roomID, timestamp', // Primary key and indexed props
});
