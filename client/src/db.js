import Dexie from 'dexie';

export const db = new Dexie('ChatDB');
db.version(1).stores({
    messages: '++id, roomID, timestamp, sender, pending', // Primary key and indexed props
});
