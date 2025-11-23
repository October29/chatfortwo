import React, { useState } from 'react';
import JoinRoom from './components/JoinRoom';
import ChatRoom from './components/ChatRoom';
import useWebRTC from './hooks/useWebRTC';

function App() {
  const [joined, setJoined] = useState(() => !!localStorage.getItem('chat_joined'));
  const [roomID, setRoomID] = useState(() => localStorage.getItem('chat_roomID') || '');
  const [username, setUsername] = useState(() => localStorage.getItem('chat_username') || '');

  // Only initialize hook when joined
  const { peers, messages, sendMessage, sendTyping } = useWebRTC(joined ? roomID : null, joined ? username : null);

  const handleJoin = (room, user) => {
    setRoomID(room);
    setUsername(user);
    setJoined(true);
    localStorage.setItem('chat_joined', 'true');
    localStorage.setItem('chat_roomID', room);
    localStorage.setItem('chat_username', user);
  };

  const handleLeave = () => {
    setJoined(false);
    setRoomID('');
    setUsername('');
    localStorage.removeItem('chat_joined');
    localStorage.removeItem('chat_roomID');
    localStorage.removeItem('chat_username');
    // Hook will cleanup automatically when roomID/username becomes null
  };

  const handleChangeRoom = (newRoom) => {
    if (newRoom && newRoom !== roomID) {
      setRoomID(newRoom);
      localStorage.setItem('chat_roomID', newRoom);
    }
  };

  return (
    <>
      {!joined ? (
        <JoinRoom onJoin={handleJoin} />
      ) : (
        <ChatRoom
          roomID={roomID}
          username={username}
          messages={messages}
          sendMessage={sendMessage}
          sendTyping={sendTyping}
          peers={peers}
          onLeave={handleLeave}
          onChangeRoom={handleChangeRoom}
        />
      )}
    </>
  );
}

export default App;
