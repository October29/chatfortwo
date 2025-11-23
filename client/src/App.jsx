import React, { useState } from 'react';
import JoinRoom from './components/JoinRoom';
import ChatRoom from './components/ChatRoom';
import useWebRTC from './hooks/useWebRTC';

function App() {
  const [joined, setJoined] = useState(false);
  const [roomID, setRoomID] = useState('');
  const [username, setUsername] = useState('');

  // Only initialize hook when joined
  const { peers, messages, sendMessage } = useWebRTC(joined ? roomID : null, joined ? username : null);

  const handleJoin = (room, user) => {
    setRoomID(room);
    setUsername(user);
    setJoined(true);
  };

  const handleLeave = () => {
    setJoined(false);
    setRoomID('');
    setUsername('');
    // Hook will cleanup automatically when roomID/username becomes null
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
          peers={peers}
          onLeave={handleLeave}
        />
      )}
    </>
  );
}

export default App;
